import { describe, it, expect, vi } from 'vitest';

const mockAppend = vi.fn().mockResolvedValue({});
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class { constructor(_opts: any) {} } },
    sheets: () => ({ spreadsheets: { values: { append: mockAppend } } }),
  },
}));
vi.mock('../lib/encryption.js', () => ({ decrypt: (v: string) => v }));

import { appendReceiptToSheet, extractServiceAccountEmail } from './sheets-exporter.js';

describe('appendReceiptToSheet', () => {
  it('appends a row with the fixed column order', async () => {
    await appendReceiptToSheet(
      { spreadsheetId: 'sheet-123', sheetName: 'Comprobantes', saKeyEnc: JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: 'k' }) },
      {
        receivedAt: '23/07/2026 10:00',
        monto: '$45.000,00',
        fechaOperacion: '25/04/2026',
        bancoOrigen: 'Banco Galicia',
        remitente: 'Valeria Torres',
        cuit: '27-31847265-4',
        cbuAlias: '0170099340000012345678',
        referencia: '00923841',
        concepto: 'Varios',
        fileLink: 'https://example.com/file.pdf',
      },
    );

    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: 'sheet-123',
      range: 'Comprobantes!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          '23/07/2026 10:00', '$45.000,00', '25/04/2026', 'Banco Galicia',
          'Valeria Torres', '27-31847265-4', '0170099340000012345678',
          '00923841', 'Varios', 'https://example.com/file.pdf',
        ]],
      },
    }));
  });
});

describe('extractServiceAccountEmail', () => {
  it('returns the client_email from the decrypted key', () => {
    const email = extractServiceAccountEmail(
      JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: 'k' }),
    );
    expect(email).toBe('sa@x.iam.gserviceaccount.com');
  });

  it('throws a generic error without leaking key material when the decrypted value is not valid JSON', () => {
    let caught: unknown;
    try {
      extractServiceAccountEmail('not-valid-json-but-secret-looking-k3y-material');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain('secret-looking-k3y-material');
    expect((caught as Error).message).toBe('La credencial del service account no es un JSON válido');
  });
});
