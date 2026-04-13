import { Request, Response, NextFunction } from "express";
import type { MemberRole } from "../lib/roles.js";

export function requireRole(...allowed: MemberRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const member = (req as Request & { member?: { role: string } }).member;
    if (!member || !allowed.includes(member.role as MemberRole)) {
      res.status(403).json({ error: "No tenés permiso para esta acción" });
      return;
    }
    next();
  };
}
