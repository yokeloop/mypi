import { Badge } from '@mantine/core';

export function ValueBadge({ value, colors }: { value: string | null; colors: Record<string, string> }) {
  return <Badge color={(value !== null && colors[value]) || 'gray'} variant="light">{value ?? '—'}</Badge>;
}
