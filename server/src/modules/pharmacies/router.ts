import { Router } from 'express';
import multer from 'multer';
import { mkdir } from 'node:fs/promises';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { AuditLog, Pharmacist, Pharmacy, PharmacyStaff, User } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { allowsPharmacyAction, type PharmacyAction } from '../../services/pharmacyAuthorization.js';
import { permissionAllows } from '../../services/rbacCatalog.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.js';
import { env } from '../../config/env.js';
import { storePrivateDocument, removePrivateDocument } from '../../services/privateStorage.js';
import { weeklyHours, holidayHours } from '../../services/openingHours.js';

export const pharmaciesRouter = Router();
const allowedMime: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const upload = multer({ storage: multer.diskStorage({ destination: async (_req, _file, callback) => { try { const destination = path.resolve(env.UPLOAD_DIR, 'private'); await mkdir(destination, { recursive: true }); callback(null, destination); } catch (error) { callback(error as Error, env.UPLOAD_DIR); } }, filename: (_req, file, callback) => callback(null, `${randomUUID()}${allowedMime[file.mimetype] || '.bin'}`) }), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => callback(allowedMime[file.mimetype] ? null : new ApiError(400, 'Only PDF, JPEG and PNG documents are accepted', 'INVALID_UPLOAD'), Boolean(allowedMime[file.mimetype])) });
const coord = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const pharmacyInput = z.object({ name: z.string().min(2).max(160), address: z.string().min(5).max(500), pinCode: z.string().regex(/^[0-9]{6}$/), city: z.string().min(2), state: z.string().min(2), coordinates: coord, phone: z.string().optional(), email: z.string().email().optional(), licenseNumber: z.string().min(3), registeredPharmacistName: z.string().min(2), openingHours: z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string(), close: z.string(), closed: z.boolean().default(false) })).max(7) });

