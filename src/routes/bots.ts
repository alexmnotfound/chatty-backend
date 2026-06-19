import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth.js';
import { encrypt } from '../lib/encryption.js';
import { getAIReply } from '../services/ai-provider.js';

const router = Router();
router.use(requireAuth);

// GET /api/bots — list bots for the company (no secrets)
router.get('/', async (req, res) => {
  const { companyId } = req as AuthRequest;
  try {
    const { data: bots, error } = await supabase
      .from('bots')
      .select('id, name, ai_provider, ai_model, gender, tone, active, created_at, whatsapp_phone_number_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(bots ?? []);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const VerifySchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
});

// POST /api/bots/verify — verify WhatsApp credentials (plaintext, not saved)
router.post('/verify', async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { phoneNumberId, accessToken } = parsed.data;

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

const TestAiSchema = z.object({
  provider: z.enum(['openai', 'claude']),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

// POST /api/bots/test-ai — test AI key before saving (key arrives in plaintext, never stored here)
router.post('/test-ai', async (req, res) => {
  const parsed = TestAiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { provider, apiKey, model } = parsed.data;

  try {
    const response = await getAIReply(
      provider,
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

// GET /api/bots/:id — single bot (no secrets returned, includes examples)
router.get('/:id', async (req, res) => {
  const { companyId } = req as unknown as AuthRequest;
  try {
    const { data: bot, error } = await supabase
      .from('bots')
      .select('*, examples:bot_examples(*)')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (error || !bot) return res.status(404).json({ error: 'No encontrado' });

    // Sort examples by order
    if (bot.examples) bot.examples.sort((a: any, b: any) => a.order - b.order);

    // Strip encrypted fields, return boolean flags instead
    const { whatsapp_access_token_enc, whatsapp_app_secret_enc, ai_api_key_enc, ...safeBot } = bot;
    res.json({
      ...safeBot,
      hasWhatsappToken: !!whatsapp_access_token_enc,
      hasWhatsappAppSecret: !!whatsapp_app_secret_enc,
      hasAiApiKey: !!ai_api_key_enc,
    });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const ExampleSchema = z.object({
  userMessage: z.string().min(1),
  botResponse: z.string().min(1),
  order: z.number().int().min(0),
});

// `active` is intentionally excluded — bots are activated by super-admin only
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

  try {
    const { data: bot, error } = await supabase
      .from('bots')
      .insert({
        company_id: companyId,
        name: rest.name,
        whatsapp_phone_number_id: rest.whatsappPhoneNumberId,
        ai_provider: rest.aiProvider,
        ai_model: rest.aiModel,
        system_prompt: rest.systemPrompt,
        gender: rest.gender,
        tone: rest.tone,
        ...(whatsappAccessToken && { whatsapp_access_token_enc: encrypt(whatsappAccessToken) }),
        ...(whatsappAppSecret && { whatsapp_app_secret_enc: encrypt(whatsappAppSecret) }),
        ...(aiApiKey && { ai_api_key_enc: encrypt(aiApiKey) }),
      })
      .select()
      .single();
    if (error) throw error;

    if (examples && examples.length > 0) {
      await supabase.from('bot_examples').insert(
        examples.map(ex => ({
          ...ex,
          bot_id: bot.id,
          company_id: companyId,
          user_message: ex.userMessage,
          bot_response: ex.botResponse,
        }))
      );
    }

    res.status(201).json({ id: bot.id });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/bots/:id — update bot (partial)
router.patch('/:id', async (req, res) => {
  const { companyId } = req as unknown as AuthRequest;
  try {
    const { data: existing } = await supabase
      .from('bots')
      .select('id')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    const parsed = BotSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { examples, whatsappAccessToken, whatsappAppSecret, aiApiKey, ...rest } = parsed.data;

    const updateData: Record<string, unknown> = {};
    if (rest.name !== undefined) updateData.name = rest.name;
    if (rest.whatsappPhoneNumberId !== undefined) updateData.whatsapp_phone_number_id = rest.whatsappPhoneNumberId;
    if (rest.aiProvider !== undefined) updateData.ai_provider = rest.aiProvider;
    if (rest.aiModel !== undefined) updateData.ai_model = rest.aiModel;
    if (rest.systemPrompt !== undefined) updateData.system_prompt = rest.systemPrompt;
    if (rest.gender !== undefined) updateData.gender = rest.gender;
    if (rest.tone !== undefined) updateData.tone = rest.tone;
    if (whatsappAccessToken) updateData.whatsapp_access_token_enc = encrypt(whatsappAccessToken);
    if (whatsappAppSecret) updateData.whatsapp_app_secret_enc = encrypt(whatsappAppSecret);
    if (aiApiKey) updateData.ai_api_key_enc = encrypt(aiApiKey);

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase.from('bots').update(updateData).eq('id', req.params.id);
      if (error) throw error;
    }

    if (examples !== undefined) {
      await supabase.from('bot_examples').delete().eq('bot_id', req.params.id);
      if (examples.length > 0) {
        await supabase.from('bot_examples').insert(
          examples.map(ex => ({
            user_message: ex.userMessage,
            bot_response: ex.botResponse,
            order: ex.order,
            bot_id: req.params.id,
            company_id: companyId,
          }))
        );
      }
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/bots/:id — admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { companyId } = req as AuthRequest;
  try {
    const { data: existing } = await supabase
      .from('bots')
      .select('id')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'No encontrado' });

    const { error } = await supabase.from('bots').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export const botsRouter = router;
