import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireSuperAuth } from "../middleware/superAuth.js";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

export const superAdminRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

superAdminRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email y contraseña requeridos" });
    return;
  }
  const admin = await prisma.superAdmin.findUnique({ where: { email: parsed.data.email } });
  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.password))) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }
  if (!admin.enabled) {
    res.status(403).json({ error: "Cuenta deshabilitada" });
    return;
  }
  const token = jwt.sign(
    { superAdminId: admin.id, scope: "super" },
    JWT_SECRET,
    { expiresIn: "7d", algorithm: "HS256" }
  );
  res.json({
    token,
    admin: { id: admin.id, email: admin.email, name: admin.name },
  });
});

superAdminRouter.get("/me", requireSuperAuth, async (req, res) => {
  const admin = (req as any).superAdmin;
  res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
});
