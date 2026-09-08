// test/weather-place.test.js
// 設定に入れた地名を、天気の引ける名前に読み替える。
//
// Open-Meteo の地名検索は市区町村しか持っておらず、「愛媛県」では1件も返ってこない（実測）。
// 都道府県名を入れた人にも天気が出るようにする、そのための読み替え。
const test = require('node:test');
const assert = require('node:assert');
const place = require('../src/main/weather/place');

test('都道府県名は県庁所在地に読み替える', () => {
  assert.deepStrictEqual(place.candidates('愛媛県')[1], '松山市');
  assert.strictEqual(place.representativeCity('愛媛県'), '松山市');
  assert.strictEqual(place.representativeCity('大阪府'), '大阪市');
  assert.strictEqual(place.representativeCity('北海道'), '札幌市');
});

test('県を省いた書き方でも読み替える', () => {
  assert.strictEqual(place.representativeCity('愛媛'), '松山市');
  assert.strictEqual(place.representativeCity('神奈川'), '横浜市');
});

test('47都道府県すべてに読み替え先がある', () => {
  const names = Object.keys(place.PREFECTURE_CITY);
  assert.strictEqual(names.length, 47);
  for (const n of names) {
    assert.ok(place.representativeCity(n), `${n} の読み替え先が無い`);
  }
});

test('本人の書いた形をいちばん先に試す', () => {
  assert.strictEqual(place.candidates('松山市')[0], '松山市');
  assert.strictEqual(place.candidates('愛媛県')[0], '愛媛県');
});

test('市区町村はそのまま試し、見つからないとき用に接尾辞も落とす', () => {
  const c = place.candidates('松山市');
  assert.ok(c.includes('松山'), '「松山市」で駄目なら「松山」も試す');
});

test('空や未設定では候補を作らない（引きに行かない）', () => {
  assert.deepStrictEqual(place.candidates(''), []);
  assert.deepStrictEqual(place.candidates(null), []);
  assert.deepStrictEqual(place.candidates('   '), []);
});

test('候補は増やしすぎない（1件ごとに通信するため）', () => {
  for (const n of ['愛媛県', '東京都', '松山市', 'よく分からない場所']) {
    assert.ok(place.candidates(n).length <= place.MAX_CANDIDATES);
  }
});

test('同じ名前を二度試さない', () => {
  const c = place.candidates('東京都');
  assert.strictEqual(new Set(c).size, c.length);
});

test('区切って書かれたときは、後ろの細かい地名から試す', () => {
  // 「愛媛県/今治市」なら今治市の天気を出したいはず。県より市のほうが本人に近い。
  assert.strictEqual(place.candidates('愛媛県/今治市')[0], '今治市');
  assert.strictEqual(place.candidates('愛媛県 今治市')[0], '今治市');
  assert.strictEqual(place.candidates('愛媛県、今治市')[0], '今治市');
  assert.strictEqual(place.candidates('大阪府 堺市')[0], '堺市');

  // それでも駄目だったとき用に、県のぶんも候補に残す
  assert.ok(place.candidates('愛媛県/今治市').includes('松山市'));
});

test('区切りだけの入力では候補を作らない', () => {
  assert.deepStrictEqual(place.candidates('/ 、'), []);
  assert.deepStrictEqual(place.parts('愛媛県/今治市'), ['愛媛県', '今治市']);
});
