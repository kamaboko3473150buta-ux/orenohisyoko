// src/main/docgen/fields.js
// 資料の種類ごとの入力項目。
//
// ねらいは「AIに推測させない」こと。日時・出席者・宛先・期限といった項目は
// 本来**創作してはいけない情報**で、一言メモに書き忘れるとAIは省くか、それらしく
// 作るしかなかった。ここで受け取った値は**AIを通さず**そのまま meta や表に流し込む。
// そうすれば表記が変わらず、送るトークンも減る。
//
// target の意味:
//   'meta'     … 文書の冒頭の項目表（{label, value}）にそのまま入れる
//   'contacts' … 表にする（1行 = 1件、カンマ区切り）
//   'hint'     … AIへの指示文に足す（枚数の目安・語り口など、判断が要るもの）

const FIELDS = {
  report: [
    { id: 'period', label: '対象期間', target: 'meta', placeholder: '例: 2026年4月〜9月' },
    { id: 'scope', label: '対象範囲', target: 'meta', placeholder: '例: 東日本エリアの直販分のみ' },
  ],
  minutes: [
    { id: 'datetime', label: '日時', target: 'meta', placeholder: '例: 2026年9月3日(水) 14:00〜15:00' },
    { id: 'place', label: '場所', target: 'meta', placeholder: '例: 本社3F 会議室A / オンライン' },
    { id: 'attendees', label: '出席者', target: 'meta', placeholder: '例: 山田部長、佐藤、鈴木' },
    { id: 'absentees', label: '欠席者', target: 'meta', placeholder: '例: 田中' },
  ],
  internal: [
    { id: 'issuedOn', label: '発信日', target: 'meta', placeholder: '例: 2026年9月7日' },
    { id: 'addressee', label: '宛先', target: 'meta', placeholder: '例: 営業部 各位' },
    { id: 'issuer', label: '発信者', target: 'meta', placeholder: '例: 総務部 山田' },
    { id: 'docNumber', label: '文書番号', target: 'meta', placeholder: '例: 総発第123号' },
  ],
  handover: [
    { id: 'jobName', label: '業務名', target: 'meta', placeholder: '例: 月次の経費精算' },
    { id: 'fromPerson', label: '引継ぐ人', target: 'meta', placeholder: '例: 山田（〜9月末）' },
    { id: 'toPerson', label: '引き継ぐ人', target: 'meta', placeholder: '例: 佐藤' },
    { id: 'handoverOn', label: '引継ぎ日', target: 'meta', placeholder: '例: 2026年9月30日' },
    {
      id: 'contacts',
      label: '関係連絡先',
      target: 'contacts',
      multiline: true,
      placeholder: '1行に1件、カンマ区切り\n例: 経理部 田中, 内線1234\n例: ○○商事 佐藤様, 03-0000-0000',
    },
  ],
  presentation: [
    { id: 'minutes', label: '発表時間（分）', target: 'hint', placeholder: '例: 10' },
    { id: 'audience', label: '想定聴衆', target: 'hint', placeholder: '例: 役員向け。専門用語は避ける' },
  ],
};

// 連絡先の表の見出し。列数はここで決まる。
const CONTACT_HEADERS = ['相手', '連絡先'];

function fieldsFor(typeId) {
  return FIELDS[typeId] || [];
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

// 保存されていた値をそのまま信用せず、その種類にある項目だけを残す。
function normalizeValues(typeId, values) {
  const known = fieldsFor(typeId);
  const src = values && typeof values === 'object' ? values : {};
  const out = {};
  for (const f of known) {
    const v = trim(src[f.id]);
    if (v) out[f.id] = v;
  }
  return out;
}

// 文書の冒頭に出す項目表。入力した順（＝FIELDSの並び）で作る。
function metaFromValues(typeId, values) {
  const v = normalizeValues(typeId, values);
  return fieldsFor(typeId)
    .filter((f) => f.target === 'meta' && v[f.id])
    .map((f) => ({ label: f.label, value: v[f.id] }));
}

// 連絡先を表にする。1行1件、最初のカンマで「相手」と「連絡先」に分ける
// （連絡先の中にカンマが入ることがあるため、分けるのは最初の1つだけ）。
function contactsTable(typeId, values) {
  const v = normalizeValues(typeId, values);
  const field = fieldsFor(typeId).find((f) => f.target === 'contacts');
  if (!field || !v[field.id]) return null;
  const rows = v[field.id]
    .split('\n')
    .map((line) => trim(line))
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(',');
      if (at === -1) return [line, ''];
      return [trim(line.slice(0, at)), trim(line.slice(at + 1))];
    });
  if (rows.length === 0) return null;
  return { headers: CONTACT_HEADERS.slice(), rows, label: field.label };
}

// AIへの指示に足す一言。判断が要るもの（枚数の目安・語り口）だけを渡す。
function hintsFromValues(typeId, values) {
  const v = normalizeValues(typeId, values);
  return fieldsFor(typeId)
    .filter((f) => f.target === 'hint' && v[f.id])
    .map((f) => `${f.label}: ${v[f.id]}`);
}

// 入力済みの項目名。AIに「これは利用者が入れたので作らないでほしい」と伝えるのに使う。
function suppliedLabels(typeId, values) {
  const v = normalizeValues(typeId, values);
  return fieldsFor(typeId)
    .filter((f) => f.target !== 'hint' && v[f.id])
    .map((f) => f.label);
}

// できあがった文書に、入力した項目を差し込む。
// 利用者が入れた値を先頭に置き、同じ見出しがAI側にもあれば**利用者の値を優先**する
// （表記が変わってしまうのを防ぐのがこの機能の目的のため）。
function applyToDoc(doc, typeId, values) {
  const base = doc && typeof doc === 'object' ? doc : {};
  const mine = metaFromValues(typeId, values);
  if (mine.length === 0 && !contactsTable(typeId, values)) return base;

  const taken = new Set(mine.map((m) => m.label));
  const theirs = (Array.isArray(base.meta) ? base.meta : [])
    .filter((m) => m && !taken.has(m.label));
  const next = { ...base, meta: mine.concat(theirs) };

  // 連絡先は表として、いちばん後ろの見出しに足す（引継ぎ資料の「連絡先」に相当）。
  const table = contactsTable(typeId, values);
  if (table) {
    const sections = Array.isArray(next.sections) ? next.sections.slice() : [];
    sections.push({ heading: table.label, paragraphs: [], bullets: [], table: { headers: table.headers, rows: table.rows } });
    next.sections = sections;
  }
  return next;
}

module.exports = {
  FIELDS, CONTACT_HEADERS, fieldsFor, normalizeValues, metaFromValues,
  contactsTable, hintsFromValues, suppliedLabels, applyToDoc,
};
