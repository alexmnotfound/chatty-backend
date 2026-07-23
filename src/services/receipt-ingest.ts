import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { downloadWhatsAppMedia } from './media-download.js';
import { extractReceipt } from './receipt-extractor.js';

export async function ingestReceiptMessage(params: {
  mediaId: string;
  messageId: string;
  companyId: string;
  conversationId: string;
  whatsappToken: string;
  anthropicApiKey: string;
}): Promise<{ isReceipt: boolean }> {
  const { mediaId, messageId, companyId, conversationId, whatsappToken, anthropicApiKey } = params;

  let buffer: Buffer;
  let mimeType: string;
  try {
    const downloaded = await downloadWhatsAppMedia(mediaId, whatsappToken);
    buffer = downloaded.buffer;
    mimeType = downloaded.mimeType;
  } catch (err) {
    console.error('[receipt-ingest] Failed to download media', err);
    return { isReceipt: true }; // swallow silently — can't recover without the file, no chat reply either
  }

  const receiptId = randomUUID();
  const ext = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
  const storagePath = `${companyId}/${receiptId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(storagePath, buffer, { contentType: mimeType });
  if (uploadError) {
    console.error('[receipt-ingest] Failed to upload to storage', uploadError);
    return { isReceipt: true };
  }

  let extraction: Awaited<ReturnType<typeof extractReceipt>>;
  try {
    extraction = await extractReceipt(anthropicApiKey, buffer.toString('base64'), mimeType);
  } catch (err) {
    console.error('[receipt-ingest] Extraction failed', err);
    await supabase.from('receipts').insert({
      id: receiptId,
      company_id: companyId,
      conversation_id: conversationId,
      message_id: messageId,
      storage_path: storagePath,
      mime_type: mimeType,
      estado: 'error',
    });
    return { isReceipt: true };
  }

  if (!extraction.isReceipt) {
    return { isReceipt: false };
  }

  await supabase.from('receipts').insert({
    id: receiptId,
    company_id: companyId,
    conversation_id: conversationId,
    message_id: messageId,
    storage_path: storagePath,
    mime_type: mimeType,
    estado: 'pendiente',
    extracted: extraction.fields,
  });

  return { isReceipt: true };
}
