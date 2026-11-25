import {
  type DocumentData,
  FieldPath,
  FieldValue,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { AppError } from '../errors/AppError';
import { profileNotFound } from '../errors/userErrors';
import type { Room, RoomMember, Message } from '../types/room';

const ROOMS = 'rooms';

function toRoom(doc: DocumentSnapshot<DocumentData>): Room {
  const data = doc.data() as DocumentData;
  return {
    id: doc.id,
    nombre: data.nombre,
    anfitriónId: data.anfitriónId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function toMember(doc: DocumentSnapshot<DocumentData>): RoomMember {
  const data = doc.data() as DocumentData;
  return { roomId: data.roomId, uid: data.uid, joinedAt: data.joinedAt };
}

function toMessage(doc: DocumentSnapshot<DocumentData>): Message {
  const data = doc.data() as DocumentData;
  return {
    id: doc.id,
    roomId: data.roomId,
    autorId: data.autorId,
    autorNombre: data.autorNombre,
    texto: data.texto,
    createdAt: toISOString(data.createdAt),
  };
}

function toISOString(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
        ? value.toDate()
        : typeof value === 'string'
          ? new Date(value)
          : null;

  if (!date || Number.isNaN(date.getTime())) {
    throw new AppError('El mensaje contiene una fecha inválida', 500, { code: 'INVALID_MESSAGE_DATE' });
  }
  return date.toISOString();
}

function timestampFromCursor(value: string): Timestamp | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new AppError('El cursor de paginación no es válido', 400, { code: 'INVALID_CURSOR' });
    }
    return Timestamp.fromDate(date);
  }
  if (/^\d{10}$|^\d{13}$/.test(value)) {
    const numericValue = Number(value);
    const milliseconds = value.length === 10 ? numericValue * 1000 : numericValue;
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) {
      throw new AppError('El cursor de paginación no es válido', 400, { code: 'INVALID_CURSOR' });
    }
    return Timestamp.fromDate(date);
  }
  return null;
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Error de Firestore (rooms):', error);
    throw new AppError('No se pudo completar la operación con la base de datos', 503, { code: 'DB_ERROR' });
  }
}

export async function findRoomById(roomId: string): Promise<Room | null> {
  return guard(async () => {
    const snap = await db.collection(ROOMS).doc(roomId).get();
    return snap.exists ? toRoom(snap) : null;
  });
}

export async function createRoom(nombre: string, anfitriónId: string): Promise<Room> {
  return guard(async () => {
    const ref = db.collection(ROOMS).doc();
    const now = FieldValue.serverTimestamp();
    await ref.set({
      id: ref.id,
      nombre,
      anfitriónId,
      createdAt: now,
      updatedAt: now,
    });
    const snap = await ref.get();
    return toRoom(snap);
  });
}

/** Salas creadas por el usuario. Filtra en Firestore y ordena en memoria para no requerir índice compuesto. */
export async function listRoomsByHost(anfitriónId: string): Promise<Room[]> {
  return guard(async () => {
    const snap = await db.collection(ROOMS).where('anfitriónId', '==', anfitriónId).get();
    const rooms = snap.docs.map(toRoom);
    const millis = (v: unknown): number =>
      v && typeof (v as { toMillis?: unknown }).toMillis === 'function'
        ? (v as { toMillis: () => number }).toMillis()
        : 0;
    return rooms.sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));
  });
}

export async function updateRoom(roomId: string, nombre: string, uid: string): Promise<Room> {
  return guard(async () => {
    const room = await findRoomById(roomId);
    if (!room) throw new AppError('Sala no encontrada', 404, { code: 'ROOM_NOT_FOUND' });
    if (room.anfitriónId !== uid) throw new AppError('Solo el anfitrión puede editar la sala', 403, { code: 'FORBIDDEN' });

    const ref = db.collection(ROOMS).doc(roomId);
    await ref.update({ nombre, updatedAt: FieldValue.serverTimestamp() });
    const updated = await findRoomById(roomId);
    if (!updated) throw new AppError('Sala no encontrada tras actualizar', 404, { code: 'ROOM_NOT_FOUND' });
    return updated;
  });
}

