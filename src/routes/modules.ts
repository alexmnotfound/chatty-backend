import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';

export const modulesRouter = Router();
modulesRouter.use(requireAuth);

modulesRouter.get('/mine', async (req, res) => {
  const companyId = getCompanyId(req);
  const { data, error } = await supabase
    .from('company_plugins')
    .select('plugins(slug)')
    .eq('company_id', companyId);
  if (error) return res.status(500).json({ error: 'No se pudieron cargar los módulos' });
  const enabledModules = (data ?? [])
    .map((row: any) => row.plugins?.slug)
    .filter((slug: unknown): slug is string => typeof slug === 'string');
  res.json({ enabledModules });
});
