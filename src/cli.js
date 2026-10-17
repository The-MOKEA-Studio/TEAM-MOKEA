#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

if (process.argv[2] === 'codex') {
  const entry = import.meta.resolve('teamcodex');
  // Codex uses its entry path to hash sources and restart its own workers.
  process.argv[1] = fileURLToPath(entry);
  await import(entry);
} else {
  if (process.argv[2] === 'claude') process.argv.splice(2, 1);
  await import('./index.js');
}
