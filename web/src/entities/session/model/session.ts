import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../../shared/api';
import { ApiFailure, asRecord } from '../../../shared/lib';

export const SESSION_KEY = ['session'] as const;

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return asRecord(await apiGet('/v1/session'));
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) return null;
        throw error;
      }
    },
  });
}
