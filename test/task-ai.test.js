const test = require('node:test');
const assert = require('node:assert');
const {
  buildParseSystemPrompt, buildParseUserPrompt, parseTaskJson,
  buildBriefSystemPrompt, buildBriefUserPrompt,
} = require('../src/main/task-ai');

test('取り込みのsystemプロンプトに「JSONのみ」「推測で埋めない」の指示が含まれる', () => {
  const s = buildParseSystemPrompt();
  assert.ok(s.includes('JSON'), 'JSONへの言及がある');
  assert.ok(s.includes('推測で埋めない'), '推測で埋めない旨の指示がある');
});

test('取り込みのsystemプロンプトにstart/endの説明と期間の例が含まれる', () => {
  const s = buildParseSystemPrompt();
  assert.ok(s.includes('start'), 'startへの言及がある');
  assert.ok(s.includes('end'), 'endへの言及がある');
  assert.ok(s.includes('期間'), '期間についての説明がある');
  assert.ok(!s.includes('due'), '旧項目のdueは出力項目として書かれていない');
});

test('取り込みのuserプロンプトに入力文と今日の日付が埋め込まれる', () => {
  const u = buildParseUserPrompt({ text: '来週金曜にA社へ見積書を送る', today: '2026-09-04' });
  assert.ok(u.includes('来週金曜にA社へ見積書を送る'));
  assert.ok(u.includes('2026-09-04'));
});

test('素のJSONを解析できる（start/end）', () => {
  const raw = '{"title":"A社へ見積書を送る","start":"2026-09-12","end":"2026-09-12","at":null,"who":"A社 山田様","kind":"提出","priority":"normal"}';
  const { task, failed } = parseTaskJson(raw, '来週金曜にA社へ見積書を送る');
  assert.strictEqual(failed, false);
  assert.strictEqual(task.title, 'A社へ見積書を送る');
  assert.strictEqual(task.start, '2026-09-12');
  assert.strictEqual(task.end, '2026-09-12');
  assert.strictEqual(task.at, null);
  assert.strictEqual(task.who, 'A社 山田様');
  assert.strictEqual(task.kind, '提出');
  assert.strictEqual(task.priority, 'normal');
});

test('期間（start!=end）のJSONも解析できる', () => {
  const raw = '{"title":"出張","start":"2026-09-08","end":"2026-09-12","at":null,"who":null,"kind":"移動","priority":"normal"}';
  const { task } = parseTaskJson(raw, '出張');
  assert.strictEqual(task.start, '2026-09-08');
  assert.strictEqual(task.end, '2026-09-12');
});

test('コードフェンス付きでも解析できる', () => {
  const raw = '```json\n{"title":"会議","start":"2026-09-05","end":"2026-09-05","at":"14:00","who":null,"kind":"会議","priority":"high"}\n```';
  const { task, failed } = parseTaskJson(raw, '会議');
  assert.strictEqual(failed, false);
  assert.strictEqual(task.title, '会議');
  assert.strictEqual(task.at, '14:00');
  assert.strictEqual(task.priority, 'high');
});

test('前後に説明文が付いていても解析できる', () => {
  const raw = 'かしこまりました。以下がJSONです。\n{"title":"移動","start":null,"end":null,"at":null,"who":null,"kind":"移動","priority":"low"}\nご確認ください。';
  const { task, failed } = parseTaskJson(raw, '移動');
  assert.strictEqual(failed, false);
  assert.strictEqual(task.title, '移動');
  assert.strictEqual(task.kind, '移動');
});

test('壊れたJSONではfailed:trueになり、入力文がtitleに入る', () => {
  const { task, failed } = parseTaskJson('これはJSONではありません', '元の入力文');
  assert.strictEqual(failed, true);
  assert.deepStrictEqual(task, { title: '元の入力文' });
});

test('空文字やnullの応答でもfailed:trueになり例外を投げない', () => {
  assert.doesNotThrow(() => parseTaskJson('', '元の入力文'));
  assert.doesNotThrow(() => parseTaskJson(null, '元の入力文'));
  assert.doesNotThrow(() => parseTaskJson(undefined, '元の入力文'));
  const { failed } = parseTaskJson('', '元の入力文');
  assert.strictEqual(failed, true);
});

test('{}や}{のように壊れた括弧でも例外を投げない', () => {
  assert.doesNotThrow(() => parseTaskJson('}{', '元の入力文'));
  const { failed } = parseTaskJson('{ this is not valid json }', '元の入力文');
  assert.strictEqual(failed, true);
});

test('start/endが変な型・変な形式ならnullになる', () => {
  const raw1 = JSON.stringify({ title: 'x', start: 20260912, end: 20260912, at: null, who: null, kind: null, priority: 'normal' });
  const r1 = parseTaskJson(raw1, 'x').task;
  assert.strictEqual(r1.start, null, '数値のstartはnull');
  assert.strictEqual(r1.end, null, '数値のendはnull');

  const raw2 = JSON.stringify({ title: 'x', start: '2026/09/12', end: '2026/09/12', at: null, who: null, kind: null, priority: 'normal' });
  const r2 = parseTaskJson(raw2, 'x').task;
  assert.strictEqual(r2.start, null, '形式違いのstartはnull');
  assert.strictEqual(r2.end, null, '形式違いのendはnull');
});

test('atが変な型・変な形式ならnullになる', () => {
  const raw = JSON.stringify({ title: 'x', start: null, end: null, at: '14時', who: null, kind: null, priority: 'normal' });
  assert.strictEqual(parseTaskJson(raw, 'x').task.at, null);
});

test('priorityが想定外ならnormalになる', () => {
  const raw1 = JSON.stringify({ title: 'x', start: null, end: null, at: null, who: null, kind: null, priority: 'urgent' });
  assert.strictEqual(parseTaskJson(raw1, 'x').task.priority, 'normal');

  const raw2 = JSON.stringify({ title: 'x', start: null, end: null, at: null, who: null, kind: null });
  assert.strictEqual(parseTaskJson(raw2, 'x').task.priority, 'normal', 'priority自体が無くてもnormal');
});

test('titleが空・欠落していればfallbackTextが使われる', () => {
  const raw = JSON.stringify({ title: '', start: null, end: null, at: null, who: null, kind: null, priority: 'normal' });
  assert.strictEqual(parseTaskJson(raw, '元の入力文').task.title, '元の入力文');
});

test('案内のsystemプロンプトが日本語の助言を求める内容になっている', () => {
  const s = buildBriefSystemPrompt();
  assert.ok(s.length > 0);
});

test('タスク一覧を渡すuserプロンプトに、件名と期限（end）と今日の日付が含まれる', () => {
  const u = buildBriefUserPrompt({
    tasks: [
      { title: 'A社へ見積書を送る', end: '2026-09-12', at: '14:00' },
      { title: '議事録の共有', end: null, at: null },
    ],
    today: '2026-09-04',
  });
  assert.ok(u.includes('A社へ見積書を送る'));
  assert.ok(u.includes('2026-09-12'));
  assert.ok(u.includes('議事録の共有'));
  assert.ok(u.includes('2026-09-04'));
});

test('未完了が0件でもプロンプトが壊れない', () => {
  assert.doesNotThrow(() => buildBriefUserPrompt({ tasks: [], today: '2026-09-04' }));
  assert.doesNotThrow(() => buildBriefUserPrompt({ today: '2026-09-04' }));
  const u = buildBriefUserPrompt({ tasks: [], today: '2026-09-04' });
  assert.ok(u.includes('2026-09-04'));
});
