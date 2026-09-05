// src/main/docgen/readers.js
// 参考資料（txt/md/csv/docx/pptx/xlsx/pdf）からテキストを取り出す。
//
// 方針: 1つのファイルが読めなくても、他のファイルの処理を続けられるように、
// 例外を投げず必ず { ok, name, text, chars, error } を返す。参考資料が5つあって
// 1つ壊れているだけで作業全体が止まるのは困る、という要件のため。

const fs = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');
const { docxTextFromXml, pptxTextFromXml } = require('./office-text');

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.csv', '.docx', '.pptx', '.xlsx', '.pdf'];

// Excel要約の先頭何行を実データとして渡すか（それ以上は「他N行（省略）」）。
const SHEET_SAMPLE_ROWS = 30;

// 1ファイルあたりの上限文字数。超えたら truncateText で中略する。
const MAX_CHARS_PER_FILE = 40000;
const TRUNCATE_HEAD_CHARS = 30000;
const TRUNCATE_TAIL_CHARS = 10000;

function extOf(filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
}

function isSupported(filePath) {
  return SUPPORTED_EXTENSIONS.includes(extOf(filePath));
}

// pdfjs-dist は ESM 配布のみ（CommonJSのmainが無い）なので動的importで読み込む。
// 「legacy」ビルドを使うのは、通常ビルドが DOMMatrix / Path2D などブラウザのAPIを
// 前提にしており、Electronのメインプロセス（Node実行）では未定義でエラーになるため。
// legacyビルドはそれらが無い環境向けのフォールバック実装を内蔵している。
let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

async function readPlainText(filePath) {
  const buf = await fs.readFile(filePath, 'utf8');
  return buf;
}

// docx: word/document.xml だけを見る（ヘッダー・フッター・脚注は対象外。本文で十分なため）。
async function readDocxText(filePath) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) return '';
  const xml = zip.readAsText(entry);
  return docxTextFromXml(xml);
}

// pptx: ppt/slides/slideN.xml をスライド番号順に読み、スライドごとに空行区切りで連結する。
function slideNumber(entryName) {
  const m = /slide(\d+)\.xml$/.exec(entryName);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

async function readPptxText(filePath) {
  const zip = new AdmZip(filePath);
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  const texts = slideEntries.map((e) => pptxTextFromXml(zip.readAsText(e)));
  return texts.join('\n\n');
}

// セルの値を、なるべく元の型（数値・Date・文字列）を保ったまま取り出す。
// 数式・リッチテキスト・ハイパーリンクなどexceljsがオブジェクトで返してくる
// 場合があるため、想定外の形は "" にして [object Object] を防ぐ。
// 数値をここで文字列化しないのは、summarizeSheet側で「数値かどうか」を
// 型（typeof number）で判定できるようにするため。
function cellRawValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => (r && r.text) || '').join('');
    if (typeof v.text === 'string') return v.text; // ハイパーリンク等
    if (v.result != null) return v.result; // 数式の計算結果（数値ならそのまま数値）
    return '';
  }
  return v; // 数値・文字列・真偽値はそのまま
}

// 表示用の文字列にする。空/nullは""、Dateは日付だけの文字列にする。
function cellDisplay(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// シートの2次元配列（1行目=見出し、以降=データ）→ 要約テキスト。純粋関数。
//
// 生データを丸ごとAPIに渡すと費用が跳ね上がる（10万行渡しても資料に載るのは
// 合計・平均・上位いくつか）ため、先頭SHEET_SAMPLE_ROWS行のサンプルと
// 数値列の集計だけを渡す。省略した事実は必ず本文に明記する
// （書かないとAIが「全部見た」と誤解して断定的に書いてしまうため）。
function summarizeSheet(sheetName, matrix) {
  const rows = Array.isArray(matrix) ? matrix : [];
  const header = Array.isArray(rows[0]) ? rows[0] : [];
  // 行の中身が全て空の行は、要約対象からもサンプルからも除く（従来の挙動を踏襲）。
  const dataRows = rows
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((c) => cellDisplay(c) !== ''));
  const colCount = Math.max(header.length, ...dataRows.map((r) => r.length), 0);

  const lines = [];
  lines.push(`【${sheetName}】(データ${dataRows.length}行 / ${colCount}列)`);
  if (header.length) {
    lines.push(`見出し: ${header.map(cellDisplay).join('\t')}`);
  }

  const sample = dataRows.slice(0, SHEET_SAMPLE_ROWS);
  sample.forEach((row) => {
    lines.push(row.map(cellDisplay).join('\t'));
  });
  const omitted = dataRows.length - sample.length;
  if (omitted > 0) {
    lines.push(`他 ${omitted} 行（省略）`);
  }

  // 数値列の要約: 数値が過半を占める列だけを対象にする（日付・文字列の列は対象外）。
  // 空セルは分母（非空セル数）に含めない。
  const numericSummaries = [];
  for (let col = 0; col < colCount; col += 1) {
    const colName = cellDisplay(header[col]) || `列${col + 1}`;
    const numericValues = [];
    let nonEmptyCount = 0;
    dataRows.forEach((row) => {
      const v = row[col];
      if (cellDisplay(v) === '') return; // 空セルは飛ばす
      nonEmptyCount += 1;
      if (isFiniteNumber(v)) numericValues.push(v);
    });
    if (nonEmptyCount === 0 || numericValues.length <= nonEmptyCount / 2) continue;

    const count = numericValues.length;
    const sum = numericValues.reduce((a, b) => a + b, 0);
    const avg = sum / count;
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    numericSummaries.push(
      `${colName}: 件数${count} 合計${round2(sum)} 平均${round2(avg)} 最小${round2(min)} 最大${round2(max)}`,
    );
  }
  if (numericSummaries.length) {
    lines.push('[数値列の要約]');
    numericSummaries.forEach((s) => lines.push(s));
  }

  return lines.join('\n');
}

