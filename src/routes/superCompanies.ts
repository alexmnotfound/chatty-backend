import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireSuperAuth } from "../middleware/superAuth.js";

export const superCompaniesRouter = Router();
superCompaniesRouter.use(requireSuperAuth);

superCompaniesRouter.get("/", async (_req, res) => {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, slug, active, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  // Fetch counts and configs separately
  const result = await Promise.all(
    (companies ?? []).map(async (c: any) => {
      const [{ count: teamMemberCount }, { count: conversationCount }, { data: cfg }] = await Promise.all([
        supabase.from("company_members").select("id", { count: "exact", head: true }).eq("company_id", c.id),
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("company_id", c.id),
        supabase.from("company_config").select("whatsapp_phone_number_id").eq("company_id", c.id).maybeSingle(),
      ]);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        active: c.active,
        createdAt: c.created_at,
        teamMemberCount: teamMemberCount ?? 0,
        conversationCount: conversationCount ?? 0,
        whatsappPhoneNumberId: cfg?.whatsapp_phone_number_id ?? null,
      };
    })
  );
  res.json(result);
});

superCompaniesRouter.get("/:id", async (req, res) => {
  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }

  const [
    { count: teamMemberCount },
    { count: conversationCount },
    { count: aiRoleCount },
    { count: taskCount },
    { data: cfg },
  ] = await Promise.all([
    supabase.from("company_members").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("ai_roles").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    supabase.from("company_config").select("*").eq("company_id", company.id).maybeSingle(),
  ]);

  res.json({
    id: company.id,
    name: company.name,
    slug: company.slug,
    active: company.active,
    createdAt: company.created_at,
    whatsappPhoneNumberId: cfg?.whatsapp_phone_number_id ?? null,
    teamMemberCount: teamMemberCount ?? 0,
    conversationCount: conversationCount ?? 0,
    aiRoleCount: aiRoleCount ?? 0,
    taskCount: taskCount ?? 0,
    hasWhatsAppAccessToken: Boolean(cfg?.whatsapp_access_token),
    hasWhatsAppAppSecret: Boolean(cfg?.whatsapp_app_secret),
    hasOpenAiApiKey: Boolean(cfg?.open_ai_api_key),
  });
});

