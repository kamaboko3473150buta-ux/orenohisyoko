// src/main/weather/format.js
// 天気の見せ方。Electronにもネットワークにも依存しない純粋関数。
//
// 天気にAIは使わない。値をそのまま日本語にするだけで足り、
// AIに通すと費用がかかるうえ、言い換えられて数字が変わる恐れもある。

// WMO の天気コード → 日本語。Open-Meteo が返すのがこの番号。
const CODE_LABELS = [
  [[0], '快晴'],
  [[1], '晴れ'],
  [[2], '晴れ時々曇り'],
  [[3], '曇り'],
  [[45, 48], '霧'],
  [[51, 53, 55], '霧雨'],
  [[56, 57], '凍える霧雨'],
  [[61], '小雨'],
  [[63], '雨'],
  [[65], '大雨'],
  [[66, 67], '凍える雨'],
  [[71], '小雪'],
  [[73], '雪'],
  [[75], '大雪'],
  [[77], '細かい雪'],
  [[80, 81], 'にわか雨'],
  [[82], '激しいにわか雨'],
  [[85, 86], 'にわか雪'],
  [[95], '雷雨'],
  [[96, 99], 'ひょうを伴う雷雨'],
];

function weatherLabel(code) {
  // Number(null) と Number('') は 0（＝快晴）になってしまうので、先に弾く。
  // 値が取れていないのに「快晴」と出すのは、いちばんやってはいけない嘘。
  if (code === null || code === undefined || code === '') return '';
  const n = Number(code);
  if (!Number.isFinite(n)) return '';
  for (const [codes, label] of CODE_LABELS) {
    if (codes.includes(n)) return label;
  }
  return '';
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 「2026/9/8（火）」。月日は0埋めしない（読みやすさを優先）。
function formatDate(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

// 1日の中で天気が変わるなら「曇りのち雨」にする。
// 午前（6〜11時）と午後（12〜17時）でいちばん多いコードを見て、違えば「のち」でつなぐ。
// 1日ぶんの代表値ひとつだけだと「曇りのち雨」が言えない。
function describeDay(hourlyCodes, hourlyTimes) {
  const codes = Array.isArray(hourlyCodes) ? hourlyCodes : [];
  const times = Array.isArray(hourlyTimes) ? hourlyTimes : [];

  function dominant(fromHour, toHour) {
    const counts = new Map();
    codes.forEach((code, i) => {
      const t = times[i];
      const hour = typeof t === 'string' && t.length >= 13 ? Number(t.slice(11, 13)) : NaN;
      if (!Number.isFinite(hour) || hour < fromHour || hour > toHour) return;
      const label = weatherLabel(code);
      if (!label) return;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    let best = '';
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (count > bestCount) { best = label; bestCount = count; }
    }
    return best;
  }

  const morning = dominant(6, 11);
  const afternoon = dominant(12, 17);
  if (morning && afternoon && morning !== afternoon) return `${morning}のち${afternoon}`;
  return morning || afternoon || '';
}

function roundTemp(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// 吹き出しに出す1行。頭の上の吹き出しは秘書子の顔のすぐ上にしか置けないので、
// **日付も地名も入れない**（入れると折り返して2行になり、顔にかぶる）。
// 日付と曜日はマウスを乗せたときの説明に回す。
function formatSummary({
  description, high, low, rain,
} = {}) {
  const parts = [];
  const desc = String(description == null ? '' : description).trim();
  if (desc) parts.push(desc);
  const hi = roundTemp(high);
  const lo = roundTemp(low);
  if (hi !== null && lo !== null) parts.push(`最高${hi}℃/最低${lo}℃`);
  const r = Number(rain);
  if (Number.isFinite(r)) parts.push(`降水${Math.round(r)}%`);
  return parts.join('　');
}

module.exports = {
  CODE_LABELS, WEEKDAYS, weatherLabel, formatDate, describeDay, formatSummary, roundTemp,
};
