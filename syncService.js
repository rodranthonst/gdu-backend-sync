const googleDriveService = require('./googleDriveService');
const firestoreService = require('./firestoreService');
const { SYNC, UTILS } = require('./config');
const { v4: uuidv4 } = require('uuid');

class SyncService {
    constructor() {
        this.isRunning = false;
        this.currentSyncId = null;
        this.syncStats = {
            drives_count: 0,
            folders_count: 0,
            managers_count: 0,
            errors: [],
            start_time: null,
            end_time: null,
            duration_ms: 0,
            duration_minutes: 0
        };
    }

    // === INICIALIZACIÓN ===

    async initialize() {
        try {
            UTILS.log('info', 'Inicializando Sync Service');
            
            // Inicializar servicios
            await Promise.all([
                googleDriveService.initialize(),
                firestoreService.initialize()
            ]);
            
            UTILS.log('info', 'Sync Service inicializado exitosamente');
        } catch (error) {
            UTILS.log('error', 'Error al inicializar Sync Service', null, error);
            throw error;
        }
    }

    // === SINCRONIZACIÓN PRINCIPAL ===

    async performSync(options = {}) {
        if (this.isRunning) {
            const message = 'Ya hay una sincronización en progreso';
            UTILS.log('warn', message);
            throw new Error(message);
        }

        this.isRunning = true;
        this.currentSyncId = uuidv4();
        this.resetStats();
        this.syncStats.start_time = new Date();

        try {
            UTILS.log('info', `Iniciando sincronización completa - ID: ${this.currentSyncId}`);
            
            // Registrar inicio en Firestore
            await firestoreService.recordSyncStart(this.currentSyncId);
            await firestoreService.updateSyncStatus('running', this.currentSyncId);

            // Verificar conectividad
            const connectionTest = await googleDriveService.testConnection();
            if (!connectionTest.success) {
                throw new Error(`Error de conectividad con Google Drive: ${connectionTest.error}`);
            }

            UTILS.log('info', `Conectado como: ${connectionTest.user.emailAddress}`);

            // Realizar sincronización completa desde Google Drive
            const driveData = await googleDriveService.performFullSync();
            this.syncStats.drives_count = driveData.stats.drives_count;
            this.syncStats.folders_count = driveData.stats.folders_count;
            this.syncStats.managers_count = driveData.stats.managers_count;
            this.syncStats.errors = driveData.stats.errors;

            // Actualizar progreso
            await firestoreService.updateSyncProgress(this.currentSyncId, {
                drives_count: this.syncStats.drives_count,
                status: 'syncing_to_firestore'
            });

            // Sincronizar datos a Firestore
            await this.syncToFirestore(driveData.drives);

            // Calcular duración
            this.syncStats.end_time = new Date();
            this.syncStats.duration_ms = this.syncStats.end_time - this.syncStats.start_time;
            this.syncStats.duration_minutes = Math.round(this.syncStats.duration_ms / 60000 * 100) / 100;

            // Completar registro
            const status = this.syncStats.errors.length > 0 ? 'completed_with_errors' : 'completed';
            await firestoreService.completeSyncRecord(this.currentSyncId, this.syncStats, status);
            await firestoreService.updateSyncStatus(status);

            UTILS.log('info', `Sincronización completada - Duración: ${this.syncStats.duration_minutes} minutos`);
            UTILS.log('info', `Estadísticas: ${this.syncStats.drives_count} unidades, ${this.syncStats.folders_count} carpetas, ${this.syncStats.managers_count} managers`);
            
            if (this.syncStats.errors.length > 0) {
                UTILS.log('warn', `Se encontraron ${this.syncStats.errors.length} errores durante la sincronización`);
            }

            return {
                success: true,
                sync_id: this.currentSyncId,
                stats: this.syncStats,
                status: status
            };

        } catch (error) {
            this.syncStats.end_time = new Date();
            this.syncStats.duration_ms = this.syncStats.end_time - this.syncStats.start_time;
            this.syncStats.duration_minutes = Math.round(this.syncStats.duration_ms / 60000 * 100) / 100;
            this.syncStats.errors.push(`Error crítico: ${error.message}`);

            // Registrar error
            await firestoreService.completeSyncRecord(this.currentSyncId, this.syncStats, 'failed');
            await firestoreService.updateSyncStatus('failed');

            UTILS.log('error', `Sincronización falló - ID: ${this.currentSyncId}`, null, error);
            
            return {
                success: false,
                sync_id: this.currentSyncId,
                stats: this.syncStats,
                error: error.message,
                status: 'failed'
            };

        } finally {
            this.isRunning = false;
            this.currentSyncId = null;
        }
    }

