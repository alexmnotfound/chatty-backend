import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { downloadWhatsAppMedia } from './media-download.js';
import { extractReceipt, ExtractionError, type ExtractionUsage, type ReceiptFields } from './receipt-extractor.js';
import { calculateCost } from '../lib/cost-calculator.js';

// Frontend renders every ReceiptFields key unconditionally (e.g.
// extracted.remitente.value) — an error-state row must still carry this
// full shape (DB default is `{}`), or the review UI throws on a null field.
const EMPTY_FIELDS: ReceiptFields = {
  monto: { value: null, confidence: 'baja' },
  fecha_operacion: { value: null, confidence: 'baja' },
  concepto: { value: null, confidence: 'baja' },
  referencia: { value: null, confidence: 'baja' },
  coelsa_id: { value: null, confidence: 'baja' },
  remitente: { value: null, confidence: 'baja' },
  cuit_remitente: { value: null, confidence: 'baja' },
  banco_remitente: { value: null, confidence: 'baja' },
  destinatario: { value: null, confidence: 'baja' },
  cuit_destinatario: { value: null, confidence: 'baja' },
  cbu_alias_destino: { value: null, confidence: 'baja' },
  banco_destinatario: { value: null, confidence: 'baja' },
};

function usageColumns(usage: ExtractionUsage | null) {
  if (!usage) return { ai_model: null, tokens_in: null, tokens_out: null, cost_usd: null };
  return {
    ai_model: usage.model,
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: calculateCost(usage.model, usage.tokensIn, usage.tokensOut),
  };
}

export type IngestReceiptResult = {
  isReceipt: boolean;
  // Set whenever the file made it to storage, regardless of what happened
  // after (missing key, extraction error, success) — callers use this to
  // show the actual image in the chat thread.
  storagePath?: string;
  mimeType?: string;
};

export async function ingestReceiptMessage(params: {
  mediaId: string;
  messageId: string;
  companyId: string;
  conversationId: string;
  whatsappToken: string;
  openAiApiKey: string | null;
}): Promise<IngestReceiptResult> {
  const { mediaId, messageId, companyId, conversationId, whatsappToken, openAiApiKey } = params;

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

  if (!openAiApiKey) {
    // No company-owned key configured — never fall back to a platform key,
    // extraction cost is always the company's own. Fail visibly instead of
    // spending a round trip we know will 401.
    console.error(`[receipt-ingest] No company OpenAI key configured for ${companyId} — skipping extraction`);
    await supabase.from('receipts').insert({
      id: receiptId,
      company_id: companyId,
      conversation_id: conversationId,
      message_id: messageId,
      storage_path: storagePath,
      mime_type: mimeType,
      estado: 'error',
      extracted: EMPTY_FIELDS,
      export_error: 'No hay una API key de OpenAI configurada para esta empresa',
      ...usageColumns(null),
    });
    return { isReceipt: true, storagePath, mimeType };
  }

  let extraction: Awaited<ReturnType<typeof extractReceipt>>['extraction'];
  let usage: ExtractionUsage | null = null;
  try {
    const result = await extractReceipt(openAiApiKey, buffer.toString('base64'), mimeType);
    extraction = result.extraction;
    usage = result.usage;
  } catch (err) {
    console.error('[receipt-ingest] Extraction failed', err);
    if (err instanceof ExtractionError) usage = err.usage;
    await supabase.from('receipts').insert({
      id: receiptId,
      company_id: companyId,
      conversation_id: conversationId,
      message_id: messageId,
      storage_path: storagePath,
      mime_type: mimeType,
      estado: 'error',
      extracted: EMPTY_FIELDS,
      ...usageColumns(usage),
    });
    return { isReceipt: true, storagePath, mimeType };
  }

  if (!extraction.isReceipt) {
    return { isReceipt: false, storagePath, mimeType };
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
    ...usageColumns(usage),
  });

  return { isReceipt: true, storagePath, mimeType };
}
