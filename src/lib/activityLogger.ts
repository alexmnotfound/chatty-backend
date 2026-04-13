import { prisma } from "./prisma.js";

export type ActivityLogActionInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  conversationId?: string | null;
  taskId?: string | null;
  meta?: unknown;
};

function safeStringify(meta: unknown): string | null {
  if (meta === undefined) return null;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

// MVP: registrar el evento para auditoría/telemetría sin bloquear el flujo principal.
export async function logActivity(input: ActivityLogActionInput) {
  try {
    await prisma.activityLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        conversationId: input.conversationId ?? null,
        taskId: input.taskId ?? null,
        meta: safeStringify(input.meta),
      },
    });
  } catch (err) {
    // No rompemos la request por problemas de auditoría.
    console.error("[activityLogger] failed", err);
  }
}

