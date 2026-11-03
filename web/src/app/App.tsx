import { Center, Loader, MantineProvider } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useSession } from '../entities/session';
import { EventsPage } from '../pages/events';
import { JournalPage } from '../pages/journal';
import { LoginPage } from '../pages/login';
import { ProjectsPage } from '../pages/projects';
import { TasksPage } from '../pages/tasks';
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
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/journal" element={<JournalPage />} />
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
