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
  Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType, ImageRun,
} = require('docx');
const PptxGenJS = require('pptxgenjs');

// 日本語（游ゴシック）が文字化けしないよう明示するフォント。
// buildHtml と同じ考え方（Windows標準搭載のフォントを優先し、無ければMeiryo系にフォールバック）。
const SLIDE_FONT = 'Yu Gothic';

// グラフ（Task 43）の配色。資料の配色（濃紺 #1F3864系）に合わせ、系列が複数あるときは
// 明度違いの濃紺〜青系で塗り分ける。'#'を含まない16進6桁（pptxgenjsの色指定と同じ形）。
const CHART_COLORS = ['1F3864', '2E5395', '8FAADC', 'BDD7EE', '548235', '9DC3E6'];

function chartColorHex(i) {
  return CHART_COLORS[i % CHART_COLORS.length];
}

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

// グラフ（Task 43）。docgen/prompt.js の sanitizeChart と同じ考え方の複製
// （writers.js を prompt.js に依存させたくないこと、画面で編集された後のdocが
// そのまま来ることもあり、prompt.jsの正規化を必ず通るとは限らないため）。
// labelsとseries.valuesの長さが合わない・数値でない値が混ざる系列は丸ごと捨てる。
// 系列が0本になればchart自体をnullにする。例外は投げない。
const CHART_TYPES = ['bar', 'line', 'pie'];

function normalizeChartSeries(v, expectedLength) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const name = sanitizeString(v.name);
  const rawValues = Array.isArray(v.values) ? v.values : null;
  if (!rawValues || rawValues.length !== expectedLength) return null;
  const values = [];
  for (const n of rawValues) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    values.push(n);
  }
  return { name, values };
}

function normalizeChart(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rawType = typeof v.type === 'string' ? v.type : '';
  const type = CHART_TYPES.includes(rawType) ? rawType : 'bar';
  const title = sanitizeString(v.title);
  const labels = sanitizeStringArray(v.labels);
  if (!labels.length) return null;
  const rawSeries = Array.isArray(v.series) ? v.series : [];
  const series = [];
  for (const s of rawSeries) {
    const sane = normalizeChartSeries(s, labels.length);
    if (sane) series.push(sane);
  }
  if (!series.length) return null;
  return {
    type, title, labels, series,
  };
}

