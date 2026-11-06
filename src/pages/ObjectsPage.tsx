import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { getErrorMessage } from '../lib/errors';

interface ObjectRow {
  id: string;
  name: string;
  address: string;
  taskCount: number;
}

async function fetchObjects(): Promise<ObjectRow[]> {
  const { data, error } = await supabase
    .from('objects')
    .select('id, name, address, tasks(count)')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    taskCount: row.tasks?.[0]?.count ?? 0,
  }));
}

export function ObjectsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const { data: objects, isLoading } = useQuery({
    queryKey: ['objects'],
    queryFn: fetchObjects,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('objects').insert({ name, address });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['objects'] });
      setModalOpen(false);
      setName('');
      setAddress('');
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: getErrorMessage(error), title: 'Ошибка' });
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  const isManager = profile?.role === 'manager';

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Объекты</Title>
        {isManager && <Button onClick={() => setModalOpen(true)}>Новый объект</Button>}
      </Group>

      {isLoading && <Loader />}

      {!isLoading && objects && objects.length === 0 && (
        <Text c="dimmed">
          {isManager ? 'Объектов пока нет.' : 'Объектов с вашими задачами пока нет.'}
        </Text>
      )}

      {!isLoading && objects && objects.length > 0 && (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Название</Table.Th>
              <Table.Th>Адрес</Table.Th>
              <Table.Th>Задач</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {objects.map((obj) => (
              <Table.Tr
                key={obj.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/objects/${obj.id}`)}
              >
                <Table.Td>{obj.name}</Table.Td>
                <Table.Td>{obj.address}</Table.Td>
                <Table.Td>{obj.taskCount}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Новый объект">
        <form onSubmit={handleCreate}>
          <Stack gap="md">
            <TextInput
              label="Название"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              required
            />
            <TextInput
              label="Адрес"
              value={address}
              onChange={(e) => setAddress(e.currentTarget.value)}
              required
            />
            <Group justify="flex-end">
              <Button type="submit" loading={createMutation.isPending}>
                Создать
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
