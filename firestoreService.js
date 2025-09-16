const { Firestore } = require('@google-cloud/firestore');
const { FIRESTORE, COLLECTIONS, UTILS } = require('./config');

class FirestoreSyncService {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    // === INICIALIZACIÓN ===

    async initialize() {
        try {
            // Crear credenciales desde variables de entorno
            const serviceAccountCredentials = {
                type: process.env.GOOGLE_SERVICE_ACCOUNT_TYPE,
                project_id: process.env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID,
                private_key_id: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
                private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL,
                client_id: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID,
                auth_uri: process.env.GOOGLE_SERVICE_ACCOUNT_AUTH_URI,
                token_uri: process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN_URI,
                auth_provider_x509_cert_url: process.env.GOOGLE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL,
                client_x509_cert_url: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL,
                universe_domain: process.env.GOOGLE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN
            };

            const firestoreConfig = {
                credentials: serviceAccountCredentials
            };
            
            if (FIRESTORE.PROJECT_ID) {
                firestoreConfig.projectId = FIRESTORE.PROJECT_ID;
            }
            if (FIRESTORE.DATABASE_ID !== '(default)') {
                firestoreConfig.databaseId = FIRESTORE.DATABASE_ID;
            }

            this.db = new Firestore(firestoreConfig);

            // Verificar conexión
            await this.db.collection('_health').doc('sync-test').set({ 
                timestamp: new Date(),
                service: 'sync-backend'
            });
            await this.db.collection('_health').doc('sync-test').delete();
            
            this.initialized = true;
            const logProject = FIRESTORE.PROJECT_ID || 'credenciales de entorno por defecto';
            UTILS.log('info', `Firestore Sync Service inicializado - Proyecto: ${logProject}`);
        } catch (error) {
            UTILS.log('error', 'Error al inicializar Firestore Sync Service', null, error);
            throw error;
        }
    }

    ensureInitialized() {
        if (!this.initialized || !this.db) {
            throw new Error('Firestore Sync Service no está inicializado. Llama a initialize() primero.');
        }
    }

    // === SINCRONIZACIÓN DE UNIDADES COMPARTIDAS ===

    // Sincronizar todas las unidades compartidas desde Drive
    async syncSharedDrives(drivesFromAPI) {
        try {
            this.ensureInitialized();
            UTILS.log('info', `Sincronizando ${drivesFromAPI.length} unidades compartidas`);

            // 1. Obtener todas las unidades existentes en Firestore
            const existingDrivesSnapshot = await this.db.collection(COLLECTIONS.SHARED_DRIVES).get();
            const existingDriveIds = new Set();
            const existingDrives = {};
            
            existingDrivesSnapshot.forEach(doc => {
                const data = doc.data();
                existingDriveIds.add(doc.id);
                existingDrives[doc.id] = data;
            });

            // 2. Crear conjunto de IDs de unidades actuales desde Google Drive
            const currentDriveIds = new Set(drivesFromAPI.map(drive => drive.id));

            // 3. Identificar unidades a eliminar (existen en Firestore pero no en Drive)
            // Google Drive es la fuente única de verdad - eliminar TODO lo que no esté en Drive
            const drivesToDelete = [];
            existingDriveIds.forEach(driveId => {
                if (!currentDriveIds.has(driveId)) {
                    drivesToDelete.push(driveId);
                }
            });

            UTILS.log('info', `Unidades a eliminar: ${drivesToDelete.length}`);
            if (drivesToDelete.length > 0) {
                UTILS.log('debug', `IDs a eliminar: ${drivesToDelete.join(', ')}`);
            }

            const batch = this.db.batch();
            let batchCount = 0;
            const batchSize = 500; // Límite de Firestore

            // 4. Eliminar unidades obsoletas
            for (const driveId of drivesToDelete) {
                const driveRef = this.db.collection(COLLECTIONS.SHARED_DRIVES).doc(driveId);
                batch.delete(driveRef);
                batchCount++;

                // Ejecutar batch si alcanza el límite
                if (batchCount >= batchSize) {
                    await batch.commit();
                    UTILS.log('debug', `Batch de eliminación de ${batchCount} unidades procesado`);
                    batchCount = 0;
                }
            }

            // 5. Actualizar/crear unidades actuales
            for (const drive of drivesFromAPI) {
                const driveRef = this.db.collection(COLLECTIONS.SHARED_DRIVES).doc(drive.id);
                
                // Preparar datos de la unidad
                const driveData = {
                    id: drive.id,
                    name: drive.name,
                    kind: drive.kind,
                    colorRgb: drive.colorRgb || null,
                    backgroundImageFile: drive.backgroundImageFile || null,
                    capabilities: drive.capabilities || {},
                    createdTime: drive.createdTime,
                    hidden: drive.hidden || false,
                    restrictions: drive.restrictions || {},
                    synced_at: new Date(),
                    synced_by_backend: true
                };

                // Verificar si existe para preservar campos del frontend
                if (existingDrives[drive.id]) {
                    const existingData = existingDrives[drive.id];
                    // Preservar campos creados por el frontend
                    if (existingData.created_by_frontend) {
                        driveData.created_by_frontend = true;
                        driveData.created_at = existingData.created_at;
                    }
                }

                batch.set(driveRef, driveData, { merge: true });
                batchCount++;

                // Ejecutar batch si alcanza el límite
                if (batchCount >= batchSize) {
                    await batch.commit();
                    UTILS.log('debug', `Batch de ${batchCount} unidades procesado`);
                    batchCount = 0;
                }
            }

            // Ejecutar batch restante
            if (batchCount > 0) {
                await batch.commit();
                UTILS.log('debug', `Batch final de ${batchCount} unidades procesado`);
            }

            const totalProcessed = drivesFromAPI.length;
            const totalDeleted = drivesToDelete.length;
            UTILS.log('info', `Sincronización completa: ${totalProcessed} unidades actualizadas/creadas, ${totalDeleted} eliminadas`);
            
            return {
                processed: totalProcessed,
                deleted: totalDeleted,
                total: totalProcessed
            };

        } catch (error) {
            UTILS.log('error', 'Error al sincronizar unidades compartidas', null, error);
            throw error;
        }
    }

