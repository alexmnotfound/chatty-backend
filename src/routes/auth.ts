import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is not configured with a strong value");
}
export const authRouter = Router();

authRouter.get("/me", requireAuth, async (req, res) => {
  const m = (req as Request & { member: { id: string; email: string; name: string; role: string; enabled: boolean } }).member;
  res.json({
    member: { id: m.id, email: m.email, name: m.name, role: m.role, enabled: m.enabled },
  });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email y contraseña requeridos" });
    return;
  }
  const member = await prisma.teamMember.findUnique({ where: { email: parsed.data.email } });
  // Generic error — do not reveal whether the email exists
  if (!member || !(await bcrypt.compare(parsed.data.password, member.password))) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }
  if (!member.enabled) {
    res.status(403).json({ error: "Tu cuenta está deshabilitada. Consultá a un administrador." });
    return;
  }
  const token = jwt.sign({ memberId: member.id }, JWT_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
  res.json({
    token,
    member: {
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      enabled: member.enabled,
    },
  });
});

// NOTE: Self-service registration is disabled. User creation flows through
// the admin-only POST /api/team endpoint. A bootstrap admin can be created
// via the seed script when no users exist.
authRouter.post("/register", (_req, res) => {
  res.status(403).json({
    error: "El registro público está deshabilitado. Contactá a un administrador.",
  });
});
