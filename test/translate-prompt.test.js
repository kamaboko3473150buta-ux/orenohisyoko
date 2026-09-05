const test = require('node:test');
const assert = require('node:assert');
const { LANGUAGES, findLanguage } = require('../src/main/translate/languages');
const {
  buildTranslateSystemPrompt, buildTranslateUserPrompt, parseTranslationJson, chunkItems,
} = require('../src/main/translate/prompt');

// ---- languages.js ----

test('LANGUAGESに一覧が10件あり、それぞれid/labelを持つ', () => {
  assert.strictEqual(LANGUAGES.length, 10);
  for (const l of LANGUAGES) {
    assert.ok(l.id && l.label, `${JSON.stringify(l)}にid/labelがある`);
  }
});

test('findLanguageはidでもlabelでも見つけられる', () => {
  assert.strictEqual(findLanguage('en').label, '英語');
  assert.strictEqual(findLanguage('英語').id, 'en');
  assert.strictEqual(findLanguage('zh-CN').label, '中国語（簡体）');
});

test('findLanguageは見つからなければnull（自由入力を許す）', () => {
  assert.strictEqual(findLanguage('フランス語'), null);
  assert.strictEqual(findLanguage(''), null);
  assert.strictEqual(findLanguage(null), null);
  assert.strictEqual(findLanguage(undefined), null);
});

// ---- buildTranslateSystemPrompt / buildTranslateUserPrompt ----

test('system: JSONのみ・原文自動判定・固有名詞や数値を変えない旨の指示がある', () => {
  const s = buildTranslateSystemPrompt();
  assert.ok(s.includes('JSON'));
  assert.ok(s.includes('自動'));
  assert.ok(s.includes('固有名詞'));
  assert.ok(s.includes('数値'));
});

test('user: 訳したい言語と番号付きの原文が両方入る', () => {
  const u = buildTranslateUserPrompt({ targetLanguage: '英語', items: ['おはよう', 'こんにちは'] });
  assert.ok(u.includes('英語'));
  assert.ok(u.includes('1. おはよう'));
  assert.ok(u.includes('2. こんにちは'));
});

test('user: itemsが0件でも壊れない', () => {
  assert.doesNotThrow(() => buildTranslateUserPrompt({ targetLanguage: '英語', items: [] }));
  assert.doesNotThrow(() => buildTranslateUserPrompt({}));
});

// ---- parseTranslationJson ----

test('parseTranslationJsonは番号どおりに訳文を取り出す', () => {
  const raw = '{"1":"Hello","2":"World"}';
  const { texts, failed } = parseTranslationJson(raw, ['おはよう', '世界']);
  assert.strictEqual(failed, false);
  assert.deepStrictEqual(texts, ['Hello', 'World']);
});

test('parseTranslationJsonは番号が欠けていたら元の原文をそのまま入れる', () => {
  const raw = '{"1":"Hello"}';
  const { texts, failed } = parseTranslationJson(raw, ['おはよう', '世界', 'また明日']);
  assert.strictEqual(failed, false);
  assert.deepStrictEqual(texts, ['Hello', '世界', 'また明日']);
});

test('parseTranslationJsonは前置き・コードフェンス付きでも中のJSONを取り出す', () => {
  const raw = '```json\n{"1":"Hi"}\n```';
  const { texts } = parseTranslationJson(raw, ['やあ']);
  assert.deepStrictEqual(texts, ['Hi']);
});

test('parseTranslationJsonは壊れたJSONでもfailed:trueで例外を投げず、原文を保つ', () => {
  assert.doesNotThrow(() => parseTranslationJson('これはJSONではない', ['原文A', '原文B']));
  const r1 = parseTranslationJson('これはJSONではない', ['原文A', '原文B']);
  assert.strictEqual(r1.failed, true);
  assert.deepStrictEqual(r1.texts, ['原文A', '原文B']);

  const r2 = parseTranslationJson('{壊れたJSON', ['原文A']);
  assert.strictEqual(r2.failed, true);
  assert.deepStrictEqual(r2.texts, ['原文A']);

  const r3 = parseTranslationJson('[1,2,3]', ['原文A']);
  assert.strictEqual(r3.failed, true);
  assert.deepStrictEqual(r3.texts, ['原文A']);

  assert.doesNotThrow(() => parseTranslationJson(null, ['原文A']));
  assert.doesNotThrow(() => parseTranslationJson(undefined, undefined));
});

// ---- chunkItems ----

test('chunkItemsは合計文字数がmaxCharsを超えないように分割する', () => {
  const items = ['あ'.repeat(10), 'い'.repeat(10), 'う'.repeat(10)];
  const chunks = chunkItems(items, 15);
  // 1個目だけで10字、2個目を足すと20字でオーバーするので別チャンクに分かれる
  assert.ok(chunks.length >= 2);
  const flat = chunks.flat();
  assert.deepStrictEqual(flat, items, '全item取りこぼしなく含まれる');
});

test('chunkItemsは1件でmaxCharsを超える巨大な項目でも単独チャンクにして残す（取りこぼさない）', () => {
  const huge = 'x'.repeat(100);
  const items = ['短い', huge, '短い2'];
  const chunks = chunkItems(items, 10);
  assert.deepStrictEqual(chunks.flat(), items);
  const chunkWithHuge = chunks.find((c) => c.includes(huge));
  assert.ok(chunkWithHuge, '巨大な項目も失われず1チャンクに入る');
});

test('chunkItemsは空配列・未指定でも例外を投げない', () => {
  assert.doesNotThrow(() => chunkItems([], 100));
  assert.doesNotThrow(() => chunkItems(undefined, 100));
  assert.deepStrictEqual(chunkItems([], 100), []);
});

test('chunkItemsは{index,text}形式のオブジェクト配列でも動く（split結果をそのまま渡せる）', () => {
  const items = [{ index: 0, text: 'A' }, { index: 1, text: 'B' }];
  const chunks = chunkItems(items, 100);
  assert.strictEqual(chunks.length, 1);
  assert.deepStrictEqual(chunks[0], items);
});
