import { useState } from 'react';
import { Drawer, Group, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useProjects } from '../../../entities/project';
import { TaskCard, TaskDetails, useTaskPages } from '../../../entities/task';
import { SearchField, SelectFilter, SuggestFilter, useFilters } from '../../../features/filters';
import { text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';
import { RecordList } from '../../../widgets/record-list';

export function TasksPage() {
  const [filters, setFilter] = useFilters('tasks');
  const [selected, setSelected] = useState<Rec | null>(null);
  const phone = useMediaQuery('(max-width: 48em)');
  const projects = useProjects(), pages = useTaskPages(filters);
  const items = pages.data?.pages.flatMap(page => page.items) ?? [];
  const codes = (projects.data ?? []).map(p => text(p, 'code')).filter(code => code !== null);
  const statuses = [...new Set(items.map(task => text(task, 'status')).filter(status => status !== null))];
  return (
    <Stack>
      <Group gap="xs" wrap="wrap" align="flex-end">
        <SelectFilter label="Project" data={codes} value={filters.project} onChange={v => setFilter('project', v)} />
        <SuggestFilter label="Status" data={statuses} value={filters.status} onChange={v => setFilter('status', v)} />
        <SearchField value={filters.q} onChange={v => setFilter('q', v)} />
      </Group>
      <RecordList items={items} loading={pages.isPending} error={pages.error}
        render={task => <TaskCard task={task} onSelect={setSelected} />}
        more={{ has: pages.hasNextPage, loading: pages.isFetchingNextPage, load: () => void pages.fetchNextPage() }} />
      <Drawer position="right" size={phone ? '100%' : 'md'} opened={selected !== null} onClose={() => setSelected(null)}
        title={selected === null ? '' : text(selected, 'key')}>
        {selected !== null && <TaskDetails task={selected} />}
      </Drawer>
    </Stack>
  );
}
