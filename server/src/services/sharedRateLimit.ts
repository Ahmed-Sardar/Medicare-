import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { RateBucket } from '../modules/models.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/errors.js';

export function sharedAccountLimit(scope: string, maximum: number, windowMs = 900_000): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const now = Date.now(); const bucket = Math.floor(now / windowMs); const end = (bucket + 1) * windowMs;
    const key = createHash('sha256').update(`${scope}:${req.auth!.id}:${bucket}`).digest('hex');
    let record;
    try { record = await RateBucket.findOneAndUpdate({ _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(end) } }, { upsert: true, new: true }); }
    catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      record = await RateBucket.findOneAndUpdate({ _id: key }, { $inc: { count: 1 } }, { new: true });
    }
    if (!record) throw new ApiError(503, 'Request limiter is temporarily unavailable');
    res.setHeader('RateLimit-Limit', maximum); res.setHeader('RateLimit-Remaining', Math.max(0, maximum - record.count));
    res.setHeader('RateLimit-Reset', Math.ceil((end - now) / 1000));
    if (record.count > maximum) { res.setHeader('Retry-After', Math.ceil((end - now) / 1000)); throw new ApiError(429, 'Too many requests; try again later', 'RATE_LIMITED'); }
    next();
  });
}
