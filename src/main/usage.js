// src/main/usage.js
// Claude API の利用量（トークン数）を月ごと・モデルごとに記録・集計する。保存はしない純粋な関数群。
// Electron に依存しないので、そのままテストできる。
//
// Anthropic の管理APIはAdmin APIキーが必要で個人利用では発行できないことが多いため、
// 「今月いくら使ったか」はこのアプリでのAPI呼び出しの成功回数・トークン数から自前で見積もる。
//
// 料金の単価は models.js に一本化しており、ここでは持たない
// （モデルが増えたときに直す場所を1か所にするため）。

const { DEFAULT_MODEL_ID, findModel, costUsd, costJpy } = require('./models');

// 'YYYY-MM' 形式の月キーを作る。集計・保存のキーとして使う。
function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function emptyModelEntry() {
  return { count: 0, inputTokens: 0, outputTokens: 0 };
}

function toEntry(raw) {
  const e = raw || {};
  return {
    count: Number(e.count) || 0,
    inputTokens: Number(e.inputTokens) || 0,
    outputTokens: Number(e.outputTokens) || 0,
  };
}

function isNewFormat(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && raw.version === 2 && !!raw.months && typeof raw.months === 'object' && !Array.isArray(raw.months);
}

// 新形式 { version:2, months: { 'YYYY-MM': { modelId: {count,inputTokens,outputTokens} } } } の月データを、
// キー・値ともに壊れていても安全な形に整える。
function normalizeNewMonths(rawMonths) {
  const months = {};
  for (const [key, byModel] of Object.entries(rawMonths)) {
    if (!MONTH_KEY_RE.test(key) || !byModel || typeof byModel !== 'object' || Array.isArray(byModel)) continue;
    const normalized = {};
    for (const [modelId, entry] of Object.entries(byModel)) {
      normalized[modelId] = toEntry(entry);
    }
    months[key] = normalized;
  }
  return months;
}

// 旧形式 { 'YYYY-MM': {count,inputTokens,outputTokens} }（モデル別に分かれる前の記録）の月データを、
// すべてOpus 5の利用として新形式に積み替える（当時は全機能がOpus 5固定だったため）。
function normalizeOldMonths(raw) {
  const months = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!MONTH_KEY_RE.test(key) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    months[key] = { [DEFAULT_MODEL_ID]: toEntry(entry) };
  }
  return months;
}

// 旧形式・新形式・null・壊れたデータのいずれが来ても
// { version:2, months: { 'YYYY-MM': { modelId: {count,inputTokens,outputTokens} } } } にそろえる。
// 旧データはOpus 5の利用として扱う。新形式をもう一度渡しても壊れない（冪等）。
function migrate(raw) {
  if (isNewFormat(raw)) {
    return { version: 2, months: normalizeNewMonths(raw.months) };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { version: 2, months: normalizeOldMonths(raw) };
  }
  return { version: 2, months: {} };
}

// 使用量を1回分足した新しいstoreを返す（元のstoreは書き換えない）。旧形式のstoreを渡しても移行される。
// usage.model が省略・未知のときはOpus 5として記録する（既存の呼び出し・記録との互換のため）。
function addUsage(store, usage, when = new Date()) {
  const key = monthKey(when);
  const migrated = migrate(store);
  const u = usage || {};
  const modelId = findModel(u.model).id;

  const monthEntry = migrated.months[key] || {};
  const prev = monthEntry[modelId] || emptyModelEntry();
  const nextMonthEntry = {
    ...monthEntry,
    [modelId]: {
      count: prev.count + 1,
      inputTokens: prev.inputTokens + (Number(u.inputTokens) || 0),
      outputTokens: prev.outputTokens + (Number(u.outputTokens) || 0),
    },
  };

  return { version: 2, months: { ...migrated.months, [key]: nextMonthEntry } };
}

// モデル別の内訳（byModel）に費用を添えつつ、モデルをまたいで合算したものを返す。
function aggregate(byModel) {
  const models = byModel || {};
  const result = {
    count: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costJpy: 0, byModel: {},
  };
  for (const [modelId, entryRaw] of Object.entries(models)) {
    const entry = toEntry(entryRaw);
    const cu = costUsd(modelId, entry);
    const cj = costJpy(modelId, entry);
    result.byModel[modelId] = { ...entry, costUsd: cu, costJpy: cj };
    result.count += entry.count;
    result.inputTokens += entry.inputTokens;
    result.outputTokens += entry.outputTokens;
    result.costUsd += cu;
    result.costJpy += cj;
  }
  return result;
}

// 当月分・月別一覧（新しい順）・累計をまとめて返す。画面表示にそのまま使える形。
// 各要素（current/months[]/total）はモデル別の内訳（byModel）と費用（costJpy等）を持つ。
function summarize(store, now = new Date()) {
  const migrated = migrate(store);
  const currentKey = monthKey(now);

  const months = Object.keys(migrated.months)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)) // 新しい月が先頭
    .map((key) => ({ month: key, ...aggregate(migrated.months[key]) }));

  const current = { month: currentKey, ...aggregate(migrated.months[currentKey]) };

  const totalByModel = {};
  for (const byModel of Object.values(migrated.months)) {
    for (const [modelId, entryRaw] of Object.entries(byModel || {})) {
      const entry = toEntry(entryRaw);
      const prev = totalByModel[modelId] || emptyModelEntry();
      totalByModel[modelId] = {
        count: prev.count + entry.count,
        inputTokens: prev.inputTokens + entry.inputTokens,
        outputTokens: prev.outputTokens + entry.outputTokens,
      };
    }
  }
  const total = aggregate(totalByModel);

  return { current, months, total };
}

module.exports = { monthKey, migrate, addUsage, summarize };
