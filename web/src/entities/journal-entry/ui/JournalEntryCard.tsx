import { Badge, Card, Group, Text } from '@mantine/core';
import { ValueBadge } from '../../../shared/ui';
import { JOURNAL_COLORS, text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';

function scopeLabel(entry: Rec): string {
  const scope = entry.scope;
  return (typeof scope === 'object' && scope !== null && text(scope as Rec, 'key')) || 'global';
}

export function JournalEntryCard({ entry, onSelect }: { entry: Rec; onSelect: (entry: Rec) => void }) {
  return (
    <Card withBorder onClick={() => onSelect(entry)} style={{ cursor: 'pointer' }}>
      <Group gap="xs" wrap="wrap">
        <ValueBadge value={text(entry, 'type')} colors={JOURNAL_COLORS} />
        <Badge color="gray" variant="outline">{scopeLabel(entry)}</Badge>
        <Text size="xs" c="dimmed">{text(entry, 'at')}</Text>
      </Group>
      <Text lineClamp={6} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(entry, 'text')}</Text>
    </Card>
  );
}
