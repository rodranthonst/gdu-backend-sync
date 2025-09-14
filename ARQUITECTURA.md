# ⚙️ Arquitectura Backend - Servicio de Sincronización

## 📋 Visión General

El backend está diseñado como un **microservicio especializado** en la sincronización automática de unidades compartidas de Google Drive. Implementa una arquitectura orientada a servicios con patrones de diseño robustos para garantizar escalabilidad, confiabilidad y mantenibilidad.

## 🎯 Principios Arquitectónicos

- **Single Responsibility**: Cada servicio tiene una responsabilidad específica
- **Separation of Concerns**: Separación clara entre capas y responsabilidades
- **Dependency Injection**: Inversión de dependencias para testing y flexibilidad
- **Event-Driven**: Arquitectura basada en eventos para desacoplamiento
- **Resilience**: Manejo robusto de errores y recuperación automática
- **Observability**: Logging, métricas y monitoreo comprehensivo

## 🏛️ Arquitectura de Capas

```
┌─────────────────────────────────────────────────────────────┐
│                      API LAYER                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   server.js                            │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │ │
│  │  │   Routes    │ │ Middleware  │ │   Error Handlers    │ │ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                   BUSINESS LAYER                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                 syncService.js                          │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │ │
│  │  │Sync Manager │ │Event Handler│ │   Business Logic    │ │ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                   SERVICE LAYER                            │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐ │
│  │firestoreService │  │      googleDriveService.js          │ │
│  │      .js        │  │                                     │ │
│  └─────────────────┘  └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                 INFRASTRUCTURE LAYER                       │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐ │
│  │    config.js    │  │         External APIs               │ │
│  │                 │  │  ┌─────────────┐ ┌─────────────────┐ │ │
│  │                 │  │  │Google Drive │ │   Firestore     │ │ │
│  │                 │  │  │     API     │ │      API        │ │ │
│  │                 │  │  └─────────────┘ └─────────────────┘ │ │
│  └─────────────────┘  └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Estructura Detallada de Componentes

### API Layer - `server.js`

```javascript
// Servidor Express principal
class APIServer {
    constructor() {
        this.app = express();
        this.syncService = new SyncService();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // CORS, logging, parsing, authentication
    }

    setupRoutes() {
        // API endpoints definition
    }

    setupErrorHandling() {
        // Global error handling
    }
}
```

#### Middleware Stack
```javascript
// Middleware pipeline
const middlewareStack = [
    cors(corsOptions),
    helmet(), // Security headers
    morgan('combined'), // Request logging
    express.json({ limit: '10mb' }),
    rateLimit(rateLimitOptions),
    authenticationMiddleware,
    validationMiddleware
];
```

#### Route Structure
```javascript
// API Routes organization
const routes = {
    '/api/drives': {
        GET: 'getDrives',
        POST: 'createDrive'
    },
    '/api/drives/:id': {
        GET: 'getDriveById',
        PUT: 'updateDrive',
        DELETE: 'deleteDrive'
    },
    '/api/sync': {
        POST: 'triggerSync',
        GET: 'getSyncStatus'
    },
    '/api/permissions': {
        GET: 'getPermissions',
        PUT: 'updatePermissions'
    },
    '/health': {
        GET: 'healthCheck'
    },
    '/metrics': {
        GET: 'getMetrics'
    }
};
```

### Business Layer - `syncService.js`

```javascript
// Servicio principal de sincronización
class SyncService {
    constructor(driveService, firestoreService, config) {
        this.driveService = driveService;
        this.firestoreService = firestoreService;
        this.config = config;
        this.eventEmitter = new EventEmitter();
        this.syncQueue = new Queue('sync-queue');
        this.metrics = new MetricsCollector();
    }

    async startPeriodicSync() {
        const interval = this.config.syncIntervalMinutes * 60 * 1000;
        setInterval(() => {
            this.syncQueue.add('full-sync', {}, {
                attempts: 3,
                backoff: 'exponential'
            });
        }, interval);
    }

    async performFullSync() {
        const startTime = Date.now();
        try {
            const drives = await this.driveService.listAllDrives();
            const syncResults = await this.processDrives(drives);
            
            this.metrics.recordSyncCompletion({
                duration: Date.now() - startTime,
                drivesProcessed: drives.length,
                errors: syncResults.errors
            });
            
            this.eventEmitter.emit('sync-completed', syncResults);
            return syncResults;
        } catch (error) {
            this.metrics.recordSyncError(error);
            throw error;
        }
    }

