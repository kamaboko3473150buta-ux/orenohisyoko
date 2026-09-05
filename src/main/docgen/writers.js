// src/main/docgen/writers.js
// 4-4d の中間形式（{ title, sections: [{ heading, paragraphs, bullets }] }）を
// Word(.docx) / PDF のファイルに書き出す。
//
// 入力はAIの応答（あるいは画面で編集されたもの）を通すため、想定外の形（sections が
// 無い、bullets が空配列、paragraphs に空文字が混ざる、title が無い等）が実際に起こる。
// そのため各関数は例外を投げず、空のものは出力しないという方針で書く。

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const PptxGenJS = require('pptxgenjs');

// 日本語（游ゴシック）が文字化けしないよう明示するフォント。
// buildHtml と同じ考え方（Windows標準搭載のフォントを優先し、無ければMeiryo系にフォールバック）。
const SLIDE_FONT = 'Yu Gothic';

// mail-compose/draft.js の escapeHtml と同じ考え方（あちらを import せず、
// docgen 側で完結させるためここに複製する）。
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// 文字列配列に正規化する。配列でなければ空配列にし、配列の中の空文字・空白のみの
// 要素・文字列以外の要素は取り除く（docgen/prompt.js の sanitizeStringArray と同じ考え方）。
function sanitizeStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// doc（想定外の形も含む）から、出力に使える形のセクション一覧を作る。
// heading・paragraphs・bullets が全部空になるセクションは、出す意味が無いので捨てる。
function normalizeDoc(doc) {
  const title = sanitizeString(doc && doc.title);
  const rawSections = Array.isArray(doc && doc.sections) ? doc.sections : [];
  const sections = [];
  for (const s of rawSections) {
    if (!s || typeof s !== 'object') continue;
    const heading = sanitizeString(s.heading);
    const paragraphs = sanitizeStringArray(s.paragraphs);
    const bullets = sanitizeStringArray(s.bullets);
    if (!heading && !paragraphs.length && !bullets.length) continue;
    sections.push({ heading, paragraphs, bullets });
  }
  return { title, sections };
}

