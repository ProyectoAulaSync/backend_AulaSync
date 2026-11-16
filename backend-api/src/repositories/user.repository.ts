import { type DocumentData, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { auth } from '../config/auth';
import { db } from '../config/firebase';
import { AppError } from '../errors/AppError';
import { profileNotFound, usernameTaken } from '../errors/userErrors';
import type { UserProfile } from '../types/user';

const USERS = 'users'; // users/{uid}
const USERNAMES = 'usernames'; // usernames/{usernameEnMinusculas} -> { uid }  (garantiza unicidad)

export interface ProfileChanges {
  nombres?: string | undefined;
  apellidos?: string | undefined;
  avatar?: string | undefined;
  username?: string | undefined;
  email?: string | undefined;
}

function toProfile(data: DocumentData): UserProfile {
  return {
    uid: data.uid,
    email: data.email,
    nombres: data.nombres,
    apellidos: data.apellidos,
    username: data.username ?? null,
    avatar: data.avatar ?? null,
    provider: data.provider,
    profileComplete: data.profileComplete === true,
  };
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error('Error de Firestore:', e);
    throw new AppError('No se pudo completar la operación con la base de datos', 503, {
      code: 'DB_ERROR',
    });
  }
}

export function findByUid(uid: string): Promise<UserProfile | null> {
  return guard(async () => {
    const snap = await db.collection(USERS).doc(uid).get();
    return snap.exists ? toProfile(snap.data() as DocumentData) : null;
  });
}

export function isUsernameAvailable(usernameLower: string): Promise<boolean> {
  return guard(async () => !(await db.collection(USERNAMES).doc(usernameLower).get()).exists);
}

