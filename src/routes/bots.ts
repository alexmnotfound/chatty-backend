import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth.js';
import { encrypt } from '../lib/encryption.js';
import { getAIReply } from '../services/ai-provider.js';

const router = Router();
router.use(requireAuth);

// GET /api/bots — list bots for the company (no secrets)
router.get('/', async (req, res) => {
  const { companyId } = req as AuthRequest;
  const bots = await prisma.bot.findMany({
    where: { companyId },
    select: {
      id: true, name: true, aiProvider: true, aiModel: true,
      gender: true, tone: true, active: true, createdAt: true,
      whatsappPhoneNumberId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(bots);
});

// GET /api/bots/:id — single bot (no secrets returned, includes examples)
router.get('/:id', async (req, res) => {
  const { companyId } = req as unknown as AuthRequest;
  const bot = await prisma.bot.findFirst({
    where: { id: req.params.id, companyId },
    include: {
      examples: { orderBy: { order: 'asc' } },
    },
  });
  if (!bot) return res.status(404).json({ error: 'No encontrado' });

  // Strip encrypted fields, return boolean flags instead
  const { whatsappAccessTokenEnc, whatsappAppSecretEnc, aiApiKeyEnc, ...safeBot } = bot;
  res.json({
    ...safeBot,
    hasWhatsappToken: !!whatsappAccessTokenEnc,
    hasWhatsappAppSecret: !!whatsappAppSecretEnc,
    hasAiApiKey: !!aiApiKeyEnc,
  });
});

const ExampleSchema = z.object({
  userMessage: z.string().min(1),
  botResponse: z.string().min(1),
  order: z.number().int().min(0),
});

const BotSchema = z.object({
  name: z.string().min(1),
  whatsappPhoneNumberId: z.string().optional(),
  whatsappAccessToken: z.string().optional(),
  whatsappAppSecret: z.string().optional(),
  aiProvider: z.enum(['openai', 'claude']).default('openai'),
  aiApiKey: z.string().optional(),
  aiModel: z.string().default('gpt-4o-mini'),
  systemPrompt: z.string().default(''),
  gender: z.enum(['masculine', 'feminine', 'non_binary', 'neutral']).default('neutral'),
  tone: z.enum(['formal', 'informal']).default('informal'),
  examples: z.array(ExampleSchema).optional(),
});

// POST /api/bots — create bot (active: false, pending super-admin activation)
router.post('/', async (req, res) => {
  const { companyId } = req as AuthRequest;
  const parsed = BotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { examples, whatsappAccessToken, whatsappAppSecret, aiApiKey, ...rest } = parsed.data;

  const bot = await prisma.bot.create({
    data: {
      companyId,
      ...rest,
      ...(whatsappAccessToken && { whatsappAccessTokenEnc: encrypt(whatsappAccessToken) }),
      ...(whatsappAppSecret && { whatsappAppSecretEnc: encrypt(whatsappAppSecret) }),
      ...(aiApiKey && { aiApiKeyEnc: encrypt(aiApiKey) }),
      ...(examples && {
        examples: {
          create: examples.map(ex => ({ ...ex, companyId })),
        },
      }),
    },
  });
  res.status(201).json({ id: bot.id });
});

// PATCH /api/bots/:id — update bot (partial)
router.patch('/:id', async (req, res) => {
  const { companyId } = req as unknown as AuthRequest;
  const existing = await prisma.bot.findFirst({ where: { id: req.params.id, companyId } });
  if (!existing) return res.status(404).json({ error: 'No encontrado' });

  const parsed = BotSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { examples, whatsappAccessToken, whatsappAppSecret, aiApiKey, ...rest } = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.bot.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(whatsappAccessToken && { whatsappAccessTokenEnc: encrypt(whatsappAccessToken) }),
        ...(whatsappAppSecret && { whatsappAppSecretEnc: encrypt(whatsappAppSecret) }),
        ...(aiApiKey && { aiApiKeyEnc: encrypt(aiApiKey) }),
      },
    });
    if (examples !== undefined) {
      await tx.botExample.deleteMany({ where: { botId: req.params.id } });
      if (examples.length > 0) {
        await tx.botExample.createMany({
          data: examples.map(ex => ({ ...ex, botId: req.params.id, companyId })),
        });
      }
    }
  });

  res.json({ ok: true });
});

// DELETE /api/bots/:id — admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { companyId } = req as AuthRequest;
  const existing = await prisma.bot.findFirst({ where: { id: req.params.id, companyId } });
  if (!existing) return res.status(404).json({ error: 'No encontrado' });

  await prisma.bot.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// POST /api/bots/verify — verify WhatsApp credentials (plaintext, not saved)
router.post('/verify', async (req, res) => {
  const { phoneNumberId, accessToken } = req.body;
  if (!phoneNumberId || !accessToken) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await response.json() as { error?: { message: string }; display_phone_number?: string };
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ valid: true, displayPhoneNumber: data.display_phone_number });
  } catch {
    res.status(500).json({ error: 'Error al verificar credenciales de WhatsApp' });
  }
});

// POST /api/bots/test-ai — test AI key before saving (key arrives in plaintext, never stored here)
router.post('/test-ai', async (req, res) => {
  const { provider, apiKey, model } = req.body;
  if (!provider || !apiKey || !model) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const response = await getAIReply(
      provider as 'openai' | 'claude',
      apiKey,
      model,
      'Eres un asistente de prueba.',
      [{ role: 'user', content: 'Responde solo con "OK" para confirmar que funciona.' }]
    );
    res.json({ valid: true, response: response.text });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error al probar la API key' });
  }
});

export const botsRouter = router;
