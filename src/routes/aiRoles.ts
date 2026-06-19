import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { supabase } from "../lib/supabase.js";
import { getCompanyId } from "../middleware/tenant.js";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

export const aiRolesRouter = Router();
aiRolesRouter.use(requireAuth);

const uploadDir = path.resolve(process.cwd(), "uploads", "knowledge-base");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safe}`);
  },
});

const uploadPdf = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    // Require BOTH correct MIME type AND .pdf extension
    const isPdfMime = file.mimetype === "application/pdf";
    const isPdfExt = file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdfMime || !isPdfExt) {
      cb(new Error("Solo se permiten archivos PDF"));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Verify PDF magic bytes after multer saves the file. Throws if invalid.
function verifyPdfMagicBytes(filePath: string): boolean {
  const buf = Buffer.allocUnsafe(4);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buf, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf.toString("ascii") === "%PDF";
}

aiRolesRouter.get("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as Request & { member: { role: string } }).member;
  const isAdmin = member.role === "admin";

  if (isAdmin) {
    const { data: roles, error } = await supabase
      .from("ai_roles")
      .select(`
        *,
        examples:ai_role_examples(*),
        knowledgeFiles:ai_role_knowledge_files(*)
      `)
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) {
      res.status(500).json({ error: "Error interno del servidor" });
      return;
    }
    // Sort examples asc, knowledgeFiles desc
    (roles ?? []).forEach((r: any) => {
      if (r.examples) r.examples.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      if (r.knowledgeFiles) r.knowledgeFiles.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    });
    res.json(roles ?? []);
    return;
  }

  const { data: roles, error } = await supabase
    .from("ai_roles")
    .select("id, key, name")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.json(roles ?? []);
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
});

aiRolesRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nombre o reglas (instrucciones) inválidos" });
    return;
  }
  if (parsed.data.name === undefined && parsed.data.systemPrompt === undefined) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }
  const { id } = req.params;
  const { data: existing } = await supabase
    .from("ai_roles")
    .select("id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.systemPrompt !== undefined) updateData.system_prompt = parsed.data.systemPrompt;

  const { error } = await supabase.from("ai_roles").update(updateData).eq("id", existing.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  const { data: updated } = await supabase
    .from("ai_roles")
    .select(`*, examples:ai_role_examples(*), knowledgeFiles:ai_role_knowledge_files(*)`)
    .eq("id", existing.id)
    .single();
  if (updated?.examples) updated.examples.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (updated?.knowledgeFiles) updated.knowledgeFiles.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  res.json(updated);
});

const exampleSchema = z.object({
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(6000),
});

aiRolesRouter.post("/:id/examples", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = exampleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ejemplo inválido" });
    return;
  }

  const { data: role } = await supabase
    .from("ai_roles")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }

  const { count } = await supabase
    .from("ai_role_examples")
    .select("id", { count: "exact", head: true })
    .eq("ai_role_id", role.id);
  if ((count ?? 0) >= 3) {
    res.status(400).json({ error: "Cada bot permite hasta 3 conversaciones de ejemplo" });
    return;
  }

  const { data: created, error } = await supabase
    .from("ai_role_examples")
    .insert({
      ai_role_id: role.id,
      title: parsed.data.title.trim(),
      content: parsed.data.content.trim(),
    })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.status(201).json(created);
});

const updateExampleSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  content: z.string().min(1).max(6000).optional(),
});

aiRolesRouter.patch("/:id/examples/:exampleId", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = updateExampleSchema.safeParse(req.body);
  if (!parsed.success || (parsed.data.title === undefined && parsed.data.content === undefined)) {
    res.status(400).json({ error: "Actualización de ejemplo inválida" });
    return;
  }

  // Verify the role belongs to this company
  const { data: role } = await supabase
    .from("ai_roles")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }

  const { data: existing } = await supabase
    .from("ai_role_examples")
    .select("id")
    .eq("id", req.params.exampleId)
    .eq("ai_role_id", role.id)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: "Ejemplo no encontrado" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title.trim();
  if (parsed.data.content !== undefined) updateData.content = parsed.data.content.trim();

  const { data: updated, error } = await supabase
    .from("ai_role_examples")
    .update(updateData)
    .eq("id", existing.id)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.json(updated);
});

aiRolesRouter.delete("/:id/examples/:exampleId", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);

  // Verify the role belongs to this company
  const { data: role } = await supabase
    .from("ai_roles")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }

  const { data: existing } = await supabase
    .from("ai_role_examples")
    .select("id")
    .eq("id", req.params.exampleId)
    .eq("ai_role_id", role.id)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ error: "Ejemplo no encontrado" });
    return;
  }

  const { error } = await supabase.from("ai_role_examples").delete().eq("id", existing.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.status(204).send();
});

aiRolesRouter.post("/:id/knowledge-files", requireRole("admin"), uploadPdf.single("file"), async (req, res) => {
  const companyId = getCompanyId(req);
  const { data: role } = await supabase
    .from("ai_roles")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!role) {
    if (req.file?.path) fs.unlink(req.file.path, () => undefined);
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Archivo PDF requerido" });
    return;
  }
  if (!verifyPdfMagicBytes(req.file.path)) {
    fs.unlink(req.file.path, () => undefined);
    res.status(400).json({ error: "El archivo no es un PDF válido" });
    return;
  }

  const { data: created, error } = await supabase
    .from("ai_role_knowledge_files")
    .insert({
      ai_role_id: role.id,
      original_name: req.file.originalname,
      stored_name: req.file.filename,
      mime_type: req.file.mimetype,
      size: req.file.size,
    })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.status(201).json(created);
});

aiRolesRouter.delete("/:id/knowledge-files/:fileId", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);

  // Verify the role belongs to this company
  const { data: role } = await supabase
    .from("ai_roles")
    .select("id")
    .eq("id", req.params.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }

  const { data: file } = await supabase
    .from("ai_role_knowledge_files")
    .select("*")
    .eq("id", req.params.fileId)
    .eq("ai_role_id", role.id)
    .maybeSingle();
  if (!file) {
    res.status(404).json({ error: "Archivo no encontrado" });
    return;
  }

  const { error } = await supabase.from("ai_role_knowledge_files").delete().eq("id", file.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  const absolute = path.resolve(uploadDir, file.stored_name);
  fs.unlink(absolute, () => undefined);
  res.status(204).send();
});
