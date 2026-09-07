// test/mailcheck.test.js
// 受信確認の入口と、各方式のつなぎ目。
// ネットワークもOutlookも使わない範囲（設定の検証・応答の読み取り・エラーの言い換え）を見る。
const test = require('node:test');
const assert = require('node:assert');
const mailcheck = require('../src/main/mailcheck');
const outlook = require('../src/main/mailcheck/outlook');
const gmail = require('../src/main/mailcheck/gmail');

test('相手が1件も無ければ、接続する前に止める', async () => {
  const r = await mailcheck.check({ provider: 'gmail', watch: [], address: 'me@x.com', appPassword: 'p' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'no-watch');
});

test('Gmailはアドレスとアプリパスワードが揃っていないと止める', async () => {
  const watch = [{ address: 'a@x.com' }];
  const noAddr = await mailcheck.check({ provider: 'gmail', watch, appPassword: 'p' });
  assert.strictEqual(noAddr.kind, 'no-account');
  const noPass = await mailcheck.check({ provider: 'gmail', watch, address: 'me@x.com' });
  assert.strictEqual(noPass.kind, 'no-password');
});

test('Outlookはパスワードを要求しない（サインイン済みの本体を読むため）', () => {
  const r = mailcheck.validate({ provider: 'outlook', watch: [{ address: 'a@x.com' }] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.provider, 'outlook');
});

test('未知の方式は Gmail に倒す', () => {
  assert.strictEqual(mailcheck.normalizeProvider('あ'), 'gmail');
  assert.strictEqual(mailcheck.normalizeProvider('outlook'), 'outlook');
});

test('メーラーで開くための情報を作る', () => {
  assert.deepStrictEqual(
    mailcheck.openTarget({ provider: 'gmail', messageId: '<a@b>' }),
    { kind: 'url', url: 'https://mail.google.com/mail/u/0/#search/rfc822msgid:a%40b' }
  );
  assert.deepStrictEqual(
    mailcheck.openTarget({ provider: 'outlook', entryId: 'E1' }),
    { kind: 'outlook', entryId: 'E1' }
  );
  assert.deepStrictEqual(mailcheck.openTarget({ provider: 'outlook' }), { kind: 'none' });
});

test('PowerShellの応答は、0件でも1件でも壊れていても落ちない', () => {
  assert.deepStrictEqual(outlook.parseScriptOutput('').rows, []);
  assert.deepStrictEqual(outlook.parseScriptOutput('[]').rows, []);
  assert.strictEqual(outlook.parseScriptOutput('[{"subject":"a"},{"subject":"b"}]').rows.length, 2);
  assert.strictEqual(outlook.parseScriptOutput('{"subject":"a"}').rows.length, 1, '1件でも配列にする');
  assert.strictEqual(outlook.parseScriptOutput('これはJSONではない').ok, false);
});

test('Outlookが無いときは、何をすればいいか分かる文言にする', () => {
  const notInstalled = outlook.classify('80040154 クラスが登録されていません', null);
  assert.strictEqual(notInstalled.kind, 'not-installed');
  assert.ok(notInstalled.message.includes('Outlook'));
  assert.strictEqual(outlook.classify('なにか別の失敗', null).kind, 'unknown');
});

test('Gmailのログイン失敗と接続失敗を区別する', () => {
  assert.strictEqual(gmail.classify({ responseText: 'Invalid credentials (Failure)' }).kind, 'auth');
  assert.ok(gmail.classify({ responseText: 'Invalid credentials' }).message.includes('アプリパスワード'));
  assert.strictEqual(gmail.classify({ code: 'ENOTFOUND' }).kind, 'network');
  assert.strictEqual(gmail.classify({ message: 'なにか' }).kind, 'unknown');
});

test('IMAPのエンベロープを共通の形に均す', () => {
  const m = gmail.fromEnvelope({
    messageId: '<x@y>',
    date: new Date('2026-09-01T00:00:00Z'),
    from: [{ address: 'A@x.com', name: '山田' }],
    to: [{ address: 'me@mine.com' }, { address: 'other@z.com' }],
    cc: [{ address: 'cc@z.com' }],
    subject: '件名',
  }, new Set());
  assert.strictEqual(m.from, 'A@x.com');
  assert.strictEqual(m.fromName, '山田');
  assert.strictEqual(m.to, 'me@mine.com, other@z.com');
  assert.strictEqual(m.cc, 'cc@z.com');
  assert.strictEqual(m.unread, true, '\\Seen が無ければ未読');
  assert.strictEqual(gmail.fromEnvelope({}, new Set(['\\Seen'])).unread, false);
  assert.strictEqual(gmail.fromEnvelope(null, null).from, '', 'エンベロープが無くても落ちない');
});

test('Outlookのスクリプトは日本語コメントのためUTF-8 BOM付きであること', () => {
  const fs = require('node:fs');
  const head = fs.readFileSync(outlook.resolveScriptPath(), null).subarray(0, 3);
  assert.deepStrictEqual([...head], [0xEF, 0xBB, 0xBF],
    'BOMが無いとPowerShell 5.1がShift-JISとして読み、構文エラーになる');
});

test('パッケージ後は asar.unpacked 側のスクリプトを指す', () => {
  const path = require('node:path');
  const inAsar = path.join('C:', 'app', 'app.asar', 'src', 'main', 'mailcheck');
  assert.ok(outlook.resolveScriptPath(inAsar).includes(`app.asar.unpacked${path.sep}`));
});
