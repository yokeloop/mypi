import { useState } from 'react';
import { Drawer, Group, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { JournalEntryCard, JournalEntryDetails, useJournalPages } from '../../../entities/journal-entry';
import { DateFilter, SearchField, SelectFilter, TextFilter, useFilters } from '../../../features/filters';
import { JOURNAL_TYPES, text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';
import { RecordList } from '../../../widgets/record-list';

export function JournalPage() {
  const [filters, setFilter] = useFilters('journal');
  const [selected, setSelected] = useState<Rec | null>(null);
  const phone = useMediaQuery('(max-width: 48em)');
  const pages = useJournalPages(filters);
  return (
    <Stack>
      <Group gap="xs" wrap="wrap" align="flex-end">
        <TextFilter label="Scope" value={filters.scope} onChange={v => setFilter('scope', v)} />
        <SelectFilter label="Type" data={[...JOURNAL_TYPES]} value={filters.type} onChange={v => setFilter('type', v)} />
        <DateFilter label="From" value={filters.from} onChange={v => setFilter('from', v)} />
        <DateFilter label="To" value={filters.to} onChange={v => setFilter('to', v)} />
        <SearchField value={filters.q} onChange={v => setFilter('q', v)} />
      </Group>
      <RecordList items={pages.data?.pages.flatMap(page => page.items) ?? []} loading={pages.isPending} error={pages.error}
        render={entry => <JournalEntryCard entry={entry} onSelect={setSelected} />}
        more={{ has: pages.hasNextPage, loading: pages.isFetchingNextPage, load: () => void pages.fetchNextPage() }} />
      <Drawer position="right" size={phone ? '100%' : 'md'} opened={selected !== null} onClose={() => setSelected(null)}
        title={selected === null ? '' : text(selected, 'at')}>
        {selected !== null && <JournalEntryDetails entry={selected} />}
      </Drawer>
    </Stack>
  );
}
