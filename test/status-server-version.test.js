import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnServer, waitForStatus, closedPort } from '../test-helpers/spawn-server.js';

// `GET /team-mokea/status` reports the version of the process that answers
// under `server.version`. Clients (the remote TUI, a menu bar app) used to
// infer it from the CLI they were installed with, which is the wrong answer
// right after `team-mokea update` and before the restart — and the gate for
// "does this proxy hot-apply key X on reload" needs the running version, not
// the installed one. This drives the real server as a subprocess against a
// throwaway TEAM_MOKEA_CONFIG and compares against the package.json it runs.

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

test('GET /team-mokea/status reports the running package version under server.version', async () => {
  const deadPort = await closedPort();
  const server = await spawnServer({
    config: () => ({
      proxy: { apiKey: 'tc-test' },
      upstream: `http://127.0.0.1:${deadPort}`,
      upstreamProxy: false,
      accounts: [{ name: 'a@example.com', type: 'apikey', apiKey: 'k1' }],
    }),
  });
  try {
    const status = await waitForStatus(server.port);
    const { version } = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    assert.match(version, /^\d+\.\d+\.\d+/, 'package.json carries a version to compare against');
    assert.equal(status.server.version, version);
    assert.equal(typeof status.server.startedAt, 'string', 'the rest of the server block is untouched');
    // The identity a client uses to tell which server answered on the port.
    assert.equal(status.server.pid, server.pid);
    // What the dashboard header draws: a tag or sha in a checkout, this version
    // otherwise. Either way an attached client has something to name the build.
    assert.match(status.server.versionLabel, /\S/);
    assert.equal(typeof status.server.updateAvailable, 'boolean');
  } finally {
    await server.stop();
  }
});
