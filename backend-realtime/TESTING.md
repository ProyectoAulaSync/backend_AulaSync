# Pruebas de Propiedad — Backend Realtime (Socket.IO)

Este documento especifica las pruebas de propiedad (control de acceso y aislamiento) que deben validarse en el servidor de tiempo real con Socket.IO para garantizar que:

- Solo usuarios con sesión Firebase válida pueden conectar
- Los mensajes, presencia y señales WebRTC solo llegan a los miembros de la misma sala
- Un usuario no puede enviar mensajes a salas donde no es miembro
- La presencia (entrada/salida) solo se anuncia dentro de la misma sala

---

## 1. Propiedades verificadas

| ID | Propiedad | Evento Socket.IO | Resultado esperado |
|----|-----------|------------------|-------------------|
| RT-1 | Solo usuarios con token Firebase válido conectan | handshake (conexión) | 401 / `connect_error` sin token o con token inválido |
| RT-2 | Un usuario no puede enviar mensajes a una sala donde no es miembro | `chat-message` | `{ ok: false, error: 'No eres miembro de esta sala' }` |
| RT-3 | Un usuario no puede enviar mensajes vacíos | `chat-message` | `{ ok: false, error: 'El mensaje no puede estar vacío' }` |
| RT-4 | Mensajes solo se emiten a miembros de la misma sala | `chat-message` | Solo receptores en `roomId` reciben el evento |
| RT-5 | Presencia de entrada solo se anuncia a miembros de la sala | `join-room` → `user-joined` | Solo sockets en `roomId` reciben el evento |
| RT-6 | Presencia de salida solo se anuncia a miembros de la sala | `leave-room` / `disconnect` → `user-left` | Solo sockets en `roomId` reciben el evento |
| RT-7 | WebRTC signaling solo llega al usuario destino | `webrtc-offer` / `webrtc-answer` / `webrtc-ice-candidate` | Solo el socket del `targetUid` recibe el evento |
| RT-8 | Unirse a una sala inexistente | `join-room` | `{ ok: false }` (o error de Firestore) |

---

## 2. Cómo se aplican las propiedades en el código

### RT-1 — Autenticación en handshake

**Código:** `src/server.ts:55-68`
```typescript
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
```

**Propiedad:** Si no hay token o el token es inválido, `next(error)` rechaza la conexión con `connect_error`.

---

### RT-2 — Mensaje solo si el usuario es miembro de la sala

**Código:** `src/server.ts:120-124`
```typescript
if (!socketsInRoom(roomId).includes(socket.id)) {
  ack?.({ ok: false, error: 'No eres miembro de esta sala' });
  return;
}
```

**Propiedad:** Solo sockets que han hecho `join-room` a esa sala pueden enviar mensajes. Un usuario autenticado pero no miembro de la sala recibe error 400-equivalente.

---

### RT-3 — Mensaje no vacío

**Código:** `src/server.ts:115-118`
```typescript
if (!texto || !texto.trim()) {
  ack?.({ ok: false, error: 'El mensaje no puede estar vacío' });
  return;
}
```

**Propiedad:** Mensajes vacíos o solo espacios son rechazados antes de guardar en Firestore.

---

### RT-4 — Mensajes solo a la misma sala

**Código:** `src/server.ts:144`
```typescript
io.to(roomId).emit('chat-message', message);
```

**Propiedad:** El evento `chat-message` solo se emite a sockets dentro de `roomId` (usando `io.to(roomId)`). Usuarios en otras salas no lo reciben.

---

### RT-5 — Presencia de entrada solo a miembros de la sala

**Código:** `src/server.ts:92`
```typescript
io.to(roomId).emit('user-joined', { roomId, uid: user.uid, name: user.name, members });
```

**Propiedad:** Cuando un usuario entra a una sala, el anuncio `user-joined` solo llega a los sockets conectados a esa misma sala.

---

### RT-6 — Presencia de salida solo a miembros de la sala

**Código:** `src/server.ts:104` y `src/server.ts:191`
```typescript
io.to(roomId).emit('user-left', { roomId, uid: user.uid, name: user.name });
```

