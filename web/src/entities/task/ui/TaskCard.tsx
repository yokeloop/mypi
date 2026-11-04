import { Card, Group, Text } from '@mantine/core';
import { ValueBadge } from '../../../shared/ui';
import { text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';

export function TaskCard({ task, onSelect }: { task: Rec; onSelect: (task: Rec) => void }) {
  const status = text(task, 'status');
  return (
    <Card withBorder onClick={() => onSelect(task)} style={{ cursor: 'pointer' }}>
      <Group gap="xs" wrap="wrap">
        <Text fw={600}>{text(task, 'key')}</Text>
        <ValueBadge value={status} colors={status === null ? {} : { [status]: task.isTerminal === true ? 'gray' : 'blue' }} />
        <Text size="xs" c="dimmed">{text(task, 'updatedAt')}</Text>
      </Group>
      <Text lineClamp={6} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(task, 'title')}</Text>
    </Card>
  );
}
