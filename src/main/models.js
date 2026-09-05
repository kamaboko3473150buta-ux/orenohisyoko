// src/main/models.js
// 選べるモデル（Opus 5 / Sonnet 5 / Haiku 4.5）と、機能ごとの既定モデルの定義。
// 料金の単価は必ずここに一本化する。usage.js（利用状況の集計）と
// docgen/estimate.js（資料作成の概算費用）は、どちらも自前で単価を持たず
// ここの costUsd / costJpy を参照する（モデルが増えたときに直す場所を1か所にするため）。

// 円換算は目安のレート（実際の為替レートとは異なる）。表示する金額はあくまで概算である。
const USD_TO_JPY_RATE = 150;

// 料金は各モデルの実勢（1Mトークンあたりの米ドル）。
// 実勢が変わったら、この一覧だけ直せばよい。
const MODELS = [
  {
    id: 'claude-opus-5', label: 'Opus 5', inputUsd: 5, outputUsd: 25, note: '最も賢い。長い資料の構成や複雑な判断に',
  },
  {
    id: 'claude-sonnet-5', label: 'Sonnet 5', inputUsd: 2, outputUsd: 10, note: '日常の業務文書はこれで十分。費用は半分以下',
  },
  {
    id: 'claude-haiku-4-5', label: 'Haiku 4.5', inputUsd: 1, outputUsd: 5, note: '最も安い。短い定型の仕事向け',
  },
];

// 全機能の既定であり、モデルIDが未知のときの最後の拠り所。
// これまで全機能がこのモデル固定だったため、既存の記録・呼び出しとの互換のために動かさない。
const DEFAULT_MODEL_ID = 'claude-opus-5';

const FEATURES = [
  { id: 'mail', label: 'メール文面作成', defaultModel: 'claude-opus-5' },
  { id: 'task', label: 'タスクの取り込み・案内', defaultModel: 'claude-opus-5' },
  { id: 'docgen', label: '資料作成', defaultModel: 'claude-sonnet-5' },
];

// idで探す。見つからない（未知・未指定）ときはOpus 5を返す。
// 例外を投げない設計にするため、呼び出し側はfindModelの戻り値が必ずモデルであることに頼れる。
function findModel(id) {
  return MODELS.find((m) => m.id === id) || MODELS.find((m) => m.id === DEFAULT_MODEL_ID);
}

function findFeature(id) {
  return FEATURES.find((f) => f.id === id);
}

// 概算費用（米ドル）。modelIdが未知でもfindModelがOpus 5に倒すので落ちない。
function costUsd(modelId, usage) {
  const model = findModel(modelId);
  const u = usage || {};
  const inputCost = ((Number(u.inputTokens) || 0) / 1_000_000) * model.inputUsd;
  const outputCost = ((Number(u.outputTokens) || 0) / 1_000_000) * model.outputUsd;
  return inputCost + outputCost;
}

// 概算費用（円）。あくまで目安のレートによる概算。
function costJpy(modelId, usage) {
  return costUsd(modelId, usage) * USD_TO_JPY_RATE;
}

module.exports = {
  MODELS, FEATURES, DEFAULT_MODEL_ID, USD_TO_JPY_RATE, findModel, findFeature, costUsd, costJpy,
};
