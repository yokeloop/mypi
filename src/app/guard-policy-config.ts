import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { MAX_POLICY_BYTES, parsePolicyYaml } from '../infrastructure/configuration/policy-yaml.js';
import { normalizeGuardPolicy } from '../modules/work-context/public.js';
import type { GuardPolicy } from '../modules/work-context/public.js';
import { InputError } from '../shared/errors.js';

/** Validate syntax and schema without reading or installing configuration. */
export function validateGuardPolicyText(text: string): GuardPolicy {
  return normalizeGuardPolicy(parsePolicyYaml(text));
}

/** Read only the selected file; missing or invalid input never falls back to defaults. */
export function loadGuardPolicyConfiguration(path: string): GuardPolicy {
  let fd: number | undefined;
  let text: string;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new InputError('Guard policy source must be a regular file');
    if (stat.size > MAX_POLICY_BYTES) throw new InputError('Guard policy source exceeds 65536 bytes');
    const bytes = Buffer.alloc(MAX_POLICY_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const size = readSync(fd, bytes, length, bytes.length - length, null);
      if (size === 0) break;
      length += size;
    }
    if (length > MAX_POLICY_BYTES) throw new InputError('Guard policy source exceeds 65536 bytes');
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    } catch {
      throw new InputError('Guard policy source must contain valid UTF-8');
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Guard policy source unavailable: select an existing readable regular file');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return validateGuardPolicyText(text);
}
