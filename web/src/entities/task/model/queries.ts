import { useInfiniteQuery } from '@tanstack/react-query';
import { apiGet } from '../../../shared/api';
import { apiPath, asPage } from '../../../shared/lib';

export function useTaskPages(filters: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: ['tasks', filters],
    queryFn: ({ pageParam }) => apiGet(apiPath('tasks', filters, pageParam)).then(asPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.next ?? undefined,
  });
}
