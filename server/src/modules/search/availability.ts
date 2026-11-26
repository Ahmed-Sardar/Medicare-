import { Types, type PipelineStage } from 'mongoose';
import { Inventory, InventoryBatch, Medicine, Pharmacy } from '../models.js';
import { getFreshnessThresholds } from '../../services/settings.js';
import { publicMedicine } from '../medicines/publicView.js';
import { env } from '../../config/env.js';
import { openingStatus } from '../../services/openingHours.js';

type AvailabilityInput = { lat?: number; lng?: number; pinCode?: string; radiusKm: number; sort: 'distance' | 'price' | 'freshness'; availability: 'all' | 'reservable'; freshness: string; page: number; limit: number };
export async function findAvailability(input: AvailabilityInput, medicineFilter: Record<string, unknown>) {
  const now = new Date(); const thresholds = await getFreshnessThresholds();
  const pharmacyFilter = { verificationStatus: 'APPROVED', active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }), ...(input.pinCode ? { pinCode: input.pinCode } : {}) };
  const pipeline: PipelineStage[] = input.lat !== undefined && input.lng !== undefined
    ? [{ $geoNear: { near: { type: 'Point', coordinates: [input.lng, input.lat] }, key: 'location', spherical: true, maxDistance: input.radiusKm * 1000, distanceField: 'distanceMeters', query: pharmacyFilter } }]
    : [{ $match: pharmacyFilter }];
  // Adjacent lookup/unwind stages allow MongoDB to stream matches without materializing
  // every pharmacy's inventory in one application array or truncating candidate coverage.
  pipeline.push(
    { $lookup: { from: Inventory.collection.name, localField: '_id', foreignField: 'pharmacyId', as: 'stock' } }, { $unwind: '$stock' },
    { $match: { 'stock.active': true, 'stock.stockStatus': 'AVAILABLE' } },
    { $lookup: { from: Medicine.collection.name, localField: 'stock.medicineId', foreignField: '_id', pipeline: [{ $match: medicineFilter }], as: 'medicine' } }, { $unwind: '$medicine' },
    { $lookup: { from: InventoryBatch.collection.name, let: { inventoryId: '$stock._id' }, pipeline: [
      { $match: { $expr: { $eq: ['$inventoryId', '$$inventoryId'] }, active: true, expiryDate: { $gt: now } } },
      { $set: { available: { $max: [0, { $subtract: ['$onHandQuantity', '$reservedQuantity'] }] } } }, { $match: { available: { $gt: 0 } } },
      { $sort: { expiryDate: 1, _id: 1 } }, { $group: { _id: null, availableQuantity: { $sum: '$available' }, price: { $first: '$sellingPrice' }, mrp: { $first: '$mrp' } } },
    ], as: 'batch' } }, { $unwind: '$batch' },
    { $set: { freshness: { $switch: { branches: [
      { case: { $gte: ['$stock.lastUpdatedAt', new Date(now.getTime() - thresholds.recentMinutes * 60000)] }, then: 'RECENTLY_UPDATED' },
      { case: { $gte: ['$stock.lastUpdatedAt', new Date(now.getTime() - thresholds.confirmMinutes * 60000)] }, then: 'NEEDS_CONFIRMATION' },
      { case: { $gte: ['$stock.lastUpdatedAt', new Date(now.getTime() - thresholds.staleMinutes * 60000)] }, then: 'STALE_WARNING' },
    ], default: 'UNAVAILABLE_FOR_CONFIRMED_SEARCH' } } } },
  );
  if (input.freshness !== 'all') pipeline.push({ $match: { freshness: input.freshness } });
  if (input.availability === 'reservable') pipeline.push({ $match: { freshness: 'RECENTLY_UPDATED', isDemo: { $ne: true }, 'medicine.isDemo': { $ne: true } } });
  const sort: Record<string, 1 | -1> = input.sort === 'price' ? { 'batch.price': 1 } : input.sort === 'freshness' ? { 'stock.lastUpdatedAt': -1 } : input.lat !== undefined ? { distanceMeters: 1 } : {};
  Object.assign(sort, { name: 1, _id: 1, 'medicine._id': 1 });
  pipeline.push({ $facet: { total: [{ $count: 'count' }], rows: [{ $sort: sort }, { $skip: (input.page - 1) * input.limit }, { $limit: input.limit },
    { $project: { name: 1, address: 1, pinCode: 1, city: 1, state: 1, location: 1, phone: 1, verificationStatus: 1, isDemo: 1, openingHours: 1, holidayHours: 1, quantityDisplay: 1, quantityCap: 1, distanceMeters: 1, medicine: 1, batch: 1, freshness: 1, lastUpdatedAt: '$stock.lastUpdatedAt' } },
  ] } });
  type Row = { _id: Types.ObjectId; name: string; address: string; pinCode: string; city: string; state: string; location: { coordinates: number[] }; phone?: string; verificationStatus: string; isDemo?: boolean; openingHours?: Parameters<typeof openingStatus>[0]; holidayHours?: Parameters<typeof openingStatus>[1]; quantityDisplay?: string; quantityCap?: number; distanceMeters?: number; medicine: Parameters<typeof publicMedicine>[0]; batch: { availableQuantity: number; price: number; mrp: number }; freshness: string; lastUpdatedAt: Date };
  const [page] = await Pharmacy.aggregate<{ total: Array<{ count: number }>; rows: Row[] }>(pipeline).allowDiskUse(true).option({ maxTimeMS: 15000 });
  const rows = page?.rows || [];
  return { total: page?.total[0]?.count || 0, medicines: [...new Map(rows.map((row) => [String(row.medicine._id), publicMedicine(row.medicine)])).values()], results: rows.map((row) => {
    const medicine = publicMedicine(row.medicine);
    return { pharmacy: { id: String(row._id), name: row.name, address: row.address, pinCode: row.pinCode, city: row.city, state: row.state, coordinates: row.location.coordinates, phone: row.isDemo ? undefined : row.phone, verificationStatus: row.verificationStatus, isDemo: Boolean(row.isDemo), openingHours: row.openingHours, openingStatus: openingStatus(row.openingHours, row.holidayHours, now) },
      medicine: { id: medicine._id, name: medicine.name, brand: medicine.brand, genericName: medicine.genericName, composition: medicine.composition, strength: medicine.strength, dosageForm: medicine.dosageForm, manufacturer: medicine.manufacturer, packSize: medicine.packSize, prescriptionClass: medicine.prescriptionClass, isDemo: medicine.isDemo },
      ...(row.quantityDisplay === 'EXACT' ? { availableQuantity: row.batch.availableQuantity, displayedQuantity: row.batch.availableQuantity } : { displayedQuantity: row.batch.availableQuantity <= (row.quantityCap || 10) ? '1-' + (row.quantityCap || 10) : String(row.quantityCap || 10) + '+' }),
      freshness: row.freshness, confirmedAvailable: row.freshness === 'RECENTLY_UPDATED', lastUpdatedAt: row.lastUpdatedAt,
      ...(row.distanceMeters === undefined ? {} : { distanceKm: row.distanceMeters / 1000 }), price: row.batch.price, mrp: row.batch.mrp };
  }) };
}
