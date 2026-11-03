import { TextFilter } from './TextFilter';

export function SearchField({ value, onChange }: { value: string | undefined; onChange: (value: string | null) => void }) {
  return <TextFilter label="Search" value={value} onChange={onChange} />;
}
