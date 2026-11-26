import { Router } from 'express';
import mongoose, { type PipelineStage } from 'mongoose';
import { z } from 'zod';
import { Inventory, InventoryBatch, Medicine, Pharmacy, Reservation, SearchHistory, StockMovement, User } from '../models.js';
import { assertPharmacyAction } from '../../services/pharmacyAuthorization.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { getFreshnessThresholds } from '../../services/settings.js';
import { recordAudit } from '../../services/audit.js';
import { exportReport } from './export.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);
analyticsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const objectId = z.string().regex(/^[0-9a-f]{24}$/i);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Invalid calendar date');
const statuses = z.enum(['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED', 'REJECTED', 'CANCELLED', 'EXPIRED']);
const common = z.object({ format: z.enum(['csv', 'xlsx']).optional(), from: day.optional(), to: day.optional(), pharmacyId: objectId.optional(), medicineId: objectId.optional(), status: statuses.optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
type Options = z.infer<typeof common>;
function dates(input: Options) {
  const today = new Date().toISOString().slice(0, 10); const endDay = input.to || today;
  const endStart = new Date(`${endDay}T00:00:00.000Z`); const start = input.from ? new Date(`${input.from}T00:00:00.000Z`) : new Date(endStart.getTime() - 29 * 86400000);
  const endExclusive = new Date(endStart.getTime() + 86400000); if (start >= endExclusive || endExclusive.getTime() - start.getTime() > 366 * 86400000) throw new ApiError(400, 'Choose an inclusive date range of at most 366 days');
  return { from: start.toISOString().slice(0, 10), to: endDay, start, endExclusive };
}
const oid = (id: string) => new mongoose.Types.ObjectId(id);
async function pharmacyAccess(auth: import('../../middleware/auth.js').AuthUser, pharmacyId?: string) {
  if (!pharmacyId) throw new ApiError(400, 'pharmacyId is required');
  await assertPharmacyAction(auth, pharmacyId, 'report:read');
  const pharmacy = await Pharmacy.findById(pharmacyId).select('name city isDemo'); if (!pharmacy) throw new ApiError(404, 'Pharmacy not found'); return pharmacy;
}
function inventoryBase(pharmacyId: string, medicineId: string | undefined, now: Date): PipelineStage[] {
  return [
    { $match: { pharmacyId: oid(pharmacyId), active: true, ...(medicineId ? { medicineId: oid(medicineId) } : {}) } },
    { $lookup: { from: InventoryBatch.collection.name, localField: '_id', foreignField: 'inventoryId', pipeline: [{ $match: { active: true, expiryDate: { $gt: now } } }, { $group: { _id: null, availableQuantity: { $sum: { $max: [0, { $subtract: [{ $ifNull: ['$onHandQuantity', 0] }, { $ifNull: ['$reservedQuantity', 0] }] }] } } } }], as: 'batchTotals' } },
    { $addFields: { availableQuantity: { $ifNull: [{ $arrayElemAt: ['$batchTotals.availableQuantity', 0] }, 0] } } },
  ];
}
function reservationMatch(input: Options, period: ReturnType<typeof dates>, pharmacyId?: string): Record<string, unknown> {
  return { createdAt: { $gte: period.start, $lt: period.endExclusive }, ...(pharmacyId ? { pharmacyId: oid(pharmacyId) } : {}), ...(input.medicineId ? { medicineId: oid(input.medicineId) } : {}), ...(input.status ? { status: input.status } : {}) };
}
function pageFacet(page: number, limit: number): PipelineStage { return { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: 'total' }] } }; }
function unpack(rows: Array<{ items: unknown[]; count: Array<{ total: number }> }>, input: Options) { return { items: rows[0]?.items || [], total: rows[0]?.count[0]?.total || 0, page: input.page, limit: input.limit }; }

