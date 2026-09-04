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

// mail:generate の入力を { email, company, department, name, honorific, field } の配列に揃える。
// 新形式は input.recipients。旧形式（単一の input.recipient、field指定なし＝to扱い）も
// 引き続き受け付ける（既存の1件だけの宛先での動線を壊さないため）。
function normalizeRecipients(input) {
  if (Array.isArray(input && input.recipients) && input.recipients.length) {
    return input.recipients.map((r) => ({ ...r, field: (r && r.field) || 'to' }));
  }
  if (input && input.recipient) return [{ ...input.recipient, field: 'to' }];
  return [];
}

function emailsOf(recipients, field) {
  return recipients.filter((r) => r.field === field).map((r) => String(r.email || '').trim()).filter(Boolean);
}

function register({ getSettings, getContacts, saveContacts, getHistory, saveHistory, getUsage, saveUsage }) {
  // 場面・文体の一覧を画面に渡す
  ipcMain.handle('mail:meta', () => ({ scenes: SCENES, tones: TONES }));

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
    const recipients = normalizeRecipients(input);
    const toRecipients = recipients.filter((r) => r.field === 'to');

    const result = await generateBody({
      apiKey: settings.apiKey,
      system: buildSystemPrompt(),
      user: buildUserPrompt({ ...input, recipients: toRecipients }),
    });
    if (!result.ok) return result;

    const body = appendSignature(result.body, settings.signature);

    // 選んだ全員（To/CC/BCCすべて）をアドレス帳に upsert し、文面履歴・利用状況を記録する
    const now = new Date().toISOString();
    let book = getContacts();
    // field（to/cc/bcc）はこの1通だけの話なので、アドレス帳には持ち込まない
    recipients.forEach(({ field, ...contact }) => {
      book = bookLib.upsertContact(book, contact, now);
    });
    saveContacts(book);

    saveHistory(addHistory(getHistory(), {
      id: now, scene: input.sceneId, tone: input.toneId,
      to: emailsOf(recipients, 'to').join('; '),
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
  ipcMain.handle('mail:openOutlook', async (_e, {
    to, cc, bcc, subject, body,
  }) => openOutlookDraft({
    to, cc, bcc, subject, body,
  }));

  // Gmail の作成画面を開く。長すぎるときは本文をクリップボードへ
  ipcMain.handle('mail:openGmail', async (_e, {
    to, cc, bcc, subject, body,
  }) => {
    const full = buildGmailUrl({
      to, cc, bcc, subject, body,
    });
    if (!isUrlTooLong(full)) {
      await shell.openExternal(full);
      return { ok: true, copiedToClipboard: false };
    }
    clipboard.writeText(body);
    await shell.openExternal(buildGmailUrl({
      to, cc, bcc, subject, body: '',
    }));
    return { ok: true, copiedToClipboard: true };
  });

  // クリップボードにコピー。件名が無い（＝返信文作成）ときは本文だけをコピーする。
  ipcMain.handle('mail:copy', (_e, { subject, body }) => {
    clipboard.writeText(subject ? `${subject}\n\n${body}` : body);
    return { ok: true };
  });
}

module.exports = { register };
