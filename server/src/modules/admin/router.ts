import { Router } from 'express';
import { z } from 'zod';
import { AuditLog, Inventory, Medicine, Notification, Pharmacy, PharmacyStaff, Reservation, SystemSetting, User } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.js';
import { streamPrivateDocument, privateDocumentExists } from '../../services/privateStorage.js';
import { assertAccessAdministrator, lockAccessAdministration } from '../../services/accessAdministration.js';
import { updateUserAccess } from '../../services/accessAdministration.js';
import { permissionAllows } from '../../services/rbacCatalog.js';
import { getFreshnessThresholds, getReservationSettings, invalidateSettingsCache, invalidateReservationSettingsCache } from '../../services/settings.js';

export const adminRouter = Router(); adminRouter.use(authenticate);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
adminRouter.get('/settings', requirePermission('settings:read'), asyncHandler(async (_req, res) => { const [freshness, reservations] = await Promise.all([getFreshnessThresholds(), getReservationSettings()]); res.json({ success: true, data: { inventoryFreshness: freshness, reservations } }); }));
adminRouter.patch('/settings', requirePermission('settings:manage'), asyncHandler(async (req, res) => {
  const input = z.object({ inventoryFreshness: z.object({ recentMinutes: z.number().int().min(1).max(1440), confirmMinutes: z.number().int().min(1).max(10080), staleMinutes: z.number().int().min(1).max(43200) }), reservations: z.object({ holdMinutes: z.number().int().min(1).max(1440), pickupDeadlineHours: z.number().int().min(1).max(168) }) }).parse(req.body);
  if (!(input.inventoryFreshness.recentMinutes <= input.inventoryFreshness.confirmMinutes && input.inventoryFreshness.confirmMinutes <= input.inventoryFreshness.staleMinutes)) throw new ApiError(400, 'Freshness thresholds must increase from recent to stale');
  await SystemSetting.bulkWrite([{ updateOne: { filter: { key: 'inventoryFreshness' }, update: { $set: { key: 'inventoryFreshness', value: input.inventoryFreshness, updatedBy: req.auth!.id } }, upsert: true } }, { updateOne: { filter: { key: 'reservationOperations' }, update: { $set: { key: 'reservationOperations', value: input.reservations, updatedBy: req.auth!.id } }, upsert: true } }]);
  invalidateSettingsCache(); invalidateReservationSettingsCache(); await recordAudit({ actorId: req.auth!.id, action: 'settings.updated', resourceType: 'SystemSetting', metadata: { settings: ['inventoryFreshness', 'reservationOperations'] }, ipAddress: req.ip }); res.json({ success: true, data: input });
}));
adminRouter.get('/overview', requirePermission('report:read'), asyncHandler(async (_req, res) => {
  const [users, customers, pharmacies, verified, pending, active, medicines, reservations, recentActivity] = await Promise.all([
    User.countDocuments(), User.countDocuments({ roles: 'CUSTOMER' }), Pharmacy.countDocuments(), Pharmacy.countDocuments({ verificationStatus: 'APPROVED' }), Pharmacy.countDocuments({ verificationStatus: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } }), Pharmacy.countDocuments({ active: true }), Medicine.countDocuments({ active: true }), Reservation.countDocuments(), Inventory.countDocuments({ updatedAt: { $gte: new Date(Date.now() - 86400000) } }),
  ]);
  const completedReservations = await Reservation.countDocuments({ status: 'COLLECTED' }); res.json({ success: true, data: { users, customers, pharmacies, verifiedPharmacies: verified, pendingApprovals: pending, activePharmacies: active, medicines, reservations, completedReservations, inventoryUpdatesLast24h: recentActivity } });
}));
adminRouter.get('/pharmacies', requirePermission('pharmacy:review'), asyncHandler(async (req, res) => {
  const { status, q, page, limit } = z.object({ status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(), q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict().parse(req.query);
  const filter: Record<string, unknown> = {}; if (status) filter.verificationStatus = status; if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { pinCode: q }];
  const [pharmacies, total] = await Promise.all([Pharmacy.find(filter).select('-licenseDocumentPath').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate('ownerId', 'name email phone'), Pharmacy.countDocuments(filter)]); res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { pharmacies, total, page, limit } });
}));
adminRouter.get('/pharmacies/:id/license-document', requirePermission('pharmacy:review'), asyncHandler(async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.params.id).select('+licenseDocumentPath licenseDocumentOriginalName'); if (!pharmacy?.licenseDocumentPath) throw new ApiError(404, 'Licence document not found');
  await streamPrivateDocument(res, pharmacy.licenseDocumentPath, 'pharmacy-licence');
}));
adminRouter.patch('/pharmacies/:id/verification', requirePermission('pharmacy:review'), asyncHandler(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.params.id);
  const input = z.object({ status: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']), revision: z.number().int().nonnegative(), reason: z.string().trim().min(5).max(1000) }).strict().parse(req.body);
  const session = await Pharmacy.startSession();
  try { await session.withTransaction(async () => {
    await lockAccessAdministration(session); await assertAccessAdministrator(req.auth!.id, 'pharmacy:review', session);
    const pharmacy = await Pharmacy.findById(id).select('+licenseDocumentPath').session(session); if (!pharmacy) throw new ApiError(404, 'Pharmacy not found');
    if ((pharmacy.revision ?? 0) !== input.revision) throw new ApiError(409, 'Pharmacy changed; reload before reviewing', 'PHARMACY_CONFLICT');
    if (String(pharmacy.ownerId) === req.auth!.id) throw new ApiError(403, 'Another administrator must review your pharmacy');
    const transitions: Record<string, string[]> = { DRAFT: ['SUSPENDED'], SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'], UNDER_REVIEW: ['APPROVED', 'REJECTED', 'SUSPENDED'], APPROVED: ['SUSPENDED'], REJECTED: ['UNDER_REVIEW', 'SUSPENDED'], SUSPENDED: ['UNDER_REVIEW', 'APPROVED'] };
    if (!transitions[pharmacy.verificationStatus]?.includes(input.status)) throw new ApiError(409, 'This review transition is not allowed');
    if (input.status === 'APPROVED' && (!pharmacy.licenseNumber || !pharmacy.licenseDocumentPath || !await privateDocumentExists(pharmacy.licenseDocumentPath))) throw new ApiError(409, 'Approval requires licence details and an available private licence document');
    pharmacy.verificationStatus = input.status; pharmacy.active = input.status === 'APPROVED'; pharmacy.revision = input.revision + 1;
    pharmacy.verificationHistory.push({ status: input.status, reason: input.reason, actorId: req.auth!.id, at: new Date() } as never); await pharmacy.save({ session });
    await AuditLog.create([{ actorId: req.auth!.id, action: `pharmacy.${input.status.toLowerCase()}`, resourceType: 'Pharmacy', resourceId: id, pharmacyId: id, metadata: { reason: input.reason }, ipAddress: req.ip }], { session });
    await Notification.create([{ userId: pharmacy.ownerId, type: `PHARMACY_${input.status}`, title: 'Pharmacy application updated', message: `Your pharmacy application is ${input.status.toLowerCase().replaceAll('_', ' ')}. Open your workspace to review its status.`, data: { pharmacyId: id } }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { pharmacy: await Pharmacy.findById(id) } });
}));
adminRouter.get('/users', requirePermission('user:read'), asyncHandler(async (req, res) => {
  const input = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const filter = input.q ? { $or: [{ email: new RegExp(escapeRegex(input.q), 'i') }, { name: new RegExp(escapeRegex(input.q), 'i') }] } : {};
  const [users, total] = await Promise.all([User.find(filter).select('name email phone roles active createdAt accessRevision isDemo').sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit), User.countDocuments(filter)]);
  res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { users, total, page: input.page, limit: input.limit } });
}));
adminRouter.get('/users/:id', requirePermission('user:read'), asyncHandler(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.params.id);
  const user = await User.findById(id).select('name email phone roles active emailVerifiedAt createdAt updatedAt accessRevision isDemo').lean();
  if (!user) throw new ApiError(404, 'User not found');
  const input = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) }).strict().parse(req.query);
  const canViewAssignments = permissionAllows(req.auth!.permissions, 'pharmacy:review') || permissionAllows(req.auth!.permissions, 'pharmacy:manage');
  const assignments = canViewAssignments ? await PharmacyStaff.find({ userId: id }).select('pharmacyId role permissions active createdAt').populate('pharmacyId', 'name city verificationStatus isDemo').sort({ active: -1, createdAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean() : null;
  const assignmentTotal = canViewAssignments ? await PharmacyStaff.countDocuments({ userId: id }) : null;
  await recordAudit({ actorId: req.auth!.id, action: 'user.profile.viewed', resourceType: 'User', resourceId: id, ipAddress: req.ip });
  res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { user: { ...user, accessRevision: user.accessRevision ?? 0 }, assignments, assignmentTotal, page: input.page, limit: input.limit } });
}));
adminRouter.patch('/users/:id/active', requirePermission('user:manage'), asyncHandler(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.params.id);
  const input = z.object({ active: z.boolean(), revision: z.number().int().nonnegative(), reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
  res.json({ success: true, data: { user: await updateUserAccess(req.auth!, id, input, req.ip) } });
}));
adminRouter.get('/reservations', requirePermission('reservation:read:any'), asyncHandler(async (_req, res) => { const reservations = await Reservation.find().sort({ createdAt: -1 }).limit(100).populate('medicineId pharmacyId customerId', 'name email'); res.json({ success: true, data: { reservations } }); }));
