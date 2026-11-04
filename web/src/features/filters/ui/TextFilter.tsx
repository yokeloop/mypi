import { TextInput } from '@mantine/core';
import { useDebouncedFilter } from '../model/useDebouncedFilter';

export function TextFilter({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string | null) => void }) {
  const [draft, setDraft] = useDebouncedFilter(value, onChange);
  return <TextInput label={label} value={draft} onChange={event => setDraft(event.currentTarget.value)} w={{ base: '100%', sm: 200 }} />;
}
