import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { appendOperationToSheet, type OperationRow } from '../services/sheets-exporter.js';
import { requireModule } from '../middleware/modules.js';

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);
receiptsRouter.use(requireModule('comprobantes'));

export type OperationLinkInput = {
  operationId: string;
  pesosProveedor: number;
  tipoCambioProveedor: number;
  monedaFinal: 'USD' | 'USDT';
};

// Links a comprobante to a pendiente operación and appends the merged row to
// the Operaciones sheet. This IS the export now — there is no separate
// standalone comprobante-sheet step anymore. A failure here is reflected on
// both operations.link_error and receipts.export_error, so it's visible from
// either side without cross-referencing.
export async function exportReceiptRow(
  receipt: { id: string; extracted: Record<string, { value: string | null }> },
  sheetsConfig: { spreadsheet_id: string; sa_key_enc: string; operations_sheet_name?: string | null },
  companyId: string,
  operationLink: OperationLinkInput,
  operador2Id?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: operation } = await supabase
    .from('operations')
    .select('*, contact:contacts(name), operador:company_members!operador_id(name)')
    .eq('id', operationLink.operationId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!operation || operation.estado !== 'pendiente') {
    return { ok: false, error: 'Esta operación ya no está disponible' };
  }

  const { data: operador2 } = operador2Id
    ? await supabase.from('company_members').select('name').eq('id', operador2Id).eq('company_id', companyId).maybeSingle()
    : { data: null };

  const montoFinal = operationLink.pesosProveedor / operationLink.tipoCambioProveedor;

  if (!sheetsConfig.operations_sheet_name) {
    const message = 'No hay una hoja de Operaciones configurada en Ajustes › Google Sheets';
    await supabase.from('operations').update({ link_error: message }).eq('id', operation.id);
    await supabase.from('receipts').update({ export_error: message }).eq('id', receipt.id);
    return { ok: false, error: message };
  }

  try {
    const operationRow: OperationRow = {
      fecha: new Date().toLocaleString('es-AR'),
      cliente: operation.contact?.name ?? '',
      operador: operation.operador?.name ?? '',
      pesosCliente: String(operation.pesos_cliente),
      tcCliente: String(operation.tipo_cambio_cliente),
      usdCliente: String(operation.usd_cliente),
      operador2: operador2?.name ?? '',
      pesosProveedor: String(operationLink.pesosProveedor),
      tcProveedor: String(operationLink.tipoCambioProveedor),
      montoFinal: String(montoFinal),
    };
    await appendOperationToSheet(
      { spreadsheetId: sheetsConfig.spreadsheet_id, sheetName: sheetsConfig.operations_sheet_name, saKeyEnc: sheetsConfig.sa_key_enc },
      operationRow,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido al exportar la operación';
    await supabase.from('operations').update({ link_error: message }).eq('id', operation.id);
    await supabase.from('receipts').update({ export_error: message }).eq('id', receipt.id);
    return { ok: false, error: message };
  }

  await supabase.from('operations').update({
    estado: 'vinculada',
    receipt_id: receipt.id,
    operador2_id: operador2Id ?? null,
    pesos_proveedor: operationLink.pesosProveedor,
    tipo_cambio_proveedor: operationLink.tipoCambioProveedor,
    moneda_final: operationLink.monedaFinal,
    monto_final: montoFinal,
    linked_at: new Date().toISOString(),
    link_error: null,
  }).eq('id', operation.id).eq('estado', 'pendiente'); // guard against a concurrent cancel between the fetch above and this write

  await supabase.from('receipts').update({
    estado: 'exportado',
    exported_at: new Date().toISOString(),
    export_error: null,
  }).eq('id', receipt.id);

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

const operationLinkSchema = z.object({
  operationId: z.string().uuid(),
  pesosProveedor: z.number().positive(),
  tipoCambioProveedor: z.number().positive(),
  monedaFinal: z.enum(['USD', 'USDT']),
});

const exportBodySchema = z.object({
  operationLink: operationLinkSchema,
});

receiptsRouter.post('/:id/export', async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
  const parsed = exportBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Elegí una operación para vincular' });

  const { data: receipt, error: receiptErr } = await supabase
    .from('receipts')
    .select('*')
    .eq('id', req.params.id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (receiptErr || !receipt) return res.status(404).json({ error: 'No encontrado' });

  const { data: sheetsConfig, error: configErr } = await supabase
    .from('sheets_config')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (configErr || !sheetsConfig) {
    return res.status(400).json({ error: 'Configurá Google Sheets antes de exportar' });
  }

  const { data: op } = await supabase
    .from('operations')
    .select('id, estado')
    .eq('id', parsed.data.operationLink.operationId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!op || op.estado !== 'pendiente') {
    return res.status(409).json({ error: 'Esta operación ya no está disponible' });
  }

  // A receipt already backing a vinculada operación should never be
  // silently attached to a second one — that would double-count the same
  // payment across two arbitraje entries.
  const { data: existingLink } = await supabase
    .from('operations')
    .select('id')
    .eq('receipt_id', receipt.id)
    .eq('estado', 'vinculada')
    .maybeSingle();
  if (existingLink) {
    return res.status(409).json({ error: 'Este comprobante ya está vinculado a otra operación' });
  }

  const result = await exportReceiptRow(receipt, sheetsConfig, companyId, parsed.data.operationLink, member?.id);
  if (!result.ok) {
    console.error(`[receipts] Export failed for receipt ${receipt.id}:`, result.error);
    return res.status(502).json({ error: 'No se pudo vincular y exportar la operación' });
  }

  const { data: updated } = await supabase.from('receipts').select('*').eq('id', receipt.id).maybeSingle();
  res.json(updated);
});
