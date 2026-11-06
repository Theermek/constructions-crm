import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { getErrorMessage } from '../lib/errors';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/transitions';
import type { Tables } from '../lib/database.types';

type TaskRow = Tables<'tasks'> & { object: { name: string } | null };

async function fetchMyTasks(userId: string): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, object:object_id(name)')
    .eq('assignee_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as TaskRow[];
}

export function MyTasksPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tasks', 'mine', profile?.id],
    queryFn: () => fetchMyTasks(profile!.id),
    enabled: !!profile,
  });

  return (
    <Stack gap="md">
      <Title order={2}>Мои задачи</Title>

      {isLoading && <Loader />}
      {isError && <Alert color="red">{getErrorMessage(error as { message?: string })}</Alert>}

      {!isLoading && data && data.length === 0 && <Text c="dimmed">У вас нет назначенных задач.</Text>}

      {!isLoading && data && data.length > 0 && (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Задача</Table.Th>
              <Table.Th>Объект</Table.Th>
              <Table.Th>Статус</Table.Th>
              <Table.Th>Создана</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((task) => (
              <Table.Tr
                key={task.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <Table.Td>{task.title}</Table.Td>
                <Table.Td>{task.object?.name ?? '—'}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLORS[task.status]}>{STATUS_LABELS[task.status]}</Badge>
                </Table.Td>
                <Table.Td>{new Date(task.created_at).toLocaleString('ru-RU')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
