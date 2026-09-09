// src/main/planner/prompt.js
// 予定（旅行・出張・終日の会議など）の行程表を作らせるプロンプトと、その読み取り。
// Electronにもネットワークにも依存しない純粋な処理。
//
// **出力の日付の見出しは形を固定する。**
// トップページの「今日の進め方」には、行程表まるごとではなく**その日ぶんだけ**を渡す。
// 見出しの形が揺れると切り出せず、毎日まるごと渡すことになって費用が増える。

// 1件の行程表で扱う上限。壊れた日付（開始2020年・終了2030年など）が来たときに、
// 3650日ぶんの見出しをプロンプトに並べてしまわないための歯止め。
const MAX_DAYS = 31;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

// 'YYYY-MM-DD' を、その日の0時のDateにする。タイムゾーンの繰り上がりを避けるため
// Date.parse ではなく数値から組み立てる。
function toDate(ymd) {
  const [y, m, d] = clean(ymd).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 開始日から終了日までの日付を並べる。順序が逆・壊れた値では空にする。
function dayList(start, end) {
  if (!isYmd(start) || !isYmd(end)) return [];
  const from = toDate(start);
  const to = toDate(end);
  if (to < from) return [];
  const out = [];
  const cur = from;
  while (cur <= to && out.length < MAX_DAYS) {
    out.push(toYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// 【2026/9/15（月）】。行程表の日付の見出しは必ずこの形にする。
function formatDayHeading(ymd) {
  if (!isYmd(ymd)) return '';
  const d = toDate(ymd);
  return `【${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）】`;
}

// その予定が何日ぶんか。
// 開始日と終了日の両方があれば期間、片方だけならその1日ぶん。
// 1日で終わる予定にも行程表は要る（終日の会議・イベントなど）ので、
// 複数日には限らない。
function taskDays(task) {
  const t = task || {};
  if (isYmd(t.start) && isYmd(t.end)) return dayList(t.start, t.end);
  if (isYmd(t.start)) return [t.start];
  if (isYmd(t.end)) return [t.end];
  return [];
}

// 行程表を作れる予定か。日付がまったく無いものだけを除く。
function canPlan(task) {
  return taskDays(task).length >= 1;
}

// system は毎回まったく同じにする（プロンプトキャッシュが前方一致で効くように）。
function buildPlanSystemPrompt() {
  return [
    'あなたは秘書として、予定の行程表を立てるアシスタントです。',
    '',
    'あなたの仕事は、決まっていることを書き写すことではありません。',
    '**決まっていないところを埋める案を出すこと**が仕事です。',
    '',
    '守ること:',
    '- 渡された決まっていることは必ず守る。勝手に日時や場所を変えない',
    '- 決まっていないところは「未定」で済ませず、**目的から考えて案を出す**。',
    '  時間の使い方・回る順番・どこで何をするかまで踏み込んでよい',
    '- ただし**調べないと分からない事実は書かない**（便名・料金・営業時間・住所・電話番号）。',
    '  もっともらしい数字を書くと、その場で困るのは利用者本人。',
    '  代わりに「朝の便を押さえる」のように、やることとして書く',
    '- 移動・食事・休憩・予備の時間を入れる。詰め込みすぎない',
    '- 前後に準備や後片付けが要るなら、最初と最後の日に入れる',
    '- 案には短い理由を添えてよい（「移動で疲れるので初日は軽めに」など）',
    '',
    '出力の形:',
    '- 1日ごとに「【2026/9/15（月）】」の見出しを立て、その下に「・」の箇条書き',
    '- 見出しの形は1文字も変えない（アプリがその日ぶんだけを取り出すため）',
    '- 各行は「・09:00 松山空港発」のように、時刻を先に書く。時刻が決まらない行は時刻を省く',
    '- 渡された日付をすべて出す。前置き・あいさつ・締めの言葉は書かない',
    '- 最後に「【備考】」の見出しを立て、決めておくべきこと・確認が要ることを',
    '  箇条書きにする（予約が要るもの、先方に聞くこと、持ち物など）',
  ].join('\n');
}

function buildPlanUserPrompt({ task, given } = {}) {
  const t = task || {};
  const days = taskDays(t);
  // 期間は日付が片方しか無いこともある（1日で終わる予定）。その日を1つだけ書く。
  const period = days.length >= 2
    ? `${days[0]} 〜 ${days[days.length - 1]}（${days.length}日間）`
    : (days[0] || '（日付が読み取れませんでした）');
  const lines = [
    `【予定名】${clean(t.title) || '(無題)'}`,
    `【期間】${period}`,
  ];
  if (clean(t.who)) lines.push(`【同行者・相手】${clean(t.who)}`);
  if (clean(t.at)) lines.push(`【開始時刻】${clean(t.at)}`);
  if (clean(t.note)) lines.push(`【メモ】${clean(t.note)}`);

  lines.push('');
  lines.push('【決まっていること】');
  lines.push(clean(given) || '（特に指定はありません）');

  lines.push('');
  lines.push('【この行程表で出す日付の見出し】');
  lines.push(days.map(formatDayHeading).join('\n') || '（期間が読み取れませんでした）');
  lines.push('');
  lines.push('上記の見出しをすべて使い、日ごとの行程を作ってください。');
  lines.push('決まっていないところは、あなたの案で埋めてください。');
  return lines.join('\n');
}

// 行程表から、その日ぶんの見出しと中身だけを取り出す。
// 次の「【」で始まる行の手前までを1日ぶんとする。見つからなければ空。
function extractDay(plan, ymd) {
  const heading = formatDayHeading(ymd);
  const text = clean(plan);
  if (!heading || !text) return '';
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim().startsWith(heading));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const stop = rest.findIndex((line) => line.trim().startsWith('【'));
  const body = stop === -1 ? rest : rest.slice(0, stop);
  return [lines[start].trim()].concat(body).join('\n').trim();
}

module.exports = {
  MAX_DAYS,
  WEEKDAYS,
  isYmd,
  dayList,
  taskDays,
  formatDayHeading,
  canPlan,
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  extractDay,
};
