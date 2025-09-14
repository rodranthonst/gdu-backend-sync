const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { GOOGLE_DRIVE_API, IMPERSONATION, UTILS } = require('./config');

class GoogleDriveSyncService {
    constructor() {
        this.drive = null;
        this.auth = null;
        this.initialized = false;
    }

    // === INICIALIZACIÓN ===

    async initialize() {
        try {
            // Usar credenciales desde variables de entorno
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

            // Validar que todas las credenciales estén presentes
            const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
            for (const field of requiredFields) {
                if (!serviceAccountCredentials[field]) {
                    throw new Error(`Variable de entorno faltante para service account: GOOGLE_SERVICE_ACCOUNT_${field.toUpperCase()}`);
                }
            }

            // Configurar autenticación JWT con impersonación (como en la app anterior)
            this.auth = new google.auth.JWT(
                serviceAccountCredentials.client_email,
                null,
                serviceAccountCredentials.private_key,
                GOOGLE_DRIVE_API.SCOPES,
                IMPERSONATION.USER_EMAIL // Subject para impersonación
            );
            
            // Autorizar el cliente
            await this.auth.authorize();

            // Crear cliente de Drive API
            this.drive = google.drive({ 
                version: 'v3', 
                auth: this.auth 
            });

            // Verificar conexión
            await this.drive.about.get({ fields: 'user' });
            
            this.initialized = true;
            UTILS.log('info', `Google Drive Sync Service inicializado correctamente - Usando credenciales crearunidadesimm - Impersonando: ${IMPERSONATION.USER_EMAIL}`);
        } catch (error) {
            UTILS.log('error', 'Error al inicializar Google Drive Sync Service', null, error);
            throw error;
        }
    }

    ensureInitialized() {
        if (!this.initialized || !this.drive) {
            throw new Error('Google Drive Sync Service no está inicializado. Llama a initialize() primero.');
        }
    }

    // === OBTENER UNIDADES COMPARTIDAS ===

    async getAllSharedDrives() {
        try {
            this.ensureInitialized();
            UTILS.log('info', 'Obteniendo todas las unidades compartidas');

            const allDrives = [];
            let pageToken = null;
            let pageCount = 0;

            do {
                const params = {
                    pageSize: 100, // Máximo permitido por la API
                    fields: 'nextPageToken,drives(id,name,kind,colorRgb,backgroundImageFile,capabilities,createdTime,hidden,restrictions)'
                };

                if (pageToken) {
                    params.pageToken = pageToken;
                }

                const response = await this.drive.drives.list(params);
                const drives = response.data.drives || [];
                
                allDrives.push(...drives);
                pageToken = response.data.nextPageToken;
                pageCount++;

                UTILS.log('debug', `Página ${pageCount}: ${drives.length} unidades obtenidas`);

                // Pausa pequeña para evitar rate limiting
                if (pageToken) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

            } while (pageToken);

            UTILS.log('info', `Total de unidades compartidas obtenidas: ${allDrives.length}`);
            return allDrives;

        } catch (error) {
            UTILS.log('error', 'Error al obtener unidades compartidas', null, error);
            throw error;
        }
    }

    // === OBTENER CARPETAS DE UNA UNIDAD ===

