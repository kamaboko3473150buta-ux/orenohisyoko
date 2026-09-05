const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const {
  SUPPORTED_EXTENSIONS,
  isSupported,
  readFileText,
  readFiles,
  summarizeSheet,
  truncateText,
  SHEET_SAMPLE_ROWS,
  MAX_CHARS_PER_FILE,
} = require('../src/main/docgen/readers');

// readers.js の本格的な検証（docx/pptx/xlsx/pdfの実ファイル）は実装時に手作業で確認済み。
// ここでは実ファイルが無くても書ける範囲（拡張子判定・存在しないファイル・非対応拡張子）を見る。

test('SUPPORTED_EXTENSIONSに計画どおりの拡張子が入っている', () => {
  assert.deepStrictEqual(SUPPORTED_EXTENSIONS, ['.txt', '.md', '.csv', '.docx', '.pptx', '.xlsx', '.pdf']);
});

test('isSupportedが対応拡張子を判定する(大文字も可)', () => {
  assert.strictEqual(isSupported('a.txt'), true);
  assert.strictEqual(isSupported('a.DOCX'), true);
  assert.strictEqual(isSupported('a.Pdf'), true);
  assert.strictEqual(isSupported('a.xlsx'), true);
  assert.strictEqual(isSupported('a.zzz'), false);
  assert.strictEqual(isSupported('a'), false);
  assert.strictEqual(isSupported(''), false);
});

test('対応していない拡張子は例外を投げずok:falseと理由を返す', async () => {
  const r = await readFileText('C:/dummy/path/file.xyz');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'この形式は読み取れません');
  assert.strictEqual(r.chars, 0);
});

test('存在しないファイルでも例外を投げずok:falseになる', async () => {
  await assert.doesNotReject(() => readFileText('C:/dummy/path/does-not-exist.txt'));
  const r = await readFileText('C:/dummy/path/does-not-exist.txt');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('readFilesは1件が失敗しても他の結果を返し、配列の順序を保つ', async () => {
  const results = await readFiles(['C:/dummy/a.xyz', 'C:/dummy/does-not-exist.txt']);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].ok, false);
  assert.strictEqual(results[1].ok, false);
});

test('readFilesは0件でも壊れない', async () => {
  assert.deepStrictEqual(await readFiles([]), []);
  assert.deepStrictEqual(await readFiles(undefined), []);
});

// --- summarizeSheet（Excelの要約・純粋関数） -------------------------------

test('summarizeSheetが見出し・行数・先頭N行・数値列の要約を返す', () => {
  const matrix = [
    ['名前', '金額', 'メモ'],
    ['田中', 100, 'A'],
    ['佐藤', 200, 'B'],
    ['鈴木', 300, 'C'],
  ];
  const text = summarizeSheet('Sheet1', matrix);
  assert.ok(text.includes('Sheet1'));
  assert.ok(text.includes('田中'));
  assert.ok(text.includes('名前')); // 見出し行
  // 数値列（金額）の要約: 件数・合計・平均・最小・最大
  assert.ok(text.includes('金額'));
  assert.ok(text.includes('件数3'));
  assert.ok(text.includes('合計600'));
  assert.ok(text.includes('平均200'));
  assert.ok(text.includes('最小100'));
  assert.ok(text.includes('最大300'));
});

test('summarizeSheetは数値でない列を要約に出さず、空セルは飛ばして判定する', () => {
  const matrix = [
    ['名前', 'コード'],
    ['田中', 'A-1'],
    ['佐藤', 'B-2'],
    ['鈴木', 'C-3'],
  ];
  const text = summarizeSheet('Sheet1', matrix);
  assert.ok(!text.includes('[数値列の要約]'));

  // 数値が過半を占める列だけを数値列とみなす（空セルは分母から除く）
  const halfNumeric = [
    ['項目', '値'],
    ['a', 10],
    ['b', 20],
    ['c', ''], // 空セルは判定から飛ばす（分母に含めない）
    ['d', 'テキスト'],
    ['e', 'テキスト2'],
  ];
  const text2 = summarizeSheet('Sheet1', halfNumeric);
  // 非空4件中 数値2件・非数値2件 → ちょうど半分なので「過半」ではなく数値列として扱わない
  assert.ok(!text2.includes('[数値列の要約]'));

  const majorityNumeric = [
    ['項目', '値'],
    ['a', 10],
    ['b', 20],
    ['c', ''], // 空セルは判定から飛ばす
    ['d', 'テキスト'],
  ];
  const text3 = summarizeSheet('Sheet1', majorityNumeric);
  // 非空3件中 数値2件・非数値1件 → 過半なので数値列として扱う
  assert.ok(text3.includes('[数値列の要約]'));
  assert.ok(text3.includes('件数2'));
});

