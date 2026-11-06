// Наполнение демо-данными. Запуск: npm run seed
//
// Скрипт — единственное место, где используется secret (service_role) ключ: только он может
// создавать пользователей. Ключ читается из .env.local, который в .gitignore, и во фронтенд
// не попадает никогда.
//
// Важно: статусы задач НЕ выставляются напрямую в базу. Скрипт логинится настоящими
// пользователями и двигает задачи через RPC change_task_status — ровно так, как это делал бы
// человек в интерфейсе. Поэтому история задач получается подлинной, а не нарисованной.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SECRET) {
  console.error('Нужны VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}

export const USERS = [
  { email: 'manager@demo.local',   password: 'Manager#2026crm',   full_name: 'Ирина Полевая',   role: 'manager' },
  { email: 'executor1@demo.local', password: 'Executor1#2026crm', full_name: 'Сергей Ким',      role: 'executor' },
  { email: 'executor2@demo.local', password: 'Executor2#2026crm', full_name: 'Дамир Сафин',     role: 'executor' },
];

const admin = createClient(URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } });

async function ensureUser(u) {
  // ищем среди существующих — скрипт должен быть идемпотентным
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const found = list.users.find((x) => x.email === u.email);

  if (found) {
    const { data, error } = await admin.auth.admin.updateUserById(found.id, {
      password: u.password,
      user_metadata: { full_name: u.full_name },
      app_metadata: { role: u.role },
    });
    if (error) throw error;
    // profiles.role отдельно не трогаем: его синхронизирует триггер on_auth_user_updated
    // из app_metadata, которую может писать только service_role
    return data.user.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
    app_metadata: { role: u.role },
  });
  if (error) throw error;
  return data.user.id;
}

async function signIn(u) {
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`Не удалось войти как ${u.email}: ${error.message}`);
  return client;
}

async function move(client, taskId, to, comment) {
  const { error } = await client.rpc('change_task_status', {
    p_task_id: taskId,
    p_to_status: to,
    p_comment: comment ?? null,
  });
  if (error) throw new Error(`Переход в ${to} не прошёл: ${error.message}`);
}

async function main() {
  console.log('1. Пользователи');
  const ids = {};
  for (const u of USERS) {
    ids[u.email] = await ensureUser(u);
    console.log(`   ${u.role.padEnd(8)} ${u.email}`);
  }

  console.log('2. Чистим прежние демо-данные');
  // задачи и история уйдут каскадом за объектами
  const { error: delErr } = await admin.from('objects').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) throw delErr;

  const manager = USERS[0];
  const exec1 = USERS[1];
  const exec2 = USERS[2];
  const mgrId = ids[manager.email];

  console.log('3. Объекты и задачи — от имени постановщика');
  const mgrClient = await signIn(manager);

  const { data: objects, error: objErr } = await mgrClient
    .from('objects')
    .insert([
      { name: 'ЖК «Северный», корпус 3', address: 'г. Казань, ул. Чистопольская, 18', created_by: mgrId },
      { name: 'Склад на Полевой',        address: 'г. Казань, ул. Полевая, 4',        created_by: mgrId },
      { name: 'Офис «Гранит», реконструкция', address: 'г. Казань, пр. Победы, 102',  created_by: mgrId },
    ])
    .select();
  if (objErr) throw objErr;
  const [objA, objB, objC] = objects;

  const taskRows = [
    { object_id: objA.id, title: 'Залить фундамент под опоры',        description: 'Бетон М300, захватка 1–4.',                assignee_id: ids[exec1.email] },
    { object_id: objA.id, title: 'Смонтировать опалубку 3-го этажа',  description: 'По проекту КЖ-14, с фото по факту.',        assignee_id: ids[exec1.email] },
    { object_id: objA.id, title: 'Проверить геодезическую разбивку',  description: 'Сверить оси с исполнительной схемой.',      assignee_id: ids[exec2.email] },
    { object_id: objB.id, title: 'Заменить кровельное покрытие',      description: 'Участок над складом Б, 240 м².',            assignee_id: ids[exec2.email] },
    { object_id: objB.id, title: 'Установить пожарные датчики',       description: '12 шт. по схеме АПС.',                      assignee_id: ids[exec1.email] },
    { object_id: objC.id, title: 'Демонтаж старых перегородок',       description: 'Гипсокартон, 2-й этаж, без несущих стен.',  assignee_id: ids[exec2.email] },
    { object_id: objC.id, title: 'Согласовать смету на фасад',        description: 'Исполнитель пока не назначен.',             assignee_id: null },
  ].map((t) => ({ ...t, author_id: mgrId }));

  const { data: tasks, error: taskErr } = await mgrClient.from('tasks').insert(taskRows).select();
  if (taskErr) throw taskErr;
  const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));

  console.log('4. Разгоняем статусы настоящими переходами');
  const e1 = await signIn(exec1);
  const e2 = await signIn(exec2);

  // В работе
  await move(e1, byTitle['Залить фундамент под опоры'].id, 'in_progress');
  await move(e2, byTitle['Демонтаж старых перегородок'].id, 'in_progress');

  // На проверке
  await move(e1, byTitle['Смонтировать опалубку 3-го этажа'].id, 'in_progress');
  await move(e1, byTitle['Смонтировать опалубку 3-го этажа'].id, 'in_review');

  // Принята
  await move(e2, byTitle['Проверить геодезическую разбивку'].id, 'in_progress');
  await move(e2, byTitle['Проверить геодезическую разбивку'].id, 'in_review');
  await move(mgrClient, byTitle['Проверить геодезическую разбивку'].id, 'accepted');

  // На доработке — с обязательным комментарием
  await move(e2, byTitle['Заменить кровельное покрытие'].id, 'in_progress');
  await move(e2, byTitle['Заменить кровельное покрытие'].id, 'in_review');
  await move(mgrClient, byTitle['Заменить кровельное покрытие'].id, 'rework', 'Нет фото примыканий к парапету. Переделать узел и приложить снимки.');

  const { data: final, error: finErr } = await admin
    .from('tasks')
    .select('title, status')
    .order('created_at');
  if (finErr) throw finErr;

  console.log('\nИтог:');
  for (const t of final) console.log(`   ${t.status.padEnd(12)} ${t.title}`);
  const { count } = await admin.from('task_history').select('*', { count: 'exact', head: true });
  console.log(`\nЗаписей в истории: ${count}`);
  console.log('\nДоступы:');
  for (const u of USERS) console.log(`   ${u.email.padEnd(22)} ${u.password}   (${u.role})`);
}

main().catch((e) => {
  console.error('\nОшибка сидирования:', e.message ?? e);
  process.exit(1);
});
