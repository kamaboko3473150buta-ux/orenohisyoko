// src/main/mail-compose/draft.js
// 下書きを開くための組み立て。Outlook 起動以外は純粋な関数。

// ブラウザやOSがURLを切り落とす恐れのある長さ。これを超えたら本文はクリップボード経由にする。
const GMAIL_URL_LIMIT = 8000;

function buildGmailUrl({ to, subject, body } = {}) {
  const params = [
    `to=${encodeURIComponent(to || '')}`,
    `su=${encodeURIComponent(subject || '')}`,
  ];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `https://mail.google.com/mail/?view=cm&fs=1&${params.join('&')}`;
}

function isUrlTooLong(url) {
  return String(url || '').length > GMAIL_URL_LIMIT;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Outlook の HTMLBody に渡すための簡単な HTML に変換する。
function textToHtml(text) {
  const body = escapeHtml(text).replace(/\n/g, '<br>\n');
  return `<div style="font-family:'游ゴシック',sans-serif;font-size:11pt;">${body}</div>`;
}

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// パッケージ後(.exe)は __dirname が app.asar 内を指す。PowerShell は asar 内のファイルを
// 実行できないため、asarUnpack で実体化した app.asar.unpacked 側を参照する。
function resolveScriptPath() {
  let ps1 = path.join(__dirname, 'draft-outlook.ps1');
  if (ps1.includes(`app.asar${path.sep}`)) {
    ps1 = ps1.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  }
  return ps1;
}

// Outlook の新規メールウィンドウを開く。成功なら { ok: true }。
async function openOutlookDraft({ to, subject, body }) {
  const jobPath = path.join(os.tmpdir(), `hishoko-draft-${Date.now()}.json`);
  fs.writeFileSync(jobPath, JSON.stringify({ to, subject, html: textToHtml(body) }), 'utf8');

  try {
    await new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', resolveScriptPath(), '-JobPath', jobPath,
      ], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).trim()));
        else resolve(stdout);
      });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.unlinkSync(jobPath); } catch { /* 消せなくても実害なし */ }
  }
}

module.exports = {
  GMAIL_URL_LIMIT, buildGmailUrl, isUrlTooLong, escapeHtml, textToHtml, openOutlookDraft,
};