    async processDrives(drives) {
        const results = {
            processed: 0,
            updated: 0,
            errors: []
        };

        for (const drive of drives) {
            try {
                await this.processSingleDrive(drive);
                results.processed++;
            } catch (error) {
                results.errors.push({
                    driveId: drive.id,
                    error: error.message
                });
            }
        }

        return results;
    }

    async processSingleDrive(drive) {
        // 1. Obtener datos actuales de Google Drive
        const currentData = await this.driveService.getDriveDetails(drive.id);
        
        // 2. Obtener datos almacenados en Firestore
        const storedData = await this.firestoreService.getDrive(drive.id);
        
        // 3. Comparar y detectar cambios
        const changes = this.detectChanges(currentData, storedData);
        
        // 4. Aplicar cambios si es necesario
        if (changes.hasChanges) {
            await this.applyChanges(drive.id, changes);
            this.eventEmitter.emit('drive-updated', {
                driveId: drive.id,
                changes
            });
        }
    }

    detectChanges(current, stored) {
        const changes = {
            hasChanges: false,
            permissions: [],
            metadata: {},
            files: []
        };

        // Detectar cambios en permisos
        if (this.permissionsChanged(current.permissions, stored?.permissions)) {
            changes.hasChanges = true;
            changes.permissions = this.getPermissionDiff(current.permissions, stored?.permissions);
        }

        // Detectar cambios en metadata
        if (this.metadataChanged(current.metadata, stored?.metadata)) {
            changes.hasChanges = true;
            changes.metadata = this.getMetadataDiff(current.metadata, stored?.metadata);
        }

        return changes;
    }
}
```

### Service Layer

#### `googleDriveService.js`

```javascript
// Servicio para Google Drive API
class GoogleDriveService {
    constructor(config) {
        this.config = config;
        this.auth = null;
        this.drive = null;
        this.admin = null;
        this.rateLimiter = new RateLimiter({
            tokensPerInterval: 100,
            interval: 'minute'
        });
    }

    async initialize() {
        try {
            // Configurar autenticación con Service Account
            this.auth = new google.auth.JWT(
                this.config.serviceAccountEmail,
                null,
                this.config.privateKey,
                this.config.scopes,
                this.config.impersonateUser
            );

            // Inicializar clientes de API
            this.drive = google.drive({ version: 'v3', auth: this.auth });
            this.admin = google.admin({ version: 'directory_v1', auth: this.auth });

            // Verificar autenticación
            await this.verifyAuthentication();
            
            logger.info('GoogleDriveService initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize GoogleDriveService:', error);
            throw error;
        }
    }

    async listAllDrives() {
        await this.rateLimiter.removeTokens(1);
        
        try {
            const response = await this.drive.drives.list({
                pageSize: 100,
                fields: 'drives(id,name,createdTime,capabilities,restrictions)'
            });

            return response.data.drives || [];
        } catch (error) {
            if (error.code === 429) {
                // Rate limit exceeded, wait and retry
                await this.handleRateLimit();
                return this.listAllDrives();
            }
            throw error;
        }
    }

    async getDriveDetails(driveId) {
        await this.rateLimiter.removeTokens(1);
        
        const [driveInfo, permissions, files] = await Promise.all([
            this.getDriveInfo(driveId),
            this.getDrivePermissions(driveId),
            this.getDriveFiles(driveId)
        ]);

        return {
            info: driveInfo,
            permissions,
            files,
            lastSynced: new Date().toISOString()
        };
    }

    async getDrivePermissions(driveId) {
        try {
            const response = await this.drive.permissions.list({
                fileId: driveId,
                fields: 'permissions(id,type,role,emailAddress,domain,displayName)'
            });

            return response.data.permissions || [];
        } catch (error) {
            logger.error(`Error getting permissions for drive ${driveId}:`, error);
            throw error;
        }
    }

    async updateDrivePermissions(driveId, permissions) {
        const results = {
            added: [],
            updated: [],
            removed: [],
            errors: []
        };

        for (const permission of permissions) {
            try {
                if (permission.action === 'add') {
                    const result = await this.addPermission(driveId, permission);
                    results.added.push(result);
                } else if (permission.action === 'update') {
                    const result = await this.updatePermission(driveId, permission);
                    results.updated.push(result);
                } else if (permission.action === 'remove') {
                    await this.removePermission(driveId, permission.id);
                    results.removed.push(permission.id);
                }
            } catch (error) {
                results.errors.push({
                    permission,
                    error: error.message
                });
            }
        }

        return results;
    }

