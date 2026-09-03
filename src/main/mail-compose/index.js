// src/main/mail-compose/index.js
// メール文面作成機能のIPCハンドラをまとめて登録する。
// 新しい機能を足すときは、同じ形で src/main/<機能ID>/index.js を作る。

const { ipcMain, shell, clipboard } = require('electron');
const { SCENES, TONES } = require('./scenes');
const { buildSystemPrompt, buildUserPrompt, appendSignature } = require('./prompt');
const { buildGmailUrl, isUrlTooLong, openOutlookDraft } = require('./draft');
const { generateBody } = require('../claude');
const { upsertContact, addHistory } = require('../store');

function register({ getSettings, getContacts, saveContacts, getHistory, saveHistory }) {
  // 場面・文体の一覧を画面に渡す
  ipcMain.handle('mail:meta', () => ({ scenes: SCENES, tones: TONES }));

  // 宛先履歴を画面に渡す
  ipcMain.handle('mail:contacts', () => getContacts());

  // 文面履歴を画面に渡す
  ipcMain.handle('mail:history', () => getHistory());

  // 文面を作る
  ipcMain.handle('mail:generate', async (_e, input) => {
    const settings = getSettings();
    const result = await generateBody({
      apiKey: settings.apiKey,
      system: buildSystemPrompt(),
      user: buildUserPrompt(input),
    });
    if (!result.ok) return result;

    const body = appendSignature(result.body, settings.signature);

    // 宛先と文面を履歴に残す
    const now = new Date().toISOString();
    saveContacts(upsertContact(getContacts(), input.recipient || {}, now));
    saveHistory(addHistory(getHistory(), {
      id: now, scene: input.sceneId, tone: input.toneId,
      to: (input.recipient && input.recipient.email) || '',
      subject: input.subject, body, createdAt: now,
    }));

    return { ok: true, body };
  });

  // Outlook の下書きを開く
  ipcMain.handle('mail:openOutlook', async (_e, { to, subject, body }) => openOutlookDraft({ to, subject, body }));

  // Gmail の作成画面を開く。長すぎるときは本文をクリップボードへ
  ipcMain.handle('mail:openGmail', async (_e, { to, subject, body }) => {
    const full = buildGmailUrl({ to, subject, body });
    if (!isUrlTooLong(full)) {
      await shell.openExternal(full);
      return { ok: true, copiedToClipboard: false };
    }
    clipboard.writeText(body);
    await shell.openExternal(buildGmailUrl({ to, subject, body: '' }));
    return { ok: true, copiedToClipboard: true };
  });

  // クリップボードにコピー
  ipcMain.handle('mail:copy', (_e, { subject, body }) => {
    clipboard.writeText(`${subject}\n\n${body}`);
    return { ok: true };
  });
}

module.exports = { register };
