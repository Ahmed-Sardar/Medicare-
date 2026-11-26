import type { Server } from 'socket.io';
import { Notification, User } from '../modules/models.js';
import { logger } from '../config/logger.js';
let io: Server | undefined;
let stream: ReturnType<typeof Notification.watch> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false; let failures = 0; let resumeToken: unknown;
let state = 'stopped'; let lastEventAt: Date | null = null; let lastFailureAt: Date | null = null;
export function realtimeStatus() { return { state, failures, lastEventAt, lastFailureAt, localSockets: io?.sockets.sockets.size || 0 }; }
export function attachRealtime(server: Server): void { io = server; }
export function disconnectUser(userId: string): void { io?.local.in(`user:${userId}`).disconnectSockets(true); }
export function emitToUser(userId: string, event: string, payload: unknown): void { io?.local.to(`user:${userId}`).emit(event, payload); }
export function watchNotifications(): void {
  stopped = false;
  function open() {
    if (stopped) return;
    state = 'watching';
    const current = Notification.watch([{ $match: { operationType: 'insert' } }], { fullDocument: 'updateLookup', ...(resumeToken ? { resumeAfter: resumeToken as never } : {}) }); stream = current;
    let restarting = false;
    const restart = (error?: unknown) => {
      if (stopped || restarting) return; restarting = true;
      state = 'reconnecting'; lastFailureAt = new Date();
      const code = (error as { code?: number } | undefined)?.code;
      if (code === 260 || code === 280 || code === 286) resumeToken = undefined;
      void current.close().catch(() => undefined);
      failures++; logger.warn({ failures, code }, 'Notification stream reconnect scheduled');
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))); timer.unref();
    };
    current.on('change', (change) => {
      resumeToken = change._id; failures = 0; lastEventAt = new Date(); state = 'receiving';
      const notification = change.fullDocument as unknown as { userId?: unknown } | undefined;
      if (notification?.userId) emitToUser(String(notification.userId), 'notification:new', notification);
    });
    current.on('error', restart); current.on('close', () => restart());
  }
  open();
}
// Each instance watches inserts and emits only locally; do not rebroadcast via an adapter.
// Database checks propagate revocations across instances even during change-stream downtime.
export async function revalidateSockets(): Promise<void> {
  if (!io) return;
  const sockets = [...io.sockets.sockets.values()];
  for (let offset = 0; offset < sockets.length; offset += 200) {
    const batch = sockets.slice(offset, offset + 200);
    const users = await User.find({ _id: { $in: batch.map((socket) => socket.data.userId) }, active: true }).select('authVersion').lean();
    const versions = new Map(users.map((user) => [String(user._id), user.authVersion ?? 0]));
    for (const socket of batch) if (!versions.has(socket.data.userId) || versions.get(socket.data.userId) !== socket.data.authVersion || socket.data.expiresAt <= Date.now()) socket.disconnect(true);
  }
}
export async function closeRealtime(): Promise<void> { stopped = true; state = 'stopped'; if (timer) clearTimeout(timer); await stream?.close(); }
