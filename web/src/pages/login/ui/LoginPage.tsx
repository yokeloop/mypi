import { Center, Paper } from '@mantine/core';
import { LoginForm } from '../../../features/auth';

export function LoginPage() {
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="lg" w="min(100%, 420px)">
        <LoginForm />
      </Paper>
    </Center>
  );
}
