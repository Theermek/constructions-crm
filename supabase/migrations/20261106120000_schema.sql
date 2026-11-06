-- Схема мини-CRM «Объекты и задачи».
-- Вся бизнес-логика и все права живут в базе: фронтенд не является источником правды.

create type public.user_role as enum ('manager', 'executor');
create type public.task_status as enum ('new', 'in_progress', 'in_review', 'accepted', 'rework');

-- Профили. Email сознательно НЕ дублируем из auth.users: иначе любой пользователь
-- смог бы вычитать контакты всех остальных.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  role        public.user_role not null default 'executor',
  created_at  timestamptz not null default now()
);

create table public.objects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  address     text not null check (length(btrim(address)) > 0),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references public.objects (id) on delete cascade,
  title       text not null check (length(btrim(title)) > 0),
  description text not null default '',
  assignee_id uuid references public.profiles (id) on delete set null,
  status      public.task_status not null default 'new',
  author_id   uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_object_idx   on public.tasks (object_id);

-- История. Пишется исключительно триггером и RPC-функцией; прав на запись нет ни у одной
-- клиентской роли (см. миграцию с grants).
create table public.task_history (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  changed_by  uuid not null references public.profiles (id) on delete restrict,
  changed_at  timestamptz not null default now(),
  from_status public.task_status,
  to_status   public.task_status not null,
  comment     text
);

create index task_history_task_idx on public.task_history (task_id, changed_at);

comment on table public.task_history is
  'Журнал смен статуса. Только append, и только из server-side кода. Клиент не имеет INSERT/UPDATE/DELETE.';
