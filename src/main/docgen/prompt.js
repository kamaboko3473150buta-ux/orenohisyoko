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

// 表のセル1個分を文字列にする。文字列はそのまま、数値（件数・金額など）は文字列化して
// 残す。それ以外の型（null・オブジェクト等）は空文字にする（sanitizeStringArrayが
// 要素ごと捨てるのとは違い、tableは列数を保つ必要があるためセルは空文字に倒すだけにする）。
function sanitizeTableCell(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

// { headers, rows } を正規化する。headersが1列も無い・rowsが配列でない・行が配列でない
// ・列数がheadersと合わない行はすべて捨てる（表として描けない形は無かったことにする）。
// 有効な行が1つも残らなければ、表自体を出す意味が無いのでnullにする。
function sanitizeTable(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const headers = sanitizeStringArray(v.headers);
  if (!headers.length) return null;
  const rawRows = Array.isArray(v.rows) ? v.rows : [];
  const rows = [];
  for (const row of rawRows) {
    if (!Array.isArray(row) || row.length !== headers.length) continue;
    rows.push(row.map(sanitizeTableCell));
  }
  if (!rows.length) return null;
  return { headers, rows };
}

// meta（{label, value}の一覧）の1件分を正規化する。オブジェクトでなければ捨てる。
// labelもvalueも空になる要素は、出す意味が無いので捨てる。
function sanitizeMetaItem(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const label = sanitizeString(m.label);
  const value = sanitizeString(m.value);
  if (!label && !value) return null;
  return { label, value };
}

function sanitizeMeta(v) {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeMetaItem).filter((m) => m !== null);
}

// ---- 構成案 ----

// system は構成案と本文で**まったく同じ**にする。
// プロンプトキャッシュは system から前方一致で判定されるため、ここが1文字でも違うと
// 参考資料のキャッシュが一度も当たらず、書き込み料金（1.25倍）だけ余計に払うことになる。
// 段階ごとの違い（何を出すか・出力するJSONの形）は user 側の後半に置く。
function buildDocSystemPrompt(typeId) {
  const type = findDocType(typeId);
  return [
    `あなたは秘書として「${type.label}」を作るアシスタントです。`,
    '',
    `【${type.label}の作法】`,
    type.guide,
    '',
    '出力のきまり:',
    '- 出力は JSON のみ。前置き・説明・コードフェンス（```）は一切書かない。',
    '- 参考資料に書かれていないことを創作しない。不明な点は ［ ］ の空欄にする。',
    '- 出力する JSON の形は依頼のたびに指定する。指定された形だけを出す。',
  ].join('\n');
}

function buildOutlineSystemPrompt(typeId) {
  return buildDocSystemPrompt(typeId);
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
    '【この依頼で出す JSON の形】',
    '{ "title": "資料の題名", "sections": [ { "heading": "見出し", "points": ["要点1", "要点2"] } ] }',
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
  return buildDocSystemPrompt(typeId);
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
    '【この依頼で出す JSON の形】',
    '{ "title": "資料の題名",',
    '  "meta": [ { "label": "項目名", "value": "内容" } ],',
    '  "sections": [ { "heading": "見出し", "paragraphs": ["段落1"], "bullets": ["箇条書き1"],',
    '    "table": { "headers": ["列見出し1", "列見出し2"], "rows": [ ["値1", "値2"] ] } } ] }',
    'meta は「この資料の種類の作法」で指定された項目（日時・場所・出席者、発信日・宛先・発信者・件名など）'
      + 'だけを入れる。指定が無い種類では空配列 [] にする。',
    'table は宿題・連絡先・数値の一覧など、表にしたほうが分かりやすい内容がある場合だけ使う。'
      + '不要なセクションでは table を省略してよい。',
    '',
    '確定した構成の見出しの並びと数を守り、指定が無い見出しを勝手に増やさないでください。',
    '上記の構成に沿って、本文をJSONのみで出力してください。',
  ].join('\n');
}

function sanitizeBodySection(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return {
    heading: sanitizeString(s.heading),
    paragraphs: sanitizeStringArray(s.paragraphs),
    bullets: sanitizeStringArray(s.bullets),
    table: sanitizeTable(s.table),
  };
}

