#!/usr/bin/env node
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { resolveStatePath } from '../app/create-app.js';
import { resolveApiTokensPath } from '../app/api-tokens.js';
import { DEFAULT_PORT, serve } from './serve.js';

try {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false,
    options: { listen: { type: 'string' }, port: { type: 'string' } } });
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => controller.abort());
  await serve({ filename: resolveStatePath(process.env, homedir()), tokensFile: resolveApiTokensPath(process.env),
    listen: values.listen ?? '127.0.0.1', port: values.port ?? String(DEFAULT_PORT),
    env: process.env, signal: controller.signal,
    out: line => process.stdout.write(line + '\n'), log: line => process.stderr.write(line + '\n') });
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
