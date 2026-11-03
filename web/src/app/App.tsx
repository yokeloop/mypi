import { Center, Loader, MantineProvider, Text } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useSession } from '../entities/session';
import { LoginPage } from '../pages/login';
import { AppLayout } from '../widgets/layout';
import { createQueryClient } from './query-client';

const client = createQueryClient();

function AuthGate() {
  const session = useSession();
  if (session.isPending) return <Center mih="100vh"><Loader /></Center>;
  if (session.data === null) return <LoginPage />;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/projects" element={<Text>Projects</Text>} />
        <Route path="/tasks" element={<Text>Tasks</Text>} />
        <Route path="/events" element={<Text>Events</Text>} />
        <Route path="/journal" element={<Text>Journal</Text>} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <AuthGate />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}
