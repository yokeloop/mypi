import { useEffect, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';

export function useDebouncedFilter(value: string | undefined, onChange: (value: string | null) => void): [string, (draft: string) => void] {
  const [draft, setDraft] = useState(value ?? '');
  const [debounced] = useDebouncedValue(draft, 300);
  useEffect(() => {
    if (debounced.trim() !== (value ?? '')) onChange(debounced);
  }, [debounced]);
  return [draft, setDraft];
}
