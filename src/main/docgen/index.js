// src/main/docgen/index.js
// 資料作成機能のIPCハンドラをまとめて登録する。他の機能（tasks-feature/index.js など）と
// 同じ形で、「保存する」「ファイル選択ダイアログを出す」「Claudeを呼ぶ」という副作用だけを担い、
// 中身のロジック（読み取り・プロンプト組み立て・書き出し）はdocgen配下の他ファイルに任せる。

const { ipcMain, dialog, BrowserWindow } = require('electron');
const { DOC_TYPES } = require('./types');
const { readFiles } = require('./readers');
const {
  buildOutlineSystemPrompt, buildOutlineUserPrompt, parseOutlineJson,
  buildBodySystemPrompt, buildBodyUserPrompt, parseBodyJson,
} = require('./prompt');
const { OUTLINE_OUTPUT_TOKENS, BODY_OUTPUT_TOKENS } = require('./estimate');
const { writeDocx, writePdf } = require('./writers');
const { generateText } = require('../claude');
const { addUsage } = require('../usage');

// 対応拡張子。readers.js の SUPPORTED_EXTENSIONS と同じ一覧をここにも持つ
// （こちらは「ファイルを選ぶ」ダイアログのフィルタ表示用で、role が違うため複製する）。
const OPEN_FILE_EXTENSIONS = ['txt', 'md', 'csv', 'docx', 'pptx', 'xlsx', 'pdf'];

// 'YYYY-MM-DD'（ローカル日付）。tasks-feature/index.js の todayYmd と同じ考え方
// （日付をまたぐ処理が無い小さな関数なので、ここでも複製する）。
function todayYmd(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 保存ダイアログの既定ファイル名にする。Windowsのファイル名に使えない文字を落とすだけの簡易版
// （凝った衝突回避などはしない。ユーザーはダイアログ上で自由に変えられるため）。
function sanitizeFileName(name) {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned || '資料';
}

function register({ getSettings, getUsage, saveUsage }) {
  // 資料の種類一覧（チップの表示・guideの埋め込みに使う）
  ipcMain.handle('doc:types', () => ({ types: DOC_TYPES }));

  // 参考資料のファイル選択（複数選択可）
  ipcMain.handle('doc:pickFiles', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '参考資料を選ぶ',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '対応ファイル', extensions: OPEN_FILE_EXTENSIONS },
      ],
    });
    if (canceled) return { filePaths: [] };
    return { filePaths: filePaths || [] };
  });

  // 選んだファイルをまとめて読み取る。1件読めなくても他は続ける（readers.js側の方針）。
  ipcMain.handle('doc:readFiles', async (_e, { filePaths } = {}) => {
    const results = await readFiles(filePaths);
    return { results };
  });

  // 構成案を作る（1回目のAPI呼び出し）
  ipcMain.handle('doc:outline', async (_e, {
    typeId, brief, sources, model,
  } = {}) => {
    const settings = getSettings();
    const result = await generateText({
      apiKey: settings.apiKey,
      system: buildOutlineSystemPrompt(typeId),
      user: buildOutlineUserPrompt({
        typeId, brief, sources, today: todayYmd(),
      }),
      maxTokens: OUTLINE_OUTPUT_TOKENS,
      // 画面で選んだモデル（その回だけの上書き）。未指定なら設定の既定（資料作成）を使う。
      model: model || settings.models.docgen,
    });
    if (!result.ok) return result; // no_key / auth / timeout などはそのまま画面に伝える

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    const { outline, failed } = parseOutlineJson(result.body);
    return { ok: true, outline, failed };
  });

  // 確定した構成案から本文を作る（2回目のAPI呼び出し）
  ipcMain.handle('doc:body', async (_e, {
    typeId, brief, sources, outline, model,
  } = {}) => {
    const settings = getSettings();
    const result = await generateText({
      apiKey: settings.apiKey,
      system: buildBodySystemPrompt(typeId),
      user: buildBodyUserPrompt({
        typeId, brief, sources, outline, today: todayYmd(),
      }),
      maxTokens: BODY_OUTPUT_TOKENS,
      model: model || settings.models.docgen,
    });
    if (!result.ok) return result;

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    const { doc, failed } = parseBodyJson(result.body);
    return { ok: true, doc, failed };
  });

  // 完成した資料をファイルに保存する。
  // PowerPoint（Task 31で別途実装予定）が選ばれたときは、保存ダイアログを出さず
  // 「準備中」を伝えるだけで終える（無いwritePptxを呼んで落ちないようにするため）。
  ipcMain.handle('doc:save', async (event, { doc, format } = {}) => {
    if (format === 'pptx') {
      return {
        ok: false,
        code: 'not_ready',
        message: 'PowerPoint出力は準備中です。今はWordかPDFでご利用ください。',
      };
    }

    const ext = format === 'pdf' ? 'pdf' : 'docx';
    const filterName = format === 'pdf' ? 'PDFファイル' : 'Wordファイル';
    const baseName = sanitizeFileName(doc && doc.title);

    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '資料を保存',
      defaultPath: `${baseName}.${ext}`,
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (canceled || !filePath) return { ok: false, code: 'canceled' };

    try {
      if (format === 'pdf') {
        await writePdf(doc, filePath, BrowserWindow);
      } else {
        await writeDocx(doc, filePath);
      }
      return { ok: true, filePath };
    } catch (err) {
      return {
        ok: false,
        code: 'write_failed',
        message: `保存に失敗しました（${(err && err.message) || err}）`,
      };
    }
  });
}

module.exports = { register };
