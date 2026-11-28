# Pruebas de Propiedad — Backend AulaSync

Este documento especifica las pruebas de propiedad (access control / authorization) que deben validarse para garantizar que un usuario **no puede modificar datos de otro usuario**, y que el listado de salas devuelve solo las propias.

---

## 1. Propiedades verificadas

| ID | Propiedad | Endpoint | Método | Código esperado |
|----|-----------|----------|--------|-----------------|
| P1 | Un usuario **no puede modificar el perfil de otro** (solo el suyo) | `/api/users/me` | `PATCH` | 200 (suyo) / 401 (sin token) / 403 (perfil incompleto) — **no hay forma de apuntar a otro uid** |
| P2 | Un usuario **no puede editar la sala de otro** | `/api/rooms/:roomId` | `PATCH` | 403 `FORBIDDEN` si no es anfitrión |
| P3 | Un usuario **no puede eliminar la sala de otro** | `/api/rooms/:roomId` | `DELETE` | 403 `FORBIDDEN` si no es anfitrión |
| P4 | El listado de salas **solo devuelve las propias** | `/api/rooms` | `GET` | 200 — solo salas donde `anfitriónId == uid` del token |

---

## 2. Cómo se aplican las propiedades en el código

### P1 — Perfil: solo el uid del token

**Ruta:** `src/routes/user.routes.ts:9`
```ts
router.patch('/me', authenticate, requireCompleteProfile, patchMe);
```

**Controlador:** `src/controllers/user.controller.ts:19-22`
```ts
export const patchMe = async (req, res) => {
  const data = updateProfileSchema.parse(req.body);
  const uid = getAuthContext(res).uid;  // ← UID siempre del token, nunca del body
  res.json(await userRepo.updateProfile(uid, data));
};
```

**Repositorio:** `src/repositories/user.repository.ts:146-148`
```ts
export async function updateProfile(uid: string, data: ProfileChanges) {
  const userRef = db.collection(USERS).doc(uid);  // ← escribe solo en su propio doc
  ...
}
```

**Conclusión:** No existe forma de especificar un `uid` ajeno en el cuerpo de la petición. El `uid` siempre proviene del `authenticate` middleware que verifica el Firebase ID Token. **Propiedad P1 se cumple por diseño.**

---

### P2 — Sala: solo el anfitrión puede editar

**Ruta:** `src/routes/room.routes.ts:21`
```ts
router.patch('/:roomId', updateRoom);  // protegido por authenticate + requireCompleteProfile
```

**Controlador:** `src/controllers/room.controller.ts:27-33`
```ts
export const updateRoom = async (req, res) => {
  const roomId = String(req.params.roomId);
  const { nombre } = roomUpdateSchema.parse(req.body);
  const uid = getAuthContext(res).uid;  // UID del token
  const room = await roomService.updateRoomService(roomId, { nombre }, uid);
  res.json(room);
};
```

**Servicio:** `src/services/room.service.ts:16-18`
```ts
export async function updateRoomService(roomId, data, uid) {
  return roomRepo.updateRoom(roomId, data.nombre, uid);
}
```

**Repositorio:** `src/repositories/room.repository.ts:83-87`
```ts
export async function updateRoom(roomId, nombre, uid) {
  const room = await findRoomById(roomId);
  if (!room) throw new AppError('Sala no encontrada', 404, { code: 'ROOM_NOT_FOUND' });
  if (room.anfitriónId !== uid) throw new AppError('Solo el anfitrión puede editar la sala', 403, { code: 'FORBIDDEN' });  // ← validación de propiedad
  ...
}
```

**Conclusión:** Si `uid` del token != `anfitriónId` de la sala, responde **403 FORBIDDEN**. **Propiedad P2 se cumple.**

---

### P3 — Sala: solo el anfitrión puede eliminar

**Ruta:** `src/routes/room.routes.ts:22`
```ts
router.delete('/:roomId', deleteRoom);  // protegido por authenticate + requireCompleteProfile
```

