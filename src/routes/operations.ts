import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { requireModule } from '../middleware/modules.js';
import { logActivity } from '../lib/activityLogger.js';

export const operationsRouter = Router();
operationsRouter.use(requireAuth);
operationsRouter.use(requireModule('comprobantes'));

const createSchema = z.object({
  conversationId: z.string().uuid(),
  contactId: z.string().uuid(),
  pesosCliente: z.number().positive(),
  tipoCambioCliente: z.number().positive(),
});

operationsRouter.post('/', async (req, res) => {
  const companyId = getCompanyId(req);
  const member = (req as any).member;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Verify the conversation and contact belong to this company — same
  // ownership check pattern as tasksRouter.post('/').
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', parsed.data.conversationId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', parsed.data.contactId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!contact) return res.status(404).json({ error: 'Cliente no encontrado' });

  const usdCliente = parsed.data.pesosCliente / parsed.data.tipoCambioCliente;

  const { data, error } = await supabase
    .from('operations')
    .insert({
      company_id: companyId,
      conversation_id: parsed.data.conversationId,
      contact_id: parsed.data.contactId,
      operador_id: member.id,
      pesos_cliente: parsed.data.pesosCliente,
      tipo_cambio_cliente: parsed.data.tipoCambioCliente,
      usd_cliente: usdCliente,
      estado: 'pendiente',
    })
    .select()
    .single();
  if (error || !data) return res.status(500).json({ error: 'No se pudo crear la operación' });

  void logActivity({
    companyId,
    actorId: member?.id,
    action: 'operation.create',
    entityType: 'operation',
    entityId: data.id,
    conversationId: parsed.data.conversationId,
    meta: { pesosCliente: parsed.data.pesosCliente, tipoCambioCliente: parsed.data.tipoCambioCliente },
  });

  res.status(201).json(data);
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
