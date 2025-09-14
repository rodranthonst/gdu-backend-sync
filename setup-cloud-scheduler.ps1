# 🕐 Script de configuración automática para Cloud Scheduler
# Gestor de Unidades - Sincronización automática en GCP
# PowerShell Script para Windows

param(
    [string]$BackendUrl,
    [string]$Region = "us-central1",
    [int]$IntervalHours = 2,
    [string]$ProjectId,
    [string]$ServiceName,
    [switch]$NeedsAuth,
    [switch]$Help
)

# Función para mostrar ayuda
function Show-Help {
    Write-Host @"
🕐 Configuración de Cloud Scheduler para GDU

USO:
    .\setup-cloud-scheduler.ps1 [PARÁMETROS]

PARÁMETROS:
    -BackendUrl      URL de tu backend en Cloud Run (requerido)
    -Region          Región de GCP (default: us-central1)
    -IntervalHours   Intervalo en horas (default: 2)
    -ProjectId       ID del proyecto GCP (opcional, usa el actual)
    -ServiceName     Nombre del servicio Cloud Run (para autenticación)
    -NeedsAuth       Habilitar autenticación OIDC
    -Help            Mostrar esta ayuda

EJEMPLOS:
    # Configuración básica
    .\setup-cloud-scheduler.ps1 -BackendUrl "https://gdu-backend-xyz.run.app"
    
    # Con autenticación
    .\setup-cloud-scheduler.ps1 -BackendUrl "https://gdu-backend-xyz.run.app" -NeedsAuth -ServiceName "gdu-backend"
    
    # Configuración personalizada
    .\setup-cloud-scheduler.ps1 -BackendUrl "https://gdu-backend-xyz.run.app" -Region "europe-west1" -IntervalHours 4

"@
}

if ($Help) {
    Show-Help
    exit 0
}

# Función para logging con colores
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    switch ($Level) {
        "INFO" { Write-Host "[$timestamp] $Message" -ForegroundColor Green }
        "WARN" { Write-Host "[WARNING] $Message" -ForegroundColor Yellow }
        "ERROR" { Write-Host "[ERROR] $Message" -ForegroundColor Red }
        "BLUE" { Write-Host "$Message" -ForegroundColor Blue }
    }
}

function Write-Error-Exit {
    param([string]$Message)
    Write-Log $Message "ERROR"
    exit 1
}

# Verificar que gcloud esté instalado
if (!(Get-Command "gcloud" -ErrorAction SilentlyContinue)) {
    Write-Error-Exit "gcloud CLI no está instalado. Instálalo desde: https://cloud.google.com/sdk/docs/install"
}

# Verificar autenticación
$authAccount = gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>$null
if ([string]::IsNullOrEmpty($authAccount)) {
    Write-Error-Exit "No estás autenticado en gcloud. Ejecuta: gcloud auth login"
}

Write-Log "🚀 Iniciando configuración de Cloud Scheduler para GDU..."

# Obtener información del proyecto
if ([string]::IsNullOrEmpty($ProjectId)) {
    $ProjectId = gcloud config get-value project 2>$null
    if ([string]::IsNullOrEmpty($ProjectId)) {
        Write-Error-Exit "No hay proyecto configurado. Ejecuta: gcloud config set project TU_PROJECT_ID"
    }
}

Write-Log "📋 Proyecto actual: $ProjectId"
Write-Log "👤 Usuario autenticado: $authAccount"

# Solicitar información si no se proporcionó
if ([string]::IsNullOrEmpty($BackendUrl)) {
    Write-Host "🌐 Ingresa la URL de tu backend en Cloud Run:" -ForegroundColor Blue
    $BackendUrl = Read-Host "   (ej: https://gdu-backend-xyz.run.app)"
    if ([string]::IsNullOrEmpty($BackendUrl)) {
        Write-Error-Exit "La URL del backend es requerida"
    }
}

# Validar URL
if ($BackendUrl -notmatch "^https?://") {
    Write-Error-Exit "La URL debe comenzar con http:// o https://"
}

