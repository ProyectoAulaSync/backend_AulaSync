# AulaSync Backend

Backend de AulaSync compuesto por dos servicios:

- `backend-api`: API REST con Express, Firebase Admin y Firestore.
- `backend-realtime`: servicio Socket.IO para presencia, chat y señalización WebRTC.

## Requisitos

- Node.js 24 o Docker con Docker Compose v2.
- Una cuenta de servicio de Firebase con acceso a Authentication y Firestore.

## Variables de entorno

Las plantillas `.env.example` no contienen credenciales. Crea archivos locales y reemplaza todos los valores de ejemplo:

```powershell
Copy-Item .env.example .env
Copy-Item backend-api\.env.example backend-api\.env
Copy-Item backend-realtime\.env.example backend-realtime\.env
```

En macOS/Linux, usa `cp` en lugar de `Copy-Item`.

| Variable | Servicios | Uso |
|---|---|---|
| `FIREBASE_PROJECT_ID` | API y realtime | ID del proyecto Firebase |
| `FIREBASE_CLIENT_EMAIL` | API y realtime | Correo de la cuenta de servicio |
| `FIREBASE_PRIVATE_KEY` | API y realtime | Clave privada de la cuenta de servicio |
| `PORT` | API o realtime local | Puerto del proceso; por defecto 3001 para API y 3002 para realtime |
| `API_PORT` | Compose | Puerto publicado para la API; por defecto 3001 |
| `REALTIME_PORT` | Compose | Puerto publicado para Socket.IO; por defecto 3002 |

Para obtener los valores de Firebase, crea una cuenta de servicio en la configuración del proyecto y copia sus campos `project_id`, `client_email` y `private_key` a los archivos locales. El código convierte los caracteres literales `\n` de `FIREBASE_PRIVATE_KEY` en saltos de línea. No agregues claves privadas ni JSON de cuenta de servicio al repositorio.

Los servicios cargan variables del entorno. Para ejecución local sin Docker, usa el `.env` correspondiente desde el directorio del servicio:

```powershell
Set-Location backend-api
npm ci
npm run build
npm start
```

En otra terminal, repite desde `backend-realtime`. Las plantillas se mantienen fuera del contexto de imagen y los archivos `.env` locales están ignorados por Git.

## Docker Compose

Desde la raíz del repositorio, después de completar `.env`:

```powershell
docker compose up --build
```

Compose construye imágenes multi-stage, ejecuta cada servicio como usuario no root y publica:

- API: `http://localhost:3001` (Swagger: `/api-docs`)
- Socket.IO: `http://localhost:3002`

Los puertos del host se pueden cambiar con `API_PORT` y `REALTIME_PORT`. Compose verifica `/health` en ambos contenedores. Para cerrar:

```powershell
docker compose down
```

Si Compose informa que falta una variable Firebase, revisa que exista el `.env` de la raíz y que las tres credenciales estén configuradas. No se incluyen credenciales de prueba: sin una cuenta de servicio válida los servicios no pueden conectarse a Firebase.

## Despliegue en Render

Lista de verificación para `AUL-239`:

- [ ] Fusionar primero las ramas de funcionalidades de salas/historial y tiempo real; mantener esta rama de documentación separada.
- [ ] Crear dos **Web Services** de tipo Docker: uno con Root Directory `backend-api` y otro con Root Directory `backend-realtime`.
- [ ] Confirmar que cada servicio construye su `Dockerfile` desde su Root Directory y que el runtime usa la etapa `production`.
- [ ] Configurar en **Environment** de ambos servicios `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY` con valores reales de Firebase; no subirlos al repositorio.
- [ ] No fijar `PORT` en Render: dejar que Render inyecte el puerto. Los servicios usan 3001/3002 como valores por defecto para desarrollo y Compose.
- [ ] Configurar el Health Check Path de ambos servicios como `/health`.
- [ ] Desplegar y comprobar `https://<api-service>/health`, `https://<api-service>/api-docs` y `https://<realtime-service>/health`.
- [ ] Probar autenticación, salas, envío/historial de mensajes y Socket.IO con tres navegadores en dos salas distintas.
- [ ] Mantener `backend-realtime` en una sola instancia mientras la presencia y el adaptador Socket.IO sean en memoria. Antes de escalar horizontalmente, incorporar un adaptador compartido y presencia distribuida.
- [ ] Revisar logs de arranque y health checks; confirmar que no se imprimen ni exponen credenciales.

## Salud

- `GET /health` en la API devuelve `{"status":"ok"}`.
- `GET /health` en realtime devuelve `{"status":"ok","service":"realtime"}`.
