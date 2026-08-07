import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockDownload, mockExtract, mockUpload, mockInsert, mockStorageFrom, mockFrom, MockExtractionError } = vi.hoisted(() => {
  class MockExtractionError extends Error {
    usage: { model: string; tokensIn: number; tokensOut: number };
    constructor(message: string, usage: { model: string; tokensIn: number; tokensOut: number }) {
      super(message);
      this.name = 'ExtractionError';
      this.usage = usage;
    }
  }
  return {
    mockDownload: vi.fn(),
    mockExtract: vi.fn(),
    mockUpload: vi.fn(),
    mockInsert: vi.fn(),
    mockStorageFrom: vi.fn(),
    mockFrom: vi.fn(),
    MockExtractionError,
  };
});

vi.mock('./media-download.js', () => ({
  downloadWhatsAppMedia: mockDownload,
}));

vi.mock('./receipt-extractor.js', () => ({
  extractReceipt: mockExtract,
  ExtractionError: MockExtractionError,
}));

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    storage: {
      from: mockStorageFrom,
    },
    from: mockFrom,
  },
}));

import { ingestReceiptMessage } from './receipt-ingest.js';

const baseParams = {
  mediaId: 'media-1',
  messageId: 'msg-1',
  companyId: 'company-1',
  conversationId: 'conv-1',
  whatsappToken: 'wa-token',
  openAiApiKey: 'openai-key',
};

describe('ingestReceiptMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path - is a receipt: uploads, extracts, inserts pendiente with cost tracking', async () => {
    mockDownload.mockResolvedValueOnce({ buffer: Buffer.from('imgdata'), mimeType: 'image/jpeg' });
    mockStorageFrom.mockReturnValueOnce({ upload: mockUpload });
    mockUpload.mockResolvedValueOnce({ error: null });

    const fields = {
      monto: { value: '$1000', confidence: 'alta' },
      fecha_operacion: { value: '01/01/2026', confidence: 'alta' },
      banco_origen: { value: 'Banco Test', confidence: 'alta' },
      remitente: { value: 'Juan Perez', confidence: 'alta' },
      cuit: { value: null, confidence: 'baja' },
      cbu_alias: { value: '123', confidence: 'media' },
      referencia: { value: '456', confidence: 'alta' },
      concepto: { value: 'Varios', confidence: 'media' },
    };
    mockExtract.mockResolvedValueOnce({
      extraction: { isReceipt: true, fields },
      usage: { model: 'gpt-4o', tokensIn: 1000, tokensOut: 50 },
    });

    mockFrom.mockReturnValueOnce({ insert: mockInsert });
    mockInsert.mockResolvedValueOnce({ error: null });

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({
      isReceipt: true,
      storagePath: expect.stringMatching(/^company-1\/.+\.jpg$/),
      mimeType: 'image/jpeg',
    });

    expect(mockStorageFrom).toHaveBeenCalledWith('receipts');
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^company-1\/.+\.jpg$/),
      expect.any(Buffer),
      { contentType: 'image/jpeg' }
    );

    expect(mockFrom).toHaveBeenCalledWith('receipts');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: 'company-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        mime_type: 'image/jpeg',
        estado: 'pendiente',
        extracted: fields,
        ai_model: 'gpt-4o',
        tokens_in: 1000,
        tokens_out: 50,
        cost_usd: expect.any(Number),
      })
    );
  });

  it('not a receipt: does not insert, resolves isReceipt:false', async () => {
    mockDownload.mockResolvedValueOnce({ buffer: Buffer.from('imgdata'), mimeType: 'image/jpeg' });
    mockStorageFrom.mockReturnValueOnce({ upload: mockUpload });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockExtract.mockResolvedValueOnce({
      extraction: { isReceipt: false },
      usage: { model: 'gpt-4o', tokensIn: 900, tokensOut: 5 },
    });

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({
      isReceipt: false,
      storagePath: expect.stringMatching(/^company-1\/.+\.jpg$/),
      mimeType: 'image/jpeg',
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('extraction throws ExtractionError: inserts with estado error and still records usage', async () => {
    mockDownload.mockResolvedValueOnce({ buffer: Buffer.from('imgdata'), mimeType: 'image/jpeg' });
    mockStorageFrom.mockReturnValueOnce({ upload: mockUpload });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockExtract.mockRejectedValueOnce(new MockExtractionError('extraction failed', { model: 'gpt-4o', tokensIn: 700, tokensOut: 3 }));

    mockFrom.mockReturnValueOnce({ insert: mockInsert });
    mockInsert.mockResolvedValueOnce({ error: null });

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({
      isReceipt: true,
      storagePath: expect.stringMatching(/^company-1\/.+\.jpg$/),
      mimeType: 'image/jpeg',
    });
    expect(mockFrom).toHaveBeenCalledWith('receipts');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: 'company-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        mime_type: 'image/jpeg',
        estado: 'error',
        ai_model: 'gpt-4o',
        tokens_in: 700,
        tokens_out: 3,
        cost_usd: expect.any(Number),
      })
    );
    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.extracted).toEqual({
      monto: { value: null, confidence: 'baja' },
      fecha_operacion: { value: null, confidence: 'baja' },
      banco_origen: { value: null, confidence: 'baja' },
      remitente: { value: null, confidence: 'baja' },
      cuit: { value: null, confidence: 'baja' },
      cbu_alias: { value: null, confidence: 'baja' },
      referencia: { value: null, confidence: 'baja' },
      concepto: { value: null, confidence: 'baja' },
    });
  });

  it('extraction throws a plain Error (no usage): inserts with estado error and null cost columns', async () => {
    mockDownload.mockResolvedValueOnce({ buffer: Buffer.from('imgdata'), mimeType: 'image/jpeg' });
    mockStorageFrom.mockReturnValueOnce({ upload: mockUpload });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockExtract.mockRejectedValueOnce(new Error('network error'));

    mockFrom.mockReturnValueOnce({ insert: mockInsert });
    mockInsert.mockResolvedValueOnce({ error: null });

    await ingestReceiptMessage(baseParams);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ ai_model: null, tokens_in: null, tokens_out: null, cost_usd: null })
    );
  });

  it('download throws: does not upload or insert, resolves isReceipt:true', async () => {
    mockDownload.mockRejectedValueOnce(new Error('download failed'));

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({ isReceipt: true });
    expect(mockStorageFrom).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('no company OpenAI key: skips extraction entirely, inserts estado error with a clear message', async () => {
    mockDownload.mockResolvedValueOnce({ buffer: Buffer.from('imgdata'), mimeType: 'image/jpeg' });
    mockStorageFrom.mockReturnValueOnce({ upload: mockUpload });
    mockUpload.mockResolvedValueOnce({ error: null });

    mockFrom.mockReturnValueOnce({ insert: mockInsert });
    mockInsert.mockResolvedValueOnce({ error: null });

    const result = await ingestReceiptMessage({ ...baseParams, openAiApiKey: null });

    expect(result).toEqual({
      isReceipt: true,
      storagePath: expect.stringMatching(/^company-1\/.+\.jpg$/),
      mimeType: 'image/jpeg',
    });
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: 'error',
        export_error: expect.stringContaining('API key'),
        ai_model: null,
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
      })
    );
  });
});
