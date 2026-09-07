// test/docgen-drafts.test.js
// 資料作成の下書き。画面を離れると入力が消えていたのを、あとから続けられるようにする。
const test = require('node:test');
const assert = require('node:assert');
const d = require('../src/main/docgen/drafts');

test('名前を付けなければ、用件の1行目を名前にする', () => {
  assert.strictEqual(d.makeName('', '経費精算の引継ぎ\n毎月末に…', '2026-09-07T10:00:00Z'), '経費精算の引継ぎ');
  assert.strictEqual(d.makeName('  手動の名前 ', '用件', '2026-09-07T10:00:00Z'), '手動の名前');
});

test('用件も空なら日付を名前にする', () => {
  const name = d.makeName('', '', '2026-09-07T10:00:00Z');
  assert.ok(name.includes('2026/09/07'), name);
  assert.ok(name.includes('下書き'));
});

test('長すぎる名前は切り詰める', () => {
  assert.strictEqual(d.makeName('あ'.repeat(200), '', '').length, d.MAX_NAME);
});

test('壊れた保存内容でも形にはめ直す', () => {
  const one = d.normalizeDraft({ typeId: 'handover', brief: '引継ぎ', filePaths: ['a.docx', '', null, 'b.pdf'] });
  assert.strictEqual(one.typeId, 'handover');
  assert.deepStrictEqual(one.filePaths, ['a.docx', 'b.pdf'], '空のパスは落とす');
  assert.strictEqual(one.outline, null);
  assert.ok(one.id, 'idが無ければ作る');

  const broken = d.normalizeDraft(null);
  assert.strictEqual(broken.typeId, 'report', '種類が不明なら report に倒す');
  assert.deepStrictEqual(d.normalizeList('あ'), []);
});

test('保存すると新しい順に並び、同じidは上書きされる', () => {
  let list = [];
  ({ list } = d.saveDraft(list, { id: 'a', brief: '1件目' }));
  ({ list } = d.saveDraft(list, { id: 'b', brief: '2件目' }));
  assert.deepStrictEqual(list.map((x) => x.id), ['b', 'a'], '新しいものが先頭');

  ({ list } = d.saveDraft(list, { id: 'a', brief: '1件目を直した' }));
  assert.strictEqual(list.length, 2, '同じidは増えない');
  assert.strictEqual(list[0].id, 'a');
  assert.strictEqual(list[0].brief, '1件目を直した');
});

test('上限を超えたら古いものから捨てる', () => {
  let list = [];
  for (let i = 0; i < d.MAX_DRAFTS + 5; i += 1) {
    ({ list } = d.saveDraft(list, { id: `d${i}`, brief: `${i}` }));
  }
  assert.strictEqual(list.length, d.MAX_DRAFTS);
  assert.strictEqual(list[0].id, `d${d.MAX_DRAFTS + 4}`, '最新が残る');
});

test('作りかけの構成案・本文も一緒に残せる（作り直すと費用がかかるため）', () => {
  const { draft } = d.saveDraft([], {
    id: 'x', brief: 'b',
    outline: { title: 'T', sections: [] },
    doc: { title: 'T', sections: [{ heading: 'h' }] },
  });
  assert.strictEqual(draft.outline.title, 'T');
  assert.strictEqual(draft.doc.sections.length, 1);
  assert.strictEqual(d.toSummary(draft).hasDoc, true);
});

test('削除と取り出し', () => {
  let list = [];
  ({ list } = d.saveDraft(list, { id: 'a', brief: 'A' }));
  ({ list } = d.saveDraft(list, { id: 'b', brief: 'B' }));
  assert.strictEqual(d.findDraft(list, 'a').brief, 'A');
  assert.strictEqual(d.findDraft(list, 'zzz'), null);
  const after = d.removeDraft(list, 'a');
  assert.deepStrictEqual(after.map((x) => x.id), ['b']);
  assert.strictEqual(d.removeDraft(after, 'zzz').length, 1, '無いidを消しても減らない');
});

test('一覧に出す形には、重い中身を含めない', () => {
  const { draft } = d.saveDraft([], { id: 'x', brief: 'b', filePaths: ['a', 'b'], doc: { title: 'T' } });
  const s = d.toSummary(draft);
  assert.deepStrictEqual(Object.keys(s).sort(),
    ['fileCount', 'hasDoc', 'hasOutline', 'id', 'name', 'savedAt', 'typeId']);
  assert.strictEqual(s.fileCount, 2);
});
