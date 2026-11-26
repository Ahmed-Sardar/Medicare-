import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AuditLog, User } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.js';
import { auditFamilyFilter, auditMetadata, auditScope, familyOf } from './policy.js';
import { auditPeriod, auditQuery, cursorFingerprint, decodeAuditCursor, encodeAuditCursor } from './contracts.js';

export const auditLogsRouter = Router(); auditLogsRouter.use(authenticate);
auditLogsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
function context(req: import('express').Request) {
  const input = auditQuery.parse(req.query); const period = auditPeriod(input); const scope = auditScope(req.auth!);
  if (!scope.families.length) throw new ApiError(403, 'No audit event groups are enabled for your current role policy');
  if (input.family && !scope.families.some((family) => family.code === input.family)) throw new ApiError(403, 'This audit event group is not permitted');
  if (input.action && !scope.families.some((family) => family.code === familyOf(input.action!))) throw new ApiError(403, 'This audit action is not permitted');
  const filters = { from: period.from, to: period.to, actorId: input.actorId, pharmacyId: input.pharmacyId, resourceId: input.resourceId, resourceType: input.resourceType, action: input.action, family: input.family, limit: input.limit };
  const filter: Record<string, unknown> = { $and: [auditFamilyFilter(input.family ? scope.families.filter((family) => family.code === input.family) : scope.families)], createdAt: { $gte: period.start, $lt: period.endExclusive },
    ...(input.actorId ? { actorId: new Types.ObjectId(input.actorId) } : {}), ...(input.pharmacyId ? { pharmacyId: new Types.ObjectId(input.pharmacyId) } : {}), ...(input.resourceId ? { resourceId: new Types.ObjectId(input.resourceId) } : {}), ...(input.resourceType ? { resourceType: input.resourceType } : {}), ...(input.action ? { action: input.action } : {}),
  };
  return { input, period, scope, filters, filter };
}
type EventRecord = { _id: unknown; action: string; actorId?: unknown; pharmacyId?: unknown; resourceType?: string | null; resourceId?: unknown; createdAt: Date; metadata?: unknown; ipAddress?: string | null };
function eventView(record: EventRecord, names: Map<string, string>) {
  const actorId = record.actorId ? String(record.actorId) : null;
  return { _id: String(record._id), action: record.action, family: familyOf(record.action), createdAt: record.createdAt,
    actor: actorId ? { id: actorId, ...(names.has(actorId) ? { name: names.get(actorId) } : {}) } : null,
    pharmacyId: record.pharmacyId ? String(record.pharmacyId) : null, resourceType: record.resourceType || null, resourceId: record.resourceId ? String(record.resourceId) : null };
}
async function actorNames(records: EventRecord[], enabled: boolean) {
  if (!enabled) return new Map<string, string>();
  const actors = await User.find({ _id: { $in: records.flatMap((record) => record.actorId ? [record.actorId] : []) } }).select('name').lean();
  return new Map(actors.map((actor) => [String(actor._id), actor.name]));
}
auditLogsRouter.get('/options', asyncHandler(async (req, res) => {
  const { input, period, scope, filter } = context(req); if (input.cursor) throw new ApiError(400, 'Audit options do not accept a cursor');
  const [actions, types] = await Promise.all([
    AuditLog.aggregate<{ _id: string }>([{ $match: filter }, { $group: { _id: '$action' } }, { $sort: { _id: 1 } }, { $limit: 201 }]),
    AuditLog.aggregate<{ _id: string }>([{ $match: { ...filter, resourceType: filter.resourceType || { $type: 'string' } } }, { $group: { _id: '$resourceType' } }, { $sort: { _id: 1 } }, { $limit: 201 }]),
  ]);
  res.json({ success: true, data: { families: scope.families.map(({ code, name }) => ({ code, name })), actions: actions.slice(0, 200).map((entry) => entry._id), resourceTypes: types.slice(0, 200).map((entry) => entry._id), optionsLimited: actions.length > 200 || types.length > 200, period: { from: period.from, to: period.to }, canViewDetails: scope.canViewDetails, canViewIp: scope.canViewIp } });
}));
auditLogsRouter.get('/', asyncHandler(async (req, res) => {
  const { input, period, scope, filters, filter } = context(req);
  const fingerprint = cursorFingerprint(filters, req.auth!.id, scope.families); const cursor = input.cursor ? decodeAuditCursor(input.cursor, fingerprint) : null;
  const snapshotAt = cursor?.snapshotAt || new Date().toISOString(); const issuedAt = cursor?.issuedAt || Date.now();
  filter.createdAt = { $gte: period.start, $lt: period.endExclusive, $lte: new Date(snapshotAt) };
  if (cursor?.at && cursor.id) (filter.$and as unknown[]).push({ $or: [{ createdAt: { $lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), _id: { $lt: new Types.ObjectId(cursor.id) } }] });
  const found = await AuditLog.find(filter).select('actorId action resourceType resourceId pharmacyId createdAt').sort({ createdAt: -1, _id: -1 }).limit(input.limit + 1).lean();
  const records = found.slice(0, input.limit); const names = await actorNames(records, scope.canViewActorNames); const last = records.at(-1);
  const nextCursor = found.length > input.limit && last ? encodeAuditCursor({ at: last.createdAt.toISOString(), id: String(last._id), snapshotAt, issuedAt, fingerprint }) : null;
  await recordAudit({ actorId: req.auth!.id, action: 'audit.logs.viewed', resourceType: 'AuditLog', metadata: { filters, returned: records.length }, ipAddress: req.ip });
  res.json({ success: true, data: { logs: records.map((record) => eventView(record, names)), currentCursor: input.cursor || encodeAuditCursor({ snapshotAt, issuedAt, fingerprint }), nextCursor, snapshotAt, period: { from: period.from, to: period.to }, limit: input.limit, canViewDetails: scope.canViewDetails, canViewIp: scope.canViewIp } });
}));
auditLogsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.params.id); const scope = auditScope(req.auth!);
  const record = await AuditLog.findOne({ _id: id, ...auditFamilyFilter(scope.families) }).select(`actorId action resourceType resourceId pharmacyId createdAt${scope.canViewDetails ? ' metadata' : ''}${scope.canViewIp ? ' ipAddress' : ''}`).lean();
  if (!record) throw new ApiError(404, 'Audit event not found');
  const names = await actorNames([record], scope.canViewActorNames);
  await recordAudit({ actorId: req.auth!.id, action: 'audit.event.viewed', resourceType: 'AuditLog', resourceId: id, metadata: { eventId: id }, ipAddress: req.ip });
  res.json({ success: true, data: { event: { ...eventView(record, names), ...(scope.canViewDetails ? { metadata: auditMetadata(record.action, record.metadata) } : {}), ...(scope.canViewIp ? { ipAddress: record.ipAddress || null } : {}) }, canViewDetails: scope.canViewDetails, canViewIp: scope.canViewIp } });
}));
