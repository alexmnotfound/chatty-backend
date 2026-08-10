import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { appendReceiptToSheet, appendOperationToSheet, type ReceiptRow, type OperationRow } from '../services/sheets-exporter.js';
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

export async function exportReceiptRow(
  receipt: { id: string; storage_path: string; created_at: string; extracted: Record<string, { value: string | null }> },
  sheetsConfig: { spreadsheet_id: string; sheet_name: string; sa_key_enc: string; operations_sheet_name?: string | null },
  companyId: string,
  operationLink?: OperationLinkInput,
  operador2Id?: string,
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

  if (operationLink) {
    await linkOperation(receipt, operationLink, sheetsConfig, companyId, operador2Id);
  }

  return { ok: true };
}

// Runs after the comprobante itself is already exported (see caller). A
// failure here never reverts that export — the comprobante is a valid
// `estado: exportado` row either way. Instead the operación is left
// `pendiente` with `link_error` set, so it's visible for a manual retry.
async function linkOperation(
  receipt: { id: string; extracted: Record<string, { value: string | null }> },
  link: OperationLinkInput,
  sheetsConfig: { operations_sheet_name?: string | null; spreadsheet_id: string; sa_key_enc: string },
  companyId: string,
  operador2Id?: string,
): Promise<void> {
  const { data: operation } = await supabase
    .from('operations')
    .select('*, contact:contacts(name), operador:company_members!operador_id(name)')
    .eq('id', link.operationId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!operation || operation.estado !== 'pendiente') {
    console.error(`[receipts] Operation ${link.operationId} not found or no longer pendiente — skipping link`);
    return;
  }

  const { data: operador2 } = operador2Id
    ? await supabase.from('company_members').select('name').eq('id', operador2Id).maybeSingle()
    : { data: null };

  const montoFinal = link.pesosProveedor / link.tipoCambioProveedor;

  if (!sheetsConfig.operations_sheet_name) {
    await supabase.from('operations').update({
      link_error: 'No hay una hoja de Operaciones configurada en Ajustes › Google Sheets',
    }).eq('id', operation.id);
    return;
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
      pesosProveedor: String(link.pesosProveedor),
      tcProveedor: String(link.tipoCambioProveedor),
      montoFinal: String(montoFinal),
    };
    await appendOperationToSheet(
      { spreadsheetId: sheetsConfig.spreadsheet_id, sheetName: sheetsConfig.operations_sheet_name, saKeyEnc: sheetsConfig.sa_key_enc },
      operationRow,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido al exportar la operación';
    await supabase.from('operations').update({ link_error: message }).eq('id', operation.id);
    return;
  }

  await supabase.from('operations').update({
    estado: 'vinculada',
    receipt_id: receipt.id,
    operador2_id: operador2Id ?? null,
    pesos_proveedor: link.pesosProveedor,
    tipo_cambio_proveedor: link.tipoCambioProveedor,
    moneda_final: link.monedaFinal,
    monto_final: montoFinal,
    linked_at: new Date().toISOString(),
    link_error: null,
  }).eq('id', operation.id);
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
}).optional();

const exportBodySchema = z.object({
  force: z.boolean().optional(),
  operationLink: operationLinkSchema,
});

receiptsRouter.post('/:id/export', async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
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

  if (parsed.data.operationLink) {
    const { data: op } = await supabase
      .from('operations')
      .select('id, estado')
      .eq('id', parsed.data.operationLink.operationId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!op || op.estado !== 'pendiente') {
      return res.status(409).json({ error: 'Esta operación ya no está disponible' });
    }
  }

  const result = await exportReceiptRow(receipt, sheetsConfig, companyId, parsed.data.operationLink, member?.id);
  if (!result.ok) {
    console.error(`[receipts] Export failed for receipt ${receipt.id}:`, result.error);
    return res.status(502).json({ error: 'No se pudo exportar a Google Sheets' });
  }

  const { data: updated } = await supabase.from('receipts').select('*').eq('id', receipt.id).maybeSingle();
  res.json(updated);
});
