import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Loader, Stack, Text } from '@mantine/core';
import type { Rec } from '../../../shared/lib';

export function RecordList({ items, render, loading, error, more }: { items: Rec[]; render: (item: Rec) => ReactNode; loading: boolean;
  error: unknown; more?: { has: boolean; loading: boolean; load: () => void } }) {
  if (loading) return <Loader />;
  if (error) return <Alert color="red">{error instanceof Error ? error.message : String(error)}</Alert>;
  if (items.length === 0) return <Text c="dimmed">Nothing found</Text>;
  return (
    <Stack gap="xs">
      {items.map((item, i) => <Fragment key={i}>{render(item)}</Fragment>)}
      {more?.has && <Button variant="default" loading={more.loading} onClick={more.load}>Load more</Button>}
    </Stack>
  );
}
