export async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const lookupRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!lookupRes.ok) {
    throw new Error(`Failed to look up WhatsApp media ${mediaId}: ${lookupRes.status}`);
  }
  const { url, mime_type } = (await lookupRes.json()) as { url: string; mime_type: string };

  const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileRes.ok) {
    throw new Error(`Failed to download WhatsApp media ${mediaId}: ${fileRes.status}`);
  }
  const arrayBuffer = await fileRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: mime_type };
}
