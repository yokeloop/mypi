import { Anchor, Group, Stack } from '@mantine/core';
import { Link } from 'react-router';
import { FieldList } from '../../../shared/ui';
import { display, extraFields, text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';

const KNOWN = ['key', 'project', 'number', 'title', 'status', 'isTerminal', 'contextDir', 'worktreePath', 'createdAt', 'updatedAt'];

export function TaskDetails({ task }: { task: Rec }) {
  const key = text(task, 'key');
  return (
    <Stack>
      <FieldList rows={[...KNOWN.map(name => [name, display(task[name])] as [string, string]), ...extraFields(task, KNOWN)]} />
      {key !== null && (
        <Group>
          <Anchor component={Link} to={'/journal?scope=' + encodeURIComponent('task:' + key)}>Journal</Anchor>
          <Anchor component={Link} to={'/events?from=' + encodeURIComponent(key)}>Events</Anchor>
        </Group>
      )}
    </Stack>
  );
}
