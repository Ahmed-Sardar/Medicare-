import { opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { Pharmacist, Pharmacy } from '../modules/models.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { removePrivateDocument, s3Storage, storagePrefix } from '../services/privateStorage.js';
import { withJobLease } from '../services/jobLease.js';
async function referenced(value: string) { return Boolean(await Pharmacy.exists({ licenseDocumentPath: value }) || await Pharmacist.exists({ evidenceDocumentPath: value })); }
export async function recoverPrivateFiles(): Promise<void> {
  const cutoff = Date.now() - 7 * 86400000;
  // Local directories are per-instance and only direct generated files are eligible.
  for (const root of [path.resolve(env.UPLOAD_DIR, 'private'), path.resolve(env.UPLOAD_DIR, 'private', 'pharmacists')]) {
    let directory; try { directory = await opendir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for await (const file of directory) {
      if (!file.isFile() || !/^[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(file.name)) continue;
      const candidate = path.resolve(root, file.name); if (path.dirname(candidate) !== root) continue;
      const stat = await lstat(candidate).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff && !await referenced(candidate)) await removePrivateDocument(candidate);
    }
  }
  if (env.STORAGE_PROVIDER !== 's3') return;
  await withJobLease('private-file-recovery', async (signal) => {
    const { sdk, client } = await s3Storage(); let continuation: string | undefined;
    do {
      const page = await client.send(new sdk.ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: storagePrefix, ContinuationToken: continuation, MaxKeys: 100 }), { abortSignal: AbortSignal.timeout(20000) });
      for (const object of page.Contents || []) {
        if (signal.aborted) return;
        if (!object.Key || !object.LastModified || object.LastModified.getTime() >= cutoff || !/\/(pharmacies|pharmacists)\/[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(object.Key)) continue;
        const reference = `s3://${env.S3_BUCKET}/${object.Key}`;
        if (!await referenced(reference)) await removePrivateDocument(reference);
      }
      continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuation && !signal.aborted);
  });
  logger.debug('Private file reconciliation finished');
}
