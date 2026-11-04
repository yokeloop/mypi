import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../../shared/api';
import { apiPath, asItems, asRecord } from '../../../shared/lib';

export function useProjects(org?: string) {
  return useQuery({ queryKey: ['projects', org], queryFn: () => apiGet(apiPath('projects', org ? { org } : {})).then(asItems) });
}

export function useFlow(code: string | null) {
  return useQuery({ queryKey: ['flow', code], queryFn: () => apiGet('/v1/projects/' + code + '/flow').then(asRecord), enabled: Boolean(code) });
}
