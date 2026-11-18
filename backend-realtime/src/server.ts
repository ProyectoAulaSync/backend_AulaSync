import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import cors from 'cors';
import { auth, db } from './config/firebase';
import { AppError } from './errors/AppError';

const app = express();
app.use(cors());
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'realtime' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

type AuthUser = { uid: string; email: string | null; name: string };

const userBySocket = new Map<string, AuthUser>();
const socketsByRoom = new Map<string, Set<string>>();

async function verifyToken(token: string): Promise<AuthUser> {
  const decoded = await auth.verifyIdToken(token);
  const record = await auth.getUser(decoded.uid).catch(() => null);
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: record?.displayName ?? decoded.email ?? 'Usuario',
  };
}

function addSocketToRoom(roomId: string, socketId: string): void {
  let set = socketsByRoom.get(roomId);
  if (!set) {
    set = new Set();
    socketsByRoom.set(roomId, set);
  }
  set.add(socketId);
}

function removeSocketFromRoom(roomId: string, socketId: string): void {
  const set = socketsByRoom.get(roomId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) socketsByRoom.delete(roomId);
}

function socketsInRoom(roomId: string): string[] {
  return Array.from(socketsByRoom.get(roomId) ?? []);
}

/* -------- Middleware de autenticación en el handshake -------- */
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error('No se proporcionó token de Firebase'));
  }
  try {
    const user = await verifyToken(token);
    socket.data.user = user;
    userBySocket.set(socket.id, user);
    next();
  } catch {
    return next(new Error('Token de Firebase inválido o expirado'));
  }
});

io.on('connection', (socket: Socket) => {
  const user = socket.data.user as AuthUser;

  socket.on('join-room', async (roomId: string, ack?: (payload: { ok: boolean; members: string[] }) => void) => {
    try {
      socket.join(roomId);
      addSocketToRoom(roomId, socket.id);

      // Guardar presencia en Firestore
      await db.collection('presence').doc(`${roomId}:${socket.id}`).set({
        roomId,
        uid: user.uid,
        name: user.name,
        socketId: socket.id,
        joinedAt: new Date().toISOString(),
      });

      const members: string[] = [];
      for (const sid of socketsInRoom(roomId)) {
        const u = userBySocket.get(sid);
        if (u) members.push(u.uid);
      }
      io.to(roomId).emit('user-joined', { roomId, uid: user.uid, name: user.name, members });
      ack?.({ ok: true, members });
    } catch (err) {
      ack?.({ ok: false, members: [] });
      console.error('join-room error:', err);
    }
  });

  socket.on('leave-room', (roomId: string, ack?: () => void) => {
    socket.leave(roomId);
    removeSocketFromRoom(roomId, socket.id);
    db.collection('presence').doc(`${roomId}:${socket.id}`).delete().catch(() => {});
    io.to(roomId).emit('user-left', { roomId, uid: user.uid, name: user.name });
    ack?.();
  });

  socket.on(
    'chat-message',
    async (payload: { roomId: string; texto: string }, ack?: (payload: { ok: boolean; id?: string; error?: string }) => void) => {
      try {
        const { roomId, texto } = payload;

        // Validación 1: mensaje no vacío
        if (!texto || !texto.trim()) {
          ack?.({ ok: false, error: 'El mensaje no puede estar vacío' });
          return;
        }

        // Validación 2: usuario miembro de la sala
        if (!socketsInRoom(roomId).includes(socket.id)) {
          ack?.({ ok: false, error: 'No eres miembro de esta sala' });
          return;
        }

        const roomRef = db.collection('rooms').doc(roomId);
        const roomSnap = await roomRef.get();
        if (!roomSnap.exists) {
          ack?.({ ok: false, error: 'Sala no encontrada' });
          return;
        }

        const msgRef = roomRef.collection('messages').doc();
        await msgRef.set({
          id: msgRef.id,
          roomId,
          autorId: user.uid,
          autorNombre: user.name,
          texto,
          createdAt: new Date().toISOString(),
        });

        const message = { id: msgRef.id, roomId, autorId: user.uid, autorNombre: user.name, texto, createdAt: new Date().toISOString() };
        io.to(roomId).emit('chat-message', message);
        ack?.({ ok: true, id: msgRef.id });
      } catch (err) {
        console.error('chat-message error:', err);
        ack?.({ ok: false, error: 'No se pudo enviar el mensaje' });
      }
    },
  );

  socket.on('chat-history', async (payload: { roomId: string; limit?: number }, ack?: (payload: { ok: boolean; messages?: any[]; error?: string }) => void) => {
    try {
      const { roomId, limit = 50 } = payload;
      const snap = await db.collection('rooms').doc(roomId).collection('messages').orderBy('createdAt', 'desc').limit(limit).get();
      const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
      ack?.({ ok: true, messages });
    } catch (err) {
      ack?.({ ok: false, error: 'No se pudo cargar el historial' });
    }
  });

  /* -------- Signaling WebRTC -------- */
  socket.on('webrtc-offer', (payload: { roomId: string; targetUid: string; offer: any }) => {
    const targetSocket = findSocketByUid(payload.targetUid);
    if (targetSocket) {
      io.to(targetSocket).emit('webrtc-offer', { fromUid: user.uid, fromName: user.name, offer: payload.offer });
    }
  });

  socket.on('webrtc-answer', (payload: { roomId: string; targetUid: string; answer: any }) => {
    const targetSocket = findSocketByUid(payload.targetUid);
    if (targetSocket) {
      io.to(targetSocket).emit('webrtc-answer', { fromUid: user.uid, answer: payload.answer });
    }
  });

  socket.on('webrtc-ice-candidate', (payload: { roomId: string; targetUid: string; candidate: any }) => {
    const targetSocket = findSocketByUid(payload.targetUid);
    if (targetSocket) {
      io.to(targetSocket).emit('webrtc-ice-candidate', { fromUid: user.uid, candidate: payload.candidate });
    }
  });

  socket.on('disconnect', () => {
    const rooms = socketsInRoomFromSocket(socket.id);
    rooms.forEach((roomId) => {
      removeSocketFromRoom(roomId, socket.id);
      db.collection('presence').doc(`${roomId}:${socket.id}`).delete().catch(() => {});
      io.to(roomId).emit('user-left', { roomId, uid: user.uid, name: user.name });
    });
    userBySocket.delete(socket.id);
  });
});

function findSocketByUid(uid: string): string | undefined {
  for (const [sid, u] of userBySocket.entries()) {
    if (u.uid === uid) return sid;
  }
  return undefined;
}

function socketsInRoomFromSocket(socketId: string): string[] {
  const result: string[] = [];
  for (const [roomId, set] of socketsByRoom.entries()) {
    if (set.has(socketId)) result.push(roomId);
  }
  return result;
}

const port = Number(process.env.PORT) || 3002;
httpServer.listen(port, () => {
  console.log(`Realtime service listening on port ${port}`);
});