test('summarizeSheetは先頭SHEET_SAMPLE_ROWSを超える行を「他N行（省略）」と明記する', () => {
  const header = ['no'];
  const rows = [];
  for (let i = 1; i <= 35; i += 1) rows.push([i]);
  const matrix = [header, ...rows];
  const text = summarizeSheet('Sheet1', matrix);
  assert.ok(text.includes(`他 ${35 - SHEET_SAMPLE_ROWS} 行（省略）`));
  const lines = text.split('\n');
  // 先頭SHEET_SAMPLE_ROWS行はサンプルとして1行ずつ出るが、それを超える行(31〜35)は
  // サンプル行としては出ない（数値列の要約の集計値として現れるのは別）。
  assert.ok(lines.includes(String(SHEET_SAMPLE_ROWS)));
  assert.ok(!lines.includes(String(SHEET_SAMPLE_ROWS + 1)));
});

test('summarizeSheetは空シート・空行でも例外を投げない', () => {
  assert.doesNotThrow(() => summarizeSheet('からっぽ', []));
  assert.doesNotThrow(() => summarizeSheet('からっぽ', [[]]));
});

// --- truncateText（長文の中略・純粋関数） -----------------------------------

test('truncateTextは上限以下ならそのまま返す', () => {
  const short = 'あ'.repeat(100);
  const r = truncateText(short, 1000);
  assert.strictEqual(r.text, short);
  assert.strictEqual(r.originalChars, 100);
  assert.strictEqual(r.truncated, false);
});

test('truncateTextは上限超えで先頭と末尾を残し、中略の印と元の文字数が分かる', () => {
  const head = 'H'.repeat(30000);
  const middle = 'M'.repeat(20000);
  const tail = 'T'.repeat(10000);
  const long = head + middle + tail;
  const r = truncateText(long, MAX_CHARS_PER_FILE);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.originalChars, long.length);
  assert.ok(r.text.startsWith('H'.repeat(100))); // 先頭が残っている
  assert.ok(r.text.endsWith('T'.repeat(100))); // 末尾が残っている
  assert.ok(r.text.includes('中略'));
  assert.ok(r.text.includes(String(middle.length))); // 省略した字数が分かる
  assert.ok(r.text.length < long.length);
});

// --- readFileText: 大きい.xlsxを実際に読ませて文字数が大幅に減ることを確認 ---

test('大きい.xlsxをreadFileTextに通すと、渡す文字数が元の全行ダンプより大幅に減る', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('売上');
  sheet.addRow(['日付', '商品', '数量', '単価', '金額']);
  const ROWS = 5000;
  let naiveDumpChars = '【売上】'.length;
  const headerLine = ['日付', '商品', '数量', '単価', '金額'].join('\t');
  naiveDumpChars += 1 + headerLine.length; // 見出し行も1行としてダンプされる想定
  for (let i = 1; i <= ROWS; i += 1) {
    const qty = (i % 50) + 1;
    const price = 100 + (i % 900);
    const row = [`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, `商品${i % 20}`, qty, price, qty * price];
    sheet.addRow(row);
    naiveDumpChars += 1 + row.join('\t').length;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docgen-xlsx-'));
  const filePath = path.join(tmpDir, 'big.xlsx');
  await wb.xlsx.writeFile(filePath);

  try {
    const result = await readFileText(filePath);
    assert.strictEqual(result.ok, true);
    // 実際に渡す文字数が、素朴に全行をダンプした場合よりも大幅に少ないこと
    assert.ok(
      result.chars < naiveDumpChars * 0.1,
      `chars(${result.chars}) should be far less than naive dump (${naiveDumpChars})`,
    );
    // 省略した事実が本文に明記されていること
    assert.ok(result.text.includes('省略'));
    assert.ok(result.text.includes('件数')); // 数値列の要約が入っている
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
