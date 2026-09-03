const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson, writeJson } = require('../src/main/jsonfile');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hishoko-test-'));
  return path.join(dir, 'data.json');
}

test('書いた内容がそのまま読み出せる', () => {
  const f = tmpFile();
  writeJson(f, { a: 1, b: 'あ' });
  assert.deepStrictEqual(readJson(f, {}), { a: 1, b: 'あ' });
});

test('ファイルが無ければ既定値を返す', () => {
  const f = tmpFile();
  assert.deepStrictEqual(readJson(f, { x: 9 }), { x: 9 });
});

test('中身が壊れていても既定値を返して落ちない', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{壊れたJSON', 'utf8');
  assert.deepStrictEqual(readJson(f, { x: 9 }), { x: 9 });
});

test('親フォルダが無くても書ける', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hishoko-test-'));
  const f = path.join(dir, 'nested', 'deep', 'data.json');
  writeJson(f, { ok: true });
  assert.deepStrictEqual(readJson(f, {}), { ok: true });
});

test('日本語が文字化けしない', () => {
  const f = tmpFile();
  writeJson(f, { name: '山田 太郎', memo: '御礼のメール' });
  assert.strictEqual(readJson(f, {}).name, '山田 太郎');
});
