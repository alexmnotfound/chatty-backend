import { Router, type Request } from "express";
import crypto, { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { sendWhatsAppText, getWhatsAppCredentials } from "../services/whatsapp.js";
import { getAiReply, buildHistoryFromMessages } from "../services/ai.js";
import { logActivity } from "../lib/activityLogger.js";

export const whatsappWebhookRouter = Router();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const HUMAN_INACTIVITY_TIMEOUT_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function verifySignature(rawBody: Buffer, sigHeader: string, appSecret: string): boolean {
  if (!sigHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = sigHeader.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

whatsappWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (!VERIFY_TOKEN) {
    res.status(500).send("Server not configured");
    return;
  }
  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    token.length === VERIFY_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(VERIFY_TOKEN))
  ) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Forbidden");
  }
});

whatsappWebhookRouter.post("/", async (req, res) => {
  console.log("[webhook] POST received, object:", (req.body as any)?.object);
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const sigHeader = req.headers["x-hub-signature-256"];

  const body = req.body as {
    object?: string;
    entry?: Array<{
      id: string;
      changes?: Array<{
        value?: {
          messaging_product?: string;
          metadata?: { phone_number_id?: string };
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: Array<{
            id: string;
            from: string;
            timestamp: string;
            type: string;
            text?: { body: string };
          }>;
        };
        field?: string;
      }>;
    }>;
  };

  if (body.object !== "whatsapp_business_account") {
    res.sendStatus(200);
    return;
  }

  // Extract phone_number_id from the first entry
  const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) {
    res.sendStatus(200);
    return;
  }

  // Look up company by phone_number_id
  const { data: config } = await supabase
    .from("company_config")
    .select("*, company:companies(*)")
    .eq("whatsapp_phone_number_id", phoneNumberId)
    .maybeSingle();

  if (!config || !config.company?.active) {
    console.error(
      `[webhook] ⚠️  No company configured for phone_number_id="${phoneNumberId}". ` +
      `Go to Settings → WhatsApp and enter this Phone Number ID.`
    );
    res.sendStatus(200);
    return;
  }

  // Verify HMAC with company's app secret (fall back to global env var)
  const appSecret = config.whatsapp_app_secret || process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !rawBody || typeof sigHeader !== "string") {
    console.error(
      `[webhook] ⚠️  App Secret not configured for company "${config.company_id}". ` +
      `Go to Settings → WhatsApp and enter the App Secret.`
    );
    res.sendStatus(403);
    return;
  }
  if (!verifySignature(rawBody, sigHeader, appSecret)) {
    console.error(
      `[webhook] ⚠️  HMAC signature mismatch for company "${config.company_id}". ` +
      `Check that the App Secret in Settings matches the one in Meta → Basic Settings.`
    );
    res.sendStatus(403);
    return;
  }

  const companyId = config.company_id;

  // Respond 200 immediately so Meta doesn't retry
  res.sendStatus(200);

  try {
  const credentials = await getWhatsAppCredentials(companyId);

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      console.log("[webhook] change.field:", change.field);
      if (change.field !== "messages") continue;
      const value = change.value;
      console.log("[webhook] value.messages:", JSON.stringify(value?.messages?.map((m: any) => ({id: m.id, type: m.type}))));
      if (!value?.messages) continue;

      for (const msg of value.messages) {
        console.log("[webhook] msg.type:", msg.type, "has text:", !!msg.text?.body);
        if (msg.type !== "text" || !msg.text?.body) continue;

        const from = msg.from;
        const contactInfo = value.contacts?.find((c) => c.wa_id === from);
        const name = contactInfo?.profile?.name ?? null;

        // Upsert contact by company_id + wa_id
        const { data: contact, error: contactError } = await supabase
          .from("contacts")
          .upsert(
            { company_id: companyId, wa_id: from, name },
            { onConflict: "company_id,wa_id" }
          )
          .select()
          .single();
        if (!contact) {
          console.error(`[webhook] Failed to upsert contact wa_id="${from}":`, contactError);
          continue;
        }
        console.log("[webhook] contact ok, id:", contact.id);

        // Fetch default_routing for this company
        const { data: companyConfig } = await supabase
          .from("company_config")
          .select("default_routing")
          .eq("company_id", companyId)
          .maybeSingle();
        const defaultRouting = (companyConfig?.default_routing ?? "ai") as "ai" | "human";

        // Get or create conversation (unique per company+contact)
        let { data: conversation } = await supabase
          .from("conversations")
          .select("*, aiRole:ai_roles(*), messages(*)")
          .eq("company_id", companyId)
          .eq("contact_id", contact.id)
          .maybeSingle();

        if (!conversation) {
          // Find default AI role
          const { data: defaultRole } = await supabase
            .from("ai_roles")
            .select("id")
            .eq("company_id", companyId)
            .order("name", { ascending: true })
            .limit(1)
            .maybeSingle();

          console.log("[webhook] creating conversation, defaultRole:", defaultRole?.id ?? null);
          const { data: newConv, error: convError } = await supabase
            .from("conversations")
            .insert({
              company_id: companyId,
              contact_id: contact.id,
              status: defaultRouting,
              ai_role_id: defaultRole?.id ?? null,
              updated_at: new Date().toISOString(),
            })
            .select("*, aiRole:ai_roles(*), messages(*)")
            .single();
          conversation = newConv;
          console.log("[webhook] conversation created:", conversation?.id, "error:", convError);

          if (conversation) {
            void logActivity({
              companyId,
              action: "conversation.created",
              entityType: "conversation",
              entityId: conversation.id,
              conversationId: conversation.id,
              meta: { status: conversation.status, aiRoleId: conversation.ai_role_id },
            });
          }
        }
        if (!conversation) continue;

        // Store inbound message
        const { data: incomingMessage, error: msgError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversation.id,
            company_id: companyId,
            direction: "in",
            wa_message_id: msg.id,
            body: msg.text.body,
            from_ai: false,
          })
          .select()
          .single();

        if (msgError) console.error("[webhook] Failed to insert message:", msgError);
        if (incomingMessage) {
          void logActivity({
            companyId,
            action: "message.incoming",
            entityType: "message",
            entityId: incomingMessage.id,
            conversationId: conversation.id,
            meta: { textLength: incomingMessage.body.length },
          });
        }

        // Increment unread count
        await supabase
          .from("conversations")
          .update({
            updated_at: new Date().toISOString(),
            unread_count: (conversation.unread_count ?? 0) + 1,
          })
          .eq("id", conversation.id);

        if (conversation.status === "human") {
          const lastActivity = conversation.updated_at
            ? new Date(conversation.updated_at).getTime()
            : 0;
          const isInactive = Date.now() - lastActivity > HUMAN_INACTIVITY_TIMEOUT_MS;

          if (isInactive) {
            await supabase
              .from("conversations")
              .update({ status: defaultRouting, updated_at: new Date().toISOString() })
              .eq("id", conversation.id);
            conversation = { ...conversation, status: defaultRouting };
            console.log(`[webhook] inactivity timeout — reset conversation ${conversation.id} to "${defaultRouting}"`);
          } else {
            continue;
          }
        }

        // Find active bot: prefer one linked to this phone number, fallback to any active bot
        const { data: linkedBot } = await supabase
          .from("bots")
          .select("id, name, system_prompt, is_active")
          .eq("company_id", companyId)
          .eq("whatsapp_phone_number_id", phoneNumberId)
          .eq("is_active", true)
          .maybeSingle();

        const { data: fallbackBot } = linkedBot ? { data: null } : await supabase
          .from("bots")
          .select("id, name, system_prompt, is_active")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name", { ascending: true })
          .limit(1)
          .maybeSingle();

        const activeBot = linkedBot ?? fallbackBot;
        console.log(`[webhook] bot: ${activeBot?.name ?? "none"}, credentials: ${credentials ? "ok" : "null"}`);

        if (!activeBot) {
          console.log(`[webhook] No active bot for company ${companyId} — skipping AI reply`);
          continue;
        }

        // Re-fetch messages for history (last 10)
        const { data: msgRows } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: true })
          .limit(10);

        const history = buildHistoryFromMessages(msgRows ?? []);
        console.log(`[webhook] calling getAiReply, history length: ${history.length}`);
        const reply = await getAiReply(activeBot.system_prompt, history, companyId);
        console.log(`[webhook] AI reply: "${reply.slice(0, 80)}..."`);

        if (credentials) {
          console.log(`[webhook] sending to ${from} via phoneNumberId ${credentials.phoneNumberId}`);
          const sent = await sendWhatsAppText(credentials.phoneNumberId, credentials.token, from, reply);
          console.log(`[webhook] sendWhatsAppText result: ${sent.ok}`);
          if (sent.ok) {
            const { data: outMessage } = await supabase
              .from("messages")
              .insert({
                conversation_id: conversation.id,
                company_id: companyId,
                direction: "out",
                body: reply,
                from_ai: true,
              })
              .select()
              .single();
            if (outMessage) {
              void logActivity({
                companyId,
                action: "message.ai_reply",
                entityType: "message",
                entityId: outMessage.id,
                conversationId: conversation.id,
                meta: { textLength: outMessage.body.length, ai: true },
              });
            }
          }
        }
      }
    }
  }
  } catch (e) {
    console.error("[webhook] Unhandled error in async processing:", e);
  }
});
