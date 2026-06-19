import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireSuperAuth } from "../middleware/superAuth.js";

export const superPluginsRouter = Router();
superPluginsRouter.use(requireSuperAuth);

superPluginsRouter.get("/", async (_req, res) => {
  try {
    const { data: plugins, error } = await supabase
      .from("plugins")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const result = await Promise.all(
      (plugins ?? []).map(async (p: any) => {
        const { count } = await supabase
          .from("company_plugins")
          .select("id", { count: "exact", head: true })
          .eq("plugin_id", p.id);
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          icon: p.icon,
          price_usd: p.price_usd,
          active: p.active,
          createdAt: p.created_at,
          companiesCount: count ?? 0,
        };
      })
    );
    res.json(result);
  } catch (error) {
    console.error("[super/plugins GET error]", error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const pluginSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  description: z.string().max(500).optional(),
  icon: z.string().max(200).optional(),
  price_usd: z.number().min(0),
  active: z.boolean().optional(),
});

superPluginsRouter.post("/", async (req, res) => {
  try {
    const parsed = pluginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { data: existing } = await supabase
      .from("plugins")
      .select("id")
      .eq("slug", parsed.data.slug)
      .maybeSingle();
    if (existing) {
      res.status(400).json({ error: "Ya existe un plugin con ese slug" });
      return;
    }
    const { data, error } = await supabase
      .from("plugins")
      .insert({ ...parsed.data, active: parsed.data.active ?? true })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ ...data, createdAt: data.created_at, companiesCount: 0 });
  } catch (error) {
    console.error("[super/plugins POST error]", error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const patchPluginSchema = pluginSchema.partial();

superPluginsRouter.patch("/:id", async (req, res) => {
  try {
    const parsed = patchPluginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Nada que actualizar" });
      return;
    }
    if (parsed.data.slug) {
      const { data: existing } = await supabase
        .from("plugins")
        .select("id")
        .eq("slug", parsed.data.slug)
        .neq("id", req.params.id)
        .maybeSingle();
      if (existing) {
        res.status(400).json({ error: "Ya existe un plugin con ese slug" });
        return;
      }
    }
    const { data, error } = await supabase
      .from("plugins")
      .update(parsed.data)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: "Error interno del servidor" });
      return;
    }
    if (!data) {
      res.status(404).json({ error: "Plugin no encontrado" });
      return;
    }
    res.json({ ...data, createdAt: data.created_at, companiesCount: 0 });
  } catch (error) {
    console.error("[super/plugins PATCH error]", error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

superPluginsRouter.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("plugins").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    console.error("[super/plugins DELETE error]", error instanceof Error ? error.message : String(error));
    res.status(500).json({ error: "Error interno del servidor" });
  }
});
