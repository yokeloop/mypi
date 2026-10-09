import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { MAX_POLICY_BYTES } from '../infrastructure/configuration/policy-yaml.js';
import { DEFAULT_GUARD_POLICY, explainGuard } from '../modules/work-context/public.js';
import type { GuardName } from '../modules/work-context/public.js';
import { validateGuardPolicyText } from './guard-policy-config.js';
import { InputError } from '../shared/errors.js';

export const POLICY_GUARDS = Object.keys(DEFAULT_GUARD_POLICY.guards) as GuardName[];

export function policyGuard(value: unknown): GuardName {
  if (typeof value !== 'string' || !Object.hasOwn(DEFAULT_GUARD_POLICY.guards, value)) {
    throw new InputError('Unknown policy guard');
  }
  return value as GuardName;
}

/** Read only explicitly selected CLI input; never install configuration. */
export function readPolicyInputFile(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_POLICY_BYTES) throw new InputError('Policy input must be a regular file of at most 65536 bytes');
    const buffer = Buffer.alloc(MAX_POLICY_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const size = readSync(fd, buffer, length, buffer.length - length, null);
      if (!size) break;
      length += size;
    }
    if (length > MAX_POLICY_BYTES) throw new InputError('Policy input exceeds 65536 bytes');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Policy input unavailable or invalid UTF-8');
  } finally { if (fd !== undefined) closeSync(fd); }
}
export type PolicyCommand =
  | { name: 'policy_validate'; text: string }
  | { name: 'policy_explain'; guard: GuardName; text?: string };

/** Configuration diagnostics, not intercepted operations or guard enforcement. */
export function executePolicyCommand(command: PolicyCommand): unknown {
  if (command.name === 'policy_validate') {
    return { valid: true, policy: validateGuardPolicyText(command.text), diagnostic: 'cooperative' };
  }
  const guard = policyGuard(command.guard);
  const policy = command.text === undefined ? DEFAULT_GUARD_POLICY : validateGuardPolicyText(command.text);
  return { ...explainGuard(policy, guard), diagnostic: 'cooperative' };
}
