import type { CSSProperties, ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  AppShell as MantineAppShell,
  Badge,
  Button,
  Group,
  Text,
  Title,
} from '@mantine/core';
import { useAuth } from '../lib/auth';

const linkStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  fontWeight: isActive ? 700 : 400,
  textDecoration: 'none',
  color: 'inherit',
});

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <MantineAppShell header={{ height: 60 }} padding="md">
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xl">
            <Title order={4}>CRM «Объекты и задачи»</Title>
            <Group gap="md">
              <NavLink to="/objects" style={linkStyle}>
                Объекты
              </NavLink>
              <NavLink to="/my-tasks" style={linkStyle}>
                Мои задачи
              </NavLink>
            </Group>
          </Group>
          <Group gap="sm">
            {profile && (
              <>
                <Text size="sm">{profile.full_name}</Text>
                <Badge color={profile.role === 'manager' ? 'blue' : 'teal'}>
                  {profile.role === 'manager' ? 'Постановщик' : 'Исполнитель'}
                </Badge>
              </>
            )}
            <Button variant="subtle" size="sm" onClick={handleSignOut}>
              Выйти
            </Button>
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  );
}
