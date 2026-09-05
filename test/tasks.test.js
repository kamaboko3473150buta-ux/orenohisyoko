const test = require('node:test');
const assert = require('node:assert');
const {
  newTask, addTask, updateTask, removeTask, toggleDone, pruneDone, groupTasks, countDueSoon,
  migrateTasks,
} = require('../src/main/tasks');

const NOW = '2026-09-04T10:00:00.000Z';

test('newTaskがidとcreatedAtを付け、doneはfalseになる', () => {
  const t = newTask({ title: 'A社へ見積書を送る' }, NOW);
  assert.ok(t.id.startsWith(NOW), 'idはnowIsoから始まる');
  assert.strictEqual(t.createdAt, NOW);
  assert.strictEqual(t.done, false);
  assert.strictEqual(t.doneAt, null);
  assert.strictEqual(t.title, 'A社へ見積書を送る');
});

test('newTaskはtitle以外が空でも落ちない', () => {
  const t = newTask({ title: 'メモだけ' }, NOW);
  assert.strictEqual(t.start, null);
  assert.strictEqual(t.end, null);
  assert.strictEqual(t.at, null);
  assert.strictEqual(t.who, null);
  assert.strictEqual(t.kind, null);
  assert.strictEqual(t.priority, 'normal');
});

test('newTaskはstartだけのときendにも同じ日を入れる（1日だけの予定）', () => {
  const t = newTask({ title: '出張', start: '2026-09-08' }, NOW);
  assert.strictEqual(t.start, '2026-09-08');
  assert.strictEqual(t.end, '2026-09-08');
});

test('newTaskはstart・endの両方を渡せば両方そのまま入る（複数日の期間）', () => {
  const t = newTask({ title: '出張', start: '2026-09-08', end: '2026-09-12' }, NOW);
  assert.strictEqual(t.start, '2026-09-08');
  assert.strictEqual(t.end, '2026-09-12');
});

test('newTaskは2回呼ぶとidが重複しない', () => {
  const a = newTask({ title: 'X' }, NOW);
  const b = newTask({ title: 'X' }, NOW);
  assert.notStrictEqual(a.id, b.id);
});

test('addTask/updateTask/removeTaskは元の配列を壊さない', () => {
  const list = [newTask({ title: 'A' }, NOW)];
  const added = addTask(list, newTask({ title: 'B' }, NOW));
  assert.strictEqual(list.length, 1, '元の配列は変わらない');
  assert.strictEqual(added.length, 2);

  const updated = updateTask(added, added[1].id, { title: 'B更新' });
  assert.strictEqual(added[1].title, 'B', '元の配列は変わらない');
  assert.strictEqual(updated[1].title, 'B更新');

  const removed = removeTask(updated, updated[0].id);
  assert.strictEqual(updated.length, 2, '元の配列は変わらない');
  assert.strictEqual(removed.length, 1);
});

test('存在しないidへのupdateTask/removeTaskは何も壊さない', () => {
  const list = [newTask({ title: 'A' }, NOW)];
  const updated = updateTask(list, 'not-exist', { title: '無視される' });
  assert.strictEqual(updated.length, 1);
  assert.strictEqual(updated[0].title, 'A');

  const removed = removeTask(list, 'not-exist');
  assert.strictEqual(removed.length, 1);
});

test('toggleDoneでdoneが反転し、完了時にdoneAtが入り、戻すとnullになる', () => {
  const list = [newTask({ title: 'A' }, NOW)];
  const id = list[0].id;
  const done = toggleDone(list, id, '2026-09-05T00:00:00.000Z');
  assert.strictEqual(done[0].done, true);
  assert.strictEqual(done[0].doneAt, '2026-09-05T00:00:00.000Z');

  const undone = toggleDone(done, id, '2026-09-06T00:00:00.000Z');
  assert.strictEqual(undone[0].done, false);
  assert.strictEqual(undone[0].doneAt, null);
});

