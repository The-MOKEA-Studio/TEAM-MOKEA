import { open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoUpdate } from './updater.js';

/**
 * Run independently of the Codex process, using that provider's opt-out.
 * @param {string} configPath
 */
export async function updateAfterCodex(configPath, update = autoUpdate) {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return; // Missing or damaged settings are never a reason to change an install.
  }
  // Keep Codex and Claude update checks on the same daily cache next to settings.
  process.env.TEAM_MOKEA_CONFIG = configPath;
  const lockPath = join(dirname(configPath), 'team-mokea-update.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch {
    // npm is bounded to three minutes; recover an abandoned worker's lock.
    try {
      if (Date.now() - (await stat(lockPath)).mtimeMs > 10 * 60_000) await unlink(lockPath);
    } catch { /* another worker released it */ }
    return;
  }
  try {
    return await update({ config });
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await updateAfterCodex(process.argv[2]).catch(() => {});
}
