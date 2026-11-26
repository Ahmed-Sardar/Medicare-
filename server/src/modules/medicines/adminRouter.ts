import { Router } from 'express';
import { z } from 'zod';
import { AuditLog, Inventory, Medicine, MedicineCategory, Reservation } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { catalogueFilter, categoryInput, identityFields, medicineInput, normalizedCategoryName, objectId, revisionFilter } from './contracts.js';

export const catalogueAdminRouter = Router();
catalogueAdminRouter.use(['/medicines', '/medicine-categories'], authenticate, requirePermission('medicine:manage'), (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const listInput = z.object({ q: z.string().trim().max(100).optional(), active: z.enum(['all', 'true', 'false']).default('all'), categoryId: objectId.optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

catalogueAdminRouter.get('/medicines', asyncHandler(async (req, res) => {
  const input = listInput.parse(req.query); const filter = { ...catalogueFilter(input.q), ...(input.active !== 'all' ? { active: input.active === 'true' } : {}), ...(input.categoryId ? { categoryIds: input.categoryId } : {}) };
  const [medicines, total] = await Promise.all([Medicine.find(filter).sort({ name: 1, _id: 1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(), Medicine.countDocuments(filter)]);
  const ids = medicines.map((medicine) => medicine._id);
  const [stocked, requested] = await Promise.all([Inventory.distinct('medicineId', { medicineId: { $in: ids } }), Reservation.distinct('medicineId', { medicineId: { $in: ids } })]);
  const used = new Set([...stocked, ...requested].map(String));
  const categories = await MedicineCategory.find({ _id: { $in: medicines.flatMap((medicine) => medicine.categoryIds || []) } }).select('name active').lean();
  res.json({ success: true, data: { medicines: medicines.map((medicine) => ({ ...medicine, categoryIds: medicine.categoryIds || [], categories: categories.filter((category) => (medicine.categoryIds || []).some((id) => String(id) === String(category._id))), identityLocked: Boolean(medicine.identityLocked || used.has(String(medicine._id))), revision: medicine.revision ?? 0 })), total, page: input.page, limit: input.limit } });
}));
catalogueAdminRouter.get('/medicines/:id', asyncHandler(async (req, res) => {
  const id = objectId.parse(req.params.id); const medicine = await Medicine.findById(id).lean(); if (!medicine) throw new ApiError(404, 'Medicine not found');
  const locked = medicine.identityLocked || Boolean(await Inventory.exists({ medicineId: id })) || Boolean(await Reservation.exists({ medicineId: id }));
  const categories = await MedicineCategory.find({ _id: { $in: medicine.categoryIds || [] } }).select('name active').lean();
  res.json({ success: true, data: { medicine: { ...medicine, categoryIds: medicine.categoryIds || [], categories, identityLocked: Boolean(locked), revision: medicine.revision ?? 0 } } });
}));

async function writeMedicine(req: import('express').Request, id?: string) {
  const { reason, revision, ...fields } = medicineInput.parse(req.body);
  if (id && revision === undefined) throw new ApiError(400, 'The current medicine revision is required');
  if (!id && revision !== undefined) throw new ApiError(400, 'New medicines do not have a revision');
  const session = await Medicine.startSession(); let medicineId = '';
  try { await session.withTransaction(async () => {
    const prior = id ? await Medicine.findById(id).session(session) : null;
    if (id && !prior) throw new ApiError(404, 'Medicine not found');
    if (prior && (prior.revision ?? 0) !== revision) throw new ApiError(409, 'Medicine changed; reload before saving', 'CATALOGUE_CONFLICT');
    if (prior?.isDemo && fields.classificationVerified) throw new ApiError(409, 'Demo medicine classifications cannot be marked verified');
    const categories = await MedicineCategory.find({ _id: { $in: fields.categoryIds } }).select('_id active').session(session);
    const previousCategories = new Set(prior?.categoryIds.map(String) || []);
    if (fields.categoryIds.some((categoryId) => !categories.some((category) => category.id === categoryId && (category.active || previousCategories.has(categoryId))))) throw new ApiError(400, 'Select existing active categories for new category links');
    const locked = Boolean(prior && (prior.identityLocked || await Inventory.exists({ medicineId: prior.id }).session(session) || await Reservation.exists({ medicineId: prior.id }).session(session)));
    if (locked && prior && identityFields.some((field) => (prior[field] || '').trim() !== fields[field])) throw new ApiError(409, 'Medicine identity is locked by stock or reservation history. Create a separate catalogue entry for a different product.', 'MEDICINE_IDENTITY_LOCKED');
    const classificationChanged = !prior || prior.prescriptionClass !== fields.prescriptionClass || Boolean(prior.classificationVerified) !== fields.classificationVerified || (prior.classificationSource || '') !== fields.classificationSource || !prior.classificationReviewedAt || !prior.classificationReviewedBy;
    const verified = fields.classificationVerified ? { classificationReviewedAt: classificationChanged ? new Date() : prior!.classificationReviewedAt, classificationReviewedBy: classificationChanged ? req.auth!.id : prior!.classificationReviewedBy } : { classificationReviewedAt: null, classificationReviewedBy: null };
    const values = { ...fields, ...verified, identityLocked: locked, updatedBy: req.auth!.id };
    if (prior) {
      const updated = await Medicine.findOneAndUpdate({ _id: prior.id, ...revisionFilter(revision!) }, { $set: values, $inc: { revision: 1 } }, { new: true, runValidators: true, session });
      if (!updated) throw new ApiError(409, 'Medicine changed; reload before saving', 'CATALOGUE_CONFLICT'); medicineId = updated.id;
    } else { const [created] = await Medicine.create([{ ...values, revision: 0 }], { session }); medicineId = created!.id; }
    await AuditLog.create([{ actorId: req.auth!.id, action: `medicine.${prior ? 'updated' : 'created'}`, resourceType: 'Medicine', resourceId: medicineId, ipAddress: req.ip,
      metadata: { reason, previousRevision: prior?.revision ?? null, active: fields.active, previousActive: prior?.active ?? null, classificationVerified: fields.classificationVerified, previousClassificationVerified: prior?.classificationVerified ?? false, previousClassification: prior?.prescriptionClass ?? null, prescriptionClass: fields.prescriptionClass, classificationSource: fields.classificationSource, previousClassificationSource: prior?.classificationSource ?? null, categoryIds: fields.categoryIds,
        previousCategoryIds: prior?.categoryIds || [], previousAliases: prior?.aliases || [], aliases: fields.aliases, identityBefore: prior ? Object.fromEntries(identityFields.map((field) => [field, prior[field] || ''])) : null, identityAfter: Object.fromEntries(identityFields.map((field) => [field, fields[field]])) } }], { session });
  }); } finally { await session.endSession(); }
  return Medicine.findById(medicineId);
}
catalogueAdminRouter.post('/medicines', asyncHandler(async (req, res) => { res.status(201).json({ success: true, data: { medicine: await writeMedicine(req) } }); }));
catalogueAdminRouter.patch('/medicines/:id', asyncHandler(async (req, res) => { res.json({ success: true, data: { medicine: await writeMedicine(req, objectId.parse(req.params.id)) } }); }));

catalogueAdminRouter.get('/medicine-categories', asyncHandler(async (req, res) => {
  const input = listInput.parse(req.query); const filter = { ...(input.q ? { normalizedName: { $regex: input.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}), ...(input.active !== 'all' ? { active: input.active === 'true' } : {}) };
  const [categories, total] = await Promise.all([MedicineCategory.find(filter).sort({ name: 1, _id: 1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(), MedicineCategory.countDocuments(filter)]);
  res.json({ success: true, data: { categories, total, page: input.page, limit: input.limit } });
}));
async function writeCategory(req: import('express').Request, id?: string) {
  const { reason, revision, ...fields } = categoryInput.parse(req.body);
  if (id && revision === undefined) throw new ApiError(400, 'The current category revision is required');
  if (!id && revision !== undefined) throw new ApiError(400, 'New categories do not have a revision');
  const session = await MedicineCategory.startSession(); let categoryId = '';
  try { await session.withTransaction(async () => {
    const prior = id ? await MedicineCategory.findById(id).session(session) : null;
    if (id && !prior) throw new ApiError(404, 'Category not found');
    if (prior && (prior.revision ?? 0) !== revision) throw new ApiError(409, 'Category changed; reload before saving', 'CATALOGUE_CONFLICT');
    const values = { ...fields, normalizedName: normalizedCategoryName(fields.name), updatedBy: req.auth!.id };
    if (prior) {
      const updated = await MedicineCategory.findOneAndUpdate({ _id: prior.id, ...revisionFilter(revision!) }, { $set: values, $inc: { revision: 1 } }, { new: true, session, runValidators: true });
      if (!updated) throw new ApiError(409, 'Category changed; reload before saving', 'CATALOGUE_CONFLICT'); categoryId = updated.id;
    } else { const [created] = await MedicineCategory.create([{ ...values, revision: 0 }], { session }); categoryId = created!.id; }
    await AuditLog.create([{ actorId: req.auth!.id, action: `medicine_category.${prior ? 'updated' : 'created'}`, resourceType: 'MedicineCategory', resourceId: categoryId, metadata: { reason, active: fields.active, previousActive: prior?.active ?? null, previousName: prior?.name ?? null, name: fields.name, previousDescription: prior?.description ?? null, description: fields.description }, ipAddress: req.ip }], { session });
  }); } finally { await session.endSession(); }
  return MedicineCategory.findById(categoryId);
}
catalogueAdminRouter.post('/medicine-categories', asyncHandler(async (req, res) => { res.status(201).json({ success: true, data: { category: await writeCategory(req) } }); }));
catalogueAdminRouter.patch('/medicine-categories/:id', asyncHandler(async (req, res) => { res.json({ success: true, data: { category: await writeCategory(req, objectId.parse(req.params.id)) } }); }));
