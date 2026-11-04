import { useSearchParams } from 'react-router';
import { filtersOf, withFilter } from '../../../shared/lib';
import type { Screen } from '../../../shared/lib';

export function useFilters(screen: Screen): [Record<string, string>, (key: string, value: string | null) => void] {
  const [params, setParams] = useSearchParams();
  return [filtersOf(screen, params), (key, value) => setParams(current => withFilter(current, key, value), { replace: true })];
}
