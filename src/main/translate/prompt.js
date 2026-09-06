// src/main/translate/prompt.js
// 言語翻訳のプロンプト組み立てと、Claudeの応答（JSON）の頑健な解析。
// Electron に依存しない純粋な関数だけを置く。JSON解析は task-ai.js の parseTaskJson・
// docgen/prompt.js の parseOutlineJson と同じ考え方（例外を投げず、失敗しても
// 戻り値で表す）で書く。

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// items（文字列の配列、または {text} を持つオブジェクトの配列）から
// 1件分のテキストを取り出す。chunkItems・buildTranslateUserPromptの両方で使う
// ことで、splitParagraphsが返す {index, xml, text} をそのまま渡せるようにする。
function itemText(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item.text === 'string') return item.text;
  return '';
}

// 翻訳用のAIへの役割指示。段落ごとにAPIを呼ばず、番号付きでまとめて渡す前提の
// 出力形式にする。
function buildTranslateSystemPrompt() {
  return [
    'あなたは秘書として、Word文書内の文章を翻訳するアシスタントです。',
    '',
    '出力のきまり:',
    '- 出力は JSON のみ。前置き・説明・コードフェンス（```）は一切書かない。',
    '- JSONのキーは渡された番号（"1","2",...の文字列）、値はその番号の原文に対応する訳文。',
    '- 原文の言語は自動で判断する（言語名の指定は不要）。',
    '- 指定された言語への訳文だけを返す。原文や説明を付け加えない。',
    '- 人名・固有名詞・数値・記号は変えない。',
    '- 原文に誤字・表記ゆれがあっても直さない。そのまま訳す'
      + '（社内の略語や独自の表記を「誤り」と決めつけて別のものに変えてしまわないため）。',
    '- 原文が空欄や記号だけの場合は、翻訳せずそのまま同じ内容を返す。',
    '- 丁寧さ・文体は原文に合わせる（原文がくだけていれば訳文もくだけた表現にする）。',
  ].join('\n');
}

// 実際の依頼内容。原文は番号付きの一覧にして渡す（段落ごとにAPIを呼ばないため）。
function buildTranslateUserPrompt({ targetLanguage, items } = {}) {
  const list = Array.isArray(items) ? items : [];
  const numbered = list.map((it, i) => `${i + 1}. ${itemText(it)}`).join('\n');
  return [
    `【訳したい言語】${clean(targetLanguage)}`,
    '',
    '【原文（番号付き）】',
    numbered || '（原文はありません）',
    '',
    '【この依頼で出す JSON の形】',
    '{ "1": "1番の訳文", "2": "2番の訳文" }',
    '',
    '上記の番号ごとに訳文をJSONのみで出力してください。',
  ].join('\n');
}

// 応答文字列の中から最初の '{' から最後の '}' までを切り出す。
// task-ai.js / docgen/prompt.js と同じロジック（このモジュールもElectronを介さず
// 完結させるため、あえて別モジュールに切り出さずここに複製している）。
function extractJsonSlice(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

// Claudeの応答から訳文を取り出す。originals（依頼した原文の配列。長さがそのまま
// 期待件数になる）を必ず渡すこと。
// - 応答全体がJSONとして読めない・オブジェクトでない場合は failed:true で、
//   texts は originals をそのまま返す（段落が消えるより、訳されていない方がまし）。
// - JSONとして読めても、個々の番号が欠けていたり文字列でなかったりする場合は、
//   その番号だけ元の原文で埋める（failedはfalseのまま。取得できた分は活かす）。
// - 例外は投げない。
function parseTranslationJson(raw, originals) {
  const list = (Array.isArray(originals) ? originals : []).map((t) => String(t == null ? '' : t));

  const slice = extractJsonSlice(raw);
  if (!slice) return { texts: list.slice(), failed: true };

  let obj;
  try {
    obj = JSON.parse(slice);
  } catch (err) {
    return { texts: list.slice(), failed: true };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { texts: list.slice(), failed: true };
  }

  const texts = list.map((original, i) => {
    const v = obj[String(i + 1)];
    return typeof v === 'string' ? v : original;
  });
  return { texts, failed: false };
}

// 長い文書のために、items（文字列 or {text}を持つオブジェクトの配列）を
// 1回あたりの合計文字数がmaxCharsを超えないようチャンクに分ける。
// - 順序を保ち、全itemを必ずどこかのチャンクに残す（取りこぼさない）。
// - 1件だけでmaxCharsを超える巨大な項目は、分割せずその項目だけの単独チャンクにする
//   （文字列の途中でAPIに送る文を切ると翻訳が壊れるため）。
function chunkItems(items, maxChars = 4000) {
  const list = Array.isArray(items) ? items : [];
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 4000;

  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const item of list) {
    const len = itemText(item).length;
    if (current.length > 0 && currentLen + len > limit) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(item);
    currentLen += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

module.exports = {
  buildTranslateSystemPrompt, buildTranslateUserPrompt, parseTranslationJson, chunkItems,
};
