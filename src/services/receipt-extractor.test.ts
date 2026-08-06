import { describe, it, expect, vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

import { extractReceipt } from './receipt-extractor.js';

describe('extractReceipt', () => {
  it('parses a valid receipt extraction response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        isReceipt: true,
        fields: {
          monto: { value: '$45.000,00', confidence: 'alta' },
          fecha_operacion: { value: '25/04/2026', confidence: 'alta' },
          banco_origen: { value: 'Banco Galicia', confidence: 'alta' },
          remitente: { value: 'Valeria Torres', confidence: 'alta' },
          cuit: { value: '27-31847265-4', confidence: 'media' },
          cbu_alias: { value: '0170099340000012345678', confidence: 'alta' },
          referencia: { value: '00923841', confidence: 'alta' },
          concepto: { value: 'Varios', confidence: 'media' },
        },
      }) } }],
    });

    const result = await extractReceipt('fake-key', 'base64data', 'image/jpeg');

    expect(result.isReceipt).toBe(true);
    if (result.isReceipt) {
      expect(result.fields.monto.value).toBe('$45.000,00');
      expect(result.fields.monto.confidence).toBe('alta');
    }
  });

  it('returns isReceipt:false when the model says it is not a receipt', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        isReceipt: false,
        fields: {
          monto: { value: null, confidence: 'baja' },
          fecha_operacion: { value: null, confidence: 'baja' },
          banco_origen: { value: null, confidence: 'baja' },
          remitente: { value: null, confidence: 'baja' },
          cuit: { value: null, confidence: 'baja' },
          cbu_alias: { value: null, confidence: 'baja' },
          referencia: { value: null, confidence: 'baja' },
          concepto: { value: null, confidence: 'baja' },
        },
      }) } }],
    });

    const result = await extractReceipt('fake-key', 'base64data', 'image/jpeg');
    expect(result.isReceipt).toBe(false);
  });

  it('throws on unparseable model output', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] });
    await expect(extractReceipt('fake-key', 'base64data', 'image/jpeg')).rejects.toThrow();
  });

  it('throws when the response has no content', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: {} }] });
    await expect(extractReceipt('fake-key', 'base64data', 'image/jpeg')).rejects.toThrow();
  });
});
