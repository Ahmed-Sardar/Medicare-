export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED', public details?: unknown) { super(message); this.name = 'ApiError'; }
}
export const notFound = (message = 'Resource not found') => new ApiError(404, message, 'NOT_FOUND');
export const forbidden = (message = 'You are not allowed to perform this action') => new ApiError(403, message, 'FORBIDDEN');
export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, 'VALIDATION_ERROR', details);
