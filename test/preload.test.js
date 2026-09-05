const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// preload はサンドボックスで動くため、electron 以外の require は使えない。
// 普通のファイルを require すると preload 全体が失敗し、window.hishoko が
// 作られず全画面が「Cannot read properties of undefined」で壊れる。
// 実際にこれで v0.3.0 のタスク・資料作成・設定画面が使えなくなったので、
// 同じ壊れ方を繰り返さないようにここで縛る。
const PRELOAD = path.join(__dirname, '..', 'electron', 'preload.js');

// サンドボックスされた preload でも使える組み込み（Electron が用意している範囲）
const ALLOWED = ['electron', 'events', 'timers', 'url'];

test('preload は electron 以外のファイルを require していない', () => {
  const src = fs.readFileSync(PRELOAD, 'utf8');
  // コメント行を除いてから探す（説明文に require の字が出てくるため）
  const code = src.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const found = [...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

  assert.ok(found.length > 0, 'require が1つも無いのは想定外');
  for (const name of found) {
    assert.ok(
      ALLOWED.includes(name),
      `preload が ${name} を require している。サンドボックスでは読み込めず、`
      + 'preload 全体が失敗して window.hishoko が作られなくなる。'
      + 'メインプロセス側に処理を置いて IPC で受け渡すこと。',
    );
  }
});
