// src/main/planner/prompt.js
// 複数日にわたる予定（旅行・出張）の行程表を作らせるプロンプトと、その読み取り。
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

// 2日以上にわたる予定か。行程表を作るのはこれが true のときだけ。
function isMultiDay(task) {
  const t = task || {};
  return dayList(t.start, t.end).length >= 2;
}

// system は毎回まったく同じにする（プロンプトキャッシュが前方一致で効くように）。
function buildPlanSystemPrompt() {
  return [
    'あなたは秘書として、旅行や出張の行程表を作るアシスタントです。',
    '',
    '守ること:',
    '- 渡された決まっていることは必ず守る。勝手に日時や場所を変えない',
    '- 決まっていないところは、無理に埋めずに「未定」と書く',
    '- 交通機関の便名・料金・営業時間など、**調べないと分からないことは書かない**',
    '  （もっともらしい嘘を書くより、空けておくほうが役に立つ）',
    '- 移動・食事・休憩の時間も入れて、詰め込みすぎない',
    '',
    '出力の形:',
    '- 1日ごとに「【2026/9/15（月）】」の見出しを立て、その下に「・」の箇条書き',
    '- 見出しの形は1文字も変えない（アプリがその日ぶんだけを取り出すため）',
    '- 各行は「・09:00 松山空港発」のように、時刻を先に書く。時刻が決まらない行は時刻を省く',
    '- 渡された日付をすべて出す。前置き・あいさつ・締めの言葉は書かない',
  ].join('\n');
}

function buildPlanUserPrompt({ task, given } = {}) {
  const t = task || {};
  const days = dayList(t.start, t.end);
  const lines = [
    `【予定名】${clean(t.title) || '(無題)'}`,
    `【期間】${clean(t.start)} 〜 ${clean(t.end)}（${days.length}日間）`,
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
  formatDayHeading,
  isMultiDay,
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  extractDay,
};