// 長い文字列を上限内に中略する。純粋関数。
// 先頭headChars字＋末尾tailChars字を残し、間を「……（中略：ここに約N字ありました）……」
// で明記する（省略した事実をAIに伝え、断定的な誤読を防ぐため）。
function truncateText(
  text,
  maxChars = MAX_CHARS_PER_FILE,
  headChars = TRUNCATE_HEAD_CHARS,
  tailChars = TRUNCATE_TAIL_CHARS,
) {
  const s = String(text == null ? '' : text);
  const originalChars = s.length;
  if (originalChars <= maxChars) {
    return { text: s, originalChars, truncated: false };
  }
  const head = s.slice(0, headChars);
  const tail = tailChars > 0 ? s.slice(originalChars - tailChars) : '';
  const omitted = originalChars - head.length - tail.length;
  const marker = `\n……（中略：ここに約${omitted}字ありました）……\n`;
  return { text: head + marker + tail, originalChars, truncated: true };
}

// xlsx: シートごとに全行をダンプせず、summarizeSheetで要約する。
async function readXlsxText(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const parts = [];
  wb.eachSheet((sheet) => {
    const matrix = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      matrix.push((row.values || []).slice(1).map(cellRawValue)); // valuesは先頭にnullが入る1始まりの配列
    });
    parts.push(summarizeSheet(sheet.name, matrix));
  });
  return parts.join('\n\n');
}

// pdf: ページごとにテキストを連結する。verbosity:0 は「標準フォントが無い」等の
// 描画向け警告を黙らせるため（テキスト抽出だけなら実害が無い）。
async function readPdfText(filePath) {
  const pdfjsLib = await loadPdfjs();
  const data = new Uint8Array(await fs.readFile(filePath));
  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await loadingTask.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => (it && it.str) || '').join(' '));
    }
    return pages.join('\n\n');
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

// 1ファイル分の読み取り。例外は絶対に外へ投げない。
async function readFileText(filePath) {
  const name = path.basename(String(filePath || ''));
  const ext = extOf(filePath);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      ok: false, name, text: '', chars: 0, originalChars: 0, truncated: false, error: 'この形式は読み取れません',
    };
  }
  try {
    let text;
    if (ext === '.txt' || ext === '.md' || ext === '.csv') {
      text = await readPlainText(filePath);
    } else if (ext === '.docx') {
      text = await readDocxText(filePath);
    } else if (ext === '.pptx') {
      text = await readPptxText(filePath);
    } else if (ext === '.xlsx') {
      text = await readXlsxText(filePath);
    } else if (ext === '.pdf') {
      text = await readPdfText(filePath);
    } else {
      text = ''; // ここには来ない想定（isSupportedと同じ一覧のため）
    }
    const safeText = String(text == null ? '' : text);
    // 1ファイルあたりの上限を超えたら中略する（xlsxは既に要約済みだが、シートが
    // 大量にある等の想定外ケースへの安全網としても働く）。chars は「実際に渡す
    // 文字数」のまま（呼び出し側の概算計算を壊さないため）、originalChars/truncated
    // で「元は何字あったか・省略したか」を別途伝える。
    const { text: finalText, originalChars, truncated } = truncateText(safeText, MAX_CHARS_PER_FILE);
    return {
      ok: true, name, text: finalText, chars: finalText.length, originalChars, truncated, error: null,
    };
  } catch (err) {
    return {
      ok: false, name, text: '', chars: 0, originalChars: 0, truncated: false, error: (err && err.message) || String(err),
    };
  }
}

// 複数ファイルをまとめて読む。1件失敗しても他は続ける（Promise.allSettledではなく
// readFileText自身が失敗を握りつぶすので、Promise.allで十分かつ順序も保たれる）。
async function readFiles(filePaths) {
  const list = Array.isArray(filePaths) ? filePaths : [];
  return Promise.all(list.map((p) => readFileText(p)));
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  isSupported,
  readFileText,
  readFiles,
  summarizeSheet,
  truncateText,
  SHEET_SAMPLE_ROWS,
  MAX_CHARS_PER_FILE,
};
