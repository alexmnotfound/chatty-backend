import { Router, type Request, type Response } from 'express';
import { createHmac } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { compileSystemPrompt } from '../lib/prompt-compiler.js';
import { getAIReply } from '../services/ai-provider.js';
import { calculateCost } from '../lib/cost-calculator.js';
import { sendWhatsAppText } from '../services/whatsapp.js';
import type { Bot, BotExample } from '@prisma/client';

const router = Router();

type BotWithExamples = Bot & { examples: BotExample[] };

// GET /webhook/:botId — Meta webhook verification challenge
router.get('/:botId', async (req: Request, res: Response) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  const bot = await prisma.bot.findUnique({ where: { id: req.params.botId } });
  if (!bot) return res.sendStatus(404);
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.send(challenge);
  }
  return res.sendStatus(403);
});

// POST /webhook/:botId — receive WhatsApp messages
router.post('/:botId', async (req: Request, res: Response) => {
  res.sendStatus(200); // Must respond to Meta immediately (< 5s)

  try {
    const bot = await prisma.bot.findUnique({
      where: { id: req.params.botId, active: true },
      include: { examples: { orderBy: { order: 'asc' } } },
    });
    if (!bot?.whatsappAppSecretEnc) return;

    // Verify HMAC signature
    const sig = (req.headers['x-hub-signature-256'] as string) ?? '';
    const appSecret = decrypt(bot.whatsappAppSecretEnc);
    const rawBody: Buffer = (req as Request & { rawBody?: Buffer }).rawBody
      ?? Buffer.from(JSON.stringify(req.body));
    const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
    if (sig !== expected) return;

    // Parse incoming text message
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg || msg.type !== 'text') return;

    const waId: string = msg.from;
    const text: string = msg.text.body;
    const contactName: string | undefined = change.value?.contacts?.[0]?.profile?.name;

    // Upsert contact
    const contact = await prisma.contact.upsert({
      where: { companyId_waId: { companyId: bot.companyId, waId } },
      create: { companyId: bot.companyId, waId, name: contactName },
      update: { name: contactName ?? undefined },
    });

    // Get or create open conversation for this contact + company
    let conversation = await prisma.conversation.findFirst({
      where: { contactId: contact.id, companyId: bot.companyId, status: { not: 'resolved' } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { companyId: bot.companyId, contactId: contact.id, activeBotId: bot.id, status: 'ai' },
      });
    }

    // Store inbound message
    await prisma.message.create({
      data: { conversationId: conversation.id, companyId: bot.companyId, direction: 'in', body: text },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
    });

    // Stop if human is handling or no active bot
    if (conversation.status !== 'ai' || !conversation.activeBotId) return;

    // Load the active bot (may differ from webhook bot after handoff)
    const activeBot: BotWithExamples | null = conversation.activeBotId === bot.id
      ? bot
      : await prisma.bot.findUnique({
          where: { id: conversation.activeBotId },
          include: { examples: { orderBy: { order: 'asc' } } },
        });
    if (!activeBot?.aiApiKeyEnc || !activeBot.aiProvider || !activeBot.aiModel) return;
    if (!activeBot.whatsappAccessTokenEnc || !activeBot.whatsappPhoneNumberId) return;

    // Build conversation history (last 20 messages)
    const historyRows = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const messages = historyRows.map(m => ({
      role: m.direction === 'in' ? 'user' as const : 'assistant' as const,
      content: m.body,
    }));

    // Compile system prompt and call AI
    const systemPrompt = compileSystemPrompt(activeBot);
    const apiKey = decrypt(activeBot.aiApiKeyEnc);
    const aiResponse = await getAIReply(
      activeBot.aiProvider as 'openai' | 'claude',
      apiKey,
      activeBot.aiModel,
      systemPrompt,
      messages,
    );
    const costNum = calculateCost(aiResponse.model, aiResponse.tokensIn, aiResponse.tokensOut);

    // Send WhatsApp reply
    const accessToken = decrypt(activeBot.whatsappAccessTokenEnc);
    await sendWhatsAppText(activeBot.whatsappPhoneNumberId, accessToken, waId, aiResponse.text);

    // Store outbound message with token tracking
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        companyId: bot.companyId,
        direction: 'out',
        body: aiResponse.text,
        fromAi: true,
        botId: activeBot.id,
        tokensIn: aiResponse.tokensIn,
        tokensOut: aiResponse.tokensOut,
        model: aiResponse.model,
        costUsd: costNum,
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });
  } catch (err) {
    console.error('[webhook] processing error');
  }
});

export default router;
