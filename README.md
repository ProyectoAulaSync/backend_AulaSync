# AulaSync Backend - Mini-proyecto 2

Este repositorio contiene la infraestructura backend para el proyecto AulaSync, dividida en dos servicios independientes: la API principal y el servidor de tiempo real.

Backend del proyecto Aula Sync, compuesto por dos servicios:

- `backend-api`: API REST con Express y Firebase/Firestore.
- `backend-realtime`: servicio preparado para comunicación en tiempo real con Socket.IO.

## Requisitos

- Node.js 20+
- npm
- Docker y Docker Compose

## Estructura

```text
backend/
├── backend-api/
├── backend-realtime/
└── docker-compose.yml
### Backend API
1. Copia la plantilla de variables de entorno:
   ```bash
   cp backend-api/.env.example backend-api/.env
   ```
## Configuración

2. Completa `backend-api/.env` con las credenciales de Firebase.
3. **Importante:** No subas el archivo `.env` ni los archivos JSON de credenciales al repositorio.

### Backend Realtime
El servicio usa el puerto 3002 por defecto. Copia su plantilla de variables:
```bash
cp backend-realtime/.env.example backend-realtime/.env
```

## Ejecutar con Docker Compose

Desde la raíz del proyecto (donde se encuentra el `docker-compose.yml`), ejecuta:
```bash
docker-compose up --build
```

Servicios disponibles:
*   **API:** http://localhost:3001
*   **Realtime:** http://localhost:3002

Para detener los servicios:
```bash
docker-compose down
```

## Health Checks

Puedes comprobar el estado de los servicios visitando sus endpoints de salud:

*   **Backend API:** `http://localhost:3001/health`
*   **Backend Realtime:** `http://localhost:3002/health`

Ambos responden:
```json
{ "status": "ok" }
```

## Ejecutar individualmente

Si necesitas levantar los servicios por separado (sin Docker Compose), puedes usar Docker directamente desde la raíz de cada carpeta.

**Backend API:**
```bash
cd backend-api
docker build -t backend-api .
docker run -p 3001:3001 --env-file .env backend-api
```

**Backend Realtime:**
```bash
cd backend-realtime
docker build -t backend-realtime .
docker run -p 3002:3002 --env-file .env backend-realtime
```

## Estado actual (Sprint 0)

El servicio `backend-realtime` es únicamente un esqueleto de infraestructura:
*   Socket.IO inicializado.
*   Endpoint `/health` funcional.
*   Sin conexión a base de datos.
*   Sin Firebase.
*   Sin lógica de mensajería.
