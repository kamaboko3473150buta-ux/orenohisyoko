// src/main/docgen/prompt.js
// 資料作成（構成案・本文）のプロンプト組み立てと、Claudeの応答（JSON）の頑健な解析。
// Electron に依存しない純粋な関数だけを置く。JSON解析は task-ai.js の parseTaskJson と
// 同じ考え方（例外を投げず、失敗しても戻り値で表す）で書く。

const { findDocType } = require('./types');

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// 参考資料一覧を「【参考資料: ファイル名】本文」の形でプロンプトに埋め込む文字列にする。
// 0件でも壊れない（画面から1件も添付せずに作成を始めるケースがあるため）。
function formatSources(sources) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return '（参考資料はありません）';
  return list
    .map((s) => `【参考資料: ${clean(s && s.name)}】\n${clean(s && s.text)}`)
    .join('\n\n');
}

// 応答文字列の中から最初の '{' から最後の '}' までを切り出す。
// コードフェンスや前後の説明文が付いていても、この範囲にJSON本体が収まっている前提。
// task-ai.js の extractJsonSlice と同じロジック（このファイルはElectronを介さない
// docgen配下で完結させるため、あえて別モジュールに切り出さずここに複製している）。
function extractJsonSlice(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

// JSONを解析する。失敗したら null を返すだけで、例外は外に投げない。
function parseJsonSafely(raw) {
  const slice = extractJsonSlice(raw);
  if (!slice) return null;
  try {
    const obj = JSON.parse(slice);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj;
  } catch (err) {
    return null;
  }
}

// 文字列配列に正規化する。配列でなければ（文字列1本などの想定外の型）中身ごと捨てて空配列にする。
// 配列の中に数値などの想定外の要素が混ざっている場合はその要素だけを捨てる。
function sanitizeStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function sanitizeString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// ---- 構成案 ----

function buildOutlineSystemPrompt(typeId) {
  const type = findDocType(typeId);
  return [
    `あなたは秘書として「${type.label}」の構成案を作るアシスタントです。`,
    '',
    `【${type.label}の作法】`,
    type.guide,
    '',
    '出力のきまり:',
    '- 出力は JSON のみ。前置き・説明・コードフェンス（```）は一切書かない。',
    '- 出力する形は { "title": "資料の題名", "sections": [ { "heading": "見出し", "points": ["要点1", "要点2"] } ] } のみ。',
    '- 参考資料に書かれていないことを創作しない。不明な点は ［ ］ の空欄にする。',
  ].join('\n');
}

function buildOutlineUserPrompt({ typeId, brief, sources, today } = {}) {
  const type = findDocType(typeId);
  return [
    `【今日の日付】${clean(today)}`,
    '',
    `【作りたい資料の種類】${type.label}`,
    '',
    '【依頼内容】',
    clean(brief) || '（依頼内容の入力はありません）',
    '',
    '【参考資料】',
    formatSources(sources),
    '',
    '上記をもとに、構成案をJSONのみで出力してください。',
  ].join('\n');
}

// 構成案の1セクション分を正規化する。オブジェクトでなければ捨てる。
function sanitizeOutlineSection(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return {
    heading: sanitizeString(s.heading),
    points: sanitizeStringArray(s.points),
  };
}

function sanitizeOutlineSections(v) {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeOutlineSection).filter((s) => s !== null);
}

function emptyOutline() {
  return { title: '', sections: [] };
}

// Claudeの応答から構成案を取り出す。API料金を払ったのに何も残らない事態を避けるため、
// 解析に失敗しても例外は投げず、空の構成案を failed:true とともに返す。
function parseOutlineJson(raw) {
  const obj = parseJsonSafely(raw);
  if (!obj) return { outline: emptyOutline(), failed: true };
  return {
    outline: {
      title: sanitizeString(obj.title),
      sections: sanitizeOutlineSections(obj.sections),
    },
    failed: false,
  };
}

// ---- 本文 ----

function buildBodySystemPrompt(typeId) {
  const type = findDocType(typeId);
  return [
    `あなたは秘書として「${type.label}」の本文を仕上げるアシスタントです。`,
    '',
    `【${type.label}の作法】`,
    type.guide,
    '',
    '出力のきまり:',
    '- 出力は JSON のみ。前置き・説明・コードフェンス（```）は一切書かない。',
    '- 出力する形は { "title": "資料の題名", "sections": [ { "heading": "見出し", "paragraphs": ["段落1"], "bullets": ["箇条書き1"] } ] } のみ。',
    '- 与えられた構成案の見出しの並びと数を守り、指定が無い見出しを勝手に増やさない。',
    '- 参考資料に書かれていないことを創作しない。不明な点は ［ ］ の空欄にする。',
  ].join('\n');
}

// 確定した構成案を「見出しと要点」の形でプロンプトに埋め込む文字列にする。
function formatOutline(outline) {
  const sections = (outline && Array.isArray(outline.sections)) ? outline.sections : [];
  if (!sections.length) return '（構成案はありません）';
  return sections
    .map((s) => {
      const heading = clean(s && s.heading) || '(見出しなし)';
      const points = Array.isArray(s && s.points) ? s.points : [];
      const pointLines = points.map((p) => `  - ${clean(p)}`).join('\n');
      return pointLines ? `- ${heading}\n${pointLines}` : `- ${heading}`;
    })
    .join('\n');
}

// today は実装計画のサンプルには明記されていないが、設計書 4-5c の表で本文の入力は
// 「構成案の入力＋確定した構成」（＝今日の日付を含む）とされているため、ここでも含める。
function buildBodyUserPrompt({ typeId, brief, sources, outline, today } = {}) {
  const type = findDocType(typeId);
  return [
    `【今日の日付】${clean(today)}`,
    '',
    `【作りたい資料の種類】${type.label}`,
    '',
    '【依頼内容】',
    clean(brief) || '（依頼内容の入力はありません）',
    '',
    '【確定した構成】',
    formatOutline(outline),
    '',
    '【参考資料】',
    formatSources(sources),
    '',
    '上記の構成に沿って、本文をJSONのみで出力してください。',
  ].join('\n');
}

function sanitizeBodySection(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return {
    heading: sanitizeString(s.heading),
    paragraphs: sanitizeStringArray(s.paragraphs),
    bullets: sanitizeStringArray(s.bullets),
  };
}

function sanitizeBodySections(v) {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeBodySection).filter((s) => s !== null);
}

function emptyDoc() {
  return { title: '', sections: [] };
}

// Claudeの応答から本文（4-4dの中間形式）を取り出す。構成案と同じく、失敗しても
// 例外は投げず、空の中間形式を failed:true とともに返す。
function parseBodyJson(raw) {
  const obj = parseJsonSafely(raw);
  if (!obj) return { doc: emptyDoc(), failed: true };
  return {
    doc: {
      title: sanitizeString(obj.title),
      sections: sanitizeBodySections(obj.sections),
    },
    failed: false,
  };
}

module.exports = {
  buildOutlineSystemPrompt, buildOutlineUserPrompt, parseOutlineJson,
  buildBodySystemPrompt, buildBodyUserPrompt, parseBodyJson,
};
