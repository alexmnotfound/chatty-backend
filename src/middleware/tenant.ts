import { Request } from "express";

export type MemberShape = {
  id: string;
  company_id: string;
  companyId: string;
  user_id: string;
  userId: string;
  role: string;
  email: string;
  name: string;
  enabled: boolean;
};

export type AuthenticatedRequest = Request & {
  member: MemberShape;
};

/**
 * Extract companyId from an authenticated request.
 * Use this in every tenant-scoped route handler.
 */
export function getCompanyId(req: Request): string {
  const member = (req as AuthenticatedRequest).member;
  return member.companyId;
}
