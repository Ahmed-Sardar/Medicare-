import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
export function phoneDestination(value: string): string {
  const number = /^[6-9][0-9]{9}$/.test(value) ? `+91${value}` : value;
  if (!/^\+[1-9][0-9]{9,14}$/.test(number)) throw new ApiError(400, 'Save an international phone number with a country prefix, or a ten-digit Indian mobile number');
  return number;
}
export const codeDigest = (userId: string, revision: string, code: string) => createHmac('sha256', env.JWT_ACCESS_SECRET).update(`medfind:phone:${userId}:${revision}:${code}`).digest('hex');
async function twilio(path: string, body: URLSearchParams) {
  const response = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${path}`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 503, 'Phone verification is unavailable or the request has expired. Request a new code.', 'PHONE_PROVIDER_UNAVAILABLE');
  return response.json();
}
export async function startPhoneVerification(phone: string, channel: 'sms' | 'whatsapp') {
  if (env.SMS_PROVIDER === 'twilio') {
    const response = z.object({ sid: z.string().regex(/^VE[0-9a-f]{32}$/i) }).parse(await twilio('Verifications', new URLSearchParams({ To: phoneDestination(phone), Channel: channel })));
    return { providerSid: response.sid };
  }
  if (env.NODE_ENV !== 'development') throw new ApiError(503, 'Phone verification provider is not configured');
  phoneDestination(phone); return { developmentCode: String(randomInt(100000, 1000000)) };
}
export async function checkPhoneVerification(input: { providerSid?: string | null; codeHash?: string | null; revision: string }, userId: string, code: string): Promise<boolean> {
  if (input.providerSid && env.SMS_PROVIDER === 'twilio') {
    const response = z.object({ status: z.string() }).parse(await twilio('VerificationCheck', new URLSearchParams({ VerificationSid: input.providerSid, Code: code })));
    return response.status === 'approved';
  }
  if (env.NODE_ENV !== 'development' || !input.codeHash) return false;
  const expected = Buffer.from(input.codeHash, 'hex'); const actual = Buffer.from(codeDigest(userId, input.revision, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
