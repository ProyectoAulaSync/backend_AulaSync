# Eventos de tiempo real

Este contrato describe el servicio `backend-realtime` (Socket.IO). Los payloads se envían como objetos JSON salvo cuando se indica lo contrario. La presencia se mantiene en memoria del proceso; abrir varias conexiones del mismo usuario a una sala no duplica su entrada o salida en la lista de participantes.

## Tabla maestra

| Nombre del evento / dato | Dirección | Datos exactos que envía (payload) | Quién lo recibe |
|---|---|---|---|
| `handshake.auth` (no es un evento) | Cliente → Servidor | `{ "token": "<Firebase ID token>", "roomId": "<id opcional para reconectar>" }` | El servidor, durante la autenticación Socket.IO. `token` es obligatorio; `roomId` es opcional. |
| `room:join` | Cliente → Servidor | `{ "roomId": "sala-123" }` (también se acepta `"sala-123"`) | El servidor que valida la sala y une este socket. |
| `room:joined` | Servidor → Cliente | `{ "roomId": "sala-123", "participants": [{ "uid": "uid-1", "nombre": "Ana Pérez", "username": "ana" }] }` | Solo el socket que acaba de entrar. Incluye la lista de participantes conectados, incluido el usuario que entra. |
| `room:user-joined` | Servidor → Cliente | `{ "roomId": "sala-123", "uid": "uid-2", "nombre": "Luis Soto", "username": null }` | Los demás sockets en esa sala; se emite una sola vez cuando el usuario no tenía otra conexión activa allí. |
| `room:leave` | Cliente → Servidor | `{ "roomId": "sala-123" }` (también se acepta `"sala-123"`) | El servidor para el socket que solicita salir. |
| `room:user-left` | Servidor → Cliente | `{ "roomId": "sala-123", "uid": "uid-2", "nombre": "Luis Soto", "username": null }` | Los sockets que permanecen en la sala, cuando el último socket de ese usuario sale o se desconecta. |
| `chat:send` | Cliente → Servidor | `{ "roomId": "sala-123", "texto": "Hola" }` | El servidor, que comprueba la pertenencia a sala y persiste el mensaje. El texto se recorta; no puede quedar vacío. |
| `chat:message` | Servidor → Cliente | `{ "id": "firestore-message-id", "roomId": "sala-123", "autorId": "uid-1", "autorNombre": "Ana Pérez", "texto": "Hola", "createdAt": "2026-11-25T15:00:00.000Z" }` | Todos los sockets conectados a esa sala, incluido el emisor; nunca se emite a otra sala. |
| `room:delete` | Cliente → Servidor | `{ "roomId": "sala-123" }` (también se acepta `"sala-123"`) | El servidor, que verifica que el UID autenticado sea exactamente el `anfitriónId`. |
| `room:deleted` | Servidor → Cliente | `{ "roomId": "sala-123", "message": "La sala fue eliminada por el anfitrión" }` | Todos los sockets en esa sala antes de desalojarlos. El servidor elimina mensajes/miembros asociados y la sala. |
| `connect_error` (error de conexión; no es un evento de aplicación del servidor) | Servidor → Cliente | Error Socket.IO con `message`, por ejemplo `"No se proporcionó token de Firebase"` o `"Token de Firebase inválido o expirado"`. | Solo el cliente cuya conexión no pudo autenticarse. El cliente lo recibe mediante el evento Socket.IO `connect_error`. |
| `room:error` | Servidor → Cliente | `{ "code": "ROOM_NOT_FOUND", "message": "Sala no encontrada", "roomId": "sala-123" }` | Solo el socket que solicitó la operación fallida. `roomId` se omite si no se pudo determinar. |
| `chat:error` | Servidor → Cliente | `{ "code": "EMPTY_MESSAGE", "message": "El mensaje no puede estar vacío", "roomId": "sala-123" }` | Solo el socket que intentó enviar el mensaje. |
| `join-room` (alias heredado de `room:join`) | Cliente → Servidor | `{ "roomId": "sala-123" }` o `"sala-123"` | El servidor; tiene el mismo comportamiento que `room:join`. |
| `user-joined` (alias heredado) | Servidor → Cliente | `{ "roomId": "sala-123", "uid": "uid-2", "name": "Luis Soto", "members": ["uid-1", "uid-2"] }` | Los demás sockets en la sala cuando entra un usuario nuevo. |
| `leave-room` (alias heredado de `room:leave`) | Cliente → Servidor | `{ "roomId": "sala-123" }` o `"sala-123"` | El servidor; tiene el mismo comportamiento que `room:leave`. |
| `user-left` (alias heredado) | Servidor → Cliente | `{ "roomId": "sala-123", "uid": "uid-2", "name": "Luis Soto" }` | Los sockets restantes cuando se retira la última conexión del usuario. |
| `chat-message` (alias heredado, entrada) | Cliente → Servidor | `{ "roomId": "sala-123", "texto": "Hola" }` | El servidor; tiene el mismo comportamiento que `chat:send`. |
| `chat-message` (alias heredado, salida) | Servidor → Cliente | El mismo payload que `chat:message`. | Todos los sockets conectados a esa sala. |
| `chat-history` | Cliente → Servidor | `{ "roomId": "sala-123", "limit": 50 }` (`limit` es opcional) | El servidor, solo si el socket ya pertenece a esa sala. Devuelve el resultado mediante callback Socket.IO, no mediante otro evento. |
| `webrtc-offer` | Cliente → Servidor → Cliente | Entrada: `{ "roomId": "sala-123", "targetUid": "uid-2", "offer": {} }`. Reenvío: `{ "fromUid": "uid-1", "fromName": "Ana Pérez", "offer": {} }`. | El servidor reenvía solo al socket conectado del `targetUid`. |
| `webrtc-answer` | Cliente → Servidor → Cliente | Entrada: `{ "roomId": "sala-123", "targetUid": "uid-1", "answer": {} }`. Reenvío: `{ "fromUid": "uid-2", "answer": {} }`. | El servidor reenvía solo al socket conectado del `targetUid`. |
| `webrtc-ice-candidate` | Cliente → Servidor → Cliente | Entrada: `{ "roomId": "sala-123", "targetUid": "uid-2", "candidate": {} }`. Reenvío: `{ "fromUid": "uid-1", "candidate": {} }`. | El servidor reenvía solo al socket conectado del `targetUid`. |