test('pruneDoneは未完了は必ず残し、完了は新しい順に指定件数まで残す', () => {
  const undone = newTask({ title: '未完了' }, NOW);
  let list = [undone];
  for (let i = 0; i < 5; i += 1) {
    const t = newTask({ title: `完了${i}` }, NOW);
    t.done = true;
    t.doneAt = `2026-09-0${i + 1}T00:00:00.000Z`;
    list.push(t);
  }
  const pruned = pruneDone(list, 3);
  assert.ok(pruned.some((t) => t.id === undone.id), '未完了は残る');
  const doneItems = pruned.filter((t) => t.done);
  assert.strictEqual(doneItems.length, 3);
  assert.strictEqual(doneItems[0].title, '完了4', '一番新しいものが先頭');
});

test('groupTasksが期限切れ／今日／明日／今週／それ以降／期限なし／完了に正しく分ける（endで判定）', () => {
  // 今日: 2026-09-04（金曜日）
  const today = '2026-09-04';
  const mk = (title, end) => ({ ...newTask({ title, start: end, end }, NOW) });
  const list = [
    mk('overdue1', '2026-09-01'),
    mk('today1', '2026-09-04'),
    mk('tomorrow1', '2026-09-05'),
    mk('thisWeek1', '2026-09-06'), // 明日の翌日
    mk('later1', '2026-09-20'),
    { ...newTask({ title: 'noDue1' }, NOW) },
  ];
  const doneTask = { ...newTask({ title: 'done1', end: '2026-09-04' }, NOW), done: true, doneAt: NOW };
  list.push(doneTask);

  const groups = groupTasks(list, today);
  assert.strictEqual(groups.overdue.length, 1);
  assert.strictEqual(groups.overdue[0].title, 'overdue1');
  assert.strictEqual(groups.today.length, 1);
  assert.strictEqual(groups.today[0].title, 'today1');
  assert.strictEqual(groups.tomorrow.length, 1);
  assert.strictEqual(groups.tomorrow[0].title, 'tomorrow1');
  assert.strictEqual(groups.thisWeek.length, 1);
  assert.strictEqual(groups.thisWeek[0].title, 'thisWeek1');
  assert.strictEqual(groups.later.length, 1);
  assert.strictEqual(groups.later[0].title, 'later1');
  assert.strictEqual(groups.noDue.length, 1);
  assert.strictEqual(groups.noDue[0].title, 'noDue1');
  assert.strictEqual(groups.done.length, 1);
  assert.strictEqual(groups.done[0].title, 'done1');
});

test('日曜を過ぎるものは今週ではなくそれ以降に入る（土曜が今日の場合）', () => {
  // 2026-09-05は土曜日。明日=日曜(09-06)。今週の残りは無いはず。
  const today = '2026-09-05';
  const sunday = { ...newTask({ title: '日曜', end: '2026-09-06' }, NOW) };
  const nextMonday = { ...newTask({ title: '来週月曜', end: '2026-09-07' }, NOW) };
  const groups = groupTasks([sunday, nextMonday], today);
  assert.strictEqual(groups.tomorrow.length, 1, '日曜は明日グループ');
  assert.strictEqual(groups.tomorrow[0].title, '日曜');
  assert.strictEqual(groups.thisWeek.length, 0, '今週の残りは無い');
  assert.strictEqual(groups.later.length, 1);
  assert.strictEqual(groups.later[0].title, '来週月曜');
});

test('同じ日で時刻ありが時刻なしより先に来る。時刻は昇順', () => {
  const today = '2026-09-04';
  const noTime = { ...newTask({ title: '時刻なし', end: today }, NOW) };
  const late = { ...newTask({ title: '15時', end: today, at: '15:00' }, NOW) };
  const early = { ...newTask({ title: '09時', end: today, at: '09:00' }, NOW) };
  const groups = groupTasks([noTime, late, early], today);
  assert.deepStrictEqual(groups.today.map((t) => t.title), ['09時', '15時', '時刻なし']);
});

