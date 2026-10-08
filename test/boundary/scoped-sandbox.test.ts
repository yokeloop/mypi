import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLinuxSandbox } from '../../src/infrastructure/execution/linux-sandbox.js';

test('Linux sandbox permits owned build effects but denies foreign authority and reaps its namespace', async t => {
  const root = mkdtempSync(join(tmpdir(), 'mypi-scoped-sandbox-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, 'A'), foreign = join(root, 'B');
  mkdirSync(workspace); mkdirSync(foreign); mkdirSync(join(workspace, '.git'));
  mkdirSync(join(workspace, 'nested'));
  const foreignFile = join(foreign, 'data');
  const credential = join(root, 'provider-key');
  const authority = join(root, 'authority-endpoint');
  const common = join(root, 'git-common');
  writeFileSync(foreignFile, 'foreign bytes');
  writeFileSync(credential, 'synthetic-provider-secret');
  writeFileSync(authority, 'synthetic-authority-path');
  writeFileSync(common, 'shared Git metadata');
  writeFileSync(join(workspace, '.git', 'config'), 'protected Git metadata');
  writeFileSync(join(workspace, 'nested', '.git'), 'gitdir: ' + common);
  writeFileSync(join(workspace, 'source.txt'), 'small input');
  symlinkSync(foreign, join(workspace, 'foreign-link'));
  symlinkSync('.git', join(workspace, 'git-link'));
  const previousSecret = process.env.SCOPED_PROVIDER_SECRET;
  const previousAuthority = process.env.SSH_AUTH_SOCK;
  process.env.SCOPED_PROVIDER_SECRET = 'synthetic-environment-secret';
  process.env.SSH_AUTH_SOCK = authority;
  const authorityFd = openSync(credential, 'r');
  t.after(() => {
    closeSync(authorityFd);
    if (previousSecret === undefined) delete process.env.SCOPED_PROVIDER_SECRET;
    else process.env.SCOPED_PROVIDER_SECRET = previousSecret;
    if (previousAuthority === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = previousAuthority;
  });
  // Positive outside-child controls: the outer suite's sandbox can read these.
  assert.equal(readFileSync(foreignFile, 'utf8'), 'foreign bytes');
  assert.equal(readFileSync(credential, 'utf8'), 'synthetic-provider-secret');
  assert.equal(readFileSync(authority, 'utf8'), 'synthetic-authority-path');
  assert.equal(process.env.SCOPED_PROVIDER_SECRET, 'synthetic-environment-secret');
  const hostNamespaces = Object.fromEntries(['pid', 'net', 'mnt', 'user', 'ipc'].map(name => [name, readlinkSync('/proc/self/ns/' + name)]));
  const configuration = {
    workspace, bubblewrap: '/usr/bin/bwrap', node: process.execPath,
    runtimePaths: ['/usr', '/lib', '/lib64'] as const,
    deadlineMs: 3000, outputBytes: 8192,
  };
  const sandbox = createLinuxSandbox(configuration);
  // The caller cannot retarget the existing executor by mutating its configuration.
  configuration.workspace = foreign;
  const canary = `
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const [foreign,credential,authority,common,hostPid]=JSON.parse(process.argv[1]);
const denied=(path)=>{
  assert.throws(()=>fs.readFileSync(path), 'foreign read must be denied: '+path);
  assert.throws(()=>fs.writeFileSync(path,'CORRUPTED'), 'foreign write must be denied: '+path);
};
denied(foreign);
denied('/workspace/foreign-link/data');
for(const path of [credential,authority,common,'/proc/'+hostPid+'/root'+credential]) denied(path);
assert.throws(()=>fs.readFileSync('/workspace/.git/config'));
assert.throws(()=>fs.writeFileSync('/workspace/.git/config','CORRUPTED'));
assert.throws(()=>fs.renameSync('/workspace/.git','/workspace/moved-git'));
assert.throws(()=>fs.readFileSync('/workspace/git-link/config'));
let gitPointer;
try { gitPointer=fs.readFileSync('/workspace/nested/.git','utf8'); }
catch(error) { assert.equal(error.code,'EACCES'); }
if(gitPointer!==undefined) assert.equal(gitPointer,'','Git pointer must not be disclosed');
assert.throws(()=>fs.writeFileSync('/workspace/nested/.git','CORRUPTED'));
assert.throws(()=>fs.openSync('/toolchain/node','w'));
assert.equal(process.env.SCOPED_PROVIDER_SECRET,undefined);
assert.equal(process.env.SSH_AUTH_SOCK,undefined);
assert.equal(fs.readFileSync('/proc/self/environ','utf8').includes('synthetic-environment-secret'),false);
assert.equal(process.env.HOME,'/home/sandbox');
assert.equal(process.env.TMPDIR,'/tmp');
assert.deepEqual(fs.readdirSync('/tmp'),[]);
assert.deepEqual(fs.readdirSync('/home/sandbox'),['cache']);
fs.writeFileSync('/tmp/private','private tmp');
fs.writeFileSync(process.env.HOME+'/private','private home');
for(const fd of fs.readdirSync('/proc/self/fd')) {
  let path;try{path=fs.readlinkSync('/proc/self/fd/'+fd)}catch{continue}
  assert.notEqual(path,credential,'inherited authority descriptor');
}
const input=fs.readFileSync(0,'utf8');
assert.equal(input,'stdin-build-input');
assert.equal(fs.readFileSync('source.txt','utf8'),'small input');
fs.writeFileSync('source.txt','edited input');
fs.writeFileSync('artifact.txt',fs.readFileSync('source.txt','utf8')+' / '+input);
assert.equal(fs.readFileSync('artifact.txt','utf8'),'edited input / stdin-build-input');
const ns=Object.fromEntries(['pid','net','mnt','user','ipc'].map(name=>[name,fs.readlinkSync('/proc/self/ns/'+name)]));
// A live grandchild, synchronized by its stdout, must not survive command exit.
const descendant=spawn('/toolchain/node',['-e',"process.stdout.write('ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)"],{stdio:['ignore','pipe','inherit']});
descendant.stdout.once('data',()=>{console.log(JSON.stringify(ns));process.exit(0)});
`;
  const result = await sandbox.run({ argv: ['/toolchain/node', '-e', canary,
    JSON.stringify([foreignFile, credential, authority, common, process.pid])], stdin: 'stdin-build-input' });
  assert.equal(result.kind, 'exited', JSON.stringify(result));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(readFileSync(join(workspace, 'source.txt'), 'utf8'), 'edited input');
  assert.equal(readFileSync(join(workspace, 'artifact.txt'), 'utf8'), 'edited input / stdin-build-input');
  assert.equal(readFileSync(foreignFile, 'utf8'), 'foreign bytes');
  assert.equal(readFileSync(credential, 'utf8'), 'synthetic-provider-secret');
  assert.equal(readFileSync(authority, 'utf8'), 'synthetic-authority-path');
  assert.equal(readFileSync(common, 'utf8'), 'shared Git metadata');
  assert.equal(readFileSync(join(workspace, '.git', 'config'), 'utf8'), 'protected Git metadata');
  assert.equal(readFileSync(join(workspace, 'nested', '.git'), 'utf8'), 'gitdir: ' + common);
  const childNamespaces = JSON.parse(result.stdout) as Record<string, string>;
  for (const name of Object.keys(hostNamespaces)) assert.notEqual(childNamespaces[name], hostNamespaces[name], name + ' namespace');
  function assertNamespaceGone(namespace: string): void {
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      let actual: string;
      try { actual = readlinkSync('/proc/' + pid + '/ns/pid'); }
      catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT');
        continue;
      }
      assert.notEqual(actual, namespace, 'sandbox descendant survived close');
    }
  }
  assertNamespaceGone(childNamespaces.pid!);
  const nonzero = await sandbox.run({ argv: ['/toolchain/node', '-e', 'process.exit(7)'] });
  assert.equal(nonzero.kind, 'exited'); assert.equal(nonzero.exitCode, 7);
  const missing = await sandbox.run({ argv: ['/absent-command'] });
  assert.equal(missing.kind, 'indeterminate'); assert.equal(missing.exitCode, 125);
  assert.match(missing.diagnostic!, /startup failure: ENOENT/);
  assert.throws(() => createLinuxSandbox({ ...configuration, workspace, bubblewrap: join(root, 'missing-bwrap') }), /ENOENT/);
  assert.throws(() => createLinuxSandbox({ ...configuration, workspace, deadlineMs: 0 }), /bounds/);
  const marker = join(workspace, 'would-run');
  const broken = createLinuxSandbox({ ...configuration, workspace, runtimePaths: [] });
  const startup = await broken.run({ argv: ['/toolchain/node', '-e', "require('node:fs').writeFileSync('would-run','unsafe')"] });
  assert.equal(startup.kind, 'indeterminate');
  assert.notEqual(startup.exitCode, 0);
  assert.equal(existsSync(marker), false, 'startup failure must not run on the host');
  const bounded = createLinuxSandbox({ ...configuration, workspace, deadlineMs: 800, outputBytes: 1024 });
  const blocked = await bounded.run({ argv: ['/toolchain/node', '-e', `
const fs=require('node:fs');const {spawn}=require('node:child_process');
const child=spawn('/toolchain/node',['-e',"process.stdout.write('ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)"],{stdio:['ignore','pipe','inherit']});
child.stdout.once('data',()=>{console.log(fs.readlinkSync('/proc/self/ns/pid'));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)});
`] });
  assert.equal(blocked.kind, 'deadline');
  assert.match(blocked.stdout.trim(), /^pid:\[\d+\]$/);
  assertNamespaceGone(blocked.stdout.trim());
  // Two raw bytes fit, but decoding two malformed bytes needs six UTF-8 bytes.
  const textBounded = createLinuxSandbox({ ...configuration, workspace, outputBytes: 3 });
  const malformed = await textBounded.run({ argv: ['/toolchain/node', '-e', "const fs=require('node:fs');fs.writeSync(1,Buffer.from([0xff]));fs.writeSync(2,Buffer.from([0xff]));process.exit(7)"] });
  assert.ok(Buffer.byteLength(malformed.stdout) + Buffer.byteLength(malformed.stderr) <= 3, 'returned UTF-8 must respect the combined byte budget');
  assert.equal(malformed.stdout, '\uFFFD'); assert.equal(malformed.stderr, '');
  assert.equal(malformed.kind, 'output-limit');
  assert.equal(malformed.exitCode, 7); assert.equal(malformed.signal, null);
  // The raw output cap cuts the final multibyte character after its first byte.
  const overflow = await bounded.run({ argv: ['/toolchain/node', '-e', "require('node:fs').writeSync(1,'x'.repeat(1023)+'é');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)"] });
  assert.equal(overflow.kind, 'output-limit');
  assert.ok(Buffer.byteLength(overflow.stdout) + Buffer.byteLength(overflow.stderr) <= 1024);
  assert.equal(overflow.stdout, 'x'.repeat(1023)); assert.equal(overflow.stderr, '');
});
