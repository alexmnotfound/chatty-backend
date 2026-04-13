import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { prisma } from "../lib/prisma.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

async function ensureConfig() {
  return prisma.appConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}

settingsRouter.get("/", async (req, res) => {
  const member = (req as Request & { member: { role: string } }).member;
  const config = await ensureConfig();

  // Never return plaintext secrets — only presence flags, regardless of role.
  void member;
  res.json({
    whatsappPhoneNumberId: config.whatsappPhoneNumberId ?? "",
    hasWhatsAppAccessToken: Boolean(config.whatsappAccessToken),
    hasOpenAiApiKey: Boolean(config.openAiApiKey),
  });
});

const patchSchema = z.object({
  whatsappPhoneNumberId: z.string().min(1).optional(),
  whatsappAccessToken: z.string().min(1).optional(),
  openAiApiKey: z.string().min(1).optional(),
});

settingsRouter.patch("/", requireRole("admin"), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de configuración inválidos" });
    return;
  }

  const data: Record<string, string> = {};
  if (parsed.data.whatsappPhoneNumberId !== undefined) data.whatsappPhoneNumberId = parsed.data.whatsappPhoneNumberId.trim();
  if (parsed.data.whatsappAccessToken !== undefined) data.whatsappAccessToken = parsed.data.whatsappAccessToken.trim();
  if (parsed.data.openAiApiKey !== undefined) data.openAiApiKey = parsed.data.openAiApiKey.trim();
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nada para actualizar" });
    return;
  }

  const updated = await prisma.appConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  // Do not echo plaintext secrets back after update.
  res.json({
    whatsappPhoneNumberId: updated.whatsappPhoneNumberId ?? "",
    hasWhatsAppAccessToken: Boolean(updated.whatsappAccessToken),
    hasOpenAiApiKey: Boolean(updated.openAiApiKey),
  });
});