test('時刻が同じなら優先度high→normal→lowの順', () => {
  const today = '2026-09-04';
  const low = { ...newTask({ title: '低', end: today, at: '10:00', priority: 'low' }, NOW) };
  const high = { ...newTask({ title: '高', end: today, at: '10:00', priority: 'high' }, NOW) };
  const normal = { ...newTask({ title: '中', end: today, at: '10:00', priority: 'normal' }, NOW) };
  const groups = groupTasks([low, high, normal], today);
  assert.deepStrictEqual(groups.today.map((t) => t.title), ['高', '中', '低']);
});

test('完了した項目はどのグループにも入らず、doneにだけ入る', () => {
  const today = '2026-09-04';
  const doneOverdue = { ...newTask({ title: '完了済み', end: '2026-09-01' }, NOW), done: true, doneAt: NOW };
  const groups = groupTasks([doneOverdue], today);
  assert.strictEqual(groups.overdue.length, 0);
  assert.strictEqual(groups.done.length, 1);
});

test('countDueSoonが期限切れと今日締切の件数を返す（endで判定）', () => {
  const today = '2026-09-04';
  const list = [
    newTask({ title: 'a', end: '2026-09-01' }, NOW),
    newTask({ title: 'b', end: '2026-09-04' }, NOW),
    newTask({ title: 'c', end: '2026-09-04' }, NOW),
    newTask({ title: 'd', end: '2026-09-10' }, NOW),
    { ...newTask({ title: 'e', end: '2026-09-01' }, NOW), done: true, doneAt: NOW },
  ];
  const counts = countDueSoon(list, today);
  assert.strictEqual(counts.overdue, 1);
  assert.strictEqual(counts.today, 2);
});

test('壊れたデータ（null、配列でない、endが変な文字列）を渡しても落ちない', () => {
  assert.doesNotThrow(() => groupTasks(null, '2026-09-04'));
  assert.doesNotThrow(() => groupTasks(undefined, '2026-09-04'));
  assert.doesNotThrow(() => groupTasks('not an array', '2026-09-04'));
  assert.doesNotThrow(() => groupTasks([null, undefined, { title: 'x', end: 'abc' }], '2026-09-04'));
  assert.doesNotThrow(() => groupTasks([{ title: 'x', end: 123 }], '2026-09-04'));
  assert.doesNotThrow(() => countDueSoon(null, '2026-09-04'));
  assert.doesNotThrow(() => countDueSoon([{ end: 'not-a-date' }], '2026-09-04'));
  assert.doesNotThrow(() => addTask(null, newTask({ title: 'a' }, NOW)));
  assert.doesNotThrow(() => updateTask(null, 'x', {}));
  assert.doesNotThrow(() => removeTask(null, 'x'));
  assert.doesNotThrow(() => toggleDone(null, 'x', NOW));
  assert.doesNotThrow(() => pruneDone(null));

  const g = groupTasks([{ title: 'x', end: 'abc' }], '2026-09-04');
  assert.strictEqual(g.noDue.length, 1, '変な形式のendはnoDueに入る');
});

// --- Task 34: 期間対応（migrateTasks・inProgress） ---

test('migrateTasksが旧形式（due）をendに移し、startはnullのままになる', () => {
  const old = [
    { id: '1', title: 'A社へ見積書を送る', due: '2026-09-12', at: null, who: null, kind: null, priority: 'normal', note: '', done: false, createdAt: NOW, doneAt: null },
  ];
  const migrated = migrateTasks(old);
  assert.strictEqual(migrated[0].end, '2026-09-12');
  assert.strictEqual(migrated[0].start, null);
  assert.ok(!Object.prototype.hasOwnProperty.call(migrated[0], 'due'), 'dueキー自体は残らない');
  assert.strictEqual(migrated[0].title, 'A社へ見積書を送る', '他の項目は保たれる');
});

