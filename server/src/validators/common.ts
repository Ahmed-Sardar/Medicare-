import { z } from 'zod';

export const mongoIdSchema = z.string().regex(/^[0-9a-f]{24}$/i, 'Expected a MongoDB ID');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const auditReasonSchema = z.string().trim().min(5).max(1000);
