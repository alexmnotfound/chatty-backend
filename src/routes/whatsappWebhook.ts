import { Router, type Request } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { sendWhatsAppText } from "../services/whatsapp.js";
import { getAiReply, buildHistoryFromMessages } from "../services/ai.js";
import { logActivity } from "../lib/activityLogger.js";

export const whatsappWebhookRouter = Router();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

function verifyMetaSignature(req: Request): boolean {
  if (!APP_SECRET) return false;
  const sigHeader = req.headers["x-hub-signature-256"];
  if (typeof sigHeader !== "string" || !sigHeader.startsWith("sha256=")) return false;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return false;
  const expected = crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
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
  if (!verifyMetaSignature(req)) {
    res.sendStatus(403);
    return;
  }
  res.sendStatus(200);

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

  if (body.object !== "whatsapp_business_account") return;

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
          where: { waId: from },
          create: { waId: from, name },
          update: name ? { name } : {},
        });

        let conversation = await prisma.conversation.findUnique({
          where: { contactId: contact.id },
          include: { aiRole: true, messages: { orderBy: { createdAt: "asc" } } },
        });

        if (!conversation) {
          const defaultRole = await prisma.aiRole.findFirst({ orderBy: { name: "asc" } });
          conversation = await prisma.conversation.create({
            data: {
              contactId: contact.id,
              status: "ai",
              aiRoleId: defaultRole?.id ?? null,
            },
            include: { aiRole: true, messages: true },
          });
          void logActivity({
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

        if (conversation.status === "human") {
          continue;
        }

        const role = conversation.aiRole;
        if (!role) {
          await sendWhatsAppText(from, "Gracias por escribir. Un momento por favor, te atiende un humano.");
          continue;
        }

        const updatedConv = await prisma.conversation.findUnique({
          where: { id: conversation.id },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        });
        if (!updatedConv) continue;

        const history = buildHistoryFromMessages(updatedConv.messages);
        const reply = await getAiReply(role.systemPrompt, history);

        const sent = await sendWhatsAppText(from, reply);
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
});
