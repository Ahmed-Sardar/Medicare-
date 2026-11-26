import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import type { ClientSession } from 'mongoose';
import { createHash } from 'node:crypto';
import { EmailDelivery } from '../modules/models.js';
import { sealDelivery } from './deliveryCrypto.js';

export interface EmailMessage { to: string; subject: string; text: string; }
export interface EmailProvider { send(message: EmailMessage): Promise<void>; }

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    // Development responses expose a one-time token; do not put links or tokens in logs.
    logger.info({ subject: message.subject }, 'Development email prepared');
  }
}
class ResendEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Email provider rejected request (${response.status})`);
  }
}
export const emailProvider: EmailProvider = env.EMAIL_PROVIDER === 'resend' ? new ResendEmailProvider() : new ConsoleEmailProvider();
export const sendEmail = (message: EmailMessage): Promise<void> => emailProvider.send(message);

export async function deliverAccountEmail(kind: 'verify' | 'reset', to: string, token: string, userId: string, expiresAt: Date, session?: ClientSession): Promise<void> {
  const link = new URL(kind === 'verify' ? '/verify-email' : '/reset-password', env.CLIENT_URL);
  link.searchParams.set('token', token);
  const message = { to, subject: kind === 'verify' ? 'Verify your MedFind email' : 'Reset your MedFind password', text: kind === 'verify'
    ? `Verify your email using this link within 24 hours: ${link.toString()}\n\nIf you did not create this account, you can ignore this message.`
    : `Reset your password using this link within 30 minutes: ${link.toString()}\n\nIf you did not request a reset, you can ignore this message.` };
  await EmailDelivery.create([{ kind, userId, tokenHash: createHash('sha256').update(token).digest('hex'), payload: sealDelivery({ ...message, from: env.EMAIL_FROM }), expiresAt: new Date(Math.min(expiresAt.getTime(), Date.now() + 23 * 3600_000)), purgeAt: new Date(Date.now() + 30 * 86400000) }], { session });
}
