import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import cors from 'cors';
import { auth, db } from './config/firebase';

const app = express();
app.use(cors());
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'realtime' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

type Participant = { uid: string; nombre: string; username: string | null };
type AuthUser = Participant & { email: string | null; name: string };
type RealtimeMessage = {
  id: string;
  roomId: string;
  autorId: string;
  autorNombre: string;
  texto: string;
  createdAt: string;
};
type AckPayload = {
  ok: boolean;
  code?: string;
  message?: string;
  error?: string;
  roomId?: string;
  participants?: Participant[];
  members?: string[];
  id?: string;
  messages?: RealtimeMessage[];
};
type Ack = (payload: AckPayload) => void;

const userBySocket = new Map<string, AuthUser>();
const socketsByRoom = new Map<string, Map<string, Set<string>>>();

async function verifyToken(token: string): Promise<AuthUser> {
  const decoded = await auth.verifyIdToken(token);
  const record = await auth.getUser(decoded.uid).catch(() => null);
  const profileSnapshot = await db.collection('users').doc(decoded.uid).get();
  const profile = profileSnapshot.data();
  const nombre =
    [profile?.nombres, profile?.apellidos]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ') ||
    record?.displayName ||
    decoded.email ||
    'Usuario';
  const username = typeof profile?.username === 'string' ? profile.username : null;

  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    nombre,
    username,
    name: nombre,
  };
}

function getRoomId(input: unknown): string {
  if (typeof input === 'string') return input.trim();
  if (input && typeof input === 'object' && 'roomId' in input) {
    const roomId = input.roomId;
    return typeof roomId === 'string' ? roomId.trim() : '';
  }
  return '';
}

function getText(input: unknown): string {
  if (input && typeof input === 'object' && 'texto' in input) {
    const texto = input.texto;
    return typeof texto === 'string' ? texto.trim() : '';
  }
  return '';
}

function emitRoomError(
  socket: Socket,
  code: string,
  message: string,
  roomId?: string,
  ack?: Ack,
): void {
  const payload = { code, message, ...(roomId ? { roomId } : {}) };
  socket.emit('room:error', payload);
  ack?.({ ok: false, ...payload });
}

function emitChatError(socket: Socket, code: string, message: string, roomId: string, ack?: Ack): void {
  const payload = { code, message, roomId };
  socket.emit('chat:error', payload);
  ack?.({ ok: false, ...payload, error: code });
}

function addSocketToRoom(roomId: string, user: AuthUser, socketId: string): boolean {
  let roomUsers = socketsByRoom.get(roomId);
  if (!roomUsers) {
    roomUsers = new Map();
    socketsByRoom.set(roomId, roomUsers);
  }

  let userSockets = roomUsers.get(user.uid);
  const isNewParticipant = !userSockets || userSockets.size === 0;
  if (!userSockets) {
    userSockets = new Set();
    roomUsers.set(user.uid, userSockets);
  }
  userSockets.add(socketId);
  return isNewParticipant;
}

function removeSocketFromRoom(roomId: string, uid: string, socketId: string): boolean {
  const roomUsers = socketsByRoom.get(roomId);
  const userSockets = roomUsers?.get(uid);
  if (!roomUsers || !userSockets) return false;

  userSockets.delete(socketId);
  if (userSockets.size > 0) return false;

  roomUsers.delete(uid);
  if (roomUsers.size === 0) socketsByRoom.delete(roomId);
  return true;
}

function participantsInRoom(roomId: string): Participant[] {
  const roomUsers = socketsByRoom.get(roomId);
  if (!roomUsers) return [];

  const participants: Participant[] = [];
  for (const socketIds of roomUsers.values()) {
    const socketId = socketIds.values().next().value;
    const user = socketId ? userBySocket.get(socketId) : undefined;
    if (user) {
      participants.push({ uid: user.uid, nombre: user.nombre, username: user.username });
    }
  }
  return participants;
}

