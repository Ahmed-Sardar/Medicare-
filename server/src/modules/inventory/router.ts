import { Router } from 'express';
import multer from 'multer';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { readImportRecords } from './importFile.js';
import { AuditLog, Inventory, InventoryBatch, InventoryImportJob, Medicine, Pharmacy, StockMovement } from '../models.js';
import { assertPharmacyAction } from '../../services/pharmacyAuthorization.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.js';
import { env } from '../../config/env.js';
import { classifyFreshness } from '../../services/inventoryFreshness.js';
import { lockMedicineIdentity } from '../../services/catalogueIdentity.js';
import { getFreshnessThresholds } from '../../services/settings.js';
import { validate, validatedRequest } from '../../middleware/validate.js';
import { mongoIdSchema, paginationQuerySchema } from '../../validators/common.js';

export const inventoryRouter = Router(); inventoryRouter.use(authenticate);
const importUpload = multer({ storage: multer.diskStorage({ destination: async (_req, _file, callback) => { try { const dir = path.resolve(env.UPLOAD_DIR, 'import-tmp'); await mkdir(dir, { recursive: true }); callback(null, dir); } catch (error) { callback(error as Error, env.UPLOAD_DIR); } }, filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`) }), limits: { fileSize: Math.min(env.MAX_UPLOAD_MB, 5) * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => callback(/\.(csv|xlsx)$/i.test(file.originalname) ? null : new ApiError(400, 'Upload a CSV or XLSX file', 'INVALID_UPLOAD'), /\.(csv|xlsx)$/i.test(file.originalname)) });
const batchInput = z.object({ pharmacyId: z.string(), medicineId: z.string(), batchNumber: z.string().trim().min(1).max(80), expiryDate: z.coerce.date().refine((date) => date > new Date(), 'Expiry date must be in the future'), quantity: z.number().int().positive().max(1000000000), sellingPrice: z.number().finite().nonnegative(), mrp: z.number().finite().nonnegative(), manufacturer: z.string().max(160).optional() }).refine((input) => input.sellingPrice <= input.mrp, 'Selling price cannot exceed MRP');
async function assertWritablePharmacy(pharmacyId: string): Promise<void> { if (!await Pharmacy.exists({ _id: pharmacyId, verificationStatus: 'APPROVED', active: true })) throw new ApiError(409, 'Inventory changes require an approved active pharmacy'); }

inventoryRouter.get('/import/template.xlsx', asyncHandler(async (_req, res) => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Inventory');
  sheet.columns = ['medicineId', 'batchNumber', 'expiryDate', 'quantity', 'sellingPrice', 'mrp', 'manufacturer'].map((header) => ({ header, key: header, width: 20 }));
  sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.getColumn(3).numFmt = 'yyyy-mm-dd';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="medfind-inventory-template.xlsx"');
  await workbook.xlsx.write(res); res.end();
}));

inventoryRouter.post('/import/preview', importUpload.single('file'), asyncHandler(async (req, res) => {
  const file = req.file;
  try {
    if (!file) throw new ApiError(400, 'CSV or XLSX file is required');
    const pharmacyId = z.string().regex(/^[0-9a-f]{24}$/i).parse(req.body.pharmacyId); await assertPharmacyAction(req.auth!, pharmacyId, 'inventory:update');
    const records = await readImportRecords(file.path, file.originalname.toLowerCase().endsWith('.xlsx'));
    if (records.length < 2) throw new ApiError(400, 'Import must contain a header and at least one data row');
    if (records[0]!.error) throw new ApiError(400, 'Import header must contain plain text');
    const headers = records[0]!.values.map((header) => header.toLowerCase()); const required = ['medicineid', 'batchnumber', 'expirydate', 'quantity', 'sellingprice', 'mrp']; const missing = required.filter((header) => !headers.includes(header)); if (missing.length) throw new ApiError(400, `Missing required columns: ${missing.join(', ')}`); if (new Set(headers).size !== headers.length) throw new ApiError(400, 'Import contains duplicate column names');
    const errors: Array<{ rowNumber: number; message: string }> = []; const rows: Array<{ rowNumber: number; data: Record<string, unknown>; medicineId: string }> = []; const seen = new Set<string>();
    for (let i = 1; i < records.length; i++) {
      const record = records[i]!; const rowNumber = record.rowNumber; if (record.error) { errors.push({ rowNumber, message: record.error }); continue; } if (record.values.length !== headers.length) { errors.push({ rowNumber, message: 'Row column count does not match the header' }); continue; } const input = Object.fromEntries(headers.map((header, index) => [header, record.values[index] ?? '']));
      const parsed = z.object({ medicineid: z.string().regex(/^[0-9a-f]{24}$/i), batchnumber: z.string().min(1).max(80), expirydate: z.coerce.date().refine((date) => date > new Date(), 'Expiry date must be in the future'), quantity: z.string().min(1).pipe(z.coerce.number().finite().int().positive().max(1000000000)), sellingprice: z.string().min(1).pipe(z.coerce.number().finite().nonnegative()), mrp: z.string().min(1).pipe(z.coerce.number().finite().nonnegative()), manufacturer: z.string().max(160).optional() }).refine((row) => row.mrp >= row.sellingprice, 'MRP cannot be lower than selling price').safeParse(input);
      if (!parsed.success) { errors.push({ rowNumber, message: parsed.error.issues.map((issue) => issue.message).join('; ') }); continue; }
      const item = parsed.data; const duplicateKey = `${item.medicineid.toLowerCase()}:${item.batchnumber.toLowerCase()}`; if (seen.has(duplicateKey)) { errors.push({ rowNumber, message: 'Duplicate medicine and batch number within this file' }); continue; } seen.add(duplicateKey);
      const medicine = await Medicine.findOne({ _id: item.medicineid, active: true }); if (!medicine) { errors.push({ rowNumber, message: 'Medicine is not in the active catalogue' }); continue; }
      const existingInventory = await Inventory.findOne({ pharmacyId, medicineId: medicine.id }); const existingBatch = existingInventory && await InventoryBatch.exists({ inventoryId: existingInventory.id, batchNumber: item.batchnumber }); if (existingBatch) { errors.push({ rowNumber, message: 'This batch already exists for the pharmacy' }); continue; }
      rows.push({ rowNumber, medicineId: medicine.id, data: { medicineRevision: medicine.revision ?? 0, batchNumber: item.batchnumber, expiryDate: item.expirydate, quantity: item.quantity, sellingPrice: item.sellingprice, mrp: item.mrp, manufacturer: item.manufacturer } });
    }
    const job = await InventoryImportJob.create({ pharmacyId, actorId: req.auth!.id, status: 'PREVIEW', rows, errors, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    res.status(201).json({ success: true, data: { jobId: job.id, validRows: rows.length, invalidRows: errors.length, errors, expiresAt: job.expiresAt, confirmationRequired: rows.length > 0 } });
  } finally { if (file) await unlink(file.path).catch(() => undefined); }
}));

inventoryRouter.post('/import/:jobId/confirm', asyncHandler(async (req, res) => {
  const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body); void confirm;
  const job = await InventoryImportJob.findOne({ _id: req.params.jobId, actorId: req.auth!.id, status: 'PREVIEW', expiresAt: { $gt: new Date() } }); if (!job) throw new ApiError(404, 'Import preview was not found or has expired');
  await assertPharmacyAction(req.auth!, String(job.pharmacyId), 'inventory:update');
  if (!job.rows.length) throw new ApiError(409, 'There are no valid rows to import');
  const pharmacy = await Pharmacy.findById(job.pharmacyId); if (!pharmacy || pharmacy.verificationStatus !== 'APPROVED' || !pharmacy.active) throw new ApiError(409, 'Inventory import requires an approved active pharmacy');
  const session = await Inventory.startSession();
  try { await session.withTransaction(async () => {
    const current = await InventoryImportJob.findOneAndUpdate({ _id: job.id, actorId: req.auth!.id, status: 'PREVIEW', expiresAt: { $gt: new Date() } }, { $set: { status: 'COMMITTED' } }, { new: true, session }); if (!current) throw new ApiError(409, 'Import preview is no longer available');
    for (const row of current.rows as Array<{ rowNumber: number; data: { batchNumber: string; expiryDate: Date; quantity: number; sellingPrice: number; mrp: number; manufacturer?: string; medicineRevision?: number }; medicineId: import('mongoose').Types.ObjectId }>) {
      if (new Date(row.data.expiryDate) <= new Date() || !await Medicine.exists({ _id: row.medicineId, active: true }).session(session)) throw new ApiError(409, `Row ${row.rowNumber} is no longer valid; create a new preview`);
      await lockMedicineIdentity(String(row.medicineId), row.data.medicineRevision ?? 0, session);
      let inventory = await Inventory.findOne({ pharmacyId: job.pharmacyId, medicineId: row.medicineId }).session(session);
      if (inventory && await InventoryBatch.exists({ inventoryId: inventory.id, batchNumber: row.data.batchNumber }).session(session)) throw new ApiError(409, `Batch on row ${row.rowNumber} already exists; create a new preview`);
      if (!inventory) [inventory] = await Inventory.create([{ pharmacyId: job.pharmacyId, medicineId: row.medicineId, lastUpdatedBy: req.auth!.id }], { session });
      const [batch] = await InventoryBatch.create([{ inventoryId: inventory!.id, batchNumber: row.data.batchNumber, expiryDate: row.data.expiryDate, onHandQuantity: row.data.quantity, sellingPrice: row.data.sellingPrice, mrp: row.data.mrp, manufacturer: row.data.manufacturer }], { session });
      inventory!.lastUpdatedAt = new Date(); inventory!.lastUpdatedBy = req.auth!.id as never; await inventory!.save({ session });
      await StockMovement.create([{ pharmacyId: job.pharmacyId, inventoryId: inventory!.id, batchId: batch!.id, actorId: req.auth!.id, type: 'STOCK_ADDITION', quantity: row.data.quantity, note: `Spreadsheet import ${job.id}` }], { session });
    }
    await AuditLog.create([{ actorId: req.auth!.id, action: 'inventory.import.committed', resourceType: 'InventoryImportJob', resourceId: job.id, pharmacyId: job.pharmacyId, metadata: { importedRows: current.rows.length, rejectedRows: current.errors.length }, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { importedRows: job.rows.length, rejectedRows: job.errors.length, rowErrors: job.errors, status: 'COMMITTED' } });
}));

inventoryRouter.get('/', asyncHandler(async (req, res) => {
  const { pharmacyId, page, limit, q, stockStatus, freshness, sort } = z.object({ pharmacyId: mongoIdSchema, ...paginationQuerySchema.shape, q: z.string().trim().max(100).default(''), stockStatus: z.preprocess((value) => value === '' ? undefined : value, z.enum(['AVAILABLE', 'UNAVAILABLE']).optional()), freshness: z.preprocess((value) => value === '' ? undefined : value, z.enum(['RECENTLY_UPDATED', 'NEEDS_CONFIRMATION', 'STALE_WARNING', 'UNAVAILABLE_FOR_CONFIRMED_SEARCH']).optional()), sort: z.enum(['updated_desc', 'updated_asc']).default('updated_desc') }).strict().parse(req.query);
  await assertPharmacyAction(req.auth!, pharmacyId, 'inventory:read');
  const now = new Date(); const thresholds = await getFreshnessThresholds();
  const medicineIds = q ? await Medicine.find({ active: true, $or: ['name', 'brand', 'genericName', 'composition', 'manufacturer', 'strength', 'dosageForm', 'aliases'].map((field) => ({ [field]: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })) }).distinct('_id') : undefined;
  const newerThan = freshness === 'RECENTLY_UPDATED' ? new Date(now.getTime() - thresholds.recentMinutes * 60000) : freshness === 'NEEDS_CONFIRMATION' ? new Date(now.getTime() - thresholds.confirmMinutes * 60000) : freshness === 'STALE_WARNING' ? new Date(now.getTime() - thresholds.staleMinutes * 60000) : undefined;
  const olderThan = freshness === 'NEEDS_CONFIRMATION' ? new Date(now.getTime() - thresholds.recentMinutes * 60000) : freshness === 'STALE_WARNING' ? new Date(now.getTime() - thresholds.confirmMinutes * 60000) : freshness === 'UNAVAILABLE_FOR_CONFIRMED_SEARCH' ? new Date(now.getTime() - thresholds.staleMinutes * 60000) : undefined;
  const filter = { pharmacyId, active: true, ...(stockStatus ? { stockStatus } : {}), ...(medicineIds ? { medicineId: { $in: medicineIds } } : {}), ...(freshness ? { lastUpdatedAt: { ...(newerThan ? { $gte: newerThan } : {}), ...(olderThan ? { $lt: olderThan } : {}) } } : {}) };
  if (medicineIds && medicineIds.length === 0) { res.setHeader('Cache-Control', 'no-store'); return res.json({ success: true, data: { inventory: [], page, limit, total: 0 } }); }
  const [inventory, total] = await Promise.all([Inventory.find(filter).populate('medicineId', 'name strength dosageForm manufacturer packSize isDemo').sort({ lastUpdatedAt: sort === 'updated_asc' ? 1 : -1, _id: sort === 'updated_asc' ? 1 : -1 }).skip((page - 1) * limit).limit(limit), Inventory.countDocuments(filter)]);
  const inventoryIds = inventory.map((i) => i.id); const batches = await InventoryBatch.find({ inventoryId: { $in: inventoryIds }, active: true, expiryDate: { $gt: now } }).sort({ expiryDate: 1 });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: { inventory: inventory.map((item) => { const matching = batches.filter((batch) => String(batch.inventoryId) === item.id); return { ...item.toObject(), freshness: classifyFreshness(item.lastUpdatedAt, now, thresholds), batches: matching, availableQuantity: matching.reduce((sum, b) => sum + Math.max(0, b.onHandQuantity - b.reservedQuantity), 0) }; }), page, limit, total } });
}));

inventoryRouter.post('/batches', asyncHandler(async (req, res) => {
  const input = batchInput.parse(req.body); await assertPharmacyAction(req.auth!, input.pharmacyId, 'inventory:update');
  const [pharmacy, medicine] = await Promise.all([Pharmacy.findById(input.pharmacyId), Medicine.findOne({ _id: input.medicineId, active: true })]);
  if (!pharmacy || !medicine) throw new ApiError(404, 'Pharmacy or medicine not found');
  if (pharmacy.verificationStatus !== 'APPROVED' || !pharmacy.active) throw new ApiError(409, 'Inventory changes require an approved active pharmacy');
  const session = await Inventory.startSession(); let result: unknown;
  try { await session.withTransaction(async () => {
    await lockMedicineIdentity(medicine.id, medicine.revision ?? 0, session);
    let inventory = await Inventory.findOne({ pharmacyId: pharmacy.id, medicineId: medicine.id }).session(session);
    if (!inventory) [inventory] = await Inventory.create([{ pharmacyId: pharmacy.id, medicineId: medicine.id, lastUpdatedBy: req.auth!.id }], { session });
    const [batch] = await InventoryBatch.create([{ inventoryId: inventory!.id, batchNumber: input.batchNumber, expiryDate: input.expiryDate, onHandQuantity: input.quantity, sellingPrice: input.sellingPrice, mrp: input.mrp, manufacturer: input.manufacturer }], { session });
    inventory!.lastUpdatedAt = new Date(); inventory!.lastUpdatedBy = req.auth!.id as never; await inventory!.save({ session });
    await StockMovement.create([{ pharmacyId: pharmacy.id, inventoryId: inventory!.id, batchId: batch!.id, actorId: req.auth!.id, type: 'STOCK_ADDITION', quantity: input.quantity }], { session }); result = { inventory, batch };
  }); } finally { await session.endSession(); }
  await recordAudit({ actorId: req.auth!.id, action: 'inventory.batch.created', resourceType: 'Inventory', pharmacyId: input.pharmacyId, metadata: { medicineId: input.medicineId } });
  res.status(201).json({ success: true, data: result });
}));

inventoryRouter.patch('/batches/:id/quantity', asyncHandler(async (req, res) => {
  const { quantity, note } = z.object({ quantity: z.number().int().min(0).max(1000000000), note: z.string().max(250).optional() }).parse(req.body);
  const batch = await InventoryBatch.findById(req.params.id); if (!batch) throw new ApiError(404, 'Batch not found'); const inventory = await Inventory.findById(batch.inventoryId); if (!inventory) throw new ApiError(404, 'Inventory not found');
  await assertPharmacyAction(req.auth!, String(inventory.pharmacyId), 'inventory:update');
  await assertWritablePharmacy(String(inventory.pharmacyId));
  if (!batch.active || batch.expiryDate <= new Date()) throw new ApiError(409, 'Expired or inactive batches cannot be changed');
  const delta = quantity - batch.onHandQuantity; if (quantity < batch.reservedQuantity) throw new ApiError(409, 'On-hand quantity cannot be lower than reserved quantity');
  const session = await InventoryBatch.startSession(); try { await session.withTransaction(async () => {
    const updated = await InventoryBatch.findOneAndUpdate({ _id: batch.id, onHandQuantity: batch.onHandQuantity, reservedQuantity: { $lte: quantity }, active: true, expiryDate: { $gt: new Date() } }, { $set: { onHandQuantity: quantity } }, { new: true, session });
    if (!updated) throw new ApiError(409, 'Batch changed concurrently; refresh and retry');
    inventory.lastUpdatedAt = new Date(); inventory.lastUpdatedBy = req.auth!.id as never; await inventory.save({ session });
    if (delta) await StockMovement.create([{ pharmacyId: inventory.pharmacyId, inventoryId: inventory.id, batchId: batch.id, actorId: req.auth!.id, type: 'STOCK_CORRECTION', quantity: delta, note }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { batch: await InventoryBatch.findById(batch.id) } });
}));

inventoryRouter.patch('/:id/status', asyncHandler(async (req, res) => {
  const { stockStatus } = z.object({ stockStatus: z.enum(['AVAILABLE', 'UNAVAILABLE']) }).parse(req.body);
  const inventory = await Inventory.findById(req.params.id); if (!inventory) throw new ApiError(404, 'Inventory record not found'); await assertPharmacyAction(req.auth!, String(inventory.pharmacyId), 'inventory:update');
  const pharmacy = await Pharmacy.findById(inventory.pharmacyId); if (!pharmacy || pharmacy.verificationStatus !== 'APPROVED' || !pharmacy.active) throw new ApiError(409, 'Only approved active pharmacies can update public availability');
  inventory.stockStatus = stockStatus; inventory.lastUpdatedAt = new Date(); inventory.lastUpdatedBy = req.auth!.id as never; await inventory.save();
  await recordAudit({ actorId: req.auth!.id, action: `inventory.${stockStatus.toLowerCase()}`, resourceType: 'Inventory', resourceId: inventory.id, pharmacyId: String(inventory.pharmacyId), ipAddress: req.ip }); res.json({ success: true, data: { inventory } });
}));

inventoryRouter.patch('/:id/threshold', asyncHandler(async (req, res) => {
  const { minStock, reorderThreshold, alertsEnabled } = z.object({ minStock: z.number().int().min(0).max(1000000000), reorderThreshold: z.number().int().min(0).max(1000000000).optional(), alertsEnabled: z.boolean().default(true) }).strict().refine((value) => value.reorderThreshold === undefined || value.reorderThreshold >= value.minStock, 'Reorder threshold must be at least the low-stock threshold').parse(req.body);
  const inventory = await Inventory.findById(req.params.id); if (!inventory) throw new ApiError(404, 'Inventory record not found');
  await assertPharmacyAction(req.auth!, String(inventory.pharmacyId), 'inventory:update');
  await assertWritablePharmacy(String(inventory.pharmacyId));
  const session = await Inventory.startSession();
  try { await session.withTransaction(async () => {
    await Inventory.updateOne({ _id: inventory.id }, { $set: { minStock, reorderThreshold: reorderThreshold ?? minStock, alertsEnabled } }, { session });
    await AuditLog.create([{ actorId: req.auth!.id, action: 'inventory.threshold.updated', resourceType: 'Inventory', resourceId: inventory.id, pharmacyId: inventory.pharmacyId, metadata: { minStock, reorderThreshold: reorderThreshold ?? minStock, alertsEnabled }, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { minStock, reorderThreshold: reorderThreshold ?? minStock, alertsEnabled } });
}));

inventoryRouter.patch('/batches/:id', asyncHandler(async (req, res) => {
  const input = z.object({ expiryDate: z.coerce.date().refine((date) => date > new Date(), 'Expiry date must be in the future').optional(), sellingPrice: z.number().finite().nonnegative().optional(), mrp: z.number().finite().nonnegative().optional(), manufacturer: z.string().max(160).optional() }).refine((value) => Object.keys(value).length > 0, 'At least one batch field is required').parse(req.body);
  const batch = await InventoryBatch.findById(req.params.id); if (!batch) throw new ApiError(404, 'Batch not found');
  const inventory = await Inventory.findById(batch.inventoryId); if (!inventory) throw new ApiError(404, 'Inventory not found');
  await assertPharmacyAction(req.auth!, String(inventory.pharmacyId), 'inventory:update');
  await assertWritablePharmacy(String(inventory.pharmacyId));
  if (!batch.active || batch.expiryDate <= new Date()) throw new ApiError(409, 'Expired or inactive batches cannot be changed');
  if ((input.sellingPrice ?? batch.sellingPrice) > (input.mrp ?? batch.mrp)) throw new ApiError(400, 'Selling price cannot exceed MRP');
  const session = await InventoryBatch.startSession();
  try { await session.withTransaction(async () => {
    const updated = await InventoryBatch.updateOne({ _id: batch.id, active: true, expiryDate: { $eq: batch.expiryDate, $gt: new Date() }, sellingPrice: batch.sellingPrice, mrp: batch.mrp }, { $set: input }, { session, runValidators: true });
    if (!updated.matchedCount) throw new ApiError(409, 'Batch changed concurrently; refresh and retry');
    await Inventory.updateOne({ _id: inventory.id }, { $set: { lastUpdatedAt: new Date(), lastUpdatedBy: req.auth!.id } }, { session });
    await AuditLog.create([{ actorId: req.auth!.id, action: 'inventory.batch.updated', resourceType: 'InventoryBatch', resourceId: batch.id, pharmacyId: inventory.pharmacyId, metadata: { fields: Object.keys(input) }, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { batch: await InventoryBatch.findById(batch.id) } });
}));

const movementQuerySchema = paginationQuerySchema.extend({ pharmacyId: mongoIdSchema }).strict();
const movementRequestSchema = z.object({ body: z.unknown().optional(), query: movementQuerySchema, params: z.unknown().optional() });
inventoryRouter.get('/movements', validate(movementRequestSchema), asyncHandler(async (req, res) => {
  const input = validatedRequest<{ query: z.infer<typeof movementQuerySchema> }>(res).query;
  await assertPharmacyAction(req.auth!, input.pharmacyId, 'inventory:read');
  const filter = { pharmacyId: input.pharmacyId }; const [movements, total] = await Promise.all([StockMovement.find(filter).sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).populate('inventoryId'), StockMovement.countDocuments(filter)]);
  res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { movements, total, page: input.page, limit: input.limit } });
}));
