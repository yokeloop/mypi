import { InputError } from '../../shared/errors.js';

const GUARD_NAMES = ['outsideWorktreeWrite', 'baseCheckoutWrite', 'foreignMypiTarget'] as const;
export type GuardName = typeof GUARD_NAMES[number];
export type GuardBehavior = 'warn' | 'block';
export interface GuardPolicy {
  readonly version: 2;
  readonly guards: Readonly<Record<GuardName, GuardBehavior>>;
}

/** Use when no configuration was selected, never as a fallback for invalid input. */
export const DEFAULT_GUARD_POLICY: GuardPolicy = Object.freeze({
  version: 2,
  guards: Object.freeze({
    outsideWorktreeWrite: 'block', baseCheckoutWrite: 'block', foreignMypiTarget: 'block',
  }),
});

function fail(location: string, expected: string): never {
  throw new InputError(`Invalid guard policy ${location}: ${expected}`);
}
function mapping(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(location, 'expected mapping');
  return value as Record<string, unknown>;
}
function knownFields(value: Record<string, unknown>, allowed: readonly string[], location: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(location, 'unknown field');
}

/** YAML-neutral validation; the syntax/file adapter delegates document semantics here. */
export function normalizeGuardPolicy(value: unknown): GuardPolicy {
  const root = mapping(value, 'document');
  if (root['version'] === 1) fail('version', 'version 1 is incompatible; use version 2');
  if (root['version'] !== 2) fail('version', 'expected 2');
  knownFields(root, ['version', 'guards'], 'document');
  const guards = root['guards'] === undefined ? {} : mapping(root['guards'], 'guards');
  knownFields(guards, GUARD_NAMES, 'guards');
  function behavior(name: GuardName): GuardBehavior {
    const value = guards[name];
    if (value === undefined) return DEFAULT_GUARD_POLICY.guards[name];
    if (value !== 'warn' && value !== 'block') fail(`guards.${name}`, 'expected warn or block');
    return value;
  }
  return Object.freeze({ version: 2, guards: Object.freeze({
    outsideWorktreeWrite: behavior('outsideWorktreeWrite'),
    baseCheckoutWrite: behavior('baseCheckoutWrite'),
    foreignMypiTarget: behavior('foreignMypiTarget'),
  }) });
}

export interface GuardExplanation {
  readonly guard: GuardName;
  readonly behavior: GuardBehavior;
  readonly message: string;
}

const GUARD_DESCRIPTIONS: Readonly<Record<GuardName, string>> = {
  outsideWorktreeWrite: 'writing outside the selected worktree',
  baseCheckoutWrite: 'writing to the base checkout',
  foreignMypiTarget: 'targeting a mypi project outside the working selection',
};

/** Reports the configured response to a guard condition, not an intercepted operation. */
export function explainGuard(policy: GuardPolicy, guard: GuardName): GuardExplanation {
  const behavior = policy.guards[guard];
  return { guard, behavior, message: `Configured to ${behavior} when ${GUARD_DESCRIPTIONS[guard]}.` };
}
