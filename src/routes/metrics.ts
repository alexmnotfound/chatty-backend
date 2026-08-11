import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { getCompanyId } from "../middleware/tenant.js";
import { requireModule } from "../middleware/modules.js";

export const metricsRouter = Router();
metricsRouter.use(requireAuth);
metricsRouter.use(requireModule("dashboard"));

function asInt(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

metricsRouter.get("/dashboard", async (req, res) => {
  const companyId = getCompanyId(req);
  const days = Math.max(1, Math.min(90, asInt(req.query.days, 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  // Conversations stats
  const { count: conversationsTotal } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  const { count: conversationsAi } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "ai");

  const { count: conversationsHuman } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "human");

  const { data: unreadData } = await supabase
    .from("conversations")
    .select("unread_count")
    .eq("company_id", companyId)
    .gt("unread_count", 0);
  const unreadTotal = (unreadData ?? []).reduce((acc: number, c) => acc + (c.unread_count || 0), 0);

  // Tasks stats
  const { count: tasksTotal } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  const { count: tasksPending } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "pending");

  const { count: tasksInProgress } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "in_progress");

  const { count: tasksDone } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "done");

  const { count: tasksCreatedInRange } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .gte("created_at", sinceIso);

  const { count: tasksDoneInRange } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "done")
    .gte("updated_at", sinceIso);

  // Activity logs stats
  const { count: totalEventsInRange } = await supabase
    .from("activity_logs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .gte("created_at", sinceIso);

  // Top actors: fetch recent logs with actor, group in JS
  const { data: recentLogs } = await supabase
    .from("activity_logs")
    .select("actor_id")
    .eq("company_id", companyId)
    .gte("created_at", sinceIso)
    .not("actor_id", "is", null)
    .limit(500);            // cap: we only need top-5 actors, 500 rows is more than enough

  const actorCounts = new Map<string, number>();
  for (const row of recentLogs ?? []) {
    if (row.actor_id) {
      actorCounts.set(row.actor_id, (actorCounts.get(row.actor_id) ?? 0) + 1);
    }
  }
  const topActorIds = [...actorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  let topActors: Array<{ actor: { id: string; name: string; email: string; role: string }; events: number }> = [];
  if (topActorIds.length > 0) {
    const { data: actorRows } = await supabase
      .from("company_members")
      .select("id, name, email, role")
      .eq("company_id", companyId)
      .in("id", topActorIds);
    const actorById = new Map((actorRows ?? []).map((a: any) => [a.id, a]));
    topActors = topActorIds
      .map((id) => {
        const actor = actorById.get(id) as any;
        if (!actor) return null;
        return { actor, events: actorCounts.get(id) ?? 0 };
      })
      .filter((x): x is { actor: { id: string; name: string; email: string; role: string }; events: number } => Boolean(x));
  }

  // Activity by action: fetch and group in JS
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

  const { data: actionLogs } = await supabase
    .from("activity_logs")
    .select("action")
    .eq("company_id", companyId)
    .gte("created_at", sinceIso)
    .in("action", actionsOfInterest);

  const actionCounts = new Map<string, number>();
  for (const row of actionLogs ?? []) {
    actionCounts.set(row.action, (actionCounts.get(row.action) ?? 0) + 1);
  }
  const byAction = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([action, count]) => ({ action, count }));

  res.json({
    range: { days, since: since.toISOString() },
    conversations: {
      total: conversationsTotal ?? 0,
      ai: conversationsAi ?? 0,
      human: conversationsHuman ?? 0,
      unreadTotal,
    },
    tasks: {
      total: tasksTotal ?? 0,
      pending: tasksPending ?? 0,
      in_progress: tasksInProgress ?? 0,
      done: tasksDone ?? 0,
      createdInRange: tasksCreatedInRange ?? 0,
      doneInRange: tasksDoneInRange ?? 0,
    },
    activity: {
      totalEventsInRange: totalEventsInRange ?? 0,
      byAction,
      topActors,
    },
  });
});
