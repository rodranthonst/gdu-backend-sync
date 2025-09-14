#!/bin/bash

# 🕐 Script de configuración automática para Cloud Scheduler
# Gestor de Unidades - Sincronización automática en GCP

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para logging
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Verificar que gcloud esté instalado
if ! command -v gcloud &> /dev/null; then
    error "gcloud CLI no está instalado. Instálalo desde: https://cloud.google.com/sdk/docs/install"
fi

# Verificar autenticación
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    error "No estás autenticado en gcloud. Ejecuta: gcloud auth login"
fi

log "🚀 Iniciando configuración de Cloud Scheduler para GDU..."

# Obtener información del proyecto
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    error "No hay proyecto configurado. Ejecuta: gcloud config set project TU_PROJECT_ID"
fi

log "📋 Proyecto actual: $PROJECT_ID"

# Solicitar información necesaria
echo -e "${BLUE}Por favor, proporciona la siguiente información:${NC}"

read -p "🌐 URL de tu backend en Cloud Run (ej: https://gdu-backend-xyz.run.app): " BACKEND_URL
if [ -z "$BACKEND_URL" ]; then
    error "La URL del backend es requerida"
fi

read -p "📍 Región de Cloud Run (default: us-central1): " REGION
REGION=${REGION:-us-central1}

read -p "⏰ Intervalo en horas (default: 2): " INTERVAL_HOURS
INTERVAL_HOURS=${INTERVAL_HOURS:-2}

read -p "🔐 ¿Requiere autenticación? (y/N): " NEEDS_AUTH
NEEDS_AUTH=${NEEDS_AUTH:-N}

read -p "🏷️ Nombre del servicio Cloud Run (para autenticación): " SERVICE_NAME

# Confirmar configuración
echo -e "\n${BLUE}📋 Configuración:${NC}"
echo "   Proyecto: $PROJECT_ID"
echo "   Backend URL: $BACKEND_URL"
echo "   Región: $REGION"
echo "   Intervalo: cada $INTERVAL_HOURS horas"
echo "   Autenticación: $NEEDS_AUTH"
if [ "$NEEDS_AUTH" = "y" ] || [ "$NEEDS_AUTH" = "Y" ]; then
    echo "   Servicio: $SERVICE_NAME"
fi

read -p "\n¿Continuar con la configuración? (Y/n): " CONFIRM
CONFIRM=${CONFIRM:-Y}

if [ "$CONFIRM" != "Y" ] && [ "$CONFIRM" != "y" ]; then
    log "❌ Configuración cancelada"
    exit 0
fi

log "🔧 Habilitando APIs necesarias..."

# Habilitar APIs
gcloud services enable cloudscheduler.googleapis.com --quiet
gcloud services enable run.googleapis.com --quiet

log "✅ APIs habilitadas"

# Crear expresión cron
CRON_EXPRESSION="0 */$INTERVAL_HOURS * * *"

log "📅 Creando job de Cloud Scheduler..."
log "   Expresión cron: $CRON_EXPRESSION"
log "   Endpoint: $BACKEND_URL/sync/manual"

# Crear el job básico
JOB_NAME="gdu-sync-job"

if [ "$NEEDS_AUTH" = "y" ] || [ "$NEEDS_AUTH" = "Y" ]; then
    log "🔐 Configurando autenticación..."
    
    # Crear cuenta de servicio
    SERVICE_ACCOUNT="gdu-scheduler"
    SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
    
    log "   Creando cuenta de servicio: $SERVICE_ACCOUNT_EMAIL"
    
    if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" &>/dev/null; then
        gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
            --display-name="GDU Cloud Scheduler" \
            --description="Cuenta de servicio para ejecutar sincronización automática"
        log "   ✅ Cuenta de servicio creada"
    else
        log "   ℹ️ Cuenta de servicio ya existe"
    fi
    
    # Dar permisos
    if [ -n "$SERVICE_NAME" ]; then
        log "   Asignando permisos para invocar Cloud Run..."
        gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
            --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
            --role="roles/run.invoker" \
            --region="$REGION" \
            --quiet || warn "No se pudieron asignar permisos automáticamente"
    fi
    
    # Crear job con autenticación
    gcloud scheduler jobs create http "$JOB_NAME" \
        --location="$REGION" \
        --schedule="$CRON_EXPRESSION" \
        --uri="$BACKEND_URL/sync/manual" \
        --http-method=POST \
        --headers="Content-Type=application/json" \
        --message-body='{}' \
        --oidc-service-account-email="$SERVICE_ACCOUNT_EMAIL" \
        --description="Sincronización automática del Gestor de Unidades cada $INTERVAL_HOURS horas" \
        --max-retry-attempts=3 \
        --max-retry-duration=600s \
        --attempt-deadline=1800s
else
    # Crear job sin autenticación
    gcloud scheduler jobs create http "$JOB_NAME" \
        --location="$REGION" \
        --schedule="$CRON_EXPRESSION" \
        --uri="$BACKEND_URL/sync/manual" \
        --http-method=POST \
        --headers="Content-Type=application/json" \
        --message-body='{}' \
        --description="Sincronización automática del Gestor de Unidades cada $INTERVAL_HOURS horas" \
        --max-retry-attempts=3 \
        --max-retry-duration=600s \
        --attempt-deadline=1800s
fi

log "✅ Job de Cloud Scheduler creado exitosamente"

# Probar el job
log "🧪 Probando ejecución manual..."
if gcloud scheduler jobs run "$JOB_NAME" --location="$REGION" --quiet; then
    log "✅ Ejecución manual exitosa"
    
    # Esperar un poco y verificar logs
    log "⏳ Esperando logs (10 segundos)..."
    sleep 10
    
    log "📋 Últimos logs del job:"
    gcloud logging read "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=\"$JOB_NAME\"" \
        --limit=5 \
        --format="table(timestamp,severity,textPayload)" \
        --freshness=1m || warn "No se pudieron obtener logs automáticamente"
else
    warn "La ejecución manual falló. Revisa la configuración."
fi

# Mostrar información final
echo -e "\n${GREEN}🎉 ¡Configuración completada!${NC}\n"

echo -e "${BLUE}📋 Información del job creado:${NC}"
echo "   Nombre: $JOB_NAME"
echo "   Región: $REGION"
echo "   Horario: cada $INTERVAL_HOURS horas"
echo "   Endpoint: $BACKEND_URL/sync/manual"
echo "   Proyecto: $PROJECT_ID"

echo -e "\n${BLUE}🔧 Comandos útiles:${NC}"
echo "   Ver estado:     gcloud scheduler jobs describe $JOB_NAME --location=$REGION"
echo "   Ejecutar ahora: gcloud scheduler jobs run $JOB_NAME --location=$REGION"
echo "   Ver logs:       gcloud logging read 'resource.type=\"cloud_scheduler_job\"' --limit=10"
echo "   Listar jobs:    gcloud scheduler jobs list --location=$REGION"
echo "   Eliminar job:   gcloud scheduler jobs delete $JOB_NAME --location=$REGION"

echo -e "\n${BLUE}📝 Próximos pasos:${NC}"
echo "   1. Verifica que la sincronización funcione correctamente"
echo "   2. Deshabilita el cron interno en tu aplicación (AUTO_SYNC_ENABLED=false)"
echo "   3. Redespliega tu aplicación en Cloud Run"
echo "   4. Monitorea los logs para asegurar que todo funcione"

echo -e "\n${GREEN}✅ Cloud Scheduler está configurado y listo para usar${NC}"

log "🎯 Configuración completada exitosamente"