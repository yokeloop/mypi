import { Badge } from '@mantine/core';

export function LiveBadge({ live }: { live: boolean }) {
  return <Badge color={live ? 'green' : 'gray'} variant="light">{live ? 'Live' : 'Offline'}</Badge>;
}
