import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { supabase } from "../lib/supabase.js";
import { getCompanyId } from "../middleware/tenant.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole("admin"));

function asInt(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

auditRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const limit = Math.max(1, Math.min(200, asInt(req.query.limit, 50)));
  const offset = Math.max(0, asInt(req.query.offset, 0));

  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const actorId = typeof req.query.actorId === "string" ? req.query.actorId : null;
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : null;
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : null;
  const taskId = typeof req.query.taskId === "string" ? req.query.taskId : null;
  const action = typeof req.query.action === "string" ? req.query.action : null;

  // Build query for logs
  let logsQuery = supabase
    .from("activity_logs")
    .select(`
      *,
      actor:company_members!actor_id(id, name, email, role)
    `, { count: "exact" })
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (from && !Number.isNaN(new Date(from).valueOf())) logsQuery = logsQuery.gte("created_at", from);
  if (to && !Number.isNaN(new Date(to).valueOf())) logsQuery = logsQuery.lte("created_at", to);
  if (actorId) logsQuery = logsQuery.eq("actor_id", actorId);
  if (entityType) logsQuery = logsQuery.eq("entity_type", entityType);
  if (conversationId) logsQuery = logsQuery.eq("conversation_id", conversationId);
  if (taskId) logsQuery = logsQuery.eq("task_id", taskId);
  if (action) logsQuery = logsQuery.eq("action", action);

  const { data: logs, count, error } = await logsQuery;
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  res.json({
    total: count ?? 0,
    logs: (logs ?? []).map((l: any) => ({
      id: l.id,
      actorId: l.actor_id,
      actor: l.actor,
      entityType: l.entity_type,
      action: l.action,
      entityId: l.entity_id,
      conversationId: l.conversation_id,
      taskId: l.task_id,
      meta: l.meta,
      createdAt: l.created_at,
    })),
  });
});
