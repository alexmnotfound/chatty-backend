import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { prisma } from "../lib/prisma.js";
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
    const roles = await prisma.aiRole.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: {
        examples: { orderBy: { createdAt: "asc" } },
        knowledgeFiles: { orderBy: { createdAt: "desc" } },
      },
    });
    res.json(roles);
    return;
  }

  const roles = await prisma.aiRole.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: { id: true, key: true, name: true },
  });
  res.json(roles);
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
  const existing = await prisma.aiRole.findFirst({ where: { id, companyId } });
  if (!existing) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }
  const updated = await prisma.aiRole.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.systemPrompt !== undefined ? { systemPrompt: parsed.data.systemPrompt } : {}),
    },
    include: {
      examples: { orderBy: { createdAt: "asc" } },
      knowledgeFiles: { orderBy: { createdAt: "desc" } },
    },
  });
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
  const role = await prisma.aiRole.findFirst({
    where: { id: req.params.id, companyId },
    include: { examples: true },
  });
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }
  if (role.examples.length >= 3) {
    res.status(400).json({ error: "Cada bot permite hasta 3 conversaciones de ejemplo" });
    return;
  }
  const created = await prisma.aiRoleExample.create({
    data: {
      aiRoleId: role.id,
      title: parsed.data.title.trim(),
      content: parsed.data.content.trim(),
    },
  });
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
  const role = await prisma.aiRole.findFirst({ where: { id: req.params.id, companyId } });
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }
  const existing = await prisma.aiRoleExample.findFirst({
    where: { id: req.params.exampleId, aiRoleId: role.id },
  });
  if (!existing) {
    res.status(404).json({ error: "Ejemplo no encontrado" });
    return;
  }
  const updated = await prisma.aiRoleExample.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
      ...(parsed.data.content !== undefined ? { content: parsed.data.content.trim() } : {}),
    },
  });
  res.json(updated);
});

aiRolesRouter.delete("/:id/examples/:exampleId", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  // Verify the role belongs to this company
  const role = await prisma.aiRole.findFirst({ where: { id: req.params.id, companyId } });
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }
  const existing = await prisma.aiRoleExample.findFirst({
    where: { id: req.params.exampleId, aiRoleId: role.id },
  });
  if (!existing) {
    res.status(404).json({ error: "Ejemplo no encontrado" });
    return;
  }
  await prisma.aiRoleExample.delete({ where: { id: existing.id } });
  res.status(204).send();
});

aiRolesRouter.post("/:id/knowledge-files", requireRole("admin"), uploadPdf.single("file"), async (req, res) => {
  const companyId = getCompanyId(req);
  const role = await prisma.aiRole.findFirst({ where: { id: req.params.id, companyId } });
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
  const created = await prisma.aiRoleKnowledgeFile.create({
    data: {
      aiRoleId: role.id,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
  });
  res.status(201).json(created);
});

aiRolesRouter.delete("/:id/knowledge-files/:fileId", requireRole("admin"), async (req, res) => {
  const companyId = getCompanyId(req);
  // Verify the role belongs to this company
  const role = await prisma.aiRole.findFirst({ where: { id: req.params.id, companyId } });
  if (!role) {
    res.status(404).json({ error: "Rol de IA no encontrado" });
    return;
  }
  const file = await prisma.aiRoleKnowledgeFile.findFirst({
    where: { id: req.params.fileId, aiRoleId: role.id },
  });
  if (!file) {
    res.status(404).json({ error: "Archivo no encontrado" });
    return;
  }
  await prisma.aiRoleKnowledgeFile.delete({ where: { id: file.id } });
  const absolute = path.resolve(uploadDir, file.storedName);
  fs.unlink(absolute, () => undefined);
  res.status(204).send();
});
