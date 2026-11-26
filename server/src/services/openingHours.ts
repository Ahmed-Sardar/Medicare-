import { z } from 'zod';
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }, 'Invalid calendar date');
const hours = { open: time, close: time, closed: z.boolean() };
const valid = (value: { open: string; close: string; closed: boolean }) => value.closed || value.open !== value.close;
export const weeklyHours = z.array(z.object({ day: z.number().int().min(0).max(6), ...hours }).strict().refine(valid, 'Opening and closing times must differ; an earlier closing time means next day')).length(7).refine((rows) => new Set(rows.map((row) => row.day)).size === 7, 'Include each weekday exactly once');
export const holidayHours = z.array(z.object({ date: day, label: z.string().trim().max(80).default(''), ...hours }).strict().refine(valid, 'Opening and closing times must differ')).max(100).refine((rows) => new Set(rows.map((row) => row.date)).size === rows.length, 'Holiday dates must be unique');
type Hours = { open?: string | null; close?: string | null; closed?: boolean | null };
export function openingStatus(weekly: Array<Hours & { day?: number | null }> = [], holidays: Array<Hours & { date?: string | null }> = [], now = new Date()): string {
  // Indian pharmacy schedules are interpreted in Asia/Kolkata, independent of server timezone.
  const shifted = new Date(now.getTime() + 330 * 60000); const date = shifted.toISOString().slice(0, 10); const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes(); const weekday = shifted.getUTCDay();
  const previousDate = new Date(shifted.getTime() - 86400000).toISOString().slice(0, 10);
  const override = holidays.find((row) => row.date === date);
  const current = override || weekly.find((row) => row.day === weekday);
  const previous = holidays.find((row) => row.date === previousDate) || weekly.find((row) => row.day === (weekday + 6) % 7);
  const parse = (value?: string | null) => value && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  if (override?.closed) return 'Listed closed today (date override)';
  if (previous && !previous.closed && parse(previous.close) < parse(previous.open) && minutes < parse(previous.close)) return `Listed open until ${previous.close} IST (overnight)`;
  if (!current) return 'Hours not provided for today';
  if (current.closed) return 'Listed closed today';
  const open = parse(current.open); const close = parse(current.close);
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === close) return 'Hours need confirmation';
  if (minutes >= open && (close < open || minutes < close)) return `Listed open until ${current.close} IST${close < open ? ' next day' : ''}`;
  return `Listed closed - today ${current.open} to ${current.close} IST${close < open ? ' next day' : ''}`;
}
