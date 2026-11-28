# AulaSync Backend API

Servicio backend REST con Express + TypeScript + Firebase Admin SDK + Firestore para el mini-proyecto 2: Salón de Estudio Colaborativo en Tiempo Real.

## Modelo de Datos Firestore

El backend utiliza colecciones y subcolecciones en Firestore para almacenar salas y mensajes con reglas de acceso cerradas (todo el acceso pasa por el backend/Admin SDK; los clientes nunca tocan Firestore directamente).

### Colecciones definidas:

#### `rooms` (rooms/{roomId})
- **id**: string - Identificador único de la sala (generado automáticamente por Document Reference)
- **nombre**: string - Nombre de la sala (máx. 80 caracteres)
- **anfitriónId**: string - UID del usuario que creó la sala
- **createdAt**: timestamp - Marca de tiempo al crear la sala (Server Timestamp)
- **updatedAt**: timestamp - Marca de tiempo de la última actualización (Server Timestamp)

#### `rooms/{roomId}/members` (rooms/{roomId}/members/{uid})
- **uid**: string - UID del usuario miembro
- **joinedAt**: timestamp - Cuándo se unió el usuario a la sala (Server Timestamp)

#### `rooms/{roomId}/messages` (rooms/{roomId}/messages/{messageId})
- **id**: string - Identificador único del mensaje (generado automáticamente)
- **roomId**: string - ID de la sala a la que pertenece el mensaje
- **autorId**: string - UID del autor del mensaje
- **autorNombre**: string - Nombre display del autor
- **texto**: string - Contenido del mensaje (máx. 1000 caracteres)
- **createdAt**: timestamp - Marca de tiempo al enviar el mensaje (Server Timestamp)

### Reglas de Firestore (archivo `firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Todo el acceso pasa por backend-api (Admin SDK). Ningún cliente toca Firestore.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Flujo de operaciones soportadas

#### 1. CRUD de Salas (US-06, US-07)

- **Crear sala**: `POST /api/rooms`
  - Solo el dueño de la sesión autenticado puede crear
  - Genera `rooms/{id}` con datos: `{ nombre, anfitriónId, createdAt, updatedAt }`
  - Valida unicidad de nombre en servidor (transacción Firestore)

- **Listar salas propias**: `GET /api/users/me` (contexto de salas por host)
- **Unirse a sala**: `POST /api/rooms/:roomId/join`
  - Valida que la sala existe (`findRoomById`)
  - Añade miembro a `rooms/{roomId}/members/{uid}`
- **Listar miembros**: `GET /api/rooms/:roomId/members`
- **Editar sala** (solo anfitrión): `PATCH /api/rooms/:roomId`
- **Eliminar sala** (solo anfitrión): `DELETE /api/rooms/:roomId`
  - Borra la sala y por subcolección: mensajes propios y memberships

#### 2. Gestión de Mensajes en Tiempo Real (US-10, US-11)

- **Enviar mensaje**: `POST /api/rooms/:roomId/messages`
  - Valida que la sala existe
  - Guarda mensaje en `rooms/{roomId}/messages/{msgId}` con: `{ roomId, autorId, autorNombre, texto, createdAt }`
  - Actualiza `updatedAt` de la sala
  - **Broadcast**: Socket.IO emite `chat:message` (y el alias compatible `chat-message`) solo a los miembros de la MISMA sala (`io.to(roomId)`)
- **Presencia en tiempo real**: Socket.IO valida `room:join` contra Firestore, mantiene participantes únicos por UID en memoria y emite `room:user-joined` / `room:user-left`
- **Chat por Socket.IO**: `chat:send` requiere que el socket pertenezca a la sala y persiste el mensaje en Firestore usando `serverTimestamp()` antes de emitirlo
- **Reconexión**: el cliente puede enviar `roomId` en `socket.handshake.auth` para reingresar automáticamente a la sala activa
- **Eliminar sala**: `room:delete` solo permite al anfitrión; elimina la sala y subcolecciones, emite `room:deleted` y expulsa los sockets
- **Historial de mensajes**: `GET /api/rooms/:roomId/messages?limit=50`
  - Consulta `rooms/{roomId}/messages` ordenado por `createdAt` (desc), límite 50 por defecto
  - Devuelve mensajes cronológicos invertidos para mostrar los más antiguos primero