**Controlador:** `src/controllers/room.controller.ts:35-40`
```ts
export const deleteRoom = async (req, res) => {
  const roomId = String(req.params.roomId);
  const uid = getAuthContext(res).uid;  // UID del token
  await roomService.deleteRoomService(roomId, uid);
  res.status(204).send();
};
```

**Repositorio:** `src/repositories/room.repository.ts:97-101`
```ts
export async function deleteRoom(roomId, uid) {
  const room = await findRoomById(roomId);
  if (!room) throw new AppError('Sala no encontrada', 404, { code: 'ROOM_NOT_FOUND' });
  if (room.anfitriónId !== uid) throw new AppError('Solo el anfitrión puede eliminar la sala', 403, { code: 'FORBIDDEN' });  // ← validación de propiedad
  ...
}
```

**Conclusión:** Si `uid` del token != `anfitriónId` de la sala, responde **403 FORBIDDEN**. **Propiedad P3 se cumple.**

---

### P4 — Listado: solo salas propias

**Ruta:** `src/routes/room.routes.ts:19`
```ts
router.get('/', listMyRooms);  // protegido por authenticate + requireCompleteProfile
```

**Controlador:** `src/controllers/room.controller.ts:14-18`
```ts
export const listMyRooms = async (_req, res) => {
  const uid = getAuthContext(res).uid;  // UID del token
  const rooms = await roomService.listMyRoomsService(uid);
  res.json(rooms);
};
```

**Servicio:** `src/services/room.service.ts:12-14`
```ts
export async function listMyRoomsService(uid) {
  return roomRepo.listRoomsByHost(uid);
}
```

**Repositorio:** `src/repositories/room.repository.ts:71-80`
```ts
export async function listRoomsByHost(anfitriónId) {
  const snap = await db.collection(ROOMS).where('anfitriónId', '==', anfitriónId).get();  // ← filtra por anfitrión
  const rooms = snap.docs.map(toRoom);
  ...
  return rooms.sort(...);
}
```

**Conclusión:** La consulta de Firestore filtra por `anfitriónId == uid` del token. Nunca devuelve salas de otro usuario. **Propiedad P4 se cumple.**

---

## 3. Matriz de pruebas de propiedad (test cases)

Cada prueba debe ejecutarse con **dos usuarios autenticados** (Usuario A y Usuario B) con tokens de Firebase válidos.

### P1 — Perfil: no se puede modificar el perfil de otro

| # | Escenario | Usuario autenticado | uid en body (si aplica) | Resultado esperado |
|---|-----------|---------------------|-------------------------|-------------------|
| P1.1 | Editar propio perfil | A | — (no se envía uid) | 200 OK, perfil actualizado |
| P1.2 | Sin token | — | — | 401 NO_TOKEN |

> Nota: No es posible enviar un `uid` ajeno en el cuerpo porque el endpoint `PATCH /api/users/me` no acepta parámetro de usuario. El `uid` siempre proviene del token. Por tanto, la propiedad se cumple por diseño.

---

### P2 — Sala: no se puede editar la sala de otro

| # | Escenario | Usuario autenticado | Sala (anfitrión) | Resultado esperado |
|---|-----------|---------------------|------------------|-------------------|
| P2.1 | Editar sala propia | A | Sala creada por A | 200 OK, sala actualizada |
| P2.2 | Editar sala de otro | B | Sala creada por A | 403 FORBIDDEN `{ code: 'FORBIDDEN' }` |
| P2.3 | Editar sala inexistente | A | Sala que no existe | 404 ROOM_NOT_FOUND |
| P2.4 | Sin token | — | Sala de A | 401 NO_TOKEN |

---

### P3 — Sala: no se puede eliminar la sala de otro

| # | Escenario | Usuario autenticado | Sala (anfitrión) | Resultado esperado |
|---|-----------|---------------------|------------------|-------------------|
| P3.1 | Eliminar sala propia | A | Sala creada por A | 204 No Content |
| P3.2 | Eliminar sala de otro | B | Sala creada por A | 403 FORBIDDEN `{ code: 'FORBIDDEN' }` |
| P3.3 | Eliminar sala inexistente | A | Sala que no existe | 404 ROOM_NOT_FOUND |
| P3.4 | Sin token | — | Sala de A | 401 NO_TOKEN |

