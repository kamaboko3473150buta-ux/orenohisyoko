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

const { buildSystemPrompt, buildUserPrompt } = require('../src/main/mail-compose/prompt');

test('systemプロンプトは本文だけを出力するよう指示している', () => {
  const s = buildSystemPrompt();
  assert.ok(s.includes('本文のみ'), '本文のみを出力する指示がある');
  assert.ok(s.includes('件名'), '件名を出力しない指示がある');
  assert.ok(s.includes('署名'), '署名を書かない指示がある');
});

test('userプロンプトに場面・文体・件名・メモが埋め込まれる', () => {
  const p = buildUserPrompt({
    sceneId: 'thanks',
    toneId: 'internal',
    recipient: { company: '株式会社○○', name: '山田 太郎', honorific: '様' },
    subject: 'お打ち合わせの御礼',
    memo: '昨日の打ち合わせのお礼を伝えたい',
  });
  assert.ok(p.includes('御礼'), '場面の名前が入る');
  assert.ok(p.includes('社内向け・簡潔に'), '文体の名前が入る');
  assert.ok(p.includes('お打ち合わせの御礼'), '件名が入る');
  assert.ok(p.includes('昨日の打ち合わせのお礼を伝えたい'), 'メモが入る');
  assert.ok(p.includes('株式会社○○'), '宛名が入る');
});

test('未入力の欄があってもundefinedやnullが文字列に混ざらない', () => {
  const p = buildUserPrompt({ sceneId: 'other', toneId: 'formal_external', recipient: {}, subject: '', memo: '相談したい' });
  assert.ok(!p.includes('undefined'), 'undefinedが含まれない');
  assert.ok(!p.includes('null'), 'nullが含まれない');
});

test('存在しない場面IDでも落ちずにその他として扱う', () => {
  const p = buildUserPrompt({ sceneId: 'zzz', toneId: 'zzz', recipient: {}, subject: 'x', memo: 'y' });
  assert.ok(p.includes('その他'), 'その他になる');
  assert.ok(p.includes('かしこまった社外向け'), '既定の文体になる');
});

const { appendSignature } = require('../src/main/mail-compose/prompt');

test('署名が本文の末尾に区切り線付きで1回だけ付く', () => {
  const r = appendSignature('本文です。', '株式会社△△\n松原 太郎');
  assert.ok(r.startsWith('本文です。'), '本文が先頭にある');
  assert.ok(r.endsWith('株式会社△△\n松原 太郎'), '署名が末尾にある');
  assert.strictEqual(r.split('松原 太郎').length - 1, 1, '署名は1回だけ');
});

test('署名が空なら本文だけを返す', () => {
  assert.strictEqual(appendSignature('本文です。', ''), '本文です。');
  assert.strictEqual(appendSignature('本文です。', '   '), '本文です。');
  assert.strictEqual(appendSignature('本文です。', undefined), '本文です。');
});

test('本文末尾の余分な改行は整理される', () => {
  const r = appendSignature('本文です。\n\n\n', '署名');
  assert.strictEqual(r, `本文です。\n\n${'-'.repeat(30)}\n署名`);
});

test('appendSignatureの第1引数がnull/undefinedでも落ちず、署名だけが返る', () => {
  assert.strictEqual(appendSignature(null, '署名'), '署名');
  assert.strictEqual(appendSignature(undefined, '署名'), '署名');
});

test('部署だけで氏名が無いとき、人物用の敬称（様）は付かない', () => {
  const r = buildAddressBlock({ department: '営業部', honorific: '様' });
  assert.strictEqual(r, '営業部');
});

test('部署だけで氏名が無いとき、御中は付く', () => {
  const r = buildAddressBlock({ department: '営業部', honorific: '御中' });
  assert.strictEqual(r, '営業部 御中');
});

test('会社名＋部署で氏名が無いとき、会社名は別行・部署に御中が付く', () => {
  const r = buildAddressBlock({ company: '株式会社○○', department: '営業部', honorific: '御中' });
  assert.strictEqual(r, '株式会社○○\n営業部 御中');
});