function roomsForSocket(socketId: string): string[] {
  const rooms: string[] = [];
  for (const [roomId, roomUsers] of socketsByRoom) {
    for (const socketIds of roomUsers.values()) {
      if (socketIds.has(socketId)) {
        rooms.push(roomId);
        break;
      }
    }
  }
  return rooms;
}

async function joinRoom(socket: Socket, input: unknown, ack?: Ack): Promise<void> {
  const roomId = getRoomId(input);
  if (!roomId) {
    emitRoomError(socket, 'ROOM_ID_REQUIRED', 'El ID de la sala es obligatorio', undefined, ack);
    return;
  }

  try {
    const roomSnapshot = await db.collection('rooms').doc(roomId).get();
    if (!roomSnapshot.exists) {
      emitRoomError(socket, 'ROOM_NOT_FOUND', 'Sala no encontrada', roomId, ack);
      return;
    }

    const user = socket.data.user as AuthUser;
    await socket.join(roomId);
    const isNewParticipant = addSocketToRoom(roomId, user, socket.id);
    const participants = participantsInRoom(roomId);
    socket.emit('room:joined', { roomId, participants });

    if (isNewParticipant) {
      socket.to(roomId).emit('room:user-joined', {
        roomId,
        uid: user.uid,
        nombre: user.nombre,
        username: user.username,
      });
      socket.to(roomId).emit('user-joined', {
        roomId,
        uid: user.uid,
        name: user.name,
        members: participants.map((participant) => participant.uid),
      });
    }
    ack?.({
      ok: true,
      roomId,
      participants,
      members: participants.map((participant) => participant.uid),
    });
  } catch {
    emitRoomError(socket, 'ROOM_JOIN_FAILED', 'No se pudo ingresar a la sala', roomId, ack);
  }
}

async function leaveRoom(socket: Socket, input: unknown, ack?: Ack): Promise<void> {
  const roomId = getRoomId(input);
  if (!roomId) {
    emitRoomError(socket, 'ROOM_ID_REQUIRED', 'El ID de la sala es obligatorio', undefined, ack);
    return;
  }

  if (!socket.rooms.has(roomId)) {
    ack?.({ ok: true, roomId });
    return;
  }

  const user = socket.data.user as AuthUser;
  try {
    await socket.leave(roomId);
  } catch {
    emitRoomError(socket, 'ROOM_LEAVE_FAILED', 'No se pudo salir de la sala', roomId, ack);
    return;
  }
  const wasLastSocket = removeSocketFromRoom(roomId, user.uid, socket.id);
  if (wasLastSocket) {
    io.to(roomId).emit('room:user-left', { roomId, uid: user.uid, nombre: user.nombre, username: user.username });
    io.to(roomId).emit('user-left', { roomId, uid: user.uid, name: user.name });
  }
  ack?.({ ok: true, roomId });
}

async function sendMessage(socket: Socket, input: unknown, ack?: Ack): Promise<void> {
  const roomId = getRoomId(input);
  if (!roomId) {
    emitChatError(socket, 'ROOM_ID_REQUIRED', 'El ID de la sala es obligatorio', roomId, ack);
    return;
  }
  if (!socket.rooms.has(roomId)) {
    emitChatError(socket, 'NOT_IN_ROOM', 'Debes ingresar a la sala antes de enviar mensajes', roomId, ack);
    return;
  }

  const texto = getText(input);
  if (!texto) {
    emitChatError(socket, 'EMPTY_MESSAGE', 'El mensaje no puede estar vacío', roomId, ack);
    return;
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnapshot = await roomRef.get();
    if (!roomSnapshot.exists) {
      emitChatError(socket, 'ROOM_NOT_FOUND', 'Sala no encontrada', roomId, ack);
      return;
    }

    const user = socket.data.user as AuthUser;
    const messageRef = roomRef.collection('messages').doc();
    const createdAt = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(messageRef, {
      id: messageRef.id,
      roomId,
      autorId: user.uid,
      autorNombre: user.nombre,
      texto,
      createdAt,
    });
    batch.update(roomRef, { updatedAt: createdAt });
    await batch.commit();

    const messageSnapshot = await messageRef.get();
    const timestamp = messageSnapshot.get('createdAt');
    if (!(timestamp instanceof Timestamp)) throw new Error('Firestore no devolvió el timestamp del mensaje');

    const message: RealtimeMessage = {
      id: messageRef.id,
      roomId,
      autorId: user.uid,
      autorNombre: user.nombre,
      texto,
      createdAt: timestamp.toDate().toISOString(),
    };
    io.to(roomId).emit('chat:message', message);
    io.to(roomId).emit('chat-message', message);
    ack?.({ ok: true, id: message.id });
  } catch {
    emitChatError(socket, 'MESSAGE_SEND_FAILED', 'No se pudo enviar el mensaje', roomId, ack);
  }
}

