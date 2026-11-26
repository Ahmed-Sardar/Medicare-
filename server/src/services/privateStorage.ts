import { createReadStream } from 'node:fs';
import { lstat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
const root = path.resolve(env.UPLOAD_DIR, 'private');
export const storagePrefix = `${env.S3_PREFIX.replace(/\/+$/, '')}/`;
let client: import('@aws-sdk/client-s3').S3Client | undefined;
export async function s3Storage() { const sdk = await import('@aws-sdk/client-s3'); client ??= new sdk.S3Client({ region: env.S3_REGION, ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}) }); return { sdk, client }; }
function localPath(value: string): string { const result = path.resolve(value); if (!result.startsWith(root + path.sep) || !/\.(pdf|jpg|png)$/i.test(result)) throw new ApiError(404, 'Private document not found'); return result; }
function remoteKey(value: string): string {
  if (!env.S3_BUCKET || !value.startsWith(`s3://${env.S3_BUCKET}/`)) throw new ApiError(404, 'Private document not found');
  const key = value.slice(`s3://${env.S3_BUCKET}/`.length);
  if (!key.startsWith(storagePrefix) || !/^[a-zA-Z0-9/_-]+\.(pdf|jpg|png)$/.test(key) || key.includes('..')) throw new ApiError(404, 'Private document not found');
  return key;
}
export async function storePrivateDocument(filename: string, mime: string, group: 'pharmacies' | 'pharmacists'): Promise<string> {
  const safe = localPath(filename);
  if (env.STORAGE_PROVIDER !== 's3') return safe;
  const { client: storage, sdk } = await s3Storage(); const key = `${storagePrefix}${group}/${path.basename(safe)}`;
  try { await storage.send(new sdk.PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: await readFile(safe), ContentType: mime, ServerSideEncryption: 'AES256' }), { abortSignal: AbortSignal.timeout(20000) }); }
  catch { throw new ApiError(503, 'Private storage is unavailable. Try uploading again.'); }
  await unlink(safe).catch(() => undefined); return `s3://${env.S3_BUCKET}/${key}`;
}
export async function removePrivateDocument(value?: string | null): Promise<void> {
  if (!value) return;
  if (value.startsWith('s3://')) { const key = remoteKey(value); const { client: storage, sdk } = await s3Storage(); await storage.send(new sdk.DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(20000) }); }
  else await unlink(localPath(value)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
}
export async function privateDocumentExists(value: string): Promise<boolean> {
  try {
    if (value.startsWith('s3://')) { const key = remoteKey(value); const { client: storage, sdk } = await s3Storage(); await storage.send(new sdk.HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(10000) }); return true; }
    const stat = await lstat(localPath(value)); return stat.isFile() && !stat.isSymbolicLink();
  } catch { return false; }
}
export async function streamPrivateDocument(res: Response, value: string, name: string): Promise<void> {
  const extension = path.extname(value).toLowerCase(); if (!['.pdf', '.jpg', '.png'].includes(extension)) throw new ApiError(404, 'Private document not found');
  let source: Readable;
  try {
    if (value.startsWith('s3://')) { const key = remoteKey(value); const { client: storage, sdk } = await s3Storage(); const object = await storage.send(new sdk.GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(20000) }); if (!(object.Body instanceof Readable)) throw new Error(); source = object.Body; }
    else { const safe = localPath(value); const stat = await lstat(safe); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(); source = createReadStream(safe); }
  } catch { throw new ApiError(404, 'Private document not found'); }
  res.setHeader('Content-Disposition', `attachment; filename="${name}${extension}"`); res.setHeader('Content-Type', extension === '.pdf' ? 'application/pdf' : extension === '.png' ? 'image/png' : 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  try { await pipeline(source, res); } catch { if (!res.destroyed) res.destroy(); }
}
