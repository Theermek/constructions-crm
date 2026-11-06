-- Хелперы, триггеры и единственный легальный способ сменить статус задачи.
-- Все security definer функции объявлены с set search_path = '' и полностью
-- квалифицированными именами: иначе вызывающий мог бы подсунуть свою схему
-- и выполнить произвольный код с правами владельца функции.

-- ---------------------------------------------------------------- хелперы для RLS

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'::public.user_role
  );
$$;

-- Исполнитель видит объект, если на этом объекте есть ЕГО задача.
-- security definer здесь принципиален: обращение к tasks изнутри политики на objects
-- иначе ушло бы в рекурсивную проверку RLS.
create or replace function public.can_see_object(p_object_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_manager()
      or exists (
        select 1
        from public.tasks t
        where t.object_id = p_object_id
          and t.assignee_id = auth.uid()
      );
$$;

-- ---------------------------------------------------------------- триггеры

-- Профиль создаётся автоматически при появлении пользователя.
-- Роль берётся из app_metadata, а НЕ из user_metadata: app_metadata может писать только
-- service_role, тогда как user_metadata подконтрольна самому пользователю. Иначе
-- исполнитель смог бы объявить себя постановщиком при регистрации.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'executor'::public.user_role)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Создание задачи — тоже событие истории (строка «— → Новая»).
create or replace function public.log_task_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_history (task_id, changed_by, from_status, to_status, comment)
  values (new.id, new.author_id, null, new.status, null);
  return new;
end;
$$;

create trigger tasks_log_created
  after insert on public.tasks
  for each row execute function public.log_task_created();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RPC: смена статуса

create or replace function public.change_task_status(
  p_task_id   uuid,
  p_to_status public.task_status,
  p_comment   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role;
  v_task    public.tasks;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = 'P0001';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null then
    raise exception 'Профиль не найден' using errcode = 'P0001';
  end if;

  -- for update: блокировка строки, чтобы два параллельных запроса не прошли
  -- один и тот же переход дважды
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  -- Исполнитель не должен даже узнать о существовании чужой задачи:
  -- отвечаем тем же «не найдена», что и для несуществующего id.
  if v_role = 'executor' and v_task.assignee_id is distinct from v_uid then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  -- 1. Разрешён ли такой переход вообще (матрица из ТЗ, п.2.3)
  if not (
       (v_task.status = 'new'         and p_to_status = 'in_progress')
    or (v_task.status = 'in_progress' and p_to_status = 'in_review')
    or (v_task.status = 'in_review'   and p_to_status = 'accepted')
    or (v_task.status = 'in_review'   and p_to_status = 'rework')
    or (v_task.status = 'rework'      and p_to_status = 'in_progress')
  ) then
    raise exception 'Переход % → % запрещён', v_task.status, p_to_status using errcode = 'P0003';
  end if;

  -- 2. Имеет ли право именно этот пользователь
  if p_to_status in ('accepted', 'rework') then
    if v_role <> 'manager' then
      raise exception 'Принять или вернуть задачу может только постановщик' using errcode = 'P0004';
    end if;
  else
    if v_task.assignee_id is null then
      raise exception 'У задачи нет исполнителя' using errcode = 'P0006';
    end if;
    if v_task.assignee_id is distinct from v_uid then
      raise exception 'Менять ход работы может только назначенный исполнитель' using errcode = 'P0004';
    end if;
  end if;

  -- 3. Условие перехода: возврат на доработку без комментария невозможен
  if p_to_status = 'rework' and v_comment is null then
    raise exception 'Комментарий обязателен при возврате на доработку' using errcode = 'P0005';
  end if;

  update public.tasks
     set status = p_to_status
   where id = p_task_id;

  insert into public.task_history (task_id, changed_by, from_status, to_status, comment)
  values (p_task_id, v_uid, v_task.status, p_to_status, v_comment);
end;
$$;

comment on function public.change_task_status is
  'Единственный способ сменить статус задачи. Прямой UPDATE колонки status клиенту недоступен.';