    // === SINCRONIZACIÓN A FIRESTORE ===

    async syncToFirestore(drives) {
        try {
            UTILS.log('info', 'Sincronizando datos a Firestore');

            // 1. Sincronizar unidades compartidas
            const syncResult = await firestoreService.syncSharedDrives(drives);
            UTILS.log('info', `Resultado sincronización: ${syncResult.processed} procesadas, ${syncResult.deleted} eliminadas`);
            
            // 2. Sincronizar carpetas y managers por unidad
            for (let i = 0; i < drives.length; i++) {
                const drive = drives[i];
                
                try {
                    UTILS.log('debug', `Sincronizando datos de unidad ${i + 1}/${drives.length}: ${drive.name}`);
                    
                    // Sincronizar carpetas y managers en paralelo
                    await Promise.all([
                        firestoreService.syncFoldersForDrive(drive.id, drive.folders || []),
                        firestoreService.syncManagersForDrive(drive.id, drive.name, drive.managers || [])
                    ]);
                    
                    // Actualizar progreso
                    await firestoreService.updateSyncProgress(this.currentSyncId, {
                        current_drive: `${i + 1}/${drives.length}`,
                        current_drive_name: drive.name
                    });
                    
                } catch (error) {
                    const errorMsg = `Error sincronizando unidad ${drive.name} a Firestore: ${error.message}`;
                    UTILS.log('error', errorMsg, null, error);
                    this.syncStats.errors.push(errorMsg);
                }
            }

            UTILS.log('info', 'Sincronización a Firestore completada');

        } catch (error) {
            UTILS.log('error', 'Error al sincronizar a Firestore', null, error);
            throw error;
        }
    }

    // === SINCRONIZACIÓN INCREMENTAL ===

    async performIncrementalSync(driveIds = []) {
        if (this.isRunning) {
            throw new Error('Ya hay una sincronización en progreso');
        }

        this.isRunning = true;
        this.currentSyncId = uuidv4();
        this.resetStats();
        this.syncStats.start_time = new Date();

        try {
            UTILS.log('info', `Iniciando sincronización incremental - ID: ${this.currentSyncId}`);
            
            await firestoreService.recordSyncStart(this.currentSyncId);
            await firestoreService.updateSyncStatus('running', this.currentSyncId);

            let drivesToSync = [];
            
            if (driveIds.length > 0) {
                // Sincronizar unidades específicas
                for (const driveId of driveIds) {
                    try {
                        const driveInfo = await googleDriveService.getDriveInfo(driveId);
                        const [folders, managers] = await Promise.all([
                            googleDriveService.getFoldersFromDrive(driveId, driveInfo.name),
                            googleDriveService.getManagersFromDrive(driveId, driveInfo.name)
                        ]);
                        
                        driveInfo.folders = folders;
                        driveInfo.managers = managers;
                        drivesToSync.push(driveInfo);
                        
                        this.syncStats.drives_count++;
                        this.syncStats.folders_count += folders.length;
                        this.syncStats.managers_count += managers.length;
                        
                    } catch (error) {
                        const errorMsg = `Error obteniendo datos de unidad ${driveId}: ${error.message}`;
                        UTILS.log('error', errorMsg, null, error);
                        this.syncStats.errors.push(errorMsg);
                    }
                }
            } else {
                // Sincronizar todas las unidades (igual que sync completo)
                const driveData = await googleDriveService.performFullSync();
                drivesToSync = driveData.drives;
                this.syncStats = { ...this.syncStats, ...driveData.stats };
            }

            // Sincronizar a Firestore
            await this.syncToFirestore(drivesToSync);

            // Completar
            this.syncStats.end_time = new Date();
            this.syncStats.duration_ms = this.syncStats.end_time - this.syncStats.start_time;
            this.syncStats.duration_minutes = Math.round(this.syncStats.duration_ms / 60000 * 100) / 100;

            const status = this.syncStats.errors.length > 0 ? 'completed_with_errors' : 'completed';
            await firestoreService.completeSyncRecord(this.currentSyncId, this.syncStats, status);
            await firestoreService.updateSyncStatus(status);

            UTILS.log('info', `Sincronización incremental completada - Duración: ${this.syncStats.duration_minutes} minutos`);
            
            return {
                success: true,
                sync_id: this.currentSyncId,
                stats: this.syncStats,
                status: status
            };

        } catch (error) {
            this.syncStats.end_time = new Date();
            this.syncStats.duration_ms = this.syncStats.end_time - this.syncStats.start_time;
            this.syncStats.duration_minutes = Math.round(this.syncStats.duration_ms / 60000 * 100) / 100;
            this.syncStats.errors.push(`Error crítico: ${error.message}`);

            await firestoreService.completeSyncRecord(this.currentSyncId, this.syncStats, 'failed');
            await firestoreService.updateSyncStatus('failed');

            UTILS.log('error', `Sincronización incremental falló - ID: ${this.currentSyncId}`, null, error);
            
            return {
                success: false,
                sync_id: this.currentSyncId,
                stats: this.syncStats,
                error: error.message,
                status: 'failed'
            };

        } finally {
            this.isRunning = false;
            this.currentSyncId = null;
        }
    }

