import { useState } from 'react';
import { Drawer, Group, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { EventCard, EventDetails, useEventPages } from '../../../entities/event';
import { ChoiceFilter, SearchField, SelectFilter, TextFilter, useFilters } from '../../../features/filters';
import { text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';
import { RecordList } from '../../../widgets/record-list';

const KINDS = ['turn_end', 'waiting', 'milestone', 'message'];
const DELIVERY = [{ label: 'All', value: '' }, { label: 'Pending', value: 'false' }, { label: 'Delivered', value: 'true' }];

export function EventsPage() {
  const [filters, setFilter] = useFilters('events');
  const [selected, setSelected] = useState<Rec | null>(null);
  const phone = useMediaQuery('(max-width: 48em)');
  const pages = useEventPages(filters);
  return (
    <Stack>
      <Group gap="xs" wrap="wrap" align="flex-end">
        <TextFilter label="To" value={filters.to} onChange={v => setFilter('to', v)} />
        <TextFilter label="From" value={filters.from} onChange={v => setFilter('from', v)} />
        <SelectFilter label="Kind" data={KINDS} value={filters.kind} onChange={v => setFilter('kind', v)} />
        <ChoiceFilter label="Delivery" data={DELIVERY} value={filters.delivered} onChange={v => setFilter('delivered', v)} />
        <SearchField value={filters.q} onChange={v => setFilter('q', v)} />
      </Group>
      <RecordList items={pages.data?.pages.flatMap(page => page.items) ?? []} loading={pages.isPending} error={pages.error}
        render={event => <EventCard event={event} onSelect={setSelected} />}
        more={{ has: pages.hasNextPage, loading: pages.isFetchingNextPage, load: () => void pages.fetchNextPage() }} />
      <Drawer position="right" size={phone ? '100%' : 'md'} opened={selected !== null} onClose={() => setSelected(null)}
        title={selected === null ? '' : text(selected, 'kind')}>
        {selected !== null && <EventDetails event={selected} />}
      </Drawer>
    </Stack>
  );
}
