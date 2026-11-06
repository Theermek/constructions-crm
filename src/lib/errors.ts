const ERROR_MESSAGES: Record<string, string> = {
  P0002: 'Задача не найдена или недоступна',
  P0003: 'Такой переход статуса запрещён',
  P0004: 'У вас нет прав на это действие',
  P0005: 'Комментарий обязателен при возврате на доработку',
  P0006: 'У задачи нет исполнителя',
};

interface SupabaseLikeError {
  code?: string | null;
  message?: string | null;
}

/**
 * Преобразует ошибку RPC Supabase (code/message) в человекочитаемый русский текст
 * согласно SPEC.md §4. Неизвестная ошибка показывается как есть.
 */
export function getErrorMessage(error: SupabaseLikeError | null | undefined): string {
  if (!error) return 'Неизвестная ошибка';
  const code = error.code;
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  return error.message ?? 'Неизвестная ошибка';
}
