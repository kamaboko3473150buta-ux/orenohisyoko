const test = require('node:test');
const assert = require('node:assert');
const { findDocType, DOC_TYPES } = require('../src/main/docgen/types');
const {
  buildOutlineSystemPrompt, buildOutlineUserPrompt, parseOutlineJson,
  buildBodySystemPrompt, buildBodyUserPrompt, parseBodyJson,
  sanitizeChart,
} = require('../src/main/docgen/prompt');

// ---- types.js ----

test('findDocTypeが種類ごとのguideを返し、存在しない種類はreportになる', () => {
  assert.strictEqual(findDocType('minutes').label, '議事録');
  assert.strictEqual(findDocType('nonexistent').id, 'report');
  assert.strictEqual(findDocType(undefined).id, 'report');
});

test('DOC_TYPESの各項目にid/label/defaultFormat/guideが揃っている', () => {
  for (const t of DOC_TYPES) {
    assert.ok(t.id && t.label && t.defaultFormat && t.guide, `${t.id}の項目が揃っている`);
  }
});

// ---- 構成案プロンプト ----

test('構成案system: 種類ごとのguideが含まれ、JSONのみ・創作しないの指示がある', () => {
  const s = buildOutlineSystemPrompt('minutes');
  assert.ok(s.includes('決定事項'), '議事録のguideが入っている');
  assert.ok(s.includes('JSON'), 'JSONのみの指示がある');
  assert.ok(s.includes('創作しない'), '創作しない旨の指示がある');
  assert.ok(s.includes('［') && s.includes('］'), '空欄にする指示がある');
});

test('構成案system: 存在しない種類はreportのguideになる', () => {
  const s = buildOutlineSystemPrompt('unknown-type');
  assert.strictEqual(s, buildOutlineSystemPrompt('report'));
});

test('構成案user: 参考資料のファイル名と本文が両方入る', () => {
  const u = buildOutlineUserPrompt({
    typeId: 'report',
    brief: '来月の売上報告をまとめたい',
    sources: [{ name: '資料A.docx', text: '売上は好調でした' }],
    today: '2026-09-05',
  });
  assert.ok(u.includes('資料A.docx'));
  assert.ok(u.includes('売上は好調でした'));
  assert.ok(u.includes('来月の売上報告をまとめたい'));
});

test('構成案user: 今日の日付が入る', () => {
  const u = buildOutlineUserPrompt({ typeId: 'report', brief: '', sources: [], today: '2026-09-05' });
  assert.ok(u.includes('2026-09-05'));
});

test('構成案user: 参考資料が0件でも壊れない', () => {
  assert.doesNotThrow(() => buildOutlineUserPrompt({ typeId: 'report', brief: '', sources: [], today: '2026-09-05' }));
  assert.doesNotThrow(() => buildOutlineUserPrompt({ typeId: 'report', today: '2026-09-05' }));
});

test('parseOutlineJson: 素のJSONを解析できる', () => {
  const raw = JSON.stringify({
    title: '9月度定例会議 議事録',
    sections: [{ heading: '決定事項', points: ['A案で進める', '予算は来月確定'] }],
  });
  const { outline, failed } = parseOutlineJson(raw);
  assert.strictEqual(failed, false);
  assert.strictEqual(outline.title, '9月度定例会議 議事録');
  assert.strictEqual(outline.sections.length, 1);
  assert.strictEqual(outline.sections[0].heading, '決定事項');
  assert.deepStrictEqual(outline.sections[0].points, ['A案で進める', '予算は来月確定']);
});

test('parseOutlineJson: コードフェンス付き・前後に説明文が付いていても解析できる', () => {
  const raw1 = '```json\n' + JSON.stringify({ title: 'X', sections: [] }) + '\n```';
  assert.strictEqual(parseOutlineJson(raw1).failed, false);
  assert.strictEqual(parseOutlineJson(raw1).outline.title, 'X');

  const raw2 = 'かしこまりました。\n' + JSON.stringify({ title: 'Y', sections: [] }) + '\nご確認ください。';
  assert.strictEqual(parseOutlineJson(raw2).failed, false);
  assert.strictEqual(parseOutlineJson(raw2).outline.title, 'Y');
});