async function deleteRoom(socket: Socket, input: unknown, ack?: Ack): Promise<void> {
  const roomId = getRoomId(input);
  if (!roomId) {
    emitRoomError(socket, 'ROOM_ID_REQUIRED', 'El ID de la sala es obligatorio', undefined, ack);
    return;
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnapshot = await roomRef.get();
    if (!roomSnapshot.exists) {
      emitRoomError(socket, 'ROOM_NOT_FOUND', 'Sala no encontrada', roomId, ack);
      return;
    }

    const user = socket.data.user as AuthUser;
    if (roomSnapshot.get('anfitriónId') !== user.uid) {
      emitRoomError(socket, 'FORBIDDEN', 'Solo el anfitrión puede eliminar la sala', roomId, ack);
      return;
    }

    for (const collectionName of ['members', 'messages'] as const) {
      const collectionRef = roomRef.collection(collectionName);
      while (true) {
        const snapshot = await collectionRef.limit(500).get();
        if (snapshot.empty) break;
        const batch = db.batch();
        snapshot.docs.forEach((document) => batch.delete(document.ref));
        await batch.commit();
      }
    }
    await roomRef.delete();

    io.to(roomId).emit('room:deleted', { roomId, message: 'La sala fue eliminada por el anfitrión' });
    io.in(roomId).socketsLeave(roomId);
    socketsByRoom.delete(roomId);
    ack?.({ ok: true, roomId });
  } catch {
    emitRoomError(socket, 'ROOM_DELETE_FAILED', 'No se pudo eliminar la sala', roomId, ack);
  }
}

/* -------- Middleware de autenticación en el handshake -------- */
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error('No se proporcionó token de Firebase'));
    return;
  }
  try {
    socket.data.user = await verifyToken(token);
    next();
  } catch {
    next(new Error('Token de Firebase inválido o expirado'));
  }
});

