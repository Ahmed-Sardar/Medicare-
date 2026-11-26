import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env, corsOrigins } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/router.js';
import { pharmaciesRouter } from './modules/pharmacies/router.js';
import { pharmacyStaffRouter } from './modules/pharmacyStaff/router.js';
import { inventoryRouter } from './modules/inventory/router.js';
import { searchRouter } from './modules/search/router.js';
import { reservationsRouter } from './modules/reservations/router.js';
import { adminRouter } from './modules/admin/router.js';
import { notificationsRouter } from './modules/notifications/router.js';
import { supportRouter } from './modules/support/router.js';
import { pharmacistsRouter } from './modules/pharmacists/router.js';
import { reportsRouter } from './modules/reports/router.js';
import { catalogueAdminRouter } from './modules/medicines/adminRouter.js';
import { medicinesRouter, medicineCategoriesRouter } from './modules/medicines/router.js';
import { savedPharmaciesRouter } from './modules/savedPharmacies/router.js';
import { usersRouter } from './modules/users/router.js';
import { userSettingsPaths } from './modules/users/openapi.js';
import { rolesRouter } from './modules/roles/router.js';
import { roleAdministrationPaths } from './modules/roles/openapi.js';
import { cataloguePaths } from './modules/medicines/openapi.js';
import { auditLogsRouter } from './modules/auditLogs/router.js';
import { auditLogPaths } from './modules/auditLogs/openapi.js';
import { phoneRouter } from './modules/users/phoneRouter.js';
import { privacyRouter } from './modules/users/privacyRouter.js';
import { operationsRouter } from './modules/admin/operations.js';
import { operationalPaths } from './modules/admin/operationalOpenapi.js';
import { baseOpenApiPaths } from './modules/openapi/base.js';

export const app = express();
app.disable('x-powered-by'); app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet()); app.use(cors({ origin: (origin, callback) => { if (!origin || corsOrigins.includes(origin)) return callback(null, true); callback(new Error('Origin is not allowed by CORS')); }, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'] }));
app.use(express.json({ limit: '1mb' })); app.use(express.urlencoded({ extended: false, limit: '1mb' })); app.use(cookieParser());
// Query strings can contain medicine searches, location coordinates and account tokens.
app.use(pinoHttp({ logger, serializers: { req: (request) => ({ id: request.id, method: request.method, url: typeof request.url === 'string' ? request.url.split('?')[0] : undefined }) } }));
app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok', service: 'medfind-api' } }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/v1/auth', authLimiter, authRouter);
app.use('/api/v1/pharmacies', pharmaciesRouter); app.use('/api/v1/pharmacies', pharmacyStaffRouter); app.use('/api/v1/medicines', medicinesRouter);
app.use('/api/v1/inventory', inventoryRouter); app.use('/api/v1/search', searchRouter); app.use('/api/v1/reservations', reservationsRouter);
app.use('/api/v1/saved-pharmacies', savedPharmaciesRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/users', phoneRouter);
app.use('/api/v1', privacyRouter);
app.use('/api/v1/admin', operationsRouter);
app.use('/api/v1/medicine-categories', medicineCategoriesRouter);
app.use('/api/v1/admin/audit-logs', auditLogsRouter); app.use('/api/v1/admin', catalogueAdminRouter); app.use('/api/v1/admin', rolesRouter); app.use('/api/v1/admin', adminRouter); app.use('/api/v1/notifications', notificationsRouter); app.use('/api/v1/support', supportRouter); app.use('/api/v1/pharmacists', pharmacistsRouter); app.use('/api/v1/reports', reportsRouter);
app.get('/api/v1/openapi.json', (_req, res) => res.json(openApiDocument));
app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use(errorHandler);

export const openApiDocument = {
  openapi: '3.1.0', info: { title: 'MedFind API', version: '1.0.0', description: 'Medicine availability discovery API. Availability is reported by pharmacies, not a sale or medical recommendation.' }, servers: [{ url: '/api/v1' }],
  paths: { ...baseOpenApiPaths, ...userSettingsPaths, ...roleAdministrationPaths, ...cataloguePaths, ...auditLogPaths, ...operationalPaths }, components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'accessToken' } } },
};
