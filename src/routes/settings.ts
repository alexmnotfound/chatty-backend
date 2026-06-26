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

function formatConfig(config: Record<string, unknown>) {
  return {
    whatsappPhoneNumber: config.whatsapp_phone_number ?? "",
    whatsappPhoneNumberId: config.whatsapp_phone_number_id ?? "",
    hasWhatsAppAccessToken: Boolean(config.whatsapp_access_token),
    hasWhatsAppAppSecret: Boolean(config.whatsapp_app_secret),
    whatsappTokenExpired: Boolean(config.whatsapp_token_expired),
    hasOpenAiApiKey: Boolean(config.open_ai_api_key),
    hasAnthropicApiKey: Boolean(config.anthropic_api_key),
    defaultRouting: (config.default_routing ?? "ai") as "ai" | "human",
    companyName: (config.company_name as string) ?? "",
    companyHours: (config.company_hours as string) ?? "",
    companyAddress: (config.company_address as string) ?? "",
    companyServices: (config.company_services as string) ?? "",
    companyContact: (config.company_contact as string) ?? "",
  };
}

settingsRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  try {
    const config = await ensureConfig(companyId);
    res.json(formatConfig(config));
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const patchSchema = z.object({
  whatsappPhoneNumber: z.string().optional(),
  whatsappPhoneNumberId: z.string().min(1).optional(),
  whatsappAccessToken: z.string().min(1).optional(),
  whatsappAppSecret: z.string().min(1).optional(),
  openAiApiKey: z.string().min(1).optional(),
  anthropicApiKey: z.string().min(1).optional(),
  defaultRouting: z.enum(["ai", "human"]).optional(),
  companyName: z.string().optional(),
  companyHours: z.string().optional(),
  companyAddress: z.string().optional(),
  companyServices: z.string().optional(),
  companyContact: z.string().optional(),
});

settingsRouter.patch("/", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de configuración inválidos" });
    return;
  }
  const data: Record<string, string | boolean> = {};
  if (parsed.data.whatsappPhoneNumber !== undefined) data.whatsapp_phone_number = parsed.data.whatsappPhoneNumber.trim();
  if (parsed.data.whatsappPhoneNumberId !== undefined) data.whatsapp_phone_number_id = parsed.data.whatsappPhoneNumberId.trim();
  if (parsed.data.whatsappAccessToken !== undefined) { data.whatsapp_access_token = parsed.data.whatsappAccessToken.trim(); data.whatsapp_token_expired = false; }
  if (parsed.data.whatsappAppSecret !== undefined) data.whatsapp_app_secret = parsed.data.whatsappAppSecret.trim();
  if (parsed.data.openAiApiKey !== undefined) data.open_ai_api_key = parsed.data.openAiApiKey.trim();
  if (parsed.data.anthropicApiKey !== undefined) data.anthropic_api_key = parsed.data.anthropicApiKey.trim();
  if (parsed.data.defaultRouting !== undefined) data.default_routing = parsed.data.defaultRouting;
  if (parsed.data.companyName !== undefined) data.company_name = parsed.data.companyName.trim();
  if (parsed.data.companyHours !== undefined) data.company_hours = parsed.data.companyHours.trim();
  if (parsed.data.companyAddress !== undefined) data.company_address = parsed.data.companyAddress.trim();
  if (parsed.data.companyServices !== undefined) data.company_services = parsed.data.companyServices.trim();
  if (parsed.data.companyContact !== undefined) data.company_contact = parsed.data.companyContact.trim();
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
    res.json(formatConfig(updated));
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
    console.error("[validate-ai-key] provider:", provider, "error:", msg);
    res.status(400).json({ error: "API key inválida. Verificá que sea correcta." });
  }
});
