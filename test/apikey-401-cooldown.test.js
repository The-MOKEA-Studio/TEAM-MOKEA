import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AccountManager, CREDENTIAL_REJECTED_COOLDOWNS_SECONDS } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';
import { renderStatus, UNAVAILABLE_TEXT } from '../src/status-renderer.js';

// #439 stopped the 401 loop of #412 by putting an account in `error` on its
// first 401. For an API key nothing ever took it back out: one 401 from a
// gateway whose own upstream was down benched a working fallback account for
// 22 hours (#473). An API key is now held for a cooldown that lengthens while
// it keeps being rejected, and retried after it. These pin both halves: the
// account comes back, and while held it is asked nothing.

const MINUTE = 60_000;
const START = Date.parse('2026-01-01T00:00:00Z');
const WHY = 'upstream rejected its API key (401)';
const [FIRST, SECOND, THIRD, LAST] = CREDENTIAL_REJECTED_COOLDOWNS_SECONDS.map(s => s * 1000);

const apikey = (/** @type {string} */ name) => ({ name, type: 'apikey', apiKey: `key-${name}` });

/** Run `fn` with console output captured, so the lines can be asserted on and
 * the test output stays readable.
 * @param {(lines: string[]) => void} fn */
function quietly(fn) {
  /** @type {string[]} */
  const lines = [];
  const original = { log: console.log, error: console.error };
  console.log = (...a) => { lines.push(a.join(' ')); };
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    fn(lines);
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
}

test('the first 401 holds an API-key account, and it returns after the cooldown', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly((lines) => {
    const am = new AccountManager([apikey('gateway')]);

    am.markCredentialRejected(0, WHY);

    assert.equal(am.accounts[0].status, 'active', 'a single 401 is not a dead credential');
    assert.equal(am.accounts[0].credentialRejectedUntil, START + FIRST);
    assert.equal(am.unavailableReason(am.accounts[0]), 'credential');
    assert.equal(am.getActiveAccount(), null, 'held: there is nothing to select');
    const said = lines.find(l => /held out of rotation/.test(l)) || '';
    assert.match(said, /"gateway"/);
    assert.match(said, new RegExp(`for ${FIRST / 1000}s`));
    assert.match(said, /will be retried/);

    t.mock.timers.tick(FIRST - 1);
    assert.equal(am.unavailableReason(am.accounts[0]), 'credential', 'one millisecond short is still held');

    t.mock.timers.tick(1);
    assert.equal(am.unavailableReason(am.accounts[0]), null);
    assert.equal(am.getActiveAccount()?.name, 'gateway');
    assert.equal(am.accounts[0].credentialRejectedUntil, null);
  });
});

test('consecutive 401s lengthen the hold, up to a ceiling it never leaves', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly(() => {
    const am = new AccountManager([apikey('revoked')]);
    // Two past the end of the table: a key that is really revoked stays at the
    // longest hold and never goes to a permanent `error`.
    const expected = [FIRST, SECOND, THIRD, LAST, LAST, LAST];
    assert.ok(FIRST < SECOND && SECOND < THIRD && THIRD < LAST, 'the table escalates');

    for (const hold of expected) {
      const now = Date.now();
      am.markCredentialRejected(0, WHY);
      assert.equal(am.accounts[0].credentialRejectedUntil, now + hold);
      assert.equal(am.accounts[0].status, 'active');
      // The hold runs out and the retry is rejected again.
      t.mock.timers.tick(hold);
      assert.equal(am.unavailableReason(am.accounts[0]), null);
    }
    assert.equal(am.accounts[0].credentialRejections, expected.length);
  });
});

test('401s from requests already in flight do not escalate the hold', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly((lines) => {
    const am = new AccountManager([apikey('gateway')]);

    am.markCredentialRejected(0, WHY);
    t.mock.timers.tick(200);
    am.markCredentialRejected(0, WHY);
    am.markCredentialRejected(0, WHY);

    assert.equal(am.accounts[0].credentialRejections, 1);
    assert.equal(am.accounts[0].credentialRejectedUntil, START + FIRST);
    assert.equal(lines.filter(l => /held out of rotation/.test(l)).length, 1, 'one line per hold');
  });
});

test('a success resets the escalation', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly(() => {
    const am = new AccountManager([apikey('gateway')]);

    am.markCredentialRejected(0, WHY);
    t.mock.timers.tick(FIRST);
    am.markCredentialRejected(0, WHY);
    assert.equal(am.accounts[0].credentialRejectedUntil, Date.now() + SECOND);
    t.mock.timers.tick(SECOND);

    am.clearCredentialRejected(0);
    assert.equal(am.accounts[0].credentialRejections, 0);

    am.markCredentialRejected(0, WHY);
    assert.equal(am.accounts[0].credentialRejectedUntil, Date.now() + FIRST, 'back to the shortest hold');
  });
});

test('the hold does not lapse the count by itself: only a success does', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly(() => {
    const am = new AccountManager([apikey('gateway')]);
    am.markCredentialRejected(0, WHY);
    // Long after the hold ran out, with no request in between to prove the key.
    t.mock.timers.tick(24 * 60 * MINUTE);
    assert.equal(am.unavailableReason(am.accounts[0]), null);

    am.markCredentialRejected(0, WHY);
    assert.equal(am.accounts[0].credentialRejectedUntil, Date.now() + SECOND);
  });
});