test('parseOutlineJson: 壊れたJSON・配列・nullで例外を投げずfailed:trueになる', () => {
  assert.doesNotThrow(() => parseOutlineJson('これはJSONではない'));
  assert.strictEqual(parseOutlineJson('これはJSONではない').failed, true);
  assert.strictEqual(parseOutlineJson('[1,2,3]').failed, true);
  assert.strictEqual(parseOutlineJson('null').failed, true);
  assert.strictEqual(parseOutlineJson('').failed, true);
  assert.strictEqual(parseOutlineJson(null).failed, true);
  assert.strictEqual(parseOutlineJson(undefined).failed, true);
  assert.deepStrictEqual(parseOutlineJson('').outline, { title: '', sections: [] });
});

test('parseOutlineJson: sectionsが配列でない・pointsが文字列などの想定外を捨てる', () => {
  const raw1 = JSON.stringify({ title: 'X', sections: 'これは配列ではない' });
  assert.deepStrictEqual(parseOutlineJson(raw1).outline.sections, []);

  const raw2 = JSON.stringify({ title: 'X', sections: [{ heading: '見出し', points: '文字列です' }] });
  assert.deepStrictEqual(parseOutlineJson(raw2).outline.sections, [{ heading: '見出し', points: [] }]);

  const raw3 = JSON.stringify({ title: 'X', sections: [{ heading: '見出し', points: ['正常', 123, null, '正常2'] }] });
  assert.deepStrictEqual(parseOutlineJson(raw3).outline.sections[0].points, ['正常', '正常2']);

  const raw4 = JSON.stringify({ title: 'X', sections: ['文字列の要素', { heading: 'OK', points: [] }] });
  assert.deepStrictEqual(parseOutlineJson(raw4).outline.sections, [{ heading: 'OK', points: [] }]);
});

// ---- 本文プロンプト ----

test('本文system: 種類ごとのguideが含まれ、JSONのみ・創作しないの指示がある', () => {
  const s = buildBodySystemPrompt('handover');
  assert.ok(s.includes('よくあるトラブル'), '引継ぎ資料のguideが入っている');
  assert.ok(s.includes('JSON'));
  assert.ok(s.includes('創作しない'));
  assert.ok(s.includes('［') && s.includes('］'));
});

test('本文user: 参考資料・確定した構成・今日の日付が入る', () => {
  const u = buildBodyUserPrompt({
    typeId: 'minutes',
    brief: '第9回定例会議の議事録を作りたい',
    sources: [{ name: '議事メモ.txt', text: '出席者は5名' }],
    outline: { title: '第9回定例会議 議事録', sections: [{ heading: '決定事項', points: ['予算承認'] }] },
    today: '2026-09-05',
  });
  assert.ok(u.includes('議事メモ.txt'));
  assert.ok(u.includes('出席者は5名'));
  assert.ok(u.includes('決定事項'));
  assert.ok(u.includes('予算承認'));
  assert.ok(u.includes('2026-09-05'));
});

test('本文user: 参考資料0件・構成案なしでも壊れない', () => {
  assert.doesNotThrow(() => buildBodyUserPrompt({ typeId: 'report', brief: '', sources: [], outline: null, today: '2026-09-05' }));
  assert.doesNotThrow(() => buildBodyUserPrompt({ typeId: 'report' }));
});

test('本文user: 出力するJSONの形にmetaとtableが含まれる（Task 41）', () => {
  const u = buildBodyUserPrompt({ typeId: 'minutes', brief: '', sources: [], outline: null, today: '2026-09-05' });
  assert.ok(u.includes('"meta"'), 'JSON例にmetaが含まれる');
  assert.ok(u.includes('"table"'), 'JSON例にtableが含まれる');
  assert.ok(u.includes('headers'), 'JSON例にheadersが含まれる');
  assert.ok(u.includes('rows'), 'JSON例にrowsが含まれる');
});

// ---- 種類ごとのguide（Task 41: 種類ごとの雛形） ----

test('議事録のguide: meta（日時・場所・出席者）と宿題の表を指示する', () => {
  const s = buildBodySystemPrompt('minutes');
  assert.ok(s.includes('日時') && s.includes('場所') && s.includes('出席者'), 'meta項目の指示がある');
  assert.ok(s.includes('宿題'), '宿題の見出しを立てる指示がある');
  assert.ok(s.includes('table') || s.includes('表'), '表にする指示がある');
});

test('報告書のguide: 結論→根拠の順と、数値は表にする指示がある', () => {
  const s = buildBodySystemPrompt('report');
  assert.ok(s.includes('結論'));
  assert.ok(s.includes('根拠'));
  assert.ok(s.includes('table') || s.includes('表'));
});

