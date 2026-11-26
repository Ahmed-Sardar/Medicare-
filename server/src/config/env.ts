import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  INVENTORY_RECENT_MINUTES: z.coerce.number().positive().default(15),
  INVENTORY_CONFIRM_MINUTES: z.coerce.number().positive().default(60),
  INVENTORY_STALE_MINUTES: z.coerce.number().positive().default(240),
  RESERVATION_HOLD_MINUTES: z.coerce.number().positive().default(30),
  PICKUP_DEADLINE_HOURS: z.coerce.number().positive().default(24),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().url().refine((value) => /^rediss?:\/\//i.test(value), 'Use redis:// or rediss://').optional().or(z.literal('')),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'), EMAIL_API_KEY: z.string().optional(), EMAIL_FROM: z.string().email().optional(),
  DELIVERY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  RETENTION_NOTIFICATION_DAYS: z.coerce.number().int().min(0).max(3650).default(0), RETENTION_SUPPORT_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
  SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'), SMS_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-f]{32}$/i).optional(), TWILIO_AUTH_TOKEN: z.string().optional(), TWILIO_VERIFY_SERVICE_SID: z.string().regex(/^VA[0-9a-f]{32}$/i).optional(),
  STORAGE_PROVIDER: z.enum(['local', 'private', 's3']).default('local'),
  S3_BUCKET: z.string().min(3).optional(), S3_REGION: z.string().min(1).optional(), S3_ENDPOINT: z.string().url().optional(), S3_PREFIX: z.string().regex(/^[a-zA-Z0-9/_-]+$/).default('medfind-private/'),
  ALLOW_DEMO_DISCOVERY: z.string().default('false').transform((value) => value.toLowerCase() === 'true'), DEMO_PASSWORD: z.string().optional(),
  DEMO_BASE_LAT: z.coerce.number().min(-90).max(90).default(17.385), DEMO_BASE_LNG: z.coerce.number().min(-180).max(180).default(78.4867),
}).superRefine((config, ctx) => {
  if (config.NODE_ENV === 'production' && config.EMAIL_PROVIDER !== 'resend') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_PROVIDER'], message: 'Production requires a configured email provider' });
  if (config.EMAIL_PROVIDER === 'resend' && !config.EMAIL_API_KEY?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_API_KEY'], message: 'Resend requires an API key' });
  if (config.EMAIL_PROVIDER === 'resend' && !config.EMAIL_FROM) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_FROM'], message: 'Resend requires a verified sender email' });
  if (config.NODE_ENV === 'production' && !config.DELIVERY_ENCRYPTION_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DELIVERY_ENCRYPTION_KEY'], message: 'Production requires a separate 32-byte hexadecimal delivery encryption key' });
  if (config.SMS_PROVIDER === 'twilio' && (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_VERIFY_SERVICE_SID)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMS_PROVIDER'], message: 'Twilio requires account SID, auth token and Verify service SID' });
  if (config.STORAGE_PROVIDER === 's3' && (!config.S3_BUCKET || !config.S3_REGION)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STORAGE_PROVIDER'], message: 'S3 storage requires bucket and region; credentials use the AWS SDK credential chain' });
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