analyticsRouter.get('/pharmacy/overview', asyncHandler(async (req, res) => {
  const input = common.parse(req.query); const period = dates(input); const pharmacy = await pharmacyAccess(req.auth!, input.pharmacyId); const pharmacyId = pharmacy.id; const now = new Date();
  const [stock, expiry, statuses, demand] = await Promise.all([
    Inventory.aggregate([...inventoryBase(pharmacyId, input.medicineId, now), { $group: { _id: null, items: { $sum: 1 }, availableUnits: { $sum: '$availableQuantity' }, lowStockItems: { $sum: { $cond: [{ $lte: ['$availableQuantity', { $ifNull: ['$minStock', 0] }] }, 1, 0] } }, unavailableItems: { $sum: { $cond: [{ $eq: ['$stockStatus', 'UNAVAILABLE'] }, 1, 0] } } } }]),
    Inventory.aggregate([{ $match: { pharmacyId: oid(pharmacyId), active: true, ...(input.medicineId ? { medicineId: oid(input.medicineId) } : {}) } }, { $lookup: { from: InventoryBatch.collection.name, localField: '_id', foreignField: 'inventoryId', as: 'batch' } }, { $unwind: '$batch' }, { $group: { _id: null, expiringWithin90Days: { $sum: { $cond: [{ $and: [{ $eq: ['$batch.active', true] }, { $gt: ['$batch.expiryDate', now] }, { $lte: ['$batch.expiryDate', new Date(now.getTime() + 90 * 86400000)] }] }, 1, 0] } }, expiredBatches: { $sum: { $cond: [{ $lte: ['$batch.expiryDate', now] }, 1, 0] } } } }]),
    Reservation.aggregate([{ $match: reservationMatch(input, period, pharmacyId) }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Reservation.aggregate([{ $match: reservationMatch(input, period, pharmacyId) }, { $group: { _id: { medicine: '$medicineId', customer: '$customerId' }, requests: { $sum: 1 }, requestedUnits: { $sum: '$quantity' } } }, { $group: { _id: '$_id.medicine', requests: { $sum: '$requests' }, requestedUnits: { $sum: '$requestedUnits' }, uniqueCustomers: { $sum: 1 } } }, { $match: { uniqueCustomers: { $gte: 5 } } }, { $sort: { requests: -1, _id: 1 } }, { $limit: 10 }, { $lookup: { from: Medicine.collection.name, localField: '_id', foreignField: '_id', as: 'medicine' } }, { $unwind: '$medicine' }, { $project: { _id: 0, medicineId: '$_id', name: '$medicine.name', strength: '$medicine.strength', dosageForm: '$medicine.dosageForm', packSize: '$medicine.packSize', requests: 1, requestedUnits: 1 } }]),
  ]);
  await recordAudit({ actorId: req.auth!.id, action: 'report.pharmacy.viewed', resourceType: 'Pharmacy', resourceId: pharmacyId, pharmacyId, metadata: { from: period.from, to: period.to, medicineId: input.medicineId, status: input.status }, ipAddress: req.ip });
  const totalRequests = statuses.reduce((sum, row) => sum + Number(row.count), 0); const collectedRequests = statuses.find((row) => row._id === 'COLLECTED')?.count ?? 0;
  res.json({ success: true, data: { completion: input.status ? null : { collected: collectedRequests, total: totalRequests, percent: totalRequests ? Math.round(collectedRequests * 1000 / totalRequests) / 10 : null }, pharmacy: { id: pharmacyId, name: pharmacy.name, city: pharmacy.city, isDemo: pharmacy.isDemo }, period: { from: period.from, to: period.to, timezone: 'UTC' }, stock: stock[0] || { items: 0, availableUnits: 0, lowStockItems: 0, unavailableItems: 0 }, expiry: expiry[0] || { expiringWithin90Days: 0, expiredBatches: 0 }, reservationStatuses: statuses, demand, note: 'Stock and expiry are current snapshots. Reservation counts use request creation dates and current statuses. Demand is requests, not sales; groups with fewer than five distinct requesters are hidden.' } });
}));

analyticsRouter.get('/pharmacy/inventory', asyncHandler(async (req, res) => {
  const input = common.extend({ lowStock: z.enum(['true', 'false']).default('false') }).parse(req.query); if (input.format) { input.page = 1; input.limit = 25001; } const pharmacy = await pharmacyAccess(req.auth!, input.pharmacyId); const now = new Date();
  const pipeline: PipelineStage[] = [...inventoryBase(pharmacy.id, input.medicineId, now), ...(input.lowStock === 'true' ? [{ $match: { $expr: { $lte: ['$availableQuantity', { $ifNull: ['$minStock', 0] }] } } } as PipelineStage] : []), { $lookup: { from: Medicine.collection.name, localField: 'medicineId', foreignField: '_id', as: 'medicine' } }, { $unwind: { path: '$medicine', preserveNullAndEmptyArrays: true } }, { $sort: { 'medicine.name': 1, _id: 1 } }, { $project: { _id: 1, name: '$medicine.name', strength: '$medicine.strength', dosageForm: '$medicine.dosageForm', packSize: '$medicine.packSize', availableQuantity: 1, minStock: 1, stockStatus: 1, lastUpdatedAt: 1 } }, pageFacet(input.page, input.limit)];
  const rows = await Inventory.aggregate(pipeline); if (input.format) { await exportReport(res, { format: input.format, section: 'inventory', pharmacyId: pharmacy.id, actorId: req.auth!.id, isDemo: Boolean(pharmacy.isDemo), items: unpack(rows, input).items, total: unpack(rows, input).total, filters: input, ipAddress: req.ip }); return; } res.json({ success: true, data: { ...unpack(rows, input), snapshotAt: now } });
}));

analyticsRouter.get('/pharmacy/batches', asyncHandler(async (req, res) => {
  const input = common.extend({ kind: z.enum(['all', 'expiring', 'expired']).default('all'), days: z.coerce.number().int().min(1).max(365).default(90) }).parse(req.query); if (input.format) { input.page = 1; input.limit = 25001; } const pharmacy = await pharmacyAccess(req.auth!, input.pharmacyId); const now = new Date();
  const batchFilter: Record<string, unknown> = input.kind === 'expiring' ? { active: true, expiryDate: { $gt: now, $lte: new Date(now.getTime() + input.days * 86400000) } } : input.kind === 'expired' ? { expiryDate: { $lte: now } } : {};
  const rows = await Inventory.aggregate([{ $match: { pharmacyId: oid(pharmacy.id), active: true, ...(input.medicineId ? { medicineId: oid(input.medicineId) } : {}) } }, { $lookup: { from: InventoryBatch.collection.name, localField: '_id', foreignField: 'inventoryId', as: 'batch' } }, { $unwind: '$batch' }, { $replaceRoot: { newRoot: { $mergeObjects: ['$batch', { medicineId: '$medicineId' }] } } }, { $match: batchFilter }, { $lookup: { from: Medicine.collection.name, localField: 'medicineId', foreignField: '_id', as: 'medicine' } }, { $unwind: { path: '$medicine', preserveNullAndEmptyArrays: true } }, { $sort: { expiryDate: 1, _id: 1 } }, { $project: { _id: 1, batchNumber: 1, expiryDate: 1, active: 1, onHandQuantity: 1, reservedQuantity: 1, name: '$medicine.name', strength: '$medicine.strength', dosageForm: '$medicine.dosageForm' } }, pageFacet(input.page, input.limit)]);
  if (input.format) { await exportReport(res, { format: input.format, section: 'batches', pharmacyId: pharmacy.id, actorId: req.auth!.id, isDemo: Boolean(pharmacy.isDemo), items: unpack(rows, input).items, total: unpack(rows, input).total, filters: input, ipAddress: req.ip }); return; } res.json({ success: true, data: { ...unpack(rows, input), kind: input.kind, snapshotAt: now } });
}));

analyticsRouter.get('/pharmacy/movements', asyncHandler(async (req, res) => {
  const input = common.parse(req.query); if (input.format) { input.page = 1; input.limit = 25001; } const period = dates(input); const pharmacy = await pharmacyAccess(req.auth!, input.pharmacyId);
  const inventoryIds = input.medicineId ? (await Inventory.find({ pharmacyId: pharmacy.id, medicineId: input.medicineId }).select('_id')).map((item) => item._id) : undefined;
  const filter = { pharmacyId: pharmacy.id, createdAt: { $gte: period.start, $lt: period.endExclusive }, ...(inventoryIds ? { inventoryId: { $in: inventoryIds } } : {}) };
  const [items, total] = await Promise.all([StockMovement.find(filter).select('inventoryId batchId type quantity createdAt').sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).populate({ path: 'inventoryId', select: 'medicineId', populate: { path: 'medicineId', select: 'name strength dosageForm' } }), StockMovement.countDocuments(filter)]);
  if (input.format) { await exportReport(res, { format: input.format, section: 'movements', pharmacyId: pharmacy.id, actorId: req.auth!.id, isDemo: Boolean(pharmacy.isDemo), items: items, total: total, filters: input, ipAddress: req.ip }); return; } res.json({ success: true, data: { items, total, page: input.page, limit: input.limit, period: { from: period.from, to: period.to, timezone: 'UTC' } } });
}));

analyticsRouter.get('/pharmacy/reservations', asyncHandler(async (req, res) => {
  const input = common.parse(req.query); if (input.format) { input.page = 1; input.limit = 25001; } const period = dates(input); const pharmacy = await pharmacyAccess(req.auth!, input.pharmacyId); const filter = reservationMatch(input, period, pharmacy.id);
  const [items, total] = await Promise.all([Reservation.find(filter).select('medicineId status quantity createdAt collectedAt').sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).populate('medicineId', 'name strength dosageForm packSize'), Reservation.countDocuments(filter)]);
  if (input.format) { await exportReport(res, { format: input.format, section: 'reservations', pharmacyId: pharmacy.id, actorId: req.auth!.id, isDemo: Boolean(pharmacy.isDemo), items: items, total: total, filters: input, ipAddress: req.ip }); return; } res.json({ success: true, data: { items, total, page: input.page, limit: input.limit, period: { from: period.from, to: period.to, timezone: 'UTC' } } });
}));

