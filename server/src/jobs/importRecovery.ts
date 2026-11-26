import { opendir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Only application-generated direct children of import-tmp are eligible. Never recurse or follow links.
export async function recoverImportFiles(signal: AbortSignal): Promise<void> {
  const root = path.resolve(env.UPLOAD_DIR, 'import-tmp');
  let directory;
  try { directory = await opendir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const cutoff = Date.now() - 24 * 3600_000; let removed = 0;
  for await (const entry of directory) {
    if (signal.aborted) break;
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.upload$/i.test(entry.name)) continue;
    const candidate = path.resolve(root, entry.name); if (path.dirname(candidate) !== root) continue;
    try { const stat = await lstat(candidate); if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) { await unlink(candidate); removed++; } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('Unable to remove an abandoned import file'); }
  }
  if (removed) logger.info({ removed }, 'Abandoned import files recovered');
}