test('migrateTasksはdueがnullの旧形式でもendがnullになるだけで落ちない', () => {
  const old = [{ id: '1', title: 'メモ', due: null }];
  const migrated = migrateTasks(old);
  assert.strictEqual(migrated[0].end, null);
  assert.strictEqual(migrated[0].start, null);
});

test('移行後にもう一度migrateTasksをかけても壊れない（冪等）', () => {
  const old = [{ id: '1', title: 'A', due: '2026-09-12' }];
  const once = migrateTasks(old);
  const twice = migrateTasks(once);
  assert.deepStrictEqual(twice, once);
});

test('migrateTasksはnull・配列でない値・壊れた項目でも落ちない', () => {
  assert.doesNotThrow(() => migrateTasks(null));
  assert.doesNotThrow(() => migrateTasks(undefined));
  assert.doesNotThrow(() => migrateTasks('not an array'));
  assert.deepStrictEqual(migrateTasks(null), []);
  const migrated = migrateTasks([null, undefined, 123, { id: '1', due: '2026-09-01' }]);
  assert.strictEqual(migrated.length, 4);
  assert.strictEqual(migrated[3].end, '2026-09-01');
});

test('migrateTasksはすでにstart/endを持つ新形式には手を加えない', () => {
  const list = [{ id: '1', title: 'A', start: '2026-09-01', end: '2026-09-03' }];
  const migrated = migrateTasks(list);
  assert.deepStrictEqual(migrated, list);
});

test('groupTasksが期間中（start<=today<=end）の項目にinProgress:trueを付ける', () => {
  const today = '2026-09-10';
  const t = newTask({ title: '出張', start: '2026-09-08', end: '2026-09-12' }, NOW);
  const groups = groupTasks([t], today);
  // end(09-12)は今週扱いか、それ以降かは日次計算次第だが、いずれかのグループに入るはず。
  const all = [...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.thisWeek, ...groups.later, ...groups.noDue];
  const found = all.find((x) => x.title === '出張');
  assert.ok(found, '一覧に出張が見つかる');
  assert.strictEqual(found.inProgress, true);
});

test('終了日が未来でも、今日が期間内ならinProgressがtrue', () => {
  const today = '2026-09-04';
  const t = newTask({ title: '研修', start: '2026-09-01', end: '2026-09-30' }, NOW);
  const groups = groupTasks([t], today);
  assert.strictEqual(groups.later[0].inProgress, true, '終了日は先(later)でも進行中はtrue');
});

test('期間の外（todayがstartより前、またはendより後）ならinProgressはfalse', () => {
  const before = groupTasks([newTask({ title: 'A', start: '2026-09-10', end: '2026-09-12' }, NOW)], '2026-09-05');
  assert.strictEqual(before.later[0].inProgress, false);

  const after = groupTasks([newTask({ title: 'B', start: '2026-09-01', end: '2026-09-03' }, NOW)], '2026-09-10');
  assert.strictEqual(after.overdue[0].inProgress, false);
});

test('startが無い項目はend===todayのときだけinProgressがtrue', () => {
  const today = '2026-09-04';
  const t1 = { ...newTask({ title: 'A' }, NOW), start: null, end: '2026-09-04' };
  const t2 = { ...newTask({ title: 'B' }, NOW), start: null, end: '2026-09-05' };
  const groups = groupTasks([t1, t2], today);
  assert.strictEqual(groups.today[0].inProgress, true, 'endが今日ならtrue');
  assert.strictEqual(groups.tomorrow[0].inProgress, false, 'endが今日でなければfalse');
});

test('startもendも無い項目はinProgressがfalse', () => {
  const t = newTask({ title: 'メモ' }, NOW);
  const groups = groupTasks([t], '2026-09-04');
  assert.strictEqual(groups.noDue[0].inProgress, false);
});
