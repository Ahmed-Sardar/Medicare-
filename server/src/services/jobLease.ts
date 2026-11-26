import { randomUUID } from 'node:crypto';
import { JobLease } from '../modules/models.js';
import { logger } from '../config/logger.js';

// A lease limits concurrent workers. Every job must also use idempotent writes or transactions:
// a paused process may finish an in-flight write after its lease has been reassigned.
export async function withJobLease(name: string, job: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const owner = randomUUID(); const duration = 90_000; const now = new Date();
  try {
    const lease = await JobLease.findOneAndUpdate({ _id: name, expiresAt: { $lte: now } }, { $set: { owner, expiresAt: new Date(now.getTime() + duration) } }, { upsert: true, new: true });
    if (!lease) return;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return;
    throw error;
  }
  const controller = new AbortController(); let renewing = false;
  const timer = setInterval(() => {
    if (renewing || controller.signal.aborted) return; renewing = true;
    void JobLease.updateOne({ _id: name, owner, expiresAt: { $gt: new Date() } }, { $set: { expiresAt: new Date(Date.now() + duration) } })
      .then((result) => { if (!result.matchedCount) controller.abort(); })
      .catch(() => { controller.abort(); logger.error({ job: name }, 'Job lease renewal failed'); })
      .finally(() => { renewing = false; });
  }, 20_000); timer.unref();
  try { await job(controller.signal); }
  finally { clearInterval(timer); controller.abort(); await JobLease.updateOne({ _id: name, owner }, { $set: { expiresAt: new Date(0) } }).catch(() => undefined); }
}
