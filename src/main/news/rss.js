// src/main/news/rss.js
// RSS/Atom から「見出し・リンク・日時」だけを取り出す。
//
// XMLの専用パーサは入れない。ここで欲しいのは3つの要素だけで、
// 壊れた配信でも落ちずに拾えるほうが大事だから（docgen/office-text.js と同じ考え方）。
// 本文は取りに行かない。**記事本文をAIに渡すと費用が10倍変わる**ので、
// 渡すのは見出しと配信元の要約（description）の頭だけにする。

const MAX_SUMMARY = 120;

function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');   // & は最後（先に戻すと二重復号になる）
}

// タグを外す前に、必ず CDATA を先に開く。
// <![CDATA[見出し]]> は `<` で始まり `]]>` の `>` で終わるため、
// 先にタグ剥がしを掛けると**見出しごと消える**（実際にそうなっていた）。
function stripTags(s) {
  const opened = String(s == null ? '' : s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(opened.replace(/<[^>]*>/g, '')).trim();
}

// 1要素分を取り出す。属性つきの開始タグにも当てる。
function pick(xml, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return m ? stripTags(m[1]) : '';
}

// Atom の <link href="..."/> はテキストではなく属性に入っている。
function pickLink(xml) {
  const text = pick(xml, 'link');
  if (text) return text;
  const m = /<link[^>]*\shref="([^"]+)"/i.exec(xml);
  return m ? decodeEntities(m[1]) : '';
}

function trimSummary(s) {
  const t = stripTags(s).replace(/\s+/g, ' ');
  return t.length > MAX_SUMMARY ? `${t.slice(0, MAX_SUMMARY)}…` : t;
}

// 配信1本ぶんを記事の一覧にする。RSS(item) と Atom(entry) の両方に対応する。
function parseFeed(xml, sourceName) {
  const text = String(xml == null ? '' : xml);
  const blocks = [
    ...text.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi),
    ...text.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const out = [];
  for (const block of blocks) {
    const title = pick(block, 'title');
    if (!title) continue;   // 見出しが無いものは出しようがない
    out.push({
      title,
      link: pickLink(block),
      summary: trimSummary(pick(block, 'description') || pick(block, 'summary')),
      publishedAt: pick(block, 'pubDate') || pick(block, 'updated') || pick(block, 'published') || '',
      source: String(sourceName || ''),
    });
  }
  return out;
}

// 複数の配信をまとめる。同じ見出しは1本にし、新しい順に並べ、上限で切る。
function mergeArticles(lists, limit) {
  const seen = new Set();
  const all = [];
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const a of Array.isArray(list) ? list : []) {
      const key = a.title.replace(/\s+/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push(a);
    }
  }
  all.sort((a, b) => {
    const ta = Date.parse(a.publishedAt);
    const tb = Date.parse(b.publishedAt);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
  const max = Number(limit) > 0 ? Math.floor(Number(limit)) : all.length;
  return all.slice(0, max);
}

module.exports = {
  MAX_SUMMARY, decodeEntities, stripTags, parseFeed, mergeArticles, trimSummary,
};