    async handleRateLimit() {
        const backoffTime = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        logger.warn(`Rate limit exceeded, backing off for ${backoffTime}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        this.retryCount++;
    }
}
```

#### `firestoreService.js`

```javascript
// Servicio para Firestore
class FirestoreService {
    constructor(config) {
        this.config = config;
        this.db = null;
        this.collections = {
            drives: 'shared_drives',
            permissions: 'drive_permissions',
            syncHistory: 'sync_history',
            metrics: 'sync_metrics'
        };
    }

    async initialize() {
        try {
            // Inicializar Firestore
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: this.config.projectId,
                    clientEmail: this.config.serviceAccountEmail,
                    privateKey: this.config.privateKey
                })
            });

            this.db = admin.firestore();
            
            // Configurar settings
            this.db.settings({
                timestampsInSnapshots: true
            });

            logger.info('FirestoreService initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize FirestoreService:', error);
            throw error;
        }
    }

    async saveDrive(driveData) {
        try {
            const docRef = this.db.collection(this.collections.drives).doc(driveData.id);
            
            await docRef.set({
                ...driveData,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                version: admin.firestore.FieldValue.increment(1)
            }, { merge: true });

            return docRef.id;
        } catch (error) {
            logger.error(`Error saving drive ${driveData.id}:`, error);
            throw error;
        }
    }

    async getDrive(driveId) {
        try {
            const doc = await this.db.collection(this.collections.drives).doc(driveId).get();
            
            if (!doc.exists) {
                return null;
            }

            return {
                id: doc.id,
                ...doc.data()
            };
        } catch (error) {
            logger.error(`Error getting drive ${driveId}:`, error);
            throw error;
        }
    }

    async savePermissions(driveId, permissions) {
        const batch = this.db.batch();
        
        try {
            // Eliminar permisos existentes
            const existingPermissions = await this.db
                .collection(this.collections.permissions)
                .where('driveId', '==', driveId)
                .get();

            existingPermissions.forEach(doc => {
                batch.delete(doc.ref);
            });

            // Agregar nuevos permisos
            permissions.forEach(permission => {
                const docRef = this.db.collection(this.collections.permissions).doc();
                batch.set(docRef, {
                    ...permission,
                    driveId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            await batch.commit();
            logger.info(`Saved ${permissions.length} permissions for drive ${driveId}`);
        } catch (error) {
            logger.error(`Error saving permissions for drive ${driveId}:`, error);
            throw error;
        }
    }

    async recordSyncHistory(syncData) {
        try {
            await this.db.collection(this.collections.syncHistory).add({
                ...syncData,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            logger.error('Error recording sync history:', error);
            // No lanzar error para no interrumpir el sync
        }
    }

    async getMetrics(timeRange) {
        try {
            const startTime = new Date(Date.now() - timeRange);
            
            const snapshot = await this.db
                .collection(this.collections.metrics)
                .where('timestamp', '>=', startTime)
                .orderBy('timestamp', 'desc')
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            logger.error('Error getting metrics:', error);
            throw error;
        }
    }
}
```

### Infrastructure Layer - `config.js`

```javascript
// Configuración centralizada
class ConfigManager {
    constructor() {
        this.config = this.loadConfiguration();
        this.validateConfiguration();
    }

    loadConfiguration() {
        return {
            // Server Configuration
            server: {
                port: parseInt(process.env.PORT) || 3001,
                host: process.env.HOST || '0.0.0.0',
                environment: process.env.NODE_ENV || 'development'
            },

            // Google Service Account
            google: {
                serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                projectId: process.env.GOOGLE_PROJECT_ID,
                clientId: process.env.GOOGLE_CLIENT_ID,
                impersonateUser: process.env.IMPERSONATE_USER,
                customerId: process.env.GOOGLE_CUSTOMER_ID,
                scopes: [
                    'https://www.googleapis.com/auth/drive',
                    'https://www.googleapis.com/auth/admin.directory.user',
                    'https://www.googleapis.com/auth/admin.directory.group'
                ]
            },

            // Firestore Configuration
            firestore: {
                projectId: process.env.FIRESTORE_PROJECT_ID,
                databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
            },

            // Sync Configuration
            sync: {
                intervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES) || 30,
                maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
                batchSize: parseInt(process.env.BATCH_SIZE) || 100,
                timeoutMs: parseInt(process.env.SYNC_TIMEOUT_MS) || 300000
            },

            // Rate Limiting
            rateLimiting: {
                windowMs: 15 * 60 * 1000, // 15 minutes
                maxRequests: 100,
                googleApiLimit: {
                    requestsPerMinute: 100,
                    requestsPerDay: 20000
                }
            },

            // Logging
            logging: {
                level: process.env.LOG_LEVEL || 'info',
                format: process.env.LOG_FORMAT || 'json',
                destination: process.env.LOG_DESTINATION || 'console'
            },

            // Security
            security: {
                jwtSecret: process.env.JWT_SECRET,
                corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
                trustProxy: process.env.TRUST_PROXY === 'true'
            }
        };
    }

    validateConfiguration() {
        const required = [
            'GOOGLE_SERVICE_ACCOUNT_EMAIL',
            'GOOGLE_PRIVATE_KEY',
            'GOOGLE_PROJECT_ID',
            'IMPERSONATE_USER',
            'FIRESTORE_PROJECT_ID'
        ];

        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        // Validaciones específicas
        if (!this.config.google.privateKey.includes('BEGIN PRIVATE KEY')) {
            throw new Error('Invalid GOOGLE_PRIVATE_KEY format');
        }

        if (!this.config.google.serviceAccountEmail.includes('@')) {
            throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_EMAIL format');
        }
    }

    get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.config);
    }
}
```

## 🔄 Patrones de Diseño Implementados

### 1. Dependency Injection
```javascript
// Container de dependencias
class DIContainer {
    constructor() {
        this.dependencies = new Map();
    }

    register(name, factory) {
        this.dependencies.set(name, factory);
    }

    resolve(name) {
        const factory = this.dependencies.get(name);
        if (!factory) {
            throw new Error(`Dependency ${name} not found`);
        }
        return factory();
    }
}

// Registro de servicios
const container = new DIContainer();
container.register('config', () => new ConfigManager());
container.register('driveService', () => new GoogleDriveService(container.resolve('config')));
container.register('firestoreService', () => new FirestoreService(container.resolve('config')));
container.register('syncService', () => new SyncService(
    container.resolve('driveService'),
    container.resolve('firestoreService'),
    container.resolve('config')
));
```

### 2. Observer Pattern
```javascript
// Event-driven architecture
class EventBus {
    constructor() {
        this.events = new Map();
    }

    subscribe(event, handler) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(handler);
    }

    publish(event, data) {
        const handlers = this.events.get(event) || [];
        handlers.forEach(handler => {
            try {
                handler(data);
            } catch (error) {
                logger.error(`Error in event handler for ${event}:`, error);
            }
        });
    }
}

// Uso en servicios
class SyncService {
    constructor(eventBus) {
        this.eventBus = eventBus;
        
        // Suscribirse a eventos
        this.eventBus.subscribe('drive-updated', this.handleDriveUpdate.bind(this));
        this.eventBus.subscribe('sync-error', this.handleSyncError.bind(this));
    }

    async processDrive(drive) {
        try {
            const result = await this.syncDrive(drive);
            this.eventBus.publish('drive-updated', { drive, result });
        } catch (error) {
            this.eventBus.publish('sync-error', { drive, error });
        }
    }
}
```

### 3. Strategy Pattern
```javascript
// Estrategias de sincronización
class SyncStrategy {
    async sync(drive) {
        throw new Error('Must implement sync method');
    }
}

class FullSyncStrategy extends SyncStrategy {
    async sync(drive) {
        // Sincronización completa
        return await this.performFullSync(drive);
    }
}

class IncrementalSyncStrategy extends SyncStrategy {
    async sync(drive) {
        // Sincronización incremental
        return await this.performIncrementalSync(drive);
    }
}

class SyncContext {
    constructor(strategy) {
        this.strategy = strategy;
    }

    setStrategy(strategy) {
        this.strategy = strategy;
    }

    async executeSync(drive) {
        return await this.strategy.sync(drive);
    }
}
```

### 4. Circuit Breaker Pattern
```javascript
// Protección contra fallos en cascada
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
    }

    async execute(operation) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF_OPEN';
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }

    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }
}

// Uso en servicios
class GoogleDriveService {
    constructor() {
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 3,
            resetTimeout: 30000
        });
    }

    async listDrives() {
        return await this.circuitBreaker.execute(async () => {
            return await this.drive.drives.list();
        });
    }
}
```

## 📊 Arquitectura de Datos

### Modelo de Datos en Firestore

```javascript
// Colección: shared_drives
const driveSchema = {
    id: 'string', // Google Drive ID
    name: 'string',
    createdTime: 'timestamp',
    capabilities: {
        canAddChildren: 'boolean',
        canComment: 'boolean',
        canCopy: 'boolean',
        canDeleteDrive: 'boolean',
        canDownload: 'boolean',
        canEdit: 'boolean',
        canListChildren: 'boolean',
        canManageMembers: 'boolean',
        canReadRevisions: 'boolean',
        canRename: 'boolean',
        canRenameDrive: 'boolean',
        canShare: 'boolean'
    },
    restrictions: {
        adminManagedRestrictions: 'boolean',
        copyRequiresWriterPermission: 'boolean',
        domainUsersOnly: 'boolean',
        driveMembersOnly: 'boolean'
    },
    lastSynced: 'timestamp',
    version: 'number',
    syncStatus: 'string' // 'pending', 'syncing', 'completed', 'error'
};

// Colección: drive_permissions
const permissionSchema = {
    id: 'string', // Permission ID
    driveId: 'string', // Reference to drive
    type: 'string', // 'user', 'group', 'domain', 'anyone'
    role: 'string', // 'owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'
    emailAddress: 'string',
    domain: 'string',
    displayName: 'string',
    photoLink: 'string',
    expirationTime: 'timestamp',
    createdAt: 'timestamp',
    updatedAt: 'timestamp'
};

// Colección: sync_history
const syncHistorySchema = {
    id: 'string',
    timestamp: 'timestamp',
    type: 'string', // 'full', 'incremental', 'manual'
    status: 'string', // 'started', 'completed', 'failed'
    drivesProcessed: 'number',
    drivesUpdated: 'number',
    duration: 'number', // milliseconds
    errors: 'array',
    metadata: 'object'
};

// Colección: sync_metrics
const metricsSchema = {
    timestamp: 'timestamp',
    apiCalls: {
        drive: 'number',
        admin: 'number',
        firestore: 'number'
    },
    performance: {
        avgResponseTime: 'number',
        maxResponseTime: 'number',
        minResponseTime: 'number'
    },
    errors: {
        count: 'number',
        types: 'object'
    },
    resources: {
        memoryUsage: 'number',
        cpuUsage: 'number'
    }
};
```

### Índices de Firestore
```javascript
// Índices requeridos para consultas eficientes
const firestoreIndexes = [
    {
        collection: 'shared_drives',
        fields: [
            { field: 'lastSynced', order: 'desc' },
            { field: 'syncStatus', order: 'asc' }
        ]
    },
    {
        collection: 'drive_permissions',
        fields: [
            { field: 'driveId', order: 'asc' },
            { field: 'type', order: 'asc' },
            { field: 'role', order: 'asc' }
        ]
    },
    {
        collection: 'sync_history',
        fields: [
            { field: 'timestamp', order: 'desc' },
            { field: 'status', order: 'asc' }
        ]
    }
];
```

## 🔐 Arquitectura de Seguridad

### Autenticación y Autorización
```javascript
// Middleware de autenticación
class AuthenticationMiddleware {
    static async authenticate(req, res, next) {
        try {
            const token = req.headers.authorization?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({ error: 'No token provided' });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            
            // Verificar permisos específicos
            if (!await AuthService.hasPermission(decoded.sub, req.path, req.method)) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            next();
        } catch (error) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    }
}

// Servicio de autorización
class AuthService {
    static async hasPermission(userId, resource, action) {
        // Implementar lógica de permisos basada en roles
        const userRoles = await this.getUserRoles(userId);
        const requiredPermissions = this.getRequiredPermissions(resource, action);
        
        return userRoles.some(role => 
            requiredPermissions.some(permission => 
                role.permissions.includes(permission)
            )
        );
    }
}
```

### Validación de Datos
```javascript
// Esquemas de validación con Joi
const validationSchemas = {
    createDrive: Joi.object({
        name: Joi.string().min(1).max(100).required(),
        description: Joi.string().max(500).optional()
    }),
    
    updatePermissions: Joi.object({
        permissions: Joi.array().items(
            Joi.object({
                type: Joi.string().valid('user', 'group', 'domain', 'anyone').required(),
                role: Joi.string().valid('owner', 'organizer', 'writer', 'commenter', 'reader').required(),
                emailAddress: Joi.string().email().when('type', {
                    is: Joi.string().valid('user', 'group'),
                    then: Joi.required(),
                    otherwise: Joi.optional()
                })
            })
        ).required()
    })
};

// Middleware de validación
class ValidationMiddleware {
    static validate(schema) {
        return (req, res, next) => {
            const { error, value } = schema.validate(req.body);
            
            if (error) {
                return res.status(400).json({
                    error: 'Validation error',
                    details: error.details.map(d => d.message)
                });
            }
            
            req.validatedData = value;
            next();
        };
    }
}
```

## 📈 Monitoreo y Observabilidad

### Logging Estructurado
```javascript
// Configuración de Winston
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: {
        service: 'backend-sync',
        version: process.env.npm_package_version
    },
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log' 
        })
    ]
});

// Contexto de logging
class LogContext {
    constructor(correlationId) {
        this.correlationId = correlationId;
        this.startTime = Date.now();
    }

    info(message, meta = {}) {
        logger.info(message, {
            ...meta,
            correlationId: this.correlationId,
            duration: Date.now() - this.startTime
        });
    }

    error(message, error, meta = {}) {
        logger.error(message, {
            ...meta,
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code
            },
            correlationId: this.correlationId
        });
    }
}
```

### Métricas y Health Checks
```javascript
// Health check endpoint
class HealthCheckService {
    static async getHealthStatus() {
        const checks = {
            database: await this.checkFirestore(),
            googleApi: await this.checkGoogleAPI(),
            memory: this.checkMemoryUsage(),
            disk: await this.checkDiskSpace()
        };

        const isHealthy = Object.values(checks).every(check => check.status === 'healthy');

        return {
            status: isHealthy ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            checks,
            uptime: process.uptime(),
            version: process.env.npm_package_version
        };
    }

    static async checkFirestore() {
        try {
            await admin.firestore().collection('health').doc('test').get();
            return { status: 'healthy', responseTime: Date.now() };
        } catch (error) {
            return { status: 'unhealthy', error: error.message };
        }
    }

    static async checkGoogleAPI() {
        try {
            const startTime = Date.now();
            await google.drive({ version: 'v3', auth }).about.get();
            return { 
                status: 'healthy', 
                responseTime: Date.now() - startTime 
            };
        } catch (error) {
            return { status: 'unhealthy', error: error.message };
        }
    }
}
```

## 🚀 Escalabilidad y Performance

### Queue System
```javascript
// Sistema de colas con Bull
const Queue = require('bull');
const redis = require('redis');

class QueueManager {
    constructor() {
        this.redisClient = redis.createClient(process.env.REDIS_URL);
        this.syncQueue = new Queue('sync operations', {
            redis: {
                port: process.env.REDIS_PORT,
                host: process.env.REDIS_HOST
            }
        });
        
        this.setupProcessors();
    }

    setupProcessors() {
        this.syncQueue.process('full-sync', 5, async (job) => {
            const { driveId } = job.data;
            return await this.processDriveSync(driveId);
        });

        this.syncQueue.process('permission-update', 10, async (job) => {
            const { driveId, permissions } = job.data;
            return await this.processPermissionUpdate(driveId, permissions);
        });
    }

    async addSyncJob(driveId, priority = 'normal') {
        const jobOptions = {
            priority: priority === 'high' ? 1 : 5,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            },
            removeOnComplete: 100,
            removeOnFail: 50
        };

        return await this.syncQueue.add('full-sync', { driveId }, jobOptions);
    }
}
```

### Caching Strategy
```javascript
// Cache con Redis
class CacheService {
    constructor() {
        this.redis = redis.createClient(process.env.REDIS_URL);
        this.defaultTTL = 300; // 5 minutos
    }

    async get(key) {
        try {
            const value = await this.redis.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Cache get error:', error);
            return null;
        }
    }

    async set(key, value, ttl = this.defaultTTL) {
        try {
            await this.redis.setex(key, ttl, JSON.stringify(value));
        } catch (error) {
            logger.error('Cache set error:', error);
        }
    }

    async invalidate(pattern) {
        try {
            const keys = await this.redis.keys(pattern);
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } catch (error) {
            logger.error('Cache invalidation error:', error);
        }
    }
}

// Uso en servicios
class GoogleDriveService {
    async getDriveDetails(driveId) {
        const cacheKey = `drive:${driveId}`;
        
        // Intentar obtener del cache
        let driveData = await this.cache.get(cacheKey);
        
        if (!driveData) {
            // Obtener de la API y cachear
            driveData = await this.fetchDriveFromAPI(driveId);
            await this.cache.set(cacheKey, driveData, 600); // 10 minutos
        }
        
        return driveData;
    }
}
```

Esta arquitectura proporciona una base sólida, escalable y mantenible para el backend de sincronización, con patrones de diseño robustos y mejores prácticas de desarrollo.