import OpenAI from 'openai';

export type FieldValue = { value: string | null; confidence: 'alta' | 'media' | 'baja' };

export type ReceiptFields = {
  monto: FieldValue;
  fecha_operacion: FieldValue;
  concepto: FieldValue;
  referencia: FieldValue;
  coelsa_id: FieldValue;
  remitente: FieldValue;
  cuit_remitente: FieldValue;
  banco_remitente: FieldValue;
  destinatario: FieldValue;
  cuit_destinatario: FieldValue;
  cbu_alias_destino: FieldValue;
  banco_destinatario: FieldValue;
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

Si SI es un comprobante de pago, extraé estos 12 campos, cada uno con su nivel de confianza:
monto, fecha_operacion, concepto, referencia (número de operación/comprobante/transacción), coelsa_id (ID de COELSA, SOLO si el comprobante lo muestra como un campo aparte de la referencia — muchos comprobantes no lo tienen),
remitente (nombre de quien envía), cuit_remitente (CUIT/CUIL de quien envía), banco_remitente (banco/fintech/exchange de origen),
destinatario (nombre de quien recibe), cuit_destinatario (CUIT/CUIL de quien recibe), cbu_alias_destino (CBU/CVU/alias de la cuenta que RECIBIÓ el dinero), banco_destinatario (banco/fintech/exchange de destino).

Los comprobantes vienen de bancos tradicionales (Galicia, Santander, BBVA, Nación, Provincia, Macro, ICBC, HSBC, Ciudad, etc.), de billeteras/fintechs (Mercado Pago, Ualá, Brubank, Naranja X, Personal Pay, MODO, Cuenta DNI, transferencias 3.0) y de exchanges cripto (retiros fiat, sin CBU tradicional). Cada uno usa su propio diseño y su propia terminología. No asumas un único formato — mapeá sinónimos al campo que corresponde, y **siempre distinguí origen (remitente) de destino (destinatario), aunque ambos aparezcan juntos en el mismo comprobante**:
- Origen: "De", "Enviado por", "Titular origen", "Titular de origen". Va a remitente/cuit_remitente/banco_remitente.
- Destino: "Para", "Beneficiario", "Titular destino", "Nombre del destinatario". Va a destinatario/cuit_destinatario/banco_destinatario/cbu_alias_destino.
- Si el comprobante solo muestra un lado (ej. un "Retiro Fiat" de un exchange que solo indica el destinatario), completá lo que haya y dejá el otro lado en null/"baja" — no inventes el remitente si no aparece.
- "banco_remitente"/"banco_destinatario": si es una billetera/fintech/exchange (no un banco tradicional), poné el nombre de esa app igual — nunca lo dejes vacío solo por no ser un banco.
- "cbu_alias_destino": puede aparecer como "CBU", "CVU", "Alias", "Alias destino", "Cuenta destino", "Cuenta". Es la cuenta que RECIBIÓ el pago.
- "referencia": puede aparecer como "Comprobante Nº", "ID de la operación", "Número de operación", "Nro. de transacción", "ID de transacción", "Código de identificación".
- "coelsa_id": solo cuando el comprobante muestra explícitamente un campo "ID de COELSA" (o "COELSA ID") DISTINTO de la referencia — algunos comprobantes (ej. transferencias 3.0) traen ambos por separado con valores distintos; si el comprobante solo tiene un identificador, va en "referencia" y "coelsa_id" queda null.
- "concepto": puede aparecer como "Motivo", "Concepto", "Descripción"; si el comprobante no distingue un motivo, usá lo que haya (aunque sea "Varios").
- "fecha_operacion": el comprobante puede mostrarla en cualquier formato (DD-MM-AAAA, "06 ago 2026", con hora, etc.) — SIEMPRE normalizala a DD/MM/AAAA (dos dígitos de día, dos de mes, cuatro de año, separados por "/"), sin la hora. Ejemplos: "06 ago 2026 15:51 hs" → "06/08/2026"; "7 Aug 2026 10:31" → "07/08/2026"; "03/08/2026 13:33:27" → "03/08/2026".
- "monto": el comprobante puede mostrarlo en cualquier formato (miles con "." y decimales con ",", o al revés, con o sin símbolo de moneda, con o sin signo negativo) — SIEMPRE normalizalo a un número plano con "." como separador decimal, sin separador de miles, sin símbolo de moneda y sin signo (siempre positivo). Ejemplos: "$150.000,50" → "150000.50"; "1,000,000.00 ARS" → "1000000.00"; "-2000000,00" → "2000000.00"; "$1.550.000,00" → "1550000.00".
- Los CUIT/CUIL no siempre aparecen (varias fintechs y exchanges no los muestran) — si no está, es null con confidence "baja", no lo inventes.

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
        concepto: FIELD_SCHEMA,
        referencia: FIELD_SCHEMA,
        coelsa_id: FIELD_SCHEMA,
        remitente: FIELD_SCHEMA,
        cuit_remitente: FIELD_SCHEMA,
        banco_remitente: FIELD_SCHEMA,
        destinatario: FIELD_SCHEMA,
        cuit_destinatario: FIELD_SCHEMA,
        cbu_alias_destino: FIELD_SCHEMA,
        banco_destinatario: FIELD_SCHEMA,
      },
      required: [
        'monto', 'fecha_operacion', 'concepto', 'referencia', 'coelsa_id',
        'remitente', 'cuit_remitente', 'banco_remitente',
        'destinatario', 'cuit_destinatario', 'cbu_alias_destino', 'banco_destinatario',
      ],
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
