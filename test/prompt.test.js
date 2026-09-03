const test = require('node:test');
const assert = require('node:assert');
const { buildAddressBlock } = require('../src/main/mail-compose/prompt');

test('会社名・部署・氏名・敬称がすべてあるとき', () => {
  const r = buildAddressBlock({ company: '株式会社○○', department: '営業部', name: '山田 太郎', honorific: '様' });
  assert.strictEqual(r, '株式会社○○\n営業部 山田 太郎 様');
});

test('会社名だけのときは会社名に敬称が付く', () => {
  const r = buildAddressBlock({ company: '株式会社○○', honorific: '御中' });
  assert.strictEqual(r, '株式会社○○ 御中');
});

test('氏名だけのとき', () => {
  const r = buildAddressBlock({ name: '山田 太郎', honorific: '様' });
  assert.strictEqual(r, '山田 太郎 様');
});

test('敬称なしを選んだときは敬称を付けない', () => {
  const r = buildAddressBlock({ company: '株式会社○○', name: '山田 太郎', honorific: '' });
  assert.strictEqual(r, '株式会社○○\n山田 太郎');
});

test('前後の空白は取り除かれる', () => {
  const r = buildAddressBlock({ company: '  株式会社○○  ', name: ' 山田 太郎 ', honorific: '様' });
  assert.strictEqual(r, '株式会社○○\n山田 太郎 様');
});

test('何も入力がないときは空文字を返す', () => {
  assert.strictEqual(buildAddressBlock({}), '');
});
