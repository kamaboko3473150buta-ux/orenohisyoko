// src/main/docgen/office-text.js
// Word(.docx) / PowerPoint(.pptx) の中身の XML から文字だけを取り出す純粋関数。
// docx/pptx は zip の中に XML が入っているだけなので、専用パーサを使わず正規表現で
// 必要なタグだけを拾う（依存を増やさず、壊れたXMLでも例外を投げない実装にしやすいため）。

// XML の実体参照を元の文字に戻す。
// &amp; は最後に戻すこと（先に戻すと「&amp;lt;」のような二重エスケープを誤って
// 壊してしまう。&amp; 以外を先に処理しても "&amp;" という並びを他の置換が
// 誤爆することはないので、この順序で安全）。
function decodeXmlEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (err) {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch (err) {
        return '';
      }
    })
    .replace(/&amp;/g, '&');
}

// tagName（例: 'w:t'）の要素の中身をすべて拾って配列で返す。
// 属性つき（<w:t xml:space="preserve">）でも拾えるよう、開始タグの中身は問わない。
// 自己終了タグ（<w:t/>）は中身が無いので対象外。
function extractTagContents(xml, tagName) {
  const safe = String(xml == null ? '' : xml);
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(safe)) !== null) {
    out.push(decodeXmlEntities(m[1]));
  }
  return out;
}

// 段落タグ（<w:p>や<a:p>）ごとに区切り、その中のテキストタグの中身を連結して1行にする。
// 壊れたXML・空文字でも正規表現がマッチしないだけで例外にはならないため、常に配列を返す。
function linesFromXml(xml, paraTag, textTag) {
  const safe = String(xml == null ? '' : xml);
  const paraRe = new RegExp(`<${paraTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${paraTag}>`, 'g');
  const lines = [];
  let m;
  while ((m = paraRe.exec(safe)) !== null) {
    lines.push(extractTagContents(m[1], textTag).join(''));
  }
  return lines;
}

// Word の document.xml / slideN.xml 相当の1ファイル分から本文を取り出す。
// <w:p> ごとに1行、<w:t> の中身を連結する。
function docxTextFromXml(xml) {
  return linesFromXml(xml, 'w:p', 'w:t').join('\n');
}

// PowerPoint のスライドXMLから本文を取り出す。
// <a:p> ごとに1行、<a:t> の中身を連結する。
function pptxTextFromXml(xml) {
  return linesFromXml(xml, 'a:p', 'a:t').join('\n');
}

module.exports = { decodeXmlEntities, docxTextFromXml, pptxTextFromXml };
