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

// セル1個分を文字列にする。数式・リッチテキスト・ハイパーリンクなどexceljsが
// オブジェクトで返してくる場合があるため、想定外の形は "" にして [object Object] を防ぐ。
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => (r && r.text) || '').join('');
    if (typeof v.text === 'string') return v.text; // ハイパーリンク等
    if (v.result != null) return String(v.result); // 数式の計算結果
    return '';
  }
  return String(v);
}

// xlsx: シートごとに見出しを立て、行をタブ区切りで並べる。空セルは飛ばす。
// 行の中身が全て空になった場合はその行自体を出力しない。
async function readXlsxText(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const parts = [];
  wb.eachSheet((sheet) => {
    const lines = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values || [])
        .slice(1) // exceljsのrow.valuesは先頭にnullが入る1始まりの配列
        .map(cellText)
        .filter((t) => t !== '');
      if (cells.length) lines.push(cells.join('\t'));
    });
    parts.push([`【${sheet.name}】`, ...lines].join('\n'));
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
      // eslint-disable-next-line no-await-in-loop
      const page = await doc.getPage(i);
      // eslint-disable-next-line no-await-in-loop
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
    return { ok: false, name, text: '', chars: 0, error: 'この形式は読み取れません' };
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
    return { ok: true, name, text: safeText, chars: safeText.length, error: null };
  } catch (err) {
    return { ok: false, name, text: '', chars: 0, error: (err && err.message) || String(err) };
  }
}

// 複数ファイルをまとめて読む。1件失敗しても他は続ける（Promise.allSettledではなく
// readFileText自身が失敗を握りつぶすので、Promise.allで十分かつ順序も保たれる）。
async function readFiles(filePaths) {
  const list = Array.isArray(filePaths) ? filePaths : [];
  return Promise.all(list.map((p) => readFileText(p)));
}

module.exports = { SUPPORTED_EXTENSIONS, isSupported, readFileText, readFiles };
