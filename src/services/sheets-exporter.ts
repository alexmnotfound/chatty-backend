import { google } from 'googleapis';
import { decrypt } from '../lib/encryption.js';

export type ReceiptRow = {
  receivedAt: string;
  monto: string;
  fechaOperacion: string;
  concepto: string;
  referencia: string;
  coelsaId: string;
  remitente: string;
  cuitRemitente: string;
  bancoRemitente: string;
  destinatario: string;
  cuitDestinatario: string;
  cbuAliasDestino: string;
  bancoDestinatario: string;
  fileLink: string;
};

type ServiceAccountKey = { client_email: string; [key: string]: unknown };

// JSON.parse's SyntaxError embeds a snippet of the string it failed to parse —
// never let that bubble up here, since the string is decrypted credential
// material (potentially including private_key fragments).
function parseServiceAccountKey(saKeyEnc: string): ServiceAccountKey {
  let plaintext: string;
  try {
    plaintext = decrypt(saKeyEnc);
  } catch {
    throw new Error('No se pudo desencriptar la credencial del service account');
  }
  try {
    return JSON.parse(plaintext) as ServiceAccountKey;
  } catch {
    throw new Error('La credencial del service account no es un JSON válido');
  }
}

export async function appendReceiptToSheet(
  config: { spreadsheetId: string; sheetName: string; saKeyEnc: string },
  row: ReceiptRow,
): Promise<void> {
  const saKey = parseServiceAccountKey(config.saKeyEnc);
  const auth = new google.auth.GoogleAuth({
    credentials: saKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:N`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        row.receivedAt, row.monto, row.fechaOperacion, row.concepto, row.referencia, row.coelsaId,
        row.remitente, row.cuitRemitente, row.bancoRemitente,
        row.destinatario, row.cuitDestinatario, row.cbuAliasDestino, row.bancoDestinatario,
        row.fileLink,
      ]],
    },
  });
}

export function extractServiceAccountEmail(saKeyEnc: string): string {
  return parseServiceAccountKey(saKeyEnc).client_email;
}
