// src/main/contacts.js
// アドレス帳（連絡先・グループ）の純粋な更新関数。保存はしない。Electron に依存しない。
//
// 旧形式は store.js の upsertContact が作っていた「宛先履歴の配列」。
// 新形式は { version: 2, contacts: [...], groups: [...] } で、履歴ではなく資産として
// 上限を設けずに保持する（宛先履歴は最近使った順に上限付きで捨てていくが、
// アドレス帳は明示的に削除するまで残す）。

const crypto = require('node:crypto');

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// `c-xxxxxxxx` / `g-xxxxxxxx` 形式のIDを作る。8桁の16進数ランダム値。
function genId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function isNewFormat(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && raw.version === 2 && Array.isArray(raw.contacts);
}

// 旧形式（配列）・null・壊れたデータ・すでに新形式のいずれが来ても、
// 必ず { version: 2, contacts, groups } の形にそろえる。
function migrate(raw) {
  if (isNewFormat(raw)) {
    return { version: 2, contacts: raw.contacts, groups: asArray(raw.groups) };
  }
  if (Array.isArray(raw)) {
    const contacts = raw.map((item) => {
      const c = (item && typeof item === 'object') ? item : {};
      return { ...c, id: genId('c') };
    });
    return { version: 2, contacts, groups: [] };
  }
  return { version: 2, contacts: [], groups: [] };
}

function normalizeBook(book) {
  return {
    version: 2,
    contacts: asArray(book && book.contacts),
    groups: asArray(book && book.groups),
  };
}

// 連絡先を追加または上書きする。email（小文字化・前後空白除去）で同一人物とみなす。
// email が空なら何もしない（アドレス帳の連絡先はメールアドレスで引く前提のため）。
function upsertContact(book, contact, nowIso) {
  const b = normalizeBook(book);
  const email = clean(contact && contact.email);
  if (!email) return b;

  const key = email.toLowerCase();
  const idx = b.contacts.findIndex((c) => clean(c && c.email).toLowerCase() === key);
  const next = { ...contact, email, lastUsedAt: nowIso, id: idx === -1 ? genId('c') : b.contacts[idx].id };

  const contacts = b.contacts.slice();
  if (idx === -1) contacts.push(next);
  else contacts[idx] = next;
  return { ...b, contacts };
}

// 連絡先を削除する。所属していたグループの memberIds からも取り除く
// （メンバーが消えた連絡先を指したままだと resolveGroup で無視されるだけとはいえ、
// データとしては残さない方が扱いやすいため）。
function removeContact(book, id) {
  const b = normalizeBook(book);
  const contacts = b.contacts.filter((c) => !(c && c.id === id));
  const groups = b.groups.map((g) => (
    g ? { ...g, memberIds: asArray(g.memberIds).filter((m) => m !== id) } : g
  ));
  return { ...b, contacts, groups };
}

// グループを追加または上書きする。id が無ければ採番する。
function upsertGroup(book, group) {
  const b = normalizeBook(book);
  const id = (group && group.id) || genId('g');
  const next = { ...group, id };

  const idx = b.groups.findIndex((g) => g && g.id === id);
  const groups = b.groups.slice();
  if (idx === -1) groups.push(next);
  else groups[idx] = next;
  return { ...b, groups };
}

function removeGroup(book, id) {
  const b = normalizeBook(book);
  return { ...b, groups: b.groups.filter((g) => !(g && g.id === id)) };
}

// グループに属する連絡先を返す。存在しないメンバーIDは黙って飛ばす
// （連絡先が別途削除された後もグループ側の memberIds には残り得るため）。
function resolveGroup(book, groupId) {
  const b = normalizeBook(book);
  const group = b.groups.find((g) => g && g.id === groupId);
  if (!group) return [];
  return asArray(group.memberIds)
    .map((id) => b.contacts.find((c) => c && c.id === id))
    .filter(Boolean);
}

// 会社名→氏名の順に並べる。日本語の並び順のため localeCompare('ja') を使う。
function sortContacts(list) {
  return asArray(list).slice().sort((a, b) => {
    const co = clean(a && a.company).localeCompare(clean(b && b.company), 'ja');
    if (co !== 0) return co;
    return clean(a && a.name).localeCompare(clean(b && b.name), 'ja');
  });
}

module.exports = {
  migrate, upsertContact, removeContact, upsertGroup, removeGroup, resolveGroup, sortContacts,
};
