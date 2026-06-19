import { supabase } from "./supabase.js";

export type ActivityLogActionInput = {
  companyId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  conversationId?: string | null;
  taskId?: string | null;
  meta?: unknown;
};

export async function logActivity(input: ActivityLogActionInput) {
  try {
    const { error } = await supabase.from("activity_logs").insert({
      company_id: input.companyId ?? null,
      actor_id: input.actorId ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      conversation_id: input.conversationId ?? null,
      task_id: input.taskId ?? null,
      meta: input.meta !== undefined ? input.meta : null,
    });
    if (error) console.error("[activityLogger] failed", error);
  } catch (err) {
    console.error("[activityLogger] failed", err);
  }
}
