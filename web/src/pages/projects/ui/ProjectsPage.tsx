import { useState } from 'react';
import { Drawer, Group, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ProjectCard, ProjectDetails, useProjects } from '../../../entities/project';
import { SearchField, SelectFilter, useFilters } from '../../../features/filters';
import { filterProjects, text } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';
import { RecordList } from '../../../widgets/record-list';

export function ProjectsPage() {
  const [filters, setFilter] = useFilters('projects');
  const [selected, setSelected] = useState<Rec | null>(null);
  const phone = useMediaQuery('(max-width: 48em)');
  const all = useProjects(), list = useProjects(filters.org);
  const orgs = [...new Set((all.data ?? []).map(p => text(p, 'org')).filter(org => org !== null))];
  return (
    <Stack>
      <Group gap="xs" wrap="wrap" align="flex-end">
        <SelectFilter label="Organization" data={orgs} value={filters.org} onChange={v => setFilter('org', v)} />
        <SearchField value={filters.q} onChange={v => setFilter('q', v)} />
      </Group>
      <RecordList items={filterProjects(list.data ?? [], filters.q)} loading={list.isPending} error={list.error}
        render={project => <ProjectCard project={project} onSelect={setSelected} />} />
      <Drawer position="right" size={phone ? '100%' : 'md'} opened={selected !== null} onClose={() => setSelected(null)}
        title={selected === null ? '' : text(selected, 'code')}>
        {selected !== null && <ProjectDetails project={selected} />}
      </Drawer>
    </Stack>
  );
}
