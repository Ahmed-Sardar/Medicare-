import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AuditLog, Notification, Pharmacist, PharmacyStaff } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { storePrivateDocument, removePrivateDocument, streamPrivateDocument, privateDocumentExists } from '../../services/privateStorage.js';

export const pharmacistsRouter = Router();
pharmacistsRouter.use(authenticate);
const extensions: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const privateRoot = path.resolve(env.UPLOAD_DIR, 'private', 'pharmacists');
const upload = multer({ storage: multer.diskStorage({ destination: async (_req, _file, callback) => { try { await mkdir(privateRoot, { recursive: true }); callback(null, privateRoot); } catch (error) { callback(error as Error, privateRoot); } }, filename: (_req, file, callback) => callback(null, `${randomUUID()}${extensions[file.mimetype] || '.bin'}`) }), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => callback(extensions[file.mimetype] ? null : new ApiError(400, 'Only PDF, JPEG and PNG documents are accepted'), Boolean(extensions[file.mimetype])) });
function revisionFilter(revision: number): Record<string, unknown> { return revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision }; }
async function removeEvidence(value?: string | null): Promise<void> { await removePrivateDocument(value).catch(() => undefined); }
function requirePharmacist(roles: string[]): void { if (!roles.includes('PHARMACIST')) throw new ApiError(403, 'An assigned pharmacist account is required'); }
async function streamEvidence(res: import('express').Response, filename: string): Promise<void> { await streamPrivateDocument(res, filename, 'pharmacist-evidence'); }

