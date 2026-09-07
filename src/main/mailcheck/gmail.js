// src/main/mailcheck/gmail.js
// Gmail を IMAP で読む。アプリパスワード方式（Googleアカウントで発行する16桁）。
//
// 大事なのは**未読を未読のまま残す**こと。受信箱は readOnly で開き、本文は取りに行かず
// エンベロープ（差出人・件名・日時）だけを見る。ここを誤ると、確認しただけで既読になる。

const { ImapFlow } = require('imapflow');
const query = require('./query');

const HOST = 'imap.gmail.com';
const PORT = 993;
const TIMEOUT_MS = 20000;

// エラーを「利用者が次に何をすればいいか」が分かる形に振り分ける。
// 生のIMAPエラー文をそのまま出しても、何を直せばいいか分からない。
function classify(err) {
  const text = String((err && (err.responseText || err.message)) || '').toLowerCase();
  const code = String((err && (err.code || (err.cause && err.cause.code))) || '');
  if (text.includes('invalid credentials') || text.includes('authenticationfailed')
    || text.includes('auth') || err instanceof Error && err.authenticationFailed) {
    return {
      kind: 'auth',
      message: 'Gmailにログインできませんでした。メールアドレスとアプリパスワードを確認してください。'
        + '（通常のGoogleのパスワードではなく、2段階認証を有効にしたうえで発行する16桁のアプリパスワードが必要です）',
    };
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'].includes(code)
    || text.includes('timeout')) {
    return { kind: 'network', message: 'Gmailに接続できませんでした。ネットワークの状態を確認してください。' };
  }
  return { kind: 'unknown', message: `Gmailの確認に失敗しました: ${(err && err.message) || err}` };
}

function makeClient(address, appPassword) {
  return new ImapFlow({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user: address, pass: String(appPassword || '').replace(/\s/g, '') },
    logger: false,
    socketTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    connectionTimeout: TIMEOUT_MS,
  });
}

// エンベロープ（IMAPが返す差出人・宛先などの構造）を query.js が扱える形に均す。
function fromEnvelope(envelope, flags) {
  const e = envelope || {};
  const addr = (list) => (Array.isArray(list) ? list : [])
    .map((a) => (a && a.address) || '').filter(Boolean).join(', ');
  const first = Array.isArray(e.from) && e.from[0] ? e.from[0] : {};
  return {
    messageId: e.messageId || '',
    receivedAt: e.date || null,
    from: first.address || '',
    fromName: first.name || '',
    to: addr(e.to),
    cc: addr(e.cc),
    subject: e.subject || '',
    unread: !(flags && flags.has && flags.has('\\Seen')),
  };
}

// ログインできるかだけを確かめる（設定画面の「接続テスト」用）。
async function testConnection({ address, appPassword }) {
  const client = makeClient(address, appPassword);
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    try { await client.close(); } catch { /* すでに切れている */ }
    return { ok: false, ...classify(err) };
  }
}

// 監視している相手のメールを探す。見つかった順ではなく新しい順に返す。
async function check(options = {}) {
  const watch = query.normalizeWatchList(options.watch);
  if (watch.length === 0) return { ok: true, messages: [] };

  const searches = query.buildImapSearches({ ...options, watch });
  const client = makeClient(options.address, options.appPassword);
  const found = [];

  try {
    await client.connect();
    // readOnly で開く。ここを既定（読み書き）にすると、取得しただけで既読になり得る。
    await client.mailboxOpen('INBOX', { readOnly: true });

    for (const criteria of searches) {
      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) continue;
      // 新しいものから見る。古いメールを大量に持つ箱で待たされないよう上限を切る。
      const target = uids.slice(-200);
      for await (const msg of client.fetch(target, { envelope: true, flags: true }, { uid: true })) {
        found.push(query.normalizeMessage(fromEnvelope(msg.envelope, msg.flags), 'gmail'));
      }
    }
    await client.logout();
  } catch (err) {
    try { await client.close(); } catch { /* すでに切れている */ }
    return { ok: false, ...classify(err) };
  }

  // サーバ側で絞ってあるが、Outlook と同じ判定をもう一度通して結果をそろえる。
  const messages = query.sortMessages(query.dedupe(
    found.filter((m) => query.matchesWatch(m, { watch, match: options.match }))
  ));
  return { ok: true, messages };
}

module.exports = { check, testConnection, classify, fromEnvelope };
