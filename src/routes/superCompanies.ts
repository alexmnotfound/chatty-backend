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
    id: company.id,
    name: company.name,
    slug: company.slug,
    enabled: company.enabled,
    createdAt: company.createdAt,
    whatsappPhoneNumberId: company.config?.whatsappPhoneNumberId ?? null,
    teamMemberCount: company._count.teamMembers,
    conversationCount: company._count.conversations,
    aiRoleCount: company._count.aiRoles,
    taskCount: company._count.tasks,
    hasWhatsAppAccessToken: Boolean(cfg?.whatsappAccessToken),
    hasWhatsAppAppSecret: Boolean(cfg?.whatsappAppSecret),
    hasOpenAiApiKey: Boolean(cfg?.openAiApiKey),
  });
});

superCompaniesRouter.get("/:id/team", async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }
  const members = await prisma.teamMember.findMany({
    where: { companyId: company.id },
    select: { id: true, name: true, email: true, role: true, enabled: true },
    orderBy: { name: "asc" },
  });
  res.json(members);
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
  const [receptionistRole, sellerRole] = await Promise.all([
    prisma.aiRole.create({
      data: {
        companyId: company.id,
        key: "receptionist",
        name: "Recepcionista",
        systemPrompt: "Eres una recepcionista amable y profesional. Saludá, respondé consultas básicas y derivá a un humano cuando sea necesario. Responde siempre en español, breve y claro.",
      },
    }),
    prisma.aiRole.create({
      data: {
        companyId: company.id,
        key: "seller",
        name: "Vendedor",
        systemPrompt: "Eres un vendedor profesional y cercano. Preguntá qué necesita el cliente, recomendá productos o servicios y cerrá citas o pedidos cuando sea posible. Responde en español, breve y orientado a la venta.",
      },
    }),
  ]);

  // Seed example conversations for each bot
  const demoContacts = await Promise.all([
    prisma.contact.create({
      data: { companyId: company.id, waId: "5491100000001", name: "María (ejemplo)" },
    }),
    prisma.contact.create({
      data: { companyId: company.id, waId: "5491100000002", name: "Carlos (ejemplo)" },
    }),
  ]);

  const demoConversations = await Promise.all([
    prisma.conversation.create({
      data: {
        companyId: company.id,
        contactId: demoContacts[0].id,
        status: "ai",
        aiRoleId: receptionistRole.id,
      },
    }),
    prisma.conversation.create({
      data: {
        companyId: company.id,
        contactId: demoContacts[1].id,
        status: "ai",
        aiRoleId: sellerRole.id,
      },
    }),
  ]);

  // Example messages for Recepcionista conversation
  const now = new Date();
  await prisma.message.createMany({
    data: [
      {
        conversationId: demoConversations[0].id,
        direction: "in",
        body: "Hola, buenas tardes! Quería saber el horario de atención.",
        createdAt: new Date(now.getTime() - 4 * 60000),
      },
      {
        conversationId: demoConversations[0].id,
        direction: "out",
        body: "¡Hola María! Bienvenida 😊 Nuestro horario de atención es de lunes a viernes de 9 a 18 hs. ¿Hay algo más en lo que pueda ayudarte?",
        fromAi: true,
        createdAt: new Date(now.getTime() - 3 * 60000),
      },
      {
        conversationId: demoConversations[0].id,
        direction: "in",
        body: "Sí, necesito hablar con alguien de ventas por un presupuesto.",
        createdAt: new Date(now.getTime() - 2 * 60000),
      },
      {
        conversationId: demoConversations[0].id,
        direction: "out",
        body: "¡Por supuesto! Te paso con nuestro equipo de ventas para que te ayuden con el presupuesto. Un momento, por favor.",
        fromAi: true,
        createdAt: new Date(now.getTime() - 1 * 60000),
      },
    ],
  });

  // Example messages for Vendedor conversation
  await prisma.message.createMany({
    data: [
      {
        conversationId: demoConversations[1].id,
        direction: "in",
        body: "Hola! Estoy buscando información sobre sus servicios.",
        createdAt: new Date(now.getTime() - 5 * 60000),
      },
      {
        conversationId: demoConversations[1].id,
        direction: "out",
        body: "¡Hola Carlos! Qué gusto saludarte. Contame, ¿qué tipo de servicio estás necesitando? Así te puedo orientar mejor.",
        fromAi: true,
        createdAt: new Date(now.getTime() - 4 * 60000),
      },
      {
        conversationId: demoConversations[1].id,
        direction: "in",
        body: "Necesito el plan premium para mi empresa, somos 15 personas.",
        createdAt: new Date(now.getTime() - 3 * 60000),
      },
      {
        conversationId: demoConversations[1].id,
        direction: "out",
        body: "¡Excelente! El plan premium es ideal para equipos de ese tamaño. Incluye soporte prioritario y funcionalidades avanzadas. ¿Te gustaría que agendemos una llamada para revisar los detalles y un precio especial para tu empresa?",
        fromAi: true,
        createdAt: new Date(now.getTime() - 2 * 60000),
      },
      {
        conversationId: demoConversations[1].id,
        direction: "in",
        body: "Dale, sí, el jueves a la mañana me viene bien.",
        createdAt: new Date(now.getTime() - 1 * 60000),
      },
      {
        conversationId: demoConversations[1].id,
        direction: "out",
        body: "¡Perfecto! Te agendo para el jueves a las 10 hs. Te voy a enviar un recordatorio el día anterior. ¡Gracias por tu interés, Carlos!",
        fromAi: true,
        createdAt: new Date(now.getTime()),
      },
    ],
  });

  res.status(201).json(company);
});

superCompaniesRouter.get("/:id/bots", async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }
  try {
    const bots = await prisma.bot.findMany({
      where: { companyId: req.params.id },
      select: { id: true, name: true, active: true, aiProvider: true, aiModel: true, whatsappPhoneNumberId: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(bots);
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

superCompaniesRouter.patch("/:id/bots/:botId/active", async (req, res) => {
  const { active } = req.body as { active: unknown };
  if (typeof active !== "boolean") {
    res.status(400).json({ error: "active debe ser un booleano" });
    return;
  }
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }
  try {
    await prisma.bot.update({ where: { id: req.params.botId }, data: { active } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
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
