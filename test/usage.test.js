const test = require('node:test');
const assert = require('node:assert');
const {
  monthKey, migrate, addUsage, summarize,
} = require('../src/main/usage');
const { costJpy } = require('../src/main/models');

test('月キーがYYYY-MM形式になる', () => {
  assert.strictEqual(monthKey(new Date(2026, 8, 4)), '2026-09'); // 月は0始まりなので8=9月
});

test('migrate: 旧形式（モデル別でない月別カウント）をOpus 5の利用として移行する', () => {
  const old = { '2026-09': { count: 3, inputTokens: 300, outputTokens: 150 } };
  const migrated = migrate(old);
  assert.strictEqual(migrated.version, 2);
  assert.deepStrictEqual(migrated.months['2026-09'], {
    'claude-opus-5': { count: 3, inputTokens: 300, outputTokens: 150 },
  });
});

test('migrate: 複数月ある旧形式でも、件数・トークンが保たれたまま移行する', () => {
  const old = {
    '2026-08': { count: 1, inputTokens: 100, outputTokens: 50 },
    '2026-09': { count: 2, inputTokens: 200, outputTokens: 90 },
  };
  const migrated = migrate(old);
  assert.strictEqual(migrated.months['2026-08']['claude-opus-5'].count, 1);
  assert.strictEqual(migrated.months['2026-09']['claude-opus-5'].inputTokens, 200);
});

test('migrate: 新形式をもう一度migateしても壊れない（冪等）', () => {
  const once = migrate({ '2026-09': { count: 1, inputTokens: 10, outputTokens: 5 } });
  const twice = migrate(once);
  assert.deepStrictEqual(twice, once);
});

test('migrate: null・undefined・壊れたデータでも落ちない', () => {
  assert.deepStrictEqual(migrate(null), { version: 2, months: {} });
  assert.deepStrictEqual(migrate(undefined), { version: 2, months: {} });
  assert.deepStrictEqual(migrate([1, 2, 3]), { version: 2, months: {} });
  assert.deepStrictEqual(migrate('broken'), { version: 2, months: {} });
  assert.deepStrictEqual(migrate({ '2026-09': null }), { version: 2, months: {} });
  assert.deepStrictEqual(migrate({ 'not-a-month': { count: 1 } }), { version: 2, months: {} });
});

test('addUsage: 1回足すと当月・そのモデルのcountが1、トークンが加算される', () => {
  const store = addUsage({}, { model: 'claude-sonnet-5', inputTokens: 100, outputTokens: 50 }, new Date(2026, 8, 4));
  assert.strictEqual(store.months['2026-09']['claude-sonnet-5'].count, 1);
  assert.strictEqual(store.months['2026-09']['claude-sonnet-5'].inputTokens, 100);
  assert.strictEqual(store.months['2026-09']['claude-sonnet-5'].outputTokens, 50);
});

test('addUsage: modelを省略するとOpus 5として記録される', () => {
  const store = addUsage({}, { inputTokens: 10, outputTokens: 5 }, new Date(2026, 8, 4));
  assert.strictEqual(store.months['2026-09']['claude-opus-5'].count, 1);
});

test('addUsage: 同じ月に複数モデルが並存できる', () => {
  let store = addUsage({}, { model: 'claude-opus-5', inputTokens: 100, outputTokens: 50 }, new Date(2026, 8, 4));
  store = addUsage(store, { model: 'claude-haiku-4-5', inputTokens: 20, outputTokens: 10 }, new Date(2026, 8, 10));
  assert.strictEqual(store.months['2026-09']['claude-opus-5'].count, 1);
  assert.strictEqual(store.months['2026-09']['claude-haiku-4-5'].count, 1);
  assert.strictEqual(store.months['2026-09']['claude-haiku-4-5'].inputTokens, 20);
});

test('addUsage: 同じ月・同じモデルにもう1回足すと積み上がる', () => {
  let store = addUsage({}, { model: 'claude-sonnet-5', inputTokens: 100, outputTokens: 50 }, new Date(2026, 8, 4));
  store = addUsage(store, { model: 'claude-sonnet-5', inputTokens: 20, outputTokens: 10 }, new Date(2026, 8, 10));
  assert.strictEqual(store.months['2026-09']['claude-sonnet-5'].count, 2);
  assert.strictEqual(store.months['2026-09']['claude-sonnet-5'].inputTokens, 120);
  assert.strictEqual(store.months['2026-09']['claude-sonnet-5'].outputTokens, 60);
});

test('addUsage: 別の月をまたいでも前月の記録が消えない', () => {
  let store = addUsage({}, { inputTokens: 100, outputTokens: 50 }, new Date(2026, 7, 1)); // 8月
  store = addUsage(store, { inputTokens: 30, outputTokens: 20 }, new Date(2026, 8, 1)); // 9月
  assert.strictEqual(store.months['2026-08']['claude-opus-5'].count, 1);
  assert.strictEqual(store.months['2026-09']['claude-opus-5'].count, 1);
});

test('addUsage: 旧形式のstoreに足しても、旧データが消えずOpus 5として引き継がれる', () => {
  const old = { '2026-09': { count: 1, inputTokens: 100, outputTokens: 50 } };
  const store = addUsage(old, { model: 'claude-opus-5', inputTokens: 10, outputTokens: 5 }, new Date(2026, 8, 4));
  assert.strictEqual(store.months['2026-09']['claude-opus-5'].count, 2);
  assert.strictEqual(store.months['2026-09']['claude-opus-5'].inputTokens, 110);
});

