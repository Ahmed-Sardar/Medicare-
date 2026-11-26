import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AuditLog, SearchHistory, User } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';

export const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const locationInput = z.object({
  id: z.string().regex(/^[0-9a-f]{24}$/i).optional(), label: z.string().trim().min(1).max(60),
  pinCode: z.string().regex(/^[0-9]{6}$/).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(), longitude: z.number().finite().min(-180).max(180).optional(),
  isDefault: z.boolean(),
}).strict().refine((value) => (value.latitude === undefined) === (value.longitude === undefined), 'Supply both latitude and longitude')
  .refine((value) => value.pinCode || value.latitude !== undefined, 'Supply a PIN code or coordinates');
const settingsInput = z.object({
  revision: z.number().int().nonnegative(), name: z.string().trim().min(2).max(120), phone: z.string().regex(/^\+?[0-9]{10,15}$/).nullable(),
  locations: z.array(locationInput).max(10).refine((items) => items.filter((item) => item.isDefault).length <= 1, 'Choose at most one default location')
    .refine((items) => new Set(items.flatMap((item) => item.id ? [item.id.toLowerCase()] : [])).size === items.filter((item) => item.id).length, 'Location IDs must be unique'),
  preferences: z.object({ searchRadiusKm: z.number().int().min(1).max(50), searchView: z.enum(['list', 'map']), recordSearchHistory: z.boolean() }).strict(),
}).strict();

type SettingsUser = InstanceType<typeof User>;
function settingsResponse(user: SettingsUser) {
  return { revision: user.settingsRevision ?? 0, name: user.name, email: user.email ?? '', phone: user.phone ?? null,
    preferences: { searchRadiusKm: user.preferences?.searchRadiusKm ?? 10, searchView: user.preferences?.searchView ?? 'list', recordSearchHistory: user.preferences?.recordSearchHistory ?? true },
    locations: user.savedLocations.map((entry) => ({ id: String(entry._id), label: entry.label || 'Saved location', ...(entry.pinCode ? { pinCode: entry.pinCode } : {}),
      ...(entry.location?.coordinates?.length === 2 ? { longitude: entry.location.coordinates[0], latitude: entry.location.coordinates[1] } : {}), isDefault: Boolean(entry.isDefault) })),
  };
}
const settingsFields = 'name email phone preferences savedLocations settingsRevision';
usersRouter.get('/me/settings', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.auth!.id, active: true }).select(settingsFields);
  if (!user) throw new ApiError(401, 'Account is unavailable');
  res.json({ success: true, data: settingsResponse(user) });
}));
usersRouter.put('/me/settings', asyncHandler(async (req, res) => {
  const input = settingsInput.parse(req.body); const session = await User.startSession(); let result: ReturnType<typeof settingsResponse> | undefined;
  try { await session.withTransaction(async () => {
    const current = await User.findOne({ _id: req.auth!.id, active: true }).session(session).select(settingsFields);
    if (!current) throw new ApiError(401, 'Account is unavailable');
    if ((current.settingsRevision ?? 0) !== input.revision) throw new ApiError(409, 'Settings changed elsewhere. Reload before saving.', 'SETTINGS_CONFLICT');
    const existingIds = new Set(current.savedLocations.map((entry) => String(entry._id)));
    if (input.locations.some((entry) => entry.id && !existingIds.has(entry.id.toLowerCase()))) throw new ApiError(400, 'Unknown saved location');
    const revisionFilter = input.revision === 0 ? { $or: [{ settingsRevision: 0 }, { settingsRevision: { $exists: false } }] } : { settingsRevision: input.revision };
    const user = await User.findOneAndUpdate({ _id: current.id, active: true, ...revisionFilter }, { $set: {
      name: input.name, ...(input.phone ? { phone: input.phone } : {}), preferences: input.preferences,
      savedLocations: input.locations.map((entry) => ({ _id: entry.id ? new Types.ObjectId(entry.id) : new Types.ObjectId(), label: entry.label, pinCode: entry.pinCode,
        ...(entry.latitude !== undefined && entry.longitude !== undefined ? { location: { type: 'Point', coordinates: [entry.longitude, entry.latitude] } } : {}), isDefault: entry.isDefault })),
    }, ...(!input.phone ? { $unset: { phone: 1 } } : {}), $inc: { settingsRevision: 1 } }, { new: true, session, runValidators: true }).select(settingsFields);
    if (!user) throw new ApiError(409, 'Settings changed elsewhere. Reload before saving.', 'SETTINGS_CONFLICT');
    if (!input.preferences.recordSearchHistory) await SearchHistory.deleteMany({ userId: current.id }).session(session);
    await AuditLog.create([{ actorId: current.id, action: 'user.settings.updated', resourceType: 'User', resourceId: current.id,
      metadata: { locationCount: input.locations.length, searchHistoryEnabled: input.preferences.recordSearchHistory }, ipAddress: req.ip }], { session });
    result = settingsResponse(user);
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: result });
}));
