// src/main/news/feeds.js
// どこからニュースを取るかと、AIに渡す文章の組み立て。Electronに依存しない。
//
// **記事本文は取りに行かない。** 見出しと配信元の要約だけをAIに渡し、
// 選別と要約をさせる。本文を文脈に入れると費用が10倍変わるため
// （ウェブ検索で集めると1回20〜40円、この方式なら1〜3円）。

const DEFAULT_FEEDS = [
  { id: 'nhk-main', name: 'NHK 主要', url: 'https://www.nhk.or.jp/rss/news/cat0.xml' },
  { id: 'nhk-society', name: 'NHK 社会', url: 'https://www.nhk.or.jp/rss/news/cat1.xml' },
  { id: 'nhk-business', name: 'NHK 経済', url: 'https://www.nhk.or.jp/rss/news/cat5.xml' },
];

// AIに渡す見出しの上限。増やすほど費用と時間が増えるので、ここで頭打ちにする。
const MAX_ARTICLES = 40;

function trim(v) {
  return String(v == null ? '' : v).trim();
}

// http(s) の配信だけを受け付ける。file: などを混ぜられないようにする。
function isFeedUrl(value) {
  const url = trim(value);
  return /^https?:\/\/[^\s]+$/i.test(url);
}

// 設定に保存された配信一覧を、そのまま信用せず形にはめ直す。
// 何も入っていなければ既定の配信を使う。
function normalizeFeeds(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const url = trim(item && typeof item === 'object' ? item.url : item);
    if (!isFeedUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({
      id: trim(item && item.id) || `f${out.length}`,
      name: trim(item && item.name) || url.replace(/^https?:\/\//, '').split('/')[0],
      url,
    });
  }
  return out.length ? out : DEFAULT_FEEDS.slice();
}

function normalizeRegion(value) {
  return trim(value).slice(0, 40);
}

// 地域で拾える見出しの上限。全国のニュースを押しのけないように少なめにする。
const MAX_REGION_ARTICLES = 12;

// 住んでいる地域のニュース。NHKの全国配信には県の話題がほとんど載らないため、
// 地域を設定した人には、その地域を検索した配信をもう1本足す。
//
// NHKの地域ニュースにもRSSはあるが、取りに行くと 401（要トークン）で読めない（実測）。
// Google ニュースの検索配信なら、47都道府県のどこでも同じ形で取れる。
// **地域名は検索語としてGoogleに渡る**。設定画面にもその旨を書いておくこと。
function regionFeed(region) {
  const area = normalizeRegion(region);
  if (!area) return null;
  // 「愛媛県/今治市」のように区切って書かれていたら、区切りは空白に直して渡す。
  // 検索語としてはそのままで通る（実測で「"愛媛県" OR "今治市"」と同じ結果）。
  const query = area.replace(/[\s/／、，,・|｜]+/g, ' ').trim();
  const url = 'https://news.google.com/rss/search'
    + `?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  return { id: 'region', name: `地域（${area}）`, url };
}

// 記事一覧をAIに渡す本文にする。番号を振り、あとで対応を取れるようにする。
function formatArticles(articles) {
  const list = Array.isArray(articles) ? articles : [];
  if (!list.length) return '（見出しを取得できませんでした）';
  return list
    .map((a, i) => {
      const head = `${i + 1}. [${a.source || '出典不明'}] ${a.title}`;
      return a.summary ? `${head}\n   ${a.summary}` : head;
    })
    .join('\n');
}

// system は毎回まったく同じにする（プロンプトキャッシュが前方一致で効くように）。
function buildSystemPrompt() {
  return [
    'あなたは秘書として、その日のニュースを手短に伝えるアシスタントです。',
    '',
    '守ること:',
    '- 渡された見出しの範囲だけで書く。書かれていないことを足さない',
    '- 5件までに絞る。重要なもの・利用者の住む地域に関わるものを優先する',
    '- 地名は1文字も変えない。似た名前の別の県（愛媛と愛知など）を取り違えない',
    '- 1件につき1〜2文。前置き・あいさつ・締めの言葉は書かない',
    '- 「・」で始まる箇条書きにする。マークダウン記法は使わない',
    '- 各行は「・[3] 本文」の形にする。[ ] の中は、その話の元になった見出しの番号',
    '  （画面でその配信元を開けるようにするため。番号は渡した一覧のものをそのまま使う）',
    '- 事実だけを書き、論評や推測を混ぜない',
  ].join('\n');
}

function buildUserPrompt({ articles, region, today } = {}) {
  const lines = [`【今日の日付】${trim(today)}`, ''];
  const area = normalizeRegion(region);
  if (area) {
    lines.push(`【利用者の住む地域】${area}`);
    lines.push(`見出しの中に${area}の話題があれば、それを優先して入れてください。`);
    lines.push(`無ければ入れなくて構いません。${area}以外の地名を${area}の話題として扱わないでください。`);
    lines.push('');
  }
  lines.push('【今日の見出し】');
  lines.push(formatArticles(articles));
  lines.push('');
  lines.push('上記から、今日押さえておくべきものを5件までにまとめてください。');
  return lines.join('\n');
}

module.exports = {
  DEFAULT_FEEDS,
  MAX_ARTICLES,
  isFeedUrl,
  normalizeFeeds,
  normalizeRegion,
  regionFeed,
  MAX_REGION_ARTICLES,
  formatArticles,
  buildSystemPrompt,
  buildUserPrompt,
};