test('a held account is not selected, not probed and not resurrected', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly(() => {
    const am = new AccountManager([apikey('dead'), apikey('live')]);
    am.markCredentialRejected(0, WHY);

    for (let i = 0; i < 5; i++) assert.equal(am.getActiveAccount()?.name, 'live');

    // With the rest of the fleet unavailable too, the paths that hand out an
    // unavailable account as a last resort must not hand out this one: that is
    // the 401 loop of #412 by another door.
    am.setDisabled(1, true);
    assert.equal(am.getActiveAccount(), null);
    assert.equal(am._isProbeable(am.accounts[0]), false);
    // A quota window that has since rolled makes an account the "soonest to
    // reset"; the hold outranks it.
    am.accounts[0].quota.unified5hReset = Date.now() - 1;
    assert.equal(am.getActiveAccount(), null);
  });
});

test('an OAuth account is still taken out of rotation for good', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly((lines) => {
    const am = new AccountManager([
      { name: 'o', type: 'oauth', accessToken: 't', expiresAt: START + 60 * MINUTE },
    ]);

    am.markCredentialRejected(0, 'upstream rejected its token (401) and it has no refresh token');

    assert.equal(am.accounts[0].status, 'error');
    assert.equal(am.accounts[0].credentialRejectedUntil, null);
    assert.equal(am.accounts[0].credentialRejections, 0);
    assert.ok(lines.some(l => /taken out of rotation/.test(l) && /team-mokea login/.test(l)), lines.join('\n'));

    t.mock.timers.tick(24 * 60 * MINUTE);
    assert.equal(am.unavailableReason(am.accounts[0]), 'error', 'no cooldown brings it back');
  });
});

test('status exposes the hold and says why the account is blocked', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly(() => {
    const am = new AccountManager([apikey('gateway'), apikey('live')]);
    am.markCredentialRejected(0, WHY);

    const status = am.getStatus();
    assert.equal(status.accounts[0].unavailable, 'credential');
    assert.equal(status.accounts[0].credentialRejectedUntil, new Date(START + FIRST).toISOString());
    assert.equal(status.accounts[1].credentialRejectedUntil, null);
    assert.ok(UNAVAILABLE_TEXT.credential, 'an unmapped reason would print the bare key');
    const rendered = renderStatus(JSON.parse(JSON.stringify(status)), { color: false, now: Date.now() });
    assert.ok(rendered.includes(UNAVAILABLE_TEXT.credential), rendered);

    t.mock.timers.tick(FIRST);
    assert.equal(am.getStatus().accounts[0].credentialRejectedUntil, null);
  });
});

test('re-enabling the account lifts the hold at once', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  quietly(() => {
    const am = new AccountManager([apikey('gateway')]);
    am.markCredentialRejected(0, WHY);

    am.setDisabled(0, true);
    am.setDisabled(0, false);

    assert.equal(am.unavailableReason(am.accounts[0]), null);
    assert.equal(am.accounts[0].credentialRejections, 0);
  });
});

// End to end, on the real clock: the hold is moved by hand rather than waited
// out, because mocked timers would stall the sockets underneath.
const listen = (/** @type {http.Server} */ s) => new Promise(r => s.listen(0, '127.0.0.1', () => {
  r(/** @type {import('node:net').AddressInfo} */ (s.address()).port);
}));

test('through the proxy: a 401 fails over, the account sits out, then serves again', async () => {
  /** @type {string[]} */
  const seen = [];
  // The gateway of the report: a good key, refused while its upstream is down.
  let gatewayDown = true;
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const key = String(req.headers['x-api-key']);
      seen.push(key);
      const refused = key === 'gateway-key' && gatewayDown;
      res.writeHead(refused ? 401 : 200, { 'content-type': 'application/json' });
      res.end(refused
        ? JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid' } })
        : JSON.stringify({ type: 'message', role: 'assistant', content: [] }));
    });
  });
  const upstreamPort = await listen(upstream);
  const am = new AccountManager([
    { name: 'gateway', type: 'apikey', apiKey: 'gateway-key' },
    { name: 'other', type: 'apikey', apiKey: 'other-key' },
  ], 0.98);
  const proxy = createProxyServer(am, { proxy: {}, upstream: `http://127.0.0.1:${upstreamPort}` });
  const port = await listen(proxy);
  const original = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  const send = async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-test', max_tokens: 1, messages: [] }),
    });
    await res.text();
    return res.status;
  };
  try {
    assert.equal(await send(), 200, 'the client must not be handed the account\'s 401');
    assert.deepEqual(seen, ['gateway-key', 'other-key']);
    assert.equal(am.accounts[0].status, 'active');
    assert.ok(am.accounts[0].credentialRejectedUntil > Date.now());

    // No loop: while held, requests go straight to the other account.
    assert.equal(await send(), 200);
    assert.equal(await send(), 200);
    assert.deepEqual(seen, ['gateway-key', 'other-key', 'other-key', 'other-key']);

    // The hold runs out and the gateway is back. With the other account out of
    // the way the next request is the retry, and its 200 clears the count.
    gatewayDown = false;
    am.accounts[0].credentialRejectedUntil = Date.now() - 1;
    am.setDisabled(1, true);
    seen.length = 0;
    assert.equal(await send(), 200);
    assert.deepEqual(seen, ['gateway-key']);
    assert.equal(am.accounts[0].credentialRejections, 0);
    assert.equal(am.accounts[0].credentialRejectedUntil, null);
  } finally {
    console.log = original.log;
    console.error = original.error;
    proxy.closeAllConnections?.(); proxy.close();
    upstream.closeAllConnections?.(); upstream.close();
  }
});
