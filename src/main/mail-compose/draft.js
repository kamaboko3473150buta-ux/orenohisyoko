// src/main/mail-compose/draft.js
// 下書きを開くための組み立て。Outlook 起動以外は純粋な関数。

// ブラウザやOSがURLを切り落とす恐れのある長さ。これを超えたら本文はクリップボード経由にする。
const GMAIL_URL_LIMIT = 8000;

// to/cc/bcc は文字列でも配列でも受け付ける。既存の呼び出しが文字列を渡しているため、
// 配列を足しても文字列側の挙動は変えない。配列は「; 」で連結する（Gmailは , でも ; でも通るが、
// 表示上わかりやすい ; に統一する）。
function toAddressString(v) {
  if (Array.isArray(v)) return v.join('; ');
  return v || '';
}

function buildGmailUrl({ to, cc, bcc, subject, body } = {}) {
  const params = [`to=${encodeURIComponent(toAddressString(to))}`];

  const ccStr = toAddressString(cc);
  if (ccStr) params.push(`cc=${encodeURIComponent(ccStr)}`);

  const bccStr = toAddressString(bcc);
  if (bccStr) params.push(`bcc=${encodeURIComponent(bccStr)}`);

  params.push(`su=${encodeURIComponent(subject || '')}`);
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
  // \r\n と \r を \n に正規化してから <br> に変換する（\r が本文に残らないように）。
  const normalized = escapeHtml(text).replace(/\r\n|\r/g, '\n');
  const body = normalized.replace(/\n/g, '<br>\n');
  return `<div style="font-family:'游ゴシック',sans-serif;font-size:11pt;">${body}</div>`;
}

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');

// パッケージ後(.exe)は __dirname が app.asar 内を指す。PowerShell は asar 内のファイルを
// 実行できないため、asarUnpack で実体化した app.asar.unpacked 側を参照する。
// baseDir を引数で受け取れるようにして、パッケージ後の状態をテストから再現できるようにする。
function resolveScriptPath(baseDir = __dirname) {
  let ps1 = path.join(baseDir, 'draft-outlook.ps1');
  if (ps1.includes(`app.asar${path.sep}`)) {
    ps1 = ps1.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  }
  return ps1;
}

// Outlook の新規メールウィンドウを開く。成功なら { ok: true }。
// to/cc/bcc は buildGmailUrl と同じく文字列・配列のどちらでも受け付ける。
async function openOutlookDraft({ to, cc, bcc, subject, body }) {
  // process.pid とランダムなUUIDを足して一意にする。連打などで同時に呼ばれても
  // ファイル名が衝突して別の宛先・本文の下書きが開いたり、読み取り中に消してしまう競合を防ぐ。
  const jobPath = path.join(os.tmpdir(), `hishoko-draft-${process.pid}-${randomUUID()}.json`);
  const job = {
    to: toAddressString(to),
    cc: toAddressString(cc),
    bcc: toAddressString(bcc),
    subject: subject || '',
    html: textToHtml(body),
  };
  fs.writeFileSync(jobPath, JSON.stringify(job), 'utf8');

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
  GMAIL_URL_LIMIT, buildGmailUrl, isUrlTooLong, escapeHtml, textToHtml, openOutlookDraft, resolveScriptPath,
};
