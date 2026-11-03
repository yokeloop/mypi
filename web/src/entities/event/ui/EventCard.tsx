import { Badge, Card, Group, Text } from '@mantine/core';
import { ValueBadge } from '../../../shared/ui';
import { display, text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';

const KINDS = { message: 'violet', turn_end: 'blue', waiting: 'orange', milestone: 'teal' };

export function EventCard({ event, onSelect }: { event: Rec; onSelect: (event: Rec) => void }) {
  const pending = event.deliveredAt === null;
  return (
    <Card withBorder onClick={() => onSelect(event)} style={{ cursor: 'pointer' }}>
      <Group gap="xs" wrap="wrap">
        <ValueBadge value={text(event, 'kind')} colors={KINDS} />
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{display(event.from) + ' → ' + display(event.to)}</Text>
        <Text size="xs" c="dimmed">{text(event, 'createdAt')}</Text>
        <Badge color={pending ? 'yellow' : 'gray'} variant="outline">{pending ? 'pending' : 'delivered'}</Badge>
      </Group>
      <Text lineClamp={6} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(event, 'text')}</Text>
    </Card>
  );
}