test('addUsage: 空・nullのstoreを渡しても落ちない', () => {
  assert.strictEqual(addUsage(null, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 8, 1)).months['2026-09']['claude-opus-5'].count, 1);
  assert.strictEqual(addUsage(undefined, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 8, 1)).months['2026-09']['claude-opus-5'].count, 1);
  assert.strictEqual(addUsage({}, {}, new Date(2026, 8, 1)).months['2026-09']['claude-opus-5'].inputTokens, 0);
});

test('summarizeが当月分を返し、記録が無い月でも0の器を返す', () => {
  const s = summarize({}, new Date(2026, 8, 4));
  assert.strictEqual(s.current.month, '2026-09');
  assert.strictEqual(s.current.count, 0);
  assert.strictEqual(s.current.inputTokens, 0);
  assert.strictEqual(s.current.outputTokens, 0);
  assert.strictEqual(s.current.costJpy, 0);
  assert.deepStrictEqual(s.current.byModel, {});
});

test('summarizeは記録がある当月分もそのまま返す', () => {
  const store = addUsage({}, { model: 'claude-sonnet-5', inputTokens: 100, outputTokens: 50 }, new Date(2026, 8, 4));
  const s = summarize(store, new Date(2026, 8, 20));
  assert.strictEqual(s.current.count, 1);
  assert.strictEqual(s.current.inputTokens, 100);
  assert.strictEqual(s.current.byModel['claude-sonnet-5'].count, 1);
});

test('summarizeの月並びが新しい順', () => {
  let store = addUsage({}, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 6, 1)); // 7月
  store = addUsage(store, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 8, 1)); // 9月
  store = addUsage(store, { inputTokens: 1, outputTokens: 1 }, new Date(2026, 7, 1)); // 8月
  const s = summarize(store, new Date(2026, 8, 4));
  assert.deepStrictEqual(s.months.map((m) => m.month), ['2026-09', '2026-08', '2026-07']);
});

test('summarizeは累計も返す（モデルをまたいで合算）', () => {
  let store = addUsage({}, { model: 'claude-opus-5', inputTokens: 100, outputTokens: 50 }, new Date(2026, 7, 1));
  store = addUsage(store, { model: 'claude-haiku-4-5', inputTokens: 200, outputTokens: 100 }, new Date(2026, 8, 1));
  const s = summarize(store, new Date(2026, 8, 4));
  assert.strictEqual(s.total.count, 2);
  assert.strictEqual(s.total.inputTokens, 300);
  assert.strictEqual(s.total.outputTokens, 150);
  assert.strictEqual(s.total.byModel['claude-opus-5'].count, 1);
  assert.strictEqual(s.total.byModel['claude-haiku-4-5'].count, 1);
});

test('summarizeにnull/undefinedのstoreを渡しても落ちない', () => {
  assert.strictEqual(summarize(null, new Date(2026, 8, 4)).current.count, 0);
  assert.strictEqual(summarize(undefined, new Date(2026, 8, 4)).total.count, 0);
});

test('summarizeにも旧形式のstoreをそのまま渡せる（保存先が移行済みでなくても表示できる）', () => {
  const old = { '2026-09': { count: 5, inputTokens: 500, outputTokens: 250 } };
  const s = summarize(old, new Date(2026, 8, 4));
  assert.strictEqual(s.current.count, 5);
  assert.strictEqual(s.current.byModel['claude-opus-5'].count, 5);
});

test('summarizeの費用は、モデルごとの単価で計算される（同じトークン数でもHaikuのほうが安い）', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  const opusStore = addUsage({}, { model: 'claude-opus-5', ...usage }, new Date(2026, 8, 4));
  const haikuStore = addUsage({}, { model: 'claude-haiku-4-5', ...usage }, new Date(2026, 8, 4));
  const opusSummary = summarize(opusStore, new Date(2026, 8, 4));
  const haikuSummary = summarize(haikuStore, new Date(2026, 8, 4));
  assert.ok(opusSummary.current.costJpy > haikuSummary.current.costJpy);
  assert.strictEqual(opusSummary.current.costJpy, costJpy('claude-opus-5', usage));
  assert.strictEqual(haikuSummary.current.costJpy, costJpy('claude-haiku-4-5', usage));
});

test('summarizeのbyModelの費用は、複数モデルが並存していても各モデルの単価で計算される', () => {
  let store = addUsage({}, { model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 0 }, new Date(2026, 8, 4));
  store = addUsage(store, { model: 'claude-haiku-4-5', inputTokens: 1_000_000, outputTokens: 0 }, new Date(2026, 8, 4));
  const s = summarize(store, new Date(2026, 8, 4));
  assert.strictEqual(s.current.byModel['claude-opus-5'].costJpy, costJpy('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 }));
  assert.strictEqual(s.current.byModel['claude-haiku-4-5'].costJpy, costJpy('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 0 }));
  assert.strictEqual(
    s.current.costJpy,
    s.current.byModel['claude-opus-5'].costJpy + s.current.byModel['claude-haiku-4-5'].costJpy,
  );
});
