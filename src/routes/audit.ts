import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { prisma } from "../lib/prisma.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole("admin"));

function asInt(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeParseJson(input: string | null) {
  if (!input) return null;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

auditRouter.get("/", async (req, res) => {
  const limit = Math.max(1, Math.min(200, asInt(req.query.limit, 50)));
  const offset = Math.max(0, asInt(req.query.offset, 0));

  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

  const actorId = typeof req.query.actorId === "string" ? req.query.actorId : null;
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : null;
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : null;
  const taskId = typeof req.query.taskId === "string" ? req.query.taskId : null;
  const action = typeof req.query.action === "string" ? req.query.action : null;

  const where: any = {};
  if (from && !Number.isNaN(from.valueOf())) where.createdAt = { ...(where.createdAt ?? {}), gte: from };
  if (to && !Number.isNaN(to.valueOf())) where.createdAt = { ...(where.createdAt ?? {}), lte: to };
  if (actorId) where.actorId = actorId;
  if (entityType) where.entityType = entityType;
  if (conversationId) where.conversationId = conversationId;
  if (taskId) where.taskId = taskId;
  if (action) where.action = action;

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);

  res.json({
    total,
    logs: logs.map((l) => ({
      id: l.id,
      actorId: l.actorId,
      actor: l.actor,
      entityType: l.entityType,
      action: l.action,
      entityId: l.entityId,
      conversationId: l.conversationId,
      taskId: l.taskId,
      meta: safeParseJson(l.meta),
      metaRaw: l.meta,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});

