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

const EXTRACTION_PROMPT = `Analizá el archivo adjunto. Es un comprobante de pago/transferencia argentino?

Si NO es un comprobante de pago, respondé con isReceipt: false.

Si SI es un comprobante de pago, extraé estos 8 campos, cada uno con su nivel de confianza:
monto, fecha_operacion, banco_origen, remitente, cuit (CUIT/CUIL del remitente), cbu_alias (CBU/CVU/alias de la cuenta que RECIBIÓ el dinero, no la que lo envió), referencia (número de referencia/operación), concepto.

Los comprobantes vienen de bancos tradicionales (Galicia, Santander, BBVA, Nación, Provincia, Macro, ICBC, HSBC, Ciudad, etc.) y de billeteras/fintechs (Mercado Pago, Ualá, Brubank, Naranja X, Personal Pay, MODO, Cuenta DNI, transferencias 3.0), y cada uno usa su propio diseño y su propia terminología. No asumas un único formato — mapeá sinónimos al campo que corresponde:
- "banco_origen": si el emisor es una billetera/fintech (no un banco), poné el nombre de esa app/fintech igual — nunca lo dejes vacío solo porque no es un banco tradicional.
- "remitente": puede aparecer como "De", "Enviado por", "Origen", "Titular de origen". Es quien MANDÓ la plata, no quien la recibió — no lo confundas con el destinatario.
- "cbu_alias": puede aparecer como "CBU", "CVU", "Alias", "Alias destino", "Cuenta destino". Siempre es la cuenta que RECIBIÓ el pago (la del negocio), nunca la del remitente, aunque ambas aparezcan en el comprobante.
- "referencia": puede aparecer como "Comprobante Nº", "ID de la operación", "Número de operación", "Nro. de transacción", "Coelsa ID", "ID de transacción".
- "concepto": puede aparecer como "Motivo", "Concepto", "Descripción"; si el comprobante no distingue un motivo, usá lo que haya (aunque sea "Varios").
- "fecha_operacion": puede venir en cualquier formato (DD/MM/AAAA, DD-MM-AAAA, "06 ago 2026", con o sin hora) — extraé la fecha tal cual aparece, no la reformatees.
- "monto": los montos argentinos separan miles con "." y decimales con "," (ej. $150.000,50) — extraelo tal cual aparece en el comprobante, no lo conviertas de formato.
- El CUIT/CUIL del remitente no siempre aparece (varias fintechs no lo muestran) — si no está, es null con confidence "baja", no lo inventes.

Regla de confianza: "alta" solo si el campo aparece explícito y sin ambigüedad en el comprobante. "media" si lo inferiste de contexto (ej. el nombre del banco lo dedujiste del logo, no de texto). "baja" si no está presente o no estás seguro. Si un campo no está presente, poné value: null y confidence: "baja" — nunca inventes un valor para evitar dejarlo vacío.`;

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
