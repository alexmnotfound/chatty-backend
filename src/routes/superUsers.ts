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
