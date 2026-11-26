import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/errors.js';
import { auditFamilies } from './policy.js';
const objectId = z.string().regex(/^[0-9a-f]{24}$/i).transform((value) => value.toLowerCase());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Invalid calendar date');
export const auditQuery = z.object({ from: day.optional(), to: day.optional(), actorId: objectId.optional(), pharmacyId: objectId.optional(), resourceId: objectId.optional(), resourceType: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_]*$/).optional(),
  action: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/).optional(), family: z.enum(['security', 'pharmacy', 'catalogue', 'support', 'reports', 'system']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(2000).optional(),
}).strict();
export function auditPeriod(input: z.infer<typeof auditQuery>) {
  const today = new Date().toISOString().slice(0, 10); const to = input.to || today;
  const end = new Date(`${to}T00:00:00.000Z`); const start = input.from ? new Date(`${input.from}T00:00:00.000Z`) : new Date(end.getTime() - 29 * 86400000);
  if (to > today || start > end || end.getTime() - start.getTime() > 365 * 86400000) throw new ApiError(400, 'Choose an inclusive UTC date range of at most 366 days, ending no later than today');
  return { from: start.toISOString().slice(0, 10), to, start, endExclusive: new Date(end.getTime() + 86400000) };
}
const cursorData = z.object({ at: z.string().datetime().optional(), id: objectId.optional(), snapshotAt: z.string().datetime(), issuedAt: z.number().int().positive(), fingerprint: z.string().length(64) }).strict().refine((value) => Boolean(value.at) === Boolean(value.id));
export type AuditCursor = z.infer<typeof cursorData>;
const sign = (value: string) => createHmac('sha256', env.JWT_ACCESS_SECRET).update(`medfind:audit-cursor:v1:${value}`).digest();
export function cursorFingerprint(filters: Record<string, unknown>, userId: string, families: ReadonlyArray<typeof auditFamilies[number]>) { return createHash('sha256').update(JSON.stringify({ userId, families: families.map((family) => family.code).sort(), ...filters })).digest('hex'); }
export function encodeAuditCursor(data: AuditCursor): string { const value = Buffer.from(JSON.stringify(data)).toString('base64url'); return `${value}.${sign(value).toString('base64url')}`; }
export function decodeAuditCursor(value: string, fingerprint: string): AuditCursor {
  try {
    const parts = value.split('.'); if (parts.length !== 2) throw new Error();
    const signature = Buffer.from(parts[1]!, 'base64url'); const expected = sign(parts[0]!);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error();
    const data = cursorData.parse(JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')));
    if (data.fingerprint !== fingerprint || Date.now() - data.issuedAt > 3600000 || data.issuedAt > Date.now() + 1000) throw new Error();
    return data;
  } catch { throw new ApiError(400, 'Audit cursor is invalid, expired or belongs to different filters. Refresh the audit view.', 'INVALID_AUDIT_CURSOR'); }
}
