// test/news.test.js
// 「今日のニュース」。RSSから見出しだけを取り、AIには選別と要約だけを任せる。
// 記事本文を文脈に入れると費用が10倍変わるので、本文を渡さないことが要点。
const test = require('node:test');
const assert = require('node:assert');
const rss = require('../src/main/news/rss');
const feeds = require('../src/main/news/feeds');

const SAMPLE_RSS = `<?xml version="1.0"?><rss><channel>
<title>NHK 主要</title>
<item>
  <title><![CDATA[高市首相 消費税減税へ調整指示]]></title>
  <link>https://example.com/a</link>
  <description>政府は&lt;b&gt;来年度&lt;/b&gt;の税制改正に向けて…</description>
  <pubDate>Mon, 08 Sep 2026 09:00:00 +0900</pubDate>
</item>
<item>
  <title>愛媛県で線状降水帯の予測</title>
  <link>https://example.com/b</link>
  <pubDate>Mon, 08 Sep 2026 07:00:00 +0900</pubDate>
</item>
</channel></rss>`;

const SAMPLE_ATOM = `<feed><entry>
  <title>Atom形式の見出し</title>
  <link rel="alternate" href="https://example.com/c"/>
  <summary>要約です</summary>
  <updated>2026-09-08T10:00:00+09:00</updated>
</entry></feed>`;

test('RSSから見出し・リンク・日時を取り出す', () => {
  const list = rss.parseFeed(SAMPLE_RSS, 'NHK');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].title, '高市首相 消費税減税へ調整指示', 'CDATAを外す');
  assert.strictEqual(list[0].link, 'https://example.com/a');
  assert.strictEqual(list[0].summary, '政府は来年度の税制改正に向けて…', 'タグと実体参照を戻す');
  assert.strictEqual(list[0].source, 'NHK');
  assert.strictEqual(list[1].summary, '', '要約が無くても落ちない');
});

test('Atom形式も読める（リンクは属性に入っている）', () => {
  const list = rss.parseFeed(SAMPLE_ATOM, 'どこか');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].link, 'https://example.com/c');
  assert.strictEqual(list[0].title, 'Atom形式の見出し');
});

test('壊れた配信でも例外を投げず、取れるものだけ返す', () => {
  assert.deepStrictEqual(rss.parseFeed('', 'x'), []);
  assert.deepStrictEqual(rss.parseFeed(null, 'x'), []);
  assert.deepStrictEqual(rss.parseFeed('<rss><item><link>a</link></item></rss>', 'x'), [],
    '見出しが無い記事は捨てる');
  assert.strictEqual(rss.parseFeed('<item><title>途中で切れ', 'x').length, 0);
});

test('長い要約は切り詰める（費用を抑えるため本文は渡さない）', () => {
  const long = 'あ'.repeat(400);
  const list = rss.parseFeed(`<item><title>T</title><description>${long}</description></item>`, 'x');
  assert.ok(list[0].summary.length <= rss.MAX_SUMMARY + 1);
  assert.ok(list[0].summary.endsWith('…'));
});

test('複数の配信をまとめ、重複を消して新しい順に並べる', () => {
  const a = rss.parseFeed(SAMPLE_RSS, 'A');
  const b = rss.parseFeed(SAMPLE_RSS, 'B');   // 同じ見出し
  const merged = rss.mergeArticles([a, b], 10);
  assert.strictEqual(merged.length, 2, '同じ見出しは1本にする');
  assert.strictEqual(merged[0].title, '高市首相 消費税減税へ調整指示', '新しいものが先');
  assert.strictEqual(rss.mergeArticles([a, b], 1).length, 1, '上限で切る');
  assert.deepStrictEqual(rss.mergeArticles(null, 5), []);
});

test('日時が読めない記事は末尾に置く（捨てない）', () => {
  const withDate = { title: 'A', publishedAt: 'Mon, 08 Sep 2026 09:00:00 +0900' };
  const noDate = { title: 'B', publishedAt: 'あ' };
  assert.deepStrictEqual(rss.mergeArticles([[noDate, withDate]], 10).map((x) => x.title), ['A', 'B']);
});

test('配信一覧は http(s) だけを受け付け、空なら既定を使う', () => {
  assert.strictEqual(feeds.isFeedUrl('https://a.com/x.xml'), true);
  assert.strictEqual(feeds.isFeedUrl('file:///C:/secret.xml'), false);
  assert.strictEqual(feeds.isFeedUrl(''), false);

  assert.deepStrictEqual(feeds.normalizeFeeds([]), feeds.DEFAULT_FEEDS);
  assert.deepStrictEqual(feeds.normalizeFeeds(null), feeds.DEFAULT_FEEDS);

  const custom = feeds.normalizeFeeds([
    { url: 'https://a.com/rss', name: '独自' },
    { url: 'https://a.com/rss' },      // 重複
    { url: 'file:///etc/passwd' },     // 別の仕組みは受け付けない
  ]);
  assert.strictEqual(custom.length, 1);
  assert.strictEqual(custom[0].name, '独自');
});