#### 3. Salida del usuario

- **Salir de sala**: Limpia `rooms/{roomId}/members/{uid}`

#### 4. Eliminación de cuenta (`DELETE /api/users/me`)

El endpoint elimina la cuenta del usuario y todos sus datos asociados en Firestore y Firebase Authentication, siguiendo una política de **"no dejar datos huérfanos"**. El orden de ejecución es seguro: primero se limpian los datos asociados y finalmente se borra la cuenta de Auth, permitiendo reintentos si el proceso falla a mitad.

**Orden de eliminación:**

1. **Mensajes del usuario** — Se borran todos los documentos en `rooms/{roomId}/messages/{msgId}` donde `autorId == uid` (consulta por colección grupo). Esto incluye mensajes en salas donde el usuario era anfitrión y en salas donde era miembro.
2. **Membresías** — Se itera por todas las salas en Firestore y se borra el documento `rooms/{roomId}/members/{uid}` para cada una. El usuario deja de aparecer como participante en cualquier sala.
3. **Salas donde es anfitrión** — Se buscan todas las salas donde `anfitriónId == uid`. Para cada una:
   - Se borran todos los documentos de `rooms/{roomId}/members/*` (todos los miembros quedan expulsados).
   - Se borran todos los documentos de `rooms/{roomId}/messages/*` (todos los mensajes de esa sala se eliminan).
   - Se borra el documento `rooms/{roomId}`.
4. **Username** — Se borra la entrada en `usernames/{usernameLower}`, liberando el nombre de usuario para que otro usuario pueda registrarlo.
5. **Perfil** — Se borra el documento `users/{uid}` en Firestore.
6. **Firebase Auth** — Se elimina la cuenta con `auth.deleteUser(uid)`. Si el usuario ya no existe en Auth (error `user-not-found`), la operación continúa sin error, permitiendo reintentos seguros.

**Resultados esperados tras la eliminación:**
- No quedan mensajes con `autorId == uid`.
- No hay salas donde `anfitriónId == uid`.
- No hay membresías `rooms/*/members/{uid}`.
- No hay entrada `usernames/{usernameLower}` con `uid == uid`.
- No existe `users/{uid}`.
- No existe la cuenta en Firebase Auth.

### Endpoints API relevantes (documentados en swagger.yaml)

| Endpoint | Descripción |
|---|---|
| `POST /api/rooms` | Crear sala de estudio |
| `GET /api/rooms` | Listar salas propias del usuario autenticado |
| `POST /api/rooms/:roomId/join` | Unirse a una sala por ID |
| `GET /api/rooms/:roomId/members` | Listar miembros de una sala |
| `POST /api/rooms/:roomId/messages` | Enviar mensaje a una sala (broadcast WebSocket) |
| `GET /api/rooms/:roomId/messages` | Obtener historial de mensajes de la sala |

### Despliegue

- **Docker**: Cada servicio tiene su `Dockerfile` y `docker-compose.yml` levanta todo el sistema
- **Render**: Los backends se despliegan en Render usando Docker containers
- **Puerto**: API en 3001, Servidor de tiempo real en 3002
- **Variables de entorno**: `.env.example` contiene `PORT`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- **Swagger**: Documentación interactiva en `/api-docs` (esquemas Room, Message, UserProfile, Error)

### Seguridad

- Todas las rutas de perfil y salas requieren authenticate middleware (verificación de Firebase ID Token en header `Authorization: Bearer <token>`)
- `requireCompleteProfile` middleware para rutas que exigen username elegido
- Reglas Firestore cerradas: `allow read, write: if false;` (todo el acceso por backend)
- Username y email tienen validación de unicidad en servidor (transacciones Firestore)