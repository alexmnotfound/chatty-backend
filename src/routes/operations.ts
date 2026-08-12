import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { requireModule } from '../middleware/modules.js';
import { logActivity } from '../lib/activityLogger.js';
import { appendOperationToSheet, type OperationRow } from '../services/sheets-exporter.js';

export const operationsRouter = Router();
operationsRouter.use(requireAuth);
operationsRouter.use(requireModule('comprobantes'));

const createSchema = z.object({
  conversationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  contactName: z.string().trim().min(1).optional(),
  pesosCliente: z.number().positive(),
  tipoCambioCliente: z.number().positive(),
  monedaCliente: z.enum(['USD', 'USDT']).optional().default('USD'),
  usdCliente: z.number().positive().optional(),
}).refine(
  d => Boolean(d.contactId) !== Boolean(d.contactName),
  { message: 'Debe indicar contactId o contactName, no ambos' }
);

operationsRouter.post('/', async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', parsed.data.conversationId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  }

  let contactId = parsed.data.contactId;
  if (contactId) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!contact) return res.status(404).json({ error: 'Cliente no encontrado' });
  } else {
    const { data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert({
        company_id: companyId,
        wa_id: `manual:${randomUUID()}`,
        name: parsed.data.contactName,
      })
      .select('id')
      .single();
    if (contactError || !newContact) return res.status(500).json({ error: 'No se pudo crear el cliente' });
    contactId = newContact.id;
  }

  const usdCliente = parsed.data.usdCliente ?? (parsed.data.pesosCliente / parsed.data.tipoCambioCliente);

  const { data, error } = await supabase
    .from('operations')
    .insert({
      company_id: companyId,
      conversation_id: parsed.data.conversationId ?? null,
      contact_id: contactId,
      operador_id: member.id,
      pesos_cliente: parsed.data.pesosCliente,
      tipo_cambio_cliente: parsed.data.tipoCambioCliente,
      usd_cliente: usdCliente,
      moneda_cliente: parsed.data.monedaCliente,
      estado: 'pendiente',
    })
    .select('*, contact:contacts(id, name, wa_id), operador:company_members!operador_id(id, name), operador2:company_members!operador2_id(id, name)')
    .single();
  if (error || !data) return res.status(500).json({ error: 'No se pudo crear la operación' });

  void logActivity({
    companyId,
    actorId: member?.id,
    action: 'operation.create',
    entityType: 'operation',
    entityId: data.id,
    conversationId: parsed.data.conversationId ?? null,
    meta: { pesosCliente: parsed.data.pesosCliente, tipoCambioCliente: parsed.data.tipoCambioCliente, contactName: parsed.data.contactName },
  });

  res.status(201).json(data);
});

operationsRouter.get('/contacts', async (req, res) => {
  const companyId = getCompanyId(req);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) return res.json([]);

  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, wa_id')
    .eq('company_id', companyId)
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(10);
  if (error) return res.status(500).json({ error: 'No se pudieron buscar clientes' });
  res.json(data ?? []);
});

const exportToSheetsSchema = z.object({
  operationIds: z.array(z.string().uuid()).min(1),
});

operationsRouter.post('/export-to-sheets', async (req, res) => {
  const companyId = getCompanyId(req);
  const parsed = exportToSheetsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data: sheetsConfig } = await supabase
    .from('sheets_config')
    .select('spreadsheet_id, operations_sheet_name, sa_key_enc')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!sheetsConfig?.operations_sheet_name) {
    const message = 'No hay una hoja de Operaciones configurada en Ajustes › Google Sheets';
    const results = parsed.data.operationIds.map(id => ({ id, ok: false as const, error: message }));
    return res.json(results);
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const operationId of parsed.data.operationIds) {
    const { data: operation } = await supabase
      .from('operations')
      .select('*, contact:contacts(name), operador:company_members!operador_id(name), operador2:company_members!operador2_id(name)')
      .eq('id', operationId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!operation || operation.estado !== 'vinculada' || operation.exported_at) {
      results.push({ id: operationId, ok: false, error: 'No es una operación vinculada pendiente de exportar' });
      continue;
    }

    const operationRow: OperationRow = {
      fecha: new Date().toLocaleString('es-AR'),
      cliente: operation.contact?.name ?? '',
      operador: operation.operador?.name ?? '',
      pesosCliente: String(operation.pesos_cliente),
      tcCliente: String(operation.tipo_cambio_cliente),
      usdCliente: String(operation.usd_cliente),
      operador2: operation.operador2?.name ?? '',
      pesosProveedor: String(operation.pesos_proveedor),
      tcProveedor: String(operation.tipo_cambio_proveedor),
      montoFinal: String(operation.monto_final),
    };

    try {
      await appendOperationToSheet(
        { spreadsheetId: sheetsConfig.spreadsheet_id, sheetName: sheetsConfig.operations_sheet_name, saKeyEnc: sheetsConfig.sa_key_enc },
        operationRow,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido al exportar la operación';
      await supabase.from('operations').update({ link_error: message }).eq('id', operationId);
      if (operation.receipt_id) {
        await supabase.from('receipts').update({ export_error: message }).eq('id', operation.receipt_id);
      }
      results.push({ id: operationId, ok: false, error: message });
      continue;
    }

    await supabase.from('operations')
      .update({ exported_at: new Date().toISOString(), link_error: null })
      .eq('id', operationId)
      .is('exported_at', null); // guard against a concurrent double-export
    if (operation.receipt_id) {
      await supabase.from('receipts')
        .update({ estado: 'exportado', exported_at: new Date().toISOString(), export_error: null })
        .eq('id', operation.receipt_id);
    }
    results.push({ id: operationId, ok: true });
  }

  res.json(results);
});

operationsRouter.get('/', async (req, res) => {
  const companyId = getCompanyId(req);
  const estado = typeof req.query.estado === 'string' ? req.query.estado : undefined;

  let query = supabase
    .from('operations')
    .select('*, contact:contacts(id, name, wa_id), operador:company_members!operador_id(id, name), operador2:company_members!operador2_id(id, name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (estado) query = query.eq('estado', estado);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'No se pudieron cargar las operaciones' });
  res.json(data);
});

operationsRouter.get('/:id', async (req, res) => {
  const companyId = getCompanyId(req);
  const { data, error } = await supabase
    .from('operations')
    .select('*, contact:contacts(id, name, wa_id), operador:company_members!operador_id(id, name), operador2:company_members!operador2_id(id, name)')
    .eq('id', req.params.id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'No encontrada' });
  res.json(data);
});

operationsRouter.post('/:id/cancel', async (req, res) => {
  const companyId = getCompanyId(req);
  const { data, error } = await supabase
    .from('operations')
    .update({ estado: 'cancelada' })
    .eq('id', req.params.id)
    .eq('company_id', companyId)
    .eq('estado', 'pendiente') // only pending operations can be cancelled
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'No se pudo cancelar la operación' });
  if (!data) return res.status(409).json({ error: 'La operación no existe o ya no está pendiente' });
  res.json(data);
});