**Propiedad:** Cuando un usuario sale (`leave-room`) o se desconecta (`disconnect`), el anuncio `user-left` solo llega a los sockets conectados a esa misma sala.

---

### RT-7 — WebRTC signaling solo al usuario destino

**Código:** `src/server.ts:166-170`
```typescript
socket.on('webrtc-offer', (payload) => {
  const targetSocket = findSocketByUid(payload.targetUid);
  if (targetSocket) {
    io.to(targetSocket).emit('webrtc-offer', { fromUid: user.uid, fromName: user.name, offer: payload.offer });
  }
});
```

**Propiedad:** Las ofertas, respuestas y candidatos ICE de WebRTC se envían solo al socket del `targetUid` especificado, no a toda la sala.

---

### RT-8 — Unirse a sala inexistente

**Código:** `src/server.ts:73-98`

**Propiedad:** El evento `join-room` no valida explícitamente que la sala exista en Firestore antes de agregar el socket. Esta es una limitación conocida; la validación de existencia de sala se hace en el backend-api (`GET /api/rooms/:id`) antes de que el frontend intente unirse.

---

## 3. Matriz de pruebas de propiedad (con dos clientes)

Cada prueba usa **dos navegadores/clientes** con tokens de Firebase distintos:
- **Usuario A** (uid: `uidA`, token: `tokenA`)
- **Usuario B** (uid: `uidB`, token: `tokenB`)

### RT-1 — Autenticación en handshake

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| RT-1.1 | Conectar sin `auth.token` | `connect_error`: "No se proporcionó token de Firebase" |
| RT-1.2 | Conectar con token inválido/expirado | `connect_error`: "Token de Firebase inválido o expirado" |
| RT-1.3 | Conectar con token válido de Usuario A | `connect` exitoso, `socket.data.user.uid == uidA` |
| RT-1.4 | Conectar con token válido de Usuario B | `connect` exitoso, `socket.data.user.uid == uidB` |

### RT-2 — Mensaje solo si es miembro de la sala

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| RT-2.1 | Usuario A emite `chat-message` a sala S sin haber hecho `join-room` | `{ ok: false, error: 'No eres miembro de esta sala' }` |
| RT-2.2 | Usuario A hace `join-room` a S, luego emite `chat-message` a S | `{ ok: true, id: <msgId> }` |
| RT-2.3 | Usuario B (que no hizo join-room a S) emite `chat-message` a S | `{ ok: false, error: 'No eres miembro de esta sala' }` |

### RT-3 — Mensaje no vacío

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| RT-3.1 | Usuario A emite `chat-message` con `texto: ""` | `{ ok: false, error: 'El mensaje no puede estar vacío' }` |
| RT-3.2 | Usuario A emite `chat-message` con `texto: "   "` | `{ ok: false, error: 'El mensaje no puede estar vacío' }` |
| RT-3.3 | Usuario A emite `chat-message` con `texto: "Hola"` | `{ ok: true, id: <msgId> }` |

### RT-4 — Mensajes solo a la misma sala

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| RT-4.1 | Usuario A y B hacen `join-room` a sala S1. Usuario C hace `join-room` a sala S2. A envía mensaje a S1. | B recibe `chat-message`. C **no** recibe nada. |
| RT-4.2 | Usuario A y B en sala S1. A envía mensaje a S1. | B recibe el mensaje con `autorId == uidA`. |

### RT-5 — Presencia de entrada solo a miembros de la sala

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| RT-5.1 | Usuario A hace `join-room` a S1. Luego Usuario B hace `join-room` a S1. | A recibe `user-joined` de B. B recibe `user-joined` de A. |
| RT-5.2 | Usuario A en S1, Usuario C en S2. C hace `join-room` a S2. | A **no** recibe `user-joined` de C. |

### RT-6 — Presencia de salida solo a miembros de la sala

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| RT-6.1 | Usuario A y B en sala S1. A hace `leave-room` de S1. | B recibe `user-left` de A. |
| RT-6.2 | Usuario A y B en sala S1. A se desconecta (cerrar pestaña). | B recibe `user-left` de A. |
| RT-6.3 | Usuario A en S1, Usuario C en S2. C hace `leave-room` de S2. | A **no** recibe `user-left` de C. |

