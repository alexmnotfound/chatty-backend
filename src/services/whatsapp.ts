import { prisma } from "../lib/prisma.js";

const BASE = "https://graph.facebook.com/v21.0";

function buildArgentinaFallbackCandidates(normalized: string): string[] {
  const candidates = new Set<string>();
  if (!(normalized.startsWith("549") && normalized.length === 13)) return [];

  const national = normalized.slice(3); // area + subscriber (10 digits)
  for (const areaLen of [2, 3, 4]) {
    const area = national.slice(0, areaLen);
    const subscriber = national.slice(areaLen);
    if (!area || !subscriber) continue;
    candidates.add(`54${area}15${subscriber}`);
  }
  return [...candidates];
}

async function sendToNumber(
  to: string,
  text: string,
  auth: { token: string; phoneNumberId: string }
): Promise<{ ok: boolean; status: number; err: string }> {
  const res = await fetch(`${BASE}/${auth.phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (res.ok) return { ok: true, status: res.status, err: "" };
  return { ok: false, status: res.status, err: await res.text() };
}

function getMetaErrorCode(err: string): number | null {
  try {
    const parsed = JSON.parse(err) as { error?: { code?: number } };
    return parsed.error?.code ?? null;
  } catch {
    return null;
  }
}

export async function sendWhatsAppText(to: string, text: string): Promise<boolean> {
  const config = await prisma.appConfig.findUnique({ where: { id: 1 } });
  const token = config?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = config?.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const auth = token && phoneNumberId ? { token, phoneNumberId } : null;

  if (!auth) {
    console.error("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set");
    return false;
  }

  const normalized = to.replace(/\D/g, "");
  const firstTry = await sendToNumber(normalized, text, auth);
  if (firstTry.ok) return true;

  let attemptedRecipients = [normalized];
  let lastError = firstTry.err;
  let lastStatus = firstTry.status;
  const errorCode = getMetaErrorCode(firstTry.err);

  // Apply heuristic fallbacks only for Meta "recipient not allowed/not matched" error.
  if (errorCode === 131030) {
    const fallbackCandidates = buildArgentinaFallbackCandidates(normalized).filter((n) => n !== normalized);
    attemptedRecipients = attemptedRecipients.concat(fallbackCandidates);

    for (const candidate of fallbackCandidates) {
      const result = await sendToNumber(candidate, text, auth);
      if (result.ok) return true;
      lastError = result.err;
      lastStatus = result.status;
    }
  }

  console.error("WhatsApp send error:", lastStatus, {
    attemptedCount: attemptedRecipients.length,
    err: lastError,
  });
  return false;
}
