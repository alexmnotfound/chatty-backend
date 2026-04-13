import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { logActivity } from "../lib/activityLogger.js";
import { getCompanyId } from "../middleware/tenant.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const createSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  assignedToId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
});

tasksRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const status = req.query.status as string | undefined;
  const assignedToId = req.query.assignedToId as string | undefined;
  const list = await prisma.task.findMany({
    where: {
      companyId,
      ...(status ? { status } : {}),
      ...(assignedToId ? { assignedToId } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      conversation: { include: { contact: true } },
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
  res.json(list);
});

tasksRouter.get("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, companyId },
    include: {
      conversation: {
        include: {
          contact: true,
          messages: { orderBy: { createdAt: "asc" } },
        },
      },
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
  if (!task) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }
  res.json(task);
});

async function assertAssignableMemberId(assignedToId: string | undefined | null, companyId: string): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (assignedToId == null || assignedToId === "") return { ok: true, id: null };
  const assignee = await prisma.teamMember.findFirst({ where: { id: assignedToId, companyId } });
  if (!assignee) return { ok: false, error: "Usuario asignado no encontrado" };
  if (!assignee.enabled) return { ok: false, error: "Ese usuario está deshabilitado" };
  return { ok: true, id: assignedToId };
}

tasksRouter.post("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error("[tasks] validation error", parsed.error.flatten());
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  // Verify the conversation belongs to this company
  const conv = await prisma.conversation.findFirst({ where: { id: parsed.data.conversationId, companyId } });
  if (!conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }
  const assignCheck = await assertAssignableMemberId(parsed.data.assignedToId, companyId);
  if (!assignCheck.ok) {
    res.status(400).json({ error: assignCheck.error });
    return;
  }
  const task = await prisma.task.create({
    data: {
      companyId,
      conversationId: conv.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assignedToId: assignCheck.id,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      createdById: member.id,
    },
    include: {
      conversation: { include: { contact: true } },
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "task.create",
    entityType: "task",
    entityId: task.id,
    conversationId: task.conversationId,
    taskId: task.id,
    meta: {
      title: task.title,
      assignedToId: task.assignedToId,
      dueAt: task.dueAt,
    },
  });
  res.status(201).json(task);
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "done"]).optional(),
  assignedToId: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
tasksRouter.patch("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member as { id: string };
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  if (parsed.data.assignedToId !== undefined && parsed.data.assignedToId !== null) {
    const assignCheck = await assertAssignableMemberId(parsed.data.assignedToId, companyId);
    if (!assignCheck.ok) {
      res.status(400).json({ error: assignCheck.error });
      return;
    }
  }
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.dueAt !== undefined) data.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;

  const before = await prisma.task.findFirst({ where: { id: req.params.id, companyId } });
  if (!before) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }
  const task = await prisma.task.update({
    where: { id: before.id },
    data,
    include: {
      conversation: { include: { contact: true } },
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  void logActivity({
    companyId,
    actorId: member?.id,
    action: "task.update",
    entityType: "task",
    entityId: task.id,
    conversationId: task.conversationId,
    taskId: task.id,
    meta: {
      fromStatus: before?.status,
      toStatus: task.status,
      assignedToId: task.assignedToId,
    },
  });
  res.json(task);
});

tasksRouter.delete("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member as { id: string };
  const before = await prisma.task.findFirst({ where: { id: req.params.id, companyId } });
  if (!before) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }
  await prisma.task.delete({ where: { id: before.id } });
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "task.delete",
    entityType: "task",
    entityId: before.id,
    conversationId: before.conversationId,
    taskId: before.id,
    meta: { fromStatus: before.status },
  });
  res.status(204).send();
});