test('AIに渡す本文には、地域を優先する指示が入る', () => {
  const articles = rss.parseFeed(SAMPLE_RSS, 'NHK');
  const withArea = feeds.buildUserPrompt({ articles, region: '愛媛', today: '2026-09-08' });
  assert.ok(withArea.includes('愛媛'));
  assert.ok(withArea.includes('優先して入れて'));
  // 「必ず1件は入れて」と書くと、県の話題が無い日に似た名前の別の県
  // （愛媛のつもりで愛知）を拾ってくる。無ければ入れなくてよいと伝える。
  assert.ok(!withArea.includes('必ず1件'));
  assert.ok(withArea.includes('無ければ入れなくて構いません'));

  const noArea = feeds.buildUserPrompt({ articles, today: '2026-09-08' });
  assert.ok(!noArea.includes('利用者の住む地域'));
  assert.ok(noArea.includes('高市首相'), '見出しは入っている');
});

test('見出しが取れなかったときも、本文の組み立てで落ちない', () => {
  const p = feeds.buildUserPrompt({ articles: [], today: '2026-09-08' });
  assert.ok(p.includes('取得できませんでした'));
});

test('AIに渡すのは見出しと短い要約だけ（記事本文は渡さない）', () => {
  const articles = rss.parseFeed(SAMPLE_RSS, 'NHK');
  const text = feeds.buildUserPrompt({ articles, today: '2026-09-08' });
  // 見出し40件でも数千トークンに収まる大きさであること
  assert.ok(text.length < 4000, `渡す量が多すぎる: ${text.length}字`);
});

test('地域を設定すると、その地域の配信を1本足す', () => {
  const f = feeds.regionFeed('愛媛県');
  assert.ok(f.url.startsWith('https://news.google.com/rss/search'));
  assert.ok(f.url.includes(encodeURIComponent('愛媛県')), '地域名が検索語に入る');
  assert.ok(f.name.includes('愛媛県'), 'どこの配信か画面で分かる名前にする');

  // NHKの全国配信には県の話題がほとんど載らない。地域を入れていない人には足さない。
  assert.strictEqual(feeds.regionFeed(''), null);
  assert.strictEqual(feeds.regionFeed(null), null);
  assert.strictEqual(feeds.regionFeed('   '), null);
});

test('地域の見出しは全国のニュースを押しのけない件数に抑える', () => {
  assert.ok(feeds.MAX_REGION_ARTICLES > 0);
  assert.ok(feeds.MAX_REGION_ARTICLES < feeds.MAX_ARTICLES / 2);
});

test('同じ記事が媒体ちがいで並んでも1件にまとめる', () => {
  // Google ニュースの見出しは「記事名 - 媒体名」。Yahoo!の転載も混ざる。
  const title = '愛媛県内で初記録 淡水魚「ムギツク」を仁淀川水系で捕獲';
  assert.strictEqual(
    rss.dedupeKey(`${title} - 毎日新聞`),
    rss.dedupeKey(`${title}（毎日新聞） - Yahoo!ニュース`),
  );

  const merged = rss.mergeArticles([[
    { title: `${title} - 毎日新聞`, source: 'A', publishedAt: '' },
    { title: `${title}（毎日新聞） - Yahoo!ニュース`, source: 'B', publishedAt: '' },
  ]], 10);
  assert.strictEqual(merged.length, 1, '同じ話が5件のうち3件を占めてしまう');
});

test('別の記事は別のものとして残す', () => {
  assert.notStrictEqual(
    rss.dedupeKey('松山市で大雨 - 愛媛新聞'),
    rss.dedupeKey('今治市で大雨 - 愛媛新聞'),
  );
  // 短い見出しの中の「 - 」まで媒体名と見なさない
  assert.strictEqual(rss.dedupeKey('A - B'), 'A-B');
});

test('区切って書かれた地域は、区切りを空白に直して検索語にする', () => {
  const f = feeds.regionFeed('愛媛県/今治市');
  assert.ok(f.url.includes(encodeURIComponent('愛媛県 今治市')));
  assert.ok(f.name.includes('愛媛県/今治市'), '画面には本人の書いた形を出す');
});
