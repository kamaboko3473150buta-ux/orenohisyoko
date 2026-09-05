// src/main/docgen/index.js
// 資料作成機能のIPCハンドラをまとめて登録する。他の機能（tasks-feature/index.js など）と
// 同じ形で、「保存する」「ファイル選択ダイアログを出す」「Claudeを呼ぶ」という副作用だけを担い、
// 中身のロジック（読み取り・プロンプト組み立て・書き出し）はdocgen配下の他ファイルに任せる。

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const { DOC_TYPES } = require('./types');
const { readFiles } = require('./readers');
const { extractImages, MAX_IMAGES } = require('./images');
const {
  buildOutlineSystemPrompt, buildOutlineUserPrompt, parseOutlineJson,
  buildBodySystemPrompt, buildBodyUserPrompt, parseBodyJson,
  buildSlideOutlineSystemPrompt, buildSlideOutlineUserPrompt,
  buildSlideBodySystemPrompt, buildSlideBodyUserPrompt, parseDeckJson,
} = require('./prompt');
const {
  OUTLINE_MAX_TOKENS, BODY_MAX_TOKENS, estimateYen, needsConfirm,
} = require('./estimate');
const {
  writeDocx, writePdf, writePptx, writePresentationPptx,
} = require('./writers');
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

// プレゼン用に添付から抽出した画像の一時状態（Task 35/38）。
// 抽出した画像は他人の資料の一部そのものなので、保存が終わったら（失敗しても）・
// 新しい資料作成を始めるときは必ず消す。1つの資料作成フローの間だけ有効な
// モジュール内の状態として持つ（このアプリはウィンドウ1枚・1ユーザー前提のため、
// セッション管理の仕組みを別途作るのはYAGNI）。
let imageSession = { images: [], dirs: [] };

