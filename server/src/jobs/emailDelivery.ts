import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EmailDelivery, User } from '../modules/models.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { openDelivery } from '../services/deliveryCrypto.js';
import { withJobLease } from '../services/jobLease.js';

export async function runEmailDelivery(): Promise<void> {
  await withJobLease('email-delivery', async (signal) => {
    await EmailDelivery.updateMany({ status: { $in: ['QUEUED', 'SENDING'] }, expiresAt: { $lte: new Date() } }, { $set: { status: 'EXPIRED' }, $unset: { payload: 1, tokenHash: 1, lockToken: 1, lockedUntil: 1 } });
    for (let count = 0; count < 25 && !signal.aborted; count++) {
      const lockToken = randomUUID(); const now = new Date();
      const job = await EmailDelivery.findOneAndUpdate({ expiresAt: { $gt: now }, nextAttemptAt: { $lte: now }, $or: [{ status: 'QUEUED' }, { status: 'SENDING', lockedUntil: { $lte: now } }] },
        { $set: { status: 'SENDING', lockToken, lockedUntil: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1, _id: 1 } }).select('+payload +tokenHash');
      if (!job) break;
      const guard = { _id: job._id, lockToken, status: 'SENDING' }; let errorCode = 'PROVIDER_UNAVAILABLE'; let retryable = true;
      try {
        const hashField = job.kind === 'reset' ? 'passwordResetHash' : 'emailVerificationHash';
        if (!await User.exists({ _id: job.userId, active: true, [hashField]: job.tokenHash })) {
          await EmailDelivery.updateOne(guard, { $set: { status: 'CANCELLED' }, $unset: { payload: 1, tokenHash: 1, lockToken: 1, lockedUntil: 1 } }); continue;
        }
        errorCode = 'INVALID_PAYLOAD'; retryable = false;
        const body = z.object({ from: z.string().email().optional(), to: z.string().email(), subject: z.string(), text: z.string() }).parse(openDelivery(job.payload || ''));
        errorCode = 'PROVIDER_UNAVAILABLE'; retryable = true;
        let providerId: string | undefined;
        if (env.EMAIL_PROVIDER === 'resend') {
          const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `medfind/${job.id}` }, body: JSON.stringify({ ...body, to: [body.to] }), signal: AbortSignal.timeout(10000) });
          if (!response.ok) { errorCode = `HTTP_${response.status}`; retryable = response.status === 429 || response.status >= 500 || response.status === 409; throw new Error(); }
          providerId = z.object({ id: z.string().uuid() }).parse(await response.json()).id;
        } else logger.info({ deliveryId: job.id, kind: job.kind }, 'Development email prepared; use the development token response');
        await EmailDelivery.updateOne(guard, { $set: { status: 'ACCEPTED', ...(providerId ? { providerId, providerEvent: 'sent' } : { providerEvent: 'development' }), receiptCheckedAt: new Date() }, $unset: { payload: 1, tokenHash: 1, lockToken: 1, lockedUntil: 1, lastError: 1 } });
      } catch {
        const failed = !retryable || job.attempts >= 8;
        await EmailDelivery.updateOne(guard, { $set: { status: failed ? 'FAILED' : 'QUEUED', lastError: errorCode, nextAttemptAt: new Date(Date.now() + Math.min(3600_000, 60000 * 2 ** (job.attempts - 1))) }, $unset: { lockToken: 1, lockedUntil: 1, ...(failed ? { payload: 1, tokenHash: 1 } : {}) } });
        logger.warn({ deliveryId: job.id, errorCode, failed }, 'Email delivery attempt failed');
      }
    }
    if (env.EMAIL_PROVIDER !== 'resend' || signal.aborted) return;
    const receipts = await EmailDelivery.find({ status: 'ACCEPTED', providerId: { $exists: true }, createdAt: { $gte: new Date(Date.now() - 7 * 86400000) }, providerEvent: { $nin: ['delivered', 'bounced', 'complained', 'failed', 'suppressed'] }, receiptCheckedAt: { $lte: new Date(Date.now() - 300000) } }).sort({ receiptCheckedAt: 1 }).limit(20);
    for (const job of receipts) {
      if (signal.aborted) break;
      try {
        const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(job.providerId!)}`, { headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}` }, signal: AbortSignal.timeout(10000) });
        if (response.ok) { const receipt = z.object({ last_event: z.string().max(80) }).parse(await response.json()); await EmailDelivery.updateOne({ _id: job._id }, { $set: { providerEvent: receipt.last_event, receiptCheckedAt: new Date() } }); }
        else await EmailDelivery.updateOne({ _id: job._id }, { $set: { receiptCheckedAt: new Date(), lastError: `RECEIPT_HTTP_${response.status}` } });
      } catch { await EmailDelivery.updateOne({ _id: job._id }, { $set: { receiptCheckedAt: new Date(), lastError: 'RECEIPT_UNAVAILABLE' } }); }
    }
  });
}
