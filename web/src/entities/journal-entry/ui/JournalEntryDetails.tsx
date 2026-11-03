import { List, Stack, Title } from '@mantine/core';
import { FieldList } from '../../../shared/ui';
import { display, extraFields, text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';

const KNOWN = ['id', 'at', 'scope', 'type', 'text', 'artifacts'];

function artifact(value: unknown): string {
  if (typeof value !== 'object' || value === null) return display(value);
  const path = text(value as Rec, 'path'), commit = text(value as Rec, 'commit');
  return commit === null ? display(path) : display(path) + ' @ ' + commit.slice(0, 12);
}

export function JournalEntryDetails({ entry }: { entry: Rec }) {
  const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
  return (
    <Stack>
      <FieldList rows={[...KNOWN.map(key => [key, display(entry[key])] as [string, string]), ...extraFields(entry, KNOWN)]} />
      {artifacts.length > 0 && (
        <>
          <Title order={5}>Artifacts</Title>
          <List style={{ overflowWrap: 'anywhere' }}>
            {artifacts.map((value: unknown, i) => <List.Item key={i}>{artifact(value)}</List.Item>)}
          </List>
        </>
      )}
    </Stack>
  );
}
