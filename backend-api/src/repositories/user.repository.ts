import { type DocumentData, FieldValue } from 'firebase-admin/firestore';
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
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Error de Firestore:', error);
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

/** Edita campos no únicos del perfil (el cambio de username llega en US-04, Sprint siguiente). */
export function updateProfile(uid: string, data: ProfileChanges): Promise<UserProfile> {
  return guard(async () => {
    const ref = db.collection(USERS).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) throw profileNotFound();

    const changes: Record<string, string> = {};
    if (data.nombres !== undefined) changes.nombres = data.nombres;
    if (data.apellidos !== undefined) changes.apellidos = data.apellidos;
    if (data.avatar !== undefined) changes.avatar = data.avatar;

    await ref.update({ ...changes, updatedAt: FieldValue.serverTimestamp() });
    return toProfile({ ...(snap.data() as DocumentData), ...changes });
  });
}
