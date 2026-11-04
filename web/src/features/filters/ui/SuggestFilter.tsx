import { Autocomplete } from '@mantine/core';
import { useDebouncedFilter } from '../model/useDebouncedFilter';

export function SuggestFilter({ label, data, value, onChange }: { label: string; data: string[]; value: string | undefined;
  onChange: (value: string | null) => void }) {
  const [draft, setDraft] = useDebouncedFilter(value, onChange);
  return <Autocomplete label={label} data={data} value={draft} onChange={setDraft} w={{ base: '100%', sm: 200 }} />;
}
