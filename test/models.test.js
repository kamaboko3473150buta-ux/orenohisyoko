const test = require('node:test');
const assert = require('node:assert');
const {
  MODELS, FEATURES, DEFAULT_MODEL_ID, findModel, findFeature, costUsd, costJpy,
} = require('../src/main/models');

test('MODELSに3つのモデルがある', () => {
  assert.strictEqual(MODELS.length, 3);
  assert.deepStrictEqual(MODELS.map((m) => m.id), ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
});

test('FEATURESに3つの機能があり、既定モデルを持つ', () => {
  assert.strictEqual(FEATURES.length, 3);
  assert.strictEqual(findFeature('mail').defaultModel, 'claude-opus-5');
  assert.strictEqual(findFeature('task').defaultModel, 'claude-opus-5');
  assert.strictEqual(findFeature('docgen').defaultModel, 'claude-sonnet-5');
});

test('DEFAULT_MODEL_IDはOpus 5', () => {
  assert.strictEqual(DEFAULT_MODEL_ID, 'claude-opus-5');
});

test('findModel: 存在するIDでそのモデルが返る', () => {
  assert.strictEqual(findModel('claude-sonnet-5').label, 'Sonnet 5');
  assert.strictEqual(findModel('claude-haiku-4-5').label, 'Haiku 4.5');
});

test('findModel: 未知のID・未指定ではOpus 5が返る', () => {
  assert.strictEqual(findModel('no-such-model').id, 'claude-opus-5');
  assert.strictEqual(findModel(undefined).id, 'claude-opus-5');
  assert.strictEqual(findModel(null).id, 'claude-opus-5');
});

test('costUsd: 料金表どおりの単価で計算される', () => {
  assert.strictEqual(costUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 }), 5);
  assert.strictEqual(costUsd('claude-opus-5', { inputTokens: 0, outputTokens: 1_000_000 }), 25);
  assert.strictEqual(costUsd('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 }), 2);
  assert.strictEqual(costUsd('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 0 }), 1);
});

test('costUsd: usage未指定・壊れた値でも落ちずに0扱いになる', () => {
  assert.strictEqual(costUsd('claude-opus-5'), 0);
  assert.strictEqual(costUsd('claude-opus-5', {}), 0);
  assert.strictEqual(costUsd('claude-opus-5', { inputTokens: 'abc', outputTokens: null }), 0);
});

test('costJpy: 同じトークン数でもOpus > Sonnet > Haikuの順になる', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  const opus = costJpy('claude-opus-5', usage);
  const sonnet = costJpy('claude-sonnet-5', usage);
  const haiku = costJpy('claude-haiku-4-5', usage);
  assert.ok(opus > sonnet, 'OpusはSonnetより高い');
  assert.ok(sonnet > haiku, 'SonnetはHaikuより高い');
});

test('costJpy: 未知のモデルIDはOpus 5の料金で計算される', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  assert.strictEqual(costJpy('no-such-model', usage), costJpy('claude-opus-5', usage));
});
