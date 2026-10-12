import { isAlias, isMap, isNode, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import { InputError } from '../../shared/errors.js';

export const MAX_POLICY_BYTES = 64 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 4096;
const CORE_TAGS = new Set(['map', 'seq', 'str', 'int', 'float', 'bool', 'null'].map(tag => `tag:yaml.org,2002:${tag}`));

function fail(message: string, offset?: number): never {
  throw new InputError(`Invalid policy YAML${offset === undefined ? '' : ` at offset ${offset}`}: ${message}`);
}

/** Syntax only. The work-context public API owns all policy schema validation. */
export function parsePolicyYaml(text: string): unknown {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_POLICY_BYTES) {
    fail('expected UTF-8 text of at most 65536 bytes');
  }
  try {
    const document = parseDocument(text, {
      version: '1.2', schema: 'core', strict: true, uniqueKeys: true,
      // 'silent' suppresses parseDocument's MULTIPLE_DOCS error; inspect errors without public parse logging.
      merge: false, customTags: [], resolveKnownTags: false, prettyErrors: false, logLevel: 'error',
    });
    const error = document.errors[0] ?? document.warnings[0];
    if (error) {
      const message = error.code === 'DUPLICATE_KEY' ? 'mapping keys must be unique'
        : error.code === 'MULTIPLE_DOCS' ? 'expected exactly one document'
        : 'use valid YAML 1.2 with core tags only';
      fail(message, error.pos[0]);
    }
    if (document.directives?.yaml.version !== '1.2') fail('expected YAML 1.2');
    const pending: { node: unknown; depth: number }[] = [{ node: document.contents, depth: 0 }];
    let count = 0;
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++count > MAX_NODES || depth > MAX_DEPTH) fail('exceeds 4096 nodes or 64 nesting levels');
      if (isAlias(node)) fail('aliases are not supported', node.range?.[0]);
      if (isNode(node)) {
        if ('anchor' in node && node.anchor) fail('anchors are not supported', node.range?.[0]);
        if (node.tag && !CORE_TAGS.has(node.tag)) fail('custom tags are not supported', node.range?.[0]);
      }
      if (isMap(node)) {
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') fail('mapping keys must be strings');
          if (pair.key.value === '<<') fail('merge keys are not supported', pair.key.range?.[0]);
          pending.push({ node: pair, depth });
        }
      } else if (isPair(node)) {
        pending.push({ node: node.key, depth: depth + 1 }, { node: node.value, depth: depth + 1 });
      } else if (isSeq(node)) {
        for (const item of node.items) pending.push({ node: item, depth: depth + 1 });
      }
    }
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof InputError) throw error;
    // Do not echo source snippets, arbitrary tag names or parser internals.
    fail('cannot parse bounded YAML; simplify nesting and check syntax');
  }
}
