const test = require('node:test');
const assert = require('node:assert');
const {
  CONFIRM_CHARS, CACHE_MIN_TOKENS, estimateTokens, estimateYen, needsConfirm,
} = require('../src/main/docgen/estimate');
const { costJpy } = require('../src/main/models');

test('estimateTokens: 1文字=1トークンとみなす', () => {
  assert.strictEqual(estimateTokens(100), 100);
  assert.strictEqual(estimateTokens(0), 0);
});

test('estimateTokens: 負数・NaN・未指定でも0になる（例外を投げない）', () => {
  assert.strictEqual(estimateTokens(-5), 0);
  assert.strictEqual(estimateTokens(NaN), 0);
  assert.strictEqual(estimateTokens(undefined), 0);
  assert.strictEqual(estimateTokens(null), 0);
});

test('estimateYen: 文字数0で0円', () => {
  assert.strictEqual(estimateYen(0), 0);
});

test('estimateYen: 文字数が増えるほど概算金額も増える', () => {
  assert.ok(estimateYen(10000) > 0);
  assert.ok(estimateYen(20000) > estimateYen(10000));
});

test('estimateYen: 参考資料が無くても、資料を書く分の費用はかかる', () => {
  // 出力トークン（＝出来上がる資料）の分は、参考資料の大きさに関係なくかかる
  assert.ok(estimateYen(1) > 0);
});

test('estimateYen: 参考資料が2倍でも金額は2倍にならない（出力分は増えないため）', () => {
  const y1 = estimateYen(10000);
  const y2 = estimateYen(20000);
  assert.ok(y2 > y1, '増えはする');
  assert.ok(y2 < y1 * 2, '2倍未満に収まる');
});

test('needsConfirm: CONFIRM_CHARSちょうどはfalse、1文字超えるとtrueになる', () => {
  assert.strictEqual(needsConfirm(CONFIRM_CHARS), false);
  assert.strictEqual(needsConfirm(CONFIRM_CHARS + 1), true);
  assert.strictEqual(needsConfirm(0), false);
});

test('needsConfirm: CONFIRM_CHARSは3万字', () => {
  assert.strictEqual(CONFIRM_CHARS, 30000);
});

test('estimateYen: モデルを指定すると、そのモデルの単価で計算される（Haikuの方が安い）', () => {
  const sonnet = estimateYen(10000, 'claude-sonnet-5');
  const opus = estimateYen(10000, 'claude-opus-5');
  const haiku = estimateYen(10000, 'claude-haiku-4-5');
  assert.ok(opus > sonnet, 'OpusはSonnetより高い');
  assert.ok(sonnet > haiku, 'SonnetはHaikuより高い');
});

test('estimateYen: モデル省略時は資料作成の既定（Sonnet 5）で計算される', () => {
  assert.strictEqual(estimateYen(10000), estimateYen(10000, 'claude-sonnet-5'));
});

// Task 40: プロンプトキャッシュ。参考資料が大きいとき、2回目（本文）の入力をキャッシュ読みとして
// 概算し、キャッシュ無しより安くなることを確認する。
test('CACHE_MIN_TOKENSはおおよそ2000トークン', () => {
  assert.strictEqual(CACHE_MIN_TOKENS, 2000);
});

test('estimateYen: キャッシュが効く大きさの資料は、キャッシュ無しの計算より安くなる', () => {
  const modelId = 'claude-sonnet-5';
  const chars = 50000; // CACHE_MIN_TOKENSを大きく超える
  const src = chars; // estimateTokensは1文字=1トークン扱い

  // 旧来（キャッシュ無し）の計算を、テスト側でそのまま再現する。
  const OUTLINE_OUTPUT_TOKENS = 1200;
  const BODY_OUTPUT_TOKENS = 5000;
  const PROMPT_OVERHEAD_TOKENS = 600;
  const noCacheTotal = costJpy(modelId, {
    inputTokens: src + PROMPT_OVERHEAD_TOKENS,
    outputTokens: OUTLINE_OUTPUT_TOKENS,
  }) + costJpy(modelId, {
    inputTokens: src + PROMPT_OVERHEAD_TOKENS + OUTLINE_OUTPUT_TOKENS,
    outputTokens: BODY_OUTPUT_TOKENS,
  });

  const withCache = estimateYen(chars, modelId);
  assert.ok(withCache > 0);
  assert.ok(withCache < noCacheTotal, `キャッシュ有り(${withCache})がキャッシュ無し(${noCacheTotal})より安いはず`);
});

test('estimateYen: CACHE_MIN_TOKENS未満の小さい資料はキャッシュが効かない前提で計算される（旧来と同じ）', () => {
  const modelId = 'claude-sonnet-5';
  const chars = CACHE_MIN_TOKENS - 1;
  const src = chars;

  const OUTLINE_OUTPUT_TOKENS = 1200;
  const BODY_OUTPUT_TOKENS = 5000;
  const PROMPT_OVERHEAD_TOKENS = 600;
  const expected = costJpy(modelId, {
    inputTokens: src + PROMPT_OVERHEAD_TOKENS,
    outputTokens: OUTLINE_OUTPUT_TOKENS,
  }) + costJpy(modelId, {
    inputTokens: src + PROMPT_OVERHEAD_TOKENS + OUTLINE_OUTPUT_TOKENS,
    outputTokens: BODY_OUTPUT_TOKENS,
  });

  assert.strictEqual(estimateYen(chars, modelId), expected);
});

test('estimateYen: ちょうどCACHE_MIN_TOKENSではキャッシュが効く計算になる（旧来より安い）', () => {
  const modelId = 'claude-sonnet-5';
  const chars = CACHE_MIN_TOKENS;
  const src = chars;

  const OUTLINE_OUTPUT_TOKENS = 1200;
  const BODY_OUTPUT_TOKENS = 5000;
  const PROMPT_OVERHEAD_TOKENS = 600;
  const noCacheTotal = costJpy(modelId, {
    inputTokens: src + PROMPT_OVERHEAD_TOKENS,
    outputTokens: OUTLINE_OUTPUT_TOKENS,
  }) + costJpy(modelId, {
    inputTokens: src + PROMPT_OVERHEAD_TOKENS + OUTLINE_OUTPUT_TOKENS,
    outputTokens: BODY_OUTPUT_TOKENS,
  });

  assert.ok(estimateYen(chars, modelId) < noCacheTotal);
});
