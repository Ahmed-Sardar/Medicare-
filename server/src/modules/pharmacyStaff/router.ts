import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AuditLog, Notification, Pharmacist, Pharmacy, PharmacyStaff, User } from '../models.js';
import { requirePermission } from '../../middleware/authorize.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';

export const pharmacyStaffRouter = Router();
pharmacyStaffRouter.use(authenticate, requirePermission('staff:manage:own'));
const identifier = z.string().regex(/^[0-9a-f]{24}$/i);
const accessInput = z.object({
  role: z.enum(['PHARMACIST', 'PHARMACY_STAFF']),
  permissions: z.array(z.enum(['inventory:read', 'inventory:update', 'reservation:read', 'report:read'])).max(4).default([]),
});
async function requireOwner(userId: string, roles: string[], pharmacyId: string): Promise<void> {
  identifier.parse(pharmacyId);
  if (!roles.includes('SUPER_ADMIN') && !await PharmacyStaff.exists({ pharmacyId, userId, role: 'PHARMACY_OWNER', active: true })) throw new ApiError(403, 'Only an assigned pharmacy owner can manage staff');
  if (!await Pharmacy.exists({ _id: pharmacyId })) throw new ApiError(404, 'Pharmacy not found');
}

pharmacyStaffRouter.get('/:pharmacyId/staff', asyncHandler(async (req, res) => {
  await requireOwner(req.auth!.id, req.auth!.roles, req.params.pharmacyId!);
  const staff = await PharmacyStaff.find({ pharmacyId: req.params.pharmacyId }).sort({ active: -1, createdAt: 1 }).populate('userId', 'name email active');
  res.json({ success: true, data: { staff } });
}));

// Assignment, navigation roles, pharmacist links, audit and notification commit together.
async function saveAccess(input: z.infer<typeof accessInput> & { email?: string; staffId?: string }, pharmacyId: string, actorId: string): Promise<string> {
  const session = await mongoose.startSession();
  let assignmentId = '';
  try {
    await session.withTransaction(async () => {
      const existing = input.staffId
        ? await PharmacyStaff.findOne({ _id: input.staffId, pharmacyId, active: true }).session(session)
        : null;
      if (input.staffId && !existing) throw new ApiError(404, 'Active staff assignment not found');
      const user = await User.findOne(existing ? { _id: existing.userId, active: true } : { email: input.email!.toLowerCase(), active: true }).session(session);
      if (!user) throw new ApiError(404, 'This person needs an active MedFind account before you can add them');
      const prior = existing || await PharmacyStaff.findOne({ pharmacyId, userId: user.id }).session(session);
      if (prior?.role === 'PHARMACY_OWNER') throw new ApiError(409, 'Owner assignments cannot be changed through staff management');
      if (!input.staffId && prior?.active) throw new ApiError(409, 'This member is already assigned. Edit their access instead.');
      const permissions = input.role === 'PHARMACIST' ? [] : [...new Set(input.permissions)];
      const assignment = await PharmacyStaff.findOneAndUpdate({ pharmacyId, userId: user.id }, {
        $set: { role: input.role, permissions, active: true, invitedBy: actorId },
      }, { new: true, upsert: true, runValidators: true, session });
      assignmentId = assignment!.id;
      await User.updateOne({ _id: user.id }, { $addToSet: { roles: input.role }, $inc: { accessRevision: 1 } }, { session });
      if (input.role === 'PHARMACIST') await Pharmacist.updateOne({ userId: user.id }, { $addToSet: { pharmacyIds: pharmacyId } }, { session });
      else await Pharmacist.updateOne({ userId: user.id }, { $pull: { pharmacyIds: pharmacyId } }, { session });
      const action = input.staffId ? 'updated' : prior ? 'reactivated' : 'added';
      await AuditLog.create([{ actorId, action: `pharmacy.staff.${action}`, resourceType: 'PharmacyStaff', resourceId: assignmentId, pharmacyId, metadata: { role: input.role, permissions } }], { session });
      await Notification.create([{ userId: user.id, type: 'PHARMACY_ASSIGNMENT_UPDATED', title: 'Pharmacy access updated', message: 'A pharmacy owner updated your team access. Open your workspace to review your assignment.', data: { pharmacyId } }], { session });
    });
  } finally { await session.endSession(); }
  return assignmentId;
}

pharmacyStaffRouter.post('/:pharmacyId/staff', asyncHandler(async (req, res) => {
  const pharmacyId = req.params.pharmacyId!;
  await requireOwner(req.auth!.id, req.auth!.roles, pharmacyId);
  const input = accessInput.extend({ email: z.string().trim().email().max(254) }).parse(req.body);
  const id = await saveAccess(input, pharmacyId, req.auth!.id);
  res.status(201).json({ success: true, data: { assignment: await PharmacyStaff.findById(id).populate('userId', 'name email active') } });
}));

pharmacyStaffRouter.patch('/:pharmacyId/staff/:staffId', asyncHandler(async (req, res) => {
  const pharmacyId = req.params.pharmacyId!;
  await requireOwner(req.auth!.id, req.auth!.roles, pharmacyId);
  const input = accessInput.parse(req.body);
  const id = await saveAccess({ ...input, staffId: identifier.parse(req.params.staffId) }, pharmacyId, req.auth!.id);
  res.json({ success: true, data: { assignment: await PharmacyStaff.findById(id).populate('userId', 'name email active') } });
}));

pharmacyStaffRouter.delete('/:pharmacyId/staff/:staffId', asyncHandler(async (req, res) => {
  const pharmacyId = req.params.pharmacyId!;
  await requireOwner(req.auth!.id, req.auth!.roles, pharmacyId);
  const staffId = identifier.parse(req.params.staffId);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const assignment = await PharmacyStaff.findOne({ _id: staffId, pharmacyId }).session(session);
      if (!assignment) throw new ApiError(404, 'Staff assignment not found');
      if (assignment.role === 'PHARMACY_OWNER') throw new ApiError(409, 'Owner assignments cannot be revoked through staff management');
      if (!assignment.active) return;
      assignment.active = false; await assignment.save({ session });
      await Pharmacist.updateOne({ userId: assignment.userId }, { $pull: { pharmacyIds: pharmacyId } }, { session });
      await AuditLog.create([{ actorId: req.auth!.id, action: 'pharmacy.staff.revoked', resourceType: 'PharmacyStaff', resourceId: staffId, pharmacyId }], { session });
      await Notification.create([{ userId: assignment.userId, type: 'PHARMACY_ASSIGNMENT_REVOKED', title: 'Pharmacy access removed', message: 'Your assignment to a pharmacy has been removed. Contact its owner if you need access again.', data: { pharmacyId } }], { session });
    });
  } finally { await session.endSession(); }
  res.json({ success: true, data: { revoked: true } });
}));