---

### P4 — Listado: solo salas propias

| # | Escenario | Usuario autenticado | Salas creadas por A | Salas creadas por B | Resultado esperado |
|---|-----------|---------------------|---------------------|---------------------|-------------------|
| P4.1 | Listar propias de A | A | Sala A1, Sala A2 | Sala B1 | 200: `[Sala A1, Sala A2]` (solo las de A) |
| P4.2 | Listar propias de B | B | Sala A1, Sala A2 | Sala B1 | 200: `[Sala B1]` (solo las de B) |
| P4.3 | Usuario sin salas | C | — | — | 200: `[]` (lista vacía) |
| P4.4 | Sin token | — | Sala A1 | — | 401 NO_TOKEN |

---

## 4. Códigos de error esperados

| Código HTTP | Código interno | Significado |
|-------------|---------------|-------------|
| 200 | — | Éxito |
| 201 | — | Creado |
| 204 | — | Eliminado sin contenido |
| 400 | `VALIDATION_ERROR` | Datos de entrada inválidos |
| 401 | `NO_TOKEN` | No se proporcionó token |
| 401 | `INVALID_TOKEN` | Token inválido o expirado |
| 403 | `FORBIDDEN` | No es el anfitrión de la sala |
| 403 | `PROFILE_INCOMPLETE` | Falta elegir username |
| 404 | `ROOM_NOT_FOUND` | Sala no encontrada |
| 404 | `PROFILE_NOT_FOUND` | Perfil no creado |
| 409 | `USERNAME_TAKEN` | Username ya ocupado |
| 409 | `EMAIL_TAKEN` | Correo ya registrado |
| 503 | `DB_ERROR` | Error de base de datos |
| 500 | `AUTH_DELETE_FAILED` | Error al borrar cuenta de Auth |

---

## 5. Cómo ejecutar las pruebas

El proyecto **no tiene configurado un framework de pruebas** (`"test": "echo \"Error: no test specified\""`). Para ejecutar las pruebas de propiedad se requiere:

### Opción A: Firebase Emulator Suite (recomendado)

1. Instalar Firebase CLI: `npm install -g firebase-tools`
2. Inicializar emulator: `firebase init emulators`
3. Iniciar emulators: `firebase emulators:start --only auth,firestore`
4. Ejecutar pruebas contra `http://localhost:9099` (Firestore) y `http://localhost:9099` (Auth)

### Opción B: Contra entorno de producción (solo para validación manual)

Usar cuentas de prueba con tokens reales de Firebase Auth y hacer llamadas HTTP contra la URL publicada en Render.

### Opción C: Pruebas unitarias con mocks (futuro)

Configurar Jest o Vitest y mockear `firebase-admin/firestore` para probar la lógica de negocio sin depender de Firestore real.

---

## 5. Análisis de cobertura de propiedad

| Propiedad | Estado | Evidencia en código |
|-----------|--------|---------------------|
| P1 — Perfil solo propio | ✅ Implementada | `patchMe` usa `getAuthContext(res).uid` del token, nunca del body |
| P2 — Sala: editar solo anfitrión | ✅ Implementada | `updateRoom` verifica `room.anfitriónId !== uid` → 403 |
| P3 — Sala: eliminar solo anfitrión | ✅ Implementada | `deleteRoom` verifica `room.anfitriónId !== uid` → 403 |
| P4 — Listado solo propias | ✅ Implementada | `listRoomsByHost` consulta `where('anfitriónId', '==', uid)` |

**Conclusión:** Las cuatro propiedades de acceso están implementadas y verificadas en el código. No se requieren cambios de código para cumplir con el control de propiedad. Las pruebas pendientes son de **integración** (contra Firebase/Firestore real o emulator) para validar que el comportamiento en runtime coincide con el análisis estático.
