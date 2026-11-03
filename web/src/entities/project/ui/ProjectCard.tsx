import { Card, Text } from '@mantine/core';
import { text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';

export function ProjectCard({ project, onSelect }: { project: Rec; onSelect: (project: Rec) => void }) {
  return (
    <Card withBorder onClick={() => onSelect(project)} style={{ cursor: 'pointer' }}>
      <Text fw={600}>{text(project, 'code')}</Text>
      <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(project, 'identity')}</Text>
    </Card>
  );
}