// doc（想定外の形も含む）から、出力に使える形のmeta・セクション一覧を作る。
// heading・paragraphs・bullets・table・chart が全部空になるセクションは、出す意味が無いので捨てる。
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
    const chart = normalizeChart(s.chart);
    if (!heading && !paragraphs.length && !bullets.length && !table && !chart) continue;
    sections.push({
      heading, paragraphs, bullets, table, chart,
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

// ---- グラフのSVG描画（Task 43） ----------------------------------------------------
//
// buildChartSvg(chart, opts) は純粋関数（同じ入力なら同じ出力・副作用なし）。
// PDF出力ではこのSVGをそのままHTMLに埋め込み、Word出力ではElectronのBrowserWindowで
// これを読み込みcapturePageでPNG化する（writers.js内のrenderChartPng・writePdfと同じ仕組み）。
// chart はここに来る時点で normalizeChart 済み（labels・series.valuesの長さが揃っている）
// 前提だが、念のため呼び出し側の想定外（null・空）にも落ちないようにしておく。
// ラベルは本文からそのまま入るため、必ずSVGとしてエスケープする（escapeHtmlを流用。
// SVGのテキストノードでも &, <, >, " をエスケープすれば安全なのは同じ）。

function formatAxisNumber(n) {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

// 棒・折れ線グラフの本体（軸・凡例・データ）を組み立てる。
function buildAxisChartSvgBody(chart, width, height, type) {
  const { labels, series, title } = chart;
  const legendH = series.length > 1 ? 22 : 0;
  const marginTop = (title ? 30 : 10) + legendH;
  const marginBottom = 34;
  const marginLeft = 46;
  const marginRight = 16;
  const plotX = marginLeft;
  const plotY = marginTop;
  const plotW = Math.max(10, width - marginLeft - marginRight);
  const plotH = Math.max(10, height - plotY - marginBottom);

  const values = series.flatMap((s) => s.values);
  const maxVal = Math.max(0, ...values);
  const minVal = Math.min(0, ...values);
  const range = (maxVal - minVal) || 1;
  const valueToY = (v) => plotY + plotH - ((v - minVal) / range) * plotH;
  const zeroY = valueToY(0);

  const parts = [];

  if (title) {
    parts.push(`<text x="${width / 2}" y="20" text-anchor="middle" font-size="16" font-weight="bold" fill="#1F3864">${escapeHtml(title)}</text>`);
  }

  if (series.length > 1) {
    const legendY = (title ? 30 : 10) + 12;
    let lx = marginLeft;
    series.forEach((s, i) => {
      const label = s.name || `系列${i + 1}`;
      parts.push(`<rect x="${lx}" y="${legendY - 9}" width="10" height="10" fill="#${chartColorHex(i)}" />`);
      parts.push(`<text x="${lx + 14}" y="${legendY}" font-size="11" fill="#333333">${escapeHtml(label)}</text>`);
      lx += 24 + label.length * 8;
    });
  }

  // 軸（縦軸・0の位置を通る横軸）
  parts.push(`<line x1="${plotX}" y1="${plotY}" x2="${plotX}" y2="${plotY + plotH}" stroke="#999999" stroke-width="1" />`);
  parts.push(`<line x1="${plotX}" y1="${zeroY.toFixed(1)}" x2="${plotX + plotW}" y2="${zeroY.toFixed(1)}" stroke="#999999" stroke-width="1" />`);

  // 縦軸の目盛り（最小・中間・最大）
  const ticks = Array.from(new Set([minVal, (minVal + maxVal) / 2, maxVal]));
  ticks.forEach((v) => {
    const ty = valueToY(v);
    parts.push(`<line x1="${plotX - 4}" y1="${ty.toFixed(1)}" x2="${plotX}" y2="${ty.toFixed(1)}" stroke="#999999" stroke-width="1" />`);
    parts.push(`<text x="${plotX - 8}" y="${(ty + 3).toFixed(1)}" font-size="10" fill="#666666" text-anchor="end">${escapeHtml(formatAxisNumber(v))}</text>`);
  });

  // 横軸のカテゴリラベル
  const n = labels.length;
  const slotW = plotW / n;
  labels.forEach((label, i) => {
    const cx = plotX + slotW * (i + 0.5);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(plotY + plotH + 16).toFixed(1)}" font-size="10" fill="#333333" text-anchor="middle">${escapeHtml(label)}</text>`);
  });

  if (type === 'bar') {
    const groupPad = slotW * 0.15;
    const groupW = slotW - groupPad * 2;
    const barW = groupW / series.length;
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const barX = plotX + slotW * i + groupPad + barW * si;
        const vy = valueToY(v);
        const top = Math.min(vy, zeroY);
        const barH = Math.abs(vy - zeroY);
        parts.push(`<rect x="${barX.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${barH.toFixed(1)}" fill="#${chartColorHex(si)}" />`);
      });
    });
  } else {
    // line
    series.forEach((s, si) => {
      const points = s.values.map((v, i) => {
        const cx = plotX + slotW * (i + 0.5);
        const cy = valueToY(v);
        return `${cx.toFixed(1)},${cy.toFixed(1)}`;
      });
      parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="#${chartColorHex(si)}" stroke-width="2" />`);
      s.values.forEach((v, i) => {
        const cx = plotX + slotW * (i + 0.5);
        const cy = valueToY(v);
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="#${chartColorHex(si)}" />`);
      });
    });
  }

  return parts.join('\n');
}

// 円グラフの本体を組み立てる。系列は先頭の1本だけを使う（内訳の円グラフに複数系列は
// 意味を持たないため）。負の値は0扱いにする（扇形の角度計算が破綻しないようにするため）。
function buildPieSvgBody(chart, width, height) {
  const { labels, series, title } = chart;
  const values = series[0].values.map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0);
  const cx = width / 2;
  const cy = height / 2 + (title ? 10 : 0);
  const r = Math.min(width, height) * 0.3;

  const parts = [];
  if (title) {
    parts.push(`<text x="${width / 2}" y="20" text-anchor="middle" font-size="16" font-weight="bold" fill="#1F3864">${escapeHtml(title)}</text>`);
  }

  if (total <= 0) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F2F3F7" stroke="#C9D2E3" stroke-width="1" />`);
    parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-size="11" fill="#666666">データなし</text>`);
    return parts.join('\n');
  }

  let angle = -Math.PI / 2;
  labels.forEach((label, i) => {
    const v = values[i];
    if (!(v > 0)) return;
    const frac = v / total;
    const nextAngle = angle + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(nextAngle);
    const y2 = cy + r * Math.sin(nextAngle);
    const largeArc = (nextAngle - angle) > Math.PI ? 1 : 0;
    if (frac >= 0.999) {
      // 1系列のみ・全部が同じ項目のときはパスが潰れるため円そのものを描く。
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#${chartColorHex(i)}" />`);
    } else {
      parts.push(`<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="#${chartColorHex(i)}" />`);
    }
    angle = nextAngle;
  });

  const legendX = Math.min(width - 10, cx + r + 20);
  const legendStartY = cy - ((labels.length - 1) * 16) / 2;
  labels.forEach((label, i) => {
    const ly = legendStartY + i * 16;
    const pct = Math.round((values[i] / total) * 100);
    parts.push(`<rect x="${legendX}" y="${(ly - 9).toFixed(1)}" width="10" height="10" fill="#${chartColorHex(i)}" />`);
    parts.push(`<text x="${(legendX + 14).toFixed(1)}" y="${ly.toFixed(1)}" font-size="11" fill="#333333">${escapeHtml(label)} ${pct}%</text>`);
  });

  return parts.join('\n');
}

