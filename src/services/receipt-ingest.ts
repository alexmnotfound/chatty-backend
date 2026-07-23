import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { downloadWhatsAppMedia } from './media-download.js';
import { extractReceipt, type ReceiptFields } from './receipt-extractor.js';

// Frontend renders every ReceiptFields key unconditionally (e.g.
// extracted.remitente.value) — an error-state row must still carry this
// full shape (DB default is `{}`), or the review UI throws on a null field.
const EMPTY_FIELDS: ReceiptFields = {
  monto: { value: null, confidence: 'baja' },
  fecha_operacion: { value: null, confidence: 'baja' },
  banco_origen: { value: null, confidence: 'baja' },
  remitente: { value: null, confidence: 'baja' },
  cuit: { value: null, confidence: 'baja' },
  cbu_alias: { value: null, confidence: 'baja' },
  referencia: { value: null, confidence: 'baja' },
  concepto: { value: null, confidence: 'baja' },
};

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
      extracted: EMPTY_FIELDS,
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
