import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { appendReceiptToSheet, type ReceiptRow } from '../services/sheets-exporter.js';
import { requireModule } from '../middleware/modules.js';

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);
receiptsRouter.use(requireModule('comprobantes'));

export async function exportReceiptRow(
  receipt: { id: string; storage_path: string; created_at: string; extracted: Record<string, { value: string | null }> },
  sheetsConfig: { spreadsheet_id: string; sheet_name: string; sa_key_enc: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: signed } = await supabase.storage
    .from('receipts')
    .createSignedUrl(receipt.storage_path, 60 * 60 * 24 * 365);

  const row: ReceiptRow = {
    receivedAt: new Date(receipt.created_at).toLocaleString('es-AR'),
    monto: receipt.extracted?.monto?.value ?? '',
    fechaOperacion: receipt.extracted?.fecha_operacion?.value ?? '',
    concepto: receipt.extracted?.concepto?.value ?? '',
    referencia: receipt.extracted?.referencia?.value ?? '',
    coelsaId: receipt.extracted?.coelsa_id?.value ?? '',
    remitente: receipt.extracted?.remitente?.value ?? '',
    cuitRemitente: receipt.extracted?.cuit_remitente?.value ?? '',
    bancoRemitente: receipt.extracted?.banco_remitente?.value ?? '',
    destinatario: receipt.extracted?.destinatario?.value ?? '',
    cuitDestinatario: receipt.extracted?.cuit_destinatario?.value ?? '',
    cbuAliasDestino: receipt.extracted?.cbu_alias_destino?.value ?? '',
    bancoDestinatario: receipt.extracted?.banco_destinatario?.value ?? '',
    fileLink: signed?.signedUrl ?? '',
  };

  try {
    await appendReceiptToSheet(
      { spreadsheetId: sheetsConfig.spreadsheet_id, sheetName: sheetsConfig.sheet_name, saKeyEnc: sheetsConfig.sa_key_enc },
      row,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido al exportar';
    await supabase.from('receipts').update({ estado: 'error', export_error: message }).eq('id', receipt.id);
    return { ok: false, error: message };
  }

  await supabase
    .from('receipts')
    .update({ estado: 'exportado', exported_at: new Date().toISOString(), export_error: null })
    .eq('id', receipt.id);
  return { ok: true };
}

receiptsRouter.get('/', async (req, res) => {
  const companyId = getCompanyId(req);
  const estado = typeof req.query.estado === 'string' ? req.query.estado : undefined;

  let query = supabase
    .from('receipts')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (estado) query = query.eq('estado', estado);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'No se pudieron cargar los comprobantes' });
  res.json(data);
});

receiptsRouter.get('/:id', async (req, res) => {
  const companyId = getCompanyId(req);
  const { data: receipt, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('id', req.params.id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !receipt) return res.status(404).json({ error: 'No encontrado' });

  const { data: signed } = await supabase.storage
    .from('receipts')
    .createSignedUrl(receipt.storage_path, 600);

  res.json({ ...receipt, fileUrl: signed?.signedUrl ?? null });
});

const fieldValueSchema = z.object({ value: z.string().nullable(), confidence: z.enum(['alta', 'media', 'baja']) });
const patchSchema = z.object({
  extracted: z.object({
    monto: fieldValueSchema,
    fecha_operacion: fieldValueSchema,
    concepto: fieldValueSchema,
    referencia: fieldValueSchema,
    coelsa_id: fieldValueSchema,
    remitente: fieldValueSchema,
    cuit_remitente: fieldValueSchema,
    banco_remitente: fieldValueSchema,
    destinatario: fieldValueSchema,
    cuit_destinatario: fieldValueSchema,
    cbu_alias_destino: fieldValueSchema,
    banco_destinatario: fieldValueSchema,
  }),
});

receiptsRouter.patch('/:id', async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data, error } = await supabase
    .from('receipts')
    .update({ extracted: parsed.data.extracted, estado: 'revisado' })
    .eq('id', req.params.id)
    .eq('company_id', companyId)
    .select()
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'No encontrado' });
  res.json(data);
});

const exportBodySchema = z.object({ force: z.boolean().optional() });

receiptsRouter.post('/:id/export', async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = exportBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data: receipt, error: receiptErr } = await supabase
    .from('receipts')
    .select('*')
    .eq('id', req.params.id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (receiptErr || !receipt) return res.status(404).json({ error: 'No encontrado' });
  // force=true re-appends a new row for testing/reconciliation — deliberately
  // not idempotent in that case, unlike the default path.
  if (receipt.estado === 'exportado' && !parsed.data.force) return res.json(receipt);

  const { data: sheetsConfig, error: configErr } = await supabase
    .from('sheets_config')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (configErr || !sheetsConfig) {
    return res.status(400).json({ error: 'Configurá Google Sheets antes de exportar' });
  }

  const result = await exportReceiptRow(receipt, sheetsConfig);
  if (!result.ok) {
    console.error(`[receipts] Export failed for receipt ${receipt.id}:`, result.error);
    return res.status(502).json({ error: 'No se pudo exportar a Google Sheets' });
  }

  const { data: updated } = await supabase.from('receipts').select('*').eq('id', receipt.id).maybeSingle();
  res.json(updated);
});
