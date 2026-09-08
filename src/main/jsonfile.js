// src/main/jsonfile.js
// 設定・履歴を保存するJSONファイルの読み書き。
//
// ここは**利用者のデータが消えるかどうか**が懸かっている場所なので、
// 「読めなければ既定値、書くときは上書き」という素朴な作りにはしない。
// 実際にバージョンを上げたときにアドレス帳と設定が消えた。原因は3つ:
//   1) 多重起動で2つのアプリが同じファイルを取り合った（防止は electron/main.js 側）
//   2) 読めなかったときに既定値（空）を返し、それをそのまま書き戻していた
//   3) 書き込みが途中で止まるとファイルが壊れた形で残った
// ここでは 2) と 3) に手当てする。

const fs = require('node:fs');
const path = require('node:path');

// 読み取りの結果。呼び出し側が「無いのか・壊れているのか」を区別できるようにする。
//   'ok'      … 読めた
//   'missing' … ファイルが無い（初回起動など。書いてよい）
//   'broken'  … ファイルはあるが読めない（**絶対に上書きしてはいけない**）
function readJsonDetailed(filePath, defaultValue) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { value: defaultValue, state: 'missing' };
    return { value: defaultValue, state: 'broken' };   // 権限・ロックなど
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null) return { value: defaultValue, state: 'broken' };
    return { value: parsed, state: 'ok' };
  } catch {
    return { value: defaultValue, state: 'broken' };
  }
}

// これまでどおりの読み取り。既存の呼び出しを壊さないため形は変えない。
function readJson(filePath, defaultValue) {
  return readJsonDetailed(filePath, defaultValue).value;
}

// 壊れて読めなかったファイルを、消さずに退避する。
// 中身を見れば手で拾い直せることがあるので、上書きする前に必ず残す。
function quarantine(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = `${filePath}.broken-${stamp}`;
    fs.renameSync(filePath, dest);
    return dest;
  } catch {
    return '';
  }
}

// 書き込み。**途中で止まっても元のファイルを壊さない**よう、
// 別名で書き切ってから差し替える。差し替える直前の内容は .bak に残す。
function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');

  // 直前の内容を1世代だけ残す。書き間違えても戻せるようにするため。
  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch {
    // 控えが取れなくても、書き込み自体は続ける
  }
  fs.renameSync(tmp, filePath);
}

// 読めなかったときに空で上書きしてしまう事故を防ぐための書き込み。
// state が 'broken' のときは書かず、何もしなかったことを返す。
function writeJsonUnlessBroken(filePath, value, state) {
  if (state === 'broken') return { written: false, reason: 'broken' };
  writeJson(filePath, value);
  return { written: true };
}

module.exports = {
  readJson, readJsonDetailed, writeJson, writeJsonUnlessBroken, quarantine,
};