    // === SINCRONIZACIÓN DE CARPETAS ===

    // Sincronizar carpetas de una unidad específica
    async syncFoldersForDrive(driveId, foldersFromAPI) {
        try {
            this.ensureInitialized();
            UTILS.log('info', `Sincronizando ${foldersFromAPI.length} carpetas para unidad ${driveId}`);

            const batch = this.db.batch();
            let batchCount = 0;
            const batchSize = 500;

            for (const folder of foldersFromAPI) {
                const folderRef = this.db.collection(COLLECTIONS.FOLDERS).doc(folder.id);
                
                const folderData = {
                    id: folder.id,
                    name: folder.name,
                    driveId: driveId,
                    parent_id: folder.parents && folder.parents[0] !== driveId ? folder.parents[0] : null,
                    full_path: folder.full_path || '/',
                    mimeType: folder.mimeType,
                    createdTime: folder.createdTime,
                    modifiedTime: folder.modifiedTime,
                    synced_at: new Date(),
                    synced_by_backend: true
                };

                // Verificar si existe para preservar campos del frontend
                const existingDoc = await folderRef.get();
                if (existingDoc.exists) {
                    const existingData = existingDoc.data();
                    if (existingData.created_by_frontend) {
                        folderData.created_by_frontend = true;
                        folderData.created_at = existingData.created_at;
                    }
                }

                batch.set(folderRef, folderData, { merge: true });
                batchCount++;

                if (batchCount >= batchSize) {
                    await batch.commit();
                    UTILS.log('debug', `Batch de ${batchCount} carpetas procesado`);
                    batchCount = 0;
                }
            }

            if (batchCount > 0) {
                await batch.commit();
                UTILS.log('debug', `Batch final de ${batchCount} carpetas procesado`);
            }

            UTILS.log('info', `${foldersFromAPI.length} carpetas sincronizadas para unidad ${driveId}`);
            return foldersFromAPI.length;

        } catch (error) {
            UTILS.log('error', `Error al sincronizar carpetas para unidad ${driveId}`, null, error);
            throw error;
        }
    }

    // === SINCRONIZACIÓN DE PERMISOS ===

