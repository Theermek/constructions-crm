import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { getErrorMessage } from '../lib/errors';
import { availableActions, STATUS_COLORS, STATUS_LABELS } from '../lib/transitions';
import type { TaskAction, TaskStatus } from '../lib/transitions';
import type { Tables } from '../lib/database.types';

type TaskRow = Tables<'tasks'> & {
  object: { id: string; name: string } | null;
  assignee: { full_name: string } | null;
  author: { full_name: string } | null;
};
type HistoryRow = Tables<'task_history'> & { changed_by_profile: { full_name: string } | null };
type ProfileRow = Tables<'profiles'>;

async function fetchTask(id: string): Promise<TaskRow> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, object:object_id(id, name), assignee:assignee_id(full_name), author:author_id(full_name)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as TaskRow;
}

async function fetchHistory(taskId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('task_history')
    .select('*, changed_by_profile:changed_by(full_name)')
    .eq('task_id', taskId)
    .order('changed_at', { ascending: true });
  if (error) throw error;
  return data as unknown as HistoryRow[];
}

async function fetchExecutors(): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('role', 'executor');
  if (error) throw error;
  return data;
}

export function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = id!;
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isManager = profile?.role === 'manager';

  const [reworkAction, setReworkAction] = useState<TaskAction | null>(null);
  const [comment, setComment] = useState('');

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAssignee, setEditAssignee] = useState<string | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetchTask(taskId),
  });

  const historyQuery = useQuery({
    queryKey: ['task-history', taskId],
    queryFn: () => fetchHistory(taskId),
  });

  const executorsQuery = useQuery({
    queryKey: ['profiles', 'executors'],
    queryFn: fetchExecutors,
    enabled: isManager && editModalOpen,
  });

  const changeStatusMutation = useMutation({
    mutationFn: async ({ toStatus, commentText }: { toStatus: TaskStatus; commentText: string | null }) => {
      const { error } = await supabase.rpc('change_task_status', {
        p_task_id: taskId,
        p_to_status: toStatus,
        p_comment: commentText ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      void queryClient.invalidateQueries({ queryKey: ['task-history', taskId] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setReworkAction(null);
      setComment('');
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: getErrorMessage(error), title: 'Ошибка' });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('tasks')
        .update({ title: editTitle, description: editDescription, assignee_id: editAssignee })
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setEditModalOpen(false);
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: getErrorMessage(error), title: 'Ошибка' });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['objects'] });
      if (taskQuery.data?.object) {
        navigate(`/objects/${taskQuery.data.object.id}`);
      } else {
        navigate('/objects');
      }
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: getErrorMessage(error), title: 'Ошибка' });
      setDeleteModalOpen(false);
    },
  });

  function handleAction(action: TaskAction) {
    if (action.requiresComment) {
      setReworkAction(action);
      setComment('');
      return;
    }
    changeStatusMutation.mutate({ toStatus: action.toStatus, commentText: null });
  }

  function handleConfirmRework() {
    if (!reworkAction) return;
    changeStatusMutation.mutate({ toStatus: reworkAction.toStatus, commentText: comment });
  }

  function openEditModal() {
    if (taskQuery.data) {
      setEditTitle(taskQuery.data.title);
      setEditDescription(taskQuery.data.description);
      setEditAssignee(taskQuery.data.assignee_id);
      setEditModalOpen(true);
    }
  }

  function handleUpdateTask(e: FormEvent) {
    e.preventDefault();
    updateTaskMutation.mutate();
  }

  if (taskQuery.isLoading) return <Loader />;
  if (taskQuery.isError || !taskQuery.data) {
    return <Alert color="red">{getErrorMessage(taskQuery.error as { message?: string })}</Alert>;
  }

  const task = taskQuery.data;
  const actions = profile ? availableActions(task, profile) : [];

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{task.title}</Title>
        <Badge color={STATUS_COLORS[task.status]} size="lg">
          {STATUS_LABELS[task.status]}
        </Badge>
      </Group>

      <Card withBorder>
        <Stack gap="xs">
          <Text>{task.description || 'Без описания'}</Text>
          <Text size="sm">
            Объект:{' '}
            {task.object ? <Link to={`/objects/${task.object.id}`}>{task.object.name}</Link> : '—'}
          </Text>
          <Text size="sm">Исполнитель: {task.assignee?.full_name ?? 'не назначен'}</Text>
          <Text size="sm">Автор: {task.author?.full_name ?? '—'}</Text>
          <Text size="sm">Создана: {new Date(task.created_at).toLocaleString('ru-RU')}</Text>
        </Stack>
      </Card>

      {isManager && (
        <Group>
          <Button variant="default" onClick={openEditModal}>
            Редактировать задачу
          </Button>
          <Button color="red" variant="outline" onClick={() => setDeleteModalOpen(true)}>
            Удалить задачу
          </Button>
        </Group>
      )}

      {actions.length > 0 && (
        <Card withBorder>
          <Stack gap="sm">
            <Title order={4}>Доступные действия</Title>
            <Group>
              {actions.map((action) => (
                <Button
                  key={action.toStatus}
                  color={action.requiresComment ? 'red' : undefined}
                  loading={changeStatusMutation.isPending}
                  onClick={() => handleAction(action)}
                >
                  {action.label}
                </Button>
              ))}
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder>
        <Stack gap="sm">
          <Title order={4}>История</Title>
          {historyQuery.isLoading && <Loader />}
          {!historyQuery.isLoading && historyQuery.data && historyQuery.data.length === 0 && (
            <Text c="dimmed">История пуста.</Text>
          )}
          {!historyQuery.isLoading && historyQuery.data && historyQuery.data.length > 0 && (
            <Timeline>
              {historyQuery.data.map((h) => (
                <Timeline.Item
                  key={h.id}
                  title={
                    h.from_status
                      ? `${STATUS_LABELS[h.from_status]} → ${STATUS_LABELS[h.to_status]}`
                      : `Создана (${STATUS_LABELS[h.to_status]})`
                  }
                >
                  <Text size="sm" c="dimmed">
                    {h.changed_by_profile?.full_name ?? '—'} ·{' '}
                    {new Date(h.changed_at).toLocaleString('ru-RU')}
                  </Text>
                  {h.comment && <Text size="sm">{h.comment}</Text>}
                </Timeline.Item>
              ))}
            </Timeline>
          )}
        </Stack>
      </Card>

      <Modal
        opened={reworkAction !== null}
        onClose={() => setReworkAction(null)}
        title="Вернуть на доработку"
      >
        <Stack gap="md">
          <Textarea
            label="Комментарий"
            description="Обязателен при возврате на доработку"
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
            required
            autosize
            minRows={3}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setReworkAction(null)}>
              Отмена
            </Button>
            <Button
              color="red"
              disabled={comment.trim().length === 0}
              loading={changeStatusMutation.isPending}
              onClick={handleConfirmRework}
            >
              Вернуть на доработку
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={editModalOpen} onClose={() => setEditModalOpen(false)} title="Редактировать задачу">
        <form onSubmit={handleUpdateTask}>
          <Stack gap="md">
            <TextInput
              label="Название"
              value={editTitle}
              onChange={(e) => setEditTitle(e.currentTarget.value)}
              required
            />
            <Textarea
              label="Описание"
              value={editDescription}
              onChange={(e) => setEditDescription(e.currentTarget.value)}
            />
            <Select
              label="Исполнитель"
              placeholder="Без исполнителя"
              data={(executorsQuery.data ?? []).map((p) => ({ value: p.id, label: p.full_name }))}
              value={editAssignee}
              onChange={setEditAssignee}
              clearable
            />
            <Group justify="flex-end">
              <Button type="submit" loading={updateTaskMutation.isPending}>
                Сохранить
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Удалить задачу?">
        <Stack gap="md">
          <Text>Вы уверены, что хотите удалить задачу «{task.title}»? Это действие нельзя отменить.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteModalOpen(false)}>
              Отмена
            </Button>
            <Button color="red" loading={deleteTaskMutation.isPending} onClick={() => deleteTaskMutation.mutate()}>
              Удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
