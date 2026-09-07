// test/mailcheck-query.test.js
// 受信確認の「探し方」と「当たり判定」。
// Gmail と Outlook で探し方が違っても、当たり判定はここ1か所に集約している。
const test = require('node:test');
const assert = require('node:assert');
const q = require('../src/main/mailcheck/query');

test('アドレスの表記ゆれをそろえる', () => {
  assert.strictEqual(q.normalizeAddress('  Yamada@Example.COM '), 'yamada@example.com');
  assert.strictEqual(q.normalizeAddress('山田 太郎 <Yamada@Example.com>'), 'yamada@example.com');
  assert.strictEqual(q.normalizeAddress(null), '');
  assert.deepStrictEqual(q.splitAddresses('a@x.com, 佐藤 <B@Y.com>'), ['a@x.com', 'b@y.com']);
});

test('監視する相手の一覧から、空・重複・形式違いを落とす', () => {
  const list = q.normalizeWatchList([
    'A@example.com',
    { address: 'a@EXAMPLE.com', label: '重複' },
    { address: 'b@example.co.jp', label: ' ○○商事 ' },
    'アドレスじゃない',
    '',
    null,
  ]);
  assert.deepStrictEqual(list, [
    { address: 'a@example.com' },
    { address: 'b@example.co.jp', label: '○○商事' },
  ]);
});

test('探す向きは from / to / both のみ。それ以外は from に倒す', () => {
  assert.strictEqual(q.normalizeMatch('to'), 'to');
  assert.strictEqual(q.normalizeMatch('both'), 'both');
  for (const bad of ['FROM', 'あ', null, undefined, 1]) {
    assert.strictEqual(q.normalizeMatch(bad), 'from');
  }
});

test('日数は1〜365。おかしな値は既定の14日に倒す', () => {
  assert.strictEqual(q.normalizeDays(30), 30);
  assert.strictEqual(q.normalizeDays(0), q.DEFAULT_DAYS);
  assert.strictEqual(q.normalizeDays(-5), q.DEFAULT_DAYS);
  assert.strictEqual(q.normalizeDays('あ'), q.DEFAULT_DAYS);
  assert.strictEqual(q.normalizeDays(9999), q.MAX_DAYS);
});

test('探し始める日は「N日前の0時」。IMAPのSINCEが日付単位のため', () => {
  const now = new Date('2026-09-07T18:30:00+09:00');
  const d = q.sinceDate(3, now);
  assert.strictEqual(d.getHours(), 0);
  assert.strictEqual(d.getMinutes(), 0);
  const diffDays = Math.round((now - d) / 86400000);
  assert.ok(diffDays === 3 || diffDays === 4, `3日前あたりのはず: ${diffDays}`);
});

test('IMAPの条件は、アドレス×向きの本数だけ作る', () => {
  const now = new Date('2026-09-07T00:00:00Z');
  const watch = [{ address: 'a@x.com' }, { address: 'b@y.com' }];

  const one = q.buildImapSearches({ watch, match: 'from', days: 7, unreadOnly: true, now });
  assert.strictEqual(one.length, 2);
  assert.strictEqual(one[0].from, 'a@x.com');
  assert.strictEqual(one[0].seen, false, '未読だけのときは seen:false を付ける');
  assert.ok(one[0].since instanceof Date);

  const both = q.buildImapSearches({ watch, match: 'both', days: 7, now });
  assert.strictEqual(both.length, 4, 'from と to を別々に投げる');
  assert.deepStrictEqual(both.map((c) => Object.keys(c).sort()), [
    ['from', 'since'], ['since', 'to'], ['from', 'since'], ['since', 'to'],
  ]);
  assert.ok(!('seen' in both[0]), '未読だけでなければ seen は付けない');

  assert.deepStrictEqual(q.buildImapSearches({ watch: [], match: 'from' }), []);
});

test('当たり判定は向きに従う', () => {
  const watch = [{ address: 'aite@example.com' }];
  const fromAite = { from: '相手 <Aite@example.com>', to: 'me@mine.com', subject: 'x' };
  const toAite = { from: 'me@mine.com', to: 'AITE@example.com', subject: 'x' };
  const ccAite = { from: 'me@mine.com', to: 'other@x.com', cc: 'aite@example.com' };
  const other = { from: 'zzz@example.com', to: 'me@mine.com' };

  assert.strictEqual(q.matchesWatch(fromAite, { watch, match: 'from' }), true);
  assert.strictEqual(q.matchesWatch(toAite, { watch, match: 'from' }), false);
  assert.strictEqual(q.matchesWatch(toAite, { watch, match: 'to' }), true);
  assert.strictEqual(q.matchesWatch(ccAite, { watch, match: 'to' }), true, 'CCも宛先として見る');
  assert.strictEqual(q.matchesWatch(fromAite, { watch, match: 'to' }), false);
  assert.strictEqual(q.matchesWatch(fromAite, { watch, match: 'both' }), true);
  assert.strictEqual(q.matchesWatch(toAite, { watch, match: 'both' }), true);
  assert.strictEqual(q.matchesWatch(other, { watch, match: 'both' }), false);
  assert.strictEqual(q.matchesWatch(fromAite, { watch: [], match: 'both' }), false);
});

test('表示用の形にそろえる。日付が読めなければ null にする', () => {
  const m = q.normalizeMessage({
    messageId: '<abc@mail>',
    receivedAt: '2026-09-01T10:00:00Z',
    from: '山田 <Yamada@Example.com>',
    fromName: ' 山田 ',
    to: 'A@x.com, b@y.com',
    subject: '  ご確認のお願い ',
    unread: 1,
  }, 'gmail');
  assert.strictEqual(m.from, 'yamada@example.com');
  assert.strictEqual(m.fromName, '山田');
  assert.strictEqual(m.to, 'a@x.com, b@y.com');
  assert.strictEqual(m.subject, 'ご確認のお願い');
  assert.strictEqual(m.unread, true);
  assert.strictEqual(m.provider, 'gmail');
  assert.strictEqual(m.receivedAt, '2026-09-01T10:00:00.000Z');

  assert.strictEqual(q.normalizeMessage({ receivedAt: 'あ' }).receivedAt, null);
  assert.strictEqual(q.normalizeMessage(null).subject, '');
  assert.strictEqual(q.normalizeMessage({}, 'outlook').provider, 'outlook');
});

test('新しい順に並べ、日付が読めないものは末尾に置く', () => {
  const sorted = q.sortMessages([
    { subject: '古', receivedAt: '2026-09-01T00:00:00Z' },
    { subject: '不明', receivedAt: null },
    { subject: '新', receivedAt: '2026-09-05T00:00:00Z' },
  ]);
  assert.deepStrictEqual(sorted.map((m) => m.subject), ['新', '古', '不明']);
});

test('同じメールが複数の条件で拾われても1通にまとめる', () => {
  const list = [
    { messageId: '<a>', subject: '1' },
    { messageId: '<a>', subject: '1のコピー' },
    { entryId: 'E1', subject: '2' },
    { messageId: '', entryId: '', id: '', subject: '手がかり無し' },
  ];
  const out = q.dedupe(list);
  assert.deepStrictEqual(out.map((m) => m.subject), ['1', '2', '手がかり無し']);
});

test('GmailのURLはMessage-IDでそのメールを開く', () => {
  assert.strictEqual(
    q.gmailSearchUrl('<abc123@mail.example.com>'),
    'https://mail.google.com/mail/u/0/#search/rfc822msgid:abc123%40mail.example.com'
  );
  assert.strictEqual(q.gmailSearchUrl(''), 'https://mail.google.com/');
});
