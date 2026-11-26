import type { RequestHandler } from 'express';
import type { Response } from 'express';
import type { ZodType } from 'zod';

export const validate = (schema: ZodType): RequestHandler => (req, res, next) => {
  const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
  if (!result.success) return next(result.error);
  res.locals.validatedRequest = result.data;
  next();
};

export function validatedRequest<T>(res: Response): T {
  if (res.locals.validatedRequest === undefined) throw new Error('Validated request data is unavailable');
  return res.locals.validatedRequest as T;
}
