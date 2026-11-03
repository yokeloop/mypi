import { useInfiniteQuery } from '@tanstack/react-query';
import { apiGet } from '../../../shared/api';
import { apiPath, asPage } from '../../../shared/lib';

export function useJournalPages(filters: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: ['journal', filters],
    queryFn: ({ pageParam }) => apiGet(apiPath('journal', filters, pageParam)).then(asPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.next ?? undefined,
  });
}
