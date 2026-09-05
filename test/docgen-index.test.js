const test = require('node:test');
const assert = require('node:assert');
const { buildSourcesCachePrefix } = require('../src/main/docgen/index');
const { buildOutlineUserPrompt, buildBodyUserPrompt } = require('../src/main/docgen/prompt');
const { buildUserContent } = require('../src/main/claude');

// Task 40: 参考資料の塊をcachePrefixとして渡す。
// prompt.js の formatSources はexportされていないため、docgen/index.js に整形ロジックを
// 複製している（buildSourcesCachePrefix）。ここでは「複製がずれていないか」を、
// 実際に prompt.js が組み立てる文章の中にそのまま含まれているかで確認する
// （文字単位で一致していないと claude.js 側でcachePrefixを見つけられず、
// キャッシュが効かない＝黙って旧来どおりの送り方に戻るだけなので、ここで検出する）。

const SOURCES = [
  { name: '議事録.txt', text: '前回の決定事項について' },
  { name: '資料.docx', text: '売上データの推移' },
];

test('buildSourcesCachePrefix: 参考資料が無ければ空文字（cachePrefixを使わない印）', () => {
  assert.strictEqual(buildSourcesCachePrefix([]), '');
  assert.strictEqual(buildSourcesCachePrefix(undefined), '');
  assert.strictEqual(buildSourcesCachePrefix(null), '');
});

test('buildSourcesCachePrefix: 構成案プロンプトに埋め込まれる参考資料の文言と一致する', () => {
  const prefix = buildSourcesCachePrefix(SOURCES);
  const outlineUser = buildOutlineUserPrompt({
    typeId: 'report', brief: '売上について', sources: SOURCES, today: '2026-09-06',
  });
  assert.ok(prefix.length > 0);
  assert.ok(outlineUser.includes(prefix), '構成案プロンプトの中にcachePrefixがそのまま含まれる');
});

test('buildSourcesCachePrefix: 本文プロンプトに埋め込まれる参考資料の文言とも一致する', () => {
  const prefix = buildSourcesCachePrefix(SOURCES);
  const bodyUser = buildBodyUserPrompt({
    typeId: 'report',
    brief: '売上について',
    sources: SOURCES,
    outline: { title: 't', sections: [{ heading: '結論', points: ['増収'] }] },
    today: '2026-09-06',
  });
  assert.ok(bodyUser.includes(prefix), '本文プロンプトの中にもcachePrefixがそのまま含まれる');
});

test('buildSourcesCachePrefix + buildUserContent: 構成案・本文どちらのプロンプトでも実際にキャッシュブロックへ分離できる', () => {
  const prefix = buildSourcesCachePrefix(SOURCES);

  const outlineUser = buildOutlineUserPrompt({
    typeId: 'report', brief: '売上について', sources: SOURCES, today: '2026-09-06',
  });
  const outlineContent = buildUserContent(outlineUser, prefix);
  assert.ok(Array.isArray(outlineContent), '構成案の呼び出しでキャッシュブロックに分離される');
  assert.strictEqual(outlineContent[0].text, prefix);
  assert.deepStrictEqual(outlineContent[0].cache_control, { type: 'ephemeral' });

  const bodyUser = buildBodyUserPrompt({
    typeId: 'report',
    brief: '売上について',
    sources: SOURCES,
    outline: { title: 't', sections: [{ heading: '結論', points: ['増収'] }] },
    today: '2026-09-06',
  });
  const bodyContent = buildUserContent(bodyUser, prefix);
  assert.ok(Array.isArray(bodyContent), '本文の呼び出しでもキャッシュブロックに分離される');
  assert.strictEqual(bodyContent[0].text, prefix);

  // 参考資料の中身（本文テキスト）が、キャッシュブロックに1回だけ含まれ、
  // 残りのブロックには重複して残っていないこと（二重送信によるコスト増を防ぐ）。
  for (const s of SOURCES) {
    const total = (outlineContent[0].text + outlineContent[1].text).split(s.text).length - 1;
    assert.strictEqual(total, 1, `${s.text} が1回だけ含まれる`);
  }
});

test('buildSourcesCachePrefix: 参考資料が無いときはbuildUserContentもこれまでどおり文字列のまま', () => {
  const prefix = buildSourcesCachePrefix([]);
  const outlineUser = buildOutlineUserPrompt({
    typeId: 'report', brief: '売上について', sources: [], today: '2026-09-06',
  });
  const content = buildUserContent(outlineUser, prefix);
  assert.strictEqual(content, outlineUser);
});
