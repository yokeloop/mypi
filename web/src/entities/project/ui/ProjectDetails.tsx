import { Alert, Anchor, Group, Stack, Title } from '@mantine/core';
import { Link } from 'react-router';
import { FieldList } from '../../../shared/ui';
import { display, extraFields, text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';
import { useFlow } from '../model/queries';

const KNOWN = ['code', 'org', 'slug', 'identity', 'repository', 'checkoutPath'];

export function ProjectDetails({ project }: { project: Rec }) {
  const code = text(project, 'code');
  const flow = useFlow(code);
  return (
    <Stack>
      <FieldList rows={[...KNOWN.map(key => [key, display(project[key])] as [string, string]), ...extraFields(project, KNOWN)]} />
      <Title order={5}>Flow</Title>
      {flow.error ? <Alert color="red">{flow.error.message}</Alert> : flow.data && <FieldList rows={extraFields(flow.data, [])} />}
      {code !== null && (
        <Group>
          <Anchor component={Link} to={'/tasks?project=' + encodeURIComponent(code)}>Tasks</Anchor>
          <Anchor component={Link} to={'/events?to=' + encodeURIComponent(code)}>Events</Anchor>
          <Anchor component={Link} to={'/journal?scope=' + encodeURIComponent('project:' + code)}>Journal</Anchor>
        </Group>
      )}
    </Stack>
  );
}