pharmaciesRouter.post('/', authenticate, requirePermission('pharmacy:manage:own'), asyncHandler(async (req, res) => {
  const input = pharmacyInput.parse(req.body); const { coordinates, ...rest } = input;
  const session = await Pharmacy.startSession(); let pharmacyId = '';
  try { await session.withTransaction(async () => {
    const owner = await User.updateOne({ _id: req.auth!.id, active: true }, { $addToSet: { roles: 'PHARMACY_OWNER' }, $inc: { accessRevision: 1 } }, { session });
    if (!owner.matchedCount) throw new ApiError(401, 'Account is unavailable');
    const [pharmacy] = await Pharmacy.create([{ ...rest, ownerId: req.auth!.id, location: { type: 'Point', coordinates }, verificationStatus: 'DRAFT', verificationHistory: [{ status: 'DRAFT', actorId: req.auth!.id }] }], { session });
    pharmacyId = pharmacy!.id;
    await PharmacyStaff.create([{ pharmacyId, userId: req.auth!.id, role: 'PHARMACY_OWNER', permissions: ['*'] }], { session });
    await AuditLog.create([{ actorId: req.auth!.id, action: 'pharmacy.created', resourceType: 'Pharmacy', resourceId: pharmacyId, pharmacyId, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.status(201).json({ success: true, data: { pharmacy: await Pharmacy.findById(pharmacyId) } });
}));

pharmaciesRouter.get('/mine', authenticate, asyncHandler(async (req, res) => {
  const assignments = await PharmacyStaff.find({ userId: req.auth!.id, active: true }).select('pharmacyId role permissions');
  const ids = assignments.map((a) => a.pharmacyId); const pharmacies = await Pharmacy.find({ _id: { $in: ids } }).select('-licenseDocumentPath');
  const profile = await Pharmacist.findOne({ userId: req.auth!.id, verificationStatus: 'VERIFIED', evidenceDocumentPath: { $type: 'string' }, evidenceUploadedAt: { $type: 'date' } }).select('pharmacyIds');
  const memberships = assignments.map((assignment) => {
    const verified = Boolean(profile?.pharmacyIds.some((id) => String(id) === String(assignment.pharmacyId)));
    const can = (action: PharmacyAction) => allowsPharmacyAction(req.auth!, assignment, verified, action);
    const manageProfile = can('pharmacy:manage'); const readInventory = can('inventory:read'); const updateInventory = can('inventory:update');
    const readReservations = can('reservation:read'); const manageReservations = can('reservation:manage'); const readReports = can('report:read');
    return { ...assignment.toObject(), capabilities: { manageProfile: manageProfile && assignment.role === 'PHARMACY_OWNER' && permissionAllows(req.auth!.permissions, 'pharmacy:manage:own'), readInventory, updateInventory, readReservations, manageReservations, readReports } };
  });
  res.json({ success: true, data: { pharmacies, assignments: memberships } });
}));

pharmaciesRouter.patch('/:id/opening-hours', authenticate, requirePermission('pharmacy:manage:own'), asyncHandler(async (req, res) => {
  const owner = await PharmacyStaff.exists({ pharmacyId: req.params.id, userId: req.auth!.id, role: 'PHARMACY_OWNER', active: true }); if (!owner) throw new ApiError(403, 'Only an assigned pharmacy owner can manage hours');
  const input = z.object({ openingHours: weeklyHours, holidayHours: holidayHours.default([]), quantityDisplay: z.enum(['EXACT', 'RANGE']).default('RANGE'), quantityCap: z.number().int().min(1).max(1000).default(10), phone: z.string().regex(/^\+?[0-9]{10,15}$/).optional(), email: z.string().email().optional() }).strict().parse(req.body);
  const pharmacy = await Pharmacy.findByIdAndUpdate(req.params.id, { $set: input, $inc: { revision: 1 } }, { new: true, runValidators: true }).select('-licenseDocumentPath'); if (!pharmacy) throw new ApiError(404, 'Pharmacy not found');
  await recordAudit({ actorId: req.auth!.id, action: 'pharmacy.hours.updated', resourceType: 'Pharmacy', resourceId: pharmacy.id, pharmacyId: pharmacy.id, ipAddress: req.ip }); res.json({ success: true, data: { pharmacy } });
}));

pharmaciesRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.params.id).select('-licenseDocumentPath'); if (!pharmacy) throw new ApiError(404, 'Pharmacy not found');
  if (permissionAllows(req.auth!.permissions, 'pharmacy:manage') || permissionAllows(req.auth!.permissions, 'pharmacy:review')) { const output = pharmacy.toObject(); if (output.isDemo) output.phone = undefined; return res.json({ success: true, data: { pharmacy: output } }); }
  const assigned = await PharmacyStaff.exists({ pharmacyId: pharmacy.id, userId: req.auth!.id, active: true }); if (!assigned && (pharmacy.verificationStatus !== 'APPROVED' || !pharmacy.active || pharmacy.isDemo && !env.ALLOW_DEMO_DISCOVERY)) throw new ApiError(404, 'Pharmacy not found');
  if (!assigned) return res.json({ success: true, data: { pharmacy: { _id: pharmacy.id, name: pharmacy.name, address: pharmacy.address, pinCode: pharmacy.pinCode, city: pharmacy.city, state: pharmacy.state, location: pharmacy.location, openingHours: pharmacy.openingHours, holidayHours: pharmacy.holidayHours, verificationStatus: pharmacy.verificationStatus, isDemo: pharmacy.isDemo, phone: pharmacy.isDemo ? undefined : pharmacy.phone } } });
  const output = pharmacy.toObject(); if (output.isDemo) output.phone = undefined; res.json({ success: true, data: { pharmacy: output } });
}));

pharmaciesRouter.patch('/:id/submit', authenticate, requirePermission('pharmacy:manage:own'), asyncHandler(async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.params.id).select('+licenseDocumentPath'); if (!pharmacy) throw new ApiError(404, 'Pharmacy not found');
  const assigned = await PharmacyStaff.exists({ pharmacyId: pharmacy.id, userId: req.auth!.id, role: 'PHARMACY_OWNER', active: true }); if (!assigned) throw new ApiError(403, 'Only an assigned owner may submit this pharmacy');
  if (!['DRAFT', 'REJECTED'].includes(pharmacy.verificationStatus)) throw new ApiError(409, 'This application cannot be submitted in its current state');
  if (!pharmacy.licenseDocumentPath) throw new ApiError(409, 'Upload a pharmacy licence document before submitting');
  const revisionMatch = (pharmacy.revision ?? 0) === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision: pharmacy.revision };
  const submitted = await Pharmacy.findOneAndUpdate({ _id: pharmacy.id, ...revisionMatch, verificationStatus: { $in: ['DRAFT', 'REJECTED'] } }, { $set: { verificationStatus: 'SUBMITTED' }, $inc: { revision: 1 }, $push: { verificationHistory: { status: 'SUBMITTED', actorId: req.auth!.id, at: new Date() } } });
  if (!submitted) throw new ApiError(409, 'Pharmacy changed; reload before submitting');
  await recordAudit({ actorId: req.auth!.id, action: 'pharmacy.submitted', resourceType: 'Pharmacy', resourceId: pharmacy.id, pharmacyId: pharmacy.id, ipAddress: req.ip });
  res.json({ success: true, data: { pharmacy: await Pharmacy.findById(pharmacy.id) } });
}));

