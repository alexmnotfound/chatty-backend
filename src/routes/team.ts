import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { MemberRole } from "../lib/roles.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { supabase } from "../lib/supabase.js";
import { getCompanyId } from "../middleware/tenant.js";

export const teamRouter = Router();
teamRouter.use(requireAuth);

teamRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const { data: members, error } = await supabase
    .from("company_members")
    .select("id, name, email, role, enabled")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
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

  // Check for existing email in company_members
  const { data: existing } = await supabase
    .from("company_members")
    .select("id")
    .eq("email", parsed.data.email)
    .maybeSingle();
  if (existing) {
    res.status(400).json({ error: "Ya existe un usuario con ese email" });
    return;
  }

  const hash = await bcrypt.hash(parsed.data.password, 10);
  const role: MemberRole = parsed.data.role === "admin" ? "admin" : "agent";

  const { data: member, error } = await supabase
    .from("company_members")
    .insert({
      company_id: companyId,
      email: parsed.data.email,
      password: hash,
      name: parsed.data.name,
      role,
    })
    .select("id, name, email, role, enabled")
    .single();
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
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

  const { data: target } = await supabase
    .from("company_members")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!target) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  if (parsed.data.enabled === false && id === self.id) {
    res.status(400).json({ error: "No podés deshabilitarte a vos mismo" });
    return;
  }
  if (parsed.data.enabled === false && target.role === "admin") {
    const { count } = await supabase
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", "admin")
      .eq("enabled", true)
      .neq("id", id);
    if ((count ?? 0) < 1) {
      res.status(400).json({ error: "Tiene que haber al menos un administrador habilitado" });
      return;
    }
  }
  if (parsed.data.role === "agent" && target.role === "admin") {
    const { count } = await supabase
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      res.status(400).json({ error: "Tiene que haber al menos un administrador" });
      return;
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.role !== undefined) data.role = parsed.data.role === "admin" ? "admin" : "agent";
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }

  const { data: updated, error } = await supabase
    .from("company_members")
    .update(data)
    .eq("id", id)
    .select("id, name, email, role, enabled")
    .single();
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
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

  const { data: target } = await supabase
    .from("company_members")
    .select("*")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!target) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  if (target.role === "admin") {
    const { count } = await supabase
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      res.status(400).json({ error: "Tiene que haber al menos un administrador" });
      return;
    }
  }

  const { error } = await supabase.from("company_members").delete().eq("id", id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.status(204).send();
});
