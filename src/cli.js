#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.argv[2] === 'codex' && process.argv[3] === 'update') process.argv.splice(2, 1);

if (process.argv[2] === 'codex') {
  const disabled = process.env.TEAM_MOKEA_DISABLE_AUTOUPDATE ?? process.env.TEAMCLAUDE_DISABLE_AUTOUPDATE;
  if (!disabled && !existsSync(new URL('../.git', import.meta.url))
      && ['run', 'resume', 'server'].includes(process.argv[3] || '') && process.getuid?.() !== 0) {
    const config = process.env.TEAMCLAUDE_CONFIG
      || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'teamcodex.json');
    // The worker starts after the session exits, so installation cannot delay
    // startup, overwrite modules during import, or write over the Codex TUI.
    process.once('exit', () => {
      try {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./update-worker.js', import.meta.url)), config], {
          detached: true, stdio: 'ignore', env: process.env,
        });
        child.on('error', () => {});
        child.unref();
      } catch { /* an update must never change the client's exit status */ }
    });
  }
  const entry = import.meta.resolve('teamcodex');
  // Codex uses its entry path to hash sources and restart its own workers.
  process.argv[1] = fileURLToPath(entry);
  await import(entry);
} else {
  if (process.argv[2] === 'claude') process.argv.splice(2, 1);
  await import('./index.js');
}
