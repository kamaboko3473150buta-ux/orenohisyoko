// src/main/docgen/estimate.js
// 資料作成のAPI呼び出し前に画面へ出す、文字数からの概算費用。
// メール文面作成（1通数円）とは桁が違う（参考資料がそのままAPIに渡るため）ので、
// 実行前に確認を挟むかどうかの判断材料にする（設計書 4-6）。
//
// 料金定数を二重に持たないよう、src/main/models.js が公開している
// costJpy（モデルごとの単価による円換算）をそのまま利用する。

const { FEATURES, costJpy } = require('../models');

// 資料作成の既定モデル（設定で変えていないときの見積もりに使う）。
const DEFAULT_DOCGEN_MODEL_ID = (FEATURES.find((f) => f.id === 'docgen') || {}).defaultModel;

// これを超えたら実行前に確認ダイアログを出す（設計書 4-6: 「3万字を超えたら」＝厳密に超過）。
const CONFIRM_CHARS = 30000;

// 日本語はおおむね1文字≒1トークンだが、安全側（多め）に見積もるため
// 常に「1文字=1トークン」とみなす（実トークン数はこれより少ないことが多い）。
function estimateTokens(chars) {
  const n = Number(chars);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

// 生成される資料の分量の見込み（トークン）。参考資料が大きくても、
// 出来上がる資料の長さはそれに比例しない（A4数枚程度に収まる）ため、固定値で見る。
// 出力は入力の5倍の単価なので、ここを入力と同数にすると概算が数倍に膨らんでしまう。
const OUTLINE_OUTPUT_TOKENS = 1200;
const BODY_OUTPUT_TOKENS = 5000;

// プロンプトの指示文そのものの分（種類ごとの作法・出力形式の指定など）。
const PROMPT_OVERHEAD_TOKENS = 600;

// API に渡す出力の上限。上の見積もり値とは役割が違うので分けている。
// 見積もりは「ふつうこのくらい」の値、上限は「ここまでは出してよい」の値。
// 上限を見積もり値に合わせると、長い資料のときに途中で切れてJSONが壊れ、
// 料金を払ったのに何も残らない。切れるくらいなら多少高くつくほうがましなので、
// 上限は余裕を持たせる。
const OUTLINE_MAX_TOKENS = 4000;
const BODY_MAX_TOKENS = 16000;

// Task 40: プロンプトキャッシュ。参考資料の塊が小さいとキャッシュ自体が効かない
// （実際のAnthropic APIには1024〜4096トークン程度のモデルごとの最小サイズがある）ため、
// 概算では安全側に「およそ2000トークン未満は効かない」とみなす。
const CACHE_MIN_TOKENS = 2000;

// 構成案・本文の2回のAPI呼び出し分の概算費用（円）。
// 参考資料は2回とも丸ごと送るが、docgen/index.js が参考資料の塊を cachePrefix として
// 渡すため、CACHE_MIN_TOKENS以上のときは2回目（本文）をキャッシュ読み（入力の0.1倍）として、
// 1回目（構成案）をキャッシュ書き込み（入力の1.25倍）として見積もる
// （書き込んでおかないと2回目で読めないため、正確な概算にはこれも含める）。
// 本文の回は、確定した構成案も一緒に送る分（PROMPT_OVERHEAD_TOKENS + OUTLINE_OUTPUT_TOKENS）を足す。
// modelIdを省略したときは資料作成の既定モデル（Sonnet 5）で見積もる。
function estimateYen(chars, modelId = DEFAULT_DOCGEN_MODEL_ID) {
  const src = estimateTokens(chars);
  if (src <= 0) return 0;

  if (src < CACHE_MIN_TOKENS) {
    // 小さい資料はキャッシュが効かない前提（これまでどおりの計算）。
    const outline = costJpy(modelId, {
      inputTokens: src + PROMPT_OVERHEAD_TOKENS,
      outputTokens: OUTLINE_OUTPUT_TOKENS,
    });
    const body = costJpy(modelId, {
      inputTokens: src + PROMPT_OVERHEAD_TOKENS + OUTLINE_OUTPUT_TOKENS,
      outputTokens: BODY_OUTPUT_TOKENS,
    });
    return outline + body;
  }

  const outline = costJpy(modelId, {
    inputTokens: PROMPT_OVERHEAD_TOKENS,
    outputTokens: OUTLINE_OUTPUT_TOKENS,
    cacheCreationTokens: src,
  });
  const body = costJpy(modelId, {
    inputTokens: PROMPT_OVERHEAD_TOKENS + OUTLINE_OUTPUT_TOKENS,
    outputTokens: BODY_OUTPUT_TOKENS,
    cacheReadTokens: src,
  });
  return outline + body;
}

function needsConfirm(chars) {
  return (Number(chars) || 0) > CONFIRM_CHARS;
}

module.exports = {
  CONFIRM_CHARS, OUTLINE_OUTPUT_TOKENS, BODY_OUTPUT_TOKENS, PROMPT_OVERHEAD_TOKENS,
  OUTLINE_MAX_TOKENS, BODY_MAX_TOKENS, CACHE_MIN_TOKENS,
  estimateTokens, estimateYen, needsConfirm,
};
