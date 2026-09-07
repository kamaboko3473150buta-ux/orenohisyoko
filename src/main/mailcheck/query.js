// src/main/mailcheck/query.js
// 受信確認の「探し方」と「当たり判定」。Electron にもネットワークにも依存しない純粋関数。
//
// Gmail(IMAP) は絞り込みをサーバ側でやり、Outlook はローカルで絞る。
// 探し方が違っても**当たり判定はここ1か所**に集約し、どちらでも同じ結果になるようにする。

const MAX_DAYS = 365;
const DEFAULT_DAYS = 14;

// アドレスの表記ゆれをそろえる。大文字小文字と前後の空白は無視する。
// 「山田 <yamada@example.com>」のような形からアドレスだけを取り出す。
function normalizeAddress(value) {
  const s = String(value == null ? '' : value).trim();
  const angled = s.match(/<([^>]+)>/);
  return (angled ? angled[1] : s).trim().toLowerCase();
}

// 1つの文字列に複数の宛先が入っていることがある（To: a@x, b@y）。
function splitAddresses(value) {
  return String(value == null ? '' : value)
    .split(',')
    .map(normalizeAddress)
    .filter(Boolean);
}

function isAddress(value) {
  const a = normalizeAddress(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
}

// 監視する相手の一覧。空・重複・形式違いを落とす。
function normalizeWatchList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const address = normalizeAddress(item && typeof item === 'object' ? item.address : item);
    if (!isAddress(address) || seen.has(address)) continue;
    seen.add(address);
    const label = item && typeof item === 'object' && typeof item.label === 'string'
      ? item.label.trim() : '';
    out.push(label ? { address, label } : { address });
  }
  return out;
}

// 'from'（相手から届いた）/ 'to'（相手へ送った）/ 'both'
function normalizeMatch(value) {
  return value === 'to' || value === 'both' ? value : 'from';
}

function normalizeDays(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

// 「何日前から探すか」の起点。IMAP の SINCE も Outlook の絞り込みもこの日時を使う。
function sinceDate(days, now) {
  const base = now instanceof Date ? now : new Date();
  const d = new Date(base.getTime() - normalizeDays(days) * 24 * 60 * 60 * 1000);
  d.setHours(0, 0, 0, 0);   // IMAP の SINCE は日付単位なので、日の頭にそろえる
  return d;
}

// IMAP に投げる条件。アドレスごと・向きごとに1本ずつ作って、結果を後で束ねる
// （FROM と TO の OR を1本の検索で書くと、サーバによって解釈が揺れるため）。
function buildImapSearches(options = {}) {
  const addresses = normalizeWatchList(options.watch).map((w) => w.address);
  const match = normalizeMatch(options.match);
  const since = sinceDate(options.days, options.now);
  const fields = match === 'both' ? ['from', 'to'] : [match];

  const out = [];
  for (const address of addresses) {
    for (const field of fields) {
      const criteria = { since };
      if (options.unreadOnly) criteria.seen = false;
      criteria[field] = address;
      out.push(criteria);
    }
  }
  return out;
}

// 受け取ったメール1通が、探している相手に当てはまるか。
// Gmail はサーバ側で絞ってあるが、ここでも同じ判定を通して両者の結果をそろえる。
function matchesWatch(message, options = {}) {
  const addresses = new Set(normalizeWatchList(options.watch).map((w) => w.address));
  if (addresses.size === 0) return false;
  const match = normalizeMatch(options.match);

  const from = normalizeAddress(message && message.from);
  const to = []
    .concat(splitAddresses(message && message.to))
    .concat(splitAddresses(message && message.cc));

  if (match !== 'to' && addresses.has(from)) return true;
  if (match !== 'from' && to.some((a) => addresses.has(a))) return true;
  return false;
}

// 表示に使う形にそろえる。日付が読めないものは捨てず、並び順の最後に置く。
function normalizeMessage(raw, provider) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const at = new Date(r.receivedAt || r.date || 0);
  return {
    id: String(r.id || r.messageId || r.entryId || ''),
    provider: provider === 'outlook' ? 'outlook' : 'gmail',
    receivedAt: Number.isFinite(at.getTime()) && at.getTime() > 0 ? at.toISOString() : null,
    from: normalizeAddress(r.from),
    fromName: String(r.fromName || '').trim(),
    to: splitAddresses(r.to).join(', '),
    subject: String(r.subject == null ? '' : r.subject).trim(),
    unread: Boolean(r.unread),
    messageId: String(r.messageId || '').trim(),
    entryId: String(r.entryId || '').trim(),
  };
}

// 新しい順。日付が読めないものは末尾へ。
function sortMessages(list) {
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    const ta = a && a.receivedAt ? Date.parse(a.receivedAt) : -Infinity;
    const tb = b && b.receivedAt ? Date.parse(b.receivedAt) : -Infinity;
    return tb - ta;
  });
}

// 同じメールが複数の条件で拾われることがあるので、1通にまとめる。
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const key = m.messageId || m.entryId || m.id;
    if (!key || seen.has(key)) {
      if (!key) out.push(m);   // 手がかりが無いものは落とさずそのまま残す
      continue;
    }
    seen.add(key);
    out.push(m);
  }
  return out;
}

// Gmail でそのメールを開くURL。Message-ID でピンポイントに開ける。
function gmailSearchUrl(messageId) {
  const id = String(messageId || '').replace(/^<|>$/g, '').trim();
  if (!id) return 'https://mail.google.com/';
  return `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(id)}`;
}

module.exports = {
  DEFAULT_DAYS,
  MAX_DAYS,
  normalizeAddress,
  splitAddresses,
  isAddress,
  normalizeWatchList,
  normalizeMatch,
  normalizeDays,
  sinceDate,
  buildImapSearches,
  matchesWatch,
  normalizeMessage,
  sortMessages,
  dedupe,
  gmailSearchUrl,
};