test('社内文書のguide: metaの発信日・宛先・発信者・件名と「記」書きの指示がある', () => {
  const s = buildBodySystemPrompt('internal');
  assert.ok(s.includes('発信日') && s.includes('宛先') && s.includes('発信者') && s.includes('件名'));
  assert.ok(s.includes('記'));
});

test('引継ぎ資料のguide: 5つの見出しと、手順の番号付き・連絡先の表の指示がある', () => {
  const s = buildBodySystemPrompt('handover');
  for (const h of ['業務の概要', '手順', '注意点', '連絡先', 'よくあるトラブル']) {
    assert.ok(s.includes(h), `${h}の見出し指示がある`);
  }
  assert.ok(s.includes('番号'));
  assert.ok(s.includes('table') || s.includes('表'));
});

test('parseBodyJson: 素のJSONを解析できる（4-4d形式）', () => {
  const raw = JSON.stringify({
    title: '第9回定例会議 議事録',
    sections: [{ heading: '決定事項', paragraphs: ['特になし'], bullets: ['A案で進める', '予算は来月確定'] }],
  });
  const { doc, failed } = parseBodyJson(raw);
  assert.strictEqual(failed, false);
  assert.strictEqual(doc.title, '第9回定例会議 議事録');
  assert.strictEqual(doc.sections[0].heading, '決定事項');
  assert.deepStrictEqual(doc.sections[0].paragraphs, ['特になし']);
  assert.deepStrictEqual(doc.sections[0].bullets, ['A案で進める', '予算は来月確定']);
});

test('parseBodyJson: コードフェンス付き・前後に説明文付きでも解析できる', () => {
  const raw1 = '```json\n' + JSON.stringify({ title: 'X', sections: [] }) + '\n```';
  assert.strictEqual(parseBodyJson(raw1).failed, false);

  const raw2 = '以下がJSONです。\n' + JSON.stringify({ title: 'Y', sections: [] }) + '\n以上です。';
  assert.strictEqual(parseBodyJson(raw2).failed, false);
});

test('parseBodyJson: 壊れたJSON・配列・nullで例外を投げずfailed:trueになる', () => {
  assert.doesNotThrow(() => parseBodyJson('壊れています'));
  assert.strictEqual(parseBodyJson('壊れています').failed, true);
  assert.strictEqual(parseBodyJson('[1,2]').failed, true);
  assert.strictEqual(parseBodyJson('null').failed, true);
  assert.strictEqual(parseBodyJson('').failed, true);
  assert.strictEqual(parseBodyJson(undefined).failed, true);
  assert.deepStrictEqual(parseBodyJson('').doc, { title: '', meta: [], sections: [] });
});

test('parseBodyJson: sectionsが配列でない・bulletsが文字列・paragraphsに数値混入を捨てる', () => {
  const raw1 = JSON.stringify({ title: 'X', sections: 'これは配列ではない' });
  assert.deepStrictEqual(parseBodyJson(raw1).doc.sections, []);

  const raw2 = JSON.stringify({ title: 'X', sections: [{ heading: '見出し', paragraphs: ['正常'], bullets: '文字列です' }] });
  assert.deepStrictEqual(parseBodyJson(raw2).doc.sections, [{
    heading: '見出し', paragraphs: ['正常'], bullets: [], table: null, chart: null,
  }]);

  const raw3 = JSON.stringify({ title: 'X', sections: [{ heading: '見出し', paragraphs: ['正常', 123, null, '正常2'], bullets: [] }] });
  assert.deepStrictEqual(parseBodyJson(raw3).doc.sections[0].paragraphs, ['正常', '正常2']);
});

// ---- meta（Task 41） ----

test('parseBodyJson: metaを正規化する（label・valueの文字列配列）', () => {
  const raw = JSON.stringify({
    title: '第9回定例会議 議事録',
    meta: [
      { label: '日時', value: '2026年9月3日(水) 14:00〜15:00' },
      { label: '場所', value: '第2会議室' },
      { label: '出席者', value: '田中・佐藤・鈴木' },
    ],
    sections: [],
  });
  const { doc } = parseBodyJson(raw);
  assert.deepStrictEqual(doc.meta, [
    { label: '日時', value: '2026年9月3日(水) 14:00〜15:00' },
    { label: '場所', value: '第2会議室' },
    { label: '出席者', value: '田中・佐藤・鈴木' },
  ]);
});

