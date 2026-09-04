// src/main/tasks.js
// タスク・予定の純粋な更新・グループ分け関数。保存はしない。Electron に依存しない。
//
// due（期限）は 'YYYY-MM-DD' の文字列として扱う。Date に変換して比較すると
// タイムゾーンによって日付がずれる（例: new Date('2026-09-12') はUTC解釈になる）ため、
// 文字列の辞書順比較で済ませる。この形式は辞書順＝日付順が一致するので安全。

const MAX_DONE = 100;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// 'YYYY-MM-DD' 形式かどうか（暦として正しいかまでは見ない。ここでは形式の妥当性のみ）。
function isValidDue(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// 数値から Date を作る（ローカル時刻）。文字列を直接 new Date() に渡すとUTC解釈されて
// タイムゾーンでずれるため、必ず年月日の数値から組み立てる。
function ymdToDate(due) {
  const [y, m, d] = due.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dateToYmd(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(due, days) {
  const dt = ymdToDate(due);
  dt.setDate(dt.getDate() + days);
  return dateToYmd(dt);
}

function dayOfWeek(due) {
  return ymdToDate(due).getDay(); // 0=日, 1=月, ... 6=土
}

function normalizePriority(p) {
  return p === 'high' || p === 'low' ? p : 'normal';
}

function randomSuffix() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// タスクを1件作る。title 以外は任意で、無ければ null（note のみ空文字）。
function newTask({ title, due, at, who, kind, priority, note } = {}, nowIso) {
  return {
    id: `${nowIso}-${randomSuffix()}`,
    title: title == null ? '' : String(title),
    due: due || null,
    at: at || null,
    who: who || null,
    kind: kind || null,
    priority: normalizePriority(priority),
    note: note || '',
    done: false,
    createdAt: nowIso,
    doneAt: null,
  };
}

function addTask(list, task) {
  return [...asArray(list), task];
}

function updateTask(list, id, patch) {
  return asArray(list).map((t) => (t && t.id === id ? { ...t, ...patch } : t));
}

function removeTask(list, id) {
  return asArray(list).filter((t) => !(t && t.id === id));
}

function toggleDone(list, id, nowIso) {
  return asArray(list).map((t) => {
    if (!t || t.id !== id) return t;
    const done = !t.done;
    return { ...t, done, doneAt: done ? nowIso : null };
  });
}

// 完了済みを doneAt の新しい順に max 件まで残す。未完了は必ず残す。
function pruneDone(list, max = MAX_DONE) {
  const safe = asArray(list);
  const notDone = safe.filter((t) => t && !t.done);
  const done = safe
    .filter((t) => t && t.done)
    .slice()
    .sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')))
    .slice(0, max);
  return [...notDone, ...done];
}

function priorityRank(p) {
  if (p === 'high') return 0;
  if (p === 'low') return 2;
  return 1; // normal または未知の値
}

// グループ内の並び順: 時刻ありを先に時刻昇順 → 優先度(high,normal,low) → 登録順。
// Array#sort は安定ソートなので、キーが等しい要素は元の並び（登録順）が保たれる。
function compareForDisplay(a, b) {
  const aHasAt = !!(a && a.at);
  const bHasAt = !!(b && b.at);
  if (aHasAt !== bHasAt) return aHasAt ? -1 : 1;
  if (aHasAt && bHasAt && a.at !== b.at) return a.at < b.at ? -1 : 1;
  return priorityRank(a && a.priority) - priorityRank(b && b.priority);
}

// today（'YYYY-MM-DD'）を基準にグループ分けする。
// 「今週」の残り: 明日の翌日から、今日を含む週の日曜日まで（週は日曜終わり）。
function groupTasks(list, today) {
  const groups = {
    overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], noDue: [], done: [],
  };
  const safe = asArray(list);
  const todayValid = isValidDue(today);

  const tomorrow = todayValid ? addDays(today, 1) : null;
  const daysToSunday = todayValid ? (7 - dayOfWeek(today)) % 7 : null;
  const weekEnd = todayValid ? addDays(today, daysToSunday) : null;
  const thisWeekStart = todayValid ? addDays(today, 2) : null;

  for (const t of safe) {
    if (!t || typeof t !== 'object') continue;
    if (t.done) {
      groups.done.push(t);
      continue;
    }
    if (!todayValid || !isValidDue(t.due)) {
      groups.noDue.push(t);
      continue;
    }
    if (t.due < today) groups.overdue.push(t);
    else if (t.due === today) groups.today.push(t);
    else if (t.due === tomorrow) groups.tomorrow.push(t);
    else if (thisWeekStart && weekEnd && thisWeekStart <= weekEnd && t.due >= thisWeekStart && t.due <= weekEnd) {
      groups.thisWeek.push(t);
    } else {
      groups.later.push(t);
    }
  }

  groups.overdue.sort(compareForDisplay);
  groups.today.sort(compareForDisplay);
  groups.tomorrow.sort(compareForDisplay);
  groups.thisWeek.sort(compareForDisplay);
  groups.later.sort(compareForDisplay);
  groups.noDue.sort(compareForDisplay);
  groups.done.sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));

  return groups;
}

// 期限切れ・今日締切の件数（未完了のみ）。吹き出しでの通知に使う。
function countDueSoon(list, today) {
  const safe = asArray(list);
  if (!isValidDue(today)) return { overdue: 0, today: 0 };
  let overdue = 0;
  let todayCount = 0;
  for (const t of safe) {
    if (!t || typeof t !== 'object' || t.done) continue;
    if (!isValidDue(t.due)) continue;
    if (t.due < today) overdue += 1;
    else if (t.due === today) todayCount += 1;
  }
  return { overdue, today: todayCount };
}

module.exports = {
  newTask, addTask, updateTask, removeTask, toggleDone, pruneDone, groupTasks, countDueSoon,
};
