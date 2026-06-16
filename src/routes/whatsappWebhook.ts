import { Router, type Request } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
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
  const config = await prisma.companyConfig.findFirst({
    where: { whatsappPhoneNumberId: phoneNumberId },
    include: { company: true },
  });
  if (!config || !config.company.enabled) {
    console.warn("[webhook] No company found for phone_number_id:", phoneNumberId);
    res.sendStatus(200);
    return;
  }

  // Verify HMAC with company's app secret (fall back to global env var)
  const appSecret = config.whatsappAppSecret || process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !rawBody || typeof sigHeader !== "string") {
    res.sendStatus(403);
    return;
  }
  if (!verifySignature(rawBody, sigHeader, appSecret)) {
    res.sendStatus(403);
    return;
  }

  const companyId = config.companyId;

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

        const contact = await prisma.contact.upsert({
          where: { companyId_waId: { companyId, waId: from } },
          create: { companyId, waId: from, name },
          update: name ? { name } : {},
        });

        let conversation = await prisma.conversation.findUnique({
          where: { companyId_contactId: { companyId, contactId: contact.id } },
          include: { aiRole: true, messages: { orderBy: { createdAt: "asc" } } },
        });

        if (!conversation) {
          const defaultRole = await prisma.aiRole.findFirst({
            where: { companyId },
            orderBy: { name: "asc" },
          });
          conversation = await prisma.conversation.create({
            data: {
              companyId,
              contactId: contact.id,
              status: "ai",
              aiRoleId: defaultRole?.id ?? null,
            },
            include: { aiRole: true, messages: true },
          });
          void logActivity({
            companyId,
            action: "conversation.created",
            entityType: "conversation",
            entityId: conversation.id,
            conversationId: conversation.id,
            meta: { status: conversation.status, aiRoleId: conversation.aiRoleId },
          });
        }
        if (!conversation) continue;

        const incomingMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: "in",
            waMessageId: msg.id,
            body: msg.text.body,
            fromAi: false,
          },
        });
        void logActivity({
          companyId,
          action: "message.incoming",
          entityType: "message",
          entityId: incomingMessage.id,
          conversationId: conversation.id,
          meta: { textLength: incomingMessage.body.length },
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date(), unreadCount: { increment: 1 } },
        });

        if (conversation.status === "human") continue;

        const role = conversation.aiRole;
        if (!role) {
          if (credentials) {
            await sendWhatsAppText(credentials.phoneNumberId, credentials.token, from, "Gracias por escribir. Un momento por favor, te atiende un humano.");
          }
          continue;
        }

        const updatedConv = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        });
        if (!updatedConv) continue;

        const history = buildHistoryFromMessages(updatedConv.messages);
        const reply = await getAiReply(role.systemPrompt, history, companyId);

        if (credentials) {
          const sent = await sendWhatsAppText(credentials.phoneNumberId, credentials.token, from, reply);
          if (sent) {
            const outMessage = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                direction: "out",
                body: reply,
                fromAi: true,
              },
            });
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
});
