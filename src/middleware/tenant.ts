import { Request } from "express";
import type { TeamMember } from "@prisma/client";

export type AuthenticatedRequest = Request & {
  member: TeamMember;
};

/**
 * Extract companyId from an authenticated request.
 * Use this in every tenant-scoped route handler.
 */
export function getCompanyId(req: Request): string {
  const member = (req as AuthenticatedRequest).member;
  return member.companyId;
}