superCompaniesRouter.get("/:id/team", async (req, res) => {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }
  const { data: members, error } = await supabase
    .from("company_members")
    .select("id, name, email, role, enabled")
    .eq("company_id", company.id)
    .order("name", { ascending: true });
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.json(members ?? []);
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

  const { data: existingSlug } = await supabase
    .from("companies")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existingSlug) {
    res.status(400).json({ error: "Ya existe una empresa con ese slug" });
    return;
  }
  const { data: existingEmail } = await supabase
    .from("company_members")
    .select("id")
    .eq("email", adminEmail)
    .maybeSingle();
  if (existingEmail) {
    res.status(400).json({ error: "Ya existe un usuario con ese email" });
    return;
  }

  // Create company
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({ name, slug, active: true })
    .select()
    .single();
  if (companyError || !company) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }

  // Create company_config
  await supabase.from("company_config").insert({ company_id: company.id });

  // Create Supabase auth user + company_member
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { name: adminName },
  });
  if (authError || !authUser?.user) {
    await supabase.from("companies").delete().eq("id", company.id);
    res.status(500).json({ error: "Error al crear usuario" });
    return;
  }

  const { data: adminMember } = await supabase
    .from("company_members")
    .insert({
      company_id: company.id,
      user_id: authUser.user.id,
      email: adminEmail,
      name: adminName,
      role: "admin",
    })
    .select("id, email, name, role")
    .single();

  // Seed default AI roles
  const [receptionistRole, sellerRole] = await Promise.all([
    supabase.from("ai_roles").insert({
      company_id: company.id,
      key: "receptionist",
      name: "Recepcionista",
      system_prompt: "Eres una recepcionista amable y profesional. Saludá, respondé consultas básicas y derivá a un humano cuando sea necesario. Responde siempre en español, breve y claro.",
    }).select().single(),
    supabase.from("ai_roles").insert({
      company_id: company.id,
      key: "seller",
      name: "Vendedor",
      system_prompt: "Eres un vendedor profesional y cercano. Preguntá qué necesita el cliente, recomendá productos o servicios y cerrá citas o pedidos cuando sea posible. Responde en español, breve y orientado a la venta.",
    }).select().single(),
  ]);

  // Seed demo contacts
  const [contact1Res, contact2Res] = await Promise.all([
    supabase.from("contacts").insert({ company_id: company.id, wa_id: "5491100000001", name: "María (ejemplo)" }).select().single(),
    supabase.from("contacts").insert({ company_id: company.id, wa_id: "5491100000002", name: "Carlos (ejemplo)" }).select().single(),
  ]);
  const demoContacts = [contact1Res.data, contact2Res.data];

  // Seed demo conversations
  const [conv1Res, conv2Res] = await Promise.all([
    supabase.from("conversations").insert({
      company_id: company.id,
      contact_id: demoContacts[0]?.id,
      status: "ai",
      ai_role_id: receptionistRole.data?.id,
    }).select().single(),
    supabase.from("conversations").insert({
      company_id: company.id,
      contact_id: demoContacts[1]?.id,
      status: "ai",
      ai_role_id: sellerRole.data?.id,
    }).select().single(),
  ]);
  const demoConversations = [conv1Res.data, conv2Res.data];

  // Example messages for Recepcionista
  const now = new Date();
  await supabase.from("messages").insert([
    {
      conversation_id: demoConversations[0]?.id,
      direction: "in",
      body: "Hola, buenas tardes! Quería saber el horario de atención.",
      created_at: new Date(now.getTime() - 4 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[0]?.id,
      direction: "out",
      body: "¡Hola María! Bienvenida 😊 Nuestro horario de atención es de lunes a viernes de 9 a 18 hs. ¿Hay algo más en lo que pueda ayudarte?",
      from_ai: true,
      created_at: new Date(now.getTime() - 3 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[0]?.id,
      direction: "in",
      body: "Sí, necesito hablar con alguien de ventas por un presupuesto.",
      created_at: new Date(now.getTime() - 2 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[0]?.id,
      direction: "out",
      body: "¡Por supuesto! Te paso con nuestro equipo de ventas para que te ayuden con el presupuesto. Un momento, por favor.",
      from_ai: true,
      created_at: new Date(now.getTime() - 1 * 60000).toISOString(),
    },
  ]);

  // Example messages for Vendedor
  await supabase.from("messages").insert([
    {
      conversation_id: demoConversations[1]?.id,
      direction: "in",
      body: "Hola! Estoy buscando información sobre sus servicios.",
      created_at: new Date(now.getTime() - 5 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[1]?.id,
      direction: "out",
      body: "¡Hola Carlos! Qué gusto saludarte. Contame, ¿qué tipo de servicio estás necesitando? Así te puedo orientar mejor.",
      from_ai: true,
      created_at: new Date(now.getTime() - 4 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[1]?.id,
      direction: "in",
      body: "Necesito el plan premium para mi empresa, somos 15 personas.",
      created_at: new Date(now.getTime() - 3 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[1]?.id,
      direction: "out",
      body: "¡Excelente! El plan premium es ideal para equipos de ese tamaño. Incluye soporte prioritario y funcionalidades avanzadas. ¿Te gustaría que agendemos una llamada para revisar los detalles y un precio especial para tu empresa?",
      from_ai: true,
      created_at: new Date(now.getTime() - 2 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[1]?.id,
      direction: "in",
      body: "Dale, sí, el jueves a la mañana me viene bien.",
      created_at: new Date(now.getTime() - 1 * 60000).toISOString(),
    },
    {
      conversation_id: demoConversations[1]?.id,
      direction: "out",
      body: "¡Perfecto! Te agendo para el jueves a las 10 hs. Te voy a enviar un recordatorio el día anterior. ¡Gracias por tu interés, Carlos!",
      from_ai: true,
      created_at: new Date(now.getTime()).toISOString(),
    },
  ]);

  res.status(201).json({ ...company, teamMembers: adminMember ? [adminMember] : [] });
});

superCompaniesRouter.get("/:id/bots", async (req, res) => {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }
  try {
    const { data: bots, error } = await supabase
      .from("bots")
      .select("id, name, active, ai_provider, ai_model, whatsapp_phone_number_id")
      .eq("company_id", req.params.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(bots ?? []);
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
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("id", req.params.id)
    .maybeSingle();
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }
  try {
    const { error } = await supabase
      .from("bots")
      .update({ active })
      .eq("id", req.params.botId);
    if (error) throw error;
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
});

superCompaniesRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }
  try {
    const { data: company, error } = await supabase
      .from("companies")
      .update(data)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(company);
  } catch {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const addMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(6).optional(),
  role: z.enum(["admin", "agent"]).default("agent"),
});

superCompaniesRouter.post("/:id/team", async (req, res) => {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { email, name, password, role } = parsed.data;
  const companyId = req.params.id;

  const { data: company } = await supabase.from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!company) {
    res.status(404).json({ error: "Empresa no encontrada" });
    return;
  }

  let userId: string;
  if (password) {
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (authError || !authUser?.user) {
      res.status(400).json({ error: "Error al crear usuario" });
      return;
    }
    userId = authUser.user.id;
  } else {
    const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) {
      res.status(500).json({ error: "Error interno del servidor" });
      return;
    }
    const existing = users.find(u => u.email === email);
    if (!existing) {
      res.status(404).json({ error: "No existe un usuario con ese email" });
      return;
    }
    userId = existing.id;
  }

  const { data: existingMember } = await supabase
    .from("company_members").select("id").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  if (existingMember) {
    res.status(400).json({ error: "El usuario ya es miembro de esta empresa" });
    return;
  }

  const { data: member, error: memberError } = await supabase
    .from("company_members")
    .insert({ company_id: companyId, user_id: userId, email, name, role, enabled: true })
    .select("id, email, name, role, enabled, created_at")
    .single();
  if (memberError || !member) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.status(201).json(member);
});

const patchMemberSchema = z.object({
  role: z.enum(["admin", "agent"]).optional(),
  enabled: z.boolean().optional(),
});

superCompaniesRouter.patch("/:id/team/:memberId", async (req, res) => {
  const parsed = patchMemberSchema.safeParse(req.body);
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
    .eq("id", req.params.memberId)
    .eq("company_id", req.params.id)
    .select("id, email, name, role, enabled")
    .single();
  if (error || !data) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }
  res.json(data);
});

superCompaniesRouter.delete("/:id/team/:memberId", async (req, res) => {
  const { error } = await supabase
    .from("company_members")
    .delete()
    .eq("id", req.params.memberId)
    .eq("company_id", req.params.id);
  if (error) {
    res.status(500).json({ error: "Error interno del servidor" });
    return;
  }
  res.status(204).send();
});
