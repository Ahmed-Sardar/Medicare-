import { lockActiveAccount } from '../../services/activeAccount.js';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Inventory, InventoryBatch, Medicine, Notification, Pharmacist, Pharmacy, PharmacyStaff, Reservation, StockMovement } from '../models.js';
import { assertPharmacyAction } from '../../services/pharmacyAuthorization.js';
import { permissionAllows } from '../../services/rbacCatalog.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.js';
import { getFreshnessThresholds, getReservationSettings } from '../../services/settings.js';

export const reservationsRouter = Router(); reservationsRouter.use(authenticate);
reservationsRouter.post('/', asyncHandler(async (req, res) => {
  if (!req.auth!.roles.includes('CUSTOMER') || !permissionAllows(req.auth!.permissions, 'reservation:create')) throw new ApiError(403, 'Only customer accounts can submit reservations');
  const input = z.object({ pharmacyId: z.string(), medicineId: z.string(), quantity: z.number().int().min(1).max(100), notes: z.string().max(500).optional() }).parse(req.body);
  const idempotencyKey = req.header('Idempotency-Key')?.trim() || undefined; if (idempotencyKey && idempotencyKey.length > 100) throw new ApiError(400, 'Idempotency-Key is too long');
  if (idempotencyKey) { const prior = await Reservation.findOne({ customerId: req.auth!.id, idempotencyKey }); if (prior) return res.status(200).json({ success: true, data: { reservation: prior, idempotentReplay: true } }); }
  const pharmacy = await Pharmacy.findOne({ _id: input.pharmacyId, verificationStatus: 'APPROVED', active: true }); const medicine = await Medicine.findOne({ _id: input.medicineId, active: true });
  if (!pharmacy || !medicine) throw new ApiError(404, 'Pharmacy or medicine is not available');
  if (pharmacy.isDemo || medicine.isDemo) throw new ApiError(409, 'Demo records cannot accept reservations');
  const session = await mongoose.startSession(); let reservationId = '';
  try {
    await session.withTransaction(async () => {
      await lockActiveAccount(req.auth!.id, session);
      const inventory = await Inventory.findOne({ pharmacyId: pharmacy.id, medicineId: medicine.id, active: true, stockStatus: 'AVAILABLE' }).session(session);
      const freshnessThresholds = await getFreshnessThresholds();
      if (!inventory || Date.now() - inventory.lastUpdatedAt.getTime() > freshnessThresholds.recentMinutes * 60000) throw new ApiError(409, 'The pharmacy must update availability before accepting a reservation request');
      const batches = await InventoryBatch.find({ inventoryId: inventory.id, active: true, expiryDate: { $gt: new Date() }, $expr: { $gt: ['$onHandQuantity', '$reservedQuantity'] } }).sort({ expiryDate: 1 }).session(session);
      let left = input.quantity; const allocations: Array<{ batchId: mongoose.Types.ObjectId; quantity: number }> = [];
      for (const batch of batches) {
        if (left <= 0) break; const canAllocate = Math.min(left, batch.onHandQuantity - batch.reservedQuantity);
        const update = await InventoryBatch.updateOne({ _id: batch._id, onHandQuantity: { $gte: batch.reservedQuantity + canAllocate }, reservedQuantity: batch.reservedQuantity }, { $inc: { reservedQuantity: canAllocate } }, { session });
        if (update.modifiedCount === 1) { allocations.push({ batchId: batch._id, quantity: canAllocate }); left -= canAllocate; await StockMovement.create([{ pharmacyId: pharmacy.id, inventoryId: inventory.id, batchId: batch.id, actorId: req.auth!.id, type: 'RESERVATION_HOLD', quantity: canAllocate }], { session }); }
      }
      if (left > 0) throw new ApiError(409, 'The requested quantity is no longer available');
      const operationSettings = await getReservationSettings(); const now = new Date(); const [reservation] = await Reservation.create([{ customerId: req.auth!.id, pharmacyId: pharmacy.id, medicineId: medicine.id, quantity: input.quantity, allocatedBatches: allocations, status: 'PENDING', holdExpiresAt: new Date(now.getTime() + operationSettings.holdMinutes * 60000), notes: input.notes, idempotencyKey, history: [{ status: 'PENDING', actorId: req.auth!.id, at: now }] }], { session }); reservationId = reservation!.id;
      await Notification.create([{ userId: pharmacy.ownerId, type: 'RESERVATION_SUBMITTED', title: 'Reservation request received', message: `A customer requested ${input.quantity} unit(s) of ${medicine.name}.`, data: { reservationId } }], { session });
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000 && idempotencyKey) { const replay = await Reservation.findOne({ customerId: req.auth!.id, idempotencyKey }); if (replay) return res.status(200).json({ success: true, data: { reservation: replay, idempotentReplay: true } }); }
    throw error;
  } finally { await session.endSession(); }
  await recordAudit({ actorId: req.auth!.id, action: 'reservation.created', resourceType: 'Reservation', resourceId: reservationId, pharmacyId: input.pharmacyId });
  res.status(201).json({ success: true, data: { reservation: await Reservation.findById(reservationId).populate('medicineId', 'name strength dosageForm manufacturer packSize isDemo').populate('pharmacyId', 'name address city pinCode phone verificationStatus isDemo') } });
}));

reservationsRouter.get('/', asyncHandler(async (req, res) => {
  const { pharmacyId, page, limit, status } = z.object({ pharmacyId: z.string().regex(/^[0-9a-f]{24}$/i).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(100), status: z.enum(['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED', 'REJECTED', 'CANCELLED', 'EXPIRED']).optional() }).strict().parse(req.query);
  if (pharmacyId) await assertPharmacyAction(req.auth!, pharmacyId, 'reservation:read');
  const filter = { ...(pharmacyId ? { pharmacyId } : permissionAllows(req.auth!.permissions, 'reservation:read:any') || permissionAllows(req.auth!.permissions, 'reservation:manage:any') ? {} : { customerId: req.auth!.id }), ...(status ? { status } : {}) };
  const [reservations, total] = await Promise.all([Reservation.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate('medicineId pharmacyId customerId', 'name email phone'), Reservation.countDocuments(filter)]); res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { reservations, total, page, limit } });
}));

