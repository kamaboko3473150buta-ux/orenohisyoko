// src/main/docgen/drafts.js
// 資料作成の下書き。作りかけの入力（と、できていれば構成案・本文）を残しておき、
// あとから続きをやれるようにする。
//
// これまでは画面を離れると入力が消えていたので、長い引継ぎ資料を一度で書き切る
// しかなかった。Terasu の下書き保存と同じ発想だが、あちらが入力だけなのに対し、
// こちらは**作った構成案・本文も一緒に**残す（作り直すとAPI費用がもう一度かかるため）。
//
// 参考資料は中身ではなく**場所（パス）だけ**を持つ。他人の資料の中身を
// アプリの保存領域に溜め込まないため。開くときに読み直し、無くなっていれば知らせる。

const MAX_DRAFTS = 30;         // 増えすぎると選ぶのが大変になる
const MAX_NAME = 60;

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, max) {
  const s = String(value == null ? '' : value).trim();
  return max ? s.slice(0, max) : s;
}

// 名前を決める。付けていなければ「何を作りたいか」の1行目を使い、それも無ければ日付。
function makeName(name, brief, savedAt) {
  const given = safeText(name, MAX_NAME);
  if (given) return given;
  const firstLine = safeText(String(brief || '').split('\n')[0], MAX_NAME);
  if (firstLine) return firstLine;
  const d = new Date(savedAt || nowIso());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} の下書き`;
}

// 保存されている一覧を、そのまま信用せず形にはめ直す。
function normalizeDraft(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const savedAt = typeof r.savedAt === 'string' ? r.savedAt : nowIso();
  return {
    id: safeText(r.id) || `d${Date.now()}${Math.random().toString(16).slice(2, 8)}`,
    name: makeName(r.name, r.brief, savedAt),
    savedAt,
    typeId: safeText(r.typeId) || 'report',
    brief: safeText(r.brief),
    format: safeText(r.format),
    filePaths: (Array.isArray(r.filePaths) ? r.filePaths : []).map((p) => safeText(p)).filter(Boolean),
    // 種類ごとの入力項目（日時・宛先など）。作りかけの一部なので一緒に残す。
    fieldValues: r.fieldValues && typeof r.fieldValues === 'object' ? r.fieldValues : {},
    // 作りかけの構成案・本文。無ければ null（入力だけの下書き）。
    outline: r.outline && typeof r.outline === 'object' ? r.outline : null,
    doc: r.doc && typeof r.doc === 'object' ? r.doc : null,
  };
}

function normalizeList(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeDraft);
}

// 新しい順に並べる。
function sortDrafts(list) {
  return list.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

// 保存する。同じ id があれば上書き、無ければ足す。上限を超えたら古いものから捨てる。
function saveDraft(list, draft) {
  const next = normalizeDraft({ ...draft, savedAt: nowIso() });
  const rest = normalizeList(list).filter((d) => d.id !== next.id);
  return { list: sortDrafts([next].concat(rest)).slice(0, MAX_DRAFTS), draft: next };
}

function removeDraft(list, id) {
  const target = safeText(id);
  return normalizeList(list).filter((d) => d.id !== target);
}

function findDraft(list, id) {
  const target = safeText(id);
  return normalizeList(list).find((d) => d.id === target) || null;
}

// 一覧に出すぶんだけ（中身の重い outline/doc は含めない）。
function toSummary(draft) {
  return {
    id: draft.id,
    name: draft.name,
    savedAt: draft.savedAt,
    typeId: draft.typeId,
    fileCount: draft.filePaths.length,
    hasOutline: Boolean(draft.outline),
    hasDoc: Boolean(draft.doc),
  };
}

module.exports = {
  MAX_DRAFTS, MAX_NAME, makeName, normalizeDraft, normalizeList, sortDrafts,
  saveDraft, removeDraft, findDraft, toSummary,
};
