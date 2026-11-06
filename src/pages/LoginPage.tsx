import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await signIn(email, password);
    setLoading(false);
    if (signInError) {
      setError(signInError);
    }
  }

  return (
    <Center style={{ height: '100vh' }}>
      <Paper withBorder shadow="md" p="xl" radius="md" w={380}>
        <Stack gap="md">
          <Title order={3} ta="center">
            Вход в CRM
          </Title>
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                required
              />
              <PasswordInput
                label="Пароль"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              {error && <Alert color="red">{error}</Alert>}
              <Button type="submit" loading={loading} fullWidth>
                Войти
              </Button>
            </Stack>
          </form>
          <Text size="xs" c="dimmed" ta="center">
            Доступы выдаёт администратор. Регистрация в системе отключена.
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}
