import { z } from 'zod';
export const objectId = z.string().regex(/^[0-9a-f]{24}$/i).transform((value) => value.toLowerCase());
export const revisionFilter = (revision: number) => revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision };
const text = (length: number) => z.string().trim().max(length).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Use plain text without control characters');
export const medicineFields = z.object({
  name: text(160).pipe(z.string().min(2)), brand: text(160).default(''), genericName: text(200).default(''), composition: text(500).default(''),
  strength: text(100).pipe(z.string().min(1)), dosageForm: text(100).pipe(z.string().min(1)), manufacturer: text(200).default(''), packSize: text(100).default(''),
  aliases: z.array(text(120).pipe(z.string().min(2))).max(30).default([]).transform((values) => [...new Map(values.map((value) => [value.toLocaleLowerCase('en-IN'), value])).values()]),
  categoryIds: z.array(objectId).max(10).default([]).transform((values) => [...new Set(values)]),
  prescriptionClass: z.enum(['OTC', 'PRESCRIPTION', 'CONTROLLED', 'UNVERIFIED']).default('UNVERIFIED'),
  classificationVerified: z.boolean().default(false), classificationSource: text(500).default(''), active: z.boolean().default(true),
});
export const auditReason = text(500).pipe(z.string().min(5));
export const medicineInput = medicineFields.extend({ revision: z.number().int().nonnegative().optional(), reason: auditReason }).strict()
  .refine((value) => !value.classificationVerified || (value.prescriptionClass !== 'UNVERIFIED' && value.classificationSource.length >= 5), 'Verified classification requires a classification and source reference');
export const categoryInput = z.object({ name: text(100).pipe(z.string().min(2)), description: text(500).default(''), active: z.boolean().default(true), revision: z.number().int().nonnegative().optional(), reason: auditReason }).strict();
export const identityFields = ['name', 'brand', 'genericName', 'composition', 'strength', 'dosageForm', 'manufacturer', 'packSize'] as const;
export const normalizedCategoryName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
export function catalogueFilter(q?: string): Record<string, unknown> {
  if (!q) return {};
  const expression = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return { $or: [...identityFields, 'aliases'].map((field) => ({ [field]: expression })) };
}
