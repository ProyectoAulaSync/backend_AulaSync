import { auth } from '../config/auth';
import { AppError } from '../errors/AppError';
import { usernameTaken } from '../errors/userErrors';
import * as userRepo from '../repositories/user.repository';
import type { RegisterInput } from '../schemas/register.schema';
import type { UserProfile } from '../types/user';

function mapCreateUserError(error: unknown): unknown {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;
  if (code === 'auth/email-already-exists') {
    return new AppError('Este correo ya está registrado. Inicia sesión o usa otro correo', 409, {
      code: 'EMAIL_TAKEN',
      field: 'email',
    });
  }
  if (code === 'auth/invalid-password') {
    return new AppError('La contraseña no cumple los requisitos', 400, { code: 'WEAK_PASSWORD', field: 'password' });
  }
  return error;
}

export async function registerUser(input: RegisterInput): Promise<UserProfile> {
  // 1) Rechazo rápido si el username ya existe (la garantía real es la transacción del paso 3).
  if (!(await userRepo.isUsernameAvailable(input.username.toLowerCase()))) throw usernameTaken();

  // 2) Cuenta en Firebase Auth (detecta correo repetido).
  const created = await auth
    .createUser({
      email: input.email,
      password: input.password,
      displayName: `${input.nombres} ${input.apellidos}`,
    })
    .catch((error: unknown) => {
      throw mapCreateUserError(error);
    });

  // 3) Perfil + reserva atómica del username. Si falla, se deshace la cuenta de Auth.
  try {
    return await userRepo.createProfile({
      uid: created.uid,
      email: input.email,
      nombres: input.nombres,
      apellidos: input.apellidos,
      username: input.username,
      avatar: input.avatar,
      provider: 'password',
      profileComplete: true,
    });
  } catch (error) {
    await auth.deleteUser(created.uid).catch((e) => console.error('Rollback de Auth fallido:', e));
    throw error;
  }
}
