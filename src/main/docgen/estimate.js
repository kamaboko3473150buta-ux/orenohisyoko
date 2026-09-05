// src/main/docgen/estimate.js
// 資料作成のAPI呼び出し前に画面へ出す、文字数からの概算費用。
// メール文面作成（1通数円）とは桁が違う（参考資料がそのままAPIに渡るため）ので、
// 実行前に確認を挟むかどうかの判断材料にする（設計書 4-6）。
//
// 料金定数を二重に持たないよう、src/main/usage.js が既に公開している
// estimateCostJpy（トークン数→円換算）をそのまま再利用する。

const { estimateCostJpy } = require('../usage');

// これを超えたら実行前に確認ダイアログを出す（設計書 4-6: 「3万字を超えたら」＝厳密に超過）。
const CONFIRM_CHARS = 30000;

// 日本語はおおむね1文字≒1トークンだが、安全側（多め）に見積もるため
// 常に「1文字=1トークン」とみなす（実トークン数はこれより少ないことが多い）。
function estimateTokens(chars) {
  const n = Number(chars);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

// 構成案・本文の2回のAPI呼び出し分の概算費用（円）。
// 参考資料は2回とも丸ごと送るため入力トークンは chars 相当かかる。生成される文章量も
// 参考資料と同程度になり得るという前提で出力トークンも同数と見て、安全側（多め）に見積もる。
function estimateYen(chars) {
  const tokens = estimateTokens(chars);
  const perCallJpy = estimateCostJpy({ inputTokens: tokens, outputTokens: tokens });
  return perCallJpy * 2; // 構成案 + 本文
}

function needsConfirm(chars) {
  return (Number(chars) || 0) > CONFIRM_CHARS;
}

module.exports = { CONFIRM_CHARS, estimateTokens, estimateYen, needsConfirm };
