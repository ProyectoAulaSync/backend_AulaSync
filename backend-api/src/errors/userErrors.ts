import { AppError } from './AppError';

export const usernameTaken = (): AppError =>
  new AppError('Este nombre de usuario ya está en uso. Elige otro', 409, {
    code: 'USERNAME_TAKEN',
    field: 'username',
  });

export const profileNotFound = (): AppError =>
  new AppError('No encontramos tu perfil. Completa tu registro', 404, {
    code: 'PROFILE_NOT_FOUND',
  });
