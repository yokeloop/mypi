import type { QueryClient } from '@tanstack/react-query';

export function refreshData(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'session' });
}
