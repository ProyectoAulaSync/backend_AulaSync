import type { NextFunction, Request, Response } from 'express';
import { auth } from '../config/auth';
import { AppError } from '../errors/AppError';
import { findByUid } from '../repositories/user.repository';

export interface AuthContext {
  uid: string;
  email: string | null;
  provider: string; // 'password' | 'google.com'
}

export function getAuthContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

/** Exige un ID token válido de Firebase. Sin token o token inválido: 401. */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Necesitas iniciar sesión para continuar', 401, { code: 'NO_TOKEN' });
  }

  try {
    const decoded = await auth.verifyIdToken(header.slice(7).trim());
    const context: AuthContext = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      provider: decoded.firebase.sign_in_provider,
    };
    res.locals.auth = context;
    next();
  } catch {
    throw new AppError('Tu sesión no es válida o expiró. Inicia sesión de nuevo', 401, {
      code: 'INVALID_TOKEN',
    });
  }
}

/** Bloquea a quien entró con Google pero aún no eligió su nombre de usuario (403). */
export async function requireCompleteProfile(_req: Request, res: Response, next: NextFunction): Promise<void> {
  const profile = await findByUid(getAuthContext(res).uid);
  if (!profile || !profile.profileComplete) {
    throw new AppError('Primero elige tu nombre de usuario para continuar', 403, {
      code: 'PROFILE_INCOMPLETE',
    });
  }
  next();
}
