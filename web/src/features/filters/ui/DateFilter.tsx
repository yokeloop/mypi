import { TextInput } from '@mantine/core';

export function DateFilter({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string | null) => void }) {
  return <TextInput type="date" label={label} value={value ?? ''} onChange={event => onChange(event.currentTarget.value)} w={{ base: '100%', sm: 200 }} />;
}
