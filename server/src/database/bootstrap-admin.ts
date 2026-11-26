import bcrypt from 'bcryptjs';
import { connectDatabase } from './connect.js';
import { env } from '../config/env.js';
import { User } from '../modules/models.js';
import { logger } from '../config/logger.js';

async function bootstrap(): Promise<void> {
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD explicitly before bootstrap.');
  if (env.BOOTSTRAP_ADMIN_PASSWORD.length < 20) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 20 characters.');
  await connectDatabase(); const email = env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.roles.includes('SUPER_ADMIN')) { logger.info('Bootstrap administrator already exists; no changes made.'); return; }
    throw new Error('An account already uses BOOTSTRAP_ADMIN_EMAIL. No role changes were made. Choose a new email or grant access through an authorized setup process.');
  }
  await User.create({ name: 'MedFind Super Administrator', email, passwordHash: await bcrypt.hash(env.BOOTSTRAP_ADMIN_PASSWORD, 12), roles: ['SUPER_ADMIN'], active: true, emailVerifiedAt: new Date() });
  logger.info({ email }, 'Initial super administrator created. Remove the bootstrap credentials from the environment.');
}
bootstrap().then(() => process.exit(0)).catch((error: unknown) => { logger.error({ err: error }, 'Super admin bootstrap failed'); process.exit(1); });
