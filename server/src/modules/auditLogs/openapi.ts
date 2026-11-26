const security = [{ cookieAuth: [] }];
const idSchema = { type: 'string', pattern: '^[0-9a-fA-F]{24}$' };
const parameters = [
  ...['from', 'to'].map((name) => ({ name, in: 'query', schema: { type: 'string', format: 'date' }, description: 'Inclusive UTC calendar date; defaults to the latest 30 days. Maximum interval 366 days; to cannot be future.' })),
  ...['actorId', 'pharmacyId', 'resourceId'].map((name) => ({ name, in: 'query', schema: idSchema })),
  { name: 'family', in: 'query', schema: { type: 'string', enum: ['security', 'pharmacy', 'catalogue', 'support', 'reports', 'system'] } },
  { name: 'action', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[A-Za-z0-9_.:-]+$' }, description: 'Exact action code' },
  { name: 'resourceType', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z][A-Za-z0-9_]*$' } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
];
const failures = { '400': { description: 'Invalid filters, date range or cursor (INVALID_AUDIT_CURSOR)' }, '401': { description: 'Authentication required' }, '403': { description: 'audit:read plus at least one event-group grant required; explicitly forbidden groups/actions are rejected' } };
export const auditLogPaths = {
  '/admin/audit-logs': { get: { summary: 'Read permitted audit summaries with cursor pagination', security,
    description: 'No-store. Requires audit:read and corresponding audit:read:<family> grants. Sorts createdAt and _id descending. Lists never contain metadata or IP addresses. Actor names additionally require user:read. Reading is audited. Unknown query keys are rejected.',
    parameters: [...parameters, { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 2000 }, description: 'Opaque signed cursor, valid for one hour and bound to user, normalized filters, limit and current permitted groups. Omit to refresh the time cutoff.' }],
    responses: { '200': { description: 'Success envelope data: { logs: [{ _id, action, family, createdAt, actor: { id, name? } | null, pharmacyId, resourceType, resourceId }], currentCursor, nextCursor: string | null, snapshotAt, period: { from, to }, limit, canViewDetails, canViewIp }. Cutoff pagination is not a historical database snapshot.' }, ...failures },
  } },
  '/admin/audit-logs/options': { get: { summary: 'Read permitted audit filter suggestions', security, parameters,
    description: 'Same scope and filters as the list; cursor is forbidden. Suggestions reflect the submitted filters. Each action/resource-type list is capped at 200. No-store.',
    responses: { '200': { description: 'Success envelope data: { families: [{ code, name }], actions: string[], resourceTypes: string[], optionsLimited, period, canViewDetails, canViewIp }' }, ...failures },
  } },
  '/admin/audit-logs/{id}': { get: { summary: 'Read a permitted audit event', security, parameters: [{ name: 'id', in: 'path', required: true, schema: idSchema }],
    description: 'Rechecks event-group scope. Metadata is included only with audit:read:details, projected through a bounded group allowlist and credential/private-field filtering. Free text is not automatically anonymized. IP requires audit:read:ip (super administrator only). No raw metadata endpoint. Reads are audited; no-store.',
    responses: { '200': { description: 'Success envelope data: { event: { ...summary, metadata?, ipAddress? }, canViewDetails, canViewIp }' }, ...failures, '404': { description: 'Event absent or outside permitted groups' } },
  } },
};
