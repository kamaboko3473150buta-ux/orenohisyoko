const test = require('node:test');
const assert = require('node:assert');
const { monthKey, addUsage, estimateCostUsd, estimateCostJpy, summarize } = require('../src/main/usage');

test('月キーがYYYY-MM形式になる', () => {
  assert.strictEqual(monthKey(new Date(2026, 8, 4)), '2026-09'); // 月は0始まりなので8=9月
});

test('1回足すと当月のcountが1、トークンが加算される', () => {
  const store = addUsage({}, { inputTokens: 100, outputTokens: 50 }, new Date(2026, 8, 4));
  assert.strictEqual(store['2026-09'].count, 1);
  assert.strictEqual(store['2026-09'].inputTokens, 100);
  assert.strictEqual(store['2026-09'].outputTokens, 50);
});

test('同じ月にもう1回足すと積み上がる', () => {
  let store = addUsage({}, { inputTokens: 100, outputTokens: 50 }, new Date(2026, 8, 4));
  store = addUsage(store, { inputTokens: 20, outputTokens: 10 }, new Date(2026, 8, 10));
  assert.strictEqual(store['2026-09'].count, 2);
  assert.strictEqual(store['2026-09'].inputTokens, 120);
  assert.strictEqual(store['2026-09'].outputTokens, 60);
});

test('別の月をまたいでも前月の記録が消えない', () => {
  let store = addUsage({}, { inputTokens: 100, outputTokens: 50 }, new Date(2026, 7, 1)); // 8月
  store = addUsage(store, { inputTokens: 30, outputTokens: 20 }, new Date(2026, 8, 1)); // 9月
  assert.strictEqual(store['2026-08'].count, 1);
  assert.strictEqual(store['2026-08'].inputTokens, 100);
  assert.strictEqual(store['2026-09'].count, 1);
  assert.strictEqual(store['2026-09'].inputTokens, 30);
});

test('空・nullのstoreを渡しても落ちない', () => {
  assert.strictEqual(addUsage(null, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 8, 1))['2026-09'].count, 1);
  assert.strictEqual(addUsage(undefined, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 8, 1))['2026-09'].count, 1);
  assert.strictEqual(addUsage({}, {}, new Date(2026, 8, 1))['2026-09'].inputTokens, 0);
});

test('費用計算が料金表どおり(入力100万トークンで$5)', () => {
  assert.strictEqual(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }), 5);
});

test('費用計算が料金表どおり(出力100万トークンで$25)', () => {
  assert.strictEqual(estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000 }), 25);
});

test('円換算はUSDに一定の換算レートを掛けたもので、トークン数に比例する', () => {
  const usage1x = { inputTokens: 1_000_000, outputTokens: 0 };
  const usage2x = { inputTokens: 2_000_000, outputTokens: 0 };
  const rate = estimateCostJpy(usage1x) / estimateCostUsd(usage1x);
  assert.ok(rate > 1, '円のほうが数値としては大きい換算レートになる');
  assert.strictEqual(estimateCostJpy(usage2x), estimateCostJpy(usage1x) * 2, 'トークン数に比例する');
  assert.strictEqual(estimateCostJpy(usage1x), estimateCostUsd(usage1x) * rate);
});

test('summarizeが当月分を返し、記録が無い月でも0の器を返す', () => {
  const s = summarize({}, new Date(2026, 8, 4));
  assert.strictEqual(s.current.month, '2026-09');
  assert.strictEqual(s.current.count, 0);
  assert.strictEqual(s.current.inputTokens, 0);
  assert.strictEqual(s.current.outputTokens, 0);
});

test('summarizeは記録がある当月分もそのまま返す', () => {
  const store = addUsage({}, { inputTokens: 100, outputTokens: 50 }, new Date(2026, 8, 4));
  const s = summarize(store, new Date(2026, 8, 20));
  assert.strictEqual(s.current.count, 1);
  assert.strictEqual(s.current.inputTokens, 100);
});

test('summarizeの月並びが新しい順', () => {
  let store = addUsage({}, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 6, 1)); // 7月
  store = addUsage(store, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 8, 1)); // 9月
  store = addUsage(store, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 7, 1)); // 8月
  const s = summarize(store, new Date(2026, 8, 4));
  assert.deepStrictEqual(s.months.map((m) => m.month), ['2026-09', '2026-08', '2026-07']);
});

test('summarizeは累計も返す', () => {
  let store = addUsage({}, { inputTokens: 100, outputTokens: 50 }, new Date(2026, 7, 1));
  store = addUsage(store, { inputTokens: 200, outputTokens: 100 }, new Date(2026, 8, 1));
  const s = summarize(store, new Date(2026, 8, 4));
  assert.strictEqual(s.total.count, 2);
  assert.strictEqual(s.total.inputTokens, 300);
  assert.strictEqual(s.total.outputTokens, 150);
});

test('summarizeにnull/undefinedのstoreを渡しても落ちない', () => {
  assert.strictEqual(summarize(null, new Date(2026, 8, 4)).current.count, 0);
  assert.strictEqual(summarize(undefined, new Date(2026, 8, 4)).total.count, 0);
});
