import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../lib/supabase.js';

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
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!, {
      algorithms: ['HS256'],
    }) as { sub?: string };
    if (!payload.sub || typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    sub = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }

  let member;
  try {
    const { data, error } = await supabase
      .from('company_members')
      .select('*')
      .eq('user_id', sub)
      .limit(1)
      .maybeSingle();
    if (error) return res.status(500).json({ error: 'Error interno del servidor' });
    member = data;
  } catch {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  if (!member) return res.status(403).json({ error: 'Sin empresa asociada' });
  if (!member.enabled) return res.status(403).json({ error: 'Tu cuenta está deshabilitada. Consultá a un administrador.' });

  const authReq = req as AuthRequest;
  authReq.userId = sub;
  authReq.companyId = member.company_id;
  authReq.role = member.role as 'admin' | 'agent';
  // Attach full member for routes that need it
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

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req as AuthRequest).role !== role) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
}
