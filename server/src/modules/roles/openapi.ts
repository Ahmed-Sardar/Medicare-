import { roleCodes } from '../../services/rbacCatalog.js';
const security = [{ cookieAuth: [] }];
const identifier = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } };
const revision = { type: 'integer', minimum: 0 };
const reason = { type: 'string', minLength: 5, maxLength: 500 };
const accessResponses = { '200': { description: 'Success envelope containing data.user: { id, roles, active, accessRevision, changed }. Changed accounts must sign in again.' },
  '400': { description: 'Invalid input' }, '401': { description: 'Authentication required' }, '403': { description: 'Insufficient or changed administrator authority' }, '404': { description: 'Account not found' },
  '409': { description: 'Stale revision, self-change, protected ownership/assignment, unsafe administrator appointment, demo promotion or last-super-administrator conflict' } };
export const roleAdministrationPaths = {
  '/admin/users/{id}': { get: { summary: 'Read account identity, access and permitted pharmacy assignments', security, parameters: [identifier,
    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }],
    description: 'Requires user:read. Excludes authentication fields, private locations and searches. Assignment records additionally require pharmacy:review or pharmacy:manage; otherwise assignments and assignmentTotal are null. Includes revoked assignments. Read is audited; no-store. Unknown query keys are rejected.',
    responses: { '200': { description: 'Success envelope data: { user: { _id, name, email, phone?, roles, active, emailVerifiedAt?, createdAt, updatedAt, accessRevision, isDemo? }, assignments: array | null, assignmentTotal: integer | null, page, limit }. Assignment summaries include _id, pharmacyId (populated name/city/verificationStatus/isDemo), role, permissions, active and createdAt.' },
      '400': { description: 'Invalid ID or pagination' }, '401': { description: 'Authentication required' }, '403': { description: 'User directory permission required' }, '404': { description: 'Account not found' } },
  } },
  '/admin/roles': { get: { summary: 'List built-in role policies and implemented permission catalogue', security, responses: { '200': { description: 'data.roles includes revision, permissions, allowedPermissions, fixedPermissions and defaultPermissions; data.permissions contains permission metadata.' }, '403': { description: 'Super administrator required' } } } },
  '/admin/roles/{code}': { put: { summary: 'Replace a role permission policy', description: 'Super administrator only. Scope ceilings and fixed ownership permissions are enforced. SUPER_ADMIN cannot be edited. Policy, revision and audit commit together.', security,
    parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string', enum: roleCodes } }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['revision', 'permissions', 'reason'], properties: { revision, permissions: { type: 'array', maxItems: 50, items: { type: 'string' } }, reason } } } } },
    responses: { '200': { description: 'data.role contains the saved policy and new revision' }, '400': { description: 'Invalid or out-of-scope permissions' }, '403': { description: 'Super administrator required' }, '409': { description: 'Immutable policy or stale revision' } },
  } },
  '/admin/users/{id}/access': { patch: { summary: 'Replace account roles and optionally change activation', description: 'Requires user:roles:manage and additionally user:manage when active is supplied. Only a super administrator can manage administrative accounts. A current access revision and reason are mandatory.', security, parameters: [identifier],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['revision', 'roles', 'reason'], properties: { revision, roles: { type: 'array', minItems: 1, maxItems: roleCodes.length, items: { type: 'string', enum: roleCodes } }, active: { type: 'boolean' }, reason } } } } }, responses: accessResponses,
  } },
  '/admin/users/{id}/active': { patch: { summary: 'Change account activation', security, parameters: [identifier], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['revision', 'active', 'reason'], properties: { revision, active: { type: 'boolean' }, reason } } } } }, responses: accessResponses } },
};
