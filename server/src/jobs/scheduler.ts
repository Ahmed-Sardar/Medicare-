import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
type Jobs = { operational: () => Promise<void>; delivery: () => Promise<void>; retention: () => Promise<void> };
const intervals: Record<keyof Jobs, number> = { operational: 60000, delivery: 10000, retention: 3600000 };
export async function startJobScheduler(jobs: Jobs): Promise<() => Promise<void>> {
  if (!env.REDIS_URL) {
    const running = new Set<string>(); const timers: Array<ReturnType<typeof setInterval>> = []; let stopped = false;
    for (const name of Object.keys(intervals) as Array<keyof Jobs>) {
      const run = () => { if (stopped || running.has(name)) return; running.add(name); void jobs[name]().catch(() => logger.error({ job: name }, 'Scheduled job failed')).finally(() => running.delete(name)); };
      const timer = setInterval(run, intervals[name]); timer.unref(); timers.push(timer); run();
    }
    return async () => { stopped = true; timers.forEach(clearInterval); };
  }
  const { Queue, Worker } = await import('bullmq'); const url = new URL(env.REDIS_URL);
  const dbText = url.pathname.replace(/^\//, ''); const db = dbText ? Number(dbText) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error('REDIS_URL database must be a nonnegative integer');
  const connection = { host: url.hostname, port: Number(url.port || 6379), username: url.username ? decodeURIComponent(url.username) : undefined, password: url.password ? decodeURIComponent(url.password) : undefined, db, ...(url.protocol === 'rediss:' ? { tls: {} } : {}), connectTimeout: 10000 };
  const queue = new Queue('medfind-background', { connection: { ...connection, maxRetriesPerRequest: 1 }, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 1000, attempts: 3, backoff: { type: 'exponential', delay: 1000 } } });
  queue.on('error', () => logger.error('Background queue connection failed'));
  try {
    for (const name of Object.keys(intervals) as Array<keyof Jobs>) await queue.upsertJobScheduler(`medfind-${name}`, { every: intervals[name] }, { name, data: {} });
    const worker = new Worker('medfind-background', async (job) => { if (!Object.hasOwn(jobs, job.name)) throw new Error('Unknown background job'); await jobs[job.name as keyof Jobs](); }, { connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 3 });
    worker.on('error', () => logger.error('Background worker connection failed')); worker.on('failed', (job) => logger.error({ job: job?.name }, 'Background job failed'));
    return async () => { await worker.close(); await queue.close(); };
  } catch (error) { await queue.close(); throw error; }
}
