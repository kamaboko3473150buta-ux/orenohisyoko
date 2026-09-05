const test = require('node:test');
const assert = require('node:assert');
const { CONFIRM_CHARS, estimateTokens, estimateYen, needsConfirm } = require('../src/main/docgen/estimate');

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

test('estimateYen: 文字数が2倍なら金額も2倍になる（比例関係）', () => {
  const y1 = estimateYen(5000);
  const y2 = estimateYen(10000);
  assert.strictEqual(y2, y1 * 2);
});

test('needsConfirm: CONFIRM_CHARSちょうどはfalse、1文字超えるとtrueになる', () => {
  assert.strictEqual(needsConfirm(CONFIRM_CHARS), false);
  assert.strictEqual(needsConfirm(CONFIRM_CHARS + 1), true);
  assert.strictEqual(needsConfirm(0), false);
});

test('needsConfirm: CONFIRM_CHARSは3万字', () => {
  assert.strictEqual(CONFIRM_CHARS, 30000);
});
