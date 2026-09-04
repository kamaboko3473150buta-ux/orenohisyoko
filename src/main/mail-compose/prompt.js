// src/main/mail-compose/prompt.js
// 宛名・プロンプト・署名の組み立て。Electron に依存しない純粋な関数だけを置く。

const { findScene, findTone } = require('./scenes');

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// 宛名ブロックを作る。
// 会社名は独立した行、部署と氏名は同じ行。
// 敬称は氏名があるときだけ付ける（様・御中・先生など、選ばれたものをそのまま）。
// 氏名が無いときは、人物用の敬称を部署や会社名に付けると不自然になるため、
// 「御中」が選ばれているときだけ、最終行（部署があれば部署、無ければ会社名）に付ける。
function buildAddressBlock({ company, department, name, honorific } = {}) {
  const co = clean(company);
  const dept = clean(department);
  const nm = clean(name);
  const hon = clean(honorific);

  const lines = [];

  if (nm) {
    const personLine = [dept, nm].filter(Boolean).join(' ');
    if (co) lines.push(co);
    lines.push(hon ? `${personLine} ${hon}` : personLine);
  } else {
    const last = dept || co;
    if (!last) return '';
    if (co && dept) lines.push(co);
    lines.push(hon === '御中' ? `${last} 御中` : last);
  }
  return lines.join('\n');
}

// 複数の値が「共通」と言えるときだけその値を返す。1件でも空欄（未入力）があれば
// 共通とはみなさない（空欄同士が一致していても「揃っている」とは言えないため）。
function commonValue(values) {
  const trimmed = values.map(clean);
  if (trimmed.some((v) => !v)) return null;
  const first = trimmed[0];
  return trimmed.every((v) => v === first) ? first : null;
}

// 複数宛先向けの宛名ブロックを作る。1件なら buildAddressBlock と同じ結果にする
// （宛先を複数対応にしても、これまでどおりの1件送信の見た目を変えないため）。
// 2件以上は会社・部署の共通度に応じて「各位」でまとめる。
function buildAddressBlockMulti(recipients) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (list.length === 0) return '';
  if (list.length === 1) return buildAddressBlock(list[0] || {});

  const company = commonValue(list.map((r) => (r || {}).company));
  const department = commonValue(list.map((r) => (r || {}).department));

  if (company && department) return `${company}\n${department} 各位`;
  if (company) return `${company} 各位`;
  return '関係者各位';
}

// AIへの役割指示。出力形式の制約はここで担保する
// （Opus 5 以降は assistant プレフィルが使えないため、system で指示する）。
function buildSystemPrompt() {
  return [
    'あなたは日本企業で働く経験豊富な秘書です。依頼された場面にふさわしいビジネスメールの本文を作成します。',
    '',
    '出力のきまり:',
    '- メールの本文のみを出力すること。前置き・解説・補足・マークダウン記法は一切書かない。',
    '- 件名は出力しない（件名は依頼者が別途指定する）。',
    '- 署名（会社名・氏名・連絡先）は書かない。依頼者のアプリが後から付ける。',
    '- 宛名は指定されたものをそのまま本文の冒頭に置く。',
    '- 事実を創作しない。日付・金額・人名など、指定されていない具体的な情報を勝手に作らない。',
    '  必要だが不明な情報がある場合は［ ］で囲んだ空欄にして、依頼者が埋められるようにする。',
    '- 1通のメールとして自然な長さにする。冗長にしない。',
  ].join('\n');
}

// 実際の依頼内容。場面・文体の guide をここに展開する。
function buildUserPrompt({ sceneId, toneId, recipient, subject, memo } = {}) {
  const scene = findScene(sceneId);
  const tone = findTone(toneId);
  const address = buildAddressBlock(recipient || {});

  return [
    `【場面】${scene.label}`,
    `【この場面の書き方】${scene.guide}`,
    '',
    `【文体】${tone.label}`,
    `【この文体の書き方】${tone.guide}`,
    '',
    '【宛名（本文の冒頭にこのまま置く）】',
    address || '（宛名の指定なし。宛名行は省略してよい）',
    '',
    `【件名】${clean(subject) || '（指定なし）'}`,
    '',
    '【伝えたいこと】',
    clean(memo) || '（指定なし）',
    '',
    '上記をふまえて、メール本文のみを出力してください。',
  ].join('\n');
}

const SIGNATURE_SEPARATOR = `\n\n${'-'.repeat(30)}\n`;

// 本文の末尾に署名を連結する。署名が空なら本文をそのまま返す。
// 本文が空（null/undefinedを含む）なら、区切り線を付けず署名だけを返す。
function appendSignature(body, signature) {
  const b = String(body == null ? '' : body).replace(/\s+$/, '');
  const s = clean(signature);
  if (!s) return b;
  if (!b) return s;
  return b + SIGNATURE_SEPARATOR + s;
}

// 返信文作成用のAIへの役割指示。
// 新規メール作成と違い、宛先・件名・場面の指定が無い（すでにメーラーで「返信」を
// 押している前提のため）。その代わり、引用や署名を付けないことを明確に指示する必要がある。
function buildReplySystemPrompt() {
  return [
    'あなたは日本企業で働く経験豊富な秘書です。受け取ったメールへの返信の本文を作成します。',
    '',
    '出力のきまり:',
    '- 返信の本文のみを出力すること。前置き・解説・補足・マークダウン記法は一切書かない。',
    '- 件名は出力しない（返信済みのメールに自動で入るため、依頼者のアプリは扱わない）。',
    '- 引用（「>」などを付けた元のメールの引用）は付けない。',
    '- 署名（会社名・氏名・連絡先）は書かない。依頼者のアプリが後から付ける。',
    '- 相手の会社名・氏名が受信メールの文面から読み取れる場合は、冒頭に宛名を置いてよい。',
    '- 事実を創作しない。受信メールに書かれていない日付・金額・条件などを勝手に作らない。',
    '  必要だが不明な情報がある場合は［ ］で囲んだ空欄にして、依頼者が埋められるようにする。',
    '- 受信メールに複数の質問や依頼が含まれる場合は、漏らさずすべてに触れる。',
  ].join('\n');
}

// 実際の依頼内容。受信メールの本文と、任意の一言メモをそのまま展開する。
function buildReplyUserPrompt({ toneId, received, memo } = {}) {
  const tone = findTone(toneId);

  return [
    `【文体】${tone.label}`,
    `【この文体の書き方】${tone.guide}`,
    '',
    '【受信したメールの本文】',
    clean(received) || '（本文なし）',
    '',
    '【伝えたいこと（任意。指定が無ければ受信メールの内容だけから判断すること）】',
    clean(memo) || '（指定なし）',
    '',
    '上記をふまえて、返信の本文のみを出力してください。',
  ].join('\n');
}

module.exports = {
  buildAddressBlock, buildAddressBlockMulti, buildSystemPrompt, buildUserPrompt, appendSignature,
  buildReplySystemPrompt, buildReplyUserPrompt,
};
