import { useInfiniteQuery } from '@tanstack/react-query';
import { apiGet } from '../../../shared/api';
import { apiPath, asPage } from '../../../shared/lib';

export function useEventPages(filters: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: ['events', filters],
    queryFn: ({ pageParam }) => apiGet(apiPath('events', filters, pageParam)).then(asPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.next ?? undefined,
  });
}
