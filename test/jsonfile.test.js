// test/jsonfile.test.js
// 設定・アドレス帳の読み書き。**利用者のデータが消えるかどうか**が懸かっている場所。
// 実際にバージョンを上げたときアドレス帳と設定が消えたので、その再発を防ぐ。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readJson, readJsonDetailed, writeJson, writeJsonUnlessBroken, quarantine,
} = require('../src/main/jsonfile');

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hishoko-json-'));
  return path.join(dir, name || 'data.json');
}

test('読めれば ok、無ければ missing、壊れていれば broken', () => {
  const p = tmpFile();
  assert.deepStrictEqual(readJsonDetailed(p, []).state, 'missing');

  writeJson(p, { a: 1 });
  const ok = readJsonDetailed(p, []);
  assert.strictEqual(ok.state, 'ok');
  assert.deepStrictEqual(ok.value, { a: 1 });

  fs.writeFileSync(p, '{壊れたJSON', 'utf8');
  const broken = readJsonDetailed(p, []);
  assert.strictEqual(broken.state, 'broken');
  assert.deepStrictEqual(broken.value, [], '既定値は返すが、状態は broken と分かる');
});

test('「無い」と「読めない」を区別できる（これを混ぜると空で上書きしてしまう）', () => {
  const missing = readJsonDetailed(tmpFile(), { x: 1 });
  const broken = (() => { const p = tmpFile(); fs.writeFileSync(p, 'ゴミ'); return readJsonDetailed(p, { x: 1 }); })();
  assert.notStrictEqual(missing.state, broken.state);
});

test('壊れているときは書かない（空で上書きして消す事故を防ぐ）', () => {
  const p = tmpFile();
  fs.writeFileSync(p, '{壊れている', 'utf8');
  const r = writeJsonUnlessBroken(p, [], 'broken');
  assert.strictEqual(r.written, false);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '{壊れている', '元のファイルに手を触れない');

  const ok = writeJsonUnlessBroken(p, [{ name: '新しい' }], 'ok');
  assert.strictEqual(ok.written, true);
  assert.deepStrictEqual(readJson(p, []), [{ name: '新しい' }]);
});

test('書き込みは差し替え方式。直前の内容が .bak に残る', () => {
  const p = tmpFile();
  writeJson(p, { v: 1 });
  writeJson(p, { v: 2 });
  assert.deepStrictEqual(readJson(p, null), { v: 2 });
  assert.deepStrictEqual(readJson(`${p}.bak`, null), { v: 1 }, '1つ前に戻せる');
  assert.strictEqual(fs.existsSync(`${p}.tmp`), false, '作業用のファイルは残さない');
});

test('壊れたファイルは消さずに退避する', () => {
  const p = tmpFile();
  fs.writeFileSync(p, '{壊れている', 'utf8');
  const dest = quarantine(p);
  assert.ok(dest.includes('.broken-'));
  assert.strictEqual(fs.existsSync(p), false);
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), '{壊れている', '中身は残る（手で拾い直せる）');
  assert.strictEqual(quarantine(tmpFile()), '', '無いファイルを退避しようとしても落ちない');
});

test('フォルダが無くても書ける', () => {
  const p = path.join(os.tmpdir(), `hishoko-json-${Date.now()}`, 'deep', 'a.json');
  writeJson(p, { ok: true });
  assert.deepStrictEqual(readJson(p, null), { ok: true });
});
