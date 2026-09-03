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

module.exports = { GMAIL_URL_LIMIT, buildGmailUrl, isUrlTooLong, escapeHtml, textToHtml };
