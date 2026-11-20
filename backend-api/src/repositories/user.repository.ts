import { type DocumentData, FieldPath, FieldValue, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { auth } from '../config/auth';
import { db } from '../config/firebase';
import { AppError } from '../errors/AppError';
import { profileNotFound, usernameTaken } from '../errors/userErrors';
import type { UserProfile } from '../types/user';

const USERS = 'users'; // users/{uid}
const USERNAMES = 'usernames'; // usernames/{usernameEnMinusculas} -> { uid }  (garantiza unicidad)
const ROOMS = 'rooms';
const DELETE_BATCH_SIZE = 500;

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

async function deleteQueryInBatches(query: Query<DocumentData>): Promise<void> {
  while (true) {
    const snapshot = await query.limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) return;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function deleteUserMemberships(uid: string): Promise<void> {
  const roomsQuery = db.collection(ROOMS).orderBy(FieldPath.documentId());
  let lastRoom: QueryDocumentSnapshot<DocumentData> | undefined;

  while (true) {
    const query = lastRoom
      ? roomsQuery.startAfter(lastRoom).limit(DELETE_BATCH_SIZE)
      : roomsQuery.limit(DELETE_BATCH_SIZE);
    const snapshot = await query.get();
    if (snapshot.empty) return;

    const batch = db.batch();
    snapshot.docs.forEach((room) => {
      batch.delete(room.ref.collection('members').doc(uid));
    });
    await batch.commit();
    lastRoom = snapshot.docs[snapshot.docs.length - 1];
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

    return await db.runTransaction(async (tx) => {
      const currentUserSnap = await tx.get(userRef);
      if (!currentUserSnap.exists) throw new AppError('Perfil desaparecido', 500, { code: 'ENTITY_MISSING' });

      const currentUser = currentUserSnap.data() as DocumentData;
      const transactionUsername = currentUser.username ?? '';
      const usernameChanged = data.username !== undefined && data.username !== transactionUsername;
      const newLower = data.username?.toLowerCase() ?? '';
      const oldLower = usernameChanged ? transactionUsername.toLowerCase() : '';
      const newNameRef = usernameChanged ? db.collection(USERNAMES).doc(newLower) : null;
      const oldNameRef = usernameChanged && oldLower && oldLower !== newLower
        ? db.collection(USERNAMES).doc(oldLower)
        : null;

      let newNameSnap = null;
      if (newNameRef) {
        newNameSnap = await tx.get(newNameRef);
      }
      if (oldNameRef) {
        await tx.get(oldNameRef);
      }

      if (newNameSnap?.exists && newNameSnap.data()?.uid !== uid) {
        throw new AppError('Este nombre de usuario ya está en uso. Elige otro', 409, {
          code: 'USERNAME_TAKEN',
          field: 'username',
        });
      }

      const changes: Record<string, any> = {};
      if (data.nombres !== undefined) changes.nombres = data.nombres;
      if (data.apellidos !== undefined) changes.apellidos = data.apellidos;
      if (data.avatar !== undefined) changes.avatar = data.avatar;

      if (usernameChanged && newNameRef && data.username !== undefined) {
        if (oldNameRef) tx.delete(oldNameRef);
        tx.set(newNameRef, { uid, createdAt: FieldValue.serverTimestamp() });
        changes.username = data.username;
        changes.usernameLower = newLower;
      }

      if (data.email !== undefined && data.email !== currentEmail) {
        changes.email = data.email;
      }

      tx.update(userRef, { ...changes, updatedAt: FieldValue.serverTimestamp() });
      return toProfile({ ...currentUser, ...changes });
    });
  });
}

/** Borra los datos asociados y elimina la cuenta de Auth al final para permitir reintentos. */
export async function deleteProfile(uid: string): Promise<void> {
  return guard(async () => {
    await deleteQueryInBatches(db.collectionGroup('messages').where('autorId', '==', uid));
    await deleteUserMemberships(uid);

    const hostRoomsQuery = db.collection(ROOMS).where('anfitriónId', '==', uid);
    while (true) {
      const roomsSnapshot = await hostRoomsQuery.limit(DELETE_BATCH_SIZE).get();
      if (roomsSnapshot.empty) break;

      for (const room of roomsSnapshot.docs) {
        await deleteQueryInBatches(room.ref.collection('members'));
        await deleteQueryInBatches(room.ref.collection('messages'));
        await room.ref.delete();
      }
    }

    await deleteQueryInBatches(db.collection(USERNAMES).where('uid', '==', uid));
    await db.collection(USERS).doc(uid).delete();

    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'auth/user-not-found'
      ) {
        return;
      }

      console.error('Error al borrar usuario de Firebase Auth:', error);
      throw new AppError('No se pudo eliminar la cuenta de Firebase Authentication', 500, {
        code: 'AUTH_DELETE_FAILED',
      });
    }
  });
}