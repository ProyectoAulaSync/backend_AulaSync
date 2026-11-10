import { auth } from '../config/auth';
import { AppError } from '../errors/AppError';
import type { AuthContext } from '../middlewares/authenticate';
import * as userRepo from '../repositories/user.repository';
import type { UserProfile } from '../types/user';

/** Crea (una sola vez) el perfil inicial de quien entra con Google: queda con profileComplete=false. */
export async function syncGoogleUser(ctx: AuthContext): Promise<UserProfile> {
  if (ctx.provider !== 'google.com') {
    throw new AppError('Este endpoint es solo para cuentas de Google', 403, { code: 'NOT_GOOGLE_ACCOUNT' });
  }

  const existing = await userRepo.findByUid(ctx.uid);
  if (existing) return existing;

  const record = await auth.getUser(ctx.uid);
  const parts = (record.displayName ?? '').trim().split(/\s+/).filter(Boolean);

  return userRepo.createProfile({
    uid: ctx.uid,
    email: record.email ?? ctx.email ?? '',
    nombres: parts[0] ?? '',
    apellidos: parts.slice(1).join(' '),
    username: null,
    avatar: record.photoURL ?? null,
    provider: 'google',
    profileComplete: false,
  });
}
