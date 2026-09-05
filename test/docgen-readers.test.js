const test = require('node:test');
const assert = require('node:assert');
const { SUPPORTED_EXTENSIONS, isSupported, readFileText, readFiles } = require('../src/main/docgen/readers');

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
