import { env } from '../config/env.js';
import { SystemSetting } from '../modules/models.js';
import { z } from 'zod';
export type FreshnessThresholds = { recentMinutes: number; confirmMinutes: number; staleMinutes: number };
export type ReservationSettings = { holdMinutes: number; pickupDeadlineHours: number };
const defaults: FreshnessThresholds = { recentMinutes: env.INVENTORY_RECENT_MINUTES, confirmMinutes: env.INVENTORY_CONFIRM_MINUTES, staleMinutes: env.INVENTORY_STALE_MINUTES };
let cached: { value: FreshnessThresholds; expiresAt: number } | undefined;
let reservationCached: { value: ReservationSettings; expiresAt: number } | undefined;
export async function getFreshnessThresholds(): Promise<FreshnessThresholds> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const setting = await SystemSetting.findOne({ key: 'inventoryFreshness' }).lean(); const raw = z.object({ recentMinutes: z.number().int().positive(), confirmMinutes: z.number().int().positive(), staleMinutes: z.number().int().positive() }).safeParse(setting?.value);
  const value = raw.success && raw.data.recentMinutes <= raw.data.confirmMinutes && raw.data.confirmMinutes <= raw.data.staleMinutes ? raw.data : defaults;
  cached = { value, expiresAt: Date.now() + 30_000 }; return value;
}
export function invalidateSettingsCache(): void { cached = undefined; }
export async function getReservationSettings(): Promise<ReservationSettings> {
  if (reservationCached && reservationCached.expiresAt > Date.now()) return reservationCached.value;
  const setting = await SystemSetting.findOne({ key: 'reservationOperations' }).lean(); const raw = z.object({ holdMinutes: z.number().int().positive(), pickupDeadlineHours: z.number().int().positive() }).safeParse(setting?.value);
  const value = raw.success ? raw.data : { holdMinutes: env.RESERVATION_HOLD_MINUTES, pickupDeadlineHours: env.PICKUP_DEADLINE_HOURS };
  reservationCached = { value, expiresAt: Date.now() + 30_000 }; return value;
}
export function invalidateReservationSettingsCache(): void { reservationCached = undefined; }