> **Errores:** no se emite un evento de aplicación llamado literalmente `error`. Para cumplir el flujo de error de Socket.IO, escucha `connect_error` durante el handshake y `room:error` / `chat:error` para errores de operaciones ya conectadas.
>
> Los clientes heredados pueden usar los alias listados arriba. No escuches simultáneamente el alias y el evento canónico para la misma acción: el servidor emite ambos eventos de salida de chat/presencia y el cliente podría procesar duplicados.

## Ejemplos de uso

### Autenticación y reconexión

`roomId` se incluye en el handshake únicamente cuando el cliente desea reingresar automáticamente a la sala activa tras reconectarse. El servidor vuelve a comprobar que la sala exista y responde con `room:joined`.

```json
{
  "auth": {
    "token": "<Firebase ID token>",
    "roomId": "sala-123"
  }
}
```

### Ingreso y presencia

Cliente:

```json
{ "roomId": "sala-123" }
```

Confirmación privada al socket que se unió:

```json
{
  "roomId": "sala-123",
  "participants": [
    { "uid": "uid-1", "nombre": "Ana Pérez", "username": "ana" },
    { "uid": "uid-2", "nombre": "Luis Soto", "username": null }
  ]
}
```

Aviso al resto de participantes:

```json
{
  "roomId": "sala-123",
  "uid": "uid-2",
  "nombre": "Luis Soto",
  "username": null
}
```

`room:leave` usa `{ "roomId": "sala-123" }`. Al salir el último socket de ese usuario, los miembros restantes reciben:

```json
{
  "roomId": "sala-123",
  "uid": "uid-2",
  "nombre": "Luis Soto",
  "username": null
}
```

La desconexión de transporte ejecuta la misma limpieza de presencia que `room:leave`.

### Chat

El cliente envía:

```json
{ "roomId": "sala-123", "texto": "Hola a todos" }
```

Después de guardar en Firestore, el servidor emite a esa sala:

```json
{
  "id": "firestore-message-id",
  "roomId": "sala-123",
  "autorId": "uid-1",
  "autorNombre": "Ana Pérez",
  "texto": "Hola a todos",
  "createdAt": "2026-11-25T15:00:00.000Z"
}
```

Los mensajes se guardan bajo `rooms/{roomId}/messages/{messageId}` con fecha de servidor y se distribuyen exclusivamente con `io.to(roomId)`. Si el socket no pertenece a la sala, el error es `NOT_IN_ROOM`; si `texto.trim()` está vacío, el error es `EMPTY_MESSAGE`.

### Eliminar sala

El cliente anfitrión envía `{ "roomId": "sala-123" }` con `room:delete`. Tras comprobar permisos y eliminar los documentos relacionados, el servidor emite `room:deleted` a los participantes de esa sala y luego los desaloja. Una petición de otro usuario recibe `room:error` con código `FORBIDDEN`.

### Historial y señalización WebRTC

El historial en tiempo real es una solicitud con callback Socket.IO:

```json
{ "roomId": "sala-123", "limit": 50 }
```

Respuesta exitosa del callback: `{ "ok": true, "messages": [{ "id": "...", "roomId": "sala-123", "autorId": "uid-1", "autorNombre": "Ana Pérez", "texto": "Hola", "createdAt": "2026-11-25T15:00:00.000Z" }] }`. El servidor limita el tamaño a 100 y solo permite consultar al socket que pertenece a la sala.

La señalización WebRTC (`webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`) se direcciona al socket conectado del `targetUid`; el servidor agrega `fromUid` (y `fromName` para `webrtc-offer`) al payload reenviado. Ejemplo de oferta entrante:

```json
{ "roomId": "sala-123", "targetUid": "uid-2", "offer": {} }
```

## Callback de confirmación opcional

Los manejadores aceptan un callback Socket.IO opcional. Sus respuestas no son eventos adicionales:

- Operación exitosa: `{ "ok": true, "roomId": "...", ... }`; `room:join` incluye `participants` y `members`, `chat:send` incluye `id`.
- Error de sala: `{ "ok": false, "code": "...", "message": "...", "roomId": "..." }`.
- Error de chat: `{ "ok": false, "code": "...", "message": "...", "roomId": "...", "error": "..." }`.
- `chat-history` exitosa: `{ "ok": true, "messages": [...] }`. Si falla, devuelve `{ "ok": false, "code": "...", "error": "..." }`.

Los errores de ingreso incluyen `ROOM_ID_REQUIRED`, `ROOM_NOT_FOUND` o `ROOM_JOIN_FAILED`. Las operaciones de sala pueden responder `ROOM_LEAVE_FAILED` o `ROOM_DELETE_FAILED`; chat puede responder `ROOM_ID_REQUIRED`, `NOT_IN_ROOM`, `EMPTY_MESSAGE`, `ROOM_NOT_FOUND` o `MESSAGE_SEND_FAILED`; `chat-history` puede responder `ROOM_ID_REQUIRED`, `NOT_IN_ROOM`, `ROOM_NOT_FOUND` o `HISTORY_LOAD_FAILED`.