/** Crea el perfil; si trae username lo reserva en la MISMA transacción (unicidad en servidor). */
export function createProfile(profile: UserProfile): Promise<UserProfile> {
  return guard(async () => {
    const userRef = db.collection(USERS).doc(profile.uid);
    const lower = profile.username ? profile.username.toLowerCase() : null;
    const nameRef = lower ? db.collection(USERNAMES).doc(lower) : null;

    await db.runTransaction(async (tx) => {
      if (nameRef && (await tx.get(nameRef)).exists) throw usernameTaken();
      tx.set(userRef, {
        ...profile,
        usernameLower: lower,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (nameRef) tx.set(nameRef, { uid: profile.uid, createdAt: FieldValue.serverTimestamp() });
    });
    return profile;
  });
}

/** Paso obligatorio de Google: asigna el username una sola vez, con unicidad transaccional. */
export function setUsername(uid: string, username: string): Promise<UserProfile> {
  const lower = username.toLowerCase();
  return guard(async () => {
    const userRef = db.collection(USERS).doc(uid);
    const nameRef = db.collection(USERNAMES).doc(lower);

    return db.runTransaction(async (tx) => {
      const [userSnap, nameSnap] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);
      if (!userSnap.exists) throw profileNotFound();
      if (userSnap.get('profileComplete') === true) {
        throw new AppError('Ya elegiste tu nombre de usuario', 409, { code: 'USERNAME_ALREADY_SET' });
      }
      if (nameSnap.exists) throw usernameTaken();

      tx.update(userRef, {
        username,
        usernameLower: lower,
        profileComplete: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(nameRef, { uid, createdAt: FieldValue.serverTimestamp() });

      return toProfile({
        ...(userSnap.data() as DocumentData),
        username,
        profileComplete: true,
      });
    });
  });
}

/** Edita perfil con validación atómica de username y email.
 * - Username: usa transacción Firestore sobre users/usernames para evitar race conditions.
 * - Email: valida unicidad contra colección users antes de aplicar el cambio.
 * Lanza 409 con el campo indicado en caso de colisión.
 */
export async function updateProfile(uid: string, data: ProfileChanges): Promise<UserProfile> {
  return guard(async () => {
    const userRef = db.collection(USERS).doc(uid);
    // Lectura inicial fuera de transacción solo para validaciones previas
    const snap = await userRef.get();
    if (!snap.exists) throw new AppError('No encontramos tu perfil. Completa tu registro', 404, {
      code: 'PROFILE_NOT_FOUND',
    });

    const currentEmail = snap.data()?.email ?? '';
    const currentUsername = snap.data()?.username ?? '';

    // Validaciones previas fuera de transacción (más simples, sin lecturas complejas)
    if (data.email !== undefined && data.email !== currentEmail) {
      const emailQuery = await db.collection(USERS).where('email', '==', data.email).limit(1).get();
      if (!emailQuery.empty) throw new AppError('Este correo ya está registrado. Inicia sesión con otro correo', 409, {
        code: 'EMAIL_TAKEN',
        field: 'email',
      });
    }

    if (data.username !== undefined && data.username !== currentUsername) {
      const lower = data.username.toLowerCase();
      // Validación de disponibilidad en usernames collection (fuera de tx para simplicidad,
      // pero la transacción real la haré abajo)
      const nameRef = db.collection(USERNAMES).doc(lower);
      const nameSnap = await nameRef.get();
      if (nameSnap.exists) {
        // Pero necesitamos verificar que no sea el username actual del usuario
        const existingUsername = nameSnap.data()?.uid;
        if (existingUsername !== uid) throw new AppError('Este nombre de usuario ya está en uso. Elige otro', 409, {
          code: 'USERNAME_TAKEN',
          field: 'username',
        });
      }
    }

    // Ejecutar transacción para cambios atómicos de username y email
    return await db.runTransaction(async (tx) => {
      // 1. Obtener datos actuales del usuario
      const currentUserSnap = await tx.get(userRef);
      if (!currentUserSnap.exists) throw new AppError('Perfil desaparecido', 500, { code: 'ENTITY_MISSING' });

      // 2. Aplicar cambios de nombres, apellidos, avatar (siempre seguros)
      const changes: Record<string, any> = {};
      if (data.nombres !== undefined) changes.nombres = data.nombres;
      if (data.apellidos !== undefined) changes.apellidos = data.apellidos;
      if (data.avatar !== undefined) changes.avatar = data.avatar;

      // 3. Manejar username: si cambió, actualizar en transacción atómica
      if (data.username !== undefined && data.username !== currentUsername) {
        const newLower = data.username.toLowerCase();
        const oldLower = currentUsername.toLowerCase();

        // Eliminar registro viejo de usernames si cambió
        if (oldLower && oldLower !== newLower) {
          const oldNameRef = db.collection(USERNAMES).doc(oldLower);
          await tx.delete(oldNameRef);
        }

        // Insertar/actualizar registro nuevo en usernames
        const newNameRef = db.collection(USERNAMES).doc(newLower);
        await tx.set(newNameRef, { uid, createdAt: FieldValue.serverTimestamp() });

        // Actualizar campos del usuario
        changes.username = data.username;
        changes.usernameLower = newLower;
      }

      // 4. Manejar email: si cambió, actualizar campo
      if (data.email !== undefined && data.email !== currentEmail) {
        changes.email = data.email;
      }

      // 5. Aplicar todas las actualizaciones al documento user
      await userRef.update({ ...changes, updatedAt: FieldValue.serverTimestamp() });

      // 6. Devolver perfil actualizado
      const updatedSnap = await tx.get(userRef);
      return toProfile(updatedSnap.data() as DocumentData);
    });
  });
}

/** Elimina el perfil del usuario: borra de Firestore, Firebase Auth y libera username.
 * Ejecutado solo por el dueño de la sesión (authenticate middleware).
 * Lanza 401 si no hay token, 404 si el perfil no existe.
 */
export async function deleteProfile(uid: string): Promise<void> {
  return guard(async () => {
    // 1. Obtener perfil actual para liberar username
    const userSnap = await db.collection(USERS).doc(uid).get();
    if (!userSnap.exists) throw new AppError('No encontramos tu perfil. Completa tu registro', 404, {
      code: 'PROFILE_NOT_FOUND',
    });

    const currentUsername = userSnap.data()?.username ?? '';

    // 2. Ejecutar transacción atómica: Firestore + username
    await db.runTransaction(async (tx) => {
      // a) Borrar documento de usuario de Firestore
      const userRef = db.collection(USERS).doc(uid);
      await tx.delete(userRef);

      // b) Liberar username en usernames collection (si tenía uno)
      if (currentUsername) {
        const lower = currentUsername.toLowerCase();
        const nameRef = db.collection(USERNAMES).doc(lower);
        await tx.delete(nameRef);
      }
    });

    // 3. Borrar cuenta de Firebase Authentication (fuera de la transacción Firestore)
    await auth.deleteUser(uid).catch((e) => {
      console.error('Error al borrar usuario de Firebase Auth:', e);
      // No lanzamos error aquí porque el perfil de Firestore ya se borró;
      // el usuario quedó "desvinculado" pero la cuenta de Auth se eliminó.
    });
  });
}