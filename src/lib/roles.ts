export const MEMBER_ROLES = ["admin", "agent"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export function isMemberRole(s: string): s is MemberRole {
  return MEMBER_ROLES.includes(s as MemberRole);
}
