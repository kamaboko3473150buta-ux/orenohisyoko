// test/weather.test.js
// 今日の天気。AIは使わず、APIの値をそのまま日本語にするだけ。
const test = require('node:test');
const assert = require('node:assert');
const f = require('../src/main/weather/format');

test('WMOの天気コードを日本語にする', () => {
  assert.strictEqual(f.weatherLabel(0), '快晴');
  assert.strictEqual(f.weatherLabel(3), '曇り');
  assert.strictEqual(f.weatherLabel(63), '雨');
  assert.strictEqual(f.weatherLabel(95), '雷雨');
  assert.strictEqual(f.weatherLabel(999), '', '知らない番号は空にする（嘘を書かない）');
  assert.strictEqual(f.weatherLabel(null), '');
});

test('日付は曜日つき。月日は0埋めしない', () => {
  assert.strictEqual(f.formatDate(new Date(2026, 8, 8)), '2026/9/8（火）');
  assert.strictEqual(f.formatDate(new Date(2026, 0, 1)), '2026/1/1（木）');
  assert.ok(f.formatDate(new Date('あ')).includes('/'), '壊れた日付でも落ちない');
});

// 1時間ごとのコードを作る（0時から23時まで）
function hourly(map) {
  const times = [];
  const codes = [];
  for (let h = 0; h < 24; h += 1) {
    times.push(`2026-09-08T${String(h).padStart(2, '0')}:00`);
    codes.push(map(h));
  }
  return { times, codes };
}

test('午前と午後で変われば「のち」でつなぐ', () => {
  const { times, codes } = hourly((h) => (h < 12 ? 3 : 63));
  assert.strictEqual(f.describeDay(codes, times), '曇りのち雨');
});

test('1日じゅう同じなら1つだけ', () => {
  const { times, codes } = hourly(() => 0);
  assert.strictEqual(f.describeDay(codes, times), '快晴');
});

test('片方しか取れなくても、取れたほうを出す', () => {
  const times = ['2026-09-08T14:00'];
  assert.strictEqual(f.describeDay([63], times), '雨');
  assert.strictEqual(f.describeDay([], []), '');
  assert.strictEqual(f.describeDay(null, null), '');
});

test('夜だけのコードは使わない（朝と昼で判断する）', () => {
  const times = ['2026-09-08T23:00'];
  assert.strictEqual(f.describeDay([95], times), '', '23時だけでは1日の天気とは言えない');
});

test('吹き出しの文言は1行。取れたものだけを並べる', () => {
  const full = f.formatSummary({
    date: new Date(2026, 8, 8), place: '松山市', description: '曇りのち雨',
    high: 25.9, low: 24.5, rain: 100,
  });
  assert.strictEqual(full, '曇りのち雨　最高26℃/最低25℃　降水100%');
  assert.ok(!full.includes('\n'), '頭の上の吹き出しは行数が増えると顔にかぶるので、必ず1行');
  // 日付・曜日と地名は入れない。入れると折り返して2行になり、秘書子の顔にかぶる。
  // 日付はマウスを乗せたときの説明に回す（formatDate は別に使う）。
  assert.ok(!full.includes('2026'), '日付は吹き出しに入れない');
  assert.ok(!full.includes('松山'), '地名は吹き出しに入れない');

  const nothing = f.formatSummary({});
  assert.strictEqual(nothing, '', '何も取れなければ空にする（嘘は書かない）');

  const noTemp = f.formatSummary({ description: '晴れ', rain: 10 });
  assert.strictEqual(noTemp, '晴れ　降水10%');
});

test('気温は四捨五入。数値でなければ出さない', () => {
  assert.strictEqual(f.roundTemp(25.4), 25);
  assert.strictEqual(f.roundTemp(25.5), 26);
  assert.strictEqual(f.roundTemp('あ'), null);
  assert.ok(!f.formatSummary({ high: 'あ', low: 'い', description: '晴れ' }).includes('℃'));
});
