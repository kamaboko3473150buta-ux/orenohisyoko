// src/main/store.js
// 宛先履歴・文面履歴の更新。保存はしない純粋な関数なので、そのままテストできる。

const MAX_ITEMS = 100;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

// 宛先を追加または更新する。メールアドレスで同一判定し、最近使った順に並べる。
function upsertContact(list, contact, nowIso) {
  const email = String((contact && contact.email) || '').trim();
  if (!email) return asArray(list);

  const key = email.toLowerCase();
  const rest = asArray(list).filter((c) => String(c.email || '').toLowerCase() !== key);
  const next = { ...contact, email, lastUsedAt: nowIso };
  return [next, ...rest].slice(0, MAX_ITEMS);
}

// 文面履歴に1件足す。新しいものが先頭。
function addHistory(list, entry) {
  return [entry, ...asArray(list)].slice(0, MAX_ITEMS);
}

module.exports = { MAX_ITEMS, upsertContact, addHistory };
