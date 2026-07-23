import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockDownload, mockExtract, mockUpload, mockInsert, mockStorageFrom, mockFrom } = vi.hoisted(() => {
  return {
    mockDownload: vi.fn(),
    mockExtract: vi.fn(),
    mockUpload: vi.fn(),
    mockInsert: vi.fn(),
    mockStorageFrom: vi.fn(),
    mockFrom: vi.fn(),
  };
});

vi.mock('./media-download.js', () => ({
  downloadWhatsAppMedia: mockDownload,
}));

vi.mock('./receipt-extractor.js', () => ({
  extractReceipt: mockExtract,
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
  anthropicApiKey: 'anthropic-key',
};

describe('ingestReceiptMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path - is a receipt: uploads, extracts, inserts pendiente', async () => {
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
    mockExtract.mockResolvedValueOnce({ isReceipt: true, fields });

    mockFrom.mockReturnValueOnce({ insert: mockInsert });
    mockInsert.mockResolvedValueOnce({ error: null });

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({ isReceipt: true });

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
      })
    );
  });

  it('not a receipt: does not insert, resolves isReceipt:false', async () => {
    mockDownload.mockResolvedValueOnce({ buffer: Buffer.from('imgdata'), mimeType: 'image/jpeg' });
    mockStorageFrom.mockReturnValueOnce({ upload: mockUpload });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockExtract.mockResolvedValueOnce({ isReceipt: false });

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({ isReceipt: false });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('extraction throws: inserts with estado error, resolves isReceipt:true', async () => {
    mockDownload.mockResolvedValueOnce({ buffer: Buffer.from('imgdata'), mimeType: 'image/jpeg' });
    mockStorageFrom.mockReturnValueOnce({ upload: mockUpload });
    mockUpload.mockResolvedValueOnce({ error: null });
    mockExtract.mockRejectedValueOnce(new Error('extraction failed'));

    mockFrom.mockReturnValueOnce({ insert: mockInsert });
    mockInsert.mockResolvedValueOnce({ error: null });

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({ isReceipt: true });
    expect(mockFrom).toHaveBeenCalledWith('receipts');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: 'company-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        mime_type: 'image/jpeg',
        estado: 'error',
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

  it('download throws: does not upload or insert, resolves isReceipt:true', async () => {
    mockDownload.mockRejectedValueOnce(new Error('download failed'));

    const result = await ingestReceiptMessage(baseParams);

    expect(result).toEqual({ isReceipt: true });
    expect(mockStorageFrom).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
