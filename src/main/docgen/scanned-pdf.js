// src/main/docgen/scanned-pdf.js
// 文字が入っていないPDF（紙をスキャンしたもの）を、AIに画像として読ませるために
// そのまま API へ添える。
//
// これまでは抽出できた文字（＝ほぼ空）だけを送っていたため、添付したのに中身が
// まったく反映されない状態だった。黙って無視されるのがいちばん困るので、
// 送れないときは理由を必ず画面に返す。

const fs = require('node:fs/promises');

// APIに一度に添えられる上限。超える分は送らず、理由を伝える。
const MAX_BYTES = 24 * 1024 * 1024;   // 1リクエスト32MBの枠に対して余裕を持たせる
const MAX_PAGES = 100;
const MAX_FILES = 3;                  // 枚数が増えるほど費用も時間も増えるため
// PDF 1ページあたりのトークンの目安（費用の概算に使う）。
const TOKENS_PER_PAGE = 2000;

function reason(name, text) {
  return { name, ok: false, message: text };
}

// 1件をAPIに添える形にする。読めない・大きすぎるときは ok:false と理由を返す。
async function toDocument(entry) {
  const name = String((entry && entry.name) || 'PDF');
  const filePath = String((entry && entry.path) || '');
  const pages = Math.max(0, Math.floor(Number(entry && entry.pdfPages)) || 0);

  if (!filePath) return reason(name, 'ファイルの場所が分からず、画像として読ませられませんでした');
  if (pages > MAX_PAGES) {
    return reason(name, `${pages}ページあるため、画像としては読ませませんでした（${MAX_PAGES}ページまで）`);
  }
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length > MAX_BYTES) {
      return reason(name, `ファイルが大きいため、画像としては読ませませんでした（${Math.round(MAX_BYTES / 1024 / 1024)}MBまで）`);
    }
    return { name, ok: true, pages, base64: buf.toString('base64') };
  } catch (err) {
    return reason(name, '読み取れませんでした');
  }
}

// スキャンPDFの一覧から、実際にAPIへ添えるものと、添えられなかった理由を作る。
// 何件送るかは MAX_FILES で頭打ちにし、あふれた分も理由として返す。
async function collect(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.scanned && e.path);
  const target = list.slice(0, MAX_FILES);
  const overflow = list.slice(MAX_FILES);

  const results = await Promise.all(target.map(toDocument));
  const documents = results.filter((r) => r.ok).map((r) => ({ name: r.name, base64: r.base64 }));
  const skipped = results.filter((r) => !r.ok).map((r) => ({ name: r.name, message: r.message }))
    .concat(overflow.map((e) => ({
      name: String(e.name || 'PDF'),
      message: `画像として読ませるPDFは${MAX_FILES}件までのため、この分は送っていません`,
    })));

  const pages = results.filter((r) => r.ok).reduce((sum, r) => sum + (r.pages || 0), 0);
  return { documents, skipped, pages };
}

// 費用の概算に足すトークン数。ページ数から見る。
function tokensForPages(pages) {
  const n = Math.max(0, Math.floor(Number(pages)) || 0);
  return n * TOKENS_PER_PAGE;
}

module.exports = {
  MAX_BYTES, MAX_PAGES, MAX_FILES, TOKENS_PER_PAGE, toDocument, collect, tokensForPages,
};
