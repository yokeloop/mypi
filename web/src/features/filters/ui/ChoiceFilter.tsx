import { Input, SegmentedControl } from '@mantine/core';

export function ChoiceFilter({ label, data, value, onChange }: { label: string; data: { label: string; value: string }[];
  value: string | undefined; onChange: (value: string | null) => void }) {
  return (
    <Input.Wrapper label={label} w={{ base: '100%', sm: 200 }}>
      <SegmentedControl data={data} value={value ?? ''} onChange={next => onChange(next)} fullWidth />
    </Input.Wrapper>
  );
}
