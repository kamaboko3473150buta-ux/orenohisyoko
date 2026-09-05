const test = require('node:test');
const assert = require('node:assert');
const { findDocType, DOC_TYPES } = require('../src/main/docgen/types');
const {
  buildOutlineSystemPrompt, buildOutlineUserPrompt, parseOutlineJson,
  buildBodySystemPrompt, buildBodyUserPrompt, parseBodyJson,
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
    heading: '見出し', paragraphs: ['正常'], bullets: [], table: null,
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