// PDF化のためのHTMLを組み立てる純粋関数。
// 生成された本文がそのまま入るため、HTML特殊文字は必ずエスケープする。
// 日本語が豆腐（□）にならないよう、日本語フォントを明示する。
function buildHtml(doc) {
  const { title, sections } = normalizeDoc(doc);

  const body = [];
  if (title) body.push(`<h1>${escapeHtml(title)}</h1>`);

  for (const section of sections) {
    if (section.heading) body.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    for (const p of section.paragraphs) {
      body.push(`<p>${escapeHtml(p)}</p>`);
    }
    if (section.bullets.length) {
      const items = section.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n');
      body.push(`<ul>\n${items}\n</ul>`);
    }
  }

  const pageTitle = escapeHtml(title || '資料');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${pageTitle}</title>
<style>
  body {
    font-family: "Yu Gothic", "Meiryo", sans-serif;
    font-size: 11pt;
    line-height: 1.8;
    color: #222;
    margin: 24px;
  }
  h1 { font-size: 20pt; margin: 0 0 16px; }
  h2 { font-size: 14pt; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  p { margin: 8px 0; white-space: pre-wrap; }
  ul { margin: 8px 0; padding-left: 24px; }
  li { margin: 4px 0; }
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>`;
}

// Word用の段落一覧を組み立てる。タイトル→見出し1、セクション見出し→見出し2。
function buildDocxChildren(doc) {
  const { title, sections } = normalizeDoc(doc);
  const children = [];

  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  }

  for (const section of sections) {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2 }));
    }
    for (const p of section.paragraphs) {
      children.push(new Paragraph({ text: p }));
    }
    for (const b of section.bullets) {
      children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
    }
  }

  // docx は中身が1件も無い文書でも作れるが、中身が空の.docxは開いたときに
  // 何も無く不安にさせるため、最低限空の段落を1つ入れておく。
  if (!children.length) children.push(new Paragraph({ text: '' }));

  return children;
}

// doc を Word(.docx) ファイルに書き出す。
async function writeDocx(doc, filePath) {
  const document = new Document({
    sections: [{ children: buildDocxChildren(doc) }],
  });
  const buffer = await Packer.toBuffer(document);
  await fs.writeFile(filePath, buffer);
}

// doc を PDF ファイルに書き出す。
//
// Electron の webContents.printToPDF を使う（Wordが入っていないPCでも出せるようにするため）。
// このモジュール自体は docgen の他のファイル（office-text.js / prompt.js / readers.js /
// estimate.js / types.js）と同じく Electron に依存しない作りにしたいので、
// 'electron' はこのファイルで require せず、呼び出し側（IPCハンドラ）が
// `const { BrowserWindow } = require('electron')` した上でその**クラス**を
// 第3引数 browserWindowClass として渡す契約にする。
//
// 日本語が文字化けしないよう、HTMLは一時ファイルに UTF-8 で書き出してから
// loadFile で読み込む（data URL は長さ制限やエンコードの落とし穴があるため避ける）。
// 使い終わったウィンドウ・一時ファイルは、成功・失敗にかかわらず必ず片付ける。
async function writePdf(doc, filePath, browserWindowClass) {
  if (typeof browserWindowClass !== 'function') {
    throw new Error('writePdf の第3引数には Electron の BrowserWindow クラスを渡してください');
  }

  const html = buildHtml(doc);
  const tempHtmlPath = path.join(os.tmpdir(), `docgen-${process.pid}-${crypto.randomUUID()}.html`);
  await fs.writeFile(tempHtmlPath, html, 'utf8');

  let win = null;
  try {
    win = new browserWindowClass({
      show: false,
      webPreferences: {
        sandbox: true,
      },
    });
    await win.loadFile(tempHtmlPath);
    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
    });
    await fs.writeFile(filePath, pdfBuffer);
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    try {
      await fs.unlink(tempHtmlPath);
    } catch (err) {
      // 一時ファイルの削除に失敗しても本処理（PDF書き出し）自体は完了しているので、
      // ここで例外を投げて呼び出し元の結果を握りつぶさない。
    }
  }
}

// 1セクション分のスライドを組み立てる。
// 箇条書きがあれば箇条書きを本文にし、無ければ段落をそのまま本文として置く
// （どちらも無いセクションは normalizeDoc の時点で除かれているので、ここには来ない）。
// スピーカーノートには、箇条書きを本文にした場合に限り paragraphs を入れる
// （paragraphs を本文に使った場合はノートに入れても二重になるだけなので入れない）。
function addSectionSlide(pptx, section) {
  const slide = pptx.addSlide();

  if (section.heading) {
    slide.addText(section.heading, {
      x: 0.4, y: 0.3, w: 9.2, h: 0.9,
      fontFace: SLIDE_FONT, fontSize: 24, bold: true, valign: 'top',
    });
  }

  const useBullets = section.bullets.length > 0;
  const bodyLines = useBullets ? section.bullets : section.paragraphs;
  if (bodyLines.length) {
    const runs = bodyLines.map((line) => ({
      text: line,
      options: { bullet: useBullets, breakLine: true },
    }));
    slide.addText(runs, {
      x: 0.4, y: 1.3, w: 9.2, h: 5.6,
      fontFace: SLIDE_FONT, fontSize: 18, valign: 'top',
    });
  }

  if (useBullets && section.paragraphs.length) {
    slide.addNotes(section.paragraphs.join('\n\n'));
  }
}

// doc を PowerPoint(.pptx) ファイルに書き出す。
// 先頭にタイトルスライドを1枚置き、以降は1 section = 1 スライドにする。
async function writePptx(doc, filePath) {
  const { title, sections } = normalizeDoc(doc);
  const pptx = new PptxGenJS();

  const titleSlide = pptx.addSlide();
  titleSlide.addText(title || '資料', {
    x: 0.5, y: 2.7, w: 9, h: 1.5,
    fontFace: SLIDE_FONT, fontSize: 32, bold: true, align: 'center', valign: 'middle',
  });

  for (const section of sections) {
    addSectionSlide(pptx, section);
  }

  await pptx.writeFile({ fileName: filePath });
}

module.exports = { buildHtml, writeDocx, writePdf, writePptx };
