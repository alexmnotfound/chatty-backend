import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export interface AuthRequest extends Request {
  userId: string;
  companyId: string;
  role: string;
  rawBody?: Buffer;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let sub: string;
  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as { sub: string };
    sub = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const member = await prisma.companyMember.findFirst({
    where: { userId: sub },
  });
  if (!member) return res.status(403).json({ error: 'Sin empresa asociada' });

  const authReq = req as AuthRequest;
  authReq.userId = sub;
  authReq.companyId = member.companyId;
  authReq.role = member.role;
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
