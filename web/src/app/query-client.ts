import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiFailure } from '../shared/lib';

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: error => {
        if (error instanceof ApiFailure && error.status === 401) client.setQueryData(['session'], null);
      },
    }),
    defaultOptions: { queries: { retry: (count, error) => !(error instanceof ApiFailure && error.status < 500) && count < 2 } },
  });
  return client;
}
