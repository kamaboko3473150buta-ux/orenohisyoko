const test = require('node:test');
const assert = require('node:assert');
const prompt = require('../src/main/docgen/prompt');
const { buildUserContent } = require('../src/main/claude');
const { buildSourcesCachePrefix } = require('../src/main/docgen');

// プロンプトキャッシュは system から前方一致で判定される。
// 構成案と本文で system が1文字でも違うと、参考資料のキャッシュが一度も当たらず、
// 書き込み料金（入力の1.25倍）だけ余計に払うことになる。
// しかも動作は正常なので画面上は何も起きず、請求だけが増える。気づけない不具合なので
// ここで縛る。プロンプトを直すときは、段階ごとの違いを user 側の後半に置くこと。

const SOURCES = [
  { name: '文字起こし.txt', text: 'あ'.repeat(3000) },
  { name: '前回議事録.docx', text: 'い'.repeat(2000) },
];

test('通常資料: 構成案と本文の system がまったく同じ', () => {
  for (const typeId of ['report', 'minutes', 'internal', 'handover']) {
    assert.strictEqual(
      prompt.buildOutlineSystemPrompt(typeId),
      prompt.buildBodySystemPrompt(typeId),
      `${typeId} の system が違う`,
    );
  }
});

test('プレゼン: 構成案と本文の system がまったく同じ', () => {
  assert.strictEqual(
    prompt.buildSlideOutlineSystemPrompt(),
    prompt.buildSlideBodySystemPrompt(),
  );
});

test('通常資料: キャッシュに載る先頭ブロックが2回とも同じになる', () => {
  const cachePrefix = buildSourcesCachePrefix(SOURCES);
  const outline = buildUserContent(
    prompt.buildOutlineUserPrompt({ typeId: 'minutes', brief: 'b', sources: SOURCES, today: '2026-09-06' }),
    cachePrefix,
  );
  const body = buildUserContent(
    prompt.buildBodyUserPrompt({
      typeId: 'minutes', brief: 'b', sources: SOURCES, today: '2026-09-06',
      outline: { title: 'T', sections: [{ heading: 'h', points: ['p'] }] },
    }),
    cachePrefix,
  );

  assert.ok(Array.isArray(outline) && Array.isArray(body), '配列に分かれている');
  assert.strictEqual(outline[0].text, body[0].text, '先頭ブロックが一致する');
  assert.strictEqual(outline[0].cache_control.type, 'ephemeral', 'キャッシュ指定が付いている');
  assert.notStrictEqual(outline[1].text, body[1].text, '2番目（変わる部分）は違ってよい');
});

test('プレゼン: キャッシュに載る先頭ブロックが2回とも同じになる', () => {
  const cachePrefix = buildSourcesCachePrefix(SOURCES);
  const outline = buildUserContent(
    prompt.buildSlideOutlineUserPrompt({ brief: 'b', sources: SOURCES, imageCount: 3, today: '2026-09-06' }),
    cachePrefix,
  );
  const body = buildUserContent(
    prompt.buildSlideBodyUserPrompt({
      brief: 'b', sources: SOURCES, imageCount: 3, today: '2026-09-06',
      outline: { title: 'T', slides: [{ layout: 'title', heading: 'h' }] },
    }),
    cachePrefix,
  );
  assert.strictEqual(outline[0].text, body[0].text, '先頭ブロックが一致する');
});