reservationsRouter.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status, note, reviewAttestation } = z.object({ status: z.enum(['CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED', 'REJECTED', 'CANCELLED']), note: z.string().max(500).optional(), reviewAttestation: z.object({ stockReviewed: z.literal(true), prescriptionRequirementsReviewed: z.literal(true) }).optional() }).parse(req.body);
  const session = await mongoose.startSession(); let updatedReservation: unknown; let idempotentReplay = false;
  try { await session.withTransaction(async () => {
      await lockActiveAccount(req.auth!.id, session);
    const reservation = await Reservation.findById(req.params.id).session(session); if (!reservation) throw new ApiError(404, 'Reservation not found');
    const isCustomer = String(reservation.customerId) === req.auth!.id; const staffChange = !isCustomer;
    if (staffChange) {
      await assertPharmacyAction(req.auth!, String(reservation.pharmacyId), 'reservation:manage');
      const assignment = await PharmacyStaff.findOne({ userId: req.auth!.id, pharmacyId: reservation.pharmacyId, active: true }).session(session);
      const isAdmin = permissionAllows(req.auth!.permissions, 'reservation:manage:any');
      if (!assignment && !isAdmin) throw new ApiError(403, 'No active assignment for this pharmacy');
      if (!isAdmin) {
        const verifiedPharmacist = assignment?.role === 'PHARMACIST' && req.auth!.roles.includes('PHARMACIST') && await Pharmacist.exists({ userId: req.auth!.id, verificationStatus: 'VERIFIED', evidenceDocumentPath: { $type: 'string' }, evidenceUploadedAt: { $type: 'date' }, pharmacyIds: reservation.pharmacyId }).session(session);
        if (assignment?.role !== 'PHARMACY_OWNER' && !verifiedPharmacist) throw new ApiError(403, 'Only a pharmacy owner or verified assigned pharmacist may update reservation status');
        if (verifiedPharmacist && reservation.status === 'PENDING' && status === 'CONFIRMED' && !reviewAttestation) throw new ApiError(400, 'Confirm the stock and applicable prescription requirement review before proceeding');
      }
    }
    else if (status !== 'CANCELLED') throw new ApiError(403, 'Customers may only cancel their own reservation');
    if (reservation.status === status) { updatedReservation = reservation; idempotentReplay = true; return; }
    const allowed: Record<string, string[]> = { PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED'], CONFIRMED: ['READY_FOR_PICKUP', 'REJECTED', 'CANCELLED', 'EXPIRED'], READY_FOR_PICKUP: ['COLLECTED', 'CANCELLED', 'EXPIRED'] };
    if (!allowed[reservation.status]?.includes(status)) throw new ApiError(409, `Cannot change reservation from ${reservation.status} to ${status}`);
    if (reservation.status === 'PENDING' && reservation.holdExpiresAt && reservation.holdExpiresAt <= new Date() && status !== 'CANCELLED') throw new ApiError(409, 'The temporary stock hold expired; ask the customer to submit a new request');
    if (['CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED'].includes(status)) {
      const now = new Date();
      const pharmacy = await Pharmacy.findById(reservation.pharmacyId).session(session);
      if (!pharmacy || pharmacy.verificationStatus !== 'APPROVED' || !pharmacy.active) throw new ApiError(409, 'Pharmacy is not currently approved and active');
      if (status !== 'CONFIRMED' && (!reservation.pickupExpiresAt || reservation.pickupExpiresAt <= now)) throw new ApiError(409, 'The pickup deadline has passed; this request cannot advance');
      for (const allocation of reservation.allocatedBatches) {
        const batch = await InventoryBatch.findById(allocation.batchId).session(session);
        if (!batch || !batch.active || batch.expiryDate <= now) throw new ApiError(409, 'An allocated batch is unavailable or expired; this request cannot advance');
        if (batch.reservedQuantity < allocation.quantity || batch.onHandQuantity < allocation.quantity) throw new ApiError(409, 'Stock allocation is inconsistent; contact pharmacy support');
      }
      if (status === 'CONFIRMED') { const operationSettings = await getReservationSettings(); reservation.pickupExpiresAt = new Date(now.getTime() + operationSettings.pickupDeadlineHours * 3600000); }
    }
    const releasing = ['REJECTED', 'CANCELLED', 'EXPIRED'].includes(status); const collecting = status === 'COLLECTED';
    if (releasing || collecting) for (const allocation of reservation.allocatedBatches) {
      const batch = await InventoryBatch.findById(allocation.batchId).session(session); if (!batch) throw new ApiError(409, 'An allocated batch is missing; contact pharmacy support');
      if (batch.reservedQuantity < allocation.quantity || (collecting && batch.onHandQuantity < allocation.quantity)) throw new ApiError(409, 'Stock allocation is inconsistent; contact pharmacy support');
      batch.reservedQuantity -= allocation.quantity; if (collecting) batch.onHandQuantity -= allocation.quantity; await batch.save({ session });
      await StockMovement.create([{ pharmacyId: reservation.pharmacyId, inventoryId: batch.inventoryId, batchId: batch.id, actorId: req.auth!.id, type: collecting ? 'COLLECTION' : 'RESERVATION_RELEASE', quantity: allocation.quantity, referenceId: reservation.id }], { session });
    }
    reservation.status = status; if (status === 'COLLECTED') reservation.collectedAt = new Date(); reservation.history.push({ status, actorId: req.auth!.id, note, ...(status === 'CONFIRMED' && reviewAttestation ? { reviewAttestation } : {}), at: new Date() } as never); await reservation.save({ session });
    const recipient = isCustomer ? (await Pharmacy.findById(reservation.pharmacyId).session(session))?.ownerId : reservation.customerId;
    if (recipient) await Notification.create([{ userId: recipient, type: `RESERVATION_${status}`, title: `Reservation ${status.toLowerCase().replaceAll('_', ' ')}`, message: note || `Your reservation status is now ${status.toLowerCase().replaceAll('_', ' ')}.`, data: { reservationId: reservation.id } }], { session });
    updatedReservation = reservation;
  }); } finally { await session.endSession(); }
  if (!idempotentReplay) await recordAudit({ actorId: req.auth!.id, action: `reservation.${status.toLowerCase()}`, resourceType: 'Reservation', resourceId: req.params.id }); res.json({ success: true, data: { reservation: updatedReservation, idempotentReplay } });
}));
