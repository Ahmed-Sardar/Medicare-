import { Notification, SupportFanout, User } from '../modules/models.js';
import { roleCodesWithPermission } from '../services/rbac.js';
import { withJobLease } from '../services/jobLease.js';
export async function runSupportFanout(): Promise<void> {
  await withJobLease('support-fanout', async (signal) => {
    const pending = await SupportFanout.find({ status: 'PENDING' }).sort({ createdAt: 1, _id: 1 }).limit(25).lean();
    for (const candidate of pending) {
      if (signal.aborted) break;
      const session = await User.startSession();
      try { await session.withTransaction(async () => {
        const job = await SupportFanout.findOneAndUpdate({ _id: candidate._id, status: 'PENDING', afterUserId: candidate.afterUserId || null }, { $set: { updatedAt: new Date() } }, { new: true, session });
        if (!job) return;
        const roles = await roleCodesWithPermission('support:manage', session);
        const users = await User.find({ active: true, roles: { $in: roles }, _id: { ...(job.afterUserId ? { $gt: job.afterUserId } : {}), ...(job.excludeUserId ? { $ne: job.excludeUserId } : {}) } }).select('_id').sort({ _id: 1 }).limit(100).session(session);
        for (const user of users) await Notification.updateOne({ dedupKey: `SUPPORT_FANOUT:${job.id}:${user.id}` }, { $setOnInsert: { userId: user.id, type: job.type, title: job.title, message: 'Open your support workspace to view the update.', data: { ticketId: String(job.ticketId), view: 'inbox' } } }, { upsert: true, session });
        if (users.length < 100) job.status = 'COMPLETED'; if (users.length) job.afterUserId = users[users.length - 1]!._id;
        await job.save({ session });
      }); } finally { await session.endSession(); }
    }
  });
}
