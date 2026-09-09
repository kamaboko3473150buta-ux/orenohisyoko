// src/renderer/news-lines.js
// 「今日のニュース」のまとめ文を、行ごとに「どの見出しの話か」に結び付ける。
//
// AIには各行の先頭に元の見出しの番号を [3] の形で付けさせている。
// 見出しの文字列で照合すると、AIが言い換えた瞬間に外れる（要約なので必ず言い換える）。
// 番号なら言い換えても壊れない。
//
// 画面から呼ぶが、番号の取り出しは純粋な処理なのでテストできるようにしておく。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NewsLines = api;
}(typeof self !== 'undefined' ? self : this, () => {
  // 行頭の「・[3] 」「[3] 」を見て、番号と、番号を取り除いた本文に分ける。
  // 番号が無い行（AIが付け忘れた・前置きの行）は n を null にしてそのまま返す。
  const MARK = /^(・?\s*)\[(\d{1,3})\]\s*/;

  function parseLine(line) {
    const text = String(line == null ? '' : line);
    const m = text.match(MARK);
    if (!m) return { text, n: null };
    // 「・」は残す。箇条書きの見た目を崩さないため。
    return { text: (m[1].includes('・') ? '・' : '') + text.slice(m[0].length), n: Number(m[2]) };
  }

  function parseLines(message) {
    return String(message == null ? '' : message).split('\n').map(parseLine);
  }

  // 配信から拾ったリンクだけを開く。**RSSの中身は他人が書いたものなので、
  // http(s) 以外は開かない**（file: や javascript: を混ぜられないようにする）。
  function isSafeUrl(value) {
    const url = String(value == null ? '' : value).trim();
    return /^https?:\/\/[^\s]+$/i.test(url);
  }

  // 行の番号（1始まり）から、開くべきURLを引く。無ければ空文字。
  function linkFor(articles, n) {
    const list = Array.isArray(articles) ? articles : [];
    if (!Number.isInteger(n) || n < 1 || n > list.length) return '';
    const url = list[n - 1] && list[n - 1].link;
    return isSafeUrl(url) ? url : '';
  }

  return { MARK, parseLine, parseLines, isSafeUrl, linkFor };
}));
