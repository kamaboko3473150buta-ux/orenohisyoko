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
    '- 1件につき1〜2文。前置き・あいさつ・締めの言葉は書かない',
    '- 「・」で始まる箇条書きにする。番号やマークダウン記法は使わない',
    '- 事実だけを書き、論評や推測を混ぜない',
  ].join('\n');
}

function buildUserPrompt({ articles, region, today } = {}) {
  const lines = [`【今日の日付】${trim(today)}`, ''];
  const area = normalizeRegion(region);
  if (area) {
    lines.push(`【利用者の住む地域】${area}`);
    lines.push(`${area}に関わる話題があれば、必ず1件は入れてください。`);
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
  formatArticles,
  buildSystemPrompt,
  buildUserPrompt,
};
