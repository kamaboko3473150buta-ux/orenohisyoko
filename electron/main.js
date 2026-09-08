// electron/main.js
const path = require('node:path');
const { app, BrowserWindow, ipcMain, safeStorage, screen, shell } = require('electron');
const { APP_DIR_NAME, makePaths } = require('../src/main/paths');
const { loadSettings, saveSettings } = require('../src/main/settings');
const {
  readJson, readJsonDetailed, writeJson, quarantine,
} = require('../src/main/jsonfile');
const { resolveBounds, boundsToSave, MIN_SIZE } = require('../src/main/window-state');
const { summarize } = require('../src/main/usage');
const { MODELS, FEATURES } = require('../src/main/models');
const contactsLib = require('../src/main/contacts');
const mailCompose = require('../src/main/mail-compose');
const tasksFeature = require('../src/main/tasks-feature');
const docgen = require('../src/main/docgen');
const translate = require('../src/main/translate');
const mailcheck = require('../src/main/mailcheck');
const news = require('../src/main/news');
const weather = require('../src/main/weather');

// 保存先を明示的に固定する（productNameが日本語でもフォルダ名を英字に保つため）
app.setPath('userData', path.join(app.getPath('appData'), APP_DIR_NAME));
const PATHS = makePaths(app.getPath('userData'));

// ウィンドウの形を覚えておき、次に開いたときは同じ形で開く。
// 閉じるときに書き出す（移動やサイズ変更のたびに書くと、書き込みが多くなりすぎる）。
function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    // 最大化中は「元に戻したときの形」を残す。最大化した形を覚えると次に戻せなくなる。
    const bounds = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    const value = boundsToSave(bounds);
    if (value) writeJson(PATHS.window, value);
  } catch {
    // 覚えられなくても起動と終了は止めない
  }
}

function createWindow() {
  // 前回の形を使う。無ければ 1140x880（息抜きの卓が縮まずに収まる大きさ）。
  // どちらにせよ画面の作業領域に収まるかを確かめてから使う。決め打ちで作ると、
  // 画面の小さい環境ではみ出す（1280x720 の画面に高さ880で作ってしまった実例あり）。
  const display = screen.getPrimaryDisplay();
  const bounds = resolveBounds(readJson(PATHS.window, null), display.workArea, display.bounds);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
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
  win.on('close', () => saveWindowState(win));
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
}

// --- 設定・履歴へのアクセス ---
const getSettings = () => loadSettings(PATHS.settings, safeStorage);
// contacts.json はアドレス帳（{ version: 2, contacts, groups }）。旧形式（宛先履歴の配列）が
// 残っていても migrate が必ず新形式に揃えるので、読み込み側は常に新形式を前提にできる。
const getContacts = () => contactsLib.migrate(readJson(PATHS.contacts, []));
const saveContacts = (book) => writeJson(PATHS.contacts, book);

// 起動時の移行。旧形式（宛先履歴の配列）なら新形式にして保存し直すが、
// **読めなかったときは何も書かない**。以前はここで空を書き戻していて、
// アドレス帳がまるごと消えることがあった。
// 壊れて読めないファイルは消さずに退避し、手で拾い直せるようにする。
function migrateContactsOnce() {
  const { value, state } = readJsonDetailed(PATHS.contacts, []);
  if (state === 'broken') {
    const kept = quarantine(PATHS.contacts);
    console.error('アドレス帳が読めませんでした。退避しました:', kept || '(退避できず)');
    return;
  }
  if (state === 'missing') return;          // 初回起動。書く必要が無い
  const migrated = contactsLib.migrate(value);
  // 形が変わったときだけ書く。毎回書き直すと、書き込みのたびに事故の機会が増える。
  if (JSON.stringify(migrated) !== JSON.stringify(value)) saveContacts(migrated);
}
const getHistory = () => readJson(PATHS.history, []);
const saveHistory = (list) => writeJson(PATHS.history, list);
const getUsage = () => readJson(PATHS.usage, {});
const saveUsage = (store) => writeJson(PATHS.usage, store);
const getTasks = () => readJson(PATHS.tasks, []);
const getDocDrafts = () => readJson(PATHS.docDrafts, []);
const saveDocDrafts = (list) => writeJson(PATHS.docDrafts, list);
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
      // 受信確認の設定。アプリパスワードそのものは、APIキーと同じく画面に渡さない。
      mailcheck: s.mailcheck,
      hasMailPassword: Boolean(s.mailAppPassword),
      news: s.news,
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
  // --- 受信確認（メールが届いているかの確認） ---
  // AIは使わないので、費用の記録もしない。
  ipcMain.handle('mailcheck:meta', () => ({
    providers: mailcheck.PROVIDERS,
    maxDays: mailcheck.query.MAX_DAYS,
  }));

  ipcMain.handle('mailcheck:run', async (_e, patch) => {
    const settings = getSettings();
    const conf = { ...settings.mailcheck, ...(patch || {}) };
    return mailcheck.check({
      provider: conf.provider,
      address: conf.gmailAddress,
      appPassword: settings.mailAppPassword,
      watch: conf.watch,
      match: conf.match,
      unreadOnly: conf.unreadOnly,
      days: conf.days,
    });
  });

  ipcMain.handle('mailcheck:test', async (_e, patch) => {
    const settings = getSettings();
    const conf = { ...settings.mailcheck, ...(patch || {}) };
    return mailcheck.testConnection({
      provider: conf.provider,
      address: conf.gmailAddress,
      // 入力中の値で試せるようにする（保存前に確かめたいことが多いため）
      appPassword: (patch && patch.appPassword) || settings.mailAppPassword,
    });
  });

  ipcMain.handle('mailcheck:open', async (_e, message) => {
    const result = await mailcheck.openMessage(message);
    if (result.ok && result.url) {
      await shell.openExternal(result.url);
      return { ok: true };
    }
    return result;
  });

  // 保存データのフォルダを開く。控えを取りたいときに自分でコピーできるようにする。
  ipcMain.handle('settings:openDataDir', async () => {
    await shell.openPath(app.getPath('userData'));
    return { ok: true, dir: app.getPath('userData') };
  });

  ipcMain.handle('usage:get', () => summarize(getUsage()));
  ipcMain.handle('usage:clear', () => { saveUsage({}); return { ok: true }; });
}

// 二重に起動させない。
// 同じ保存フォルダを2つのアプリで取り合うと、片方が書いた設定やアドレス帳を
// もう片方が上書きして消してしまう（バージョンを上げたときに実際に起きた。
// 前の版を開いたまま新しい版を入れて起動すると、両方が動いてしまう）。
// 2つ目が起動したら、すでに開いている窓を前に出して自分は終わる。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

app.whenReady().then(() => {
  // 起動時に一度、contacts.json が旧形式（宛先履歴の配列）なら新形式へ移行して保存し直す。
  // ただし**読めなかったときは書き戻さない**。以前はここで、読めなかった既定値（空）を
  // そのまま保存してしまい、アドレス帳が消えることがあった。
  migrateContactsOnce();

  registerCommonHandlers();
  mailCompose.register({ getSettings, getContacts, saveContacts, getHistory, saveHistory, getUsage, saveUsage });
  tasksFeature.register({ getSettings, getTasks, saveTasks, getUsage, saveUsage });
  docgen.register({ getSettings, getUsage, saveUsage, getDocDrafts, saveDocDrafts });
  translate.register({ getSettings, getUsage, saveUsage });
  news.register({ getSettings, getUsage, saveUsage });
  weather.register({ getSettings });
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
