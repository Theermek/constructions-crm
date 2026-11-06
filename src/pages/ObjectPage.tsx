import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { getErrorMessage } from '../lib/errors';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/transitions';
import type { Tables } from '../lib/database.types';

type ObjectRow = Tables<'objects'>;
type TaskRow = Tables<'tasks'> & { assignee: { full_name: string } | null };
type ProfileRow = Tables<'profiles'>;

async function fetchObject(id: string): Promise<ObjectRow> {
  const { data, error } = await supabase.from('objects').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function fetchTasks(objectId: string): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, assignee:assignee_id(full_name)')
    .eq('object_id', objectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as TaskRow[];
}

async function fetchExecutors(): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('role', 'executor');
  if (error) throw error;
  return data;
}

export function ObjectPage() {
  const { id } = useParams<{ id: string }>();
  const objectId = id!;
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isManager = profile?.role === 'manager';

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAssignee, setTaskAssignee] = useState<string | null>(null);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const objectQuery = useQuery({
    queryKey: ['object', objectId],
    queryFn: () => fetchObject(objectId),
  });

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'object', objectId],
    queryFn: () => fetchTasks(objectId),
  });

  const executorsQuery = useQuery({
    queryKey: ['profiles', 'executors'],
    queryFn: fetchExecutors,
    enabled: isManager && taskModalOpen,
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Нет профиля');
      const { error } = await supabase.from('tasks').insert({
        object_id: objectId,
        title: taskTitle,
        description: taskDescription,
        assignee_id: taskAssignee,
        author_id: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'object', objectId] });
      void queryClient.invalidateQueries({ queryKey: ['objects'] });
      setTaskModalOpen(false);
      setTaskTitle('');
      setTaskDescription('');
      setTaskAssignee(null);
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: getErrorMessage(error), title: 'Ошибка' });
    },
  });

  const updateObjectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('objects')
        .update({ name: editName, address: editAddress })
        .eq('id', objectId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['object', objectId] });
      void queryClient.invalidateQueries({ queryKey: ['objects'] });
      setEditModalOpen(false);
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: getErrorMessage(error), title: 'Ошибка' });
    },
  });

  const deleteObjectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('objects').delete().eq('id', objectId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['objects'] });
      navigate('/objects');
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: getErrorMessage(error), title: 'Ошибка' });
      setDeleteModalOpen(false);
    },
  });

  function handleCreateTask(e: FormEvent) {
    e.preventDefault();
    createTaskMutation.mutate();
  }

  function handleUpdateObject(e: FormEvent) {
    e.preventDefault();
    updateObjectMutation.mutate();
  }

  function openEditModal() {
    if (objectQuery.data) {
      setEditName(objectQuery.data.name);
      setEditAddress(objectQuery.data.address);
      setEditModalOpen(true);
    }
  }

  if (objectQuery.isLoading) return <Loader />;
  if (objectQuery.isError || !objectQuery.data) {
    return <Alert color="red">{getErrorMessage(objectQuery.error as { message?: string })}</Alert>;
  }

  const object = objectQuery.data;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Stack gap={0}>
          <Title order={2}>{object.name}</Title>
          <Text c="dimmed">{object.address}</Text>
        </Stack>
        {isManager && (
          <Group>
            <Button variant="default" onClick={openEditModal}>
              Редактировать
            </Button>
            <Button color="red" variant="outline" onClick={() => setDeleteModalOpen(true)}>
              Удалить объект
            </Button>
            <Button onClick={() => setTaskModalOpen(true)}>Новая задача</Button>
          </Group>
        )}
      </Group>

      {tasksQuery.isLoading && <Loader />}

      {!tasksQuery.isLoading && tasksQuery.data && tasksQuery.data.length === 0 && (
        <Text c="dimmed">Задач пока нет.</Text>
      )}

      {!tasksQuery.isLoading && tasksQuery.data && tasksQuery.data.length > 0 && (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Название</Table.Th>
              <Table.Th>Статус</Table.Th>
              <Table.Th>Исполнитель</Table.Th>
              <Table.Th>Создана</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tasksQuery.data.map((task) => (
              <Table.Tr
                key={task.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <Table.Td>{task.title}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLORS[task.status]}>{STATUS_LABELS[task.status]}</Badge>
                </Table.Td>
                <Table.Td>{task.assignee?.full_name ?? '—'}</Table.Td>
                <Table.Td>{new Date(task.created_at).toLocaleString('ru-RU')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={taskModalOpen} onClose={() => setTaskModalOpen(false)} title="Новая задача">
        <form onSubmit={handleCreateTask}>
          <Stack gap="md">
            <TextInput
              label="Название"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.currentTarget.value)}
              required
            />
            <Textarea
              label="Описание"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.currentTarget.value)}
            />
            <Select
              label="Исполнитель"
              placeholder="Без исполнителя"
              data={(executorsQuery.data ?? []).map((p) => ({ value: p.id, label: p.full_name }))}
              value={taskAssignee}
              onChange={setTaskAssignee}
              clearable
            />
            <Group justify="flex-end">
              <Button type="submit" loading={createTaskMutation.isPending}>
                Создать
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={editModalOpen} onClose={() => setEditModalOpen(false)} title="Редактировать объект">
        <form onSubmit={handleUpdateObject}>
          <Stack gap="md">
            <TextInput
              label="Название"
              value={editName}
              onChange={(e) => setEditName(e.currentTarget.value)}
              required
            />
            <TextInput
              label="Адрес"
              value={editAddress}
              onChange={(e) => setEditAddress(e.currentTarget.value)}
              required
            />
            <Group justify="flex-end">
              <Button type="submit" loading={updateObjectMutation.isPending}>
                Сохранить
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Удалить объект?">
        <Stack gap="md">
          <Text>
            Вы уверены, что хотите удалить объект «{object.name}»? Это действие нельзя отменить.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteModalOpen(false)}>
              Отмена
            </Button>
            <Button
              color="red"
              loading={deleteObjectMutation.isPending}
              onClick={() => deleteObjectMutation.mutate()}
            >
              Удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
