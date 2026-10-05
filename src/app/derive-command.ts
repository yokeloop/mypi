export interface DeriveGrant { artifact: string; workspace: string }
export function deriveCommand(grant: DeriveGrant, name: string, input: unknown): { name: string; arguments: Record<string, unknown> } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Derive arguments required');
  const args = input as Record<string, unknown>;
  const allowed = name === 'derive_read' ? ['format', 'version', 'section'] : name === 'derive_catch_up' ? []
    : name === 'derive_publish' ? ['base_version', 'edits', 'message'] : undefined;
  if (!allowed || Object.keys(args).some(k => !allowed.includes(k))) throw new Error('Derive operation denied');
  const version = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
  if (name === 'derive_read' && ((args.format !== undefined && (typeof args.format !== 'string' || !['html', 'text', 'markdown'].includes(args.format)))
    || (args.version !== undefined && !version(args.version)) || (args.section !== undefined && !text(args.section, 200)))) throw new Error('Invalid Derive read');
  if (name === 'derive_publish') {
    if (!version(args.base_version) || !Array.isArray(args.edits) || args.edits.length < 1 || args.edits.length > 20
      || (args.message !== undefined && !text(args.message, 1000))) throw new Error('Invalid Derive publication');
    for (const value of args.edits) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Derive edit');
      const edit = value as Record<string, unknown>;
      if (Object.keys(edit).some(k => !['old_str', 'new_str'].includes(k)) || !text(edit.old_str, 10000)
        || edit.old_str === '' || !text(edit.new_str, 10000)) throw new Error('Invalid Derive edit');
    }
  }
  if (JSON.stringify(args).length > 16000) throw new Error('Derive edit budget exceeded');
  return { name: name.slice('derive_'.length), arguments: { ...args, short_id: grant.artifact, workspace: grant.workspace } };
}
