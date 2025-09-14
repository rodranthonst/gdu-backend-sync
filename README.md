# ⚙️ Backend Sync - Gestor de Unidades Compartidas

## 🎯 Propósito

Este backend proporciona un servicio de sincronización automática para unidades compartidas de Google Drive. Gestiona la sincronización de datos, permisos y metadatos entre Google Workspace y una base de datos Firestore, ofreciendo APIs REST para integración con cualquier frontend.

## ⚡ Características Principales

- **Sincronización Automática**: Monitoreo continuo de cambios en Google Drive
- **API REST**: Endpoints para integración con cualquier frontend
- **Gestión de Permisos**: Administración centralizada de accesos
- **Service Account**: Autenticación segura con impersonación
- **Escalabilidad**: Diseñado para manejar múltiples organizaciones
- **Logging Avanzado**: Monitoreo detallado de operaciones

## 🏗️ Arquitectura

```
backend-sync/
├── server.js             # Servidor Express principal
├── config.js             # Configuración centralizada
├── syncService.js        # Lógica de sincronización principal
├── googleDriveService.js # Servicio para Google Drive API
├── firestoreService.js   # Servicio para Firestore
└── .env                  # Variables de entorno (no incluido en repo)
```

### Flujo de Datos

```
Google Drive ←→ Backend Sync ←→ Firestore ←→ Frontend/API Clients
     ↑              ↑              ↑
  Drive API    Sync Service   Database
```

## 🔧 Tecnologías Utilizadas

- **Runtime**: Node.js 16+
- **Framework**: Express.js
- **Autenticación**: Google Service Account + Domain-Wide Delegation
- **Base de Datos**: Google Firestore
- **APIs**: Google Drive API, Google Admin SDK
- **Logging**: Winston (configurable)

## 🚀 Instalación y Configuración

### 1. Prerrequisitos

- Node.js 16+ instalado
- Cuenta de Google Workspace con permisos de Super Admin
- Proyecto en Google Cloud Platform
- Service Account configurado con Domain-Wide Delegation

### 2. Configuración

```bash
# Instalar dependencias
npm install

# Copiar template de configuración
cp .env.template .env

# Editar .env con tus credenciales
# (Ver sección de Variables de Entorno)
```

### 3. Ejecutar en Desarrollo

```bash
npm run dev
# El servidor estará disponible en http://localhost:3001
```

### 4. Ejecutar en Producción

```bash
npm start
```

## 🔐 Variables de Entorno

Copia `.env.template` a `.env` y configura:

```env
# Service Account Configuration (CRÍTICO)
GOOGLE_SERVICE_ACCOUNT_EMAIL=sync-service@tu-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_PROJECT_ID=tu-proyecto-id
GOOGLE_CLIENT_ID=123456789012345678901

# Domain-Wide Delegation (REQUERIDO)
IMPERSONATE_USER=admin@tudominio.com
GOOGLE_CUSTOMER_ID=C01234567

# Firestore Configuration
FIRESTORE_PROJECT_ID=tu-proyecto-firestore

# Sync Configuration
SYNC_INTERVAL_MINUTES=30
MAX_RETRIES=3
BATCH_SIZE=100

# Server Configuration
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
```

## 📡 API Endpoints

### Unidades Compartidas

```http
# Obtener todas las unidades
GET /api/drives

# Obtener unidad específica
GET /api/drives/:driveId

# Sincronizar unidades manualmente
POST /api/sync/drives

# Obtener estado de sincronización
GET /api/sync/status
```

### Permisos

```http
# Obtener permisos de una unidad
GET /api/drives/:driveId/permissions

# Actualizar permisos
PUT /api/drives/:driveId/permissions

# Agregar usuario a unidad
POST /api/drives/:driveId/permissions
```

### Monitoreo

```http
# Health check
GET /health

# Métricas de sincronización
GET /api/metrics

# Logs de operaciones
GET /api/logs
```

## 🔄 Servicio de Sincronización

### Proceso Automático

1. **Detección de Cambios**: Monitoreo de Google Drive
2. **Validación**: Verificación de permisos y datos
3. **Sincronización**: Actualización en Firestore
4. **Notificación**: Logs y métricas de resultado

### Configuración de Intervalos

```javascript
// syncService.js
const SYNC_INTERVAL = process.env.SYNC_INTERVAL_MINUTES * 60 * 1000;

setInterval(async () => {
  await syncAllDrives();
}, SYNC_INTERVAL);
```

## 🔗 Integración con Frontend

### Modo API REST
```javascript
// Ejemplo de integración desde cualquier frontend
const response = await fetch('http://localhost:3001/api/drives');
const drives = await response.json();
```

