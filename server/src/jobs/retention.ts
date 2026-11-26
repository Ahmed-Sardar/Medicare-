import { Notification, SupportTicket } from '../modules/models.js';
import { env } from '../config/env.js';
import { withJobLease } from '../services/jobLease.js';
export async function runRetention(): Promise<void> {
  await withJobLease('data-retention', async (signal) => {
    if (env.RETENTION_NOTIFICATION_DAYS) {
      const ids = await Notification.find({ createdAt: { $lt: new Date(Date.now() - env.RETENTION_NOTIFICATION_DAYS * 86400000) } }).select('_id').sort({ _id: 1 }).limit(1000).lean();
      if (ids.length && !signal.aborted) await Notification.deleteMany({ _id: { $in: ids.map((item) => item._id) } });
    }
    if (!env.RETENTION_SUPPORT_DAYS || signal.aborted) return;
    const filter = { status: { $in: ['RESOLVED', 'CLOSED'] }, retentionHold: { $ne: true }, contentPurgedAt: { $exists: false }, updatedAt: { $lt: new Date(Date.now() - env.RETENTION_SUPPORT_DAYS * 86400000) } };
    const tickets = await SupportTicket.find(filter).select('_id').sort({ _id: 1 }).limit(500).lean();
    if (tickets.length && !signal.aborted) await SupportTicket.updateMany({ ...filter, _id: { $in: tickets.map((item) => item._id) } }, { $set: { subject: 'Retained support record', comments: [], contentPurgedAt: new Date() }, $unset: { resolutionNotes: 1, 'statusHistory.$[].resolutionNotes': 1 }, $inc: { revision: 1 } });
  });
}
