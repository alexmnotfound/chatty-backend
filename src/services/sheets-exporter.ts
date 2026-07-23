import { google } from 'googleapis';
import { decrypt } from '../lib/encryption.js';

export type ReceiptRow = {
  receivedAt: string;
  monto: string;
  fechaOperacion: string;
  bancoOrigen: string;
  remitente: string;
  cuit: string;
  cbuAlias: string;
  referencia: string;
  concepto: string;
  fileLink: string;
};

export async function appendReceiptToSheet(
  config: { spreadsheetId: string; sheetName: string; saKeyEnc: string },
  row: ReceiptRow,
): Promise<void> {
  const saKey = JSON.parse(decrypt(config.saKeyEnc));
  const auth = new google.auth.GoogleAuth({
    credentials: saKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        row.receivedAt, row.monto, row.fechaOperacion, row.bancoOrigen,
        row.remitente, row.cuit, row.cbuAlias, row.referencia, row.concepto, row.fileLink,
      ]],
    },
  });
}

export function extractServiceAccountEmail(saKeyEnc: string): string {
  const saKey = JSON.parse(decrypt(saKeyEnc));
  return saKey.client_email;
}