test('parseBodyJson: metaが配列でない・要素がオブジェクトでない・label/valueが型違いでも落ちずに捨てる', () => {
  assert.deepStrictEqual(parseBodyJson(JSON.stringify({ title: 'X', meta: '配列じゃない', sections: [] })).doc.meta, []);
  assert.deepStrictEqual(
    parseBodyJson(JSON.stringify({ title: 'X', meta: ['文字列', null, 123], sections: [] })).doc.meta,
    [],
  );
  assert.deepStrictEqual(
    parseBodyJson(JSON.stringify({ title: 'X', meta: [{ label: 123, value: null }], sections: [] })).doc.meta,
    [],
    'labelもvalueも空になる要素は捨てる',
  );
  assert.deepStrictEqual(
    parseBodyJson(JSON.stringify({ title: 'X', meta: [{ label: '日時' }], sections: [] })).doc.meta,
    [{ label: '日時', value: '' }],
    'valueが無くてもlabelがあれば残す',
  );
});

test('parseBodyJson: metaが無い応答でも空配列になる（既存呼び出しとの互換）', () => {
  const { doc } = parseBodyJson(JSON.stringify({ title: 'X', sections: [] }));
  assert.deepStrictEqual(doc.meta, []);
});

// ---- table（Task 41） ----

test('parseBodyJson: セクションのtableを正規化する（headers・rows）', () => {
  const raw = JSON.stringify({
    title: 'X',
    sections: [{
      heading: '宿題',
      paragraphs: [],
      bullets: [],
      table: { headers: ['項目', '担当', '期限'], rows: [['議事録配布', '田中', '9/10'], ['資料作成', '鈴木', '9/12']] },
    }],
  });
  const { doc } = parseBodyJson(raw);
  assert.deepStrictEqual(doc.sections[0].table, {
    headers: ['項目', '担当', '期限'],
    rows: [['議事録配布', '田中', '9/10'], ['資料作成', '鈴木', '9/12']],
  });
});

test('parseBodyJson: tableの列数が合わない行は捨て、合う行だけ残す', () => {
  const raw = JSON.stringify({
    title: 'X',
    sections: [{
      heading: '宿題',
      table: {
        headers: ['項目', '担当', '期限'],
        rows: [
          ['正しい行', '田中', '9/10'],
          ['列が足りない行', '鈴木'],
          ['列が多い行', '佐藤', '9/12', '余計な列'],
        ],
      },
    }],
  });
  const { doc } = parseBodyJson(raw);
  assert.deepStrictEqual(doc.sections[0].table.rows, [['正しい行', '田中', '9/10']]);
});

test('parseBodyJson: tableが文字列・配列・rowsが配列でない等の型違いでも落ちずnullになる', () => {
  const cases = [
    { headers: ['a'], rows: 'not-an-array' },
    { headers: 'not-an-array', rows: [['x']] },
    { headers: [], rows: [['x']] },
    '文字列です',
    123,
    ['配列です'],
    null,
  ];
  for (const table of cases) {
    const raw = JSON.stringify({ title: 'X', sections: [{ heading: 'H', table }] });
    const { doc } = parseBodyJson(raw);
    assert.strictEqual(doc.sections[0].table, null, `table=${JSON.stringify(table)} はnullになる`);
  }
});

test('parseBodyJson: tableのセル値に数値が混ざっていても文字列化して残す', () => {
  const raw = JSON.stringify({
    title: 'X',
    sections: [{ heading: 'H', table: { headers: ['項目', '件数'], rows: [['A', 3]] } }],
  });
  const { doc } = parseBodyJson(raw);
  assert.deepStrictEqual(doc.sections[0].table.rows, [['A', '3']]);
});

test('parseBodyJson: tableが無いセクションはtable:nullになる（既存呼び出しとの互換）', () => {
  const raw = JSON.stringify({ title: 'X', sections: [{ heading: 'H', paragraphs: ['p'], bullets: [] }] });
  const { doc } = parseBodyJson(raw);
  assert.strictEqual(doc.sections[0].table, null);
});

// ---- sanitizeChart（Task 43） ----

test('sanitizeChart: 正しい形はそのまま正規化される', () => {
  const chart = sanitizeChart({
    type: 'bar',
    title: '月別売上',
    labels: ['1月', '2月'],
    series: [{ name: '売上', values: [120, 150] }],
  });
  assert.deepStrictEqual(chart, {
    type: 'bar',
    title: '月別売上',
    labels: ['1月', '2月'],
    series: [{ name: '売上', values: [120, 150] }],
  });
});

