import { Router, type Request } from "express";
import crypto from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { sendWhatsAppText, getWhatsAppCredentials } from "../services/whatsapp.js";
import { getAiReply, buildHistoryFromMessages } from "../services/ai.js";
import { logActivity } from "../lib/activityLogger.js";

export const whatsappWebhookRouter = Router();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

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

  if (!config || !config.company?.enabled) {
    console.warn("[webhook] No company found for phone_number_id:", phoneNumberId);
    res.sendStatus(200);
    return;
  }

  // Verify HMAC with company's app secret (fall back to global env var)
  const appSecret = config.whatsapp_app_secret || process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !rawBody || typeof sigHeader !== "string") {
    res.sendStatus(403);
    return;
  }
  if (!verifySignature(rawBody, sigHeader, appSecret)) {
    res.sendStatus(403);
    return;
  }

  const companyId = config.company_id;

  // Respond 200 immediately
  res.sendStatus(200);

  const credentials = await getWhatsAppCredentials(companyId);

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      if (!value?.messages) continue;

      for (const msg of value.messages) {
        if (msg.type !== "text" || !msg.text?.body) continue;

        const from = msg.from;
        const contactInfo = value.contacts?.find((c) => c.wa_id === from);
        const name = contactInfo?.profile?.name ?? null;

        // Upsert contact by company_id + wa_id
        const { data: contact } = await supabase
          .from("contacts")
          .upsert(
            { company_id: companyId, wa_id: from, name },
            { onConflict: "company_id,wa_id" }
          )
          .select()
          .single();
        if (!contact) continue;

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

          const { data: newConv } = await supabase
            .from("conversations")
            .insert({
              company_id: companyId,
              contact_id: contact.id,
              status: "ai",
              ai_role_id: defaultRole?.id ?? null,
            })
            .select("*, aiRole:ai_roles(*), messages(*)")
            .single();
          conversation = newConv;

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
        const { data: incomingMessage } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversation.id,
            direction: "in",
            wa_message_id: msg.id,
            body: msg.text.body,
            from_ai: false,
          })
          .select()
          .single();

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

        if (conversation.status === "human") continue;

        const role = conversation.aiRole;
        if (!role) {
          if (credentials) {
            await sendWhatsAppText(credentials.phoneNumberId, credentials.token, from, "Gracias por escribir. Un momento por favor, te atiende un humano.");
          }
          continue;
        }

        // Re-fetch messages for history (last 30)
        const { data: msgRows } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: true })
          .limit(30);

        const history = buildHistoryFromMessages(msgRows ?? []);
        const reply = await getAiReply(role.system_prompt, history, companyId);

        if (credentials) {
          const sent = await sendWhatsAppText(credentials.phoneNumberId, credentials.token, from, reply);
          if (sent) {
            const { data: outMessage } = await supabase
              .from("messages")
              .insert({
                conversation_id: conversation.id,
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
});
