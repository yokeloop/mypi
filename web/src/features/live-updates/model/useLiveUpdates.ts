import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SESSION_KEY } from '../../../entities/session';
import { subscribeChanges } from '../../../shared/api';
import { refreshData } from './refresh';

export function useLiveUpdates(): boolean {
  const client = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => subscribeChanges(() => void refreshData(client), setLive,
    () => void client.invalidateQueries({ queryKey: SESSION_KEY })), [client]);
  return live;
}
