# 🕐 Configuración de Cloud Scheduler para GCP

## 📋 **Resumen**
Esta guía te ayudará a migrar de cron jobs internos a **Cloud Scheduler** para ejecutar la sincronización cada 2 horas de manera confiable en Google Cloud Platform.

## 🎯 **Ventajas de Cloud Scheduler**
- ✅ **Confiable**: Funciona independiente del estado de Cloud Run
- ✅ **Escalable**: No depende de que el contenedor esté activo
- ✅ **Económico**: Solo paga por las ejecuciones
- ✅ **Monitoreo**: Logs y métricas integradas
- ✅ **Sin cambios de código**: Usa el endpoint `/sync/manual` existente

## 🚀 **Implementación**

### **Paso 1: Habilitar APIs necesarias**
```bash
# Habilitar Cloud Scheduler API
gcloud services enable cloudscheduler.googleapis.com

# Habilitar Cloud Run API (si no está habilitada)
gcloud services enable run.googleapis.com
```

### **Paso 2: Crear el Job de Cloud Scheduler**
```bash
# Reemplaza TU_BACKEND_URL con la URL real de tu Cloud Run
gcloud scheduler jobs create http gdu-sync-job \
  --location=us-central1 \
  --schedule="0 */2 * * *" \
  --uri="https://TU_BACKEND_URL/sync/manual" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{}' \
  --description="Sincronización automática del Gestor de Unidades cada 2 horas"
```

### **Paso 3: Configurar autenticación (si es necesario)**
Si tu backend requiere autenticación:

```bash
# Crear cuenta de servicio para Cloud Scheduler
gcloud iam service-accounts create gdu-scheduler \
  --display-name="GDU Cloud Scheduler"

# Dar permisos para invocar Cloud Run
gcloud run services add-iam-policy-binding TU_SERVICIO_CLOUD_RUN \
  --member="serviceAccount:gdu-scheduler@TU_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1

# Actualizar el job con autenticación
gcloud scheduler jobs update http gdu-sync-job \
  --location=us-central1 \
  --oidc-service-account-email="gdu-scheduler@TU_PROJECT_ID.iam.gserviceaccount.com"
```

## 🔧 **Modificaciones al Código**

### **1. Deshabilitar Cron Job Interno**
En `config.js`, cambia:
```javascript
// Antes
AUTO_SYNC_ENABLED: process.env.AUTO_SYNC_ENABLED === 'true',

// Después (para Cloud Scheduler)
AUTO_SYNC_ENABLED: false, // Deshabilitado - usa Cloud Scheduler
```

### **2. Variable de Entorno (Opcional)**
En `.env`, agrega:
```env
# Deshabilitar cron interno para usar Cloud Scheduler
AUTO_SYNC_ENABLED=false
USE_CLOUD_SCHEDULER=true
```

### **3. Endpoint de Salud Mejorado (Opcional)**
Para verificar que Cloud Scheduler funciona:
```javascript
// En server.js, agregar al endpoint /health
app.get('/health', async (req, res) => {
    try {
        const status = await syncService.getSyncStatus();
        res.json({
            success: true,
            server: 'running',
            sync: {
                lastSync: status.lastSync,
                useCloudScheduler: process.env.USE_CLOUD_SCHEDULER === 'true'
            }
        });
    } catch (error) {
        // ... resto del código
    }
});
```

## 📊 **Monitoreo y Verificación**

### **Ver Jobs programados:**
```bash
gcloud scheduler jobs list --location=us-central1
```

### **Ver logs de ejecución:**
```bash
gcloud scheduler jobs describe gdu-sync-job --location=us-central1
```

### **Ejecutar manualmente para probar:**
```bash
gcloud scheduler jobs run gdu-sync-job --location=us-central1
```

### **Ver logs de Cloud Run:**
```bash
gcloud logs read "resource.type=cloud_run_revision" --limit=50
```

## ⚙️ **Configuraciones Avanzadas**

### **Cambiar frecuencia:**
```bash
# Cada hora
gcloud scheduler jobs update http gdu-sync-job \
  --schedule="0 * * * *" \
  --location=us-central1

# Cada 4 horas
gcloud scheduler jobs update http gdu-sync-job \
  --schedule="0 */4 * * *" \
  --location=us-central1

# Solo días laborables a las 9 AM y 5 PM
gcloud scheduler jobs update http gdu-sync-job \
  --schedule="0 9,17 * * 1-5" \
  --location=us-central1
```

### **Configurar reintentos:**
```bash
gcloud scheduler jobs update http gdu-sync-job \
  --max-retry-attempts=3 \
  --max-retry-duration=600s \
  --location=us-central1
```

### **Configurar timeout:**
```bash
gcloud scheduler jobs update http gdu-sync-job \
  --attempt-deadline=1800s \
  --location=us-central1
```

## 🚨 **Migración Segura**

### **Paso a paso sin downtime:**

1. **Mantener ambos sistemas temporalmente**
   - Deja el cron interno activo
   - Crea Cloud Scheduler con horario diferente
   - Verifica que ambos funcionen

2. **Probar Cloud Scheduler**
   ```bash
   # Ejecutar manualmente
   gcloud scheduler jobs run gdu-sync-job --location=us-central1
   
   # Verificar logs
   gcloud logs read "resource.type=cloud_run_revision" --limit=10
   ```

3. **Deshabilitar cron interno**
   - Cambiar `AUTO_SYNC_ENABLED=false`
   - Redesplegar aplicación

4. **Ajustar horario de Cloud Scheduler**
   ```bash
   gcloud scheduler jobs update http gdu-sync-job \
     --schedule="0 */2 * * *" \
     --location=us-central1
   ```

## 💰 **Costos**
- **Cloud Scheduler**: ~$0.10 USD por mes (12 ejecuciones/día)
- **Cloud Run**: Solo cuando se ejecuta la sincronización
- **Total estimado**: <$1 USD por mes

## 🔍 **Troubleshooting**

### **Job no se ejecuta:**
```bash
# Verificar estado
gcloud scheduler jobs describe gdu-sync-job --location=us-central1

# Ver logs de errores
gcloud logging read 'resource.type="cloud_scheduler_job"' --limit=10
```

### **Errores de autenticación:**
```bash
# Verificar permisos
gcloud projects get-iam-policy TU_PROJECT_ID

# Verificar cuenta de servicio
gcloud iam service-accounts describe gdu-scheduler@TU_PROJECT_ID.iam.gserviceaccount.com
```

### **Backend no responde:**
```bash
# Probar endpoint manualmente
curl -X POST https://TU_BACKEND_URL/sync/manual

# Ver logs de Cloud Run
gcloud logs read "resource.type=cloud_run_revision" --limit=20
```

---

**✅ Con esta configuración tendrás un sistema de sincronización robusto y confiable en GCP sin modificar el código existente.**