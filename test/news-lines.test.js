// test/news-lines.test.js
// 「今日のニュース」のまとめ文から、行ごとに配信元を引く。
//
// 見出しの文字列で照合すると、AIが言い換えた瞬間に外れる（要約なので必ず言い換える）。
// だからAIには元の番号を付けさせて、番号で引く。
const test = require('node:test');
const assert = require('node:assert');
const lines = require('../src/renderer/news-lines');

test('行頭の番号を取り出し、本文からは取り除く', () => {
  assert.deepStrictEqual(
    lines.parseLine('・[3] 松山市で大雨の予報が出ています。'),
    { text: '・松山市で大雨の予報が出ています。', n: 3 },
  );
  assert.deepStrictEqual(
    lines.parseLine('[12] 「・」が無くても読む'),
    { text: '「・」が無くても読む', n: 12 },
  );
});

test('番号が無い行はそのまま返す（AIが付け忘れても壊れない）', () => {
  assert.deepStrictEqual(
    lines.parseLine('・番号のない行'),
    { text: '・番号のない行', n: null },
  );
  assert.deepStrictEqual(lines.parseLine(''), { text: '', n: null });
  assert.deepStrictEqual(lines.parseLine(null), { text: '', n: null });
});

test('本文の中の [ ] は番号として拾わない（行頭だけを見る）', () => {
  assert.strictEqual(lines.parseLine('・あの件 [1] について').n, null);
});

test('まとめ文を行ごとに分ける', () => {
  const parsed = lines.parseLines('・[1] ひとつめ\n・[2] ふたつめ');
  assert.strictEqual(parsed.length, 2);
  assert.deepStrictEqual(parsed.map((l) => l.n), [1, 2]);
});

test('http(s) 以外は開かない（配信の中身は他人が書いた値）', () => {
  assert.strictEqual(lines.isSafeUrl('https://www3.nhk.or.jp/news/x.html'), true);
  assert.strictEqual(lines.isSafeUrl('http://example.com/a'), true);
  assert.strictEqual(lines.isSafeUrl('file:///C:/Windows/system32'), false);
  assert.strictEqual(lines.isSafeUrl('javascript:alert(1)'), false);
  assert.strictEqual(lines.isSafeUrl(''), false);
  assert.strictEqual(lines.isSafeUrl(null), false);
});

test('番号から配信元を引く。範囲外・壊れた値では空にする', () => {
  const articles = [
    { title: 'A', link: 'https://a.example/1' },
    { title: 'B', link: 'javascript:alert(1)' },
  ];
  assert.strictEqual(lines.linkFor(articles, 1), 'https://a.example/1');
  assert.strictEqual(lines.linkFor(articles, 2), '', '危ないURLは開かない');
  assert.strictEqual(lines.linkFor(articles, 3), '', '範囲外');
  assert.strictEqual(lines.linkFor(articles, 0), '', '番号は1始まり');
  assert.strictEqual(lines.linkFor(articles, null), '');
  assert.strictEqual(lines.linkFor(null, 1), '');
});