function sanitizeBodySections(v) {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeBodySection).filter((s) => s !== null);
}

function emptyDoc() {
  return { title: '', meta: [], sections: [] };
}

// Claudeの応答から本文（4-4dの中間形式。Task 41でmeta・tableを追加）を取り出す。
// 構成案と同じく、失敗しても例外は投げず、空の中間形式を failed:true とともに返す。
function parseBodyJson(raw) {
  const obj = parseJsonSafely(raw);
  if (!obj) return { doc: emptyDoc(), failed: true };
  return {
    doc: {
      title: sanitizeString(obj.title),
      meta: sanitizeMeta(obj.meta),
      sections: sanitizeBodySections(obj.sections),
    },
    failed: false,
  };
}

// ---- プレゼン資料（スライド）専用 ----
//
// レポート等の {title, sections} とは別の中間形式を使う。実機で「文字だらけで
// プレゼン資料として使い物にならない」という指摘を受けたため、見出し＋箇条書きを
// そのまま流し込む形は禁止し、スライドごとにレイアウト（見せ方）を選ばせる。
// 構成案（buildSlideOutline*）と本文（buildSlideBody*）のどちらも同じdeck形状
// { title, subtitle, slides:[...] } を出力させ、同じ parseDeckJson で受け取る
// （構成案の段階ではbullets/noteは空でよいとし、本文の段階で中身を仕上げさせる）。

const SLIDE_LAYOUTS = ['title', 'statement', 'bullets', 'compare', 'image', 'closing'];
const MAX_SLIDE_BULLETS = 5;

// 使える画像の枚数を、AIへの指示文にする。0枚のときは「wantsImageを使わない」と
// 明示しないと、ある前提で書かれてしまうため必ず分岐させる。
function formatImageCountNote(imageCount) {
  const n = Number(imageCount);
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (count <= 0) {
    return (
      '添付資料から使える画像は0枚です。図解が必要なスライドも、画像には頼らず図形や数字の見せ方で'
      + '表現してください。wantsImageは使わないでください（trueにしない）。'
    );
  }
  return (
    `添付資料から使える画像が${count}枚あります。図を見せたいスライドには "wantsImage": true を付けて`
    + 'ください（どの画像を使うかはアプリ側が順番に割り当てるので、あなたが画像の中身を指定する必要はありません）。'
  );
}

// 確定したスライド構成案を「番号. [layout] 見出し — 補足」の形でプロンプトに埋め込む文字列にする。
function formatSlideOutline(outline) {
  const slides = (outline && Array.isArray(outline.slides)) ? outline.slides : [];
  if (!slides.length) return '（構成案はありません）';
  return slides
    .map((s, i) => {
      const n = i + 1;
      const layout = clean(s && s.layout) || 'bullets';
      const heading = clean(s && s.heading) || '(見出しなし)';
      const lead = clean(s && s.lead);
      return lead ? `${n}. [${layout}] ${heading} — ${lead}` : `${n}. [${layout}] ${heading}`;
    })
    .join('\n');
}