// 抽出済みの画像と、それを保存した一時フォルダをすべて消す。
// 一時フォルダが1つも無い（何も抽出していない）場合も含め、例外は投げない。
async function cleanupImageSession() {
  const { dirs } = imageSession;
  imageSession = { images: [], dirs: [] };
  await Promise.all(dirs.map(async (dir) => {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      // 消せなくても資料作成自体には影響させない
    }
  }));
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
  // 添付の文字数からの概算費用。preload はサンドボックスでファイルを require できないため、
  // 計算はここ（メインプロセス）で行って画面に返す。
  ipcMain.handle('doc:estimate', (_e, { chars, modelId } = {}) => ({
    yen: estimateYen(chars, modelId),
    needsConfirm: needsConfirm(chars),
  }));

  // 新しい資料作成を始めるときに呼ぶ。前回抽出した画像と一時フォルダを消してからゼロに戻す
  // （資料作成画面を開くたびに画面側が呼ぶ。他人の資料の画像をいつまでも残さないため）。
  ipcMain.handle('doc:resetImages', async () => {
    await cleanupImageSession();
    return { ok: true };
  });

  ipcMain.handle('doc:readFiles', async (_e, { filePaths } = {}) => {
    const results = await readFiles(filePaths);

    // 添付からプレゼン用の画像を抽出する（Task 35/38）。読み取り自体は種類を問わず
    // 毎回行うが、実際に使うのはプレゼン資料のときだけ。1回のdoc:readFiles呼び出しごとに
    // 専用の一時フォルダを1つ作り、そのフォルダをセッションに積み増していく
    // （画面は複数回に分けて添付を追加できるため、既に抽出済みの分は残したまま追加する）。
    try {
      const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hishoko-docgen-img-'));
      const extracted = await extractImages(filePaths, outDir);
      if (extracted.length) {
        imageSession.images = imageSession.images.concat(extracted).slice(0, MAX_IMAGES);
        imageSession.dirs.push(outDir);
      } else {
        // 画像が1枚も無ければ、作っただけの空フォルダを残さず消す
        await fs.rmdir(outDir).catch(() => {});
      }
    } catch (err) {
      // 画像抽出に失敗しても、添付の読み取り自体（results）は返す
    }

    return { results, imageCount: imageSession.images.length };
  });

  // 構成案を作る（1回目のAPI呼び出し）。プレゼン資料だけは専用のプロンプト・解析を使う
  // （レポート等の {title, sections} とは別の deck 形式 {title, subtitle, slides} のため）。
  ipcMain.handle('doc:outline', async (_e, {
    typeId, brief, sources, model,
  } = {}) => {
    const isSlide = typeId === 'presentation';
    const settings = getSettings();
    const result = await generateText({
      apiKey: settings.apiKey,
      system: isSlide ? buildSlideOutlineSystemPrompt() : buildOutlineSystemPrompt(typeId),
      user: isSlide
        ? buildSlideOutlineUserPrompt({ brief, sources, imageCount: imageSession.images.length, today: todayYmd() })
        : buildOutlineUserPrompt({ typeId, brief, sources, today: todayYmd() }),
      maxTokens: OUTLINE_MAX_TOKENS,
      // 画面で選んだモデル（その回だけの上書き）。未指定なら設定の既定（資料作成）を使う。
      model: model || settings.models.docgen,
    });
    if (!result.ok) return result; // no_key / auth / timeout などはそのまま画面に伝える

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    if (isSlide) {
      const { deck, failed } = parseDeckJson(result.body);
      return { ok: true, outline: deck, failed };
    }
    const { outline, failed } = parseOutlineJson(result.body);
    return { ok: true, outline, failed };
  });

  // 確定した構成案から本文を作る（2回目のAPI呼び出し）
  ipcMain.handle('doc:body', async (_e, {
    typeId, brief, sources, outline, model,
  } = {}) => {
    const isSlide = typeId === 'presentation';
    const settings = getSettings();
    const result = await generateText({
      apiKey: settings.apiKey,
      system: isSlide ? buildSlideBodySystemPrompt() : buildBodySystemPrompt(typeId),
      user: isSlide
        ? buildSlideBodyUserPrompt({
          brief, sources, outline, imageCount: imageSession.images.length,
        })
        : buildBodyUserPrompt({
          typeId, brief, sources, outline, today: todayYmd(),
        }),
      maxTokens: BODY_MAX_TOKENS,
      model: model || settings.models.docgen,
    });
    if (!result.ok) return result;

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    if (isSlide) {
      const { deck, failed } = parseDeckJson(result.body);
      return { ok: true, doc: deck, failed };
    }
    const { doc, failed } = parseBodyJson(result.body);
    return { ok: true, doc, failed };
  });

  // 完成した資料をファイルに保存する。
  ipcMain.handle('doc:save', async (event, { doc, format } = {}) => {
    const ext = format === 'pdf' ? 'pdf' : format === 'pptx' ? 'pptx' : 'docx';
    const filterName = format === 'pdf' ? 'PDFファイル' : format === 'pptx' ? 'PowerPointファイル' : 'Wordファイル';
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
      } else if (format === 'pptx') {
        // deck形式（{ slides:[...] }）ならプレゼン専用の書き出しに、
        // それ以外（レポート等をPowerPoint形式で保存したい場合）は従来のwritePptxに渡す。
        if (doc && Array.isArray(doc.slides)) {
          await writePresentationPptx(doc, imageSession.images, filePath);
        } else {
          await writePptx(doc, filePath);
        }
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
    } finally {
      // 保存が終わったら（失敗しても）、抽出しておいた画像と一時フォルダを必ず消す。
      // 他人の資料から取り出した画像をいつまでも残さないため。
      await cleanupImageSession();
    }
  });
}

// アプリ終了時の保険。保存せずに資料作成画面から離れた・アプリごと閉じた場合でも、
// 抽出済みの画像の一時フォルダを残さないため呼び出し元（main.js）から使う。
function cleanupOnQuit() {
  return cleanupImageSession();
}

module.exports = { register, cleanupOnQuit };