    // Sincronizar managers/permisos de una unidad
    async syncManagersForDrive(driveId, driveName, managersFromAPI) {
        try {
            this.ensureInitialized();
            UTILS.log('info', `Sincronizando ${managersFromAPI.length} managers para unidad ${driveId}`);

            // Primero eliminar managers existentes de esta unidad (que fueron sincronizados por backend)
            const existingManagersQuery = this.db.collection(COLLECTIONS.DRIVE_MANAGERS)
                .where('driveId', '==', driveId)
                .where('synced_by_backend', '==', true);
            
            const existingSnapshot = await existingManagersQuery.get();
            const batch = this.db.batch();
            
            // Eliminar managers existentes sincronizados por backend
            existingSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });

            // Agregar nuevos managers
            managersFromAPI.forEach(manager => {
                const managerRef = this.db.collection(COLLECTIONS.DRIVE_MANAGERS).doc();
                batch.set(managerRef, {
                    driveId: driveId,
                    driveName: driveName,
                    email: manager.email || manager.emailAddress,
                    role: manager.role,
                    type: manager.type,
                    permissionId: manager.permissionId || manager.id,
                    displayName: manager.displayName || null,
                    photoLink: manager.photoLink || null,
                    synced_at: new Date(),
                    synced_by_backend: true
                });
            });

