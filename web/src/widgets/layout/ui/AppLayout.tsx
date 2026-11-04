import { AppShell, Burger, Group, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavLink as RouterNavLink, Outlet, useLocation } from 'react-router';
import { useSession } from '../../../entities/session';
import { LogoutButton } from '../../../features/auth';
import { LiveBadge, RefreshButton, useLiveUpdates } from '../../../features/live-updates';
import { text } from '../../../shared/lib';

const LINKS = [['/projects', 'Projects'], ['/tasks', 'Tasks'], ['/events', 'Events'], ['/journal', 'Journal']] as const;

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const live = useLiveUpdates();
  const session = useSession().data;
  const { pathname } = useLocation();
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Title order={4}>mypi</Title>
          <Group ml="auto" gap="xs" wrap="nowrap">
            <LiveBadge live={live} />
            <RefreshButton />
            {session && <Text size="sm" c="dimmed" visibleFrom="sm">{text(session, 'name')}</Text>}
            <LogoutButton />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {LINKS.map(([to, label]) => (
          <NavLink key={to} component={RouterNavLink} to={to} label={label} active={pathname === to} onClick={close} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