export async function deleteRoom(roomId: string, uid: string): Promise<void> {
  return guard(async () => {
    const room = await findRoomById(roomId);
    if (!room) throw new AppError('Sala no encontrada', 404, { code: 'ROOM_NOT_FOUND' });
    if (room.anfitriónId !== uid) throw new AppError('Solo el anfitrión puede eliminar la sala', 403, { code: 'FORBIDDEN' });

    const ref = db.collection(ROOMS).doc(roomId);
    for (const collectionName of ['members', 'messages']) {
      const snapshot = await ref.collection(collectionName).get();
      for (let index = 0; index < snapshot.docs.length; index += 500) {
        const batch = db.batch();
        snapshot.docs.slice(index, index + 500).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    await ref.delete();
  });
}

export async function addMember(roomId: string, uid: string): Promise<RoomMember> {
  return guard(async () => {
    const room = await findRoomById(roomId);
    if (!room) throw new AppError('Sala no encontrada', 404, { code: 'ROOM_NOT_FOUND' });

    const ref = db.collection(ROOMS).doc(roomId).collection('members').doc(uid);
    const snap = await ref.get();
    if (snap.exists) return toMember(snap);

    await ref.set({ roomId, uid, joinedAt: FieldValue.serverTimestamp() });
    return { roomId, uid, joinedAt: null };
  });
}

export async function listMembers(roomId: string): Promise<RoomMember[]> {
  return guard(async () => {
    const snap = await db.collection(ROOMS).doc(roomId).collection('members').get();
    return snap.docs.map(toMember);
  });
}

export async function saveMessage(roomId: string, autorId: string, autorNombre: string, texto: string): Promise<Message> {
  return guard(async () => {
    const room = await findRoomById(roomId);
    if (!room) throw new AppError('Sala no encontrada', 404, { code: 'ROOM_NOT_FOUND' });

    const ref = db.collection(ROOMS).doc(roomId).collection('messages').doc();
    const now = FieldValue.serverTimestamp();
    await ref.set({ id: ref.id, roomId, autorId, autorNombre, texto, createdAt: now });

    await db.collection(ROOMS).doc(roomId).update({ updatedAt: now });

    const savedMessage = await ref.get();
    return toMessage(savedMessage);
  });
}

export async function listMessages(roomId: string, limit = 50, before?: string): Promise<Message[]> {
  return guard(async () => {
    const room = await findRoomById(roomId);
    if (!room) throw new AppError('Sala no encontrada', 404, { code: 'ROOM_NOT_FOUND' });

    const messagesRef = db.collection(ROOMS).doc(roomId).collection('messages');
    let query = messagesRef
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (before) {
      const cursorTimestamp = timestampFromCursor(before);
      if (cursorTimestamp) {
        query = query.where('createdAt', '<', cursorTimestamp);
      } else {
        const cursorSnapshot = await messagesRef.doc(before).get();
        if (!cursorSnapshot.exists) {
          throw new AppError('No se encontró el cursor del historial', 400, { code: 'INVALID_CURSOR' });
        }
        query = query.startAfter(cursorSnapshot);
      }
    }

    const snap = await query.limit(limit).get();
    return snap.docs.map(toMessage).reverse();
  });
}

export async function removeMember(roomId: string, uid: string): Promise<void> {
  return guard(async () => {
    await db.collection(ROOMS).doc(roomId).collection('members').doc(uid).delete();
  });
}

export async function findProfileByUid(uid: string): Promise<{ nombre: string } | null> {
  return guard(async () => {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    const data = snap.data() as DocumentData;
    return { nombre: data.nombres ?? data.username ?? '' };
  });
}
