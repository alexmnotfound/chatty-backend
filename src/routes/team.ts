import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { MemberRole } from "../lib/roles.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { prisma } from "../lib/prisma.js";
import { getCompanyId } from "../middleware/tenant.js";

export const teamRouter = Router();
teamRouter.use(requireAuth);

teamRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const members = await prisma.teamMember.findMany({
    where: { companyId },
    select: { id: true, name: true, email: true, role: true, enabled: true },
    orderBy: { name: "asc" },
  });
  res.json(members);
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["admin", "agent"]).optional(),
});

teamRouter.post("/", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email, nombre y contraseña (mín. 6) requeridos" });
    return;
  }
  const existing = await prisma.teamMember.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    res.status(400).json({ error: "Ya existe un usuario con ese email" });
    return;
  }
  const hash = await bcrypt.hash(parsed.data.password, 10);
  const role: MemberRole = parsed.data.role === "admin" ? "admin" : "agent";
  const member = await prisma.teamMember.create({
    data: {
      companyId,
      email: parsed.data.email,
      password: hash,
      name: parsed.data.name,
      role,
    },
    select: { id: true, name: true, email: true, role: true, enabled: true },
  });
  res.status(201).json(member);
});

const patchSchema = z.object({
  role: z.enum(["admin", "agent"]).optional(),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

teamRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const { id } = req.params;
  const self = (req as Request & { member: { id: string } }).member;
  const target = await prisma.teamMember.findFirst({ where: { id, companyId } });
  if (!target) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  if (parsed.data.enabled === false && id === self.id) {
    res.status(400).json({ error: "No podés deshabilitarte a vos mismo" });
    return;
  }
  if (parsed.data.enabled === false && target.role === "admin") {
    const otherEnabledAdmins = await prisma.teamMember.count({
      where: { companyId, role: "admin", enabled: true, id: { not: id } },
    });
    if (otherEnabledAdmins < 1) {
      res.status(400).json({ error: "Tiene que haber al menos un administrador habilitado" });
      return;
    }
  }
  if (parsed.data.role === "agent" && target.role === "admin") {
    const admins = await prisma.teamMember.count({ where: { companyId, role: "admin" } });
    if (admins <= 1) {
      res.status(400).json({ error: "Tiene que haber al menos un administrador" });
      return;
    }
  }
  const data: { role?: MemberRole; name?: string; enabled?: boolean } = {};
  if (parsed.data.role !== undefined) {
    data.role = parsed.data.role === "admin" ? "admin" : "agent";
  }
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }
  const updated = await prisma.teamMember.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, enabled: true },
  });
  res.json(updated);
});

teamRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const { id } = req.params;
  const self = (req as Request & { member: { id: string } }).member;
  if (id === self.id) {
    res.status(400).json({ error: "No podés eliminarte a vos mismo" });
    return;
  }
  const target = await prisma.teamMember.findFirst({ where: { id, companyId } });
  if (!target) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  if (target.role === "admin") {
    const admins = await prisma.teamMember.count({ where: { companyId, role: "admin" } });
    if (admins <= 1) {
      res.status(400).json({ error: "Tiene que haber al menos un administrador" });
      return;
    }
  }
  await prisma.teamMember.delete({ where: { id } });
  res.status(204).send();
});
