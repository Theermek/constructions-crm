-- Роль пользователя задаётся в app_metadata, которую может писать только service_role.
-- Проблема: GoTrue создаёт строку в auth.users, а app_metadata дописывает следующим UPDATE,
-- поэтому триггер on_auth_user_created видит метаданные ещё пустыми и ставит роль по умолчанию.
-- Поэтому синхронизируем профиль ещё и на UPDATE метаданных.
-- Побочный плюс: смена роли через Admin API сразу доезжает до profiles, и роль по-прежнему
-- недоступна для записи обычному пользователю.

create or replace function public.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
     set full_name = coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), p.full_name),
         role      = coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, p.role)
   where p.id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of raw_app_meta_data, raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_from_auth();
