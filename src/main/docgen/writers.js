// src/main/docgen/writers.js
// 4-4d の中間形式（{ title, sections: [{ heading, paragraphs, bullets }] }）を
// Word(.docx) / PDF のファイルに書き出す。
//
// 入力はAIの応答（あるいは画面で編集されたもの）を通すため、想定外の形（sections が
// 無い、bullets が空配列、paragraphs に空文字が混ざる、title が無い等）が実際に起こる。
// そのため各関数は例外を投げず、空のものは出力しないという方針で書く。

const fs = require('node:fs/promises');
const { accessSync, constants: fsConstants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType,
} = require('docx');
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

// 表のセル1個分を文字列にする。文字列はそのまま、数値は文字列化して残す。
// それ以外の型は空文字にする（docgen/prompt.js の sanitizeTableCell と同じ考え方の複製。
// writers.js はAIの応答解析を担う prompt.js に依存させたくないため、ここでも複製する
// ——画面で編集された後のdocがそのまま来ることもあり、prompt.jsの正規化を必ず通るとは
// 限らないため）。
function sanitizeTableCell(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

// { headers, rows } を正規化する。headersが1列も無い・rowsが配列でない・行が配列でない
// ・列数がheadersと合わない行は捨てる。有効な行が1つも残らなければ表を出す意味が無いので
// nullにする（docgen/prompt.js の sanitizeTable と同じ考え方の複製）。
function normalizeTable(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const headers = sanitizeStringArray(v.headers);
  if (!headers.length) return null;
  const rawRows = Array.isArray(v.rows) ? v.rows : [];
  const rows = [];
  for (const row of rawRows) {
    if (!Array.isArray(row) || row.length !== headers.length) continue;
    rows.push(row.map(sanitizeTableCell));
  }
  if (!rows.length) return null;
  return { headers, rows };
}

// meta（{label, value}の一覧）を正規化する。配列でなければ空配列にし、要素がオブジェクト
// でない・labelもvalueも空になる要素は捨てる（docgen/prompt.js の sanitizeMeta と同じ
// 考え方の複製）。
function normalizeMetaItem(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const label = sanitizeString(m.label);
  const value = sanitizeString(m.value);
  if (!label && !value) return null;
  return { label, value };
}

function normalizeMeta(v) {
  if (!Array.isArray(v)) return [];
  return v.map(normalizeMetaItem).filter((m) => m !== null);
}

// doc（想定外の形も含む）から、出力に使える形のmeta・セクション一覧を作る。
// heading・paragraphs・bullets・table が全部空になるセクションは、出す意味が無いので捨てる。
function normalizeDoc(doc) {
  const title = sanitizeString(doc && doc.title);
  const meta = normalizeMeta(doc && doc.meta);
  const rawSections = Array.isArray(doc && doc.sections) ? doc.sections : [];
  const sections = [];
  for (const s of rawSections) {
    if (!s || typeof s !== 'object') continue;
    const heading = sanitizeString(s.heading);
    const paragraphs = sanitizeStringArray(s.paragraphs);
    const bullets = sanitizeStringArray(s.bullets);
    const table = normalizeTable(s.table);
    if (!heading && !paragraphs.length && !bullets.length && !table) continue;
    sections.push({
      heading, paragraphs, bullets, table,
    });
  }
  return { title, meta, sections };
}

// metaを「ラベル・値」の2列の表にするHTMLを組み立てる。metaが空なら空文字を返す。
function buildMetaHtml(meta) {
  if (!meta.length) return '';
  const rows = meta
    .map((m) => `<tr><th>${escapeHtml(m.label)}</th><td>${escapeHtml(m.value)}</td></tr>`)
    .join('\n');
  return `<table class="meta">\n${rows}\n</table>`;
}

// セクションのtable（{headers, rows}）を罫線付きの表にするHTMLを組み立てる。
// tableが無ければ空文字を返す。
function buildTableHtml(table) {
  if (!table) return '';
  const thead = `<tr>${table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const tbody = table.rows
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table class="data">\n<thead>\n${thead}\n</thead>\n<tbody>\n${tbody}\n</tbody>\n</table>`;
}

// PDF化のためのHTMLを組み立てる純粋関数。
// 生成された本文がそのまま入るため、HTML特殊文字は必ずエスケープする。
// 日本語が豆腐（□）にならないよう、日本語フォントを明示する。
function buildHtml(doc) {
  const { title, meta, sections } = normalizeDoc(doc);

  const body = [];
  if (title) body.push(`<h1>${escapeHtml(title)}</h1>`);

  const metaHtml = buildMetaHtml(meta);
  if (metaHtml) body.push(metaHtml);

  for (const section of sections) {
    if (section.heading) body.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    for (const p of section.paragraphs) {
      body.push(`<p>${escapeHtml(p)}</p>`);
    }
    if (section.bullets.length) {
      const items = section.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n');
      body.push(`<ul>\n${items}\n</ul>`);
    }
    const tableHtml = buildTableHtml(section.table);
    if (tableHtml) body.push(tableHtml);
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
  table { border-collapse: collapse; margin: 8px 0 16px; }
  table.meta th, table.meta td, table.data th, table.data td {
    border: 1px solid #999; padding: 6px 10px; text-align: left; vertical-align: top;
  }
  table.meta th { background: #f2f2f2; white-space: nowrap; }
  table.data th { background: #f2f2f2; }
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>`;
}

// Word用のTableセルを1個作る。見出しセルは太字にし、薄い網掛けを付ける。
function buildDocxCell(text, { header = false, widthPercent } = {}) {
  const run = header ? new TextRun({ text, bold: true }) : new TextRun({ text });
  return new TableCell({
    width: widthPercent ? { size: widthPercent, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: 'F2F2F2' } : undefined,
    children: [new Paragraph({ children: [run] })],
  });
}

// metaを「ラベル・値」の2列の表にする。metaが空ならnullを返す。
function buildDocxMetaTable(meta) {
  if (!meta.length) return null;
  const rows = meta.map((m) => new TableRow({
    children: [
      buildDocxCell(m.label, { header: true, widthPercent: 25 }),
      buildDocxCell(m.value, { widthPercent: 75 }),
    ],
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

// セクションのtable（{headers, rows}）を罫線付きの表にする。tableが無ければnullを返す。
function buildDocxSectionTable(table) {
  if (!table) return null;
  const headerRow = new TableRow({
    children: table.headers.map((h) => buildDocxCell(h, { header: true })),
  });
  const bodyRows = table.rows.map((row) => new TableRow({
    children: row.map((cell) => buildDocxCell(cell)),
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}

// Word用の段落一覧を組み立てる。タイトル→見出し1、セクション見出し→見出し2。
// meta はタイトル直後に2列の表として置き、セクションのtableは段落・箇条書きのあとに置く。
function buildDocxChildren(doc) {
  const { title, meta, sections } = normalizeDoc(doc);
  const children = [];

  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  }

  const metaTable = buildDocxMetaTable(meta);
  if (metaTable) {
    children.push(metaTable);
    children.push(new Paragraph({ text: '' }));
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
    const sectionTable = buildDocxSectionTable(section.table);
    if (sectionTable) {
      children.push(sectionTable);
      children.push(new Paragraph({ text: '' }));
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
// これは「レポート等をそのままPowerPoint形式で保存したい」場合のための簡易版で、
// プレゼン専用の writePresentationPptx（下記）とは役割を分けている。
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

// ---- プレゼン専用のレイアウト付き書き出し（Task 37） ----------------------------------
//
// docgen/prompt.js の { title, subtitle, slides:[...] } という別形式（Task 36）を描く。
// 実機で「文字だらけでプレゼン資料として使い物にならない」という指摘を受けたため、
// レポート用の writePptx（見出し＋箇条書きを流し込むだけ）とは中身を分け、
// レイアウトごとに全く違う絵にする。
//
// 呼び出し元（画面で編集された後のdeck）は必ずしも prompt.js の parseDeckJson を
// 通っていない（画面上でユーザーが手で書き換えた後の値がそのまま来る）ため、
// prompt.js の sanitizeSlide 等には依存せず、ここでも同じ堅牢さで正規化する
// （writers.js を「AIの応答解析」を担う prompt.js に依存させたくない、という理由もある）。

const SLIDE_W_IN = 10;
const SLIDE_H_IN = 5.625;
const SLIDE_NAVY = '1F3864';
const SLIDE_HAIRLINE = 'C9D2E3';
const SLIDE_BODY_COLOR = '22262B';
const SLIDE_CARD_BG = 'F2F3F7';
const SLIDE_WHITE = 'FFFFFF';

const SLIDE_LAYOUTS = ['title', 'statement', 'bullets', 'compare', 'image', 'closing'];
const MAX_SLIDE_BULLETS = 5;

function sanitizeSlideBullets(v) {
  return sanitizeStringArray(v).slice(0, MAX_SLIDE_BULLETS);
}

// compareの片側。見出し・箇条書きどちらも空ならnullを返し、呼び出し側でcompare自体を
// bulletsに倒す判断材料にする。
function sanitizeCompareSide(v) {
  if (!v || typeof v !== 'object') return null;
  const heading = sanitizeString(v.heading);
  const bullets = sanitizeSlideBullets(v.bullets);
  if (!heading && !bullets.length) return null;
  return { heading, bullets };
}

// スライド1枚分を正規化する。layoutが6種以外・compareなのにleft/rightが欠けている、
// といった崩れはすべてbulletsに倒し、例外を投げず必ず描画できる形にそろえる
// （prompt.js の sanitizeSlide と同じ考え方の複製。中身が全部空のスライドはnullにして
// 呼び出し側で捨てる）。
function normalizeSlide(s) {
  if (!s || typeof s !== 'object') return null;

  const rawLayout = typeof s.layout === 'string' ? s.layout : '';
  let layout = SLIDE_LAYOUTS.includes(rawLayout) ? rawLayout : 'bullets';

  const heading = sanitizeString(s.heading);
  const note = sanitizeString(s.note);
  const lead = sanitizeString(s.lead);
  let bullets = sanitizeSlideBullets(s.bullets);
  let left = null;
  let right = null;

  if (layout === 'compare') {
    left = sanitizeCompareSide(s.left);
    right = sanitizeCompareSide(s.right);
    if (!left || !right) {
      // 片方しか無ければ、そこに書かれていた内容を箇条書きとして拾ってから倒す
      // （せっかく作らせた中身をここで消してしまわないため）。
      const salvaged = sanitizeSlideBullets([
        ...((left && left.bullets) || []),
        ...((right && right.bullets) || []),
      ]);
      if (salvaged.length) bullets = salvaged;
      layout = 'bullets';
      left = null;
      right = null;
    }
  }

  if (!heading && !lead && !bullets.length && !(left && right)) return null;

  return {
    layout, heading, note, lead, bullets, left, right,
  };
}

function normalizeDeck(doc) {
  const title = sanitizeString(doc && doc.title);
  const subtitle = sanitizeString(doc && doc.subtitle);
  const rawSlides = Array.isArray(doc && doc.slides) ? doc.slides : [];
  const slides = rawSlides.map(normalizeSlide).filter((s) => s !== null);
  return { title, subtitle, slides };
}

function addBottomBand(slide) {
  slide.addShape('rect', {
    x: 0, y: SLIDE_H_IN - 0.35, w: SLIDE_W_IN, h: 0.35,
    fill: { color: SLIDE_NAVY }, line: { type: 'none' },
  });
}

// 上部いっぱいの濃紺の帯に、白文字の見出しを重ねる（bullets用）。
function addHeadingBand(slide, heading) {
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W_IN, h: 1.0,
    fill: { color: SLIDE_NAVY }, line: { type: 'none' },
  });
  if (heading) {
    slide.addText(heading, {
      x: 0.5, y: 0, w: SLIDE_W_IN - 1.0, h: 1.0,
      fontFace: SLIDE_FONT, fontSize: 24, bold: true, color: SLIDE_WHITE, valign: 'middle',
    });
  }
}

// title: 中央にタイトル（40pt）、下にサブタイトル（18pt）、下端に濃紺の帯。
function drawTitleSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { color: SLIDE_WHITE };
  s.addText(slide.heading || '（無題）', {
    x: 0.6, y: 1.7, w: SLIDE_W_IN - 1.2, h: 1.3,
    fontFace: SLIDE_FONT, fontSize: 40, bold: true, color: SLIDE_NAVY, align: 'center', valign: 'middle',
  });
  if (slide.lead) {
    s.addText(slide.lead, {
      x: 0.6, y: 3.05, w: SLIDE_W_IN - 1.2, h: 0.7,
      fontFace: SLIDE_FONT, fontSize: 18, color: SLIDE_BODY_COLOR, align: 'center', valign: 'top',
    });
  }
  addBottomBand(s);
  return s;
}

// statement: キーメッセージを大きく（32pt）中央に。leadを下に小さく。
function drawStatementSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { color: SLIDE_WHITE };
  s.addText(slide.heading || '', {
    x: 0.6, y: 1.85, w: SLIDE_W_IN - 1.2, h: 1.4,
    fontFace: SLIDE_FONT, fontSize: 32, bold: true, color: SLIDE_NAVY, align: 'center', valign: 'middle',
  });
  if (slide.lead) {
    s.addText(slide.lead, {
      x: 0.6, y: 3.5, w: SLIDE_W_IN - 1.2, h: 0.8,
      fontFace: SLIDE_FONT, fontSize: 16, color: SLIDE_BODY_COLOR, align: 'center', valign: 'top',
    });
  }
  return s;
}

// bullets: 上部に濃紺の見出し帯、その下に箇条書き（20pt・行間広め）。最大5行。
function drawBulletsSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { color: SLIDE_WHITE };
  addHeadingBand(s, slide.heading);
  if (slide.bullets.length) {
    const runs = slide.bullets.map((line) => ({
      text: line,
      options: { bullet: true, breakLine: true, paraSpaceAfter: 18 },
    }));
    s.addText(runs, {
      x: 0.7, y: 1.4, w: SLIDE_W_IN - 1.4, h: SLIDE_H_IN - 1.8,
      fontFace: SLIDE_FONT, fontSize: 20, color: SLIDE_BODY_COLOR, valign: 'top',
    });
  }
  return s;
}

// compare: 左右2枚のカード（薄いグレー背景の角丸）。それぞれ見出し＋箇条書き。
function drawCompareSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { color: SLIDE_WHITE };
  if (slide.heading) {
    s.addText(slide.heading, {
      x: 0.5, y: 0.25, w: SLIDE_W_IN - 1.0, h: 0.7,
      fontFace: SLIDE_FONT, fontSize: 22, bold: true, color: SLIDE_NAVY, valign: 'middle',
    });
  }
  const cardY = 1.15;
  const cardH = SLIDE_H_IN - cardY - 0.35;
  const gap = 0.4;
  const cardW = (SLIDE_W_IN - 1.0 - gap) / 2;
  const cards = [
    { x: 0.5, side: slide.left },
    { x: 0.5 + cardW + gap, side: slide.right },
  ];
  cards.forEach(({ x, side }) => {
    s.addShape('roundRect', {
      x, y: cardY, w: cardW, h: cardH, rectRadius: 0.08,
      fill: { color: SLIDE_CARD_BG }, line: { color: SLIDE_HAIRLINE, width: 1 },
    });
    if (side.heading) {
      s.addText(side.heading, {
        x: x + 0.25, y: cardY + 0.2, w: cardW - 0.5, h: 0.5,
        fontFace: SLIDE_FONT, fontSize: 18, bold: true, color: SLIDE_NAVY, valign: 'top',
      });
    }
    if (side.bullets.length) {
      const runs = side.bullets.map((line) => ({
        text: line,
        options: { bullet: true, breakLine: true, paraSpaceAfter: 10 },
      }));
      s.addText(runs, {
        x: x + 0.25, y: cardY + 0.75, w: cardW - 0.5, h: cardH - 1.0,
        fontFace: SLIDE_FONT, fontSize: 15, color: SLIDE_BODY_COLOR, valign: 'top',
      });
    }
  });
  return s;
}

// image: 左に画像（縦横比を保って収める）、右にlead。
// 画像の引き伸ばしで資料を台無しにしないよう、pptxgenjsの
// sizing:{type:'contain'} を使う（枠に収まるよう縮小し、はみ出させない）。
function drawImageSlide(pptx, slide, image) {
  const s = pptx.addSlide();
  s.background = { color: SLIDE_WHITE };
  if (slide.heading) {
    s.addText(slide.heading, {
      x: 0.5, y: 0.25, w: SLIDE_W_IN - 1.0, h: 0.7,
      fontFace: SLIDE_FONT, fontSize: 22, bold: true, color: SLIDE_NAVY, valign: 'middle',
    });
  }
  const boxX = 0.5;
  const boxY = 1.15;
  const boxW = 5.2;
  const boxH = SLIDE_H_IN - boxY - 0.4;
  let imageDrawn = false;
  if (image && typeof image.path === 'string') {
    try {
      s.addImage({
        path: image.path,
        x: boxX, y: boxY, w: boxW, h: boxH,
        sizing: { type: 'contain', w: boxW, h: boxH },
      });
      imageDrawn = true;
    } catch (err) {
      imageDrawn = false; // 画像が壊れていても資料作成自体は止めない
    }
  }
  if (!imageDrawn) {
    // 想定外（画像が渡されなかった／壊れていて読めなかった）の保険。
    // 通常はここに来る前に呼び出し側でstatementに倒すので、来るのは異常系のみ。
    s.addShape('rect', {
      x: boxX, y: boxY, w: boxW, h: boxH,
      fill: { color: SLIDE_CARD_BG }, line: { color: SLIDE_HAIRLINE, width: 1 },
    });
  }
  const leadX = boxX + boxW + 0.4;
  const leadW = SLIDE_W_IN - leadX - 0.5;
  if (slide.lead) {
    s.addText(slide.lead, {
      x: leadX, y: boxY, w: leadW, h: boxH,
      fontFace: SLIDE_FONT, fontSize: 20, color: SLIDE_BODY_COLOR, valign: 'middle',
    });
  }
  return s;
}

// closing: 中央に「まとめ」と箇条書き、下端に帯。
function drawClosingSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { color: SLIDE_WHITE };
  s.addText(slide.heading || 'まとめ', {
    x: 0.6, y: 0.8, w: SLIDE_W_IN - 1.2, h: 0.9,
    fontFace: SLIDE_FONT, fontSize: 32, bold: true, color: SLIDE_NAVY, align: 'center', valign: 'middle',
  });
  if (slide.bullets.length) {
    const runs = slide.bullets.map((line) => ({
      text: line,
      options: { bullet: true, breakLine: true, paraSpaceAfter: 14 },
    }));
    s.addText(runs, {
      x: 1.2, y: 1.9, w: SLIDE_W_IN - 2.4, h: 2.7,
      fontFace: SLIDE_FONT, fontSize: 20, color: SLIDE_BODY_COLOR, valign: 'top',
    });
  }
  addBottomBand(s);
  return s;
}

// deck（{ title, subtitle, slides }）と画像一覧を PowerPoint(.pptx) に書き出す。
// images は images.js の extractImages が返す [{ id, path, sourceName, bytes }]。
// layoutが"image"のスライドに先頭から順に割り当て、足りなくなったらstatementとして描く。
// 想定外のデータ（slides無し・型違い・null）でも例外を投げない。
async function writePresentationPptx(doc, images, filePath) {
  const { title, subtitle, slides: normalizedSlides } = normalizeDeck(doc);
  const slides = normalizedSlides.length ? normalizedSlides : [{
    layout: 'title', heading: title || '（無題）', note: '', lead: subtitle, bullets: [], left: null, right: null,
  }];

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  const pool = Array.isArray(images) ? images.filter((im) => im && typeof im.path === 'string') : [];
  let imgIndex = 0;
  // pptxgenjsは画像ファイルの読み込みをwriteFile実行時まで遅延させるため、addImageの
  // 呼び出し時点でtry/catchしても存在しないファイルは検知できない。ここで事前に
  // 読めるかどうかを確認し、壊れている・消えている画像はスキップして次の画像を試す
  // （1枚壊れていても資料作成全体を止めないため）。
  const nextImage = () => {
    while (imgIndex < pool.length) {
      const candidate = pool[imgIndex];
      imgIndex += 1;
      try {
        accessSync(candidate.path, fsConstants.R_OK);
        return candidate;
      } catch (err) {
        // このファイルは諦めて次の画像へ
      }
    }
    return null;
  };

  for (const slide of slides) {
    let s;
    if (slide.layout === 'image') {
      const image = nextImage();
      s = image ? drawImageSlide(pptx, slide, image) : drawStatementSlide(pptx, slide);
    } else if (slide.layout === 'title') {
      s = drawTitleSlide(pptx, slide);
    } else if (slide.layout === 'statement') {
      s = drawStatementSlide(pptx, slide);
    } else if (slide.layout === 'compare') {
      s = drawCompareSlide(pptx, slide);
    } else if (slide.layout === 'closing') {
      s = drawClosingSlide(pptx, slide);
    } else {
      s = drawBulletsSlide(pptx, slide); // bullets（崩れた形の倒し先も含む）
    }
    if (slide.note) s.addNotes(slide.note);
  }

  await pptx.writeFile({ fileName: filePath });
}

module.exports = {
  buildHtml, writeDocx, writePdf, writePptx, writePresentationPptx,
};