### Modo WebSocket (Opcional)
```javascript
// Para actualizaciones en tiempo real
const socket = io('http://localhost:3001');
socket.on('drive-updated', (data) => {
  console.log('Unidad actualizada:', data);
});
```

## 🏢 Configuración de Google Workspace

### 1. Service Account

```bash
# Crear Service Account
gcloud iam service-accounts create sync-service \
  --display-name="Drive Sync Service"

# Generar clave privada
gcloud iam service-accounts keys create key.json \
  --iam-account=sync-service@proyecto.iam.gserviceaccount.com
```

### 2. Domain-Wide Delegation

1. **Habilitar Domain-Wide Delegation** en el Service Account
2. **Configurar en Admin Console**:
   - Client ID: `123456789012345678901`
   - Scopes: `https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/admin.directory.user`

### 3. APIs Requeridas

- Google Drive API
- Admin SDK API
- Cloud Firestore API

## 🔒 Seguridad

### Autenticación
- **Service Account**: Credenciales de servicio seguras
- **Domain-Wide Delegation**: Acceso controlado a recursos
- **Impersonación**: Actuar en nombre de usuarios específicos

### Mejores Prácticas
- Variables de entorno para credenciales
- Rotación regular de claves
- Logging de accesos
- Validación de permisos
- Rate limiting en APIs

## 📊 Monitoreo y Logging

### Logs Estructurados
```javascript
logger.info('Sync completed', {
  drives: driveCount,
  duration: syncDuration,
  errors: errorCount
});
```

### Métricas Disponibles
- Tiempo de sincronización
- Número de unidades procesadas
- Errores y reintentos
- Uso de APIs

## 🐛 Solución de Problemas

### Error de Autenticación
```
Error: invalid_grant
```
**Solución**: Verificar Domain-Wide Delegation y IMPERSONATE_USER

### Error de Permisos
```
Error: insufficient permissions
```
**Solución**: Verificar scopes en Admin Console

### Error de Sincronización
```
Error: quota exceeded
```
**Solución**: Implementar rate limiting y reintentos

## 🚀 Despliegue

### Docker
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### Variables de Entorno en Producción
```bash
# Usar secretos seguros
export GOOGLE_PRIVATE_KEY="$(cat /secrets/private-key.pem)"
export NODE_ENV=production
export LOG_LEVEL=warn
```

### 🕐 Cloud Scheduler (GCP)

Para despliegues en Google Cloud Platform, se recomienda usar **Cloud Scheduler** en lugar del cron interno:

#### Configuración Automática
```bash
# Linux/Mac
./setup-cloud-scheduler.sh

# Windows
.\setup-cloud-scheduler.ps1 -BackendUrl "https://tu-backend.run.app"
```

#### Configuración Manual
```bash
# Crear job de Cloud Scheduler
gcloud scheduler jobs create http gdu-sync-job \
  --location=us-central1 \
  --schedule="0 */2 * * *" \
  --uri="https://tu-backend.run.app/sync/manual" \
  --http-method=POST
```

#### Variables de Entorno para Cloud Scheduler
```env
# Deshabilitar cron interno
AUTO_SYNC_ENABLED=false
USE_CLOUD_SCHEDULER=true
```

📖 **Documentación completa**: Ver `CLOUD_SCHEDULER_SETUP.md`

## 🤝 Uso Independiente

Este backend puede usarse completamente independiente del frontend incluido:

### Para Desarrolladores de Frontend
1. **Configura el backend** siguiendo esta documentación
2. **Usa las APIs REST** para integrar con tu frontend
3. **Personaliza endpoints** según tus necesidades
4. **Implementa autenticación** en tu frontend

### Para Integraciones Empresariales
1. **Despliega el servicio** en tu infraestructura
2. **Configura webhooks** para notificaciones
3. **Integra con sistemas existentes** via API
4. **Monitorea métricas** para optimización

### Casos de Uso
- **Dashboards personalizados** de Google Drive
- **Sistemas de backup** automatizados
- **Auditoría de permisos** empresarial
- **Integración con CRM/ERP** existente

## 📚 Recursos Adicionales

- [Google Service Account Guide](https://cloud.google.com/iam/docs/service-accounts)
- [Domain-Wide Delegation](https://developers.google.com/admin-sdk/directory/v1/guides/delegation)
- [Google Drive API Reference](https://developers.google.com/drive/api/v3/reference)
- [Firestore Node.js Client](https://firebase.google.com/docs/firestore/quickstart)

**Ideal para**: Desarrolladores que necesitan un backend robusto para gestionar Google Drive a escala empresarial, con APIs listas para integrar con cualquier frontend o sistema existente.