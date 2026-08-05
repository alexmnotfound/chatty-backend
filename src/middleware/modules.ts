import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';
import type { AuthRequest } from './auth.js';

const MODULE_CACHE_TTL_MS = 60_000;
const moduleCache = new Map<string, { slugs: Set<string>; expiresAt: number }>();

async function getEnabledSlugs(companyId: string): Promise<Set<string>> {
  const cached = moduleCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.slugs;

  const { data } = await supabase
    .from('company_plugins')
    .select('plugins(slug)')
    .eq('company_id', companyId);
  const slugs = new Set(
    (data ?? [])
      .map((row: any) => row.plugins?.slug)
      .filter((slug: unknown): slug is string => typeof slug === 'string')
  );
  moduleCache.set(companyId, { slugs, expiresAt: Date.now() + MODULE_CACHE_TTL_MS });
  return slugs;
}

export function bustModuleCache(companyId: string) {
  moduleCache.delete(companyId);
}

// Fail-open if the module/plugin itself hasn't been seeded yet (e.g. before
// Task 3's seed script has run) — the intent is per-company gating, not to
// lock everyone out of an unconfigured environment. Fail-closed (403) once
// the plugin exists and the company simply isn't assigned it.
export function requireModule(slug: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const companyId = (req as AuthRequest).companyId;
    const { data: plugin } = await supabase.from('plugins').select('id').eq('slug', slug).maybeSingle();
    if (!plugin) return next();
    const enabled = await getEnabledSlugs(companyId);
    if (!enabled.has(slug)) {
      return res.status(403).json({ error: 'Módulo no habilitado para tu empresa' });
    }
    next();
  };
}
