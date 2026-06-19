import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireSuperAuth } from "../middleware/superAuth.js";

export const superUsersRouter = Router();
superUsersRouter.use(requireSuperAuth);

superUsersRouter.get("/", async (_req, res) => {
  const { data: members, error } = await supabase
    .from("company_members")
    .select("id, user_id, company_id, email, name, role, enabled, created_at, companies(id, name, slug)")
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.json(members ?? []);
});

const patchSchema = z.object({
  role: z.enum(["admin", "agent"]).optional(),
  enabled: z.boolean().optional(),
});

superUsersRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }
  const { data, error } = await supabase
    .from("company_members")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.json(data);
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(6),
  companyId: z.string().uuid(),
  role: z.enum(["admin", "agent"]).default("agent"),
});

superUsersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { email, name, password, companyId, role } = parsed.data;

  const { data: company } = await supabase.from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (authError || !authUser?.user) {
    res.status(400).json({ error: "Error al crear usuario" });
    return;
  }

  const { data: member, error: memberError } = await supabase
    .from("company_members")
    .insert({ company_id: companyId, user_id: authUser.user.id, email, name, role, enabled: true })
    .select("id, user_id, company_id, email, name, role, enabled, created_at, companies(id, name, slug)")
    .single();
  if (memberError || !member) {
    await supabase.auth.admin.deleteUser(authUser.user.id);
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.status(201).json(member);
});

superUsersRouter.post("/:id/recovery", async (req, res) => {
  const { data: member } = await supabase
    .from("company_members").select("user_id, email").eq("id", req.params.id).maybeSingle();
  if (!member) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: member.email,
  });
  if (error || !data?.properties?.action_link) {
    res.status(500).json({ error: "Error al generar link de recuperación" });
    return;
  }
  res.json({ link: data.properties.action_link });
});
