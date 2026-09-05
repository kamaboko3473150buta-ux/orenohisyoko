// src/main/translate/index.js
// 言語翻訳機能のIPCハンドラをまとめて登録する。docgen/index.js と同じ形で、
// 「ファイルを選ぶ」「保存する」「Claudeを呼ぶ」という副作用だけを担い、
// 中身のロジック（段落の分解・組み立て・プロンプト）は translate 配下の他ファイルに任せる。
//
// 流れ: pickFile → read（段落を数えて画面に表示、以後の翻訳のためにメモリ上に保持）→
// translateChunk（chunkItemsで分けた塊ごとに1回ずつ呼ぶ。画面側は逐次awaitすることで
// 「◯/◯ を翻訳中…」の進捗を出せる）→ すべて終わったら save（初めてWordの中身を書き換えて
// 別名で保存）。途中で1回でも失敗したらsaveは呼ばれない＝一部だけ訳した文書は絶対に作らない。

const path = require('node:path');
const AdmZip = require('adm-zip');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const { splitParagraphs, buildTranslatedParagraph, insertAfter } = require('./docx-edit');
const { LANGUAGES } = require('./languages');
const {
  buildTranslateSystemPrompt, buildTranslateUserPrompt, parseTranslationJson, chunkItems,
} = require('./prompt');
const { FEATURES, costJpy } = require('../models');
const { generateText } = require('../claude');
const { addUsage } = require('../usage');

// 1回のAPI呼び出しに許す出力の上限。1塊あたり最大4000字（chunkItemsの既定）の訳文＋
// JSONの記号・キーぶんの余裕を見て、多少高くつくとしても途中で切れてJSONが壊れないようにする。
const TRANSLATE_MAX_TOKENS = 8000;

// システムプロンプト・出力形式の指定など、原文以外にAPIへ送る分の目安（1回の呼び出しごと）。
const PROMPT_OVERHEAD_TOKENS = 300;

// 言語翻訳の既定モデル（設定で変えていないときの見積もりに使う）。
const DEFAULT_TRANSLATE_MODEL_ID = (FEATURES.find((f) => f.id === 'translate') || {}).defaultModel;

// 保存ダイアログの既定ファイル名にする。Windowsのファイル名に使えない文字を落とすだけの簡易版
// （docgen/index.js の sanitizeFileName と同じ考え方。role が違うため複製する）。
function sanitizeFileName(name) {
  const cleaned = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned || '訳文';
}

// 概算費用（円）。翻訳は入力と出力がほぼ同量になる前提で計算する（設計どおり）。
// chunkCountぶんのオーバーヘッド（システムプロンプト等）も足す。
function estimateTranslateYen(chars, chunkCount, modelId = DEFAULT_TRANSLATE_MODEL_ID) {
  const c = Number(chars);
  if (!Number.isFinite(c) || c <= 0) return 0;
  const n = Number(chunkCount) > 0 ? Number(chunkCount) : 1;
  return costJpy(modelId, {
    inputTokens: c + PROMPT_OVERHEAD_TOKENS * n,
    outputTokens: c,
  });
}

// 1つの資料作成フローの間だけ有効な、翻訳中の文書の状態（docgen/index.js の
// imageSession と同じ考え方）。このアプリはウィンドウ1枚・1ユーザー前提のため、
// セッション管理の仕組みを別途作るのはYAGNI。新しいファイルを読み込むたびに丸ごと置き換える。
let session = null;

