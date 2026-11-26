import { Router } from 'express';
import ExcelJS from 'exceljs';
import { Inventory, InventoryBatch, Pharmacy, Reservation, StockMovement } from '../models.js';
import { assertPharmacyAction } from '../../services/pharmacyAuthorization.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { analyticsRouter } from './analytics.js';
import { recordAudit } from '../../services/audit.js';
export const reportsRouter = Router(); reportsRouter.use(authenticate); reportsRouter.use('/analytics', analyticsRouter);
function csvField(value: unknown): string {
  let text = String(value ?? '');
  // Neutralize spreadsheet formulas in user-supplied text, including leading whitespace.
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
const inventoryHeaders = ['medicine', 'strength', 'dosage_form', 'batch', 'expiry', 'on_hand', 'reserved', 'available', 'selling_price', 'mrp', 'batch_active', 'stock_status', 'demo_data'];
async function inventoryRows(pharmacyId: string): Promise<Array<Array<string | number | boolean>>> {
  const pharmacy = await Pharmacy.findById(pharmacyId).select('isDemo'); if (!pharmacy) throw new ApiError(404, 'Pharmacy not found');
  const inventory = await Inventory.find({ pharmacyId }).populate('medicineId', 'name strength dosageForm isDemo');
  const batches = await InventoryBatch.find({ inventoryId: { $in: inventory.map((item) => item._id) } }).limit(25001);
  if (batches.length > 25000) throw new ApiError(413, 'Inventory export is limited to 25000 batches');
  const grouped = new Map<string, typeof batches>(); for (const batch of batches) { const key = String(batch.inventoryId); const group = grouped.get(key) || []; group.push(batch); grouped.set(key, group); }
  const now = new Date(); const rows: Array<Array<string | number | boolean>> = [];
  for (const item of inventory) for (const batch of grouped.get(item.id) || []) {
    const medicine = item.medicineId as unknown as { name?: string; strength?: string; dosageForm?: string; isDemo?: boolean } | null;
    const available = item.active && item.stockStatus === 'AVAILABLE' && batch.active && batch.expiryDate > now ? Math.max(0, batch.onHandQuantity - batch.reservedQuantity) : 0;
    rows.push([medicine?.name || '', medicine?.strength || '', medicine?.dosageForm || '', batch.batchNumber, batch.expiryDate.toISOString().slice(0, 10), batch.onHandQuantity, batch.reservedQuantity, available, batch.sellingPrice, batch.mrp, batch.active, item.stockStatus, Boolean(pharmacy.isDemo || item.isDemo || batch.isDemo || medicine?.isDemo)]);
  }
  return rows;
}
reportsRouter.get('/inventory.:format(csv|xlsx)', asyncHandler(async (req, res) => {
  const pharmacyId = String(req.query.pharmacyId || ''); if (!pharmacyId) throw new ApiError(400, 'pharmacyId is required'); await assertPharmacyAction(req.auth!, pharmacyId, 'report:read');
  const rows = await inventoryRows(pharmacyId); const format = req.params.format;
  await recordAudit({ actorId: req.auth!.id, action: `report.inventory_${format}.exported`, resourceType: 'Pharmacy', resourceId: pharmacyId, pharmacyId, metadata: { rows: rows.length }, ipAddress: req.ip });
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="medfind-inventory.csv"');
    res.send([inventoryHeaders.join(','), ...rows.map((row) => row.map(csvField).join(','))].join('\r\n')); return;
  }
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Inventory');
  sheet.columns = inventoryHeaders.map((header) => ({ header, key: header, width: 20 })); sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of rows) sheet.addRow(row);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="medfind-inventory.xlsx"');
  await workbook.xlsx.write(res); res.end();
}));

reportsRouter.get('/stock-movements', asyncHandler(async (req, res) => { const pharmacyId = String(req.query.pharmacyId || ''); if (!pharmacyId) throw new ApiError(400, 'pharmacyId is required'); await assertPharmacyAction(req.auth!, pharmacyId, 'report:read'); const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000); const movements = await StockMovement.find({ pharmacyId, createdAt: { $gte: from } }).sort({ createdAt: -1 }).limit(500).populate('inventoryId'); res.json({ success: true, data: { movements } }); }));
reportsRouter.get('/reservations', asyncHandler(async (req, res) => { const pharmacyId = String(req.query.pharmacyId || ''); if (!pharmacyId) throw new ApiError(400, 'pharmacyId is required'); await assertPharmacyAction(req.auth!, pharmacyId, 'report:read'); const rows = await Reservation.aggregate([{ $match: { pharmacyId: new (await import('mongoose')).default.Types.ObjectId(pharmacyId) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]); res.json({ success: true, data: { byStatus: rows } }); }));
