import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateAfterCodex } from '../src/update-worker.js';

test('Codex worker uses provider settings, serializes updates and releases its lock on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'team-mokea-update-'));
  const path = join(dir, 'teamcodex.json');
  const previous = process.env.TEAM_MOKEA_CONFIG;
  try {
    await writeFile(path, JSON.stringify({ autoUpdate: false }));
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const first = updateAfterCodex(path, async ({ config }) => {
      assert.equal(config.autoUpdate, false);
      assert.equal(process.env.TEAM_MOKEA_CONFIG, path);
      entered();
      await pending;
      throw Error('npm failed');
    });
    const failed = assert.rejects(first, /npm failed/);
    await started;
    await updateAfterCodex(path, async () => { assert.fail('concurrent install'); });
    release();
    await failed;
    await assert.rejects(readFile(join(dir, 'team-mokea-update.lock')), { code: 'ENOENT' });
    let updated = false;
    await updateAfterCodex(path, async () => { updated = true; });
    assert.equal(updated, true);
  } finally {
    if (previous === undefined) delete process.env.TEAM_MOKEA_CONFIG;
    else process.env.TEAM_MOKEA_CONFIG = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
