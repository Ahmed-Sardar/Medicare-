import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env, corsOrigins } from '../config/env.js';
import { User } from '../modules/models.js';
import { logger } from '../config/logger.js';
export function createSocketServer(server: HttpServer): Server {
  const io = new Server(server, { cors: { origin: corsOrigins, credentials: true }, transports: ['websocket', 'polling'] });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.split(';').map((s) => s.trim()).find((s) => s.startsWith('accessToken='))?.slice('accessToken='.length);
      if (!token) return next(new Error('Unauthorized'));
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
      if (typeof payload.sub !== 'string') return next(new Error('Unauthorized'));
      const user = await User.findOne({ _id: payload.sub, active: true }).select('authVersion');
      if (!user || (payload.version ?? 0) !== (user.authVersion ?? 0)) return next(new Error('Unauthorized'));
      socket.data.userId = payload.sub;
      if (typeof payload.exp !== 'number') return next(new Error('Unauthorized'));
      socket.data.authVersion = payload.version ?? 0; socket.data.expiresAt = payload.exp * 1000;
      next();
    }
    catch { next(new Error('Unauthorized')); }
  });
  io.on('connection', (socket) => { socket.join(`user:${socket.data.userId}`); logger.debug({ userId: socket.data.userId }, 'Socket connected'); });
  return io;
}
