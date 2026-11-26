import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import multer from 'multer';

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  let status = 500, message = 'An unexpected error occurred', code = 'INTERNAL_ERROR', details: unknown;
  if (error instanceof ApiError) ({ status, message, code, details } = error);
  else if (error instanceof ZodError) { status = 400; message = 'Request validation failed'; code = 'VALIDATION_ERROR'; details = error.flatten(); }
  else if (error instanceof mongoose.Error.ValidationError) { status = 400; message = 'Data validation failed'; code = 'VALIDATION_ERROR'; }
  else if (error instanceof mongoose.Error.CastError) { status = 400; message = 'Invalid resource identifier'; code = 'INVALID_ID'; }
  else if (error instanceof multer.MulterError) { status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400; message = error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file exceeds the configured size limit' : 'Invalid file upload'; code = 'UPLOAD_ERROR'; }
  else if ((error as { code?: number })?.code === 11000) { status = 409; message = 'A record with this value already exists'; code = 'DUPLICATE_RECORD'; }
  else if ((error as { code?: number })?.code === 50) { status = 503; message = 'This query exceeded its time limit. Narrow the filters and try again.'; code = 'QUERY_TIMEOUT'; }
  if (status >= 500) logger.error({ err: error, path: req.path, method: req.method }, 'Request failed');
  res.status(status).json({ success: false, error: { code, message, ...(details && env.NODE_ENV !== 'production' ? { details } : {}) } });
};
