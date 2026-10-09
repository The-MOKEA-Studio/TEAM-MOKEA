import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envVar, legacyControlUrl } from '../src/brand.js';
import { getConfigPath, getStatePath } from '../src/config.js';
import { AccountManager } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';

// Team Mokea is the canonical name; old TeamClaude settings and routes remain
// accepted so existing installations can migrate without losing access.

const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));

function request(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('envVar reads the TEAM_MOKEA_ spelling first and falls back to TEAMCLAUDE_', () => {
  assert.equal(envVar('CONFIG', {}), undefined);
  assert.equal(envVar('CONFIG', { TEAM_MOKEA_CONFIG: '/new' }), '/new');
  assert.equal(envVar('CONFIG', { TEAM_MOKEA_CONFIG: '/new', TEAMCLAUDE_CONFIG: '/old' }), '/new');
  assert.equal(envVar('CONFIG', { TEAMCLAUDE_CONFIG: '/old' }), '/old');
  // An explicitly empty new variable masks the old spelling.
  assert.equal(envVar('HOST', { TEAM_MOKEA_HOST: '', TEAMCLAUDE_HOST: '0.0.0.0' }), '');
});

test('legacyControlUrl maps the old route prefix onto the new one and nothing else', () => {
  assert.equal(legacyControlUrl('/teamclaude/status'), '/team-mokea/status');
  assert.equal(legacyControlUrl('/teamclaude/mcp/?x=1'), '/team-mokea/mcp/?x=1');
  assert.equal(legacyControlUrl('/teamclaude'), '/team-mokea');
  assert.equal(legacyControlUrl('/teamclaude?x'), '/team-mokea?x');
  // Not the prefix: a longer first segment, the current spelling, ordinary traffic.
  assert.equal(legacyControlUrl('/team-mokeax/status'), null);
  assert.equal(legacyControlUrl('/team-mokea/status'), null);
  assert.equal(legacyControlUrl('/v1/messages'), null);
  assert.equal(legacyControlUrl(undefined), null);
});

test('the config path prefers TEAM_MOKEA_CONFIG, then team-mokea.json, then the legacy filename', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'team-mokea-brand-'));
  const saved = { ...process.env };
  const restore = () => {
    for (const k of ['TEAM_MOKEA_CONFIG', 'TEAMCLAUDE_CONFIG', 'XDG_CONFIG_HOME']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  };
  t.after(async () => { restore(); await rm(dir, { recursive: true, force: true }); });
  delete process.env.TEAM_MOKEA_CONFIG;
  delete process.env.TEAMCLAUDE_CONFIG;
  process.env.XDG_CONFIG_HOME = dir;

  // Neither file exists: a fresh install uses the new name.
  assert.equal(getConfigPath(), join(dir, 'team-mokea.json'));
  assert.equal(getStatePath(), join(dir, 'team-mokea.state.json'));

  // The old file is used when the new file is absent.
  await writeFile(join(dir, 'teamclaude.json'), '{}');
  assert.equal(getConfigPath(), join(dir, 'teamclaude.json'));
  assert.equal(getStatePath(), join(dir, 'teamclaude.state.json'));

  // Either variable wins over both files; the new spelling wins over the old.
  process.env.TEAMCLAUDE_CONFIG = '/explicit/old.json';
  assert.equal(getConfigPath(), '/explicit/old.json');
  process.env.TEAM_MOKEA_CONFIG = '/explicit/new.json';
  assert.equal(getConfigPath(), '/explicit/new.json');
});

test('the control plane answers under /team-mokea/ and legacy /teamclaude/', async () => {
  let upstreamHits = 0;
  const upstream = http.createServer((req, res) => { upstreamHits++; res.writeHead(404); res.end('{}'); });
  const upstreamPort = await listen(upstream);
  const am = new AccountManager([{ name: 'a', type: 'apikey', apiKey: 'k' }], 0.98);
  const proxy = createProxyServer(am, { proxy: {}, upstream: `http://127.0.0.1:${upstreamPort}` });
  const port = await listen(proxy);
  try {
    const renamed = await request(port, '/team-mokea/status');
    const legacy = await request(port, '/teamclaude/status');
    assert.equal(renamed.status, 200);
    assert.deepEqual(Object.keys(JSON.parse(renamed.body)).sort(), Object.keys(JSON.parse(legacy.body)).sort());

    assert.equal((await request(port, '/teamclaude/dashboard')).status, 200);
    assert.equal((await request(port, '/teamclaude/quota')).status, 200);

    // A mutation from a web page is refused under the new prefix too.
    const csrf = await request(port, '/team-mokea/reload', { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.equal(csrf.status, 403);
    assert.match(JSON.parse(csrf.body).error, /cross-origin/);

    // An unclaimed path under the new prefix, in either spelling, is a local
    // 404 and never goes upstream under a fleet credential (#420).
    for (const path of ['/team-mokea/reload', '/team-mokea/statuss', '/team-mokea', '/team-mokea/', '/%74eam-mokea/reload', '/%74eamclaude/reload']) {
      const { status, body } = await request(port, path);
      assert.equal(status, 404, path);
      assert.match(JSON.parse(body).error, /unknown team-mokea control route/, path);
    }
    assert.equal(upstreamHits, 0, 'nothing was forwarded');

    // A first segment that merely starts with the name is not the prefix.
    await request(port, '/team-mokeax/status');
    assert.equal(upstreamHits, 1);
  } finally {
    proxy.closeAllConnections?.(); proxy.close();
    upstream.closeAllConnections?.(); upstream.close();
  }
});
