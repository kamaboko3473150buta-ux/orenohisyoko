const test = require('node:test');
const assert = require('node:assert');
const {
  migrate, upsertContact, removeContact, upsertGroup, removeGroup, resolveGroup, sortContacts,
} = require('../src/main/contacts');

const NOW = '2026-09-05T10:00:00.000Z';

test('旧形式（配列）を渡すとcontactsに移行され、email/会社/氏名/敬称が保たれる', () => {
  const old = [
    { email: 'a@example.com', company: '株式会社○○', name: '山田 太郎', honorific: '様' },
  ];
  const book = migrate(old);
  assert.strictEqual(book.version, 2);
  assert.strictEqual(book.contacts.length, 1);
  assert.strictEqual(book.contacts[0].email, 'a@example.com');
  assert.strictEqual(book.contacts[0].company, '株式会社○○');
  assert.strictEqual(book.contacts[0].name, '山田 太郎');
  assert.strictEqual(book.contacts[0].honorific, '様');
  assert.ok(book.contacts[0].id.startsWith('c-'), 'idが採番される');
  assert.deepStrictEqual(book.groups, []);
});

test('旧形式の複数件は、それぞれ一意なidが振られる', () => {
  const old = [{ email: 'a@example.com' }, { email: 'b@example.com' }];
  const book = migrate(old);
  assert.notStrictEqual(book.contacts[0].id, book.contacts[1].id);
});

test('null・{}・文字列・配列でないものを渡しても落ちず、空のアドレス帳を返す', () => {
  for (const raw of [null, undefined, {}, 'hello', 123, true]) {
    const book = migrate(raw);
    assert.strictEqual(book.version, 2, `raw=${raw}`);
    assert.deepStrictEqual(book.contacts, [], `raw=${raw}`);
    assert.deepStrictEqual(book.groups, [], `raw=${raw}`);
  }
});

test('壊れた配列要素（null・文字列など）が混ざっていても落ちない', () => {
  const book = migrate([null, 'x', { email: 'a@example.com' }]);
  assert.strictEqual(book.contacts.length, 3);
  assert.strictEqual(book.contacts[2].email, 'a@example.com');
});

test('すでに新形式ならそのまま返す（二重移行しない）', () => {
  const already = { version: 2, contacts: [{ id: 'c-11111111', email: 'a@example.com' }], groups: [] };
  const book = migrate(already);
  assert.strictEqual(book.contacts[0].id, 'c-11111111', 'idが振り直されない');
});

test('upsertContactが大文字小文字・前後空白の違う同じメールを同一とみなす', () => {
  let book = migrate([]);
  book = upsertContact(book, { email: '  A@Example.com  ', name: '山田' }, '2026-09-01T00:00:00.000Z');
  book = upsertContact(book, { email: 'a@example.com', name: '山田 太郎' }, NOW);
  assert.strictEqual(book.contacts.length, 1, '1件のまま');
  assert.strictEqual(book.contacts[0].name, '山田 太郎', '新しい情報で上書きされる');
  assert.strictEqual(book.contacts[0].lastUsedAt, NOW);
});

test('emailが空の連絡先は追加されない', () => {
  const book = migrate([]);
  const after = upsertContact(book, { email: '', name: '名前だけ' }, NOW);
  assert.strictEqual(after.contacts.length, 0);
  const after2 = upsertContact(book, {}, NOW);
  assert.strictEqual(after2.contacts.length, 0);
});

test('upsertContactは上限を設けない', () => {
  let book = migrate([]);
  for (let i = 0; i < 150; i += 1) {
    book = upsertContact(book, { email: `u${i}@example.com` }, NOW);
  }
  assert.strictEqual(book.contacts.length, 150);
});

test('removeContactで、その人が入っていたグループのmemberIdsからも消える', () => {
  let book = migrate([]);
  book = upsertContact(book, { email: 'a@example.com' }, NOW);
  const id = book.contacts[0].id;
  book = upsertGroup(book, { name: '営業チーム', memberIds: [id, 'c-other'] });
  const groupId = book.groups[0].id;

  book = removeContact(book, id);
  assert.strictEqual(book.contacts.length, 0, '連絡先が消える');
  assert.deepStrictEqual(book.groups[0].memberIds, ['c-other'], 'グループからも消える');
  assert.strictEqual(book.groups[0].id, groupId, 'グループ自体は残る');
});

test('upsertGroupが新規は採番し、既存は上書きする', () => {
  let book = migrate([]);
  book = upsertGroup(book, { name: 'A班', memberIds: [] });
  assert.strictEqual(book.groups.length, 1);
  const id = book.groups[0].id;
  assert.ok(id.startsWith('g-'), 'idが採番される');

  book = upsertGroup(book, { id, name: 'A班（改名）', memberIds: ['c-1'] });
  assert.strictEqual(book.groups.length, 1, '件数は増えない');
  assert.strictEqual(book.groups[0].name, 'A班（改名）');
  assert.deepStrictEqual(book.groups[0].memberIds, ['c-1']);
});

test('resolveGroupが存在しないメンバーIDを飛ばし、残りを返す', () => {
  let book = migrate([]);
  book = upsertContact(book, { email: 'a@example.com', name: '山田' }, NOW);
  const id = book.contacts[0].id;
  book = upsertGroup(book, { name: 'G', memberIds: [id, 'c-not-exist'] });
  const groupId = book.groups[0].id;

  const resolved = resolveGroup(book, groupId);
  assert.strictEqual(resolved.length, 1);
  assert.strictEqual(resolved[0].email, 'a@example.com');
});

test('resolveGroupは存在しないgroupIdを渡されても落ちず空配列を返す', () => {
  const book = migrate([]);
  assert.deepStrictEqual(resolveGroup(book, 'g-not-exist'), []);
});

test('removeGroupでグループが消える', () => {
  let book = migrate([]);
  book = upsertGroup(book, { name: 'G', memberIds: [] });
  const id = book.groups[0].id;
  book = removeGroup(book, id);
  assert.strictEqual(book.groups.length, 0);
});

test('sortContactsが会社名→氏名で並ぶ', () => {
  const list = [
    { company: 'あ社', name: '鈴木' },
    { company: 'あ社', name: '青木' },
    { company: 'か社', name: '田中' },
  ];
  const sorted = sortContacts(list);
  assert.deepStrictEqual(sorted.map((c) => `${c.company}/${c.name}`), [
    'あ社/青木', 'あ社/鈴木', 'か社/田中',
  ]);
});

test('sortContactsは元の配列を壊さない', () => {
  const list = [{ company: 'い', name: 'b' }, { company: 'あ', name: 'a' }];
  const before = list.map((c) => c.company).join(',');
  sortContacts(list);
  assert.strictEqual(list.map((c) => c.company).join(','), before);
});
