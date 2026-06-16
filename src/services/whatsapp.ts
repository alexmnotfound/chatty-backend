const BASE = "https://graph.facebook.com/v21.0";

export type WhatsAppCredentials = {
  token: string;
  phoneNumberId: string;
};

function buildArgentinaFallbackCandidates(normalized: string): string[] {
  const candidates = new Set<string>();
  if (!(normalized.startsWith("549") && normalized.length === 13)) return [];
  const national = normalized.slice(3);
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
  phoneNumberId: string,
  accessToken: string
): Promise<{ ok: boolean; status: number; err: string }> {
  const res = await fetch(`${BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
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

export async function sendWhatsAppText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<boolean> {
  const normalized = to.replace(/\D/g, "");
  const firstTry = await sendToNumber(normalized, text, phoneNumberId, accessToken);
  if (firstTry.ok) return true;

  let attemptedRecipients = [normalized];
  let lastError = firstTry.err;
  let lastStatus = firstTry.status;
  const errorCode = getMetaErrorCode(firstTry.err);

  if (errorCode === 131030) {
    const fallbackCandidates = buildArgentinaFallbackCandidates(normalized).filter((n) => n !== normalized);
    attemptedRecipients = attemptedRecipients.concat(fallbackCandidates);
    for (const candidate of fallbackCandidates) {
      const result = await sendToNumber(candidate, text, phoneNumberId, accessToken);
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

export async function getWhatsAppCredentials(_companyId: string): Promise<WhatsAppCredentials | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId };
}
