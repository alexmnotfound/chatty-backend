import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createPublicKey } from 'node:crypto';
import { supabase } from '../lib/supabase.js';

const MEMBER_CACHE_TTL_MS = 60_000;

// Supabase now signs user JWTs with ES256 (asymmetric). Fetch the public key
// from the JWKS endpoint and cache it for 1 hour.
let jwksPublicKey: string | null = null;
let jwksExpiry = 0;

async function getJwksPublicKey(): Promise<string> {
  if (jwksPublicKey && Date.now() < jwksExpiry) return jwksPublicKey;
  const url = `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(url);
  const { keys } = await res.json() as { keys: object[] };
  if (!keys?.length) throw new Error('No JWKS keys returned');
  const pem = createPublicKey({ key: keys[0] as Parameters<typeof createPublicKey>[0], format: 'jwk' })
    .export({ type: 'spki', format: 'pem' }) as string;
  jwksPublicKey = pem;
  jwksExpiry = Date.now() + 3_600_000;
  return pem;
}

interface CachedMember {
  id: string;
  company_id: string;
  user_id: string;
  role: string;
  email: string;
  name: string;
  enabled: boolean;
  expiresAt: number;
}

const memberCache = new Map<string, CachedMember>();

export interface AuthRequest extends Request {
  userId: string;
  companyId: string;
  role: 'admin' | 'agent';
  rawBody?: Buffer;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let sub: string;
  try {
    const publicKey = await getJwksPublicKey();
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['ES256'],
    }) as { sub?: string };
    if (!payload.sub || typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    sub = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }

  let member: CachedMember | null = null;
  const cached = memberCache.get(sub);
  if (cached && cached.expiresAt > Date.now()) {
    member = cached;
  } else {
    try {
      const { data, error } = await supabase
        .from('company_members')
        .select('id, company_id, user_id, role, email, name, enabled')
        .eq('user_id', sub)
        .limit(1)
        .maybeSingle();
      if (error) return res.status(500).json({ error: 'Error interno del servidor' });
      if (data) {
        const entry: CachedMember = { ...data, expiresAt: Date.now() + MEMBER_CACHE_TTL_MS };
        memberCache.set(sub, entry);
        member = entry;
      }
    } catch {
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
  if (!member) return res.status(403).json({ error: 'Sin empresa asociada' });
  if (!member.enabled) return res.status(403).json({ error: 'Tu cuenta está deshabilitada. Consultá a un administrador.' });

  const authReq = req as AuthRequest;
  authReq.userId = sub;
  authReq.companyId = member.company_id;
  authReq.role = member.role as 'admin' | 'agent';
  (authReq as any).member = {
    id: member.id,
    company_id: member.company_id,
    companyId: member.company_id,
    user_id: member.user_id,
    userId: member.user_id,
    role: member.role,
    email: member.email,
    name: member.name,
    enabled: member.enabled,
  };
  next();
}

export function bustMemberCache(userId: string) {
  memberCache.delete(userId);
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req as AuthRequest).role !== role) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
}
