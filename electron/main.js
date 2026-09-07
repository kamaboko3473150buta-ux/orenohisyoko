// electron/main.js
const path = require('node:path');
const { app, BrowserWindow, ipcMain, safeStorage, screen } = require('electron');
const { APP_DIR_NAME, makePaths } = require('../src/main/paths');
const { loadSettings, saveSettings } = require('../src/main/settings');
const { readJson, writeJson } = require('../src/main/jsonfile');
const { summarize } = require('../src/main/usage');
const { MODELS, FEATURES } = require('../src/main/models');
const contactsLib = require('../src/main/contacts');
const mailCompose = require('../src/main/mail-compose');
const tasksFeature = require('../src/main/tasks-feature');
const docgen = require('../src/main/docgen');
const translate = require('../src/main/translate');

// 保存先を明示的に固定する（productNameが日本語でもフォルダ名を英字に保つため）
app.setPath('userData', path.join(app.getPath('appData'), APP_DIR_NAME));
const PATHS = makePaths(app.getPath('userData'));

function createWindow() {
  // 880は「息抜きの卓（写真＋札を並べる天板）が縮まずに収まる」高さ。
  // ただし画面（タスクバーを除いた作業領域）に入らない大きさで作ると、
  // ウィンドウが画面外にはみ出したり勝手に詰められたりするので、そこで頭打ちにする。
  // 入らないぶんは画面側で卓ごと小さくして吸収する（views/game-ui.js の fitScene）。
  const workArea = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1140, workArea.width - 20),
    height: Math.min(880, workArea.height - 20),
    title: '俺の秘書子',
    // 開発中（npm start）のウィンドウ左上・タスクバー用。
    // パッケージ後は exe に埋め込んだアイコンが使われる。
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
}

// --- 設定・履歴へのアクセス ---
const getSettings = () => loadSettings(PATHS.settings, safeStorage);
// contacts.json はアドレス帳（{ version: 2, contacts, groups }）。旧形式（宛先履歴の配列）が
// 残っていても migrate が必ず新形式に揃えるので、読み込み側は常に新形式を前提にできる。
const getContacts = () => contactsLib.migrate(readJson(PATHS.contacts, []));
const saveContacts = (book) => writeJson(PATHS.contacts, book);
const getHistory = () => readJson(PATHS.history, []);
const saveHistory = (list) => writeJson(PATHS.history, list);
const getUsage = () => readJson(PATHS.usage, {});
const saveUsage = (store) => writeJson(PATHS.usage, store);
const getTasks = () => readJson(PATHS.tasks, []);
const saveTasks = (list) => writeJson(PATHS.tasks, list);

function registerCommonHandlers() {
  // 画面にはAPIキーそのものを渡さない。設定済みかどうかだけ伝える。
  ipcMain.handle('settings:get', () => {
    const s = getSettings();
    return {
      hasApiKey: Boolean(s.apiKey),
      encrypted: s.encrypted,
      signature: s.signature,
      defaultTone: s.defaultTone,
      defaultMailer: s.defaultMailer,
      defaultTaskInput: s.defaultTaskInput,
      models: s.models,
    };
  });

  ipcMain.handle('settings:save', (_e, patch) => {
    saveSettings(PATHS.settings, patch, safeStorage);
    const s = getSettings();
    return {
      hasApiKey: Boolean(s.apiKey),
      encrypted: s.encrypted,
      signature: s.signature,
      defaultTone: s.defaultTone,
      defaultMailer: s.defaultMailer,
      defaultTaskInput: s.defaultTaskInput,
      models: s.models,
    };
  });

  // モデルの一覧と、機能ごとの既定モデル定義を画面に渡す（Task 33）。
  // APIキーなど秘匿情報は含まない。単価はmodels.jsに一本化されているのでそのまま渡す。
  ipcMain.handle('models:list', () => ({ models: MODELS, features: FEATURES }));

  ipcMain.handle('settings:counts', () => ({
    contacts: getContacts().contacts.length,
    history: getHistory().length,
  }));

  // 連絡先だけを消す。グループの定義自体は残す（グループが指す連絡先が
  // 無くなっても resolveGroup 側で黙って無視されるだけで、実害は無いため）。
  ipcMain.handle('settings:clearContacts', () => {
    saveContacts({ ...getContacts(), contacts: [] });
    return { ok: true };
  });
  ipcMain.handle('settings:clearHistory', () => { saveHistory([]); return { ok: true }; });

  // API利用状況（Task 19）。金額はこのアプリでの利用実績からの概算。
  ipcMain.handle('usage:get', () => summarize(getUsage()));
  ipcMain.handle('usage:clear', () => { saveUsage({}); return { ok: true }; });
}

app.whenReady().then(() => {
  // 起動時に一度、contacts.json が旧形式（宛先履歴の配列）なら新形式へ移行して保存し直す。
  // 既存ユーザーの宛先履歴（アドレス帳の連絡先の元）を消さないための移行。
  saveContacts(getContacts());

  registerCommonHandlers();
  mailCompose.register({ getSettings, getContacts, saveContacts, getHistory, saveHistory, getUsage, saveUsage });
  tasksFeature.register({ getSettings, getTasks, saveTasks, getUsage, saveUsage });
  docgen.register({ getSettings, getUsage, saveUsage });
  translate.register({ getSettings, getUsage, saveUsage });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 資料作成でプレゼン用に抽出した画像は、保存後に消しているが（doc:save）、保存せずに
// アプリを閉じた場合の保険として、終了時にも必ず一時フォルダを片付ける。
app.on('before-quit', () => {
  docgen.cleanupOnQuit();
});
