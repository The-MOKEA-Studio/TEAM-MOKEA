import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Codex dispatch preserves arguments, cwd, environment, entry path and exit status', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'team-mokea-provider-')));
  try {
    await copyFile(new URL('../src/cli.js', import.meta.url), join(dir, 'cli.mjs'));
    const pkg = join(dir, 'node_modules', 'teamcodex');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ main: 'index.js' }));
    await writeFile(join(pkg, 'index.js'), `
      console.log(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(), marker: process.env.PROVIDER_TEST }));
      process.exit(17);
    `);
    const result = spawnSync(process.execPath, [join(dir, 'cli.mjs'), 'codex', 'run', '--', 'two words', '$literal'], {
      cwd: dir, env: { ...process.env, PROVIDER_TEST: 'preserved' }, encoding: 'utf8',
    });
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: [join(pkg, 'index.js'), 'codex', 'run', '--', 'two words', '$literal'],
      cwd: dir, marker: 'preserved',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('default and explicit Claude commands retain the existing CLI', () => {
  const env = { ...process.env, TEAM_MOKEA_DISABLE_AUTOUPDATE: '1' };
  const original = spawnSync(process.execPath, [fileURLToPath(new URL('../src/index.js', import.meta.url)), 'version'], {
    env, encoding: 'utf8',
  });
  assert.equal(original.status, 0, original.stderr);
  for (const args of [['version'], ['claude', 'version']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), ...args], {
      env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, original.stdout);
  }
});
