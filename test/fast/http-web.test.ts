import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWebAssets, webResponse } from '../../src/http/web.js';

test('web assets are served by exact path with types, cache and CSP headers, other routes fall back to index.html and missing assets are 404', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-web-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const index = '<div id="root"></div>';
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), index);
  writeFileSync(join(dir, 'assets/app-1.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets/app-1.css'), 'body{}');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  symlinkSync('app-1.js', join(dir, 'assets/link.js'));
  const assets = readWebAssets(dir);
  assert.deepEqual([...assets.keys()].sort(), ['/assets/app-1.css', '/assets/app-1.js', '/favicon.svg', '/index.html']);

  const root = webResponse(assets, 'GET', '/');
  assert.equal(root.status, 200);
  assert.equal(root.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(root.headers['content-security-policy'] ?? '', /default-src 'self'/);
  assert.equal(root.headers['x-frame-options'], 'DENY');
  assert.equal(root.headers['cache-control'], 'no-cache');
  assert.equal(root.headers['x-content-type-options'], 'nosniff');
  for (const path of ['/tasks', '/projects/MP']) {
    const fallback = webResponse(assets, 'GET', path);
    assert.equal(fallback.status, 200, path);
    assert.equal(String(fallback.body), index, path);
  }
  const script = webResponse(assets, 'GET', '/assets/app-1.js');
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.match(script.headers['cache-control'] ?? '', /immutable/);
  assert.equal(script.headers['content-security-policy'], undefined);
  assert.equal(webResponse(assets, 'GET', '/favicon.svg').headers['content-type'], 'image/svg+xml');
  for (const path of ['/assets/nope.js', '/nope.png', '/assets/link.js']) assert.equal(webResponse(assets, 'GET', path).status, 404, path);
  const post = webResponse(assets, 'POST', '/');
  assert.deepEqual([post.status, post.headers['allow']], [405, 'GET, HEAD']);
  assert.equal(webResponse(assets, 'HEAD', '/').status, 200);

  assert.throws(() => readWebAssets(join(dir, 'index.html')), /ENOTDIR/);
  const missing = readWebAssets(join(dir, 'missing'));
  assert.equal(missing.size, 0);
  const unbuilt = webResponse(missing, 'GET', '/');
  assert.equal(unbuilt.status, 404);
  assert.match(String(unbuilt.body), /Web UI is not built/);
});
