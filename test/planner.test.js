// test/planner.test.js
// 複数日にわたる予定（旅行・出張）の行程表。
//
// 日付の見出しの形が揺れると、その日ぶんだけを切り出せない。
// 切り出せないと「今日の進め方」に行程表まるごとを渡すことになり、毎日ぶん費用が増える。
const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/main/planner/prompt');

test('開始日から終了日までを並べる', () => {
  assert.deepStrictEqual(p.dayList('2026-09-15', '2026-09-17'), ['2026-09-15', '2026-09-16', '2026-09-17']);
  assert.deepStrictEqual(p.dayList('2026-09-15', '2026-09-15'), ['2026-09-15'], '1日でも並べる');
});

test('月またぎ・年またぎでも正しく数える', () => {
  assert.deepStrictEqual(p.dayList('2026-09-29', '2026-10-02'), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepStrictEqual(p.dayList('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  // うるう年
  assert.deepStrictEqual(p.dayList('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
});

test('壊れた日付・逆順では空にする（例外は投げない）', () => {
  assert.deepStrictEqual(p.dayList('2026-09-17', '2026-09-15'), [], '終了が開始より前');
  assert.deepStrictEqual(p.dayList('', ''), []);
  assert.deepStrictEqual(p.dayList(null, null), []);
  assert.deepStrictEqual(p.dayList('2026/09/15', '2026/09/17'), [], '形式が違う');
});

test('長すぎる期間は上限で切る（プロンプトが膨らむのを防ぐ）', () => {
  const long = p.dayList('2020-01-01', '2030-01-01');
  assert.strictEqual(long.length, p.MAX_DAYS);
});

test('日付の見出しは形を固定する', () => {
  assert.strictEqual(p.formatDayHeading('2026-09-15'), '【2026/9/15（火）】');
  assert.strictEqual(p.formatDayHeading('2026-01-01'), '【2026/1/1（木）】');
  assert.strictEqual(p.formatDayHeading('こわれた'), '');
});

test('日付があれば1日の予定でも行程表を作れる', () => {
  // 終日の会議やイベントにも行程表は要るので、複数日には限らない。
  assert.strictEqual(p.canPlan({ start: '2026-09-15', end: '2026-09-17' }), true);
  assert.strictEqual(p.canPlan({ start: '2026-09-15', end: '2026-09-15' }), true, '1日の予定でも作れる');
  assert.strictEqual(p.canPlan({ start: null, end: '2026-09-15' }), true, '期限だけでも作れる');
  assert.strictEqual(p.canPlan({ start: '2026-09-15', end: null }), true);

  // 日付がまったく無いものだけは作れない（何日ぶんの行程か決まらない）
  assert.strictEqual(p.canPlan({}), false);
  assert.strictEqual(p.canPlan(null), false);
});

test('予定の日数を数える。片方しか無ければその1日ぶん', () => {
  assert.deepStrictEqual(p.taskDays({ start: '2026-09-15', end: '2026-09-17' }), ['2026-09-15', '2026-09-16', '2026-09-17']);
  assert.deepStrictEqual(p.taskDays({ end: '2026-09-15' }), ['2026-09-15']);
  assert.deepStrictEqual(p.taskDays({ start: '2026-09-15' }), ['2026-09-15']);
  assert.deepStrictEqual(p.taskDays({}), []);
});

const PLAN = `【2026/9/15（火）】
・09:00 松山空港発
・11:30 羽田着

【2026/9/16（水）】
・10:00 打ち合わせ
・未定 夕食

【2026/9/17（木）】
・15:00 帰路`;

test('行程表から、その日ぶんだけを取り出す', () => {
  assert.strictEqual(p.extractDay(PLAN, '2026-09-16'), '【2026/9/16（水）】\n・10:00 打ち合わせ\n・未定 夕食');
  assert.strictEqual(p.extractDay(PLAN, '2026-09-15'), '【2026/9/15（火）】\n・09:00 松山空港発\n・11:30 羽田着', '最初の日');
  assert.strictEqual(p.extractDay(PLAN, '2026-09-17'), '【2026/9/17（木）】\n・15:00 帰路', '最後の日は末尾まで');
});

test('期間の外の日・壊れた入力では空にする', () => {
  assert.strictEqual(p.extractDay(PLAN, '2026-09-20'), '');
  assert.strictEqual(p.extractDay('', '2026-09-15'), '');
  assert.strictEqual(p.extractDay(null, '2026-09-15'), '');
  assert.strictEqual(p.extractDay(PLAN, 'こわれた'), '');
});

test('AIに渡す本文には、決まっていることと日付の見出しが入る', () => {
  const body = p.buildPlanUserPrompt({
    task: {
      title: '東京出張', start: '2026-09-15', end: '2026-09-17', who: '岸本さん', note: '予算3万円',
    },
    given: '16日10時に先方と打ち合わせ',
  });
  assert.ok(body.includes('東京出張'));
  assert.ok(body.includes('3日間'));
  assert.ok(body.includes('岸本さん'));
  assert.ok(body.includes('予算3万円'));
  assert.ok(body.includes('16日10時に先方と打ち合わせ'));
  assert.ok(body.includes('【2026/9/15（火）】'));
  assert.ok(body.includes('【2026/9/17（木）】'));
});

test('決まっていることが空でも組み立てられる', () => {
  const body = p.buildPlanUserPrompt({ task: { title: 'x', start: '2026-09-15', end: '2026-09-16' } });
  assert.ok(body.includes('特に指定はありません'));
  assert.ok(!body.includes('undefined'));
});

test('systemプロンプトは毎回同じ（プロンプトキャッシュのため）', () => {
  assert.strictEqual(p.buildPlanSystemPrompt(), p.buildPlanSystemPrompt());
});

test('案を出させる指示と、嘘を書かせない指示の両方が入っている', () => {
  const s = p.buildPlanSystemPrompt();
  // 書き写すだけでは行程表にならない。決まっていないところを埋めるのが仕事。
  assert.ok(s.includes('案を出すこと'));
  assert.ok(s.includes('「未定」で済ませず'));
  // ただし調べないと分からない事実は書かせない。これを外すと、
  // もっともらしい便名や料金が並んで、その場で困るのは利用者本人。
  assert.ok(s.includes('調べないと分からない事実は書かない'));
  assert.ok(s.includes('【備考】'), '決めておくべきことを最後にまとめさせる');
});
