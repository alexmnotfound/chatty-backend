import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { encrypt } from '../lib/encryption.js';
import { extractServiceAccountEmail } from '../services/sheets-exporter.js';
import { requireModule } from '../middleware/modules.js';

export const sheetsConfigRouter = Router();
sheetsConfigRouter.use(requireAuth);
sheetsConfigRouter.use(requireModule('sheets'));

const CONFIG_COLUMNS =
  'company_id, spreadsheet_id, operations_sheet_name, updated_at, sa_key_enc';

// extractServiceAccountEmail decrypts sa_key_enc and can throw (e.g. corrupted
// ciphertext, key rotation). Its errors are already sanitized (no key material
// leaked), but we still never let a throw here escape into an unhandled async
// rejection — Express 4 does not forward those to the error handler.
function safeClientEmail(saKeyEnc: string): string | null {
  try {
    return extractServiceAccountEmail(saKeyEnc);
  } catch {
    return null;
  }
}

sheetsConfigRouter.get('/', async (req, res) => {
  const companyId = getCompanyId(req);
  const { data, error } = await supabase
    .from('sheets_config')
    .select(CONFIG_COLUMNS)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'No se pudo cargar la configuración' });
  if (!data) return res.json(null);

  const { sa_key_enc, ...rest } = data;
  res.json({ ...rest, clientEmail: safeClientEmail(sa_key_enc) });
});

const putSchema = z.object({
  spreadsheetId: z.string().min(1),
  operationsSheetName: z.string().min(1).optional(),
  serviceAccountJson: z.string().min(1).optional(),
});

sheetsConfigRouter.put('/', requireRole('admin'), async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Validate the incoming JSON before storing anything. We only check shape
  // here (it parses, it has a client_email) — never echo the raw input back.
  if (parsed.data.serviceAccountJson) {
    try {
      const sa = JSON.parse(parsed.data.serviceAccountJson) as { client_email?: unknown };
      if (!sa.client_email || typeof sa.client_email !== 'string') {
        throw new Error('missing client_email');
      }
    } catch {
      return res.status(400).json({ error: 'El JSON del service account no es válido' });
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from('sheets_config')
    .select('company_id')
    .eq('company_id', companyId)
    .maybeSingle();
  if (existingError) return res.status(500).json({ error: 'No se pudo guardar la configuración' });
  if (!existing && !parsed.data.serviceAccountJson) {
    return res.status(400).json({
      error: 'Se requiere la credencial del service account para la configuración inicial',
    });
  }

  const update: Record<string, unknown> = {
    company_id: companyId,
    spreadsheet_id: parsed.data.spreadsheetId,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.operationsSheetName !== undefined) update.operations_sheet_name = parsed.data.operationsSheetName;
  if (parsed.data.serviceAccountJson) {
    update.sa_key_enc = encrypt(parsed.data.serviceAccountJson);
  }

  // Plain upsert() fails here: Postgres validates NOT NULL on the candidate
  // row before ON CONFLICT redirects to UPDATE, so omitting sa_key_enc on a
  // schedule-only save 500s even though the existing row already has one.
  // Branch explicitly instead.
  const query = existing
    ? supabase.from('sheets_config').update(update).eq('company_id', companyId)
    : supabase.from('sheets_config').insert(update);
  const { data, error } = await query.select(CONFIG_COLUMNS).maybeSingle();
  if (error || !data) return res.status(500).json({ error: 'No se pudo guardar la configuración' });

  const { sa_key_enc, ...rest } = data;
  res.json({ ...rest, clientEmail: safeClientEmail(sa_key_enc) });
});
