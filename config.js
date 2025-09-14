const path = require('path');

// Configuración de rutas
const PATHS = {
  CREDENTIALS_DIR: path.join(__dirname, 'credenciales')
};

// Configuración de Google Drive API
const GOOGLE_DRIVE_API = {
  // Las credenciales se obtienen desde variables de entorno
  SCOPES: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file'
  ],
  API_VERSION: 'v3'
};

// Configuración del backend de sincronización
const SERVER = {
  PORT: process.env.PORT || 3001,
  VERSION: '2.0.0',
  NAME: 'Google Drive Sync Backend',
  ENVIRONMENT: process.env.NODE_ENV || 'development'
};

// Configuración de sincronización
const SYNC = {
  // Intervalo de sincronización en minutos (por defecto 2 horas = 120 minutos)
  INTERVAL_MINUTES: parseInt(process.env.SYNC_INTERVAL_MINUTES) || 120,
  
  // Zona horaria para los cron jobs
  TIMEZONE: process.env.SYNC_TIMEZONE || 'America/Mexico_City',
  
  // Número máximo de reintentos en caso de error
  MAX_RETRIES: parseInt(process.env.SYNC_MAX_RETRIES) || 3,
  
  // Tiempo de espera entre reintentos (en segundos)
  RETRY_DELAY_SECONDS: parseInt(process.env.SYNC_RETRY_DELAY) || 30,
  
  // Límite de elementos por lote en las consultas
  BATCH_SIZE: parseInt(process.env.SYNC_BATCH_SIZE) || 100,
  
  // Habilitar sincronización automática
  AUTO_SYNC_ENABLED: process.env.AUTO_SYNC_ENABLED !== 'false'
};

// Configuración de impersonación
const IMPERSONATION = {
  USER_EMAIL: process.env.IMPERSONATE_USER_EMAIL
};

// Configuración de Firestore
const FIRESTORE = {
  PROJECT_ID: process.env.GCP_PROJECT_ID,
  DATABASE_ID: process.env.FIRESTORE_DATABASE_ID || '(default)'
};

// Configuración de logging
const LOGGING = {
  LEVELS: {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug'
  },
  ENABLE_DEBUG: process.env.ENABLE_DEBUG === 'true' || process.env.NODE_ENV === 'development',
  LOG_TO_FILE: process.env.LOG_TO_FILE === 'true',
  LOG_FILE_PATH: process.env.LOG_FILE_PATH || path.join(__dirname, 'logs', 'sync.log')
};

// Mensajes de respuesta
const MESSAGES = {
  SYNC: {
    STARTED: 'Sincronización iniciada',
    COMPLETED: 'Sincronización completada exitosamente',
    FAILED: 'Sincronización falló',
    DRIVES_SYNCED: 'Unidades compartidas sincronizadas',
    FOLDERS_SYNCED: 'Carpetas sincronizadas',
    PERMISSIONS_SYNCED: 'Permisos sincronizados'
  },
  ERRORS: {
    DRIVE_API_ERROR: 'Error en la API de Google Drive',
    FIRESTORE_ERROR: 'Error en Firestore',
    AUTHENTICATION_ERROR: 'Error de autenticación',
    SYNC_IN_PROGRESS: 'Ya hay una sincronización en progreso',
    INVALID_CONFIGURATION: 'Configuración inválida'
  }
};

// Utilidades
const UTILS = {
  // Función para log con timestamp y nivel
  log: (level, message, data = null, error = null) => {
    if (!LOGGING.ENABLE_DEBUG && level === LOGGING.LEVELS.DEBUG) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [SYNC-BACKEND] ${message}`;
    
    if (error) {
      console.log(logMessage, '\nError:', error.message);
      if (LOGGING.ENABLE_DEBUG && error.stack) {
        console.log('Stack:', error.stack);
      }
    } else if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
    
    // TODO: Implementar logging a archivo si está habilitado
    if (LOGGING.LOG_TO_FILE) {
      // Implementar escritura a archivo
    }
  },
  
  // Función para formatear fecha
  formatDate: (date) => {
    return new Date(date).toISOString();
  },
  
  // Función para generar ID único
  generateId: () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  },
  
  // Función para delay/sleep
  sleep: (seconds) => {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  },
  
  // Función para validar email
  isValidEmail: (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },
  
  // Función para construir ruta de carpeta
  buildPath: (pathParts) => {
    return '/' + pathParts.filter(part => part && part.trim()).join('/');
  },
  
  // Función para obtener estadísticas de sincronización
  getSyncStats: (startTime, endTime, counts) => {
    const duration = endTime - startTime;
    const durationMinutes = Math.round(duration / 1000 / 60 * 100) / 100;
    
    return {
      start_time: startTime,
      end_time: endTime,
      duration_ms: duration,
      duration_minutes: durationMinutes,
      ...counts
    };
  }
};

// Configuración de colecciones de Firestore
const COLLECTIONS = {
  SHARED_DRIVES: 'shared_drives',
  FOLDERS: 'folders',
  DRIVE_MANAGERS: 'drive_managers',
  SYNC_HISTORY: 'sync_history',
  SYNC_STATUS: 'sync_status'
};

// Estados de sincronización
const SYNC_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

// Validación de configuración
function validateConfig() {
  const errors = [];
  
  if (!AUTH.IMPERSONATE_USER_EMAIL) {
    errors.push('IMPERSONATE_USER_EMAIL no está configurado');
  }
  
  if (!FIRESTORE.PROJECT_ID) {
    errors.push('GCP_PROJECT_ID no está configurado');
  }
  
  if (SYNC.INTERVAL_MINUTES < 1) {
    errors.push('SYNC_INTERVAL_MINUTES debe ser mayor a 0');
  }
  
  if (errors.length > 0) {
    UTILS.log('error', 'Errores de configuración encontrados:', errors);
    return false;
  }
  
  return true;
}

module.exports = {
  PATHS,
  GOOGLE_DRIVE_API,
  SERVER,
  SYNC,
  IMPERSONATION,
  FIRESTORE,
  LOGGING,
  MESSAGES,
  UTILS,
  COLLECTIONS,
  SYNC_STATUS,
  validateConfig
};