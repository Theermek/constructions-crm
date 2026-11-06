// Негативные (и один позитивный) тесты безопасности мини-CRM.
//
// Запуск: npm run test:security  (= node --env-file=.env.local scripts/security-tests.mjs)
//
// Принцип: все АТАКИ идут через публичный REST API обычного пользователя (anon apikey +
// JWT исполнителя/постановщика), ровно так, как это сделал бы злоумышленник в обход
// интерфейса — минуя src/lib/transitions.ts и остальной фронтенд. SDK используется только
// для входа (signInWithPassword) — получить JWT иначе и не получится. service_role ключ
// используется исключительно для подготовки данных и проверки фактического состояния БД
// (узнать id чужой задачи, убедиться, что строка в истории не появилась/не делась) — никогда
// для самой атаки.
//
// Список пользователей продублирован из scripts/seed.mjs (а не импортирован оттуда):
// seed.mjs на верхнем уровне модуля сразу запускает main() и пересеет базу, что здесь не нужно
// и запрещено (этот файл не имеет права трогать данные иначе, чем через обычные атаки).
// Если список пользователей в seed.mjs поменяется — обновите и этот массив.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SECRET) {
  console.error('Нужны VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}

const USERS = {
  manager: { email: 'manager@demo.local', password: 'Manager#2026crm' },
  exec1: { email: 'executor1@demo.local', password: 'Executor1#2026crm' },
  exec2: { email: 'executor2@demo.local', password: 'Executor2#2026crm' },
};

// Заголовки задач из scripts/seed.mjs — по ним находим живые id после сидирования.
const TASK_TITLES = {
  fundament: 'Залить фундамент под опоры',          // in_progress, exec1
  opalubka: 'Смонтировать опалубку 3-го этажа',      // in_review,   exec1
  geodezia: 'Проверить геодезическую разбивку',      // accepted,    exec2
  krovlya: 'Заменить кровельное покрытие',           // rework,      exec2
  datchiki: 'Установить пожарные датчики',           // new,         exec1
  demontazh: 'Демонтаж старых перегородок',          // in_progress, exec2
  smeta: 'Согласовать смету на фасад',                // new,         без исполнителя
};

const OBJECT_NAMES = {
  severny: 'ЖК «Северный», корпус 3',
  sklad: 'Склад на Полевой',
  office: 'Офис «Гранит», реконструкция',
};

const admin = createClient(URL, SECRET, { auth: { autoRefreshToken: false, persistSession: false } });

// ---------------------------------------------------------------- низкоуровневые помощники

/** Сырой REST-запрос к PostgREST в обход supabase-js. token=null -> заголовок Authorization не отправляется. */
async function restFetch(token, method, path, body) {
  const headers = { apikey: ANON };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers.Prefer = 'return=representation';

  const res = await fetch(`${URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function rpcCall(token, fnName, params) {
  return restFetch(token, 'POST', `/rest/v1/rpc/${fnName}`, params);
}

/** Запрос заблокирован либо явной ошибкой (GRANT/RLS), либо нулём строк в representation. */
function expectBlocked(result) {
  if (result.status >= 400) return true;
  if (Array.isArray(result.json) && result.json.length === 0) return true;
  return false;
}

function expectEmpty(rows) {
  return Array.isArray(rows) && rows.length === 0;
}

function expectError(result, code) {
  return result.status >= 400 && result.json && result.json.code === code;
}

async function signIn(email, password) {
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Не удалось войти как ${email}: ${error.message}`);
  return { token: data.session.access_token, uid: data.user.id, client };
}

// ---------------------------------------------------------------- подготовка: проверка сидирования и id

async function loadFixtures() {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;

  const uid = {};
  for (const [key, u] of Object.entries(USERS)) {
    const found = list.users.find((x) => x.email === u.email);
    if (!found) {
      console.error(`\nПользователь ${u.email} не найден в auth.users.`);
      console.error('База не засеяна. Запустите: npm run seed\n');
      process.exit(1);
    }
    uid[key] = found.id;
  }

  const { data: tasks, error: taskErr } = await admin.from('tasks').select('id,title,status,assignee_id,object_id');
  if (taskErr) throw taskErr;

  const taskByKey = {};
  for (const [key, title] of Object.entries(TASK_TITLES)) {
    const row = tasks?.find((t) => t.title === title);
    if (!row) {
      console.error(`\nВ базе не найдена засеянная задача «${title}».`);
      console.error('База не засеяна (или сидирование не завершилось). Запустите: npm run seed\n');
      process.exit(1);
    }
    taskByKey[key] = row;
  }

  const { data: objects, error: objErr } = await admin.from('objects').select('id,name');
  if (objErr) throw objErr;
  const objectByKey = {};
  for (const [key, name] of Object.entries(OBJECT_NAMES)) {
    const row = objects?.find((o) => o.name === name);
    if (!row) {
      console.error(`\nВ базе не найден засеянный объект «${name}». Запустите: npm run seed\n`);
      process.exit(1);
    }
    objectByKey[key] = row;
  }

  return { uid, task: taskByKey, object: objectByKey };
}

// ---------------------------------------------------------------- раннер

const cases = [];
function addCase(name, run) {
  cases.push({ name, run });
}

async function main() {
  const fx = await loadFixtures();

  const manager = await signIn(USERS.manager.email, USERS.manager.password);
  const exec1 = await signIn(USERS.exec1.email, USERS.exec1.password);
  const exec2 = await signIn(USERS.exec2.email, USERS.exec2.password);

  // ============================================================ ЧТЕНИЕ

  addCase('Анонимный REST-запрос к /tasks не возвращает строк', async () => {
    const r = await restFetch(null, 'GET', '/rest/v1/tasks?select=id');
    const pass = r.status === 401 || expectEmpty(r.json);
    return { pass, detail: `ожидалось 401 или пустой массив, получено status=${r.status} json=${JSON.stringify(r.json)}` };
  });

  addCase('Исполнитель 1 видит в /tasks только свои задачи', async () => {
    const r = await restFetch(exec1.token, 'GET', '/rest/v1/tasks?select=id,assignee_id');
    const foreign = Array.isArray(r.json) ? r.json.filter((t) => t.assignee_id !== exec1.uid) : null;
    const pass = r.status === 200 && Array.isArray(r.json) && r.json.length > 0 && foreign.length === 0;
    return { pass, detail: `ожидалось: все строки с assignee_id=${exec1.uid}; получено status=${r.status}, чужих строк=${foreign?.length}` };
  });

  addCase('Исполнитель 1 не может получить чужую задачу по id', async () => {
    const r = await restFetch(exec1.token, 'GET', `/rest/v1/tasks?id=eq.${fx.task.demontazh.id}&select=id`);
    const pass = r.status === 200 && expectEmpty(r.json);
    return { pass, detail: `ожидался пустой результат по чужой задаче ${fx.task.demontazh.id}; получено ${JSON.stringify(r.json)}` };
  });

  addCase('Исполнитель 1 видит в /objects только объекты со своими задачами', async () => {
    const r = await restFetch(exec1.token, 'GET', '/rest/v1/objects?select=id,name');
    const ids = Array.isArray(r.json) ? r.json.map((o) => o.id) : [];
    const hasOwnObjects = ids.includes(fx.object.severny.id) && ids.includes(fx.object.sklad.id);
    const hasForeign = ids.includes(fx.object.office.id);
    const pass = r.status === 200 && hasOwnObjects && !hasForeign;
    return {
      pass,
      detail: `ожидалось: содержит «${fx.object.severny.name}» и «${fx.object.sklad.name}», НЕ содержит «${fx.object.office.name}»; получено ids=${JSON.stringify(ids)}`,
    };
  });

  addCase('Исполнитель 1 не видит task_history по чужой задаче', async () => {
    const r = await restFetch(exec1.token, 'GET', `/rest/v1/task_history?task_id=eq.${fx.task.demontazh.id}&select=id`);
    const pass = r.status === 200 && expectEmpty(r.json);
    return { pass, detail: `ожидался пустой результат; получено ${JSON.stringify(r.json)}` };
  });

  // ============================================================ ЗАПИСЬ В ОБХОД БИЗНЕС-ЛОГИКИ

  addCase('PATCH tasks.status в обход RPC запрещён (GRANT)', async () => {
    // Статус "до" берём живым прямо перед атакой (а не из фикстур, загруженных в начале
    // прогона): это защищает тест от гонки с параллельной легитимной активностью в той же
    // базе и проверяет единственное, что нам нужно — что ИМЕННО ЭТА попытка ничего не изменила.
    const { data: beforeRow } = await admin.from('tasks').select('status').eq('id', fx.task.fundament.id).single();
    const r = await restFetch(exec1.token, 'PATCH', `/rest/v1/tasks?id=eq.${fx.task.fundament.id}`, { status: 'accepted' });
    const blocked = expectBlocked(r);
    const { data: afterRow } = await admin.from('tasks').select('status').eq('id', fx.task.fundament.id).single();
    const pass = blocked && afterRow.status === beforeRow.status;
    return { pass, detail: `ожидалось: запрос заблокирован и status не изменился (был ${beforeRow.status}); получено status=${r.status}, json=${JSON.stringify(r.json)}, в базе status=${afterRow.status}` };
  });

  addCase('PATCH своей задаче (title) запрещён исполнителю политикой UPDATE', async () => {
    const { data: beforeRow } = await admin.from('tasks').select('title').eq('id', fx.task.fundament.id).single();
    const r = await restFetch(exec1.token, 'PATCH', `/rest/v1/tasks?id=eq.${fx.task.fundament.id}`, { title: 'ВЗЛОМАНО' });
    const blocked = expectBlocked(r);
    const { data: afterRow } = await admin.from('tasks').select('title').eq('id', fx.task.fundament.id).single();
    const pass = blocked && afterRow.title === beforeRow.title;
    return { pass, detail: `ожидалось: запрос заблокирован и title не изменился (был ${JSON.stringify(beforeRow.title)}); получено status=${r.status}, json=${JSON.stringify(r.json)}, в базе title=${JSON.stringify(afterRow.title)}` };
  });

  addCase('PATCH profiles.role (повышение привилегий через REST) запрещён', async () => {
    const r = await restFetch(exec1.token, 'PATCH', `/rest/v1/profiles?id=eq.${exec1.uid}`, { role: 'manager' });
    const blocked = expectBlocked(r);
    const { data: row } = await admin.from('profiles').select('role').eq('id', exec1.uid).single();
    const pass = blocked && row.role === 'executor';
    return { pass, detail: `ожидалось: запрос заблокирован и role осталась executor; получено status=${r.status}, json=${JSON.stringify(r.json)}, в базе role=${row.role}` };
  });

  addCase('INSERT выдуманной строки в task_history запрещён', async () => {
    const { count: before } = await admin.from('task_history').select('*', { count: 'exact', head: true }).eq('task_id', fx.task.fundament.id);
    const r = await restFetch(exec1.token, 'POST', '/rest/v1/task_history', {
      task_id: fx.task.fundament.id,
      changed_by: exec1.uid,
      from_status: 'new',
      to_status: 'accepted',
      comment: 'поддельная запись',
    });
    const blocked = expectBlocked(r);
    const { count: after } = await admin.from('task_history').select('*', { count: 'exact', head: true }).eq('task_id', fx.task.fundament.id);
    const pass = blocked && before === after;
    return { pass, detail: `ожидалось: запрос заблокирован и число строк истории не изменилось (${before}); получено status=${r.status}, json=${JSON.stringify(r.json)}, после=${after}` };
  });

  addCase('DELETE строки task_history по своей задаче запрещён', async () => {
    const { data: row } = await admin.from('task_history').select('id').eq('task_id', fx.task.fundament.id).limit(1).single();
    const r = await restFetch(exec1.token, 'DELETE', `/rest/v1/task_history?id=eq.${row.id}`);
    const blocked = expectBlocked(r);
    const { data: stillThere } = await admin.from('task_history').select('id').eq('id', row.id).maybeSingle();
    const pass = blocked && !!stillThere;
    return { pass, detail: `ожидалось: запрос заблокирован и строка истории id=${row.id} осталась; получено status=${r.status}, json=${JSON.stringify(r.json)}, строка на месте=${!!stillThere}` };
  });

  addCase('INSERT в objects запрещён не-постановщику', async () => {
    const r = await restFetch(exec1.token, 'POST', '/rest/v1/objects', { name: 'Левый объект', address: 'г. Казань, ул. Левая, 1', created_by: exec1.uid });
    const blocked = expectBlocked(r);
    return { pass: blocked, detail: `ожидалось: запрос заблокирован; получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  addCase('INSERT в tasks (самоназначение) запрещён исполнителю', async () => {
    const r = await restFetch(exec1.token, 'POST', '/rest/v1/tasks', {
      object_id: fx.object.severny.id,
      title: 'Самоназначенная задача',
      assignee_id: exec1.uid,
      author_id: exec1.uid,
    });
    const blocked = expectBlocked(r);
    return { pass: blocked, detail: `ожидалось: запрос заблокирован; получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  addCase('DELETE чужой и своей задачи запрещён исполнителю', async () => {
    const rOwn = await restFetch(exec1.token, 'DELETE', `/rest/v1/tasks?id=eq.${fx.task.fundament.id}`);
    const rForeign = await restFetch(exec1.token, 'DELETE', `/rest/v1/tasks?id=eq.${fx.task.demontazh.id}`);
    const blockedOwn = expectBlocked(rOwn);
    const blockedForeign = expectBlocked(rForeign);
    const { data: own } = await admin.from('tasks').select('id').eq('id', fx.task.fundament.id).maybeSingle();
    const { data: foreign } = await admin.from('tasks').select('id').eq('id', fx.task.demontazh.id).maybeSingle();
    const pass = blockedOwn && blockedForeign && !!own && !!foreign;
    return {
      pass,
      detail: `ожидалось: оба DELETE заблокированы, обе строки на месте; получено своя: status=${rOwn.status} json=${JSON.stringify(rOwn.json)} на месте=${!!own}; чужая: status=${rForeign.status} json=${JSON.stringify(rForeign.json)} на месте=${!!foreign}`,
    };
  });

  // ============================================================ ПЕРЕХОДЫ СТАТУСОВ ЧЕРЕЗ RPC

  addCase('change_task_status на чужой задаче -> P0002', async () => {
    const r = await rpcCall(exec1.token, 'change_task_status', { p_task_id: fx.task.demontazh.id, p_to_status: 'in_review' });
    const pass = expectError(r, 'P0002');
    return { pass, detail: `ожидался код P0002; получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  addCase('Запрещённый переход на своей задаче (in_progress -> accepted) -> P0003', async () => {
    const r = await rpcCall(exec1.token, 'change_task_status', { p_task_id: fx.task.fundament.id, p_to_status: 'accepted' });
    const pass = expectError(r, 'P0003');
    return { pass, detail: `ожидался код P0003; получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  addCase('Исполнитель сам принимает свою задачу (in_review -> accepted) -> P0004', async () => {
    // Переход in_review -> accepted в принципе разрешён матрицей (п.3), но только для роли
    // manager — поэтому ожидаем именно P0004 (нет прав у вызывающего), а не P0003.
    const r = await rpcCall(exec1.token, 'change_task_status', { p_task_id: fx.task.opalubka.id, p_to_status: 'accepted' });
    const pass = expectError(r, 'P0004');
    return { pass, detail: `ожидался код P0004 (переход разрешён матрицей, но не этой роли); получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  addCase('Возврат на доработку без комментария (null) -> P0005', async () => {
    const { data: beforeRow } = await admin.from('tasks').select('status').eq('id', fx.task.opalubka.id).single();
    const r = await rpcCall(manager.token, 'change_task_status', { p_task_id: fx.task.opalubka.id, p_to_status: 'rework', p_comment: null });
    const { data: afterRow } = await admin.from('tasks').select('status').eq('id', fx.task.opalubka.id).single();
    const pass = expectError(r, 'P0005') && afterRow.status === beforeRow.status;
    return { pass, detail: `ожидался код P0005 и status не изменился (был ${beforeRow.status}); получено status=${r.status}, json=${JSON.stringify(r.json)}, в базе status=${afterRow.status}` };
  });

  addCase('Возврат на доработку с пустым комментарием ("   ") -> P0005', async () => {
    const { data: beforeRow } = await admin.from('tasks').select('status').eq('id', fx.task.opalubka.id).single();
    const r = await rpcCall(manager.token, 'change_task_status', { p_task_id: fx.task.opalubka.id, p_to_status: 'rework', p_comment: '   ' });
    const { data: afterRow } = await admin.from('tasks').select('status').eq('id', fx.task.opalubka.id).single();
    const pass = expectError(r, 'P0005') && afterRow.status === beforeRow.status;
    return { pass, detail: `ожидался код P0005 и status не изменился (был ${beforeRow.status}); получено status=${r.status}, json=${JSON.stringify(r.json)}, в базе status=${afterRow.status}` };
  });

  addCase('Исполнитель 2 пытается взять в работу задачу исполнителя 1 -> P0002', async () => {
    const r = await rpcCall(exec2.token, 'change_task_status', { p_task_id: fx.task.datchiki.id, p_to_status: 'in_progress' });
    const pass = expectError(r, 'P0002');
    return { pass, detail: `ожидался код P0002; получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  addCase('Постановщик пытается взять задачу в работу вместо исполнителя -> P0004', async () => {
    const { data: beforeRow } = await admin.from('tasks').select('status').eq('id', fx.task.datchiki.id).single();
    const r = await rpcCall(manager.token, 'change_task_status', { p_task_id: fx.task.datchiki.id, p_to_status: 'in_progress' });
    const { data: afterRow } = await admin.from('tasks').select('status').eq('id', fx.task.datchiki.id).single();
    const pass = expectError(r, 'P0004') && afterRow.status === beforeRow.status;
    return { pass, detail: `ожидался код P0004 и status не изменился (был ${beforeRow.status}); получено status=${r.status}, json=${JSON.stringify(r.json)}, в базе status=${afterRow.status}` };
  });

  addCase('Переход из accepted в любой статус запрещён -> P0003', async () => {
    const r = await rpcCall(exec2.token, 'change_task_status', { p_task_id: fx.task.geodezia.id, p_to_status: 'in_progress' });
    const pass = expectError(r, 'P0003');
    return { pass, detail: `ожидался код P0003; получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  addCase('Задача без исполнителя: исполнитель пытается взять в работу -> P0002 (не видна)', async () => {
    const r = await rpcCall(exec1.token, 'change_task_status', { p_task_id: fx.task.smeta.id, p_to_status: 'in_progress' });
    const pass = expectError(r, 'P0002');
    return { pass, detail: `ожидался код P0002; получено status=${r.status}, json=${JSON.stringify(r.json)}` };
  });

  // ============================================================ ПОЗИТИВНЫЙ КОНТРОЛЬ

  addCase('Позитивный контроль: разрешённый переход создаёт ровно одну строку истории', async () => {
    const taskId = fx.task.krovlya.id; // rework, exec2
    const { count: before } = await admin.from('task_history').select('*', { count: 'exact', head: true }).eq('task_id', taskId);

    const r1 = await rpcCall(exec2.token, 'change_task_status', { p_task_id: taskId, p_to_status: 'in_progress' });
    if (r1.status >= 400) {
      return { pass: false, detail: `легитимный переход rework -> in_progress не прошёл: status=${r1.status}, json=${JSON.stringify(r1.json)}` };
    }

    const { count: after } = await admin.from('task_history').select('*', { count: 'exact', head: true }).eq('task_id', taskId);
    const { data: lastRow } = await admin
      .from('task_history')
      .select('from_status,to_status,changed_by')
      .eq('task_id', taskId)
      .order('id', { ascending: false })
      .limit(1)
      .single();

    const pass =
      after === before + 1 &&
      lastRow.from_status === 'rework' &&
      lastRow.to_status === 'in_progress' &&
      lastRow.changed_by === exec2.uid;

    console.log(`        [состояние задачи «${TASK_TITLES.krovlya}» изменено: rework -> in_progress]`);

    // Возвращаем задачу в исходный статус по матрице: in_progress -> in_review -> rework.
    const r2 = await rpcCall(exec2.token, 'change_task_status', { p_task_id: taskId, p_to_status: 'in_review' });
    if (r2.status < 400) {
      const r3 = await rpcCall(manager.token, 'change_task_status', {
        p_task_id: taskId,
        p_to_status: 'rework',
        p_comment: 'Возврат тестовым сценарием к исходному статусу rework.',
      });
      if (r3.status < 400) {
        console.log(`        [состояние задачи «${TASK_TITLES.krovlya}» восстановлено: -> in_review -> rework]`);
      } else {
        console.log(`        [ВНИМАНИЕ: не удалось довести задачу «${TASK_TITLES.krovlya}» обратно до rework: ${JSON.stringify(r3.json)}]`);
      }
    } else {
      console.log(`        [ВНИМАНИЕ: не удалось довести задачу «${TASK_TITLES.krovlya}» обратно до rework: ${JSON.stringify(r2.json)}]`);
    }

    return {
      pass,
      detail: `ожидалось: +1 строка истории с from=rework,to=in_progress,changed_by=${exec2.uid}; получено before=${before} after=${after} lastRow=${JSON.stringify(lastRow)}`,
    };
  });

  // ============================================================ ДОПОЛНИТЕЛЬНО: эскалация через app_metadata

  addCase('Повышение привилегий через PUT /auth/v1/user (app_metadata) запрещено', async () => {
    const r1 = await fetch(`${URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: ANON, Authorization: `Bearer ${exec1.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_metadata: { role: 'manager' } }),
    });
    const body1 = await r1.json().catch(() => null);

    // Второй вектор: подложить role в user_metadata (её менять можно, но роль профиля
    // синхронизируется в profiles ТОЛЬКО из app_metadata — см. миграцию
    // 20261106120300_sync_profile_role.sql).
    const r2 = await fetch(`${URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: ANON, Authorization: `Bearer ${exec1.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { role: 'manager' } }),
    });

    const { data: profile } = await admin.from('profiles').select('role').eq('id', exec1.uid).single();

    const appMetaBlocked = r1.status >= 400;
    const roleUnaffected = profile.role === 'executor';
    const pass = appMetaBlocked && roleUnaffected;

    return {
      pass,
      detail: `ожидалось: PUT с app_metadata отклонён (4xx) и profiles.role осталась executor; получено status(app_metadata)=${r1.status} body=${JSON.stringify(body1)}, status(user_metadata.role)=${r2.status}, в базе role=${profile.role}`,
    };
  });

  // ============================================================ РАННЕР

  let passed = 0;
  const total = cases.length;
  const failed = [];

  for (let i = 0; i < total; i++) {
    const { name, run } = cases[i];
    const idx = String(i + 1).padStart(2, ' ');
    try {
      const { pass, detail } = await run();
      if (pass) {
        passed++;
        console.log(`[${idx}/${total}] PASS  ${name}`);
      } else {
        failed.push(name);
        console.log(`[${idx}/${total}] FAIL  ${name} — ${detail}`);
      }
    } catch (e) {
      failed.push(name);
      console.log(`[${idx}/${total}] FAIL  ${name} — исключение: ${e.message ?? e}`);
    }
  }

  console.log(`\nПройдено ${passed} из ${total}`);
  if (failed.length > 0) {
    console.log('\nПровалившиеся кейсы:');
    for (const f of failed) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nОшибка выполнения тестов безопасности:', e.message ?? e);
  process.exit(1);
});
