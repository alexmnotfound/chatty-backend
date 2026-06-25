import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { z } from "zod";
import { logActivity } from "../lib/activityLogger.js";
import { getCompanyId } from "../middleware/tenant.js";
import { sendWhatsAppText, getWhatsAppCredentials } from "../services/whatsapp.js";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

// Helper: fetch a full conversation with all relations
async function fetchFullConversation(id: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select(`
      *,
      contact:contacts(*),
      aiRole:ai_roles(*),
      messages(* ),
      tasks(*)
    `)
    .eq("id", id)
    .single();
  if (error) return null;
  // Sort messages asc, tasks desc
  if (data.messages) data.messages.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (data.tasks) data.tasks.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return data;
}

conversationsRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const { data: list, error } = await supabase
    .from("conversations")
    .select(`
      *,
      contact:contacts(*),
      aiRole:ai_roles(*),
      messages(*)
    `)
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  // Keep only the latest message per conversation
  const result = (list ?? []).map((c: any) => ({
    ...c,
    messages: c.messages
      ? [...c.messages].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 1)
      : [],
  }));
  res.json(result);
});

conversationsRouter.get("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const { data: conv, error } = await supabase
    .from("conversations")
    .select(`
      *,
      contact:contacts(*),
      aiRole:ai_roles(*),
      messages(*),
      tasks(*)
    `)
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  if (conv.messages) conv.messages.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (conv.tasks) conv.tasks.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  res.json(conv);
});

const readStateSchema = z.object({ unread: z.boolean() });
conversationsRouter.patch("/:id/read-state", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member as { id: string };
  const parsed = readStateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dato inválido" });
    return;
  }

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }

  const { error } = await supabase
    .from("conversations")
    .update({ unread_count: parsed.data.unread ? 1 : 0 })
    .eq("id", existing.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  const conv = await fetchFullConversation(existing.id);
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.read_state",
    entityType: "conversation",
    entityId: existing.id,
    conversationId: existing.id,
    meta: { unread: parsed.data.unread },
  });
  res.json(conv);
});

const takeOverSchema = z.object({ assignToMe: z.boolean().optional() });
conversationsRouter.post("/:id/take-over", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
  const parsed = takeOverSchema.safeParse(req.body);
  const assignToMe = parsed.success && parsed.data.assignToMe !== false;

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }

  const { error } = await supabase
    .from("conversations")
    .update({ status: "human", assigned_to_id: assignToMe ? member.id : null })
    .eq("id", existing.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  const conv = await fetchFullConversation(existing.id);
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.take_over",
    entityType: "conversation",
    entityId: existing.id,
    conversationId: existing.id,
    meta: { assignedToId: assignToMe ? member.id : null, status: "human" },
  });
  res.json(conv);
});

conversationsRouter.post("/:id/release-to-ai", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member as { id: string };

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }

  const { error } = await supabase
    .from("conversations")
    .update({ status: "ai", assigned_to_id: null })
    .eq("id", existing.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  const conv = await fetchFullConversation(existing.id);
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.release_to_ai",
    entityType: "conversation",
    entityId: existing.id,
    conversationId: existing.id,
  });
  res.json(conv);
});

const setRoleSchema = z.object({ aiRoleId: z.string().min(1) });
conversationsRouter.patch("/:id/ai-role", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member as { id: string };
  const setRoleParsed = setRoleSchema.safeParse(req.body);
  if (!setRoleParsed.success) {
    res.status(400).json({ error: "aiRoleId requerido" });
    return;
  }
  const { aiRoleId } = setRoleParsed.data;

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }

  const { error } = await supabase
    .from("conversations")
    .update({ ai_role_id: aiRoleId })
    .eq("id", existing.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  const conv = await fetchFullConversation(existing.id);
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.set_ai_role",
    entityType: "conversation",
    entityId: existing.id,
    conversationId: existing.id,
    meta: { aiRoleId },
  });
  res.json(conv);
});

const handoffSchema = z.object({
  botId: z.string().uuid().nullable(),
});
conversationsRouter.post("/:id/handoff", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
  const parsed = handoffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "botId debe ser un UUID o null" });
    return;
  }
  const { botId } = parsed.data;

  try {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!conversation) {
      res.status(404).json({ error: "Conversación no encontrada" });
      return;
    }

    if (botId) {
      const { data: bot } = await supabase
        .from("bots")
        .select("*")
        .eq("id", botId)
        .eq("company_id", companyId)
        .eq("active", true)
        .maybeSingle();
      if (!bot) {
        res.status(400).json({ error: "Bot no encontrado o inactivo" });
        return;
      }
      await supabase
        .from("conversations")
        .update({ active_bot_id: botId, status: "ai", updated_at: new Date().toISOString() })
        .eq("id", conversation.id);
      await supabase.from("messages").insert({
        conversation_id: conversation.id,
        company_id: companyId,
        direction: "out",
        body: `[Sistema] Conversación transferida a ${bot.name}`,
        from_ai: false,
      });
    } else {
      await supabase
        .from("conversations")
        .update({ active_bot_id: null, status: "human", updated_at: new Date().toISOString() })
        .eq("id", conversation.id);
      await supabase.from("messages").insert({
        conversation_id: conversation.id,
        company_id: companyId,
        direction: "out",
        body: "[Sistema] Conversación tomada por un agente humano",
        from_ai: false,
      });
    }

    void logActivity({
      companyId,
      actorId: member?.id,
      action: "conversation.handoff",
      entityType: "conversation",
      entityId: conversation.id,
      conversationId: conversation.id,
      meta: { botId: botId ?? null },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const sendSchema = z.object({ text: z.string().min(1).max(4096) });
conversationsRouter.post("/:id/send", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Texto requerido" });
    return;
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }

  const credentials = await getWhatsAppCredentials(companyId);
  if (!credentials) {
    res.status(502).json({ error: "WhatsApp no está configurado para esta empresa" });
    return;
  }
  const sent = await sendWhatsAppText(credentials.phoneNumberId, credentials.token, conv.contact.wa_id, parsed.data.text);
  if (!sent.ok) {
    if (sent.status === 401) {
      await supabase.from("company_config").update({ whatsapp_token_expired: true }).eq("company_id", companyId);
    }
    const hint = sent.status === 401 ? " (token expirado — actualizalo en Configuración → WhatsApp)" : "";
    res.status(502).json({ error: `No se pudo enviar por WhatsApp${hint}` });
    return;
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conv.id,
      company_id: companyId,
      direction: "out",
      body: parsed.data.text,
      from_ai: false,
    })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conv.id);

  void logActivity({
    companyId,
    actorId: member?.id,
    action: "message.human_send",
    entityType: "message",
    entityId: message.id,
    conversationId: conv.id,
    meta: { textLength: parsed.data.text.length },
  });
  res.json(message);
});
