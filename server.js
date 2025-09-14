require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const syncService = require('./syncService');
const { SERVER, SYNC, UTILS } = require('./config');

const app = express();

// === MIDDLEWARE ===

app.use(cors());
app.use(express.json());

// Middleware de logging
app.use((req, res, next) => {
    UTILS.log('info', `${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

// === RUTAS DE SALUD ===

// Health check
app.get('/health', async (req, res) => {
    try {
        const healthStatus = await syncService.healthCheck();
        const enhancedStatus = {
            ...healthStatus,
            sync: {
                ...healthStatus.sync,
                autoSyncEnabled: SYNC.AUTO_SYNC_ENABLED,
                useCloudScheduler: SYNC.USE_CLOUD_SCHEDULER,
                cronJobActive: cronJob !== null
            }
        };
        res.status(healthStatus.success ? 200 : 503).json(enhancedStatus);
    } catch (error) {
        UTILS.log('error', 'Error en health check', null, error);
        res.status(503).json({
            success: false,
            error: error.message
        });
    }
});

// Estado básico del servidor
app.get('/', (req, res) => {
    res.json({
        service: 'Gestor de Unidades - Backend Sync',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/health',
            sync: {
                status: '/sync/status',
                full: '/sync/full',
                incremental: '/sync/incremental',
                manual: '/sync/manual'
            },
            maintenance: '/maintenance'
        }
    });
});

// === RUTAS DE SINCRONIZACIÓN ===

// Obtener estado de sincronización
app.get('/sync/status', async (req, res) => {
    try {
        const status = await syncService.getSyncStatus();
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        UTILS.log('error', 'Error al obtener estado de sincronización', null, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ejecutar sincronización completa
app.post('/sync/full', async (req, res) => {
    try {
        UTILS.log('info', 'Sincronización completa solicitada vía API');
        
        const result = await syncService.performSync();
        
        res.json({
            success: result.success,
            data: result
        });
    } catch (error) {
        UTILS.log('error', 'Error en sincronización completa vía API', null, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ejecutar sincronización incremental
app.post('/sync/incremental', async (req, res) => {
    try {
        const { driveIds = [] } = req.body;
        
        UTILS.log('info', 'Sincronización incremental solicitada vía API', {
            driveIds: driveIds
        });
        
        const result = await syncService.performIncrementalSync(driveIds);
        
        res.json({
            success: result.success,
            data: result
        });
    } catch (error) {
        UTILS.log('error', 'Error en sincronización incremental vía API', null, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ejecutar sincronización manual (alias para completa)
app.post('/sync/manual', async (req, res) => {
    try {
        UTILS.log('info', 'Sincronización manual solicitada vía API');
        
        const result = await syncService.performSync();
        
        res.json({
            success: result.success,
            data: result,
            message: 'Sincronización manual ejecutada'
        });
    } catch (error) {
        UTILS.log('error', 'Error en sincronización manual vía API', null, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint de prueba para verificar impersonación
app.get('/test/drives', async (req, res) => {
    try {
        const googleDriveService = require('./googleDriveService');
        await googleDriveService.initialize();
        
        // Obtener información del usuario actual
        const aboutResponse = await googleDriveService.drive.about.get({ 
            fields: 'user' 
        });
        
        // Intentar obtener unidades compartidas
        const drivesResponse = await googleDriveService.drive.drives.list({
            pageSize: 10,
            fields: 'drives(id,name)'
        });
        
        res.json({
            success: true,
            user: aboutResponse.data.user,
            drives: drivesResponse.data.drives || [],
            impersonating: process.env.IMPERSONATE_USER_EMAIL
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            impersonating: process.env.IMPERSONATE_USER_EMAIL
        });
    }
});

// === RUTAS DE MANTENIMIENTO ===

// Ejecutar mantenimiento
app.post('/maintenance', async (req, res) => {
    try {
        UTILS.log('info', 'Mantenimiento solicitado vía API');
        
        const result = await syncService.performMaintenance();
        
        res.json({
            success: result.success,
            data: result
        });
    } catch (error) {
        UTILS.log('error', 'Error en mantenimiento vía API', null, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// === RUTAS DE API FIRESTORE ===

const firestoreService = require('./firestoreService');
const googleDriveService = require('./googleDriveService');

// Obtener unidades compartidas desde Firestore
app.get('/api/firestore/shared-drives', async (req, res) => {
    try {
        const drives = await firestoreService.getSharedDrives();
        res.json({
            success: true,
            drives: drives
        });
    } catch (error) {
        UTILS.log('error', 'Error al obtener unidades desde Firestore', null, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Crear nueva unidad compartida
app.post('/api/shared-drives', async (req, res) => {
    try {
        const { name, managers } = req.body;
        
        // Validar nombre
        if (!name || name.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                error: 'El nombre de la unidad es requerido' 
            });
        }
        
        // Procesar managers
         const managerEmails = managers ? 
             (typeof managers === 'string' ? 
                 managers.split(',').map(email => email.trim()).filter(email => email) : 
                 Array.isArray(managers) ? managers : []) : 
             [];
        
        UTILS.log('info', `Creando unidad compartida: ${name.trim()}`);
         
         // Crear unidad en Google Drive
         const result = await googleDriveService.createSharedDrive(name.trim(), managerEmails);
        
        // Guardar en Firestore
        await firestoreService.saveNewSharedDrive(result.drive, result.managers);
        
        UTILS.log('info', `Unidad compartida creada y guardada: ${result.drive.name} (ID: ${result.drive.id})`);
        
        res.json({
            success: true,
            drive: result.drive,
            managers: result.managers
        });
        
    } catch (error) {
        UTILS.log('error', 'Error al crear unidad compartida', null, error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Error interno del servidor' 
        });
    }
});

// === MANEJO DE ERRORES ===

// Middleware de manejo de errores
app.use((error, req, res, next) => {
    UTILS.log('error', 'Error no manejado en el servidor', {
        path: req.path,
        method: req.method
    }, error);
    
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// Ruta no encontrada
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint no encontrado',
        path: req.originalUrl
    });
});

// === PROGRAMACIÓN DE TAREAS ===

let cronJob = null;

function setupCronJob() {
    if (!SYNC.AUTO_SYNC_ENABLED) {
        UTILS.log('info', 'Sincronización automática deshabilitada');
        return;
    }
    
    if (SYNC.USE_CLOUD_SCHEDULER) {
        UTILS.log('info', 'Usando Cloud Scheduler - cron interno deshabilitado');
        return;
    }

    // Crear expresión cron para ejecutar cada X horas
    const cronExpression = `0 0 */${SYNC.INTERVAL_HOURS} * * *`;
    
    UTILS.log('info', `Configurando sincronización automática cada ${SYNC.INTERVAL_HOURS} horas`);
    UTILS.log('info', `Expresión cron: ${cronExpression}`);

    cronJob = cron.schedule(cronExpression, async () => {
        try {
            UTILS.log('info', 'Ejecutando sincronización automática programada');
            
            const result = await syncService.performSync();
            
            if (result.success) {
                UTILS.log('info', 'Sincronización automática completada exitosamente');
            } else {
                UTILS.log('error', 'Sincronización automática falló', null, new Error(result.error));
            }
        } catch (error) {
            UTILS.log('error', 'Error en sincronización automática', null, error);
        }
    }, {
        scheduled: true,
        timezone: 'America/Lima' // Ajustar según tu zona horaria
    });

    UTILS.log('info', 'Sincronización automática configurada');
}

function stopCronJob() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
        UTILS.log('info', 'Sincronización automática detenida');
    }
}

// === INICIALIZACIÓN DEL SERVIDOR ===

async function startServer() {
    try {
        UTILS.log('info', 'Iniciando Backend Sync Server');
        
        // Inicializar servicios
        await syncService.initialize();
        
        // Configurar tareas programadas
        setupCronJob();
        
        // Iniciar servidor
        const server = app.listen(SERVER.PORT, () => {
            UTILS.log('info', `Backend Sync Server ejecutándose en puerto ${SERVER.PORT}`);
            UTILS.log('info', `Entorno: ${process.env.NODE_ENV || 'development'}`);
            UTILS.log('info', `URL: http://localhost:${SERVER.PORT}`);
            
            if (SYNC.ENABLED) {
                UTILS.log('info', `Sincronización automática: Cada ${SYNC.INTERVAL_HOURS} horas`);
            } else {
                UTILS.log('info', 'Sincronización automática: Deshabilitada');
            }
        });

        // Manejo de cierre graceful
        process.on('SIGTERM', () => {
            UTILS.log('info', 'Recibida señal SIGTERM, cerrando servidor...');
            stopCronJob();
            server.close(() => {
                UTILS.log('info', 'Servidor cerrado');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            UTILS.log('info', 'Recibida señal SIGINT, cerrando servidor...');
            stopCronJob();
            server.close(() => {
                UTILS.log('info', 'Servidor cerrado');
                process.exit(0);
            });
        });

        // Manejo de errores no capturados
        process.on('uncaughtException', (error) => {
            UTILS.log('error', 'Excepción no capturada', null, error);
            stopCronJob();
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            UTILS.log('error', 'Promesa rechazada no manejada', { promise }, reason);
            stopCronJob();
            process.exit(1);
        });

    } catch (error) {
        UTILS.log('error', 'Error al iniciar el servidor', null, error);
        process.exit(1);
    }
}

// === COMANDOS CLI ===

// Permitir ejecución de comandos desde línea de comandos
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'sync':
            // Ejecutar sincronización única
            (async () => {
                try {
                    await syncService.initialize();
                    const result = await syncService.performSync();
                    console.log('Resultado:', JSON.stringify(result, null, 2));
                    process.exit(result.success ? 0 : 1);
                } catch (error) {
                    console.error('Error:', error.message);
                    process.exit(1);
                }
            })();
            break;
            
        case 'status':
            // Obtener estado
            (async () => {
                try {
                    await syncService.initialize();
                    const status = await syncService.getSyncStatus();
                    console.log('Estado:', JSON.stringify(status, null, 2));
                    process.exit(0);
                } catch (error) {
                    console.error('Error:', error.message);
                    process.exit(1);
                }
            })();
            break;
            
        case 'maintenance':
            // Ejecutar mantenimiento
            (async () => {
                try {
                    await syncService.initialize();
                    const result = await syncService.performMaintenance();
                    console.log('Resultado:', JSON.stringify(result, null, 2));
                    process.exit(result.success ? 0 : 1);
                } catch (error) {
                    console.error('Error:', error.message);
                    process.exit(1);
                }
            })();
            break;
            
        default:
            // Iniciar servidor
            startServer();
            break;
    }
} else {
    // Exportar para uso como módulo
    module.exports = app;
}