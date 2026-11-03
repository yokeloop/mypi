import { useState } from 'react';
import { Alert, Button, Group } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { SESSION_KEY } from '../../../entities/session';
import { apiSend } from '../../../shared/api';

export function LogoutButton() {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const logout = async () => {
    setError(null);
    try {
      await apiSend('DELETE', '/v1/session', {});
      client.clear();
      client.setQueryData(SESSION_KEY, null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <Group gap="xs" wrap="nowrap">
      {error !== null && <Alert color="red" p={4}>{error}</Alert>}
      <Button variant="default" size="xs" onClick={() => void logout()}>Logout</Button>
    </Group>
  );
}
