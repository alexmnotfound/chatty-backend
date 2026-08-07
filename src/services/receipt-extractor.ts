import OpenAI from 'openai';

export type FieldValue = { value: string | null; confidence: 'alta' | 'media' | 'baja' };

export type ReceiptFields = {
  monto: FieldValue;
  fecha_operacion: FieldValue;
  banco_origen: FieldValue;
  remitente: FieldValue;
  cuit: FieldValue;
  cbu_alias: FieldValue;
  referencia: FieldValue;
  concepto: FieldValue;
};

export type ReceiptExtraction = { isReceipt: false } | { isReceipt: true; fields: ReceiptFields };

export type ExtractionUsage = { model: string; tokensIn: number; tokensOut: number };
export type ExtractReceiptResult = { extraction: ReceiptExtraction; usage: ExtractionUsage };

// A malformed/empty model response still consumes billable tokens — carry
// usage on the error so the caller can still record cost for a failed
// extraction, not just successful ones.
export class ExtractionError extends Error {
  usage: ExtractionUsage;
  constructor(message: string, usage: ExtractionUsage) {
    super(message);
    this.name = 'ExtractionError';
    this.usage = usage;
  }
}

const EXTRACTION_PROMPT = `Analizá el archivo adjunto. Es un comprobante de pago/transferencia bancaria argentino?

Si NO es un comprobante de pago, respondé con isReceipt: false.

Si SI es un comprobante de pago, extraé estos 8 campos, cada uno con su nivel de confianza:
monto, fecha_operacion, banco_origen, remitente, cuit (CUIT/CUIL del remitente), cbu_alias (CBU o alias destino), referencia (número de referencia/operación), concepto.
Si un campo no está presente en el comprobante, poné value: null y confidence: "baja".`;

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    value: { type: ['string', 'null'] },
    confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: ['value', 'confidence'],
  additionalProperties: false,
} as const;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isReceipt: { type: 'boolean' },
    fields: {
      type: 'object',
      properties: {
        monto: FIELD_SCHEMA,
        fecha_operacion: FIELD_SCHEMA,
        banco_origen: FIELD_SCHEMA,
        remitente: FIELD_SCHEMA,
        cuit: FIELD_SCHEMA,
        cbu_alias: FIELD_SCHEMA,
        referencia: FIELD_SCHEMA,
        concepto: FIELD_SCHEMA,
      },
      required: ['monto', 'fecha_operacion', 'banco_origen', 'remitente', 'cuit', 'cbu_alias', 'referencia', 'concepto'],
      additionalProperties: false,
    },
  },
  required: ['isReceipt', 'fields'],
  additionalProperties: false,
} as const;

// gpt-4o-mini/gpt-4.1-mini don't accept raw PDFs — only image_url content parts.
// Argentine banks send PDF receipts constantly (per the original spec), so we
// render the first page to a PNG before sending it to the vision endpoint.
async function pdfFirstPageToPngBase64(fileBase64: string): Promise<string> {
  const { pdf } = await import('pdf-to-img');
  const buffer = Buffer.from(fileBase64, 'base64');
  const doc = await pdf(buffer, { scale: 2 });
  const firstPage = await doc.getPage(1);
  return firstPage.toString('base64');
}

const EXTRACTION_MODEL = 'gpt-4o';

export async function extractReceipt(
  apiKey: string,
  fileBase64: string,
  mimeType: string,
): Promise<ExtractReceiptResult> {
  const client = new OpenAI({ apiKey });

  const isPdf = mimeType === 'application/pdf';
  const imageBase64 = isPdf ? await pdfFirstPageToPngBase64(fileBase64) : fileBase64;
  const imageMimeType = isPdf ? 'image/png' : mimeType;

  const response = await client.chat.completions.create({
    model: EXTRACTION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: EXTRACTION_PROMPT },
        { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
      ],
    }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'receipt_extraction', strict: true, schema: RESPONSE_SCHEMA },
    },
  });

  const usage: ExtractionUsage = {
    // Store the requested model string (matches cost-calculator's rate table
    // keys), not response.model — OpenAI returns a versioned resolved id
    // (e.g. "gpt-4o-2024-08-06") that wouldn't match and would silently
    // cost 0.
    model: EXTRACTION_MODEL,
    tokensIn: response.usage?.prompt_tokens ?? 0,
    tokensOut: response.usage?.completion_tokens ?? 0,
  };

  const text = response.choices[0]?.message?.content;
  if (!text) throw new ExtractionError('No content in extraction response', usage);

  let parsed: ReceiptExtraction;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionError(`Could not parse extraction response as JSON: ${text}`, usage);
  }
  return { extraction: parsed, usage };
}