analyticsRouter.get('/admin/pharmacies', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const input = z.object({ q: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().parse(req.query);
  const expression = new RegExp(input.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const filter = { isDemo: { $ne: true }, ...(input.q ? { $or: [{ name: expression }, { pinCode: input.q }] } : {}) };
  const [pharmacies, total] = await Promise.all([Pharmacy.find(filter).select('name city pinCode').sort({ name: 1, _id: 1 }).skip((input.page - 1) * 50).limit(50).lean(), Pharmacy.countDocuments(filter)]);
  res.json({ success: true, data: { pharmacies, total, page: input.page, limit: 50 } });
}));

analyticsRouter.get('/admin/overview', requirePermission('report:read'), asyncHandler(async (req, res) => {
  const input = common.parse(req.query); const period = dates(input); const now = new Date(); const thresholds = await getFreshnessThresholds();
  const reservationPipeline: PipelineStage[] = [{ $match: { ...reservationMatch(input, period, input.pharmacyId), isDemo: { $ne: true } } }, { $lookup: { from: Pharmacy.collection.name, localField: 'pharmacyId', foreignField: '_id', as: 'pharmacy' } }, { $unwind: '$pharmacy' }, { $match: { 'pharmacy.isDemo': { $ne: true } } }, { $lookup: { from: Medicine.collection.name, localField: 'medicineId', foreignField: '_id', as: 'medicine' } }, { $unwind: '$medicine' }, { $match: { 'medicine.isDemo': { $ne: true } } }];
  const inventoryPipeline: PipelineStage[] = [{ $match: { active: true, isDemo: { $ne: true }, ...(input.pharmacyId ? { pharmacyId: oid(input.pharmacyId) } : {}), ...(input.medicineId ? { medicineId: oid(input.medicineId) } : {}) } }, { $lookup: { from: Pharmacy.collection.name, localField: 'pharmacyId', foreignField: '_id', as: 'pharmacy' } }, { $unwind: '$pharmacy' }, { $match: { 'pharmacy.isDemo': { $ne: true } } }, { $lookup: { from: Medicine.collection.name, localField: 'medicineId', foreignField: '_id', as: 'medicine' } }, { $unwind: '$medicine' }, { $match: { 'medicine.isDemo': { $ne: true } } }];
  const searchApplicable = !input.pharmacyId && !input.medicineId && !input.status;
  const searchPipeline: PipelineStage[] = [{ $match: { createdAt: { $gte: period.start, $lt: period.endExclusive } } }, { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'actor' } }, { $unwind: '$actor' }, { $match: { 'actor.isDemo': { $ne: true } } }, { $group: { _id: '$userId', searches: { $sum: 1 } } }, { $group: { _id: null, uniqueUsers: { $sum: 1 }, searches: { $sum: '$searches' } } }];
  const [pharmacyStatuses, registrations, reservationStatuses, demand, freshness, search] = await Promise.all([
    input.medicineId || input.status ? Promise.resolve(null) : Pharmacy.aggregate([{ $match: { isDemo: { $ne: true }, createdAt: { $gte: period.start, $lt: period.endExclusive }, ...(input.pharmacyId ? { _id: oid(input.pharmacyId) } : {}) } }, { $group: { _id: '$verificationStatus', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    input.pharmacyId || input.medicineId || input.status ? Promise.resolve(null) : User.countDocuments({ isDemo: { $ne: true }, createdAt: { $gte: period.start, $lt: period.endExclusive } }),
    Reservation.aggregate([...reservationPipeline, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Reservation.aggregate([...reservationPipeline, { $group: { _id: { medicine: '$medicineId', customer: '$customerId' }, name: { $first: '$medicine.name' }, strength: { $first: '$medicine.strength' }, dosageForm: { $first: '$medicine.dosageForm' }, packSize: { $first: '$medicine.packSize' }, requests: { $sum: 1 }, requestedUnits: { $sum: '$quantity' } } }, { $group: { _id: '$_id.medicine', name: { $first: '$name' }, strength: { $first: '$strength' }, dosageForm: { $first: '$dosageForm' }, packSize: { $first: '$packSize' }, requests: { $sum: '$requests' }, requestedUnits: { $sum: '$requestedUnits' }, uniqueCustomers: { $sum: 1 } } }, { $match: { uniqueCustomers: { $gte: 5 } } }, { $sort: { requests: -1, _id: 1 } }, { $limit: 10 }, { $project: { uniqueCustomers: 0 } }]),
    Inventory.aggregate([...inventoryPipeline, { $group: { _id: null, total: { $sum: 1 }, recent: { $sum: { $cond: [{ $gte: ['$lastUpdatedAt', new Date(now.getTime() - thresholds.recentMinutes * 60000)] }, 1, 0] } }, needsConfirmation: { $sum: { $cond: [{ $and: [{ $lt: ['$lastUpdatedAt', new Date(now.getTime() - thresholds.recentMinutes * 60000)] }, { $gte: ['$lastUpdatedAt', new Date(now.getTime() - thresholds.confirmMinutes * 60000)] }] }, 1, 0] } }, staleWarning: { $sum: { $cond: [{ $and: [{ $lt: ['$lastUpdatedAt', new Date(now.getTime() - thresholds.confirmMinutes * 60000)] }, { $gte: ['$lastUpdatedAt', new Date(now.getTime() - thresholds.staleMinutes * 60000)] }] }, 1, 0] } }, older: { $sum: { $cond: [{ $lt: ['$lastUpdatedAt', new Date(now.getTime() - thresholds.staleMinutes * 60000)] }, 1, 0] } } } }]),
    searchApplicable ? SearchHistory.aggregate(searchPipeline) : Promise.resolve(null),
  ]);
  const searchRow = search?.[0]; const searchActivity = !searchApplicable ? null : searchRow && searchRow.uniqueUsers >= 5 ? { searches: searchRow.searches, uniqueUsers: searchRow.uniqueUsers, suppressed: false } : { searches: null, uniqueUsers: null, suppressed: true };
  if (input.format) {
    const rows: Array<Record<string, unknown>> = [
      ...(pharmacyStatuses || []).map((row) => ({ category: 'Pharmacy registrations', name: row._id, count: row.count, note: 'Created in period, current status' })),
      ...(registrations === null ? [] : [{ category: 'User registrations', name: 'Registered users', count: registrations }]),
      ...reservationStatuses.map((row) => ({ category: 'Reservation requests', name: row._id, count: row.count, note: 'Requests are not sales' })),
      ...demand.map((row) => ({ category: 'Medicine request demand', name: [row.name, row.strength, row.dosageForm, row.packSize].filter(Boolean).join(' / '), count: row.requests, requestedUnits: row.requestedUnits, note: 'Top ten groups, at least five requesters; not sales' })),
      ...Object.entries(freshness[0] || {}).filter(([key]) => key !== '_id').map(([name, count]) => ({ category: 'Inventory freshness', name, count, note: 'Current snapshot' })),
      ...(searchActivity && !searchActivity.suppressed ? [{ category: 'Search activity', name: 'Authenticated searches', count: searchActivity.searches }, { category: 'Search activity', name: 'Distinct authenticated users', count: searchActivity.uniqueUsers }] : [{ category: 'Search activity', name: 'Unavailable', note: searchActivity?.suppressed ? 'Suppressed below five users' : 'Not attributable with filters' }]),
    ];
    await exportReport(res, { format: input.format, section: 'platform', actorId: req.auth!.id, isDemo: false, items: rows, total: rows.length, filters: input, ipAddress: req.ip }); return;
  }
  await recordAudit({ actorId: req.auth!.id, action: 'report.admin.viewed', resourceType: 'Report', metadata: { from: period.from, to: period.to, pharmacyId: input.pharmacyId, medicineId: input.medicineId, status: input.status }, ipAddress: req.ip });
  res.json({ success: true, data: { period: { from: period.from, to: period.to, timezone: 'UTC' }, pharmacyRegistrationsByCurrentStatus: pharmacyStatuses, userRegistrations: registrations, reservationStatuses, demand, inventoryFreshness: freshness[0] || { total: 0, recent: 0, needsConfirmation: 0, staleWarning: 0, older: 0 }, searchActivity, note: 'Registrations and requests use creation dates and current statuses. Inventory freshness is a current snapshot. Search activity counts authenticated search requests, including repeated/filter requests; it is not attributable to a pharmacy and is suppressed below five users. Demand is reservation requests, not sales; groups with fewer than five distinct requesters are hidden. Demo records are excluded.' } });
}));
