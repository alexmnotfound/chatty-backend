import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const metricsRouter = Router();
metricsRouter.use(requireAuth);

function asInt(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

metricsRouter.get("/dashboard", async (req, res) => {
  const days = Math.max(1, Math.min(90, asInt(req.query.days, 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conversations = await prisma.conversation.findMany({
    select: { status: true, unreadCount: true },
  });

  const conversationsTotal = conversations.length;
  const conversationsAi = conversations.filter((c) => c.status === "ai").length;
  const conversationsHuman = conversations.filter((c) => c.status === "human").length;
  const unreadTotal = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  const tasks = await prisma.task.findMany({
    select: { status: true, createdAt: true, updatedAt: true, dueAt: true },
  });
  const tasksTotal = tasks.length;
  const tasksPending = tasks.filter((t) => t.status === "pending").length;
  const tasksInProgress = tasks.filter((t) => t.status === "in_progress").length;
  const tasksDone = tasks.filter((t) => t.status === "done").length;

  const tasksCreatedInRange = await prisma.task.count({ where: { createdAt: { gte: since } } });
  const tasksDoneInRange = await prisma.task.count({
    where: { status: "done", updatedAt: { gte: since } },
  });

  const sinceWhere: any = { createdAt: { gte: since } };

  const totalEventsInRange = await prisma.activityLog.count({ where: sinceWhere });

  const topActorsRows = await prisma.activityLog.groupBy({
    by: ["actorId"],
    where: { ...sinceWhere, actorId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });

  const topActorIds = topActorsRows.map((r) => r.actorId).filter((id): id is string => typeof id === "string");
  const actorById = new Map(
    (
      await prisma.teamMember.findMany({
        where: { id: { in: topActorIds.length ? topActorIds : ["__none__"] } },
        select: { id: true, name: true, email: true, role: true },
      })
    ).map((a) => [a.id, a] as const),
  );

  const topActors = topActorsRows
    .map((r) => {
      const a = r.actorId ? actorById.get(r.actorId) : undefined;
      if (!a) return null;
      const events = r._count?.id ?? 0;
      return { actor: a, events };
    })
    .filter((x): x is { actor: { id: string; name: string; email: string; role: string }; events: number } => Boolean(x));

  const actionsOfInterest = [
    "conversation.read_state",
    "conversation.take_over",
    "conversation.release_to_ai",
    "conversation.set_ai_role",
    "message.human_send",
    "message.incoming",
    "message.ai_reply",
    "task.create",
    "task.update",
    "task.delete",
  ];

  const byActionRows = await prisma.activityLog.groupBy({
    by: ["action"],
    where: { ...sinceWhere, action: { in: actionsOfInterest } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  const byAction = byActionRows.map((r) => ({ action: r.action, count: r._count?.id ?? 0 }));

  res.json({
    range: { days, since: since.toISOString() },
    conversations: {
      total: conversationsTotal,
      ai: conversationsAi,
      human: conversationsHuman,
      unreadTotal,
    },
    tasks: {
      total: tasksTotal,
      pending: tasksPending,
      in_progress: tasksInProgress,
      done: tasksDone,
      createdInRange: tasksCreatedInRange,
      doneInRange: tasksDoneInRange,
    },
    activity: {
      totalEventsInRange,
      byAction,
      topActors,
    },
  });
});