// スライドでも system は構成案と本文で**まったく同じ**にする。
// プロンプトキャッシュは system から前方一致で見るため、ここが違うと参考資料の
// キャッシュが当たらず、書き込み料金だけ余計に払うことになる。
// 段階ごとの違い（何を出すか・JSONの形）は user 側の後半に置く。
function buildSlideSystemPrompt() {
  const type = findDocType('presentation');
  return [
    'あなたは秘書としてプレゼン資料（スライド）を作るアシスタントです。',
    '',
    `【${type.label}の作法】`,
    type.guide,
    '',
    '【最重要: 文字だらけのスライドを絶対に作らないこと】',
    'これはレポートではありません。見出しと箇条書きをただ流し込むだけの構成は失敗作です。',
    '- 1スライド1メッセージ。1枚で伝える内容は1つだけに絞る。',
    '  悪い例: 「課題・原因・対策・スケジュール」を1枚にまとめる。',
    '  良い例: 「課題だけの1枚」→「原因だけの1枚」→「対策だけの1枚」に分ける。',
    '- 見出しは体言止め（名詞で終わる）ではなく、言い切りの文にする。',
    '  悪い例: 「入力業務の課題」　良い例: 「現場の入力に月40時間かかっている」',
    '- 箇条書きは1スライド最大5行、1行30字以内。文章を書かない。',
    '  説明・背景・話す内容は note（スピーカーノート）に書き、スライド本体には置かない。',
    `- レイアウトは6種類（${SLIDE_LAYOUTS.join(' / ')}）を使い分け、`,
    '  bullets を2枚以上連続させない。数字や結論を強く伝えたいスライドは statement、',
    '  2つを比べるスライドは compare にする。',
    '- 資料の最初の1枚は layout:"title"（表紙）、最後の1枚は layout:"closing"（まとめ・次の一歩）にする。',
    '- wantsImage は図を見せたいスライドにだけ true を付ける。どの画像を使うかは考えなくてよい'
      + '（画像の中身は見せていないので、選ぶのはアプリ側の役目）。',
    '',
    '出力のきまり:',
    '- 出力は JSON のみ。前置き・説明・コードフェンス（```）は一切書かない。',
    '- 参考資料に書かれていないことを創作しない。不明な点は ［ ］ の空欄にする。',
    '- 出力する JSON の形は依頼のたびに指定する。指定された形だけを出す。',
  ].join('\n');
}

function buildSlideOutlineSystemPrompt() {
  return buildSlideSystemPrompt();
}

function buildSlideOutlineUserPrompt({ brief, sources, imageCount, today } = {}) {
  return [
    `【今日の日付】${clean(today)}`,
    '',
    '【作りたい資料の種類】プレゼン資料（スライド）',
    '',
    '【依頼内容】',
    clean(brief) || '（依頼内容の入力はありません）',
    '',
    '【参考資料】',
    formatSources(sources),
    '',
    `【使える画像】${formatImageCountNote(imageCount)}`,
    '',
    '【この依頼で出す JSON の形】',
    '{ "title": "資料の題名", "subtitle": "副題", "slides": [ { '
      + `"layout": "${SLIDE_LAYOUTS.join('|')}", `
      + '"heading": "見出し（言い切り）", '
      + '"lead": "statement/imageのときだけ使う短い一言", '
      + '"wantsImage": true } ] }',
    'この段階では bullets の中身や note はまだ書かなくてよい。'
      + 'スライドの枚数・順番・レイアウト・見出しを決めることに集中する。',
    '',
    '上記をもとに、スライド構成案をJSONのみで出力してください。',
  ].join('\n');
}

function buildSlideBodySystemPrompt() {
  return buildSlideSystemPrompt();
}

function buildSlideBodyUserPrompt({ brief, sources, outline, imageCount } = {}) {
  return [
    '【作りたい資料の種類】プレゼン資料（スライド）',
    '',
    '【依頼内容】',
    clean(brief) || '（依頼内容の入力はありません）',
    '',
    '【確定したスライド構成】',
    formatSlideOutline(outline),
    '',
    '【参考資料】',
    formatSources(sources),
    '',
    `【使える画像】${formatImageCountNote(imageCount)}`,
    '',
    '【この依頼で出す JSON の形】（layoutによって使うフィールドが変わる）',
    '{ "title": "資料の題名", "subtitle": "副題", "slides": [',
    '  { "layout": "title", "heading": "表紙の題名", "lead": "副題", "note": "…" },',
    '  { "layout": "statement", "heading": "言い切りの結論", "lead": "補足を一言だけ", "note": "…" },',
    '  { "layout": "bullets", "heading": "見出し", "bullets": ["最大5行・1行30字以内"], "note": "…" },',
    '  { "layout": "compare", "heading": "見出し", '
      + '"left": { "heading": "左の見出し", "bullets": ["…"] }, '
      + '"right": { "heading": "右の見出し", "bullets": ["…"] }, "note": "…" },',
    '  { "layout": "image", "heading": "見出し", "lead": "補足を一言だけ", "wantsImage": true, "note": "…" },',
    '  { "layout": "closing", "heading": "まとめ", "bullets": ["次の一歩など最大5行"], "note": "…" }',
    '] }',
    '確定した構成のスライド枚数・順番・レイアウトを守り、勝手に増減しないでください。',
    '',
    '上記の構成に沿って、スライドの中身をJSONのみで出力してください。',
  ].join('\n');
}