# Solicitar autenticación si no se especificó
if (-not $NeedsAuth -and [string]::IsNullOrEmpty($ServiceName)) {
    $authResponse = Read-Host "🔐 ¿Tu backend requiere autenticación? (y/N)"
    if ($authResponse -eq "y" -or $authResponse -eq "Y") {
        $NeedsAuth = $true
        $ServiceName = Read-Host "🏷️ Nombre del servicio Cloud Run"
    }
}

# Mostrar configuración
Write-Log "📋 Configuración:" "BLUE"
Write-Host "   Proyecto: $ProjectId" -ForegroundColor Cyan
Write-Host "   Backend URL: $BackendUrl" -ForegroundColor Cyan
Write-Host "   Región: $Region" -ForegroundColor Cyan
Write-Host "   Intervalo: cada $IntervalHours horas" -ForegroundColor Cyan
Write-Host "   Autenticación: $($NeedsAuth ? 'Sí' : 'No')" -ForegroundColor Cyan
if ($NeedsAuth) {
    Write-Host "   Servicio: $ServiceName" -ForegroundColor Cyan
}

$confirm = Read-Host "\n¿Continuar con la configuración? (Y/n)"
if ($confirm -eq "n" -or $confirm -eq "N") {
    Write-Log "❌ Configuración cancelada"
    exit 0
}

Write-Log "🔧 Habilitando APIs necesarias..."

# Habilitar APIs
try {
    gcloud services enable cloudscheduler.googleapis.com --quiet
    gcloud services enable run.googleapis.com --quiet
    Write-Log "✅ APIs habilitadas"
} catch {
    Write-Error-Exit "Error habilitando APIs: $($_.Exception.Message)"
}

# Crear expresión cron
$cronExpression = "0 */$IntervalHours * * *"
$jobName = "gdu-sync-job"

Write-Log "📅 Creando job de Cloud Scheduler..."
Write-Log "   Expresión cron: $cronExpression" "BLUE"
Write-Log "   Endpoint: $BackendUrl/sync/manual" "BLUE"

