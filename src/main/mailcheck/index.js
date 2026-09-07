// src/main/mailcheck/index.js
// 受信確認の入口。Gmail(IMAP) と Outlook(COM) のどちらで探すかを選ぶだけで、
// 返す形はどちらも同じにする。
//
// AIは使わない。宛先や件名を外に投げる必要が無く、費用もかからないため。

const query = require('./query');
const gmail = require('./gmail');
const outlook = require('./outlook');

const PROVIDERS = [
  { id: 'gmail', label: 'Gmail', note: 'アプリパスワードが必要です' },
  { id: 'outlook', label: 'Outlook', note: 'この PC の Outlook をそのまま読みます' },
];

function normalizeProvider(value) {
  return value === 'outlook' ? 'outlook' : 'gmail';
}

// 設定に足りないものがあれば、先に分かる形で止める。
// 接続してからエラーになるより、何を入れればいいかが早く分かる。
function validate(options = {}) {
  const provider = normalizeProvider(options.provider);
  const watch = query.normalizeWatchList(options.watch);
  if (watch.length === 0) {
    return { ok: false, kind: 'no-watch', message: '確認する相手のメールアドレスを1件以上追加してください。' };
  }
  if (provider === 'gmail') {
    if (!query.isAddress(options.address)) {
      return { ok: false, kind: 'no-account', message: '設定でGmailのアドレスを入れてください。' };
    }
    if (!String(options.appPassword || '').trim()) {
      return { ok: false, kind: 'no-password', message: '設定でGmailのアプリパスワードを入れてください。' };
    }
  }
  return { ok: true, provider, watch };
}

async function check(options = {}) {
  const checked = validate(options);
  if (!checked.ok) return checked;
  const args = { ...options, provider: checked.provider, watch: checked.watch };
  return checked.provider === 'outlook' ? outlook.check(args) : gmail.check(args);
}

async function testConnection(options = {}) {
  const provider = normalizeProvider(options.provider);
  if (provider === 'outlook') return outlook.testConnection();
  if (!query.isAddress(options.address)) {
    return { ok: false, kind: 'no-account', message: 'Gmailのアドレスを入れてください。' };
  }
  if (!String(options.appPassword || '').trim()) {
    return { ok: false, kind: 'no-password', message: 'アプリパスワードを入れてください。' };
  }
  return gmail.testConnection(options);
}

// 一覧の行から、そのメールをメーラーで開くための情報を作る。
// Gmail はブラウザのURL、Outlook は EntryID を PowerShell に渡して開く。
function openTarget(message) {
  const m = message && typeof message === 'object' ? message : {};
  if (m.provider === 'outlook') {
    return m.entryId ? { kind: 'outlook', entryId: m.entryId } : { kind: 'none' };
  }
  return { kind: 'url', url: query.gmailSearchUrl(m.messageId) };
}

// 一覧の1通をメーラーで開く。Gmail はブラウザ、Outlook は本体を呼ぶ。
// URLを開くのは Electron 側の仕事なので、ここでは「何を開けばいいか」だけ返す。
async function openMessage(message) {
  const target = openTarget(message);
  if (target.kind === 'outlook') return outlook.openMessage(target.entryId);
  if (target.kind === 'url') return { ok: true, url: target.url };
  return { ok: false, error: '開くメールを特定できませんでした。' };
}

module.exports = {
  PROVIDERS, normalizeProvider, validate, check, testConnection, openTarget, openMessage, query,
};
