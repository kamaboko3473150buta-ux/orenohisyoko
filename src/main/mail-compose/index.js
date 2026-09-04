// src/main/mail-compose/index.js
// メール文面作成機能のIPCハンドラをまとめて登録する。
// 新しい機能を足すときは、同じ形で src/main/<機能ID>/index.js を作る。

const { ipcMain, shell, clipboard } = require('electron');
const { SCENES, TONES } = require('./scenes');
const {
  buildSystemPrompt, buildUserPrompt, appendSignature,
  buildReplySystemPrompt, buildReplyUserPrompt,
} = require('./prompt');
const { buildGmailUrl, isUrlTooLong, openOutlookDraft } = require('./draft');
const { generateBody } = require('../claude');
const bookLib = require('../contacts');
const { addHistory } = require('../store');
const { addUsage } = require('../usage');

function register({ getSettings, getContacts, saveContacts, getHistory, saveHistory, getUsage, saveUsage }) {
  // 場面・文体の一覧を画面に渡す
  ipcMain.handle('mail:meta', () => ({ scenes: SCENES, tones: TONES }));

  // 宛先履歴を画面に渡す。getContacts()はアドレス帳（{version,contacts,groups}）を返すため、
  // 従来どおり配列を期待する呼び出し側（compose.jsの「履歴から選ぶ」）に合わせて contacts だけ渡す。
  ipcMain.handle('mail:contacts', () => getContacts().contacts);

  // 文面履歴を画面に渡す
  ipcMain.handle('mail:history', () => getHistory());

  // --- アドレス帳 ---
  ipcMain.handle('book:get', () => {
    const book = getContacts();
    return { ...book, contacts: bookLib.sortContacts(book.contacts) };
  });

  ipcMain.handle('book:upsertContact', (_e, contact) => {
    const book = bookLib.upsertContact(getContacts(), contact || {}, new Date().toISOString());
    saveContacts(book);
    return { ...book, contacts: bookLib.sortContacts(book.contacts) };
  });

  ipcMain.handle('book:removeContact', (_e, { id } = {}) => {
    const book = bookLib.removeContact(getContacts(), id);
    saveContacts(book);
    return { ...book, contacts: bookLib.sortContacts(book.contacts) };
  });

  ipcMain.handle('book:upsertGroup', (_e, group) => {
    const book = bookLib.upsertGroup(getContacts(), group || {});
    saveContacts(book);
    return { ...book, contacts: bookLib.sortContacts(book.contacts) };
  });

  ipcMain.handle('book:removeGroup', (_e, { id } = {}) => {
    const book = bookLib.removeGroup(getContacts(), id);
    saveContacts(book);
    return { ...book, contacts: bookLib.sortContacts(book.contacts) };
  });

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

    // 宛先と文面を履歴に残し、利用状況（トークン数）を記録する。
    // 宛先はアドレス帳（contacts.json）に upsert する（本タスクからは配列ではなく
    // { version:2, contacts, groups } 形式のため、store.js ではなく contacts.js を使う）。
    const now = new Date().toISOString();
    saveContacts(bookLib.upsertContact(getContacts(), input.recipient || {}, now));
    saveHistory(addHistory(getHistory(), {
      id: now, scene: input.sceneId, tone: input.toneId,
      to: (input.recipient && input.recipient.email) || '',
      subject: input.subject, body, createdAt: now,
    }));
    saveUsage(addUsage(getUsage(), result.usage, now));

    return { ok: true, body };
  });

  // 返信文を作る。宛先・件名・場面の指定は無い（すでにメーラーで「返信」を
  // 押している前提のため）。宛先が無いので宛先履歴には保存しない。
  ipcMain.handle('mail:generateReply', async (_e, input) => {
    const settings = getSettings();
    const result = await generateBody({
      apiKey: settings.apiKey,
      system: buildReplySystemPrompt(),
      user: buildReplyUserPrompt(input),
    });
    if (!result.ok) return result;

    const body = appendSignature(result.body, settings.signature);

    const now = new Date().toISOString();
    saveHistory(addHistory(getHistory(), {
      id: now, scene: 'reply', tone: input && input.toneId,
      to: '', subject: '', body, createdAt: now,
    }));
    saveUsage(addUsage(getUsage(), result.usage, now));

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

  // クリップボードにコピー。件名が無い（＝返信文作成）ときは本文だけをコピーする。
  ipcMain.handle('mail:copy', (_e, { subject, body }) => {
    clipboard.writeText(subject ? `${subject}\n\n${body}` : body);
    return { ok: true };
  });
}

module.exports = { register };
