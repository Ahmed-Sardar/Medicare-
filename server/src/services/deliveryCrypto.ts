import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
const key = () => env.DELIVERY_ENCRYPTION_KEY ? Buffer.from(env.DELIVERY_ENCRYPTION_KEY, 'hex') : createHash('sha256').update(`medfind:development-delivery:${env.JWT_ACCESS_SECRET}`).digest();
export function sealDelivery(value: unknown): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from('medfind:delivery:v1'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}
export function openDelivery(value: string): unknown {
  const [iv, tag, body] = value.split('.'); if (!iv || !tag || !body) throw new Error('Invalid delivery payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url')); decipher.setAAD(Buffer.from('medfind:delivery:v1')); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
}
