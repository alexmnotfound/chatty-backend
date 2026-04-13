import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireSuperAuth } from "../middleware/superAuth.js";

export const superCompaniesRouter = Router();
superCompaniesRouter.use(requireSuperAuth);

superCompaniesRouter.get("/", async (_req, res) => {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { teamMembers: true, conversations: true } },
      config: {
        select: { whatsappPhoneNumberId: true },
      },
    },
  });
  const result = companies.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    enabled: c.enabled,
    createdAt: c.createdAt,
    teamMemberCount: c._count.teamMembers,
    conversationCount: c._count.conversations,
    whatsappPhoneNumberId: c.config?.whatsappPhoneNumberId ?? null,
  }));
  res.json(result);
});

superCompaniesRouter.get("/:id", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: {
      config: { select: { whatsappPhoneNumberId: true } },
      _count: { select: { teamMembers: true, conversations: true, aiRoles: true, tasks: true } },
    },
  });
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }
  const cfg = await prisma.companyConfig.findUnique({ where: { companyId: company.id } });
  res.json({
    ...company,
    hasWhatsAppAccessToken: Boolean(cfg?.whatsappAccessToken),
    hasWhatsAppAppSecret: Boolean(cfg?.whatsappAppSecret),
    hasOpenAiApiKey: Boolean(cfg?.openAiApiKey),
  });
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones"),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(6),
  adminName: z.string().min(1),
});

superCompaniesRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, slug, adminEmail, adminPassword, adminName } = parsed.data;

  const existingSlug = await prisma.company.findUnique({ where: { slug } });
  if (existingSlug) {
    res.status(400).json({ error: "Ya existe una empresa con ese slug" });
    return;
  }
  const existingEmail = await prisma.teamMember.findUnique({ where: { email: adminEmail } });
  if (existingEmail) {
    res.status(400).json({ error: "Ya existe un usuario con ese email" });
    return;
  }

  const hash = await bcrypt.hash(adminPassword, 10);

  const company = await prisma.company.create({
    data: {
      name,
      slug,
      config: { create: {} },
      teamMembers: {
        create: {
          email: adminEmail,
          password: hash,
          name: adminName,
          role: "admin",
        },
      },
    },
    include: {
      teamMembers: { select: { id: true, email: true, name: true, role: true } },
    },
  });

  // Seed default AI roles for the new company
  await prisma.aiRole.createMany({
    data: [
      {
        companyId: company.id,
        key: "receptionist",
        name: "Recepcionista",
        systemPrompt: "Eres una recepcionista amable y profesional. Saludá, respondé consultas básicas y derivá a un humano cuando sea necesario. Responde siempre en español, breve y claro.",
      },
      {
        companyId: company.id,
        key: "seller",
        name: "Vendedor",
        systemPrompt: "Eres un vendedor profesional y cercano. Preguntá qué necesita el cliente, recomendá productos o servicios y cerrá citas o pedidos cuando sea posible. Responde en español, breve y orientado a la venta.",
      },
    ],
  });

  res.status(201).json(company);
});

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

superCompaniesRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }
  const company = await prisma.company.update({
    where: { id: req.params.id },
    data,
  });
  res.json(company);
});
