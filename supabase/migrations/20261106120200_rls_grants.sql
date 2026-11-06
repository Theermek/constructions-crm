-- Права доступа. Два независимых слоя:
--   1) GRANT — какие таблицы и КАКИЕ КОЛОНКИ роль вообще может трогать;
--   2) RLS   — какие СТРОКИ она при этом видит и может менять.
-- Слой GRANT важен не меньше RLS: именно он делает невозможным прямой UPDATE статуса
-- и подделку истории, независимо от того, насколько аккуратно написаны политики.

-- ---------------------------------------------------------------- обнуляем выданное по умолчанию

-- Supabase по умолчанию выдаёт ALL на новые таблицы в public ролям anon и authenticated.
revoke all on public.profiles     from anon, authenticated;
revoke all on public.objects      from anon, authenticated;
revoke all on public.tasks        from anon, authenticated;
revoke all on public.task_history from anon, authenticated;

-- Неаутентифицированному клиенту не доступно ничего и нигде: ни одной политики для anon ниже нет.

-- ---------------------------------------------------------------- точечные GRANT

-- profiles: читать можно всем (нужны ФИО автора и исполнителя), менять — только своё имя.
-- Колонка role в список UPDATE не входит, поэтому исполнитель не может повысить себя
-- до постановщика запросом PATCH /rest/v1/profiles.
grant select            on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select, insert, update, delete on public.objects to authenticated;

-- tasks: статус отсутствует и в INSERT, и в UPDATE.
-- При вставке он берётся из DEFAULT 'new', далее меняется только через change_task_status().
grant select, delete on public.tasks to authenticated;
grant insert (object_id, title, description, assignee_id, author_id) on public.tasks to authenticated;
grant update (object_id, title, description, assignee_id)            on public.tasks to authenticated;

-- task_history: только чтение. INSERT/UPDATE/DELETE не выдан никому из клиентских ролей,
-- пишут только security definer триггер и RPC.
grant select on public.task_history to authenticated;

-- ---------------------------------------------------------------- права на функции

revoke all on function public.is_manager()                                          from public, anon;
revoke all on function public.can_see_object(uuid)                                  from public, anon;
revoke all on function public.change_task_status(uuid, public.task_status, text)     from public, anon;

grant execute on function public.is_manager()                                       to authenticated;
grant execute on function public.can_see_object(uuid)                               to authenticated;
grant execute on function public.change_task_status(uuid, public.task_status, text)  to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.profiles     enable row level security;
alter table public.objects      enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_history enable row level security;

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- objects: постановщик видит все, исполнитель — только те, где у него есть задача
create policy objects_select on public.objects
  for select to authenticated
  using (public.can_see_object(id));

create policy objects_insert on public.objects
  for insert to authenticated
  with check (public.is_manager() and created_by = auth.uid());

create policy objects_update on public.objects
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create policy objects_delete on public.objects
  for delete to authenticated
  using (public.is_manager());

-- tasks: исполнитель видит СТРОГО свои задачи.
-- Это ответ на противоречие в ТЗ (п.2.2 «список задач объекта» против п.3.2 «не может
-- прочитать чужие задачи»): выбрана строгая трактовка, и она обеспечена базой, а не фильтром в UI.
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_manager() or assignee_id = auth.uid());

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.is_manager()
    and author_id = auth.uid()
    and status = 'new'::public.task_status
  );

-- Редактировать задачу может постановщик, пока она не принята.
-- Колонка status сюда всё равно не попадает — её нет в GRANT UPDATE.
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_manager() and status <> 'accepted'::public.task_status)
  with check (public.is_manager());

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_manager());

-- task_history: видимость наследуется от задачи. Политик на запись нет вообще —
-- даже если кому-то выдадут GRANT INSERT, вставка будет отклонена RLS.
create policy task_history_select on public.task_history
  for select to authenticated
  using (
    public.is_manager()
    or exists (
      select 1
      from public.tasks t
      where t.id = task_history.task_id
        and t.assignee_id = auth.uid()
    )
  );
