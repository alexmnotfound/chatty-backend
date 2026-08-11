import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { z } from "zod";
import { logActivity } from "../lib/activityLogger.js";
import { getCompanyId } from "../middleware/tenant.js";
import { requireModule } from "../middleware/modules.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);
tasksRouter.use(requireModule("tasks"));

const createSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  assignedToId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
});

// Helper: fetch a task with all relations
async function fetchFullTask(id: string) {
  const { data } = await supabase
    .from("tasks")
    .select(`
      *,
      conversation:conversations(*, contact:contacts(*), messages(*)),
      createdBy:company_members!created_by_id(id, name),
      assignedTo:company_members!assigned_to_id(id, name, email)
    `)
    .eq("id", id)
    .single();
  if (data?.conversation?.messages) {
    data.conversation.messages.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return data;
}

tasksRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const status = req.query.status as string | undefined;
  const assignedToId = req.query.assignedToId as string | undefined;

  let query = supabase
    .from("tasks")
    .select(`
      *,
      conversation:conversations(*, contact:contacts(*)),
      createdBy:company_members!created_by_id(id, name),
      assignedTo:company_members!assigned_to_id(id, name, email)
    `)
    .eq("company_id", companyId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (assignedToId) query = query.eq("assigned_to_id", assignedToId);

  const { data: list, error } = await query;
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.json(list ?? []);
});

tasksRouter.get("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const { data: task, error } = await supabase
    .from("tasks")
    .select(`
      *,
      conversation:conversations(*, contact:contacts(*), messages(*)),
      createdBy:company_members!created_by_id(id, name),
      assignedTo:company_members!assigned_to_id(id, name, email)
    `)
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !task) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }
  if (task.conversation?.messages) {
    task.conversation.messages.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  res.json(task);
});

async function assertAssignableMemberId(
  assignedToId: string | undefined | null,
  companyId: string,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (assignedToId == null || assignedToId === "") return { ok: true, id: null };
  const { data: assignee } = await supabase
    .from("company_members")
    .select("id, enabled")
    .eq("id", assignedToId)
    .eq("company_id", companyId)
    .maybeSingle();
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
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", parsed.data.conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conv) {
    res.status(404).json({ error: "Conversación no encontrada" });
    return;
  }

  const assignCheck = await assertAssignableMemberId(parsed.data.assignedToId, companyId);
  if (!assignCheck.ok) {
    res.status(400).json({ error: assignCheck.error });
    return;
  }

  const { data: newTask, error } = await supabase
    .from("tasks")
    .insert({
      company_id: companyId,
      conversation_id: conv.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigned_to_id: assignCheck.id,
      due_at: parsed.data.dueAt ?? null,
      created_by_id: member.id,
    })
    .select()
    .single();
  if (error || !newTask) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  const task = await fetchFullTask(newTask.id);
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "task.create",
    entityType: "task",
    entityId: newTask.id,
    conversationId: conv.id,
    taskId: newTask.id,
    meta: {
      title: newTask.title,
      assignedToId: newTask.assigned_to_id,
      dueAt: newTask.due_at,
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

  const { data: before } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!before) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.assignedToId !== undefined) updateData.assigned_to_id = parsed.data.assignedToId;
  if (parsed.data.dueAt !== undefined) updateData.due_at = parsed.data.dueAt ?? null;

  const { error } = await supabase
    .from("tasks")
    .update(updateData)
    .eq("id", before.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  const task = await fetchFullTask(before.id);
  void logActivity({
    companyId,
    actorId: member?.id,
    action: "task.update",
    entityType: "task",
    entityId: before.id,
    conversationId: before.conversation_id,
    taskId: before.id,
    meta: {
      fromStatus: before.status,
      toStatus: parsed.data.status ?? before.status,
      assignedToId: parsed.data.assignedToId ?? before.assigned_to_id,
    },
  });
  res.json(task);
});

tasksRouter.delete("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member as { id: string };

  const { data: before } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!before) {
    res.status(404).json({ error: "Tarea no encontrada" });
    return;
  }

  const { error } = await supabase.from("tasks").delete().eq("id", before.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  void logActivity({
    companyId,
    actorId: member?.id,
    action: "task.delete",
    entityType: "task",
    entityId: before.id,
    conversationId: before.conversation_id,
    taskId: before.id,
    meta: { fromStatus: before.status },
  });
  res.status(204).send();
});
