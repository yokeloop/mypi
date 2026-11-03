import { Button } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { SESSION_KEY } from '../../../entities/session';
import { apiSend } from '../../../shared/api';

export function LogoutButton() {
  const client = useQueryClient();
  const logout = async () => {
    await apiSend('DELETE', '/v1/session', {});
    client.clear();
    client.setQueryData(SESSION_KEY, null);
  };
  return <Button variant="default" size="xs" onClick={() => void logout()}>Logout</Button>;
}
