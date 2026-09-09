const test = require('node:test');
const assert = require('node:assert');
const {
  MODELS, FEATURES, DEFAULT_MODEL_ID, findModel, findFeature, costUsd, costJpy, warningFor,
} = require('../src/main/models');

test('MODELSに4つのモデルがある', () => {
  assert.strictEqual(MODELS.length, 4);
  assert.deepStrictEqual(MODELS.map((m) => m.id), ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
});

test('FEATURESに5つの機能があり、既定モデルを持つ', () => {
  assert.strictEqual(FEATURES.length, 5);
  assert.strictEqual(findFeature('mail').defaultModel, 'claude-opus-5');
  assert.strictEqual(findFeature('task').defaultModel, 'claude-opus-5');
  assert.strictEqual(findFeature('docgen').defaultModel, 'claude-sonnet-5');
  assert.strictEqual(findFeature('translate').defaultModel, 'claude-sonnet-5');
  // 見出しを選んで短くするだけの仕事なので、賢いモデルを当てても結果は変わらない
  assert.strictEqual(findFeature('news').defaultModel, 'claude-haiku-4-5');
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

// Task 40: プロンプトキャッシュ（キャッシュ読みは入力の0.1倍、書き込みは1.25倍）
test('costUsd: キャッシュ読みは入力の0.1倍で計算される', () => {
  // Opus 5の入力は$5/1M。1Mトークンをキャッシュ読みすると$5 * 0.1 = $0.5
  assert.strictEqual(
    costUsd('claude-opus-5', { cacheReadTokens: 1_000_000 }),
    0.5,
  );
});

test('costUsd: キャッシュ書き込みは入力の1.25倍で計算される', () => {
  // Opus 5の入力は$5/1M。1Mトークンをキャッシュ書き込みすると$5 * 1.25 = $6.25
  assert.strictEqual(
    costUsd('claude-opus-5', { cacheCreationTokens: 1_000_000 }),
    6.25,
  );
});

test('costUsd: 通常入力・キャッシュ読み・キャッシュ書き込み・出力をすべて合算する', () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
  };
  // Opus 5: 入力5 + 出力25 + 読み(5*0.1=0.5) + 書き込み(5*1.25=6.25) = 36.75
  assert.strictEqual(costUsd('claude-opus-5', usage), 5 + 25 + 0.5 + 6.25);
});

test('costUsd: キャッシュ項目が無い（旧データ）usageでも落ちずに0扱いになる', () => {
  assert.strictEqual(
    costUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 }),
    5,
  );
});

test('costUsd: キャッシュ項目が壊れた値でも落ちずに0扱いになる', () => {
  assert.strictEqual(
    costUsd('claude-opus-5', { cacheReadTokens: 'abc', cacheCreationTokens: null }),
    0,
  );
});

test('既定より高いモデルを選んだときだけ確認文を出す', () => {
  // 「2倍」の数字は単価から組み立てる。単価を直したとき文言だけ古い数字で残らないように。
  assert.strictEqual(warningFor('claude-fable-5-1'), 'Fable 5.1はOpus 5の2倍の費用感です。切り替えてよいですか?');

  // 既定と同じ・既定より安いものは黙って選ばせる（毎回確認が出ると邪魔になる）
  assert.strictEqual(warningFor('claude-opus-5'), '');
  assert.strictEqual(warningFor('claude-sonnet-5'), '');
  assert.strictEqual(warningFor('claude-haiku-4-5'), '');
  assert.strictEqual(warningFor('知らないモデル'), '', '未知のIDは既定に倒れるので確認は要らない');
});

test('確認を出すモデルは、実際に既定より高い', () => {
  const base = MODELS.find((m) => m.id === DEFAULT_MODEL_ID);
  for (const m of MODELS) {
    const warned = warningFor(m.id) !== '';
    const pricier = m.inputUsd > base.inputUsd || m.outputUsd > base.outputUsd;
    assert.strictEqual(warned, pricier, `${m.label} の確認文と単価が食い違っている`);
  }
});

test('Fable 5.1 の費用は Opus 5 のちょうど2倍', () => {
  const usage = { inputTokens: 100000, outputTokens: 20000 };
  assert.strictEqual(costUsd('claude-fable-5-1', usage), costUsd('claude-opus-5', usage) * 2);
});
