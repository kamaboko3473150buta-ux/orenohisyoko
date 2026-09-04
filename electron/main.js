// electron/main.js
const path = require('node:path');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const { APP_DIR_NAME, makePaths } = require('../src/main/paths');
const { loadSettings, saveSettings } = require('../src/main/settings');
const { readJson, writeJson } = require('../src/main/jsonfile');
const { summarize } = require('../src/main/usage');
const mailCompose = require('../src/main/mail-compose');
const tasksFeature = require('../src/main/tasks-feature');

// 保存先を明示的に固定する（productNameが日本語でもフォルダ名を英字に保つため）
app.setPath('userData', path.join(app.getPath('appData'), APP_DIR_NAME));
const PATHS = makePaths(app.getPath('userData'));

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
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
const getContacts = () => readJson(PATHS.contacts, []);
const saveContacts = (list) => writeJson(PATHS.contacts, list);
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
    };
  });

  ipcMain.handle('settings:counts', () => ({
    contacts: getContacts().length,
    history: getHistory().length,
  }));

  ipcMain.handle('settings:clearContacts', () => { saveContacts([]); return { ok: true }; });
  ipcMain.handle('settings:clearHistory', () => { saveHistory([]); return { ok: true }; });

  // API利用状況（Task 19）。金額はこのアプリでの利用実績からの概算。
  ipcMain.handle('usage:get', () => summarize(getUsage()));
  ipcMain.handle('usage:clear', () => { saveUsage({}); return { ok: true }; });
}

app.whenReady().then(() => {
  registerCommonHandlers();
  mailCompose.register({ getSettings, getContacts, saveContacts, getHistory, saveHistory, getUsage, saveUsage });
  tasksFeature.register({ getSettings, getTasks, saveTasks, getUsage, saveUsage });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