test('sanitizeChart: typeが3種以外ならbarに倒す', () => {
  const chart = sanitizeChart({
    type: 'radar', labels: ['A'], series: [{ name: 'S', values: [1] }],
  });
  assert.strictEqual(chart.type, 'bar');
});

test('sanitizeChart: labelsと長さが合わない系列は捨てる（他の系列は残す）', () => {
  const chart = sanitizeChart({
    type: 'bar',
    labels: ['1月', '2月', '3月'],
    series: [
      { name: '正常', values: [1, 2, 3] },
      { name: '長さ違い', values: [1, 2] },
    ],
  });
  assert.strictEqual(chart.series.length, 1);
  assert.strictEqual(chart.series[0].name, '正常');
});

test('sanitizeChart: 数値でない値が混ざる系列は丸ごと捨てる', () => {
  const chart = sanitizeChart({
    type: 'line',
    labels: ['1月', '2月'],
    series: [
      { name: '正常', values: [1, 2] },
      { name: '壊れている', values: [1, 'NaN'] },
      { name: 'nullも同様', values: [1, null] },
    ],
  });
  assert.strictEqual(chart.series.length, 1);
  assert.strictEqual(chart.series[0].name, '正常');
});

test('sanitizeChart: 系列が0本になればchart自体をnullにする', () => {
  assert.strictEqual(sanitizeChart({ type: 'bar', labels: ['A'], series: [] }), null);
  assert.strictEqual(
    sanitizeChart({ type: 'bar', labels: ['A'], series: [{ name: 'X', values: [1, 2] }] }),
    null,
  );
});

test('sanitizeChart: labelsが空ならnullにする', () => {
  assert.strictEqual(sanitizeChart({ type: 'bar', labels: [], series: [{ name: 'X', values: [] }] }), null);
});

test('sanitizeChart: 想定外の型（null・配列・文字列・object以外）でも例外を投げずnullになる', () => {
  for (const bad of [null, undefined, '文字列', 123, [], ['配列']]) {
    assert.doesNotThrow(() => sanitizeChart(bad));
    assert.strictEqual(sanitizeChart(bad), null);
  }
});

test('sanitizeChart: 値が0件・1件の系列でも落ちない', () => {
  assert.strictEqual(sanitizeChart({ type: 'bar', labels: [], series: [{ name: 'X', values: [] }] }), null);
  const chart = sanitizeChart({ type: 'pie', labels: ['唯一'], series: [{ name: 'X', values: [42] }] });
  assert.deepStrictEqual(chart.labels, ['唯一']);
  assert.deepStrictEqual(chart.series[0].values, [42]);
});

test('sanitizeChart: titleが無くても落ちない（空文字になる）', () => {
  const chart = sanitizeChart({ type: 'bar', labels: ['A'], series: [{ values: [1] }] });
  assert.strictEqual(chart.title, '');
  assert.strictEqual(chart.series[0].name, '');
});

// ---- parseBodyJson: chart（Task 43） ----

test('parseBodyJson: sectionのchartを正規化して取り込む', () => {
  const raw = JSON.stringify({
    title: 'X',
    sections: [{
      heading: '売上推移',
      chart: {
        type: 'line', title: '月別売上', labels: ['1月', '2月'], series: [{ name: '売上', values: [100, 120] }],
      },
    }],
  });
  const { doc } = parseBodyJson(raw);
  assert.deepStrictEqual(doc.sections[0].chart, {
    type: 'line', title: '月別売上', labels: ['1月', '2月'], series: [{ name: '売上', values: [100, 120] }],
  });
});

test('parseBodyJson: chartが崩れていてもsection自体は落ちず、chart:nullになる', () => {
  const raw = JSON.stringify({
    title: 'X',
    sections: [{ heading: 'H', paragraphs: ['p'], chart: { type: 'bar', labels: ['A', 'B'], series: [{ values: [1] }] } }],
  });
  const { doc } = parseBodyJson(raw);
  assert.strictEqual(doc.sections[0].chart, null);
  assert.strictEqual(doc.sections[0].heading, 'H');
});

test('parseBodyJson: chartが無いセクションはchart:nullになる（既存呼び出しとの互換）', () => {
  const raw = JSON.stringify({ title: 'X', sections: [{ heading: 'H', paragraphs: ['p'] }] });
  const { doc } = parseBodyJson(raw);
  assert.strictEqual(doc.sections[0].chart, null);
});
