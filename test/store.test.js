const test = require('node:test');
const assert = require('node:assert');
const { upsertContact, addHistory, MAX_ITEMS } = require('../src/main/store');

test('新しい宛先が先頭に追加される', () => {
  const list = upsertContact([], { email: 'a@example.com', name: '山田' }, '2026-09-04T10:00:00.000Z');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].email, 'a@example.com');
  assert.strictEqual(list[0].lastUsedAt, '2026-09-04T10:00:00.000Z');
});

test('同じメールアドレスは重複せず上書きされる', () => {
  let list = upsertContact([], { email: 'a@example.com', name: '山田' }, '2026-09-01T00:00:00.000Z');
  list = upsertContact(list, { email: 'a@example.com', name: '山田 太郎' }, '2026-09-04T00:00:00.000Z');
  assert.strictEqual(list.length, 1, '1件のまま');
  assert.strictEqual(list[0].name, '山田 太郎', '新しい情報で上書きされる');
});

test('大文字小文字が違うメールアドレスも同一とみなす', () => {
  let list = upsertContact([], { email: 'a@example.com' }, '2026-09-01T00:00:00.000Z');
  list = upsertContact(list, { email: 'A@Example.com' }, '2026-09-04T00:00:00.000Z');
  assert.strictEqual(list.length, 1);
});

test('最近使ったものが先頭に来る', () => {
  let list = upsertContact([], { email: 'a@example.com' }, '2026-09-01T00:00:00.000Z');
  list = upsertContact(list, { email: 'b@example.com' }, '2026-09-02T00:00:00.000Z');
  list = upsertContact(list, { email: 'a@example.com' }, '2026-09-03T00:00:00.000Z');
  assert.strictEqual(list[0].email, 'a@example.com');
});

test('メールアドレスが空なら追加しない', () => {
  assert.strictEqual(upsertContact([], { email: '' }, '2026-09-04T00:00:00.000Z').length, 0);
  assert.strictEqual(upsertContact([], {}, '2026-09-04T00:00:00.000Z').length, 0);
});

test('宛先は上限を超えると古いものから消える', () => {
  let list = [];
  for (let i = 0; i < MAX_ITEMS + 10; i += 1) {
    list = upsertContact(list, { email: `u${i}@example.com` }, new Date(2026, 0, 1, 0, i).toISOString());
  }
  assert.strictEqual(list.length, MAX_ITEMS);
  assert.strictEqual(list[0].email, `u${MAX_ITEMS + 9}@example.com`, '最新が先頭');
});

test('文面履歴は新しいものが先頭に入る', () => {
  let list = addHistory([], { subject: '1通目' });
  list = addHistory(list, { subject: '2通目' });
  assert.strictEqual(list[0].subject, '2通目');
  assert.strictEqual(list.length, 2);
});

test('文面履歴も上限を超えると古いものから消える', () => {
  let list = [];
  for (let i = 0; i < MAX_ITEMS + 5; i += 1) list = addHistory(list, { subject: `件名${i}` });
  assert.strictEqual(list.length, MAX_ITEMS);
  assert.strictEqual(list[0].subject, `件名${MAX_ITEMS + 4}`);
});

test('壊れた履歴（配列でない）を渡されても落ちない', () => {
  assert.strictEqual(addHistory(null, { subject: 'x' }).length, 1);
  assert.strictEqual(upsertContact(undefined, { email: 'a@example.com' }, 'now').length, 1);
});