### RT-7 — WebRTC signaling solo al destino

| # | Escenario | Resultado esperado |
|---|-----------|-------------------|
| RT-7.1 | Usuario A emite `webrtc-offer` con `targetUid: uidB`. | B recibe `webrtc-offer` con `fromUid: uidA`. |
| RT-7.2 | Usuario A emite `webrtc-offer` con `targetUid: uidC` (que no está conectado). | No hay receptor (targetSocket es undefined, no se emite nada). |

---

## 4. Códigos de error esperados en Socket.IO

| Código | Significado | Contexto |
|--------|-------------|----------|
| `connect_error` | Handshake fallido | Sin token o token inválido |
| `{ ok: false, error: 'No eres miembro de esta sala' }` | No es miembro | Enviar `chat-message` sin `join-room` previo |
| `{ ok: false, error: 'El mensaje no puede estar vacío' }` | Mensaje vacío | Enviar `chat-message` con texto vacío |
| `{ ok: false, error: 'Sala no encontrada' }` | Sala inexistente | Enviar `chat-message` a sala que no existe en Firestore |
| `{ ok: false, error: 'No se pudo enviar el mensaje' }` | Error interno | Excepción inesperada |

---

## 5. Cómo ejecutar las pruebas

El proyecto **no tiene configurado un framework de pruebas** (`"test": "echo \"Error: no test specified\""` en backend-realtime). Para ejecutar las pruebas de propiedad se requiere:

### Opción A: Pruebas manuales con dos navegadores (recomendado para validación inicial)

1. Levantar el servidor: `cd backend-realtime && npm run dev`
2. Abrir dos pestañas del navegador en `http://localhost:3002` (o cualquier cliente Socket.IO)
3. En cada pestaña, obtener un `idToken` de Firebase Auth (usuario A y usuario B)
4. Conectar cada cliente con `io(url, { auth: { token } })`
5. Ejecutar los escenarios de la matriz anterior usando la consola del navegador

Ejemplo de prueba RT-2 en consola del navegador (Usuario B no miembro):
```javascript
const socketB = io('http://localhost:3002', { auth: { token: tokenB } });
socketB.on('connect', () => {
  socketB.emit('chat-message', { roomId: 'sala-A', texto: 'Hola' }, (res) => {
    console.log('Respuesta:', res); // Esperado: { ok: false, error: 'No eres miembro de esta sala' }
  });
});
```

### Opción B: Pruebas automatizadas con socket.io-client (futuro)

Configurar Jest o Vitest con `socket.io-client` para probar las propiedades de forma automatizada sin depender de navegadores manuales.

---

## 5. Análisis de cobertura de propiedad

| Propiedad | Estado | Evidencia en código |
|-----------|--------|---------------------|
| RT-1 — Solo usuarios autenticados conectan | ✅ Implementada | Middleware `io.use` verifica Firebase ID token |
| RT-2 — Mensaje solo si es miembro | ✅ Implementada | `socketsInRoom(roomId).includes(socket.id)` |
| RT-3 — Mensaje no vacío | ✅ Implementada | `!texto \|\| !texto.trim()` |
| RT-4 — Mensajes solo a la misma sala | ✅ Implementada | `io.to(roomId).emit('chat-message', ...)` |
| RT-5 — Presencia entrada solo a sala | ✅ Implementada | `io.to(roomId).emit('user-joined', ...)` |
| RT-6 — Presencia salida solo a sala | ✅ Implementada | `io.to(roomId).emit('user-left', ...)` |
| RT-7 — WebRTC solo al destino | ✅ Implementada | `findSocketByUid(targetUid)` + `io.to(targetSocket)` |
| RT-8 — Unirse a sala inexistente | ⚠️ Parcial | `join-room` no valida existencia de sala en Firestore; validación en backend-api |

**Conclusión:** Las siete propiedades principales de aislamiento y control de acceso están implementadas en el servidor de tiempo real. RT-8 (validación de existencia de sala en `join-room`) es una mejora opcional; la validación actual se hace en el backend-api antes de que el frontend intente unirse.
