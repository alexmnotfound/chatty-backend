import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { getAIReply } from '../services/ai-provider.js';
import { compileSystemPrompt } from '../lib/prompt-compiler.js';
import { BOT_TEMPLATES } from '../lib/bot-templates.js';

const router = Router();
router.use(requireAuth);

// GET /api/bots — list bots for the company (no secrets)
router.get('/', async (req, res) => {
  const { companyId } = req as AuthRequest;
  try {
    const { data: bots, error } = await supabase
      .from('bots')
      .select('id, name, ai_provider, ai_model, gender, tone, active, is_active, is_default, template_type, created_at, whatsapp_phone_number_id')
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

// GET /api/bots/templates — list available bot templates
router.get('/templates', async (_req, res) => {
  res.json(BOT_TEMPLATES);
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
const BusinessHoursSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.string()),
  from: z.string(),
  to: z.string(),
  tz: z.string(),
});

const HumanHandoffSchema = z.object({
  team: z.string(),
  activeAgents: z.number().int().min(0),
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
  greeting: z.string().optional(),
  maxLength: z.enum(['short', 'medium', 'long']).optional(),
  businessHours: BusinessHoursSchema.optional(),
  humanHandoff: HumanHandoffSchema.optional(),
  examples: z.array(ExampleSchema).optional(),
  templateType: z.enum(['recepcionista', 'comercial']).nullable().optional(),
  isActive: z.boolean().optional(),
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
        id: randomUUID(),
        company_id: companyId,
        name: rest.name,
        whatsapp_phone_number_id: rest.whatsappPhoneNumberId,
        ai_provider: rest.aiProvider,
        ai_model: rest.aiModel,
        system_prompt: rest.systemPrompt,
        gender: rest.gender,
        tone: rest.tone,
        template_type: rest.templateType ?? null,
        // is_active defaults to true in DB
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
          bot_id: bot.id,
          company_id: companyId,
          user_message: ex.userMessage,
          bot_response: ex.botResponse,
          order: ex.order,
        }))
      );
    }

    res.status(201).json({ id: bot.id });
  } catch (e) {
    console.error('[bots POST]', e);
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
    if (rest.greeting !== undefined) updateData.greeting = rest.greeting;
    if (rest.maxLength !== undefined) updateData.max_length = rest.maxLength;
    if (rest.businessHours !== undefined) updateData.business_hours = rest.businessHours;
    if (rest.humanHandoff !== undefined) updateData.human_handoff = rest.humanHandoff;
    if (rest.templateType !== undefined) updateData.template_type = rest.templateType ?? null;
    if (rest.isActive !== undefined) updateData.is_active = rest.isActive;
    if (whatsappAccessToken) updateData.whatsapp_access_token_enc = encrypt(whatsappAccessToken);
    if (whatsappAppSecret) updateData.whatsapp_app_secret_enc = encrypt(whatsappAppSecret);
    if (aiApiKey) updateData.ai_api_key_enc = encrypt(aiApiKey);

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase.from('bots').update(updateData).eq('id', req.params.id);
      if (error) throw error;
    }

    if (examples !== undefined) {
      const { error: delErr } = await supabase.from('bot_examples').delete().eq('bot_id', req.params.id);
      if (delErr) throw delErr;
      if (examples.length > 0) {
        const { error: insErr } = await supabase.from('bot_examples').insert(
          examples.map(ex => ({
            user_message: ex.userMessage,
            bot_response: ex.botResponse,
            order: ex.order,
            bot_id: req.params.id,
            company_id: companyId,
          }))
        );
        if (insErr) throw insErr;
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[bots PATCH]', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/bots/:id — admin only
router.patch('/:id/set-default', async (req, res) => {
  const { companyId } = req as unknown as AuthRequest;
  try {
    // Unset current default, then set new one
    await supabase.from('bots').update({ is_default: false }).eq('company_id', companyId).eq('is_default', true);
    const { data: bot, error } = await supabase
      .from('bots')
      .update({ is_default: true })
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select('id, name, is_default')
      .single();
    if (error || !bot) return res.status(404).json({ error: 'Bot no encontrado' });
    res.json(bot);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/bots/:id/test-chat — simulate a chat with the bot's AI (preview, not sent to customers)
router.post('/:id/test-chat', async (req, res) => {
  const { companyId } = req as unknown as AuthRequest;
  const { systemPrompt, history, tone, gender, examples } = req.body as {
    systemPrompt?: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    tone?: string;
    gender?: string;
    examples?: { userMessage: string; botResponse: string; order: number }[];
  };

  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history requerido' });
  }

  try {
    // Load bot to get provider, model, and encrypted key
    const { data: bot } = await supabase
      .from('bots')
      .select('ai_provider, ai_model, ai_api_key_enc, system_prompt, gender, tone')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

    const provider = (bot.ai_provider ?? 'openai') as 'openai' | 'claude';
    const model = bot.ai_model ?? 'gpt-4o-mini';

    // Resolve API key: bot-level first, then company-level fallback
    let apiKey = bot.ai_api_key_enc ? decrypt(bot.ai_api_key_enc) : null;
    if (!apiKey) {
      const { data: cfg } = await supabase
        .from('company_config')
        .select('open_ai_api_key')
        .eq('company_id', companyId)
        .maybeSingle();

      // company_config only has open_ai_api_key; claude keys live at bot level (ai_api_key_enc)
      apiKey = provider === 'openai' ? (cfg?.open_ai_api_key ?? null) : null;
    }

    if (!apiKey) {
      return res.status(422).json({ error: 'No hay API key configurada para este bot' });
    }

    // Compile full system prompt using current (possibly unsaved) parameters from client
    const compiledPrompt = compileSystemPrompt({
      system_prompt: systemPrompt ?? bot.system_prompt ?? '',
      gender: gender ?? bot.gender,
      tone: tone ?? bot.tone,
      examples: (examples ?? []).map(ex => ({
        user_message: ex.userMessage,
        bot_response: ex.botResponse,
        order: ex.order,
      })),
    });

    const response = await getAIReply(provider, apiKey, model, compiledPrompt, history);
    res.json({ reply: response.text });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error al generar respuesta' });
  }
});

// GET /api/bots/:id/stats — last 7d metrics for a bot
router.get('/:id/stats', async (req, res) => {
  const { companyId } = req as unknown as AuthRequest;
  const botId = req.params.id;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const prevSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // conversations that had messages from this bot in last 7d
    const { data: msgs7d } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('bot_id', botId)
      .eq('company_id', companyId)
      .gte('created_at', since);

    const convIds7d = [...new Set((msgs7d ?? []).map((m: any) => m.conversation_id))];
    const total7d = convIds7d.length;

    // same for previous 7d (for delta)
    const { data: msgsPrev } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('bot_id', botId)
      .eq('company_id', companyId)
      .gte('created_at', prevSince)
      .lt('created_at', since);

    const totalPrev = new Set((msgsPrev ?? []).map((m: any) => m.conversation_id)).size;
    const delta = totalPrev > 0 ? Math.round(((total7d - totalPrev) / totalPrev) * 100) : 0;

    // handoff rate: conversations with status='human' among the 7d set
    let humanCount = 0;
    if (convIds7d.length > 0) {
      const { data: humanConvs } = await supabase
        .from('conversations')
        .select('id')
        .in('id', convIds7d)
        .eq('status', 'human');
      humanCount = (humanConvs ?? []).length;
    }

    const handoffRate = total7d > 0 ? Math.round((humanCount / total7d) * 100) : 0;
    const iaResolution = 100 - handoffRate;

    res.json({
      conversations7d: total7d,
      conversationsDelta: delta,
      iaResolution,
      humanHandoffRate: handoffRate,
      csatAverage: null,
    });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

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