pharmaciesRouter.post('/:id/license-document', authenticate, requirePermission('pharmacy:manage:own'), asyncHandler(async (req, _res, next) => { const assignedOwner = await PharmacyStaff.exists({ pharmacyId: req.params.id, userId: req.auth!.id, role: 'PHARMACY_OWNER', active: true }); if (!assignedOwner) throw new ApiError(403, 'Only an assigned pharmacy owner can upload this document'); next(); }), upload.single('document'), asyncHandler(async (req, res) => {
  const pharmacy = await Pharmacy.findById(req.params.id).select('+licenseDocumentPath'); if (!pharmacy) throw new ApiError(404, 'Pharmacy not found');
  const owner = await PharmacyStaff.exists({ pharmacyId: pharmacy.id, userId: req.auth!.id, role: 'PHARMACY_OWNER', active: true }); if (!owner) throw new ApiError(403, 'Only an assigned pharmacy owner can upload this document');
  if (!req.file) throw new ApiError(400, 'A PDF, JPEG or PNG document is required');
  if (!['DRAFT', 'REJECTED'].includes(pharmacy.verificationStatus)) { await unlink(req.file.path).catch(() => undefined); throw new ApiError(409, 'Licence documents can be changed only in a draft or rejected application'); }
  const bytes = await readFile(req.file.path); const valid = req.file.mimetype === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : req.file.mimetype === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) { await unlink(req.file.path); throw new ApiError(400, 'Uploaded document content does not match its file type', 'INVALID_UPLOAD'); }
  const reference = await storePrivateDocument(req.file.path, req.file.mimetype, 'pharmacies');
  const previous = pharmacy.licenseDocumentPath;
  try {
    const revisionMatch = (pharmacy.revision ?? 0) === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision: pharmacy.revision };
    const updated = await Pharmacy.findOneAndUpdate({ _id: pharmacy.id, ...revisionMatch, verificationStatus: { $in: ['DRAFT', 'REJECTED'] } }, { $set: { licenseDocumentPath: reference, licenseDocumentOriginalName: path.basename(req.file.originalname).slice(0, 160) }, $inc: { revision: 1 } }, { new: true });
    if (!updated) throw new ApiError(409, 'Pharmacy changed during upload; reload before trying again');
    pharmacy.licenseDocumentOriginalName = updated.licenseDocumentOriginalName;
  }
  catch (error) { await removePrivateDocument(reference).catch(() => undefined); throw error; }
  if (previous && previous !== reference) await removePrivateDocument(previous).catch(() => undefined);
  await recordAudit({ actorId: req.auth!.id, action: 'pharmacy.license_document.uploaded', resourceType: 'Pharmacy', resourceId: pharmacy.id, pharmacyId: pharmacy.id, ipAddress: req.ip });
  res.status(201).json({ success: true, data: { uploaded: true, originalName: pharmacy.licenseDocumentOriginalName } });
}));

pharmaciesRouter.get('/', asyncHandler(async (req, res) => {
  const pin = typeof req.query.pinCode === 'string' ? req.query.pinCode : undefined;
  const pharmacies = await Pharmacy.find({ verificationStatus: 'APPROVED', active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }), ...(pin ? { pinCode: pin } : {}) }).select('name address pinCode city state location phone openingHours verificationStatus isDemo').limit(50);
  res.json({ success: true, data: { pharmacies: pharmacies.map((pharmacy) => { const output = pharmacy.toObject(); if (output.isDemo) output.phone = undefined; return output; }) } });
}));
