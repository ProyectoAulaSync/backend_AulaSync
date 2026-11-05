import { AppError } from '../errors/AppError';
import { obtenerPrimerMensaje } from '../repositories/mensaje.repository';

export async function getMensaje(): Promise<Record<string, unknown>> {
  const mensaje = await obtenerPrimerMensaje();

  if (!mensaje) {
    throw new AppError('No se encontró el mensaje de ejemplo', 404);
  }

  return mensaje;
}
