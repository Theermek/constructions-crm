import type { Tables, Enums } from './database.types';

export type TaskStatus = Enums<'task_status'>;
export type UserRole = Enums<'user_role'>;

type TaskLike = Pick<Tables<'tasks'>, 'status' | 'assignee_id'>;
type ProfileLike = Pick<Tables<'profiles'>, 'id' | 'role'>;

export interface TaskAction {
  toStatus: TaskStatus;
  label: string;
  requiresComment: boolean;
}

/**
 * Матрица переходов из SPEC.md §3 — ровно эти пять переходов, ничего больше.
 */
export function availableActions(task: TaskLike, profile: ProfileLike): TaskAction[] {
  const actions: TaskAction[] = [];
  const isAssignee = task.assignee_id != null && task.assignee_id === profile.id;

  if (task.status === 'new' && profile.role === 'executor' && isAssignee) {
    actions.push({ toStatus: 'in_progress', label: 'Взять в работу', requiresComment: false });
  }

  if (task.status === 'in_progress' && isAssignee) {
    actions.push({ toStatus: 'in_review', label: 'Отправить на проверку', requiresComment: false });
  }

  if (task.status === 'in_review' && profile.role === 'manager') {
    actions.push({ toStatus: 'accepted', label: 'Принять', requiresComment: false });
    actions.push({ toStatus: 'rework', label: 'Вернуть на доработку', requiresComment: true });
  }

  if (task.status === 'rework' && isAssignee) {
    actions.push({ toStatus: 'in_progress', label: 'Взять в работу', requiresComment: false });
  }

  return actions;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  in_review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  new: 'gray',
  in_progress: 'blue',
  in_review: 'yellow',
  accepted: 'green',
  rework: 'red',
};
