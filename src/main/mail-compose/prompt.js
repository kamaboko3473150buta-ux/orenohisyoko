// src/main/mail-compose/prompt.js
// 宛名・プロンプト・署名の組み立て。Electron に依存しない純粋な関数だけを置く。

const { findScene, findTone } = require('./scenes');

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// 宛名ブロックを作る。
// 会社名は独立した行、部署と氏名は同じ行。敬称は「氏名がある行」の末尾に付ける。
// 氏名も部署も無いときは会社名の行に敬称を付ける（例: 株式会社○○ 御中）。
function buildAddressBlock({ company, department, name, honorific } = {}) {
  const co = clean(company);
  const dept = clean(department);
  const nm = clean(name);
  const hon = clean(honorific);

  const personLine = [dept, nm].filter(Boolean).join(' ');
  const lines = [];

  if (personLine) {
    if (co) lines.push(co);
    lines.push(hon ? `${personLine} ${hon}` : personLine);
  } else if (co) {
    lines.push(hon ? `${co} ${hon}` : co);
  }
  return lines.join('\n');
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
function appendSignature(body, signature) {
  const b = String(body == null ? '' : body).replace(/\s+$/, '');
  const s = clean(signature);
  if (!s) return b;
  return b + SIGNATURE_SEPARATOR + s;
}

module.exports = { buildAddressBlock, buildSystemPrompt, buildUserPrompt, appendSignature };
