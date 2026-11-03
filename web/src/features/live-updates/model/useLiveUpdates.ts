import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeChanges } from '../../../shared/api';
import { refreshData } from './refresh';

export function useLiveUpdates(): boolean {
  const client = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => subscribeChanges(() => void refreshData(client), setLive), [client]);
  return live;
}