pharmacistsRouter.post('/application', asyncHandler(async (req, res) => {
  requirePharmacist(req.auth!.roles);
  const input = z.object({ registrationNumber: z.string().trim().min(3).max(100), council: z.string().trim().min(3).max(160), pharmacyIds: z.array(z.string().regex(/^[0-9a-f]{24}$/i)).max(100).default([]) }).parse(req.body);
  const assigned = await PharmacyStaff.find({ userId: req.auth!.id, role: 'PHARMACIST', active: true }).select('pharmacyId');
  const assignedIds = assigned.map((row) => String(row.pharmacyId));
  if (!assignedIds.length) throw new ApiError(403, 'An active pharmacist assignment is required');
  if (input.pharmacyIds.some((id) => !assignedIds.includes(id))) throw new ApiError(403, 'You may only apply against an assigned pharmacy');
  const pharmacyIds = input.pharmacyIds.length ? [...new Set(input.pharmacyIds)] : assignedIds;
  const existing = await Pharmacist.findOne({ userId: req.auth!.id }).select('+evidenceDocumentPath');
  let id = ''; let previousFile: string | undefined;
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    const history = { status: 'PENDING', action: 'APPLICATION_SUBMITTED', actorId: req.auth!.id, at: new Date() };
    if (existing) {
      const revision = existing.revision ?? 0;
      const updated = await Pharmacist.findOneAndUpdate({ _id: existing.id, ...revisionFilter(revision) }, { $set: { registrationNumber: input.registrationNumber, council: input.council, pharmacyIds, verificationStatus: 'PENDING' }, $unset: { evidenceDocumentPath: 1, evidenceOriginalName: 1, evidenceUploadedAt: 1, reviewReason: 1, reviewedAt: 1, reviewedBy: 1 }, $inc: { revision: 1 }, $push: { verificationHistory: history } }, { new: true, runValidators: true, session });
      if (!updated) throw new ApiError(409, 'Application changed; reload before submitting again');
      id = updated.id; previousFile = existing.evidenceDocumentPath ?? undefined;
    } else {
      const [created] = await Pharmacist.create([{ userId: req.auth!.id, registrationNumber: input.registrationNumber, council: input.council, pharmacyIds, verificationStatus: 'PENDING', revision: 1, verificationHistory: [history] }], { session });
      id = created!.id;
    }
    await AuditLog.create([{ actorId: req.auth!.id, action: 'pharmacist.application_submitted', resourceType: 'Pharmacist', resourceId: id, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  await removeEvidence(previousFile);
  res.status(202).json({ success: true, data: { profile: await Pharmacist.findById(id).populate('pharmacyIds', 'name city') } });
}));

pharmacistsRouter.get('/me', asyncHandler(async (req, res) => {
  requirePharmacist(req.auth!.roles);
  const profile = await Pharmacist.findOne({ userId: req.auth!.id }).populate('pharmacyIds', 'name city');
  res.json({ success: true, data: { profile } });
}));
pharmacistsRouter.get('/me/evidence', asyncHandler(async (req, res) => {
  requirePharmacist(req.auth!.roles);
  const profile = await Pharmacist.findOne({ userId: req.auth!.id }).select('+evidenceDocumentPath');
  if (!profile?.evidenceDocumentPath) throw new ApiError(404, 'Evidence document not found');
  await streamEvidence(res, profile.evidenceDocumentPath);
}));
pharmacistsRouter.post('/me/evidence', asyncHandler(async (req, res, next) => {
  requirePharmacist(req.auth!.roles);
  const profile = await Pharmacist.findOne({ userId: req.auth!.id });
  if (!profile) throw new ApiError(409, 'Submit your registration details first');
  if (profile.verificationStatus === 'VERIFIED') throw new ApiError(409, 'Submit an updated application before replacing verified evidence');
  res.locals.evidenceRevision = profile.revision ?? 0;
  next();
}), upload.single('document'), asyncHandler(async (req, res) => {
  const file = req.file; if (!file) throw new ApiError(400, 'A PDF, JPEG or PNG document is required');
  let saved = false; let previousFile: string | undefined; let profileId = ''; let reference = file.path;
  try {
    const bytes = await readFile(file.path);
    const valid = file.mimetype === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : file.mimetype === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid) throw new ApiError(400, 'Uploaded content does not match its file type');
    reference = await storePrivateDocument(file.path, file.mimetype, 'pharmacists');
    const session = await mongoose.startSession();
    try { await session.withTransaction(async () => {
      const old = await Pharmacist.findOne({ userId: req.auth!.id, verificationStatus: { $in: ['PENDING', 'REJECTED'] }, ...revisionFilter(res.locals.evidenceRevision as number) }).select('+evidenceDocumentPath').session(session);
      if (!old) throw new ApiError(409, 'Application changed during upload; reload and try again');
      const updated = await Pharmacist.findOneAndUpdate({ _id: old.id, verificationStatus: { $in: ['PENDING', 'REJECTED'] }, ...revisionFilter(res.locals.evidenceRevision as number) }, { $set: { evidenceDocumentPath: reference, evidenceOriginalName: path.basename(file.originalname).slice(0, 160), evidenceUploadedAt: new Date(), verificationStatus: 'PENDING' }, $unset: { reviewReason: 1, reviewedAt: 1, reviewedBy: 1 }, $inc: { revision: 1 }, $push: { verificationHistory: { status: 'PENDING', action: 'EVIDENCE_UPLOADED', actorId: req.auth!.id, at: new Date() } } }, { new: true, session });
      if (!updated) throw new ApiError(409, 'Application changed during upload; reload and try again');
      profileId = updated.id; previousFile = old.evidenceDocumentPath ?? undefined;
      await AuditLog.create([{ actorId: req.auth!.id, action: 'pharmacist.evidence_uploaded', resourceType: 'Pharmacist', resourceId: profileId, ipAddress: req.ip }], { session });
    }); saved = true; } finally { await session.endSession(); }
    await removeEvidence(previousFile);
    res.status(201).json({ success: true, data: { profile: await Pharmacist.findById(profileId).populate('pharmacyIds', 'name city') } });
  } finally { if (!saved) await removeEvidence(reference); }
}));

pharmacistsRouter.get('/', requirePermission('pharmacist:review'), asyncHandler(async (req, res) => {
  const status = req.query.status === undefined ? undefined : z.enum(['PENDING', 'VERIFIED', 'REJECTED']).parse(req.query.status);
  const profiles = await Pharmacist.find(status ? { verificationStatus: status } : {}).populate('userId', 'name email').populate('pharmacyIds', 'name city').sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: { profiles } });
}));
pharmacistsRouter.get('/:id/evidence', requirePermission('pharmacist:review'), asyncHandler(async (req, res) => {
  const profile = await Pharmacist.findById(req.params.id).select('+evidenceDocumentPath');
  if (!profile?.evidenceDocumentPath) throw new ApiError(404, 'Evidence document not found');
  await streamEvidence(res, profile.evidenceDocumentPath);
}));
pharmacistsRouter.patch('/:id/verification', requirePermission('pharmacist:review'), asyncHandler(async (req, res) => {
  const input = z.object({ status: z.enum(['VERIFIED', 'REJECTED', 'PENDING']), revision: z.number().int().min(0), reason: z.string().trim().max(1000).optional() }).parse(req.body);
  if (input.status === 'REJECTED' && !input.reason) throw new ApiError(400, 'A reason is required when rejecting or revoking verification');
  const session = await mongoose.startSession(); let profileId = '';
  try { await session.withTransaction(async () => {
    const profile = await Pharmacist.findOne({ _id: req.params.id, ...revisionFilter(input.revision) }).select('+evidenceDocumentPath').session(session);
    if (!profile) throw new ApiError(409, 'Application changed or no longer exists; reload before reviewing');
    if (String(profile.userId) === req.auth!.id) throw new ApiError(403, 'Administrators cannot review their own pharmacist application');
    if (profile.verificationStatus === input.status) throw new ApiError(409, 'Application already has this status');
    if (input.status === 'VERIFIED' && (profile.verificationStatus !== 'PENDING' || !profile.registrationNumber || !profile.council || !profile.evidenceDocumentPath || !profile.evidenceOriginalName || !profile.evidenceUploadedAt)) throw new ApiError(409, 'A pending application with registration details and evidence is required');
    if (input.status === 'VERIFIED' && !await privateDocumentExists(profile.evidenceDocumentPath!)) throw new ApiError(409, 'The private evidence file is unavailable; request a new upload');
    const updated = await Pharmacist.findOneAndUpdate({ _id: profile.id, verificationStatus: profile.verificationStatus, ...revisionFilter(input.revision) }, { $set: { verificationStatus: input.status, reviewedAt: new Date(), reviewedBy: req.auth!.id, reviewReason: input.reason || '' }, $inc: { revision: 1 }, $push: { verificationHistory: { status: input.status, action: 'ADMIN_REVIEW', actorId: req.auth!.id, reason: input.reason, at: new Date() } } }, { new: true, session });
    if (!updated) throw new ApiError(409, 'Application changed; reload before reviewing');
    profileId = updated.id;
    await AuditLog.create([{ actorId: req.auth!.id, action: `pharmacist.${input.status.toLowerCase()}`, resourceType: 'Pharmacist', resourceId: profileId, metadata: { reason: input.reason }, ipAddress: req.ip }], { session });
    await Notification.create([{ userId: profile.userId, type: `PHARMACIST_${input.status}`, title: 'Pharmacist verification updated', message: input.reason || `Your pharmacist application is now ${input.status.toLowerCase()}.`, data: { profileId } }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { profile: await Pharmacist.findById(profileId).populate('userId', 'name email').populate('pharmacyIds', 'name city') } });
}));
