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
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Gestor de Unidades - Backend Sync</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 800px; }
            .header { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 15px; margin-bottom: 25px; }
            .section { margin: 20px 0; }
            .endpoint { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; border-left: 4px solid #007bff; }
            .method { font-weight: bold; color: #007bff; }
            .url { font-family: monospace; background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
            .sync-button { 
                display: inline-block; 
                background: #28a745; 
                color: white; 
                padding: 12px 24px; 
                text-decoration: none; 
                border-radius: 5px; 
                font-weight: bold;
                margin: 10px 10px 10px 0;
            }
            .sync-button:hover { background: #218838; color: white; text-decoration: none; }
            .status { color: #28a745; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔄 Gestor de Unidades - Backend Sync</h1>
                <p><strong>Versión:</strong> 1.0.0 | <strong>Estado:</strong> <span class="status">Funcionando</span></p>
                <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            </div>

            <div class="section">
                <h2>🚀 Sincronización Rápida</h2>
                <p>Haz clic para sincronizar las unidades compartidas:</p>
                <a href="/sync/run" class="sync-button">🔄 Sincronizar Ahora</a>
                <a href="/sync/status" class="sync-button" style="background: #17a2b8;">📊 Ver Estado</a>
            </div>

            <div class="section">
                <h2>📡 Endpoints Disponibles</h2>
                
                <h3>🔄 Sincronización</h3>
                <div class="endpoint">
                    <span class="method">GET</span> <span class="url">/sync/run</span><br>
                    <small>Ejecutar sincronización completa (fácil para navegador)</small>
                </div>
                <div class="endpoint">
                    <span class="method">GET</span> <span class="url">/sync/status</span><br>
                    <small>Obtener estado actual de sincronización</small>
                </div>
                <div class="endpoint">
                    <span class="method">POST</span> <span class="url">/sync/full</span><br>
                    <small>Ejecutar sincronización completa (API)</small>
                </div>
                <div class="endpoint">
                    <span class="method">POST</span> <span class="url">/sync/incremental</span><br>
                    <small>Ejecutar sincronización incremental (API)</small>
                </div>
                <div class="endpoint">
                    <span class="method">POST</span> <span class="url">/sync/manual</span><br>
                    <small>Ejecutar sincronización manual (API)</small>
                </div>

                <h3>🏥 Salud y Mantenimiento</h3>
                <div class="endpoint">
                    <span class="method">GET</span> <span class="url">/health</span><br>
                    <small>Verificar estado de salud del sistema</small>
                </div>
                <div class="endpoint">
                    <span class="method">POST</span> <span class="url">/maintenance</span><br>
                    <small>Ejecutar tareas de mantenimiento</small>
                </div>

                <h3>🧪 Pruebas</h3>
                <div class="endpoint">
                    <span class="method">GET</span> <span class="url">/test/drives</span><br>
                    <small>Probar conexión con Google Drive</small>
                </div>
            </div>

            <div class="section">
                <h2>☁️ Automatización GCP</h2>
                <p>Este backend está preparado para automatización con Google Cloud Platform:</p>
                <ul>
                    <li>✅ Cloud Scheduler configurado</li>
                    <li>✅ Service Account con impersonación</li>
                    <li>✅ Firestore como base de datos</li>
                    <li>✅ Logs estructurados</li>
                </ul>
            </div>
        </div>
    </body>
    </html>`;
    
    res.send(html);
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

// === ENDPOINTS GET PARA NAVEGADOR ===

// Ejecutar sincronización completa vía GET (fácil para navegador)
app.get('/sync/run', async (req, res) => {
    try {
        UTILS.log('info', 'Sincronización completa solicitada vía GET (navegador)');
        
        const result = await syncService.performSync();
        
        // Respuesta HTML amigable para el navegador
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sincronización - Gestor de Unidades</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 600px; }
                .success { color: #28a745; }
                .error { color: #dc3545; }
                .stats { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
                .stat-item { margin: 5px 0; }
                .back-link { display: inline-block; margin-top: 20px; color: #007bff; text-decoration: none; }
                .back-link:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔄 Sincronización de Unidades</h1>
                ${result.success ? 
                    `<p class="success">✅ <strong>Sincronización completada exitosamente</strong></p>
                     <div class="stats">
                         <h3>📊 Estadísticas:</h3>
                         <div class="stat-item">📁 <strong>Unidades:</strong> ${result.stats?.drives_count || 0}</div>
                         <div class="stat-item">📂 <strong>Carpetas:</strong> ${result.stats?.folders_count || 0}</div>
                         <div class="stat-item">👥 <strong>Gestores:</strong> ${result.stats?.managers_count || 0}</div>
                         <div class="stat-item">⏱️ <strong>Duración:</strong> ${result.stats?.duration_minutes || 0} minutos</div>
                         <div class="stat-item">🆔 <strong>ID Sync:</strong> ${result.sync_id || 'N/A'}</div>
                     </div>` :
                    `<p class="error">❌ <strong>Error en la sincronización:</strong> ${result.error || 'Error desconocido'}</p>`
                }
                <a href="/" class="back-link">← Volver al inicio</a>
                <a href="/sync/run" class="back-link" style="margin-left: 20px;">🔄 Sincronizar de nuevo</a>
            </div>
        </body>
        </html>`;
        
        res.send(html);
    } catch (error) {
        UTILS.log('error', 'Error en sincronización completa vía GET', null, error);
        
        const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Error - Gestor de Unidades</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 600px; }
                .error { color: #dc3545; }
                .back-link { display: inline-block; margin-top: 20px; color: #007bff; text-decoration: none; }
                .back-link:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>❌ Error en Sincronización</h1>
                <p class="error"><strong>Error:</strong> ${error.message}</p>
                <a href="/" class="back-link">← Volver al inicio</a>
                <a href="/sync/run" class="back-link" style="margin-left: 20px;">🔄 Intentar de nuevo</a>
            </div>
        </body>
        </html>`;
        
        res.status(500).send(errorHtml);
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
app.use((req, res) => {
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