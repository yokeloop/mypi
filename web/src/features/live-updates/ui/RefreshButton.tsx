import { Button } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { refreshData } from '../model/refresh';

export function RefreshButton() {
  const client = useQueryClient();
  return <Button variant="default" size="xs" onClick={() => void refreshData(client)}>Refresh</Button>;
}
