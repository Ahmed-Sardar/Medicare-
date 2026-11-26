import { AuditLog } from '../modules/models.js';
export async function recordAudit(input: { actorId?: string; action: string; resourceType?: string; resourceId?: string; pharmacyId?: string; metadata?: Record<string, unknown>; ipAddress?: string }): Promise<void> {
  await AuditLog.create({ actorId: input.actorId, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId, pharmacyId: input.pharmacyId, metadata: input.metadata, ipAddress: input.ipAddress });
}
