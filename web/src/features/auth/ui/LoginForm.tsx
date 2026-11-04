import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, PasswordInput, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { SESSION_KEY } from '../../../entities/session';
import { apiSend } from '../../../shared/api';

export function LoginForm() {
  const client = useQueryClient();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/v1/session', { token });
      await client.invalidateQueries({ queryKey: SESSION_KEY });
      setToken('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={event => void submit(event)}>
      <Stack>
        <PasswordInput label="API token" value={token} onChange={event => setToken(event.currentTarget.value)} autoComplete="off" required />
        <Text size="sm" c="dimmed">Paste a token from <code>mypi token create</code>. The browser keeps it only in an HttpOnly cookie.</Text>
        {error !== null && <Alert color="red">{error}</Alert>}
        <Button type="submit" loading={busy}>Sign in</Button>
      </Stack>
    </form>
  );
}