// 箇条書きを「文字列だけ・最大5行」に切り詰める。AIが6行以上返す・数値/nullを
// 混ぜて返す、といった崩れ方を必ずすると仮定して正規化する。
function sanitizeSlideBullets(v) {
  return sanitizeStringArray(v).slice(0, MAX_SLIDE_BULLETS);
}

// compareの片側（left/right）を正規化する。オブジェクトでなければ null を返し、
// 呼び出し側で compare 自体を bullets に倒す判断材料にする。
function sanitizeCompareSide(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return {
    heading: sanitizeString(v.heading),
    bullets: sanitizeSlideBullets(v.bullets),
  };
}

// スライド1枚分を正規化する。オブジェクトでなければ捨てる（呼び出し側でfilter）。
// layoutが6種以外・compareなのにleft/rightが欠けている、といった崩れは
// すべて bullets に倒し、例外を投げずアプリが描画できる形にそろえる。
function sanitizeSlide(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;

  const rawLayout = typeof s.layout === 'string' ? s.layout : '';
  let layout = SLIDE_LAYOUTS.includes(rawLayout) ? rawLayout : 'bullets';

  const base = {
    heading: sanitizeString(s.heading),
    note: sanitizeString(s.note),
    wantsImage: s.wantsImage === true,
  };

  if (layout === 'compare') {
    const left = sanitizeCompareSide(s.left);
    const right = sanitizeCompareSide(s.right);
    if (left && right) {
      return { layout, ...base, left, right };
    }
    // left/rightが片方しか無ければ箇条書きに倒す。
    // このとき片側に書かれていた内容を捨てると、料金を払って作らせた中身が
    // そのまま消えてしまうので、拾えるものは箇条書きとして引き継ぐ。
    const salvaged = [...((left && left.bullets) || []), ...((right && right.bullets) || [])];
    if (salvaged.length) {
      return { layout: 'bullets', ...base, bullets: sanitizeSlideBullets(salvaged) };
    }
    layout = 'bullets';
  }

  if (layout === 'title' || layout === 'statement' || layout === 'image') {
    return { layout, ...base, lead: sanitizeString(s.lead) };
  }

  // bullets（compareからの倒し先を含む）・closing
  return { layout, ...base, bullets: sanitizeSlideBullets(s.bullets) };
}

function sanitizeSlides(v) {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeSlide).filter((s) => s !== null);
}

function emptyDeck() {
  return { title: '', subtitle: '', slides: [] };
}

// 先頭がtitleレイアウトでなければ、アプリ側で表紙スライドを1枚足す。
// プロンプトで頼むだけでは守られないことがある前提で、コード側で必ず保証する。
function ensureLeadingTitleSlide(deck) {
  const slides = deck.slides;
  if (slides.length > 0 && slides[0].layout === 'title') return deck;
  const titleSlide = {
    layout: 'title',
    heading: deck.title || '（無題）',
    note: '',
    wantsImage: false,
    lead: deck.subtitle || '',
  };
  return { ...deck, slides: [titleSlide, ...slides] };
}

// Claudeの応答からスライドのdeck（構成案・本文どちらの段階でも同じ形）を取り出す。
// 解析に失敗しても例外は投げず、空のdeckをfailed:trueとともに返す。
function parseDeckJson(raw) {
  const obj = parseJsonSafely(raw);
  if (!obj || !Array.isArray(obj.slides)) return { deck: emptyDeck(), failed: true };

  const deck = ensureLeadingTitleSlide({
    title: sanitizeString(obj.title),
    subtitle: sanitizeString(obj.subtitle),
    slides: sanitizeSlides(obj.slides),
  });

  return { deck, failed: false };
}

module.exports = {
  buildOutlineSystemPrompt, buildOutlineUserPrompt, parseOutlineJson,
  buildBodySystemPrompt, buildBodyUserPrompt, parseBodyJson,
  buildSlideOutlineSystemPrompt, buildSlideOutlineUserPrompt,
  buildSlideBodySystemPrompt, buildSlideBodyUserPrompt, parseDeckJson,
};
