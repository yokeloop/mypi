import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { MAX_POLICY_BYTES, parsePolicyYaml } from '../infrastructure/configuration/policy-yaml.js';
import { createPolicySnapshot, normalizePolicy } from '../modules/authorization/public.js';
import type { NormalizedPolicy, PolicySnapshot, SnapshotInput } from '../modules/authorization/public.js';
import { InputError } from '../shared/errors.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value)!;
}
function revision(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

export interface ValidatedPolicyConfiguration {
  readonly policy: NormalizedPolicy;
  /** Configuration-only revision, not an effective caller grant. */
  readonly revision: string;
}

/** Text validation neither reads a live source nor installs or grants policy. */
export function validatePolicyText(text: string): ValidatedPolicyConfiguration {
  const policy = normalizePolicy(parsePolicyYaml(text));
  return Object.freeze({ policy, revision: revision({ policy }) });
}

/** Bindings must come from trusted verification, never policy.repositories or tool arguments. */
export function createRevisionedPolicySnapshot(input: Omit<SnapshotInput, 'revision'>): PolicySnapshot {
  const policy = normalizePolicy(input.policy);
  const snapshot = createPolicySnapshot({ ...input, policy, revision: 'pending' });
  // Hash normalized effective inputs, not raw YAML, timestamps or source filenames.
  const bindings = [...snapshot.bindings].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const identity = { principal: { kind: snapshot.identity.principal.kind, id: snapshot.identity.principal.id },
    sessionId: snapshot.identity.sessionId, runtimeId: snapshot.identity.runtimeId };
  return Object.freeze({ ...snapshot, revision: revision({ policy, identity,
    scope: snapshot.scope, profile: snapshot.profile, permissions: snapshot.permissions, bindings }) });
}

/** Trusted in-process selection only. Paths from external command arguments are not authority. */
export type TrustedPolicySource =
  | { readonly kind: 'explicit'; readonly path: string }
  | { readonly kind: 'operator-home'; readonly home: string };

function unsafeSource(): never {
  throw new InputError('Policy source unavailable or unsafe: select an existing operator-owned regular file with trusted directories, no links and no group/other writes');
}
function absoluteSourcePath(path: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || resolve(path) !== path) unsafeSource();
  return path;
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid
    && a.gid === b.gid && a.nlink === b.nlink && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function safeFile(stat: BigIntStats, uid: bigint): void {
  if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1n || (stat.mode & 0o022n) !== 0n) unsafeSource();
  if (stat.size > BigInt(MAX_POLICY_BYTES)) throw new InputError('Policy source exceeds 65536 bytes');
}
function inspectParents(path: string, uid: bigint): readonly [string, BigIntStats][] {
  const parents: [string, BigIntStats][] = [];
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const stat = lstatSync(parent, { bigint: true });
    // Only the conventional root-owned sticky temporary ancestors get this exception.
    const stickyTemp = (parent === '/tmp' || parent === '/var/tmp') && stat.uid === 0n && (stat.mode & 0o1000n) !== 0n;
    if (!stat.isDirectory() || (stat.uid !== uid && stat.uid !== 0n)
      || ((stat.mode & 0o022n) !== 0n && !stickyTemp)) unsafeSource();
    parents.push([parent, stat]);
    if (parent === dirname(parent)) return parents;
  }
}

/**
 * Read-only authoritative load, with no missing/invalid-source fallback or installation.
 * Assumes trusted same-UID processes and stable ancestor/mount namespace: Node path opens
 * cannot eliminate ancestor substitution races. Metadata checks are not a sandbox or lease.
 */
export function loadPolicyConfiguration(source: TrustedPolicySource): ValidatedPolicyConfiguration {
  let fd: number | undefined;
  let text: string;
  try {
    const uidValue = process.geteuid?.();
    if (uidValue === undefined) unsafeSource();
    const uid = BigInt(uidValue);
    const path = source.kind === 'explicit' ? absoluteSourcePath(source.path)
      : source.kind === 'operator-home' ? join(absoluteSourcePath(source.home), 'pi', 'mypi-policy.yaml') : unsafeSource();
    const parents = inspectParents(path, uid);
    const before = lstatSync(path, { bigint: true });
    safeFile(before, uid);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd, { bigint: true });
    safeFile(opened, uid);
    if (!sameFile(before, opened)) unsafeSource();
    const bytes = Buffer.alloc(MAX_POLICY_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const size = readSync(fd, bytes, length, bytes.length - length, null);
      if (size === 0) break;
      length += size;
    }
    if (length > MAX_POLICY_BYTES) throw new InputError('Policy source exceeds 65536 bytes');
    if (!sameFile(opened, fstatSync(fd, { bigint: true })) || !sameFile(opened, lstatSync(path, { bigint: true }))) unsafeSource();
    const afterParents = inspectParents(path, uid);
    if (parents.some(([name, stat], index) => {
      const after = afterParents[index];
      return !after || after[0] !== name || after[1].dev !== stat.dev || after[1].ino !== stat.ino
        || after[1].mode !== stat.mode || after[1].uid !== stat.uid || after[1].gid !== stat.gid;
    })) unsafeSource();
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } catch (error) {
    if (error instanceof InputError) throw error;
    unsafeSource();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return validatePolicyText(text);
}
