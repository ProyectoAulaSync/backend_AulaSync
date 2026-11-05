import { db } from '../config/firebase';
import { AppError } from '../errors/AppError';

export async function obtenerPrimerMensaje(): Promise<Record<string, unknown> | null> {
  try {
    const snapshot = await db.collection('ejemplo_sprint0').limit(1).get();

    if (snapshot.empty) {
      return null;
    }

    const document = snapshot.docs[0];
    if (!document) {
      return null;
    }

    return { id: document.id, ...document.data() };
  } catch {
    throw new AppError('No se pudo consultar la base de datos', 503);
  }
}
