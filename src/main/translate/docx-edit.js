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

// 既存のrPr（実行のプロパティ。太字・フォント等）を活かしつつ、訳文の見た目を
// 「グレー(666666)＋斜体」に上書きしたrPrを組み立てる。原文と一目で見分けられるようにする
// （印刷してグレーが薄くなっても、斜体なら区別できる）。
// 既存の色・斜体の指定は取り除いてから付け直す（重複させない）。
function buildGreyRPr(rPr) {
  let inner = rPr && !rPr.selfClosing ? rPr.inner : '';
  inner = inner
    .replace(/<w:color(?:\s[^>]*)?\/>/g, '')
    .replace(/<w:color(?:\s[^>]*)?>[\s\S]*?<\/w:color>/g, '')
    .replace(/<w:i(?:\s[^>]*)?\/>/g, '')
    .replace(/<w:iCs(?:\s[^>]*)?\/>/g, '');
  // 大きさは原文の9割にする。原文が主・訳文が従という関係が見た目で伝わり、
  // 原文と訳文が交互に並んでも紙面が間延びしない。
  // w:sz は「半ポイント」単位。元の指定があればその9割、無ければ既定10.5pt(21)の9割。
  inner = inner
    .replace(/<w:sz(?:\s[^>]*)?\/>/g, '')
    .replace(/<w:szCs(?:\s[^>]*)?\/>/g, '');
  const size = Math.max(12, Math.round(baseHalfPoints(rPr) * 0.9));
  return `<w:rPr>${inner}<w:i/><w:iCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
    + `<w:color w:val="666666"/></w:rPr>`;
}

// 元のrPrから文字の大きさ（半ポイント）を読む。指定が無ければWordの既定 10.5pt = 21。
function baseHalfPoints(rPr) {
  const inner = rPr && !rPr.selfClosing ? rPr.inner : '';
  const m = inner.match(/<w:sz(?:\s[^>]*)?\sw:val="(\d+)"/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 21;
}

// 元の段落(<w:p>...</w:p>)をコピーし、最初の<w:r>だけを残して<w:t>を訳文に
// 差し替えた新しい段落XMLを返す。
// - 段落プロパティ<w:pPr>（見出し・箇条書き・配置など）は必ず引き継ぐ。
// - 見た目はグレー(666666)＋斜体にする（原文と見分けるため）。
// - 最初の実行(run)のrPr（太字・斜体など）はそのまま活かす。
// - 実行が1つも無い段落（見出しスタイルだけの空段落など）でも例外を投げない。
// 訳文の段落プロパティ。元の段落プロパティ（見出し・箇条書き・配置）は引き継ぎつつ、
// 段落の前後の余白だけを0にする。原文と訳文がひとまとまりに見え、
// 表題まわりが間延びしなくなる（実機で「間延びして見栄えが悪い」との指摘があった）。
const TIGHT_SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';

// OOXMLでは w:pPr の中身の並び順が決まっており、w:spacing は
// pStyle・numPr・pBdr・shd・tabs などより後ろに置かなければならない。
// Wordは多少崩れても開いてくれるが、規格どおりに入れる。
const PPR_BEFORE_SPACING = ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore',
  'w:framePr', 'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs'];

function buildTightPPr(pPr) {
  if (!pPr || pPr.selfClosing) return `<w:pPr>${TIGHT_SPACING}</w:pPr>`;
  const inner = pPr.inner.replace(/<w:spacing(?:\s[^>]*)?\/>/g, '');

  // spacing より前に来るべき要素のうち、最後に現れるものの直後に差し込む。
  // 正規表現はテンプレート文字列の中で \s と書くと JS が s に潰してしまうため、
  // 必ず \\s と二重に書くこと（ここで一度間違えて一致しなくなった）。
  let at = 0;
  for (const tag of PPR_BEFORE_SPACING) {
    const patterns = [
      new RegExp(`<${tag}(?:\\s[^>]*)?/>`, 'g'),
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g'),
    ];
    for (const re of patterns) {
      let m = re.exec(inner);
      while (m) {
        at = Math.max(at, m.index + m[0].length);
        m = re.exec(inner);
      }
    }
  }
  return `<w:pPr>${inner.slice(0, at)}${TIGHT_SPACING}${inner.slice(at)}</w:pPr>`;
}

function buildTranslatedParagraph(originalXml, translatedText) {
  const xml = String(originalXml == null ? '' : originalXml);
  const pPr = extractFirst(xml, 'w:pPr');
  const firstRun = extractFirst(xml, 'w:r');
  const rPr = firstRun && !firstRun.selfClosing ? extractFirst(firstRun.inner, 'w:rPr') : null;

  const newRPr = buildGreyRPr(rPr);
  const newRun = `<w:r>${newRPr}<w:t xml:space="preserve">${encodeXmlText(translatedText)}</w:t></w:r>`;
  return `<w:p>${buildTightPPr(pPr)}${newRun}</w:p>`;
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
