import Anthropic from '@anthropic-ai/sdk';

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

const EXTRACTION_PROMPT = `Analizá el archivo adjunto. Es un comprobante de pago/transferencia bancaria argentino?

Si NO es un comprobante de pago, respondé exactamente: {"isReceipt": false}

Si SI es un comprobante de pago, extraé estos campos y respondé SOLO con JSON en este formato exacto (sin texto adicional, sin markdown):
{
  "isReceipt": true,
  "fields": {
    "monto": { "value": "<monto o null>", "confidence": "alta|media|baja" },
    "fecha_operacion": { "value": "<fecha de la operacion o null>", "confidence": "alta|media|baja" },
    "banco_origen": { "value": "<banco emisor o null>", "confidence": "alta|media|baja" },
    "remitente": { "value": "<nombre del remitente o null>", "confidence": "alta|media|baja" },
    "cuit": { "value": "<CUIT/CUIL del remitente o null>", "confidence": "alta|media|baja" },
    "cbu_alias": { "value": "<CBU o alias destino o null>", "confidence": "alta|media|baja" },
    "referencia": { "value": "<numero de referencia/operacion o null>", "confidence": "alta|media|baja" },
    "concepto": { "value": "<concepto del pago o null>", "confidence": "alta|media|baja" }
  }
}`;

export async function extractReceipt(
  apiKey: string,
  fileBase64: string,
  mimeType: string,
): Promise<ReceiptExtraction> {
  const client = new Anthropic({ apiKey });
  const isPdf = mimeType === 'application/pdf';

  const response = await client.messages.create({
    model: 'claude-3-7-sonnet-20250219',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: isPdf ? 'document' : 'image',
          source: { type: 'base64', media_type: mimeType, data: fileBase64 },
        } as any,
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });

  const textBlock = response.content.find((b: any) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text block in extraction response');
  }

  let parsed: ReceiptExtraction;
  try {
    parsed = JSON.parse(textBlock.text.trim());
  } catch {
    throw new Error(`Could not parse extraction response as JSON: ${textBlock.text}`);
  }
  return parsed;
}
