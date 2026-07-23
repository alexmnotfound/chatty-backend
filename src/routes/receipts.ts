import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { appendReceiptToSheet, type ReceiptRow } from '../services/sheets-exporter.js';

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);

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
    banco_origen: fieldValueSchema,
    remitente: fieldValueSchema,
    cuit: fieldValueSchema,
    cbu_alias: fieldValueSchema,
    referencia: fieldValueSchema,
    concepto: fieldValueSchema,
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

receiptsRouter.post('/:id/export', async (req, res) => {
  const companyId = getCompanyId(req);

  const { data: receipt, error: receiptErr } = await supabase
    .from('receipts')
    .select('*')
    .eq('id', req.params.id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (receiptErr || !receipt) return res.status(404).json({ error: 'No encontrado' });
  if (receipt.estado === 'exportado') return res.json(receipt);

  const { data: sheetsConfig, error: configErr } = await supabase
    .from('sheets_config')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (configErr || !sheetsConfig) {
    return res.status(400).json({ error: 'Configurá Google Sheets antes de exportar' });
  }

  const { data: signed } = await supabase.storage
    .from('receipts')
    .createSignedUrl(receipt.storage_path, 60 * 60 * 24 * 365);

  const row: ReceiptRow = {
    receivedAt: new Date(receipt.created_at).toLocaleString('es-AR'),
    monto: receipt.extracted?.monto?.value ?? '',
    fechaOperacion: receipt.extracted?.fecha_operacion?.value ?? '',
    bancoOrigen: receipt.extracted?.banco_origen?.value ?? '',
    remitente: receipt.extracted?.remitente?.value ?? '',
    cuit: receipt.extracted?.cuit?.value ?? '',
    cbuAlias: receipt.extracted?.cbu_alias?.value ?? '',
    referencia: receipt.extracted?.referencia?.value ?? '',
    concepto: receipt.extracted?.concepto?.value ?? '',
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
    return res.status(502).json({ error: 'No se pudo exportar a Google Sheets' });
  }

  const { data: updated } = await supabase
    .from('receipts')
    .update({ estado: 'exportado', exported_at: new Date().toISOString(), export_error: null })
    .eq('id', receipt.id)
    .select()
    .maybeSingle();
  res.json(updated);
});