// chart（{type, title, labels, series}）から棒・折れ線・円グラフのSVG文字列を組み立てる
// 純粋関数。widthとheightは省略可（既定480x320）。chartが無い・系列や項目が0件など
// 描けない形なら空のSVGを返す（例外は投げない）。
function buildChartSvg(chart, opts = {}) {
  const width = Number(opts.width) > 0 ? Number(opts.width) : 480;
  const height = Number(opts.height) > 0 ? Number(opts.height) : 320;
  const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`;

  if (!chart || typeof chart !== 'object') return emptySvg;
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const series = Array.isArray(chart.series) ? chart.series : [];
  if (!labels.length || !series.length) return emptySvg;

  const type = chart.type === 'line' || chart.type === 'pie' ? chart.type : 'bar';
  const body = type === 'pie'
    ? buildPieSvgBody({
      ...chart, labels, series,
    }, width, height)
    : buildAxisChartSvgBody({
      ...chart, labels, series,
    }, width, height, type);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Yu Gothic, Meiryo, sans-serif">\n${body}\n</svg>`;
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
    if (section.chart) {
      body.push(`<div class="chart">${buildChartSvg(section.chart)}</div>`);
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
  table { border-collapse: collapse; margin: 8px 0 16px; }
  table.meta th, table.meta td, table.data th, table.data td {
    border: 1px solid #999; padding: 6px 10px; text-align: left; vertical-align: top;
  }
  table.meta th { background: #f2f2f2; white-space: nowrap; }
  table.data th { background: #f2f2f2; }
  .chart { margin: 8px 0 16px; }
  .chart svg { max-width: 100%; height: auto; }
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

// グラフをPNG画像にする（Task 43）。writePdfと同じ仕組みで、ElectronのBrowserWindowに
// SVGを読み込ませてcapturePageする。data URLではなく一時HTMLファイルを経由するのも
// writePdfと同じ理由（長さ制限やエンコードの落とし穴を避けるため）。
// browserWindowClassが渡らない・読み込みに失敗する等どんな理由でも、ここでは例外を
// 投げずnullを返す（呼び出し側でグラフを飛ばして処理を続けるため）。
async function renderSvgToPngBuffer(svg, browserWindowClass, { width, height }) {
  if (typeof browserWindowClass !== 'function') return null;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>`
    + `html,body{margin:0;padding:0;background:#ffffff;}</style></head><body>${svg}</body></html>`;
  const tempHtmlPath = path.join(os.tmpdir(), `docgen-chart-${process.pid}-${crypto.randomUUID()}.html`);

  let win = null;
  try {
    await fs.writeFile(tempHtmlPath, html, 'utf8');
    win = new browserWindowClass({
      show: false,
      width,
      height,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
      },
    });
    await win.loadFile(tempHtmlPath);
    const image = await win.webContents.capturePage();
    return image.toPNG();
  } catch (err) {
    return null; // 画像化に失敗しても資料作成自体は止めない
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    try {
      await fs.unlink(tempHtmlPath);
    } catch (err) {
      // 一時ファイルの削除に失敗しても本処理自体は継続する
    }
  }
}

const DOCX_CHART_WIDTH = 480;
const DOCX_CHART_HEIGHT = 300;

// セクションのchartをWordに挿入する段落を作る。browserWindowClassが無い・画像化に
// 失敗した場合はnullを返す（呼び出し側でグラフを飛ばす）。
async function buildDocxChartParagraph(chart, browserWindowClass) {
  if (!chart) return null;
  const svg = buildChartSvg(chart, { width: DOCX_CHART_WIDTH, height: DOCX_CHART_HEIGHT });
  const png = await renderSvgToPngBuffer(svg, browserWindowClass, {
    width: DOCX_CHART_WIDTH, height: DOCX_CHART_HEIGHT,
  });
  if (!png) return null;
  return new Paragraph({
    children: [new ImageRun({
      data: png,
      transformation: { width: DOCX_CHART_WIDTH, height: DOCX_CHART_HEIGHT },
      type: 'png',
    })],
  });
}

// Word用の段落一覧を組み立てる。タイトル→見出し1、セクション見出し→見出し2。
// meta はタイトル直後に2列の表として置き、セクションのtableは段落・箇条書きのあとに置く。
// グラフの画像化にはElectronが要るため、browserWindowClassが渡されたときだけ
// section.chartをPNGにして差し込む（省略時はこれまでどおりグラフを飛ばす）。
async function buildDocxChildren(doc, browserWindowClass) {
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
    if (section.chart) {
      // eslint-disable-next-line no-await-in-loop -- 画像化は1枚ずつ順番に行えば十分
      const chartParagraph = await buildDocxChartParagraph(section.chart, browserWindowClass);
      if (chartParagraph) {
        children.push(chartParagraph);
        children.push(new Paragraph({ text: '' }));
      }
    }
  }

  // docx は中身が1件も無い文書でも作れるが、中身が空の.docxは開いたときに
  // 何も無く不安にさせるため、最低限空の段落を1つ入れておく。
  if (!children.length) children.push(new Paragraph({ text: '' }));

  return children;
}

// doc を Word(.docx) ファイルに書き出す。
// browserWindowClass は省略可（Task 43）。Electronの BrowserWindow クラスを渡すと、
// セクションのグラフをPNG画像にして埋め込む。省略時はこれまでどおりグラフを飛ばして
// 書き出す（既存の呼び出し・テストを壊さないため）。
async function writeDocx(doc, filePath, browserWindowClass) {
  const document = new Document({
    sections: [{ children: await buildDocxChildren(doc, browserWindowClass) }],
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

const SLIDE_LAYOUTS = ['title', 'statement', 'bullets', 'compare', 'image', 'chart', 'closing'];
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
  let chart = null;

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

  if (layout === 'chart') {
    chart = normalizeChart(s.chart);
    if (!chart) {
      // グラフの数値は後から救済できる中身が無いため、compareと違い箇条書きへは
      // 空のまま倒す（bulletsが元々あればそれは残す）。
      layout = 'bullets';
    }
  }

  if (!heading && !lead && !bullets.length && !(left && right) && !chart) return null;

  return {
    layout, heading, note, lead, bullets, left, right, chart,
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

// chart: 上部に見出し帯無しの見出しテキスト、その下にpptxgenjsのネイティブグラフ
// （addChart）。Word/PDFのSVG（buildChartSvg）とは別経路で、PowerPointを開いた人が
// 値を編集できるネイティブなグラフオブジェクトとして埋め込む。
// normalizeSlideの時点でchartが無効ならbulletsに倒されるため、ここに来る
// slide.chartは常に有効な形（labels・series.valuesの長さが揃っている）。
function drawChartSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { color: SLIDE_WHITE };
  if (slide.heading) {
    s.addText(slide.heading, {
      x: 0.5, y: 0.25, w: SLIDE_W_IN - 1.0, h: 0.7,
      fontFace: SLIDE_FONT, fontSize: 22, bold: true, color: SLIDE_NAVY, valign: 'middle',
    });
  }

  const { chart } = slide;
  const chartType = chart.type === 'line' ? pptx.ChartType.line
    : chart.type === 'pie' ? pptx.ChartType.pie
    : pptx.ChartType.bar;

  // 円グラフは1系列を項目ごとの扇形にするため、色は項目（labels）の数だけ用意する。
  // 棒・折れ線は項目を横に並べ、系列ごとに色を変える。
  const isPie = chart.type === 'pie';
  const data = isPie
    ? [{ name: chart.title || '内訳', labels: chart.labels, values: chart.series[0].values }]
    : chart.series.map((series, i) => ({
      name: series.name || `系列${i + 1}`,
      labels: chart.labels,
      values: series.values,
    }));
  const chartColors = isPie
    ? chart.labels.map((_, i) => chartColorHex(i))
    : chart.series.map((_, i) => chartColorHex(i));

  s.addChart(chartType, data, {
    x: 0.6,
    y: 1.15,
    w: SLIDE_W_IN - 1.2,
    h: SLIDE_H_IN - 1.55,
    chartColors,
    showLegend: isPie || chart.series.length > 1,
    legendPos: 'b',
    legendColor: '333333',
    catAxisLabelColor: '333333',
    valAxisLabelColor: '333333',
    dataLabelColor: '333333',
    showTitle: false,
  });

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
    } else if (slide.layout === 'chart') {
      s = drawChartSlide(pptx, slide);
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
  buildHtml, buildChartSvg, writeDocx, writePdf, writePptx, writePresentationPptx,
};
