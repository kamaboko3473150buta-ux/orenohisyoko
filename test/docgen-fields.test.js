// test/docgen-fields.test.js
// 資料の種類ごとの入力項目。ねらいは「AIに推測させない」こと。
// 日時・出席者・宛先といった項目はAIが創作してはいけないので、
// 入力した値はAIを通さずそのまま文書に入ることを確かめる。
const test = require('node:test');
const assert = require('node:assert');
const f = require('../src/main/docgen/fields');

test('種類ごとに項目が決まっている。知らない種類は空', () => {
  assert.ok(f.fieldsFor('minutes').some((x) => x.id === 'attendees'));
  assert.ok(f.fieldsFor('handover').some((x) => x.id === 'contacts'));
  assert.deepStrictEqual(f.fieldsFor('あ'), []);
});

test('その種類に無い項目・空の値は落とす', () => {
  const v = f.normalizeValues('minutes', {
    datetime: ' 9月3日 ', place: '', attendees: '山田、佐藤', period: '関係ない項目', nope: 'x',
  });
  assert.deepStrictEqual(v, { datetime: '9月3日', attendees: '山田、佐藤' });
  assert.deepStrictEqual(f.normalizeValues('minutes', null), {});
});

test('入力した項目は、そのまま冒頭の項目表になる', () => {
  const meta = f.metaFromValues('minutes', { datetime: '9月3日 14:00', attendees: '山田、佐藤' });
  assert.deepStrictEqual(meta, [
    { label: '日時', value: '9月3日 14:00' },
    { label: '出席者', value: '山田、佐藤' },
  ]);
});

test('連絡先は1行1件の表になる。連絡先側のカンマは分けない', () => {
  const t = f.contactsTable('handover', {
    contacts: '経理部 田中, 内線1234\n○○商事 佐藤様, 03-0000-0000, 内線9\n\n名前だけ',
  });
  assert.deepStrictEqual(t.headers, f.CONTACT_HEADERS);
  assert.deepStrictEqual(t.rows, [
    ['経理部 田中', '内線1234'],
    ['○○商事 佐藤様', '03-0000-0000, 内線9'],
    ['名前だけ', ''],
  ]);
  assert.strictEqual(f.contactsTable('handover', {}), null);
  assert.strictEqual(f.contactsTable('minutes', { contacts: 'x' }), null, '連絡先の無い種類では作らない');
});

test('判断が要るものだけAIへの指示に回す', () => {
  assert.deepStrictEqual(
    f.hintsFromValues('presentation', { minutes: '10', audience: '役員向け' }),
    ['発表時間（分）: 10', '想定聴衆: 役員向け']
  );
  assert.deepStrictEqual(f.hintsFromValues('minutes', { datetime: '9月3日' }), [],
    '議事録の日時はそのまま文書に入れるので、AIには回さない');
});

test('入力済みの項目名は、AIに「作らないで」と伝えるために出す', () => {
  assert.deepStrictEqual(f.suppliedLabels('internal', { addressee: '営業部 各位', issuer: '総務部' }),
    ['宛先', '発信者']);
  assert.deepStrictEqual(f.suppliedLabels('presentation', { minutes: '10' }), [],
    '指示に回すものは「入力済み」に数えない');
});

test('入力した値が、AIの作った文書より優先される', () => {
  const doc = {
    title: '議事録',
    meta: [{ label: '日時', value: 'AIが作った日時' }, { label: '議題', value: '来期の方針' }],
    sections: [{ heading: '決定事項', paragraphs: ['…'] }],
  };
  const out = f.applyToDoc(doc, 'minutes', { datetime: '2026年9月3日 14:00', attendees: '山田、佐藤' });
  assert.deepStrictEqual(out.meta, [
    { label: '日時', value: '2026年9月3日 14:00' },
    { label: '出席者', value: '山田、佐藤' },
    { label: '議題', value: '来期の方針' },
  ], '同じ見出しは利用者の値で置き換え、AI側の他の項目は残す');
  assert.strictEqual(out.sections.length, 1, '議事録では表を足さない');
});

test('引継ぎ資料では、連絡先の表が最後の見出しとして足される', () => {
  const doc = { title: '引継ぎ', meta: [], sections: [{ heading: '手順' }] };
  const out = f.applyToDoc(doc, 'handover', { jobName: '経費精算', contacts: '経理部 田中, 内線1234' });
  assert.deepStrictEqual(out.meta, [{ label: '業務名', value: '経費精算' }]);
  assert.strictEqual(out.sections.length, 2);
  assert.strictEqual(out.sections[1].heading, '関係連絡先');
  assert.deepStrictEqual(out.sections[1].table.rows, [['経理部 田中', '内線1234']]);
});

test('何も入力していなければ、文書はそのまま', () => {
  const doc = { title: 'T', meta: [{ label: 'a', value: 'b' }], sections: [] };
  assert.strictEqual(f.applyToDoc(doc, 'minutes', {}), doc);
  assert.strictEqual(f.applyToDoc(doc, 'minutes', null), doc);
});

test('壊れた文書を渡しても落ちない', () => {
  const out = f.applyToDoc(null, 'minutes', { datetime: '9月3日' });
  assert.deepStrictEqual(out.meta, [{ label: '日時', value: '9月3日' }]);
  const out2 = f.applyToDoc({ meta: 'おかしな値' }, 'minutes', { datetime: '9月3日' });
  assert.strictEqual(out2.meta.length, 1);
});