    async getFoldersFromDrive(driveId, driveName) {
        try {
            this.ensureInitialized();
            UTILS.log('info', `Obteniendo carpetas de la unidad: ${driveName} (${driveId})`);

            const allFolders = [];
            let pageToken = null;
            let pageCount = 0;

            do {
                const params = {
                    q: `'${driveId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                    pageSize: 1000, // Máximo permitido
                    fields: 'nextPageToken,files(id,name,parents,mimeType,createdTime,modifiedTime)',
                    includeItemsFromAllDrives: true,
                    supportsAllDrives: true,
                    corpora: 'drive',
                    driveId: driveId
                };

                if (pageToken) {
                    params.pageToken = pageToken;
                }

                const response = await this.drive.files.list(params);
                const folders = response.data.files || [];
                
                allFolders.push(...folders);
                pageToken = response.data.nextPageToken;
                pageCount++;

                UTILS.log('debug', `Página ${pageCount}: ${folders.length} carpetas obtenidas de ${driveName}`);

                // Pausa para evitar rate limiting
                if (pageToken) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }

            } while (pageToken);

            // Ahora obtener subcarpetas recursivamente
            const allSubfolders = await this.getSubfoldersRecursively(driveId, allFolders);
            const totalFolders = [...allFolders, ...allSubfolders];

            // Calcular rutas completas
            const foldersWithPaths = this.calculateFolderPaths(totalFolders, driveId);

            UTILS.log('info', `Total de carpetas obtenidas de ${driveName}: ${foldersWithPaths.length}`);
            return foldersWithPaths;

        } catch (error) {
            UTILS.log('error', `Error al obtener carpetas de la unidad ${driveName}`, null, error);
            throw error;
        }
    }

    // Obtener subcarpetas recursivamente
    async getSubfoldersRecursively(driveId, parentFolders) {
        try {
            const allSubfolders = [];
            
            for (const folder of parentFolders) {
                const subfolders = await this.getDirectSubfolders(driveId, folder.id);
                allSubfolders.push(...subfolders);
                
                // Si hay subcarpetas, obtener sus subcarpetas también
                if (subfolders.length > 0) {
                    const deeperSubfolders = await this.getSubfoldersRecursively(driveId, subfolders);
                    allSubfolders.push(...deeperSubfolders);
                }
            }
            
            return allSubfolders;
        } catch (error) {
            UTILS.log('error', 'Error al obtener subcarpetas recursivamente', null, error);
            return [];
        }
    }

    // Obtener subcarpetas directas de una carpeta
    async getDirectSubfolders(driveId, parentFolderId) {
        try {
            const subfolders = [];
            let pageToken = null;

            do {
                const params = {
                    q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                    pageSize: 1000,
                    fields: 'nextPageToken,files(id,name,parents,mimeType,createdTime,modifiedTime)',
                    includeItemsFromAllDrives: true,
                    supportsAllDrives: true,
                    corpora: 'drive',
                    driveId: driveId
                };

                if (pageToken) {
                    params.pageToken = pageToken;
                }

                const response = await this.drive.files.list(params);
                const folders = response.data.files || [];
                
                subfolders.push(...folders);
                pageToken = response.data.nextPageToken;

                // Pausa para evitar rate limiting
                if (pageToken) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

            } while (pageToken);

            return subfolders;
        } catch (error) {
            UTILS.log('error', `Error al obtener subcarpetas de ${parentFolderId}`, null, error);
            return [];
        }
    }

    // Calcular rutas completas de las carpetas
    calculateFolderPaths(folders, driveId) {
        const folderMap = new Map();
        
        // Crear mapa de carpetas por ID
        folders.forEach(folder => {
            folderMap.set(folder.id, {
                ...folder,
                full_path: null
            });
        });

        // Función recursiva para calcular ruta
        const calculatePath = (folderId, visited = new Set()) => {
            if (visited.has(folderId)) {
                return '/'; // Evitar bucles infinitos
            }
            
            const folder = folderMap.get(folderId);
            if (!folder) return '/';
            
            if (folder.full_path !== null) {
                return folder.full_path; // Ya calculado
            }
            
            visited.add(folderId);
            
            const parentId = folder.parents && folder.parents[0];
            if (!parentId || parentId === driveId) {
                folder.full_path = `/${folder.name}`;
            } else {
                const parentPath = calculatePath(parentId, new Set(visited));
                folder.full_path = `${parentPath}/${folder.name}`;
            }
            
            return folder.full_path;
        };

        // Calcular rutas para todas las carpetas
        folders.forEach(folder => {
            calculatePath(folder.id);
        });

        return Array.from(folderMap.values());
    }

    // === OBTENER MANAGERS/PERMISOS ===

    async getManagersFromDrive(driveId, driveName) {
        try {
            this.ensureInitialized();
            UTILS.log('info', `Obteniendo managers de la unidad: ${driveName} (${driveId})`);

            const allManagers = [];
            let pageToken = null;
            let pageCount = 0;

            do {
                const params = {
                    fileId: driveId,
                    pageSize: 100,
                    fields: 'nextPageToken,permissions(id,emailAddress,role,type,displayName,photoLink)',
                    supportsAllDrives: true
                };

                if (pageToken) {
                    params.pageToken = pageToken;
                }

                const response = await this.drive.permissions.list(params);
                const permissions = response.data.permissions || [];
                
                // Filtrar solo managers (organizer, fileOrganizer)
                const managers = permissions.filter(permission => 
                    permission.role === 'organizer' || permission.role === 'fileOrganizer'
                );
                
                allManagers.push(...managers);
                pageToken = response.data.nextPageToken;
                pageCount++;

                UTILS.log('debug', `Página ${pageCount}: ${managers.length} managers obtenidos de ${driveName}`);

                // Pausa para evitar rate limiting
                if (pageToken) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

            } while (pageToken);

            UTILS.log('info', `Total de managers obtenidos de ${driveName}: ${allManagers.length}`);
            return allManagers;

        } catch (error) {
            UTILS.log('error', `Error al obtener managers de la unidad ${driveName}`, null, error);
            throw error;
        }
    }

    // === SINCRONIZACIÓN COMPLETA ===

    async performFullSync() {
        try {
            this.ensureInitialized();
            UTILS.log('info', 'Iniciando sincronización completa');

            const syncStats = {
                drives_count: 0,
                folders_count: 0,
                managers_count: 0,
                errors: []
            };

            // 1. Obtener todas las unidades compartidas
            const drives = await this.getAllSharedDrives();
            syncStats.drives_count = drives.length;

            // 2. Para cada unidad, obtener carpetas y managers
            for (let i = 0; i < drives.length; i++) {
                const drive = drives[i];
                
                try {
                    UTILS.log('info', `Procesando unidad ${i + 1}/${drives.length}: ${drive.name}`);

                    // Obtener carpetas y managers en paralelo
                    const [folders, managers] = await Promise.all([
                        this.getFoldersFromDrive(drive.id, drive.name),
                        this.getManagersFromDrive(drive.id, drive.name)
                    ]);

                    syncStats.folders_count += folders.length;
                    syncStats.managers_count += managers.length;

                    // Agregar datos a la unidad para retornar
                    drive.folders = folders;
                    drive.managers = managers;

                } catch (error) {
                    const errorMsg = `Error procesando unidad ${drive.name}: ${error.message}`;
                    UTILS.log('error', errorMsg, null, error);
                    syncStats.errors.push(errorMsg);
                    
                    // Continuar con la siguiente unidad
                    drive.folders = [];
                    drive.managers = [];
                }

                // Pausa entre unidades para evitar rate limiting
                if (i < drives.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            UTILS.log('info', `Sincronización completa finalizada - Unidades: ${syncStats.drives_count}, Carpetas: ${syncStats.folders_count}, Managers: ${syncStats.managers_count}`);
            
            return {
                drives: drives,
                stats: syncStats
            };

        } catch (error) {
            UTILS.log('error', 'Error en sincronización completa', null, error);
            throw error;
        }
    }

    // === VERIFICACIÓN DE CONECTIVIDAD ===

    async testConnection() {
        try {
            this.ensureInitialized();
            
            const response = await this.drive.about.get({ 
                fields: 'user,storageQuota' 
            });
            
            return {
                success: true,
                user: response.data.user,
                quota: response.data.storageQuota
            };
        } catch (error) {
            UTILS.log('error', 'Error al probar conexión con Google Drive', null, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // === CREAR UNIDAD COMPARTIDA ===

    async createSharedDrive(name, managers = []) {
        try {
            this.ensureInitialized();
            
            UTILS.log('info', `Creando unidad compartida: ${name}`);
            
            // Crear la unidad compartida
            const driveResponse = await this.drive.drives.create({
                requestId: `create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                resource: {
                    name: name
                }
            });
            
            const newDrive = driveResponse.data;
            UTILS.log('info', `Unidad compartida creada: ${newDrive.name} (ID: ${newDrive.id})`);
            
            // Agregar managers si se especificaron
            const addedManagers = [];
            for (const managerEmail of managers) {
                try {
                    const permission = await this.addManagerToSharedDrive(newDrive.id, managerEmail);
                    addedManagers.push({
                        email: managerEmail,
                        role: 'organizer',
                        type: 'user',
                        permissionId: permission.id
                    });
                    UTILS.log('info', `Manager agregado: ${managerEmail}`);
                } catch (error) {
                    UTILS.log('error', `Error al agregar manager ${managerEmail}`, null, error);
                }
            }
            
            return {
                drive: {
                    id: newDrive.id,
                    name: newDrive.name,
                    kind: newDrive.kind || 'drive#drive',
                    colorRgb: newDrive.colorRgb || null,
                    backgroundImageFile: newDrive.backgroundImageFile || null,
                    capabilities: newDrive.capabilities || {},
                    createdTime: newDrive.createdTime || new Date().toISOString(),
                    hidden: newDrive.hidden || false,
                    restrictions: newDrive.restrictions || {}
                },
                managers: addedManagers
            };
        } catch (error) {
            UTILS.log('error', 'Error al crear unidad compartida', null, error);
            throw error;
        }
    }
    
    // === AGREGAR MANAGER A UNIDAD COMPARTIDA ===
    
    async addManagerToSharedDrive(driveId, email) {
        try {
            const permission = await this.drive.permissions.create({
                fileId: driveId,
                supportsAllDrives: true,
                resource: {
                    role: 'organizer',
                    type: 'user',
                    emailAddress: email
                }
            });
            
            return permission.data;
        } catch (error) {
            UTILS.log('error', `Error al agregar manager ${email} a la unidad ${driveId}`, null, error);
            throw error;
        }
    }

    // === OBTENER INFORMACIÓN DE UNA UNIDAD ESPECÍFICA ===

    async getDriveInfo(driveId) {
        try {
            this.ensureInitialized();
            
            const response = await this.drive.drives.get({
                driveId: driveId,
                fields: 'id,name,kind,colorRgb,backgroundImageFile,capabilities,createdTime,hidden,restrictions'
            });
            
            return response.data;
        } catch (error) {
            UTILS.log('error', `Error al obtener información de la unidad ${driveId}`, null, error);
            throw error;
        }
    }
}

const googleDriveSyncService = new GoogleDriveSyncService();

module.exports = googleDriveSyncService;