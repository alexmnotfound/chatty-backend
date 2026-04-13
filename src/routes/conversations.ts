import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { logActivity } from "../lib/activityLogger.js";
import { getCompanyId } from "../middleware/tenant.js";
import { sendWhatsAppText, getWhatsAppCredentials } from "../services/whatsapp.js";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const list = await prisma.conversation.findMany({
    where: { companyId },
    orderBy: { updatedAt: "desc" },
    include: {
      contact: true,
      aiRole: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  res.json(list);
});

conversationsRouter.get("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const conv = await prisma.conversation.findFirst({
    where: { id: req.params.id, companyId },
    include: {
      contact: true,
      aiRole: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
      tasks: {
        orderBy: { createdAt: "desc" },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
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
  const existing = await prisma.conversation.findFirst({ where: { id: req.params.id, companyId } });
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  const conv = await prisma.conversation.update({
    where: { id: existing.id },
    data: { unreadCount: parsed.data.unread ? 1 : 0 },
    include: {
      contact: true,
      aiRole: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
      tasks: {
        orderBy: { createdAt: "desc" },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.read_state",
    entityType: "conversation",
    entityId: conv.id,
    conversationId: conv.id,
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
  const existing = await prisma.conversation.findFirst({ where: { id: req.params.id, companyId } });
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  const conv = await prisma.conversation.update({
    where: { id: existing.id },
    data: {
      status: "human",
      assignedToId: assignToMe ? member.id : null,
    },
    include: {
      contact: true,
      aiRole: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
      tasks: {
        orderBy: { createdAt: "desc" },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.take_over",
    entityType: "conversation",
    entityId: conv.id,
    conversationId: conv.id,
    meta: { assignedToId: conv.assignedToId, status: conv.status },
  });
  res.json(conv);
});

conversationsRouter.post("/:id/release-to-ai", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member as { id: string };
  const existing = await prisma.conversation.findFirst({ where: { id: req.params.id, companyId } });
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  const conv = await prisma.conversation.update({
    where: { id: existing.id },
    data: {
      status: "ai",
      assignedToId: null,
    },
    include: {
      contact: true,
      aiRole: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
      tasks: {
        orderBy: { createdAt: "desc" },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.release_to_ai",
    entityType: "conversation",
    entityId: conv.id,
    conversationId: conv.id,
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
  const existing = await prisma.conversation.findFirst({ where: { id: req.params.id, companyId } });
  if (!existing) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  const conv = await prisma.conversation.update({
    where: { id: existing.id },
    data: { aiRoleId },
    include: {
      contact: true,
      aiRole: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
      tasks: {
        orderBy: { createdAt: "desc" },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "conversation.set_ai_role",
    entityType: "conversation",
    entityId: conv.id,
    conversationId: conv.id,
    meta: { aiRoleId },
  });
  res.json(conv);
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
  const conv = await prisma.conversation.findFirst({
    where: { id: req.params.id, companyId },
    include: { contact: true },
  });
  if (!conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  const credentials = await getWhatsAppCredentials(companyId);
  if (!credentials) {
    res.status(502).json({ error: "WhatsApp no está configurado para esta empresa" });
    return;
  }
  const sent = await sendWhatsAppText(conv.contact.waId, parsed.data.text, credentials);
  if (!sent) {
    res.status(502).json({ error: "No se pudo enviar por WhatsApp" });
    return;
  }
  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: "out",
      body: parsed.data.text,
      fromAi: false,
    },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { updatedAt: new Date() },
  });
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
