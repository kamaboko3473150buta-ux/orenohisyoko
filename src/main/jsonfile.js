// src/main/jsonfile.js
// 設定・履歴を保存するJSONファイルの読み書き。
// 読めない・壊れている場合は既定値を返し、アプリを止めない。

const fs = require('node:fs');
const path = require('node:path');

function readJson(filePath, defaultValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed == null ? defaultValue : parsed;
  } catch {
    return defaultValue;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

module.exports = { readJson, writeJson };