io.on('connection', (socket: Socket) => {
  const user = socket.data.user as AuthUser;
  userBySocket.set(socket.id, user);

  socket.on('room:join', (input: unknown, ack?: Ack) => {
    void joinRoom(socket, input, ack);
  });
  socket.on('join-room', (input: unknown, ack?: Ack) => {
    void joinRoom(socket, input, ack);
  });

  socket.on('room:leave', (input: unknown, ack?: Ack) => {
    void leaveRoom(socket, input, ack);
  });
  socket.on('leave-room', (input: unknown, ack?: Ack) => {
    void leaveRoom(socket, input, ack);
  });

  socket.on('chat:send', (input: unknown, ack?: Ack) => {
    void sendMessage(socket, input, ack);
  });
  socket.on('chat-message', (input: unknown, ack?: Ack) => {
    void sendMessage(socket, input, ack);
  });

  socket.on('room:delete', (input: unknown, ack?: Ack) => {
    void deleteRoom(socket, input, ack);
  });

  socket.on('chat-history', async (input: unknown, ack?: Ack) => {
    const roomId = getRoomId(input);
    if (!roomId) {
      ack?.({ ok: false, code: 'ROOM_ID_REQUIRED', error: 'El ID de la sala es obligatorio' });
      return;
    }
    if (!socket.rooms.has(roomId)) {
      ack?.({ ok: false, code: 'NOT_IN_ROOM', error: 'Debes ingresar a la sala para consultar el historial' });
      return;
    }

    try {
      const limitInput = input && typeof input === 'object' && 'limit' in input ? input.limit : undefined;
      const requestedLimit = typeof limitInput === 'number' && Number.isFinite(limitInput) ? Math.trunc(limitInput) : 50;
      const limit = Math.max(1, Math.min(100, requestedLimit));
      const roomRef = db.collection('rooms').doc(roomId);
      const roomSnapshot = await roomRef.get();
      if (!roomSnapshot.exists) {
        ack?.({ ok: false, code: 'ROOM_NOT_FOUND', error: 'Sala no encontrada' });
        return;
      }

      const snapshot = await roomRef.collection('messages').orderBy('createdAt', 'desc').limit(limit).get();
      const messages = snapshot.docs
        .map((document): RealtimeMessage => {
          const data = document.data();
          const timestamp = data.createdAt;
          if (!(timestamp instanceof Timestamp)) throw new Error('Mensaje con fecha inválida');
          return {
            id: document.id,
            roomId,
            autorId: data.autorId,
            autorNombre: data.autorNombre,
            texto: data.texto,
            createdAt: timestamp.toDate().toISOString(),
          };
        })
        .reverse();
      ack?.({ ok: true, messages });
    } catch {
      ack?.({ ok: false, code: 'HISTORY_LOAD_FAILED', error: 'No se pudo cargar el historial' });
    }
  });

  /* -------- Signaling WebRTC -------- */
  socket.on('webrtc-offer', (payload: { roomId: string; targetUid: string; offer: unknown }) => {
    const targetSocket = findSocketByUid(payload.targetUid);
    if (targetSocket) {
      io.to(targetSocket).emit('webrtc-offer', { fromUid: user.uid, fromName: user.name, offer: payload.offer });
    }
  });

  socket.on('webrtc-answer', (payload: { roomId: string; targetUid: string; answer: unknown }) => {
    const targetSocket = findSocketByUid(payload.targetUid);
    if (targetSocket) {
      io.to(targetSocket).emit('webrtc-answer', { fromUid: user.uid, answer: payload.answer });
    }
  });

  socket.on('webrtc-ice-candidate', (payload: { roomId: string; targetUid: string; candidate: unknown }) => {
    const targetSocket = findSocketByUid(payload.targetUid);
    if (targetSocket) {
      io.to(targetSocket).emit('webrtc-ice-candidate', { fromUid: user.uid, candidate: payload.candidate });
    }
  });

  socket.on('disconnect', () => {
    for (const roomId of roomsForSocket(socket.id)) {
      const wasLastSocket = removeSocketFromRoom(roomId, user.uid, socket.id);
      if (wasLastSocket) {
        io.to(roomId).emit('room:user-left', {
          roomId,
          uid: user.uid,
          nombre: user.nombre,
          username: user.username,
        });
        io.to(roomId).emit('user-left', { roomId, uid: user.uid, name: user.name });
      }
    }
    userBySocket.delete(socket.id);
  });

  const reconnectRoomId = socket.handshake.auth?.roomId;
  if (typeof reconnectRoomId === 'string' && reconnectRoomId.trim()) {
    void joinRoom(socket, reconnectRoomId);
  }
});

function findSocketByUid(uid: string): string | undefined {
  for (const [socketId, user] of userBySocket) {
    if (user.uid === uid) return socketId;
  }
  return undefined;
}

const port = Number(process.env.PORT) || 3002;
httpServer.listen(port, () => {
  console.log(`Realtime service listening on port ${port}`);
});
