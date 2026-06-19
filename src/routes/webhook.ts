import { Router, type Request, type Response } from 'express';
import { createHmac } from 'crypto';
import { supabase } from '../lib/supabase.js';
import { decrypt } from '../lib/encryption.js';
import { compileSystemPrompt } from '../lib/prompt-compiler.js';
import { getAIReply } from '../services/ai-provider.js';
import { calculateCost } from '../lib/cost-calculator.js';
import { sendWhatsAppText } from '../services/whatsapp.js';

const router = Router();

type BotWithExamples = {
  id: string;
  company_id: string;
  name: string;
  ai_provider: string;
  ai_model: string;
  system_prompt: string;
  gender: string;
  tone: string;
  whatsapp_phone_number_id: string;
  whatsapp_access_token_enc: string;
  whatsapp_app_secret_enc: string;
  ai_api_key_enc: string;
  examples: Array<{ user_message: string; bot_response: string; order: number }>;
};

// GET /webhook/:botId — Meta webhook verification challenge
router.get('/:botId', async (req: Request, res: Response) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  const { data: bot } = await supabase
    .from('bots')
    .select('id, whatsapp_phone_number_id')
    .eq('id', req.params.botId)
    .maybeSingle();
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
    const { data: bot } = await supabase
      .from('bots')
      .select('*, examples:bot_examples(*)')
      .eq('id', req.params.botId)
      .eq('active', true)
      .maybeSingle() as { data: BotWithExamples | null };
    if (!bot?.whatsapp_app_secret_enc) return;

    // Sort examples by order
    if (bot.examples) bot.examples.sort((a, b) => a.order - b.order);

    // Verify HMAC signature
    const sig = (req.headers['x-hub-signature-256'] as string) ?? '';
    const appSecret = decrypt(bot.whatsapp_app_secret_enc);
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
    const { data: contact } = await supabase
      .from('contacts')
      .upsert(
        { company_id: bot.company_id, wa_id: waId, name: contactName ?? null },
        { onConflict: 'company_id,wa_id' }
      )
      .select()
      .single();
    if (!contact) return;

    // Get or create open conversation for this contact + company
    let { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('contact_id', contact.id)
      .eq('company_id', bot.company_id)
      .neq('status', 'resolved')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({ company_id: bot.company_id, contact_id: contact.id, active_bot_id: bot.id, status: 'ai' })
        .select()
        .single();
      conversation = newConv;
    }
    if (!conversation) return;

    // Store inbound message
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      company_id: bot.company_id,
      direction: 'in',
      body: text,
    });

    // Increment unread count
    await supabase
      .from('conversations')
      .update({ unread_count: (conversation.unread_count ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', conversation.id);

    // Stop if human is handling or no active bot
    if (conversation.status !== 'ai' || !conversation.active_bot_id) return;

    // Load the active bot (may differ from webhook bot after handoff)
    let activeBot: BotWithExamples | null = conversation.active_bot_id === bot.id
      ? bot
      : null;
    if (!activeBot) {
      const { data: fetchedBot } = await supabase
        .from('bots')
        .select('*, examples:bot_examples(*)')
        .eq('id', conversation.active_bot_id)
        .maybeSingle() as { data: BotWithExamples | null };
      activeBot = fetchedBot;
      if (activeBot?.examples) activeBot.examples.sort((a, b) => a.order - b.order);
    }
    if (!activeBot?.ai_api_key_enc || !activeBot.ai_provider || !activeBot.ai_model) return;
    if (!activeBot.whatsapp_access_token_enc || !activeBot.whatsapp_phone_number_id) return;

    // Build conversation history (last 20 messages)
    const { data: historyRows } = await supabase
      .from('messages')
      .select('direction, body')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(20);

    const messages = (historyRows ?? []).map((m: any) => ({
      role: m.direction === 'in' ? 'user' as const : 'assistant' as const,
      content: m.body,
    }));

    // Compile system prompt and call AI
    const systemPrompt = compileSystemPrompt(activeBot as any);
    const apiKey = decrypt(activeBot.ai_api_key_enc);
    const aiResponse = await getAIReply(
      activeBot.ai_provider as 'openai' | 'claude',
      apiKey,
      activeBot.ai_model,
      systemPrompt,
      messages,
    );
    const costNum = calculateCost(aiResponse.model, aiResponse.tokensIn, aiResponse.tokensOut);

    // Send WhatsApp reply
    const accessToken = decrypt(activeBot.whatsapp_access_token_enc);
    await sendWhatsAppText(activeBot.whatsapp_phone_number_id, accessToken, waId, aiResponse.text);

    // Store outbound message with token tracking
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      company_id: bot.company_id,
      direction: 'out',
      body: aiResponse.text,
      from_ai: true,
      bot_id: activeBot.id,
      tokens_in: aiResponse.tokensIn,
      tokens_out: aiResponse.tokensOut,
      model: aiResponse.model,
      cost_usd: costNum,
    });

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation.id);
  } catch (err) {
    console.error('[webhook] processing error');
  }
});

export default router;