    // === ESTADO Y ESTADÍSTICAS ===

    async getSyncStatus() {
        try {
            const [firestoreStatus, dbStats] = await Promise.all([
                firestoreService.getSyncStatus(),
                firestoreService.getDatabaseStats()
            ]);

            return {
                current_sync: {
                    is_running: this.isRunning,
                    sync_id: this.currentSyncId,
                    start_time: this.syncStats.start_time
                },
                firestore_status: firestoreStatus,
                database_stats: dbStats,
                sync_config: {
                    interval_hours: SYNC.INTERVAL_HOURS,
                    enabled: SYNC.ENABLED
                }
            };
        } catch (error) {
            UTILS.log('error', 'Error al obtener estado de sincronización', null, error);
            return {
                current_sync: {
                    is_running: this.isRunning,
                    sync_id: this.currentSyncId
                },
                error: error.message
            };
        }
    }

    // === MANTENIMIENTO ===

    async performMaintenance() {
        try {
            UTILS.log('info', 'Iniciando mantenimiento de la base de datos');
            
            const cleanedRecords = await firestoreService.cleanupSyncHistory(50);
            
            UTILS.log('info', `Mantenimiento completado - ${cleanedRecords} registros antiguos eliminados`);
            
            return {
                success: true,
                cleaned_records: cleanedRecords
            };
        } catch (error) {
            UTILS.log('error', 'Error durante el mantenimiento', null, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // === UTILIDADES PRIVADAS ===

    resetStats() {
        this.syncStats = {
            drives_count: 0,
            folders_count: 0,
            managers_count: 0,
            errors: [],
            start_time: null,
            end_time: null,
            duration_ms: 0,
            duration_minutes: 0
        };
    }

    // === VERIFICACIÓN DE SERVICIOS ===

    async healthCheck() {
        try {
            const [driveTest, firestoreStats] = await Promise.all([
                googleDriveService.testConnection(),
                firestoreService.getDatabaseStats()
            ]);

            return {
                success: true,
                google_drive: driveTest,
                firestore: {
                    connected: true,
                    stats: firestoreStats
                },
                sync_service: {
                    is_running: this.isRunning,
                    current_sync_id: this.currentSyncId
                }
            };
        } catch (error) {
            UTILS.log('error', 'Error en health check', null, error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

const syncService = new SyncService();

module.exports = syncService;