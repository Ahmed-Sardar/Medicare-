import type { AuthUser } from '../../middleware/auth.js';
import { permissionAllows } from '../../services/rbacCatalog.js';
import { ApiError } from '../../utils/errors.js';

export const auditFamilies = [
  { code: 'security', name: 'Account security and platform access', permission: 'audit:read:security', expression: /^(auth|user|role|settings|audit)\./ },
  { code: 'pharmacy', name: 'Pharmacy and stock operations', permission: 'audit:read:pharmacy', expression: /^(pharmacy|pharmacist|inventory|reservation)\./ },
  { code: 'catalogue', name: 'Medicine catalogue', permission: 'audit:read:catalogue', expression: /^(medicine|medicine_category)\./ },
  { code: 'support', name: 'Support operations', permission: 'audit:read:support', expression: /^support\./ },
  { code: 'reports', name: 'Report access', permission: 'audit:read:reports', expression: /^report\./ },
  { code: 'system', name: 'Other system events', permission: 'audit:read:system', expression: null },
] as const;
export type AuditFamily = typeof auditFamilies[number]['code'];
const knownExpressions = auditFamilies.flatMap((family) => family.expression ? [family.expression] : []);
export function familyOf(action: string): AuditFamily { return auditFamilies.find((family) => family.expression?.test(action))?.code || 'system'; }
export function auditScope(auth: AuthUser) {
  const has = (permission: string) => permissionAllows(auth.permissions, permission);
  if (!has('audit:read')) throw new ApiError(403, 'Audit access permission required');
  const families = auditFamilies.filter((family) => has(family.permission));
  return { families, canViewDetails: has('audit:read:details'), canViewIp: has('audit:read:ip'), canViewActorNames: has('user:read') };
}
export function auditFamilyFilter(families: ReadonlyArray<typeof auditFamilies[number]>): Record<string, unknown> {
  return { $or: families.length ? families.map((family) => family.expression ? { action: { $regex: family.expression } } : { action: { $not: new RegExp(knownExpressions.map((expression) => `(?:${expression.source})`).join('|')) } }) : [{ _id: { $exists: false } }] };
}
const metadataFields: Record<AuditFamily, string[]> = {
  security: ['reason', 'roles', 'previousRoles', 'active', 'previousActive', 'revision', 'permissions', 'previousPermissions', 'code', 'settings', 'locationCount', 'searchHistoryEnabled', 'filters', 'returned', 'eventId'],
  pharmacy: ['reason', 'role', 'permissions', 'fields', 'medicineId', 'quantity', 'importedRows', 'rejectedRows', 'minStock'],
  catalogue: ['reason', 'previousRevision', 'active', 'previousActive', 'classificationVerified', 'previousClassificationVerified', 'previousClassification', 'prescriptionClass', 'classificationSource', 'previousClassificationSource', 'categoryIds', 'previousCategoryIds', 'aliases', 'previousAliases', 'identityBefore', 'identityAfter', 'name', 'previousName', 'description', 'previousDescription'],
  support: ['reason', 'status', 'previousStatus', 'priority', 'assignedTo'],
  reports: ['from', 'to', 'medicineId', 'status', 'rows'], system: ['reason', 'status', 'count'],
};
const blockedKey = /password|token|secret|cookie|authorization|(?:document|storage|file)path|evidence|phone|email|address|^(?:query|body|comments?|resolutionNotes|prescription)$/i;
function boundedValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)} [truncated]` : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => boundedValue(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    if ('toHexString' in value && typeof value.toHexString === 'function') return value.toHexString();
    return Object.fromEntries(Object.entries(value).slice(0, 100).filter(([key]) => !blockedKey.test(key)).flatMap(([key, item]) => { const safe = boundedValue(item, depth + 1); return safe === undefined ? [] : [[key, safe]]; }));
  }
  return undefined;
}
export function auditMetadata(action: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => metadataFields[familyOf(action)].includes(key) && !blockedKey.test(key)).flatMap(([key, item]) => { const safe = boundedValue(item); return safe === undefined ? [] : [[key, safe]]; }));
}
