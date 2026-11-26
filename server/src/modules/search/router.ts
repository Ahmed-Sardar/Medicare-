import { Router } from 'express';
import { z } from 'zod';
import { Medicine, SearchHistory } from '../models.js';
import { authenticate, optionalAuthentication } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Types } from 'mongoose';
import { findAvailability } from './availability.js';
import { ApiError } from '../../utils/errors.js';
import { env } from '../../config/env.js';

import { publicMedicine } from '../medicines/publicView.js';
import { clearSearchHistory, recordSearch } from '../../services/searchHistory.js';

export const searchRouter = Router();
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const medicineFields = ['name', 'brand', 'genericName', 'composition', 'manufacturer', 'strength', 'dosageForm', 'aliases'];
const searchText = z.string().trim().min(2).max(100).refine((value) => value.split(/\s+/).length <= 8, 'Use at most eight search terms');
function queryFilter(query: string): Record<string, unknown> {
  const words = query.trim().split(/\s+/);
  return { active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }), $and: words.map((word) => { const expression = new RegExp(escapeRegex(word), 'i'); return { $or: medicineFields.map((field) => ({ [field]: expression })) }; }) };
}
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}

// Approximate matches are suggestions only; availability is never substituted automatically.
searchRouter.get('/suggestions', asyncHandler(async (req, res) => {
  const query = searchText.parse(req.query.q);
  const projection = 'name brand genericName composition strength dosageForm manufacturer packSize aliases prescriptionClass classificationVerified classificationSource classificationReviewedAt classificationReviewedBy isDemo';
  const direct = await Medicine.find(queryFilter(query)).select(projection).sort({ name: 1, _id: 1 }).limit(10).lean();
  let suggestions = direct.map((medicine) => ({ ...publicMedicine(medicine), matchType: 'partial' }));
  const approximateLimited = false;
  if (!direct.length && /^[a-z]{4,40}$/i.test(query)) {
    const candidates = Medicine.find({ active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }) }).select(projection).sort({ name: 1, _id: 1 }).maxTimeMS(15000).lean().cursor();
    const threshold = query.length >= 8 ? 2 : 1;
    const deadline = Date.now() + 15000;
    const best: Array<{ medicine: Parameters<typeof publicMedicine>[0]; score: number }> = [];
    for await (const medicine of candidates) {
      if (Date.now() > deadline) { await candidates.close(); throw new ApiError(503, 'Suggestion search exceeded its time limit. Refine the query.', 'QUERY_TIMEOUT'); }
      const words = [medicine.name, medicine.brand, medicine.genericName, ...(medicine.aliases || [])].filter((value): value is string => typeof value === 'string').flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean);
      const score = Math.min(99, ...words.map((word) => distance(query.toLowerCase(), word)));
      if (score <= threshold) { best.push({ medicine, score }); best.sort((a, b) => a.score - b.score || a.medicine.name.localeCompare(b.medicine.name) || String(a.medicine._id).localeCompare(String(b.medicine._id))); if (best.length > 10) best.pop(); }
    }
    suggestions = best.map(({ medicine }) => ({ ...publicMedicine(medicine), matchType: 'approximate' }));
  }
  res.json({ success: true, data: { suggestions, approximateLimited } });
}));

searchRouter.get('/', optionalAuthentication, asyncHandler(async (req, res) => {
  const input = z.object({
    q: z.string().trim().max(160).optional(), medicineId: z.string().regex(/^[0-9a-f]{24}$/i).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20),
    lat: z.coerce.number().finite().min(-90).max(90).optional(), lng: z.coerce.number().finite().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().finite().min(1).max(50).default(10), pinCode: z.string().regex(/^[0-9]{6}$/).optional(),
    sort: z.enum(['distance', 'price', 'freshness']).default('distance'), availability: z.enum(['all', 'reservable']).default('all'),
    freshness: z.enum(['all', 'RECENTLY_UPDATED', 'NEEDS_CONFIRMATION', 'STALE_WARNING', 'UNAVAILABLE_FOR_CONFIRMED_SEARCH']).default('all'),
  }).parse(req.query);
  if ((input.lat === undefined) !== (input.lng === undefined)) throw new ApiError(400, 'Latitude and longitude must be supplied together');
  const query = input.medicineId ? input.q : searchText.parse(input.q);
  const filter = input.medicineId ? { _id: new Types.ObjectId(input.medicineId), active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }) } : queryFilter(query!);
  const matches = await Medicine.find(filter).select('name').limit(2).lean();
  if (input.sort === 'price' && matches.length > 1) throw new ApiError(400, 'Select a specific medicine before sorting by price');
  if (req.auth && input.page === 1 && (!input.medicineId || matches.length)) await recordSearch(req.auth.id, input.medicineId ? matches[0]!.name.slice(0, 100) : query!, input.medicineId);
  const result = matches.length ? await findAvailability(input, filter) : { medicines: [], results: [], total: 0 };
  res.json({ success: true, data: { ...result, page: input.page, limit: input.limit, coverageLimited: false, notices: [], notice: 'Availability is reported by participating pharmacies and must be confirmed by the pharmacy before travel.' } });
}));

searchRouter.get('/history', authenticate, asyncHandler(async (req, res) => { const history = await SearchHistory.find({ userId: req.auth!.id }).select('query medicineId createdAt').sort({ createdAt: -1, _id: -1 }).limit(20); res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: { history } }); }));
searchRouter.delete('/history', authenticate, asyncHandler(async (req, res) => { await clearSearchHistory(req.auth!.id); res.json({ success: true, data: { cleared: true } }); }));