try {
    if ($NeedsAuth) {
        Write-Log "🔐 Configurando autenticación..."
        
        # Crear cuenta de servicio
        $serviceAccount = "gdu-scheduler"
        $serviceAccountEmail = "$serviceAccount@$ProjectId.iam.gserviceaccount.com"
        
        Write-Log "   Creando cuenta de servicio: $serviceAccountEmail"
        
        # Verificar si la cuenta de servicio existe
        $saExists = gcloud iam service-accounts describe $serviceAccountEmail 2>$null
        if ($LASTEXITCODE -ne 0) {
            gcloud iam service-accounts create $serviceAccount `
                --display-name="GDU Cloud Scheduler" `
                --description="Cuenta de servicio para ejecutar sincronización automática"
            Write-Log "   ✅ Cuenta de servicio creada"
        } else {
            Write-Log "   ℹ️ Cuenta de servicio ya existe"
        }
        
        # Dar permisos
        if (![string]::IsNullOrEmpty($ServiceName)) {
            Write-Log "   Asignando permisos para invocar Cloud Run..."
            gcloud run services add-iam-policy-binding $ServiceName `
                --member="serviceAccount:$serviceAccountEmail" `
                --role="roles/run.invoker" `
                --region=$Region `
                --quiet
            if ($LASTEXITCODE -eq 0) {
                Write-Log "   ✅ Permisos asignados"
            } else {
                Write-Log "   ⚠️ No se pudieron asignar permisos automáticamente" "WARN"
            }
        }
        
        # Crear job con autenticación
        gcloud scheduler jobs create http $jobName `
            --location=$Region `
            --schedule="$cronExpression" `
            --uri="$BackendUrl/sync/manual" `
            --http-method=POST `
            --headers="Content-Type=application/json" `
            --message-body='{}' `
            --oidc-service-account-email=$serviceAccountEmail `
            --description="Sincronización automática del Gestor de Unidades cada $IntervalHours horas" `
            --max-retry-attempts=3 `
            --max-retry-duration=600s `
            --attempt-deadline=1800s
    } else {
        # Crear job sin autenticación
        gcloud scheduler jobs create http $jobName `
            --location=$Region `
            --schedule="$cronExpression" `
            --uri="$BackendUrl/sync/manual" `
            --http-method=POST `
            --headers="Content-Type=application/json" `
            --message-body='{}' `
            --description="Sincronización automática del Gestor de Unidades cada $IntervalHours horas" `
            --max-retry-attempts=3 `
            --max-retry-duration=600s `
            --attempt-deadline=1800s
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Log "✅ Job de Cloud Scheduler creado exitosamente"
    } else {
        Write-Error-Exit "Error creando el job de Cloud Scheduler"
    }
} catch {
    Write-Error-Exit "Error en la configuración: $($_.Exception.Message)"
}

# Probar el job
Write-Log "🧪 Probando ejecución manual..."
try {
    gcloud scheduler jobs run $jobName --location=$Region --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Log "✅ Ejecución manual exitosa"
        
        # Esperar un poco y verificar logs
        Write-Log "⏳ Esperando logs (10 segundos)..."
        Start-Sleep -Seconds 10
        
        Write-Log "📋 Últimos logs del job:"
        gcloud logging read "resource.type=`"cloud_scheduler_job`" AND resource.labels.job_id=`"$jobName`"" `
            --limit=5 `
            --format="table(timestamp,severity,textPayload)" `
            --freshness=1m
        if ($LASTEXITCODE -ne 0) {
            Write-Log "No se pudieron obtener logs automáticamente" "WARN"
        }
    } else {
        Write-Log "La ejecución manual falló. Revisa la configuración." "WARN"
    }
} catch {
    Write-Log "Error en la prueba: $($_.Exception.Message)" "WARN"
}

# Mostrar información final
Write-Host "`n🎉 ¡Configuración completada!" -ForegroundColor Green

Write-Log "📋 Información del job creado:" "BLUE"
Write-Host "   Nombre: $jobName" -ForegroundColor Cyan
Write-Host "   Región: $Region" -ForegroundColor Cyan
Write-Host "   Horario: cada $IntervalHours horas" -ForegroundColor Cyan
Write-Host "   Endpoint: $BackendUrl/sync/manual" -ForegroundColor Cyan
Write-Host "   Proyecto: $ProjectId" -ForegroundColor Cyan

Write-Log "🔧 Comandos útiles:" "BLUE"
Write-Host "   Ver estado:     gcloud scheduler jobs describe $jobName --location=$Region" -ForegroundColor Yellow
Write-Host "   Ejecutar ahora: gcloud scheduler jobs run $jobName --location=$Region" -ForegroundColor Yellow
Write-Host "   Ver logs:       gcloud logging read 'resource.type=`"cloud_scheduler_job`"' --limit=10" -ForegroundColor Yellow
Write-Host "   Listar jobs:    gcloud scheduler jobs list --location=$Region" -ForegroundColor Yellow
Write-Host "   Eliminar job:   gcloud scheduler jobs delete $jobName --location=$Region" -ForegroundColor Yellow

Write-Log "📝 Próximos pasos:" "BLUE"
Write-Host "   1. Verifica que la sincronización funcione correctamente" -ForegroundColor Cyan
Write-Host "   2. En tu archivo .env, cambia: AUTO_SYNC_ENABLED=false y USE_CLOUD_SCHEDULER=true" -ForegroundColor Cyan
Write-Host "   3. Redespliega tu aplicación en Cloud Run" -ForegroundColor Cyan
Write-Host "   4. Monitorea los logs para asegurar que todo funcione" -ForegroundColor Cyan

Write-Host "`n✅ Cloud Scheduler está configurado y listo para usar" -ForegroundColor Green

Write-Log "🎯 Configuración completada exitosamente"