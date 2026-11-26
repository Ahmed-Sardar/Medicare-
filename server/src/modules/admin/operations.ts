import { Router } from 'express';
import { EmailDelivery, JobLease, SupportFanout } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { env } from '../../config/env.js';
import { realtimeStatus } from '../../services/realtime.js';
export const operationsRouter = Router();
operationsRouter.get('/operations', authenticate, requirePermission('settings:read'), asyncHandler(async (_req, res) => {
  const [deliveryStates, recentDeliveries, leases, pendingFanouts] = await Promise.all([
    EmailDelivery.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    EmailDelivery.find().select('kind status attempts nextAttemptAt providerEvent receiptCheckedAt lastError createdAt expiresAt').sort({ createdAt: -1, _id: -1 }).limit(50).lean(),
    JobLease.find().select('_id expiresAt').sort({ _id: 1 }).lean(), SupportFanout.countDocuments({ status: 'PENDING' }),
  ]);
  res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { deliveryStates, recentDeliveries, leases, pendingFanouts, realtime: realtimeStatus(),
    configuration: { emailProvider: env.EMAIL_PROVIDER, phoneProvider: env.SMS_PROVIDER, privateStorage: env.STORAGE_PROVIDER, backgroundScheduler: env.REDIS_URL ? 'BullMQ' : 'MongoDB leases with local timers', notificationRetentionDays: env.RETENTION_NOTIFICATION_DAYS, supportRetentionDays: env.RETENTION_SUPPORT_DAYS }, now: new Date() } });
}));
