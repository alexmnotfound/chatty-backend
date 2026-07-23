import { Router, type Request } from "express";
import crypto, { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { sendWhatsAppText, getWhatsAppCredentials } from "../services/whatsapp.js";
import { buildHistoryFromMessages } from "../services/ai-provider.js";
import { decrypt } from "../lib/encryption.js";
import { compileSystemPrompt } from "../lib/prompt-compiler.js";
import { retrieveTopK } from "../services/rag.js";
import { getAIReply } from "../services/ai-provider.js";
import { logActivity } from "../lib/activityLogger.js";
import { ingestReceiptMessage } from "../services/receipt-ingest.js";

export const whatsappWebhookRouter = Router();

const HANDOFF_TOOL = {
  name: 'solicitar_handoff',
  description: 'Escalá esta conversación a un agente humano cuando no podés resolver la consulta, el cliente lo solicita, o la situación lo requiere.',
  parameters: {
    type: 'object',
    properties: {
      resumen: {
        type: 'string',
        description: 'Resumen breve de la consulta (1-2 oraciones). Va a la tarea del equipo.',
      },
      mensaje_despedida: {
        type: 'string',
        description: "Mensaje a enviar al cliente anunciando la derivación. Ej: 'Te paso con nuestro equipo, te contactan a la brevedad.'",
      },
    },
    required: ['resumen', 'mensaje_despedida'],
  },
};

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
            image?: { id: string; mime_type: string };
            document?: { id: string; mime_type: string; filename?: string };
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
  const defaultRouting = (config.default_routing ?? "ai") as "ai" | "human";

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
        if (msg.type !== "text" && msg.type !== "image" && msg.type !== "document") continue;

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

        // Get or create conversation (unique per company+contact)
        let { data: conversation } = await supabase
          .from("conversations")
          .select("*, aiRole:ai_roles(*), messages(*)")
          .eq("company_id", companyId)
          .eq("contact_id", contact.id)
          .maybeSingle();

        const isNewConversation = !conversation;
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

        let bodyText: string;
        if (msg.type === "image" || msg.type === "document") {
          if (!credentials) continue;
          const media = msg.type === "image" ? msg.image : msg.document;
          if (!media?.id) continue;

          const { data: activeBotsForKey } = await supabase
            .from("bots")
            .select("ai_api_key_enc, ai_provider")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("name", { ascending: true })
            .limit(1);
          const activeBotForKey = activeBotsForKey?.[0];
          const anthropicApiKey =
            activeBotForKey?.ai_provider === "claude" && activeBotForKey.ai_api_key_enc
              ? decrypt(activeBotForKey.ai_api_key_enc)
              : (process.env.ANTHROPIC_API_KEY ?? "");
          if (!anthropicApiKey) {
            console.error(
              `[webhook] ⚠️  No Anthropic key available for company ${companyId} — receipt extraction will fail. ` +
              `Configure a Claude bot or set ANTHROPIC_API_KEY.`
            );
          }

          const { isReceipt } = await ingestReceiptMessage({
            mediaId: media.id,
            messageId: msg.id,
            companyId,
            conversationId: conversation.id,
            whatsappToken: credentials.token,
            anthropicApiKey,
          });

          if (isReceipt) continue; // silent — goes to the receipts review queue, no chat reply

          bodyText = "[el cliente envió una imagen]";
        } else if (msg.text?.body) {
          bodyText = msg.text.body;
        } else {
          continue;
        }

        // Store inbound message
        const { data: incomingMessage, error: msgError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversation.id,
            company_id: companyId,
            direction: "in",
            wa_message_id: msg.id,
            body: bodyText,
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
        } else if (conversation.status === "resolved") {
          await supabase
            .from("conversations")
            .update({ status: "ai", resolved_by: null, updated_at: new Date().toISOString() })
            .eq("id", conversation.id);
          conversation = { ...conversation, status: "ai" };
        }

        // Find active bot: prefer one linked to this phone number, fallback to any active bot
        const { data: linkedBot } = await supabase
          .from("bots")
          .select("id, name, system_prompt, greeting, max_length, is_active, ai_model, ai_provider, ai_api_key_enc, gender, tone, business_hours, human_handoff, examples:bot_examples(*)")
          .eq("company_id", companyId)
          .eq("whatsapp_phone_number_id", phoneNumberId)
          .eq("is_active", true)
          .maybeSingle();

        const { data: fallbackBot } = linkedBot ? { data: null } : await supabase
          .from("bots")
          .select("id, name, system_prompt, greeting, max_length, is_active, ai_model, ai_provider, ai_api_key_enc, gender, tone, business_hours, human_handoff, examples:bot_examples(*)")
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

        const botGreeting = (activeBot as any).greeting as string | null;
        let reply: string;

        if (isNewConversation && botGreeting) {
          reply = botGreeting;
          console.log(`[webhook] new conversation — using greeting instead of AI`);
        } else {
          // Re-fetch messages for history (last 10)
          // Fetch the last 10 messages (newest first) then reverse so the
          // current inbound message is always included in the window.
          const { data: msgRowsDesc } = await supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversation.id)
            .order("created_at", { ascending: false })
            .limit(10);

          const history = buildHistoryFromMessages((msgRowsDesc ?? []).reverse());
          const { data: companyCfg } = await supabase
            .from("company_config")
            .select("company_name, company_hours, company_address, company_services, company_contact")
            .eq("company_id", companyId)
            .maybeSingle();
          const rawKey = activeBot.ai_api_key_enc
            ? decrypt(activeBot.ai_api_key_enc)
            : (process.env.OPENAI_API_KEY ?? '');
          const ragContext = await retrieveTopK((activeBot as any).id, bodyText, rawKey).catch(() => []);
          const systemPrompt = compileSystemPrompt({
            ...activeBot,
            ragContext,
            businessHoursEnabled: (activeBot as any).business_hours?.enabled ?? false,
            handoffTeam: (activeBot as any).human_handoff?.team ?? null,
          } as any, {
            name: companyCfg?.company_name,
            hours: companyCfg?.company_hours,
            address: companyCfg?.company_address,
            services: companyCfg?.company_services,
            contact: companyCfg?.company_contact,
          });
          const provider = ((activeBot as any).ai_provider ?? 'openai') as 'openai' | 'claude';
          const model = (activeBot as any).ai_model ?? 'gpt-4o-mini';
          console.log(`[webhook] calling AI, provider=${provider}, model=${model}, history length: ${history.length}`);
          console.log(`[webhook] system prompt:\n---\n${systemPrompt}\n---`);
          const aiResponse = await getAIReply(provider, rawKey, model, systemPrompt, history, [HANDOFF_TOOL]);
          console.log(`[webhook] AI toolCalls: ${aiResponse.toolCalls.map(tc => tc.name).join(', ') || 'none'}`);

          const handoffCall = aiResponse.toolCalls.find((tc) => tc.name === 'solicitar_handoff');

          if (handoffCall) {
            const resumen = (handoffCall.arguments.resumen as string) ?? '';
            const mensajeDespedida = (handoffCall.arguments.mensaje_despedida as string) ?? '';

            // Send farewell message to WhatsApp
            if (credentials && mensajeDespedida) {
              const sent = await sendWhatsAppText(credentials.phoneNumberId, credentials.token, from, mensajeDespedida);
              if (sent.ok) {
                await supabase.from('messages').insert({
                  conversation_id: conversation.id,
                  company_id: companyId,
                  direction: 'out',
                  body: mensajeDespedida,
                  from_ai: true,
                });
              }
            }

            // Mark conversation as human
            await supabase
              .from('conversations')
              .update({ status: 'human', updated_at: new Date().toISOString() })
              .eq('id', conversation.id);

            // Create task in pool (no assignee)
            await supabase.from('tasks').insert({
              id: randomUUID(),
              company_id: companyId,
              conversation_id: conversation.id,
              title: `Derivación — ${contact.name ?? from}`,
              description: resumen,
            });

            void logActivity({
              companyId,
              action: 'conversation.handoff_by_bot',
              entityType: 'conversation',
              entityId: conversation.id,
              conversationId: conversation.id,
              meta: { resumen },
            });

            continue; // skip normal reply path
          }

          // No tool call — normal text reply
          reply = aiResponse.text ?? '';
          console.log(`[webhook] AI reply: "${reply.slice(0, 80)}..."`);
        }

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
