const locationSchema = {
  type: 'object', additionalProperties: false, required: ['label', 'isDefault'],
  description: 'Provide a six-digit PIN code, a coordinate pair, or both. IDs may only refer to this account’s existing saved locations. Omit the ID to create a location.',
  properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }, label: { type: 'string', minLength: 1, maxLength: 60 },
    pinCode: { type: 'string', pattern: '^[0-9]{6}$' }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, isDefault: { type: 'boolean' } },
  dependentRequired: { latitude: ['longitude'], longitude: ['latitude'] }, anyOf: [{ required: ['pinCode'] }, { required: ['latitude', 'longitude'] }],
};
const properties = {
  revision: { type: 'integer', minimum: 0, description: 'Revision returned by the most recent GET or PUT. A stale revision is rejected.' },
  name: { type: 'string', minLength: 2, maxLength: 120 }, phone: { anyOf: [{ type: 'string', pattern: '^\\+?[0-9]{10,15}$' }, { type: 'null' }] },
  locations: { type: 'array', maxItems: 10, items: locationSchema, description: 'Complete replacement list; at most one entry may be the default. Omitting an existing entry removes it.' },
  preferences: { type: 'object', additionalProperties: false, required: ['searchRadiusKm', 'searchView', 'recordSearchHistory'], properties: {
    searchRadiusKm: { type: 'integer', minimum: 1, maximum: 50 }, searchView: { type: 'string', enum: ['list', 'map'] },
    recordSearchHistory: { type: 'boolean', description: 'Setting false deletes existing account search history and prevents future account search recording.' },
  } },
};
const settingsResponse = { description: 'Current account settings. Responses use Cache-Control: no-store.', content: { 'application/json': { schema: {
  type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: { type: 'object', required: [...Object.keys(properties), 'email'], properties: { ...properties, email: { type: 'string', description: 'Read-only sign-in address, or an empty string.' } } } },
} } } };
const security = [{ cookieAuth: [] }];
export const userSettingsPaths = {
  '/users/me/settings': {
    get: { summary: 'Read own profile, saved locations and search preferences', security, responses: { '200': settingsResponse, '401': { description: 'Authentication required' } } },
    put: { summary: 'Replace own profile and search settings', description: 'Only the authenticated account is changed. Validation, revision check, history opt-out deletion and the audit record commit together. MongoDB transactions require a replica set.', security,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } } } },
      responses: { '200': settingsResponse, '400': { description: 'Invalid input or unknown saved location' }, '401': { description: 'Authentication required' }, '409': { description: 'Stale settings revision or phone number already in use' } },
    },
  },
  '/search/history': {
    get: { summary: 'Read the latest 20 searches belonging to this account', security, responses: { '200': { description: 'Success envelope containing data.history: records with _id, query, optional medicineId and createdAt. Newest first. Cache-Control: no-store.' }, '401': { description: 'Authentication required' } } },
    delete: { summary: 'Clear own account search history', description: 'Deletion and concurrent search recording are serialized through an account write. This does not disable future recording; use profile settings to opt out.', security,
      responses: { '200': { description: 'Success envelope containing data.cleared: true' }, '401': { description: 'Authentication required' } },
    },
  },
};