function register({ getSettings, getUsage, saveUsage }) {
  // 訳したい言語の一覧（チップの表示用）。自由入力も許すため、一覧に無い言語名も
  // そのままtargetLanguageとして使える（languages.js の findLanguage は画面側では使わない）。
  ipcMain.handle('translate:languages', () => ({ languages: LANGUAGES }));

  // 翻訳するWord文書を選ぶ（単一選択。docxのみ）。
  ipcMain.handle('translate:pickFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '翻訳するWord文書を選ぶ',
      properties: ['openFile'],
      filters: [{ name: 'Wordファイル', extensions: ['docx'] }],
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: false, code: 'canceled' };
    return { ok: true, filePath: filePaths[0] };
  });

  // 選んだファイルを読み取り、翻訳対象の段落を数える。ここで読み取った内容（zip・
  // document.xml・段落の塊）をセッションに保持し、以降のtranslateChunk/saveで使い回す
  // （選び直すたびに丸ごと置き換わる。同時に複数の文書を扱う仕様は無いため）。
  ipcMain.handle('translate:read', (_e, { filePath } = {}) => {
    if (!filePath) {
      return { ok: false, code: 'no_file', message: 'ファイルが選ばれていません。' };
    }

    let zip;
    let documentXml;
    try {
      zip = new AdmZip(filePath);
      const entry = zip.getEntry('word/document.xml');
      if (!entry) throw new Error('word/document.xml が見つかりません');
      documentXml = zip.readAsText(entry);
    } catch (err) {
      return {
        ok: false,
        code: 'read_failed',
        message: 'ファイルを読み取れませんでした。Wordの.docxファイルか確認してください。',
      };
    }

    // 空段落・図だけの段落（<w:t>を持たない）は翻訳対象にしない。
    const paragraphs = splitParagraphs(documentXml);
    const targets = paragraphs.filter((p) => p.text && p.text.trim());
    const chunks = chunkItems(targets);
    const charCount = targets.reduce((sum, p) => sum + p.text.length, 0);

    session = {
      filePath,
      zip,
      documentXml,
      chunks,
      translated: new Array(chunks.length).fill(null), // 塊ごとの訳文配列。全部埋まったらsave可能
    };

    return {
      ok: true,
      fileName: path.basename(filePath),
      paragraphCount: targets.length,
      charCount,
      chunkCount: chunks.length,
    };
  });

  // 添付の文字数・塊数からの概算費用。モデルを変えるたびに画面から呼び直す。
  ipcMain.handle('translate:estimate', (_e, { chars, chunkCount, modelId } = {}) => ({
    yen: estimateTranslateYen(chars, chunkCount, modelId),
  }));

  // 塊（chunkItemsで分けたうちの1つ）を1回だけ翻訳する。画面側がchunkIndexを
  // 0から順にawaitして呼ぶことで、「◯/◯ を翻訳中…」の進捗を出しつつ、
  // すべての塊が終わってから translate:save で初めて文書を組み立てられるようにする。
  ipcMain.handle('translate:translateChunk', async (_e, { chunkIndex, targetLanguage, model } = {}) => {
    if (!session || !Number.isInteger(chunkIndex) || !session.chunks[chunkIndex]) {
      return {
        ok: false,
        code: 'no_session',
        message: '文書が選択されていません。もう一度ファイルを選んでください。',
      };
    }

    const chunk = session.chunks[chunkIndex];
    const settings = getSettings();
    const result = await generateText({
      apiKey: settings.apiKey,
      system: buildTranslateSystemPrompt(),
      user: buildTranslateUserPrompt({ targetLanguage, items: chunk }),
      maxTokens: TRANSLATE_MAX_TOKENS,
      model: model || settings.models.translate,
    });
    if (!result.ok) return result; // no_key / auth / timeout などはそのまま画面に伝える。saveは呼ばれない

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));

    const { texts, failed } = parseTranslationJson(result.body, chunk.map((it) => it.text));
    session.translated[chunkIndex] = texts;

    return {
      ok: true, failed, done: chunkIndex + 1, total: session.chunks.length,
    };
  });

  // すべての塊の翻訳が終わったあとに呼ぶ。元の段落の直後に訳文の段落を差し込み、
  // 別名で保存する（元のファイルは絶対に上書きしない）。
  ipcMain.handle('translate:save', async (event, { targetLanguageLabel } = {}) => {
    if (!session || !session.chunks.length || session.translated.some((t) => t == null)) {
      return {
        ok: false,
        code: 'incomplete',
        message: 'まだすべての翻訳が終わっていません。もう一度お試しください。',
      };
    }

    const insertions = [];
    session.chunks.forEach((chunk, ci) => {
      const texts = session.translated[ci];
      chunk.forEach((item, ii) => {
        insertions.push({ index: item.index, xml: buildTranslatedParagraph(item.xml, texts[ii]) });
      });
    });
    const newXml = insertAfter(session.documentXml, insertions);

    const baseName = sanitizeFileName(path.basename(session.filePath, path.extname(session.filePath)));
    const langPart = sanitizeFileName(targetLanguageLabel);
    const defaultPath = `${baseName}_${langPart}.docx`;

    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '翻訳した文書を保存',
      defaultPath,
      filters: [{ name: 'Wordファイル', extensions: ['docx'] }],
    });
    if (canceled || !filePath) return { ok: false, code: 'canceled' };

    // 最悪の事故（利用者の原本を壊すこと）を絶対に起こさないため、保存ダイアログで
    // 誤って元のファイルと同じ場所・同じ名前を選んでも、ここで弾いて上書きしない。
    if (path.resolve(filePath).toLowerCase() === path.resolve(session.filePath).toLowerCase()) {
      return {
        ok: false,
        code: 'same_file',
        message: '元のファイルを上書きすることはできません。別の名前で保存してください。',
      };
    }

    try {
      session.zip.updateFile('word/document.xml', Buffer.from(newXml, 'utf8'));
      await session.zip.writeZipPromise(filePath);
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

module.exports = { register, estimateTranslateYen };