            await batch.commit();
            UTILS.log('info', `${managersFromAPI.length} managers sincronizados para unidad ${driveId}`);
            return managersFromAPI.length;

        } catch (error) {
            UTILS.log('error', `Error al sincronizar managers para unidad ${driveId}`, null, error);
            throw error;
        }
    }

    // === HISTORIAL DE SINCRONIZACIÓN ===

    // Registrar inicio de sincronización
    async recordSyncStart(syncId) {
        try {
            this.ensureInitialized();
            
            const syncRef = this.db.collection(COLLECTIONS.SYNC_HISTORY).doc(syncId);
            await syncRef.set({
                sync_id: syncId,
                sync_date: new Date(),
                status: 'running',
                start_time: new Date(),
                drives_count: 0,
                folders_count: 0,
                managers_count: 0,
                errors: []
            });

            UTILS.log('info', `Sincronización registrada: ${syncId}`);
        } catch (error) {
            UTILS.log('error', 'Error al registrar inicio de sincronización', null, error);
            throw error;
        }
    }

    // Actualizar progreso de sincronización
    async updateSyncProgress(syncId, progress) {
        try {
            this.ensureInitialized();
            
            const syncRef = this.db.collection(COLLECTIONS.SYNC_HISTORY).doc(syncId);
            await syncRef.update({
                ...progress,
                updated_at: new Date()
            });

        } catch (error) {
            UTILS.log('error', 'Error al actualizar progreso de sincronización', null, error);
        }
    }

    // Completar sincronización
    async completeSyncRecord(syncId, stats, status = 'completed') {
        try {
            this.ensureInitialized();
            
            const syncRef = this.db.collection(COLLECTIONS.SYNC_HISTORY).doc(syncId);
            await syncRef.update({
                status: status,
                end_time: new Date(),
                duration_ms: stats.duration_ms,
                duration_minutes: stats.duration_minutes,
                drives_count: stats.drives_count || 0,
                folders_count: stats.folders_count || 0,
                managers_count: stats.managers_count || 0,
                errors: stats.errors || [],
                completed_at: new Date()
            });

            UTILS.log('info', `Sincronización completada: ${syncId} - Estado: ${status}`);
        } catch (error) {
            UTILS.log('error', 'Error al completar registro de sincronización', null, error);
        }
    }

    // === ESTADO DE SINCRONIZACIÓN ===

    // Obtener estado actual de sincronización
    async getSyncStatus() {
        try {
            this.ensureInitialized();
            
            const statusRef = this.db.collection(COLLECTIONS.SYNC_STATUS).doc('current');
            const doc = await statusRef.get();
            
            if (doc.exists) {
                return doc.data();
            }
            
            return {
                status: 'idle',
                last_sync: null,
                current_sync_id: null
            };
        } catch (error) {
            UTILS.log('error', 'Error al obtener estado de sincronización', null, error);
            return { status: 'unknown' };
        }
    }

    // Actualizar estado de sincronización
    async updateSyncStatus(status, syncId = null) {
        try {
            this.ensureInitialized();
            
            const statusRef = this.db.collection(COLLECTIONS.SYNC_STATUS).doc('current');
            const updateData = {
                status: status,
                updated_at: new Date()
            };
            
            if (syncId) {
                updateData.current_sync_id = syncId;
            }
            
            if (status === 'completed' || status === 'failed') {
                updateData.last_sync = new Date();
                updateData.current_sync_id = null;
            }
            
            await statusRef.set(updateData, { merge: true });
            
        } catch (error) {
            UTILS.log('error', 'Error al actualizar estado de sincronización', null, error);
        }
    }

    // === LIMPIEZA Y MANTENIMIENTO ===

    // Limpiar registros antiguos de sincronización (mantener últimos 50)
    async cleanupSyncHistory(keepLast = 50) {
        try {
            this.ensureInitialized();
            
            const historyRef = this.db.collection(COLLECTIONS.SYNC_HISTORY)
                .orderBy('sync_date', 'desc')
                .offset(keepLast);
            
            const snapshot = await historyRef.get();
            
            if (snapshot.empty) {
                return 0;
            }
            
            const batch = this.db.batch();
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            
            await batch.commit();
            
            UTILS.log('info', `${snapshot.size} registros antiguos de sincronización eliminados`);
            return snapshot.size;
            
        } catch (error) {
            UTILS.log('error', 'Error al limpiar historial de sincronización', null, error);
            return 0;
        }
    }

    // Obtener estadísticas de la base de datos
    async getDatabaseStats() {
        try {
            this.ensureInitialized();
            
            const [drivesSnapshot, foldersSnapshot, managersSnapshot] = await Promise.all([
                this.db.collection(COLLECTIONS.SHARED_DRIVES).count().get(),
                this.db.collection(COLLECTIONS.FOLDERS).count().get(),
                this.db.collection(COLLECTIONS.DRIVE_MANAGERS).count().get()
            ]);
            
            return {
                drives_count: drivesSnapshot.data().count,
                folders_count: foldersSnapshot.data().count,
                managers_count: managersSnapshot.data().count,
                timestamp: new Date()
            };
            
        } catch (error) {
            UTILS.log('error', 'Error al obtener estadísticas de la base de datos', null, error);
            return {
                drives_count: 0,
                folders_count: 0,
                managers_count: 0,
                error: error.message
            };
        }
    }

    // === GUARDAR NUEVA UNIDAD COMPARTIDA ===

    async saveNewSharedDrive(driveData, managers = []) {
        try {
            this.ensureInitialized();
            
            const driveRef = this.db.collection(COLLECTIONS.SHARED_DRIVES).doc(driveData.id);
            
            // Preparar datos de la unidad
            const firestoreData = {
                id: driveData.id,
                name: driveData.name,
                kind: driveData.kind,
                colorRgb: driveData.colorRgb || null,
                backgroundImageFile: driveData.backgroundImageFile || null,
                capabilities: driveData.capabilities || {},
                createdTime: driveData.createdTime,
                hidden: driveData.hidden || false,
                restrictions: driveData.restrictions || {},
                created_by_frontend: true,
                created_at: new Date(),
                synced_at: new Date(),
                synced_by_backend: true
            };
            
            // Guardar la unidad
            await driveRef.set(firestoreData);
            UTILS.log('info', `Unidad compartida guardada en Firestore: ${driveData.name} (ID: ${driveData.id})`);
            
            // Guardar managers si existen
            if (managers && managers.length > 0) {
                await this.syncManagersForDrive(driveData.id, driveData.name, managers);
            }
            
            return firestoreData;
        } catch (error) {
            UTILS.log('error', 'Error al guardar nueva unidad compartida', null, error);
            throw error;
        }
    }

    // === MÉTODOS DE LECTURA PARA API ===

    async getSharedDrives() {
        this.ensureInitialized();
        
        try {
            const snapshot = await this.db.collection(COLLECTIONS.SHARED_DRIVES)
                .orderBy('name')
                .get();
            
            const drives = [];
            snapshot.forEach(doc => {
                drives.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            UTILS.log('info', `Obtenidas ${drives.length} unidades compartidas desde Firestore`);
            return drives;
            
        } catch (error) {
            UTILS.log('error', 'Error al obtener unidades compartidas desde Firestore', null, error);
            throw error;
        }
    }


}

const firestoreSyncService = new FirestoreSyncService();

module.exports = firestoreSyncService;