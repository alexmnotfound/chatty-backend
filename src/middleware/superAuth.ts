import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

export type SuperJwtPayload = { superAdminId: string; scope: "super" };

export async function requireSuperAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as unknown as SuperJwtPayload;
    if (payload.scope !== "super") {
      res.status(401).json({ error: "Token inválido para esta operación" });
      return;
    }
    const admin = await prisma.superAdmin.findUnique({ where: { id: payload.superAdminId } });
    if (!admin || !admin.enabled) {
      res.status(401).json({ error: "Cuenta no encontrada o deshabilitada" });
      return;
    }
    (req as Request & { superAdmin: typeof admin }).superAdmin = admin;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}
