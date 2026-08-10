import { describe, it, expect, vi } from 'vitest';

const mockAppend = vi.fn().mockResolvedValue({});
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class { constructor(_opts: any) {} } },
    sheets: () => ({ spreadsheets: { values: { append: mockAppend } } }),
  },
}));
vi.mock('../lib/encryption.js', () => ({ decrypt: (v: string) => v }));

import { appendOperationToSheet, extractServiceAccountEmail } from './sheets-exporter.js';

describe('appendOperationToSheet', () => {
  it('appends a row with the fixed column order', async () => {
    await appendOperationToSheet(
      { spreadsheetId: 'sheet-123', sheetName: 'Operaciones', saKeyEnc: JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: 'k' }) },
      {
        fecha: '07/08/2026 10:14',
        cliente: 'Valeria Torres',
        operador: 'Emilia',
        pesosCliente: '850000',
        tcCliente: '1185',
        usdCliente: '717.30',
        operador2: 'Tomás',
        pesosProveedor: '848500',
        tcProveedor: '1172',
        montoFinal: '723.89',
      },
    );

    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: 'sheet-123',
      range: 'Operaciones!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          '07/08/2026 10:14', 'Valeria Torres', 'Emilia', '850000', '1185', '717.30',
          'Tomás', '848500', '1172', '723.89',
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
