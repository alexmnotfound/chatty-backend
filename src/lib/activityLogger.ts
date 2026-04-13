import { prisma } from "./prisma.js";

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
    await prisma.activityLog.create({
      data: {
        companyId: input.companyId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        conversationId: input.conversationId ?? null,
        taskId: input.taskId ?? null,
        meta: input.meta !== undefined ? (input.meta as any) : undefined,
      },
    });
  } catch (err) {
    console.error("[activityLogger] failed", err);
  }
}
