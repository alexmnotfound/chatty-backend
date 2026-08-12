import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
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

// Links a comprobante to a pendiente operación. This ONLY links — it no
// longer exports to Google Sheets (that's now a separate, manual, bulk
// action: POST /operations/export-to-sheets). A failure here means the
// operación/receipt data itself was invalid (already validated with
// 404/409 in the route handler before this is called), so this rarely
// fails; if it does, it's a genuine unexpected DB error.
export async function exportReceiptRow(
  receipt: { id: string; extracted: Record<string, { value: string | null }> },
  companyId: string,
  operationLink: OperationLinkInput,
  operador2Id?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await doExportReceiptRow(receipt, companyId, operationLink, operador2Id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido al vincular la operación';
    console.error(`[receipts] Unexpected error linking receipt ${receipt.id}:`, err);
    return { ok: false, error: message };
  }
}

async function doExportReceiptRow(
  receipt: { id: string; extracted: Record<string, { value: string | null }> },
  companyId: string,
  operationLink: OperationLinkInput,
  operador2Id?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: operation } = await supabase
    .from('operations')
    .select('id, estado')
    .eq('id', operationLink.operationId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!operation || operation.estado !== 'pendiente') {
    return { ok: false, error: 'Esta operación ya no está disponible' };
  }

  const montoFinal = operationLink.pesosProveedor / operationLink.tipoCambioProveedor;

  await supabase.from('operations').update({
    estado: 'vinculada',
    receipt_id: receipt.id,
    operador2_id: operador2Id ?? null,
    pesos_proveedor: operationLink.pesosProveedor,
    tipo_cambio_proveedor: operationLink.tipoCambioProveedor,
    moneda_final: operationLink.monedaFinal,
    monto_final: montoFinal,
    linked_at: new Date().toISOString(),
  }).eq('id', operation.id).eq('estado', 'pendiente'); // guard against a concurrent cancel between the fetch above and this write

  await supabase.from('receipts').update({
    estado: 'revisado',
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

  const result = await exportReceiptRow(receipt, companyId, parsed.data.operationLink, member?.id);
  if (!result.ok) {
    console.error(`[receipts] Link failed for receipt ${receipt.id}:`, result.error);
    return res.status(502).json({ error: 'No se pudo vincular la operación' });
  }

  const { data: updated } = await supabase.from('receipts').select('*').eq('id', receipt.id).maybeSingle();
  res.json(updated);
});
