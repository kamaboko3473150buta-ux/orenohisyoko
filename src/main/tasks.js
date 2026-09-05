// src/main/tasks.js
// タスク・予定の純粋な更新・グループ分け関数。保存はしない。Electron に依存しない。
//
// 日付（start/end）は 'YYYY-MM-DD' の文字列として扱う。Date に変換して比較すると
// タイムゾーンによって日付がずれる（例: new Date('2026-09-12') はUTC解釈になる）ため、
// 文字列の辞書順比較で済ませる。この形式は辞書順＝日付順が一致するので安全。
//
// 複数日にわたる予定（出張・研修・長期の作業）を1件で扱えるよう、期限は
// start（開始日）・end（終了日）の「期間」として持つ。期限切れ／今日などの
// グループ分けや通知の判定には、これまでの due と同じ扱いで end を使う。

const MAX_DONE = 100;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// 'YYYY-MM-DD' 形式かどうか（暦として正しいかまでは見ない。ここでは形式の妥当性のみ）。
// start・end のどちらにも使う。
function isValidYmd(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// 数値から Date を作る（ローカル時刻）。文字列を直接 new Date() に渡すとUTC解釈されて
// タイムゾーンでずれるため、必ず年月日の数値から組み立てる。
function ymdToDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dateToYmd(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(ymd, days) {
  const dt = ymdToDate(ymd);
  dt.setDate(dt.getDate() + days);
  return dateToYmd(dt);
}

function dayOfWeek(ymd) {
  return ymdToDate(ymd).getDay(); // 0=日, 1=月, ... 6=土
}

function normalizePriority(p) {
  return p === 'high' || p === 'low' ? p : 'normal';
}

function randomSuffix() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// タスクを1件作る。title 以外は任意で、無ければ null（note のみ空文字）。
// end を省略して start だけ渡された場合は、その日1日だけの予定として end にも
// 同じ日を入れる（複数日の期間ではなく単発の予定・タスクとして扱うため）。
function newTask({ title, start, end, at, who, kind, priority, note } = {}, nowIso) {
  const s = start || null;
  const e = end || s || null;
  return {
    id: `${nowIso}-${randomSuffix()}`,
    title: title == null ? '' : String(title),
    start: s,
    end: e,
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

// 旧形式（due だけを持つ）のタスクを、start/end 形式に移す。
// due は end に移し、start は null のままにする（開始日は元データに無い情報なので補わない）。
// 既存ユーザーの tasks.json を読み込むたびに通す前提のため、何度かけても壊れない
// （一度移行した項目は due を持たないので、2回目以降は何もしない）。
// null・配列でない・壊れた項目が混ざっていても落ちない。
function migrateTasks(list) {
  const safe = asArray(list);
  return safe.map((t) => {
    if (!t || typeof t !== 'object') return t;
    if (!Object.prototype.hasOwnProperty.call(t, 'due')) return t;
    const { due, start, end, ...rest } = t;
    return {
      ...rest,
      start: start == null ? null : start,
      end: end == null ? (due == null ? null : due) : end,
    };
  });
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

// 今日が start〜end の期間内かどうか。
// - start・end の両方がある: start <= today && today <= end
// - start が無い: end === today のときだけ true（終了日の当日だけ「進行中」として扱う）
// - どちらも無い（あるいは today 自体が不正）: false
function computeInProgress(t, today) {
  if (!t || typeof t !== 'object' || !isValidYmd(today)) return false;
  const hasStart = isValidYmd(t.start);
  const hasEnd = isValidYmd(t.end);
  if (hasStart && hasEnd) return t.start <= today && today <= t.end;
  if (!hasStart) return hasEnd && t.end === today;
  return false;
}

// today（'YYYY-MM-DD'）を基準にグループ分けする。判定は end（終了日）で行う。
// 「今週」の残り: 明日の翌日から、今日を含む週の日曜日まで（週は日曜終わり）。
// 各項目には表示用に inProgress（今日が期間内かどうか）を付けて返す。
function groupTasks(list, today) {
  const groups = {
    overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], noDue: [], done: [],
  };
  const safe = asArray(list);
  const todayValid = isValidYmd(today);

  const tomorrow = todayValid ? addDays(today, 1) : null;
  const daysToSunday = todayValid ? (7 - dayOfWeek(today)) % 7 : null;
  const weekEnd = todayValid ? addDays(today, daysToSunday) : null;
  const thisWeekStart = todayValid ? addDays(today, 2) : null;

  for (const raw of safe) {
    if (!raw || typeof raw !== 'object') continue;
    const t = { ...raw, inProgress: computeInProgress(raw, today) };
    if (t.done) {
      groups.done.push(t);
      continue;
    }
    if (!todayValid || !isValidYmd(t.end)) {
      groups.noDue.push(t);
      continue;
    }
    if (t.end < today) groups.overdue.push(t);
    else if (t.end === today) groups.today.push(t);
    else if (t.end === tomorrow) groups.tomorrow.push(t);
    else if (thisWeekStart && weekEnd && thisWeekStart <= weekEnd && t.end >= thisWeekStart && t.end <= weekEnd) {
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

// 期限切れ・今日締切の件数（未完了のみ）。吹き出しでの通知に使う。判定は end で行う。
function countDueSoon(list, today) {
  const safe = asArray(list);
  if (!isValidYmd(today)) return { overdue: 0, today: 0 };
  let overdue = 0;
  let todayCount = 0;
  for (const t of safe) {
    if (!t || typeof t !== 'object' || t.done) continue;
    if (!isValidYmd(t.end)) continue;
    if (t.end < today) overdue += 1;
    else if (t.end === today) todayCount += 1;
  }
  return { overdue, today: todayCount };
}

module.exports = {
  newTask, addTask, updateTask, removeTask, toggleDone, pruneDone, groupTasks, countDueSoon, migrateTasks,
};
