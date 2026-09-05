// src/main/translate/docx-edit.js
// Word(.docx) の word/document.xml を、元の書式を保ったまま編集する純粋関数。
// docgen/office-text.js と同じ考え方（専用パーサを使わず正規表現で必要なタグだけを
// 拾う。壊れたXMLでも例外を投げない）にそろえる。ここではElectronに依存しない。

const { decodeXmlEntities } = require('../docgen/office-text');

// <tagName>や自己終了タグ<tagName/>を、文書に出てくる順にすべて拾う正規表現を作る。
// 属性つき（<w:p w:rsidR="...">）でも拾えるよう、開始タグの中身は問わない。
// 呼び出しのたびに新しいRegExpを作る（lastIndexを共有しないため）。
function elementRegex(tagName) {
  return new RegExp(`<${tagName}(?:\\s[^>]*)?\\/>|<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`, 'g');
}

// 段落タグ<w:p>ごとに、文書中に出てくる順で {index, xml, text} を返す。
// 表のセルの中身も<w:p>なので、特別扱いせず同じ正規表現で拾える
// （<w:p>はOOXML上入れ子にならないため、非貪欲マッチで安全に区切れる）。
function splitParagraphs(documentXml) {
  const xml = String(documentXml == null ? '' : documentXml);
  const re = elementRegex('w:p');
  const out = [];
  let m;
  let index = 0;
  while ((m = re.exec(xml)) !== null) {
    const full = m[0];
    out.push({ index, xml: full, text: extractText(full) });
    index += 1;
  }
  return out;
}

// <w:t>の中身をすべて連結する（自己終了<w:t/>は中身が無いので対象外。
// office-text.jsのextractTagContentsと同じ考え方だが、Electron非依存を保つため
// このモジュール内に複製する）。
function extractText(xml) {
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let out = '';
  let m;
  while ((m = re.exec(xml)) !== null) {
    out += decodeXmlEntities(m[1]);
  }
  return out;
}

// xml内で最初に出てくるtagName要素を1つだけ取り出す。
// 自己終了タグと開始/終了タグの両方があり得るため、出現位置が早い方を採用する。
// 見つからなければnull。
function extractFirst(xml, tagName) {
  const safe = String(xml == null ? '' : xml);
  const openRe = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`);
  const selfRe = new RegExp(`<${tagName}(?:\\s[^>]*)?\\/>`);
  const mOpen = openRe.exec(safe);
  const mSelf = selfRe.exec(safe);
  if (mOpen && (!mSelf || mOpen.index <= mSelf.index)) {
    return { full: mOpen[0], inner: mOpen[1], selfClosing: false };
  }
  if (mSelf) {
    return { full: mSelf[0], inner: '', selfClosing: true };
  }
  return null;
}

// 訳文をXMLテキストとして安全な形にエスケープする（属性値ではなく要素の中身なので
// & < > の3つだけで十分）。
function encodeXmlText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 既存のrPr（実行のプロパティ。太字・斜体・フォント等）を活かしつつ、文字色だけを
// グレー(666666)に上書きしたrPrを組み立てる。既存にw:colorがあれば取り除いてから
// 付け直す（重複させない）。rPr自体が無ければ、色だけの新規rPrを作る。
function buildGreyRPr(rPr) {
  let inner = rPr && !rPr.selfClosing ? rPr.inner : '';
  inner = inner
    .replace(/<w:color(?:\s[^>]*)?\/>/g, '')
    .replace(/<w:color(?:\s[^>]*)?>[\s\S]*?<\/w:color>/g, '');
  return `<w:rPr>${inner}<w:color w:val="666666"/></w:rPr>`;
}

// 元の段落(<w:p>...</w:p>)をコピーし、最初の<w:r>だけを残して<w:t>を訳文に
// 差し替えた新しい段落XMLを返す。
// - 段落プロパティ<w:pPr>（見出し・箇条書き・配置など）は必ず引き継ぐ。
// - 文字色はグレー(666666)にする。
// - 最初の実行(run)のrPr（太字・斜体など）はそのまま活かす。
// - 実行が1つも無い段落（見出しスタイルだけの空段落など）でも例外を投げない。
function buildTranslatedParagraph(originalXml, translatedText) {
  const xml = String(originalXml == null ? '' : originalXml);
  const pPr = extractFirst(xml, 'w:pPr');
  const firstRun = extractFirst(xml, 'w:r');
  const rPr = firstRun && !firstRun.selfClosing ? extractFirst(firstRun.inner, 'w:rPr') : null;

  const newRPr = buildGreyRPr(rPr);
  const newRun = `<w:r>${newRPr}<w:t xml:space="preserve">${encodeXmlText(translatedText)}</w:t></w:r>`;
  const pPrXml = pPr ? pPr.full : '';
  return `<w:p>${pPrXml}${newRun}</w:p>`;
}

// document.xml全体の中で、指定したindex（splitParagraphsが返すのと同じ番号）の
// 段落の直後に、対応するXMLを差し込む。insertionsが空なら元のXMLをそのまま返す。
// 存在しないindexは無視する（例外を投げない）。
function insertAfter(documentXml, insertions) {
  const xml = String(documentXml == null ? '' : documentXml);
  const list = Array.isArray(insertions) ? insertions : [];
  const map = new Map();
  for (const ins of list) {
    if (ins && Number.isInteger(ins.index) && typeof ins.xml === 'string') {
      map.set(ins.index, (map.get(ins.index) || '') + ins.xml);
    }
  }
  if (map.size === 0) return xml;

  const re = elementRegex('w:p');
  let result = '';
  let lastEnd = 0;
  let index = 0;
  let m;
  while ((m = re.exec(xml)) !== null) {
    result += xml.slice(lastEnd, re.lastIndex);
    lastEnd = re.lastIndex;
    if (map.has(index)) result += map.get(index);
    index += 1;
  }
  result += xml.slice(lastEnd);
  return result;
}

module.exports = { splitParagraphs, buildTranslatedParagraph, insertAfter };
