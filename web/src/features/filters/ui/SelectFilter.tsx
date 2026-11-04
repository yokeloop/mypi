import { Select } from '@mantine/core';

export function SelectFilter({ label, data, value, onChange }: { label: string; data: string[]; value: string | undefined;
  onChange: (value: string | null) => void }) {
  return <Select label={label} data={data} value={value ?? null} onChange={next => onChange(next)} clearable w={{ base: '100%', sm: 200 }} />;
}
