// src/main/task-ai.js
// タスクのAI連携（取り込み／今日の案内）のプロンプト組み立てと、JSON応答の頑健な解析。
// Electron に依存しない純粋な関数だけを置く。

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// 取り込み用のAIへの役割指示。
// JSON以外を一切出させないこと、推測で埋めないことを明示する（頑健な解析があっても
// そもそも読み取れない情報を勝手に補われると誤ったタスクが登録されてしまうため）。
function buildParseSystemPrompt() {
  return [
    'あなたは秘書として、話し言葉で伝えられた1件の予定・タスクを構造化するアシスタントです。',
    '',
    '出力のきまり:',
    '- 出力は JSON のみ。前置き・説明・コードフェンス（```）は一切書かない。',
    '- 出力する項目は title, due, at, who, kind, priority の6つだけ。',
    '- due は "YYYY-MM-DD" 形式、at は "HH:MM" 形式で書く。',
    '- 読み取れない項目は null にする。推測で埋めない。',
    '- kind は「提出」「連絡」「会議」「移動」「その他」のいずれかから選ぶ。',
    '- priority は "high" "normal" "low" のいずれか。指定が読み取れなければ "normal" にする。',
  ].join('\n');
}

// 実際の依頼内容。今日の日付を必ず含める（「来週金曜」のような相対表現を解決するため）。
function buildParseUserPrompt({ text, today } = {}) {
  return [
    `【今日の日付】${clean(today)}`,
    '',
    '【入力文】',
    clean(text),
    '',
    '上記を読み取り、JSON のみを出力してください。',
  ].join('\n');
}

function sanitizeString(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

function sanitizeDue(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function sanitizeAt(v) {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null;
}

function sanitizePriority(v) {
  return v === 'high' || v === 'low' ? v : 'normal';
}

// 応答文字列の中から最初の '{' から最後の '}' までを切り出す。
// コードフェンスや前後の説明文が付いていても、この範囲にJSON本体が収まっている前提。
function extractJsonSlice(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

// Claudeの応答からタスクを取り出す。API料金を払ったのに何も残らない事態を避けるため、
// 解析に失敗しても例外は投げず、入力文をtitleに入れたタスクを返す。
function parseTaskJson(raw, fallbackText) {
  const slice = extractJsonSlice(raw);
  if (!slice) {
    return { task: { title: fallbackText }, failed: true };
  }
  let obj;
  try {
    obj = JSON.parse(slice);
  } catch (err) {
    return { task: { title: fallbackText }, failed: true };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { task: { title: fallbackText }, failed: true };
  }
  const title = sanitizeString(obj.title) || fallbackText;
  return {
    task: {
      title,
      due: sanitizeDue(obj.due),
      at: sanitizeAt(obj.at),
      who: sanitizeString(obj.who),
      kind: sanitizeString(obj.kind),
      priority: sanitizePriority(obj.priority),
    },
    failed: false,
  };
}

// 「今日の案内」用のAIへの役割指示。タスクの中身は書き換えず、助言だけを返させる。
function buildBriefSystemPrompt() {
  return [
    'あなたは秘書として、依頼者の今日の進め方について短く助言します。',
    '',
    '出力のきまり:',
    '- 2〜4文程度の日本語の文章のみを出力する。前置き・箇条書き・マークダウンは使わない。',
    '- 事実を創作しない。渡されたタスク一覧に無いことは書かない。',
    '- タスクの中身（件名・期限など）を書き換えたり、新しいタスクを提案したりしない。',
  ].join('\n');
}

// 未完了タスクの一覧（件名・期限・優先度）と今日の日付を埋め込む。0件でも壊れない。
function buildBriefUserPrompt({ tasks, today } = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const lines = list.map((t) => {
    const title = (t && clean(t.title)) || '(無題)';
    const due = (t && clean(t.due)) || '期限なし';
    const at = (t && clean(t.at)) ? ` ${clean(t.at)}` : '';
    const priority = (t && clean(t.priority)) || 'normal';
    return `- ${title}（期限: ${due}${at} / 優先度: ${priority}）`;
  });

  return [
    `【今日の日付】${clean(today)}`,
    '',
    '【未完了のタスク一覧】',
    lines.length ? lines.join('\n') : '（未完了のタスクはありません）',
    '',
    '上記をふまえて、今日の進め方を2〜4文で助言してください。',
  ].join('\n');
}

module.exports = {
  buildParseSystemPrompt, buildParseUserPrompt, parseTaskJson,
  buildBriefSystemPrompt, buildBriefUserPrompt,
};
