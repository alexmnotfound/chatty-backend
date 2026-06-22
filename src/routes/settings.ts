import { Router, type Request } from "express";
import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { supabase } from "../lib/supabase.js";
import { getCompanyId } from "../middleware/tenant.js";
import { logActivity } from "../lib/activityLogger.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

async function ensureConfig(companyId: string) {
  // Try to get existing config
  const { data: existing } = await supabase
    .from("company_config")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (existing) return existing;

  // Create if not exists
  const { data: created, error } = await supabase
    .from("company_config")
    .insert({ company_id: companyId })
    .select()
    .single();
  if (error) throw error;
  return created;
}

settingsRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  try {
    const config = await ensureConfig(companyId);
    res.json({
      whatsappPhoneNumberId: config.whatsapp_phone_number_id ?? "",
      hasWhatsAppAccessToken: Boolean(config.whatsapp_access_token),
      hasWhatsAppAppSecret: Boolean(config.whatsapp_app_secret),
      hasOpenAiApiKey: Boolean(config.open_ai_api_key),
      hasAnthropicApiKey: Boolean(config.anthropic_api_key),
    });
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const patchSchema = z.object({
  whatsappPhoneNumberId: z.string().min(1).optional(),
  whatsappAccessToken: z.string().min(1).optional(),
  whatsappAppSecret: z.string().min(1).optional(),
  openAiApiKey: z.string().min(1).optional(),
  anthropicApiKey: z.string().min(1).optional(),
});

settingsRouter.patch("/", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de configuración inválidos" });
    return;
  }
  const data: Record<string, string> = {};
  if (parsed.data.whatsappPhoneNumberId !== undefined) data.whatsapp_phone_number_id = parsed.data.whatsappPhoneNumberId.trim();
  if (parsed.data.whatsappAccessToken !== undefined) data.whatsapp_access_token = parsed.data.whatsappAccessToken.trim();
  if (parsed.data.whatsappAppSecret !== undefined) data.whatsapp_app_secret = parsed.data.whatsappAppSecret.trim();
  if (parsed.data.openAiApiKey !== undefined) data.open_ai_api_key = parsed.data.openAiApiKey.trim();
  if (parsed.data.anthropicApiKey !== undefined) data.anthropic_api_key = parsed.data.anthropicApiKey.trim();
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nada para actualizar" });
    return;
  }
  try {
    const { data: updated, error } = await supabase
      .from("company_config")
      .upsert({ company_id: companyId, ...data }, { onConflict: "company_id" })
      .select()
      .single();
    if (error) throw error;
    res.json({
      whatsappPhoneNumberId: updated.whatsapp_phone_number_id ?? "",
      hasWhatsAppAccessToken: Boolean(updated.whatsapp_access_token),
      hasWhatsAppAppSecret: Boolean(updated.whatsapp_app_secret),
      hasOpenAiApiKey: Boolean(updated.open_ai_api_key),
      hasAnthropicApiKey: Boolean(updated.anthropic_api_key),
    });
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const validateAiKeySchema = z.object({
  provider: z.enum(["openai", "claude"]),
  apiKey: z.string().min(1),
});

settingsRouter.post("/validate-ai-key", requireRole("admin"), async (req, res) => {
  const parsed = validateAiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const { provider, apiKey } = parsed.data;
  const companyId = getCompanyId(req);
  try {
    if (provider === "openai") {
      const client = new OpenAI({ apiKey });
      await client.models.list();
    } else {
      const client = new Anthropic({ apiKey });
      await client.models.list();
    }
    await logActivity({
      companyId,
      actorId: (req as any).member?.id ?? null,
      action: "settings.update_ai_key",
      entityType: "settings",
      entityId: companyId,
      meta: { provider },
    });
    res.json({ valid: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    res.status(400).json({ error: `API key inválida: ${msg}` });
  }
});
