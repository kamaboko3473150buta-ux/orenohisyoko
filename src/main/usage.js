// src/main/usage.js
// Claude API の利用量（トークン数）を月ごとに記録・集計する。保存はしない純粋な関数群。
// Electron に依存しないので、そのままテストできる。
//
// Anthropic の管理APIはAdmin APIキーが必要で個人利用では発行できないことが多いため、
// 「今月いくら使ったか」はこのアプリでのAPI呼び出しの成功回数・トークン数から自前で見積もる。

// 料金は claude-opus-5 の実勢（1Mトークンあたりの米ドル）。
// モデル（src/main/claude.js の MODEL）を変えたら、この2つも実勢に合わせて直すこと。
const INPUT_USD_PER_MILLION_TOKENS = 5;
const OUTPUT_USD_PER_MILLION_TOKENS = 25;

// 円換算は目安のレート（実際の為替レートとは異なる）。表示する金額はあくまで概算である。
const USD_TO_JPY_RATE = 150;

// 'YYYY-MM' 形式の月キーを作る。集計・保存のキーとして使う。
function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// 壊れた・存在しないstoreでも扱えるようにする。
function asStore(store) {
  return store && typeof store === 'object' ? store : {};
}

function emptyEntry() {
  return { count: 0, inputTokens: 0, outputTokens: 0 };
}

// 使用量を1回分足した新しいstoreを返す（元のstoreは書き換えない）。
function addUsage(store, usage, when = new Date()) {
  const key = monthKey(when);
  const base = asStore(store);
  const prev = base[key] || emptyEntry();
  const u = usage || {};
  return {
    ...base,
    [key]: {
      count: prev.count + 1,
      inputTokens: prev.inputTokens + (Number(u.inputTokens) || 0),
      outputTokens: prev.outputTokens + (Number(u.outputTokens) || 0),
    },
  };
}

// 概算費用（米ドル）。
function estimateCostUsd({ inputTokens, outputTokens } = {}) {
  const inputCost = ((Number(inputTokens) || 0) / 1_000_000) * INPUT_USD_PER_MILLION_TOKENS;
  const outputCost = ((Number(outputTokens) || 0) / 1_000_000) * OUTPUT_USD_PER_MILLION_TOKENS;
  return inputCost + outputCost;
}

// 概算費用（円）。あくまで目安のレートによる概算。
function estimateCostJpy(usage) {
  return estimateCostUsd(usage) * USD_TO_JPY_RATE;
}

function withCost(entry) {
  return { ...entry, costUsd: estimateCostUsd(entry), costJpy: estimateCostJpy(entry) };
}

// 当月分・月別一覧（新しい順）・累計をまとめて返す。画面表示にそのまま使える形。
function summarize(store, now = new Date()) {
  const base = asStore(store);
  const currentKey = monthKey(now);
  const currentEntry = base[currentKey] || emptyEntry();

  const months = Object.keys(base)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)) // 新しい月が先頭
    .map((key) => ({ month: key, ...withCost(base[key]) }));

  const total = Object.keys(base).reduce((acc, key) => {
    const e = base[key];
    return {
      count: acc.count + e.count,
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
    };
  }, emptyEntry());

  return {
    current: { month: currentKey, ...withCost(currentEntry) },
    months,
    total: withCost(total),
  };
}

module.exports = { monthKey, addUsage, estimateCostUsd, estimateCostJpy, summarize };
