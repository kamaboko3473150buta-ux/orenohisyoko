// src/main/paths.js
// 保存先の決定。Electron の userData（%APPDATA%\ore-no-hishoko）配下に置く。
// アプリ名に依存しないよう、main.js 側で明示的にこのフォルダ名を設定する。

const path = require('node:path');

const APP_DIR_NAME = 'ore-no-hishoko';

function makePaths(baseDir) {
  return {
    settings: path.join(baseDir, 'settings.json'),
    contacts: path.join(baseDir, 'contacts.json'),
    history: path.join(baseDir, 'history.json'),
  };
}

module.exports = { APP_DIR_NAME, makePaths };
