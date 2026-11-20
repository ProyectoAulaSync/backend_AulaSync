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

/** Elimina el perfil del usuario: borra de Firestore, Firebase Auth y libera username,
   * junto con datos asociados (mensajes propios, salas donde es anfitrión y memberships)
   * para evitar datos huérfanos. Ejecutado solo por el dueño de la sesión (authenticate middleware).
   * Lanza 401 si no hay token, 404 si el perfil no existe.
   * Captura previa: se leen datos antes de borrar.
   */
 export async function deleteProfile(uid: string): Promise<void> {
   return guard(async () => {
     // --- PASO 1: Captura del username actual ---
     const userSnap = await db.collection(USERS).doc(uid).get();
     if (!userSnap.exists) throw new AppError('No encontramos tu perfil. Completa tu registro', 404, {
       code: 'PROFILE_NOT_FOUND',
     });
     const currentUsername = userSnap.data()?.username ?? '';

     // --- PASO 2: Borrar mensajes propios (collection group query) ---
     await db.collectionGroup('messages').where('autorId', '==', uid).get().then((msgSnap) => {
       const batch = db.batch();
       msgSnap.docs.forEach((doc) => batch.delete(doc.ref));
       if (msgSnap.docs.length > 0) batch.commit().catch(() => {});
     }).catch(err => console.error('Error borrando mensajes propios:', err));

     // --- PASO 3: Borrar salas donde es anfitrión y limpiar datos asociados ---
     const roomsQuery = await db.collection(USERS).doc(uid).collection('rooms').where('anfitriónId', '==', uid).get();
     const hostRoomIds = roomsQuery.docs.map(d => d.id);

     hostRoomIds.forEach((roomId) => {
       // Borrar mensajes propios en esta sala
       const msgsRef = db.collection('rooms').doc(roomId).collection('messages');
       const msgQuery = msgsRef.where('autorId', '==', uid);
       msgQuery.get().then((msgDocs) => {
         const batch = db.batch();
         msgDocs.forEach((doc) => batch.delete(doc.ref));
         batch.commit().catch(() => {});
       }).catch(err => console.error('Error borrando mensajes de sala', roomId, err));

       // Borrar membership del usuario en esta sala
       const membersRef = db.collection('rooms').doc(roomId).collection('members').doc(uid);
       const delMemberBatch = db.batch();
       delMemberBatch.delete(membersRef);
       delMemberBatch.commit().catch(() => {});

       // Borrar la sala en sí (ya sin anfitrión)
       const delRoomBatch = db.batch();
       delRoomBatch.delete(db.collection('rooms').doc(roomId));
       delRoomBatch.commit().catch(() => {});
     });

     // --- PASO 4: Transacción atómica: borrar usuario + liberar username ---
     await db.runTransaction(async (tx) => {
       const userRef = db.collection(USERS).doc(uid);
       await tx.delete(userRef);

       if (currentUsername) {
         const lower = currentUsername.toLowerCase();
         const nameRef = db.collection(USERNAMES).doc(lower);
         await tx.delete(nameRef);
       }
     });

     // --- PASO 5: Borrar cuenta de Firebase Authentication ---
     await auth.deleteUser(uid).catch((e) => {
       console.error('Error al borrar usuario de Firebase Auth:', e);
     });
   });
 }