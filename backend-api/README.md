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
  - **Broadcast**: Socket.IO emite `chat-message` a todos los miembros de la MISMA sala (`io.to(roomId)`)
- **Historial de mensajes**: `GET /api/rooms/:roomId/messages?limit=50`
  - Consulta `rooms/{roomId}/messages` ordenado por `createdAt` (desc), límite 50 por defecto
  - Devuelve mensajes cronológicos invertidos para mostrar los más antiguos primero

#### 3. Salida del usuario

- **Salir de sala**: Limpia `rooms/{roomId}/members/{uid}`
- **Borrar cuenta** (`DELETE /api/users/me`): Borra perfil, libera username, borra mensajes propios y salas donde es anfitrión (política sin datos huérfanos)

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