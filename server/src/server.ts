import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDatabase } from './database/connect.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createSocketServer } from './sockets/index.js';
import { attachRealtime, closeRealtime, watchNotifications, revalidateSockets } from './services/realtime.js';
import { runOperationalSweep } from './jobs/operationalSweep.js';
import { ensureRbacCatalog } from './services/rbac.js';
import { ensureCatalogueIndexes } from './database/catalogueIndexes.js';
import { runEmailDelivery } from './jobs/emailDelivery.js';
import { recoverPrivateFiles } from './jobs/privateFileRecovery.js';
import { runSupportFanout } from './jobs/supportFanout.js';
import { runRetention } from './jobs/retention.js';
import { ensureOperationalIndexes } from './database/operationalIndexes.js';
import { startJobScheduler } from './jobs/scheduler.js';
import { recoverImportFiles } from './jobs/importRecovery.js';

async function main(): Promise<void> {
  await connectDatabase(); await ensureRbacCatalog(); await ensureCatalogueIndexes(); await ensureOperationalIndexes(); const httpServer = createServer(app); const io = createSocketServer(httpServer); attachRealtime(io); watchNotifications();
  const stopJobs = await startJobScheduler({ operational: () => runOperationalSweep(), delivery: async () => { await runEmailDelivery(); await runSupportFanout(); }, retention: runRetention });
  // Scratch and legacy local documents exist on each host, so recovery runs on every instance.
  let recovering = false;
  const recover = () => { if (recovering) return; recovering = true; void recoverPrivateFiles().catch(() => logger.error('Private file recovery failed')).finally(() => { recovering = false; }); };
  const recoveryTimer = setInterval(recover, 3600000); recoveryTimer.unref(); recover();
  let importing = false;
  const importRecovery = () => { if (importing) return; importing = true; void recoverImportFiles(new AbortController().signal).catch(() => logger.error('Import recovery failed')).finally(() => { importing = false; }); };
  const importTimer = setInterval(importRecovery, 60000); importTimer.unref(); importRecovery();
  let checkingSockets = false;
  const socketTimer = setInterval(() => { if (checkingSockets) return; checkingSockets = true; void revalidateSockets().catch(() => { io.local.disconnectSockets(true); logger.error('Socket authorization check failed'); }).finally(() => { checkingSockets = false; }); }, 15_000); socketTimer.unref();
  httpServer.listen(env.PORT, () => logger.info({ port: env.PORT }, 'MedFind API listening'));
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return; shuttingDown = true; logger.info({ signal }, 'Shutting down'); clearInterval(socketTimer); clearInterval(recoveryTimer); clearInterval(importTimer);
    const deadline = setTimeout(() => process.exit(1), 30000); deadline.unref();
    void Promise.allSettled([stopJobs(), closeRealtime()]).then(() => { io.close(() => httpServer.close(() => process.exit(0))); });
  };
  process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch((error: unknown) => { logger.fatal({ err: error }, 'Unable to start MedFind API'); process.exitCode = 1; });
