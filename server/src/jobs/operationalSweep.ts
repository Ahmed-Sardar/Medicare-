import mongoose from 'mongoose';
import { Inventory, InventoryBatch, Notification, Pharmacy, Reservation, StockMovement } from '../modules/models.js';
import { logger } from '../config/logger.js';
import { withJobLease } from '../services/jobLease.js';
import { getFreshnessThresholds } from '../services/settings.js';

let running = false;
export async function runOperationalSweep(now = new Date()): Promise<void> {
  if (running) return; running = true;
  try {
    await withJobLease('operational-sweep', async (signal) => {
      for (const [name, job] of [['reservation expiry', expireReservationHolds], ['batch expiry', sendExpiryAlerts], ['low stock', sendLowStockAlerts], ['inventory freshness', sendFreshnessAlerts]] as const) {
        if (signal.aborted) break;
        try { await job(now, signal); } catch (error) { logger.error({ err: error, job: name }, 'Operational job failed'); }
      }
    });
  } finally { running = false; }
}
async function expireReservationHolds(now: Date, signal: AbortSignal): Promise<void> {
  // Inspect every active request, including those tied to batches deactivated on a prior sweep.
  const candidates = Reservation.find({ status: { $in: ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'] } }).select('status holdExpiresAt pickupExpiresAt allocatedBatches').cursor();
  for await (const candidate of candidates) {
    if (signal.aborted) break;
    const deadlinePassed = candidate.status === 'PENDING' ? Boolean(candidate.holdExpiresAt && candidate.holdExpiresAt <= now) : Boolean(candidate.pickupExpiresAt && candidate.pickupExpiresAt <= now);
    const batchIds = candidate.allocatedBatches.map((item) => item.batchId);
    const expiredBatch = !deadlinePassed && batchIds.length > 0 && await InventoryBatch.exists({ _id: { $in: batchIds }, $or: [{ active: false }, { expiryDate: { $lte: now } }] });
    if (!deadlinePassed && !expiredBatch) continue;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const reservation = await Reservation.findOne({ _id: candidate.id, status: { $in: ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'] } }).session(session);
        if (!reservation) return;
        const deadlinePassed = reservation.status === 'PENDING'
          ? Boolean(reservation.holdExpiresAt && reservation.holdExpiresAt <= now)
          : Boolean(reservation.pickupExpiresAt && reservation.pickupExpiresAt <= now);
        const batchIds = reservation.allocatedBatches.map((item) => item.batchId);
        const expiredBatch = batchIds.length > 0 && await InventoryBatch.exists({ _id: { $in: batchIds }, $or: [{ active: false }, { expiryDate: { $lte: now } }] }).session(session);
        if (!deadlinePassed && !expiredBatch) return;
        for (const allocation of reservation.allocatedBatches) {
          const batch = await InventoryBatch.findOneAndUpdate({ _id: allocation.batchId, reservedQuantity: { $gte: allocation.quantity } }, { $inc: { reservedQuantity: -allocation.quantity } }, { new: true, session });
          if (!batch) throw new Error(`Cannot release stock for expired reservation ${reservation.id}`);
          await StockMovement.create([{ pharmacyId: reservation.pharmacyId, inventoryId: batch.inventoryId, batchId: batch.id, type: 'RESERVATION_RELEASE', quantity: allocation.quantity, referenceId: reservation.id, note: 'Reservation expired' }], { session });
        }
        const note = expiredBatch ? 'An allocated batch is no longer available or expired' : reservation.status === 'PENDING' ? 'Temporary stock hold expired' : 'Pickup deadline passed';
        reservation.status = 'EXPIRED'; reservation.history.push({ status: 'EXPIRED', note, at: now } as never); await reservation.save({ session });
        const pharmacy = await Pharmacy.findById(reservation.pharmacyId).session(session);
        if (pharmacy) await Notification.create([{ userId: reservation.customerId, type: 'RESERVATION_EXPIRED', title: 'Reservation expired', message: note, data: { reservationId: reservation.id } }, { userId: pharmacy.ownerId, type: 'RESERVATION_EXPIRED', title: 'Reservation expired', message: `${note}. The held quantity was released.`, data: { reservationId: reservation.id } }], { session });
      });
    } catch (error) { logger.error({ err: error, reservationId: candidate.id }, 'Unable to expire reservation; continuing sweep'); }
    finally { await session.endSession(); }
  }
}

async function sendExpiryAlerts(now: Date, signal: AbortSignal): Promise<void> {
  const ranges = [{ days: 90, type: 'EXPIRY_90_DAYS' }, { days: 60, type: 'EXPIRY_60_DAYS' }, { days: 30, type: 'EXPIRY_30_DAYS' }];
  for (const range of ranges) {
    const batches = InventoryBatch.find({ active: true, expiryDate: { $gt: now, $lte: new Date(now.getTime() + range.days * 86400000) } }).cursor();
    for await (const batch of batches) {
      if (signal.aborted) break;
      try {
        const inventory = await Inventory.findById(batch.inventoryId); const pharmacy = inventory && await Pharmacy.findById(inventory.pharmacyId); if (!inventory || !pharmacy) continue;
        const key = `${range.type}:${batch.id}`; await Notification.updateOne({ dedupKey: key }, { $setOnInsert: { userId: pharmacy.ownerId, type: range.type, title: 'Batch expiry approaching', message: `Batch ${batch.batchNumber} expires within ${range.days} days. Review and remove stock as appropriate.`, data: { batchId: batch.id, pharmacyId: pharmacy.id, days: range.days }, dedupKey: key } }, { upsert: true });
      } catch (error) { logger.error({ err: error, batchId: batch.id }, 'Unable to create expiry alert; continuing sweep'); }
    }
  }
  const expired = InventoryBatch.find({ active: true, expiryDate: { $lte: now } }).select('_id').cursor();
  for await (const candidate of expired) {
    if (signal.aborted) break;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const batch = await InventoryBatch.findOneAndUpdate({ _id: candidate.id, active: true, expiryDate: { $lte: now } }, { $set: { active: false } }, { new: true, session });
        if (!batch) return;
        const inventory = await Inventory.findById(batch.inventoryId).session(session);
        const pharmacy = inventory && await Pharmacy.findById(inventory.pharmacyId).session(session);
        if (!inventory || !pharmacy) throw new Error(`Missing inventory or pharmacy for batch ${batch.id}`);
        if (batch.onHandQuantity > 0) await StockMovement.create([{ pharmacyId: pharmacy.id, inventoryId: inventory.id, batchId: batch.id, type: 'EXPIRED_STOCK', quantity: -batch.onHandQuantity, note: 'Batch reached expiry date' }], { session });
        const key = `EXPIRED:${batch.id}`;
        await Notification.updateOne({ dedupKey: key }, { $setOnInsert: { userId: pharmacy.ownerId, type: 'BATCH_EXPIRED', title: 'Expired stock removed from discovery', message: `Batch ${batch.batchNumber} has expired and is no longer available to customers.`, data: { batchId: batch.id, pharmacyId: pharmacy.id }, dedupKey: key } }, { upsert: true, session });
      });
    } catch (error) { logger.error({ err: error, batchId: candidate.id }, 'Unable to process expired batch; continuing sweep'); }
    finally { await session.endSession(); }
  }
}
async function sendLowStockAlerts(now: Date, signal: AbortSignal): Promise<void> {
  const rows = Inventory.find({ active: true, alertsEnabled: { $ne: false } }).cursor();
  for await (const inventory of rows) {
    if (signal.aborted) break;
    try {
    const batches = await InventoryBatch.find({ inventoryId: inventory.id, active: true, expiryDate: { $gt: now } }).select('onHandQuantity reservedQuantity');
    const available = batches.reduce((sum, batch) => sum + Math.max(0, batch.onHandQuantity - batch.reservedQuantity), 0); if (available > Math.max(inventory.minStock, inventory.reorderThreshold ?? inventory.minStock)) continue;
    const pharmacy = await Pharmacy.findById(inventory.pharmacyId); if (!pharmacy) continue;
    const type = available === 0 ? 'OUT_OF_STOCK' : available <= inventory.minStock ? 'LOW_STOCK' : 'REORDER_STOCK';
    const key = `${type}:${inventory.id}:${now.toISOString().slice(0, 10)}`;
    await Notification.updateOne({ dedupKey: key }, { $setOnInsert: { userId: pharmacy.ownerId, type, title: type === 'OUT_OF_STOCK' ? 'Out of stock' : type === 'LOW_STOCK' ? 'Low stock alert' : 'Reorder threshold reached', message: `Reported available quantity is ${available}. Review this inventory item.`, data: { inventoryId: inventory.id, pharmacyId: pharmacy.id, availableQuantity: available }, dedupKey: key } }, { upsert: true });
    } catch (error) { logger.error({ err: error, inventoryId: inventory.id }, 'Unable to create low-stock alert; continuing sweep'); }
  }
}
async function sendFreshnessAlerts(now: Date, signal: AbortSignal): Promise<void> {
  const thresholds = await getFreshnessThresholds();
  const rows = Inventory.find({ active: true, alertsEnabled: { $ne: false }, lastUpdatedAt: { $lt: new Date(now.getTime() - thresholds.confirmMinutes * 60000) } }).select('pharmacyId').cursor();
  for await (const inventory of rows) {
    if (signal.aborted) break;
    const pharmacy = await Pharmacy.findOne({ _id: inventory.pharmacyId, active: true, verificationStatus: 'APPROVED' }).select('ownerId'); if (!pharmacy) continue;
    const key = `INVENTORY_STALE:${pharmacy.id}:${now.toISOString().slice(0, 10)}`;
    await Notification.updateOne({ dedupKey: key }, { $setOnInsert: { userId: pharmacy.ownerId, type: 'INVENTORY_STALE', title: 'Review inventory freshness', message: 'Some inventory has not been updated recently. Review stock before confirming availability.', data: { pharmacyId: pharmacy.id }, dedupKey: key } }, { upsert: true });
  }
}
