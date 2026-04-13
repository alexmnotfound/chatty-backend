import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is not configured with a strong value");
}

export type JwtPayload = { memberId: string; companyId: string; scope: "member" };

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as unknown as JwtPayload;
    if (payload.scope !== "member") {
      res.status(401).json({ error: "Token inválido para esta operación" });
      return;
    }
    const member = await prisma.teamMember.findUnique({ where: { id: payload.memberId } });
    if (!member) {
      res.status(401).json({ error: "Usuario no encontrado" });
      return;
    }
    if (!member.enabled) {
      res.status(401).json({ error: "Tu cuenta está deshabilitada. Consultá a un administrador." });
      return;
    }
    if (member.companyId !== payload.companyId) {
      res.status(401).json({ error: "Token inválido — empresa no coincide" });
      return;
    }
    (req as Request & { member: typeof member }).member = member;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}
