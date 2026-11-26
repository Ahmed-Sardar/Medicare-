import { env } from '../config/env.js';
import type { FreshnessThresholds } from './settings.js';
export type FreshnessStatus = 'RECENTLY_UPDATED' | 'NEEDS_CONFIRMATION' | 'STALE_WARNING' | 'UNAVAILABLE_FOR_CONFIRMED_SEARCH';
export function classifyFreshness(lastUpdatedAt: Date, now = new Date(), thresholds: FreshnessThresholds = { recentMinutes: env.INVENTORY_RECENT_MINUTES, confirmMinutes: env.INVENTORY_CONFIRM_MINUTES, staleMinutes: env.INVENTORY_STALE_MINUTES }): FreshnessStatus {
  const age = Math.max(0, now.getTime() - lastUpdatedAt.getTime()) / 60000;
  if (age <= thresholds.recentMinutes) return 'RECENTLY_UPDATED';
  if (age <= thresholds.confirmMinutes) return 'NEEDS_CONFIRMATION';
  if (age <= thresholds.staleMinutes) return 'STALE_WARNING';
  return 'UNAVAILABLE_FOR_CONFIRMED_SEARCH';
}
export function isFreshEnoughForConfirmedAvailability(status: FreshnessStatus): boolean { return status === 'RECENTLY_UPDATED'; }
