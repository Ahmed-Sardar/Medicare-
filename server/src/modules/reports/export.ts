import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.js';
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {};
const columns: Record<string, string[]> = {
  platform: ['category', 'name', 'count', 'requestedUnits', 'note'],
  inventory: ['_id', 'name', 'strength', 'dosageForm', 'packSize', 'availableQuantity', 'minStock', 'stockStatus', 'lastUpdatedAt'],
  batches: ['_id', 'name', 'strength', 'dosageForm', 'batchNumber', 'expiryDate', 'onHandQuantity', 'reservedQuantity', 'active'],
  movements: ['_id', 'name', 'strength', 'dosageForm', 'type', 'quantity', 'createdAt', 'batchId'],
  reservations: ['_id', 'name', 'strength', 'dosageForm', 'packSize', 'status', 'quantity', 'createdAt', 'collectedAt'],
};
function cell(value: unknown): string | number | boolean { if (value == null) return ''; if (value instanceof Date) return value.toISOString(); if (typeof value === 'number' || typeof value === 'boolean') return value; return String(value); }
function csv(value: unknown) { let text = String(cell(value)); if (typeof value !== 'number' && /^\s*[=+@-]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
export async function exportReport(res: Response, input: { format: 'csv' | 'xlsx'; section: string; pharmacyId?: string; actorId: string; isDemo: boolean; items: unknown[]; total: number; filters: unknown; ipAddress?: string }) {
  if (input.total > 25000 || input.items.length > 25000) throw new ApiError(413, 'Export exceeds 25,000 records. Narrow the report filters.');
  const fields = columns[input.section]; if (!fields) throw new ApiError(400, 'Unsupported report export');
  const generatedAt = new Date().toISOString(); const headers = [...fields, 'demo_data', 'generated_at_utc'];
  const values = input.items.map((item) => {
    const row = record(typeof record(item).toObject === 'function' ? (item as { toObject(): unknown }).toObject() : item);
    const medicine = record(input.section === 'movements' ? record(row.inventoryId).medicineId : row.medicineId);
    const view: RecordValue = { ...row, ...(input.section === 'movements' || input.section === 'reservations' ? { name: medicine.name, strength: medicine.strength, dosageForm: medicine.dosageForm, packSize: medicine.packSize } : {}) };
    return [...fields.map((field) => cell(view[field])), input.isDemo, generatedAt];
  });
  await recordAudit({ actorId: input.actorId, action: `report.${input.section}_${input.format}.exported`, resourceType: input.pharmacyId ? 'Pharmacy' : 'PlatformReport', resourceId: input.pharmacyId, pharmacyId: input.pharmacyId, metadata: { rows: values.length, filters: input.filters }, ipAddress: input.ipAddress });
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Disposition', `attachment; filename="medfind-${input.section}.${input.format}"`);
  if (input.format === 'csv') { res.type('text/csv; charset=utf-8'); res.send('\uFEFF' + [headers.map(csv).join(','), ...values.map((row) => row.map(csv).join(','))].join('\r\n')); return; }
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Report'); sheet.addRow(headers); values.forEach((row) => sheet.addRow(row)); sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.columns.forEach((column) => { column.width = 24; });
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); await workbook.xlsx.write(res); res.end();
}
