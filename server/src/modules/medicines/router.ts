import { Router } from 'express';
import { z } from 'zod';
import { Medicine, MedicineCategory } from '../models.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { catalogueFilter, objectId } from './contracts.js';
import { publicMedicine } from './publicView.js';
export const medicinesRouter = Router();
export const medicineCategoriesRouter = Router();
const query = z.object({ q: z.string().trim().max(100).optional(), categoryId: objectId.optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
medicinesRouter.get('/', asyncHandler(async (req, res) => {
  const input = query.parse(req.query); const filter = { active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }), ...catalogueFilter(input.q), ...(input.categoryId ? { categoryIds: input.categoryId } : {}) };
  if (input.categoryId && !await MedicineCategory.exists({ _id: input.categoryId, active: true })) throw new ApiError(404, 'Active category not found');
  const [medicines, total] = await Promise.all([Medicine.find(filter).sort({ name: 1, _id: 1 }).skip((input.page - 1) * input.limit).limit(input.limit), Medicine.countDocuments(filter)]);
  const categories = await MedicineCategory.find({ _id: { $in: medicines.flatMap((medicine) => medicine.categoryIds) }, active: true }).select('name');
  res.json({ success: true, data: { medicines: medicines.map((medicine) => publicMedicine(medicine, categories.filter((category) => medicine.categoryIds.some((id) => String(id) === category.id)).map((category) => ({ id: category.id, name: category.name })))), page: input.page, limit: input.limit, total } });
}));
medicinesRouter.get('/:id', asyncHandler(async (req, res) => {
  const medicine = await Medicine.findOne({ _id: objectId.parse(req.params.id), active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }) });
  if (!medicine) throw new ApiError(404, 'Medicine not found');
  const categories = await MedicineCategory.find({ _id: { $in: medicine.categoryIds }, active: true }).select('name');
  res.json({ success: true, data: { medicine: publicMedicine(medicine, categories.map((category) => ({ id: category.id, name: category.name }))) } });
}));
medicineCategoriesRouter.get('/', asyncHandler(async (req, res) => {
  const input = query.parse(req.query); const filter = { active: true, ...(input.q ? { normalizedName: { $regex: input.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {}) };
  const [categories, total] = await Promise.all([MedicineCategory.find(filter).select('name description').sort({ name: 1, _id: 1 }).skip((input.page - 1) * input.limit).limit(input.limit), MedicineCategory.countDocuments(filter)]);
  res.json({ success: true, data: { categories, total, page: input.page, limit: input.limit } });
}));
