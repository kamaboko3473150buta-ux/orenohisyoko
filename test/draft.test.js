const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { buildGmailUrl, isUrlTooLong, textToHtml, GMAIL_URL_LIMIT, resolveScriptPath } = require('../src/main/mail-compose/draft');

test('Gmailの新規作成URLが組み立てられる', () => {
  const url = buildGmailUrl({ to: 'a@example.com', subject: '御礼', body: 'こんにちは' });
  assert.ok(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1'), '新規作成URLである');
  assert.ok(url.includes('to=a%40example.com'), '宛先がエスケープされている');
  assert.ok(url.includes(`su=${encodeURIComponent('御礼')}`), '件名がエスケープされている');
  assert.ok(url.includes(`body=${encodeURIComponent('こんにちは')}`), '本文がエスケープされている');
});

test('本文を省いたURLも作れる', () => {
  const url = buildGmailUrl({ to: 'a@example.com', subject: '御礼', body: '' });
  assert.ok(!url.includes('body='), 'body パラメータが付かない');
});

test('改行や&が壊れずにエスケープされる', () => {
  const url = buildGmailUrl({ to: 'a@example.com', subject: 'A&B', body: '1行目\n2行目' });
  assert.ok(url.includes('A%26B'), '&がエスケープされる');
  assert.ok(url.includes('%0A'), '改行がエスケープされる');
});

test('長すぎるURLを判定できる', () => {
  assert.strictEqual(isUrlTooLong('a'.repeat(GMAIL_URL_LIMIT - 1)), false);
  assert.strictEqual(isUrlTooLong('a'.repeat(GMAIL_URL_LIMIT + 1)), true);
});

test('プレーンテキストがHTMLに変換される', () => {
  const html = textToHtml('1行目\n2行目');
  assert.ok(html.includes('<br>'), '改行がbrになる');
  assert.ok(html.includes('1行目'), '本文が残る');
});

test('HTMLの特殊文字がエスケープされる', () => {
  const html = textToHtml('<script>alert(1)</script> & "引用"');
  assert.ok(!html.includes('<script>'), 'scriptタグがそのまま残らない');
  assert.ok(html.includes('&lt;script&gt;'), 'エスケープされている');
  assert.ok(html.includes('&amp;'), 'アンパサンドがエスケープされている');
});

test('ちょうど上限の長さのURLは長すぎと判定されない', () => {
  assert.strictEqual(isUrlTooLong('a'.repeat(GMAIL_URL_LIMIT)), false);
});

test('to/subjectが未指定でもundefinedという文字列が混ざらない', () => {
  const url = buildGmailUrl({});
  assert.ok(!url.includes('undefined'), 'undefined文字列が含まれない');
});

test('resolveScriptPathは通常時はdraft-outlook.ps1で終わるパスを返す', () => {
  const baseDir = path.join('C:', 'app', 'src', 'main', 'mail-compose');
  const result = resolveScriptPath(baseDir);
  assert.ok(result.endsWith('draft-outlook.ps1'), 'ps1で終わる');
  assert.ok(!result.includes('app.asar'), 'app.asarを含まない');
});

test('resolveScriptPathはapp.asarをapp.asar.unpackedへ置き換える', () => {
  const baseDir = path.join('C:', 'app', 'resources', 'app.asar', 'src', 'main', 'mail-compose');
  const result = resolveScriptPath(baseDir);
  assert.ok(result.includes(`app.asar.unpacked${path.sep}`), 'app.asar.unpackedへ置き換わる');
  assert.ok(!result.includes(`app.asar${path.sep}src`), '元のapp.asarのままではない');
});

// 回帰防止（Task 18）: draft-outlook.ps1 は BOM 無し UTF-8 で保存されると、
// Windows PowerShell 5.1 が ANSI（Shift-JIS）として読んでしまい、日本語コメント内の
// 全角括弧が壊れて ParserError になる。先頭に UTF-8 BOM (EF BB BF) が付いていることを確認する。
test('draft-outlook.ps1の先頭にUTF-8のBOMが付いている', () => {
  const scriptPath = path.join(__dirname, '..', 'src', 'main', 'mail-compose', 'draft-outlook.ps1');
  const fd = fs.openSync(scriptPath, 'r');
  const buf = Buffer.alloc(3);
  fs.readSync(fd, buf, 0, 3, 0);
  fs.closeSync(fd);
  assert.deepStrictEqual([...buf], [0xef, 0xbb, 0xbf], '先頭3バイトがEF BB BF（UTF-8 BOM）である');
});
