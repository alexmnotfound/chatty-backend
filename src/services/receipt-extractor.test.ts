import { describe, it, expect, vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

import { extractReceipt, ExtractionError } from './receipt-extractor.js';

describe('extractReceipt', () => {
  it('parses a valid receipt extraction response and returns usage', async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { prompt_tokens: 1200, completion_tokens: 80 },
      choices: [{ message: { content: JSON.stringify({
        isReceipt: true,
        fields: {
          monto: { value: '$45.000,00', confidence: 'alta' },
          fecha_operacion: { value: '25/04/2026', confidence: 'alta' },
          concepto: { value: 'Varios', confidence: 'media' },
          referencia: { value: '00923841', confidence: 'alta' },
          coelsa_id: { value: null, confidence: 'baja' },
          remitente: { value: 'Valeria Torres', confidence: 'alta' },
          cuit_remitente: { value: '27-31847265-4', confidence: 'media' },
          banco_remitente: { value: 'Banco Galicia', confidence: 'alta' },
          destinatario: { value: 'Gamas SRL', confidence: 'alta' },
          cuit_destinatario: { value: '30-71234567-8', confidence: 'media' },
          cbu_alias_destino: { value: '0170099340000012345678', confidence: 'alta' },
          banco_destinatario: { value: 'Banco Coinag', confidence: 'alta' },
        },
      }) } }],
    });

    const { extraction, usage } = await extractReceipt('fake-key', 'base64data', 'image/jpeg');

    expect(extraction.isReceipt).toBe(true);
    if (extraction.isReceipt) {
      expect(extraction.fields.monto.value).toBe('$45.000,00');
      expect(extraction.fields.monto.confidence).toBe('alta');
    }
    expect(usage).toEqual({ model: 'gpt-4o', tokensIn: 1200, tokensOut: 80 });
  });

  it('returns isReceipt:false when the model says it is not a receipt', async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { prompt_tokens: 900, completion_tokens: 10 },
      choices: [{ message: { content: JSON.stringify({
        isReceipt: false,
        fields: {
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
        },
      }) } }],
    });

    const { extraction } = await extractReceipt('fake-key', 'base64data', 'image/jpeg');
    expect(extraction.isReceipt).toBe(false);
  });

  it('throws ExtractionError (carrying usage) on unparseable model output', async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { prompt_tokens: 500, completion_tokens: 5 },
      choices: [{ message: { content: 'not json' } }],
    });
    let caught: unknown;
    try {
      await extractReceipt('fake-key', 'base64data', 'image/jpeg');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExtractionError);
    expect((caught as InstanceType<typeof ExtractionError>).usage).toEqual({ model: 'gpt-4o', tokensIn: 500, tokensOut: 5 });
  });

  it('throws ExtractionError when the response has no content', async () => {
    mockCreate.mockResolvedValueOnce({ usage: { prompt_tokens: 300, completion_tokens: 0 }, choices: [{ message: {} }] });
    await expect(extractReceipt('fake-key', 'base64data', 'image/jpeg')).rejects.toThrow(ExtractionError);
  });
});
