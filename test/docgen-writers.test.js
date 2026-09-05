const test = require('node:test');
const assert = require('node:assert');
const { buildHtml } = require('../src/main/docgen/writers');

// ---- 基本: 見出し・段落・箇条書きがそれぞれのタグになる ----

test('buildHtml: titleがh1、見出しがh2、段落がp、箇条書きがul/liになる', () => {
  const html = buildHtml({
    title: '第12回 定例会議 議事録',
    sections: [
      {
        heading: '決定事項',
        paragraphs: ['A案で進めることになった。'],
        bullets: ['予算は来月確定', '担当は田中'],
      },
    ],
  });
  assert.ok(html.includes('<h1>第12回 定例会議 議事録</h1>'), 'タイトルがh1');
  assert.ok(html.includes('<h2>決定事項</h2>'), 'セクション見出しがh2');
  assert.ok(html.includes('<p>A案で進めることになった。</p>'), '段落がp');
  assert.ok(html.includes('<ul>'), '箇条書きがul');
  assert.ok(html.includes('<li>予算は来月確定</li>'), '箇条書きの項目がli');
  assert.ok(html.includes('<li>担当は田中</li>'));
});

test('buildHtml: 複数セクションを順番通りに出す', () => {
  const html = buildHtml({
    title: 'テスト',
    sections: [
      { heading: '第一部', paragraphs: ['いち'] },
      { heading: '第二部', paragraphs: ['に'] },
    ],
  });
  const idx1 = html.indexOf('第一部');
  const idx2 = html.indexOf('第二部');
  assert.ok(idx1 !== -1 && idx2 !== -1 && idx1 < idx2, 'セクションの順序が保たれる');
});

// ---- HTML特殊文字のエスケープ ----

test('buildHtml: <script>などの特殊文字がエスケープされる（タイトル）', () => {
  const html = buildHtml({ title: '<script>alert(1)</script>', sections: [] });
  assert.ok(!html.includes('<script>alert(1)</script>'), '生のscriptタグが残らない');
  assert.ok(html.includes('&lt;script&gt;'), 'エスケープされた形で入る');
});

test('buildHtml: 段落・箇条書き・見出しの特殊文字がすべてエスケープされる', () => {
  const html = buildHtml({
    title: 'タイトル',
    sections: [
      {
        heading: '<h1>見出し</h1>',
        paragraphs: ['A & B < C > D "quote"'],
        bullets: ['<b>太字</b>'],
      },
    ],
  });
  assert.ok(html.includes('&lt;h1&gt;見出し&lt;/h1&gt;'));
  assert.ok(html.includes('A &amp; B &lt; C &gt; D &quot;quote&quot;'));
  assert.ok(html.includes('&lt;b&gt;太字&lt;/b&gt;'));
  assert.ok(!html.includes('<b>太字</b>'));
});

// ---- 想定外のデータで落ちない ----

test('buildHtml: sectionsが無くても落ちない', () => {
  assert.doesNotThrow(() => buildHtml({ title: 'タイトルのみ' }));
  const html = buildHtml({ title: 'タイトルのみ' });
  assert.ok(html.includes('タイトルのみ'));
});

test('buildHtml: docそのものがundefined/nullでも落ちない', () => {
  assert.doesNotThrow(() => buildHtml(undefined));
  assert.doesNotThrow(() => buildHtml(null));
  assert.doesNotThrow(() => buildHtml({}));
});

test('buildHtml: titleが無くても落ちない', () => {
  const html = buildHtml({ sections: [{ heading: '見出しのみ', paragraphs: [], bullets: [] }] });
  assert.ok(!html.includes('<h1></h1>'), '空のh1は出さない');
  assert.ok(html.includes('<h2>見出しのみ</h2>'));
});

test('buildHtml: bulletsが空配列でもulを出さない', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{ heading: '見出し', paragraphs: ['本文'], bullets: [] }],
  });
  assert.ok(!html.includes('<ul>'), '空の箇条書きはulごと出さない');
});

test('buildHtml: paragraphsに空文字が混ざっても空のpを出さない', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{ heading: '見出し', paragraphs: ['', '  ', '本文のみ'], bullets: [] }],
  });
  assert.ok(!html.includes('<p></p>'), '空文字の段落は出さない');
  assert.ok(html.includes('<p>本文のみ</p>'));
});

test('buildHtml: 見出し・段落・箇条書きが全部空のセクションは出力しない', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{ heading: '', paragraphs: [], bullets: [] }, { heading: '実在', paragraphs: [], bullets: [] }],
  });
  assert.ok(html.includes('<h2>実在</h2>'));
  // 空セクション分の余計な見出しタグが混ざらないことを確認
  const h2Count = (html.match(/<h2>/g) || []).length;
  assert.strictEqual(h2Count, 1);
});

test('buildHtml: sectionsの要素がオブジェクトでなくても落ちない', () => {
  assert.doesNotThrow(() => buildHtml({ title: 'T', sections: ['文字列', null, 123, undefined] }));
});

test('buildHtml: 日本語フォント指定が入っている', () => {
  const html = buildHtml({ title: 'T', sections: [] });
  assert.ok(html.includes('Yu Gothic') || html.includes('Meiryo'), '日本語フォントの指定がある');
});

test('buildHtml: 純粋関数（同じ入力なら同じ出力）', () => {
  const doc = { title: 'T', sections: [{ heading: 'H', paragraphs: ['P'], bullets: ['B'] }] };
  assert.strictEqual(buildHtml(doc), buildHtml(doc));
});
