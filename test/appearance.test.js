// test/appearance.test.js
// 秘書子の見た目（髪型・髪色）と、画像の置き場所の決まり。
//
// 見た目を1つ足すには12枚の絵が要る。手作業で作るものなので、
// そろっていない見た目でも壊れないことが大事。
const test = require('node:test');
const assert = require('node:assert');
const a = require('../src/main/appearance');

test('丸枠の表情は7種そろっている', () => {
  assert.strictEqual(a.EXPRESSIONS.length, 7);
  for (const key of ['normal', 'smile', 'thinking', 'trouble', 'hurry', 'praise', 'sulk']) {
    assert.ok(a.EXPRESSIONS.includes(key), `${key} が無い`);
  }
});

test('髪型のidはASCII（フォルダ名になるため）', () => {
  for (const s of a.HAIR_STYLES) {
    assert.match(s.id, /^[a-z0-9-]+$/, `${s.label} のidがフォルダ名に使えない`);
    assert.ok(s.label, 'ラベルが無い');
  }
  // 色はフォルダ名にならないので、idの決まりは無い（「そのまま」は空）
});

test('保存された髪型は一覧にあるものだけに直す', () => {
  assert.strictEqual(a.normalizeAppearance({ hairStyle: 'straight-long' }).hairStyle, 'straight-long');
  // 知らない値・壊れた値は既定に倒す（画像の無いフォルダを見に行かせない）
  assert.strictEqual(a.normalizeAppearance({ hairStyle: 'no-such' }).hairStyle, 'bob');
  assert.strictEqual(a.normalizeAppearance(null).hairStyle, 'bob');
  assert.strictEqual(a.normalizeAppearance('こわれた').hairStyle, 'bob');
});

test('フォルダは髪型だけで決まる（色で分けない）', () => {
  // 色は絵を分けず、描くときにマスクの範囲だけ色相をずらす。
  // だから色を増やしてもフォルダも画像も増えない。
  assert.strictEqual(a.folderFor({ hairStyle: 'bob' }), 'bob');
  assert.strictEqual(a.folderFor({ hairStyle: 'straight-long', hairColor: '#c96b93' }), 'straight-long');
  assert.strictEqual(a.folderFor({}), 'bob');
});

test('色は #rrggbb だけを受け付け、それ以外は「そのまま」にする', () => {
  const ok = a.normalizeAppearance({ hairColor: '#C96B93', skinColor: '#c98a5e' });
  assert.strictEqual(ok.hairColor, '#c96b93', '大文字は小文字にそろえる');
  assert.strictEqual(ok.skinColor, '#c98a5e');
  for (const bad of ['red', '#abc', 'c96b93', '', null, 123, {}]) {
    assert.strictEqual(a.normalizeAppearance({ hairColor: bad }).hairColor, '', String(bad));
  }
});

test('見本の色はすべて #rrggbb か空', () => {
  for (const c of a.HAIR_COLORS.concat(a.SKIN_COLORS)) {
    assert.ok(c.hex === '' || /^#[0-9a-f]{6}$/.test(c.hex), `${c.label} の色がおかしい`);
    assert.ok(c.label, 'ラベルが無い');
  }
});

test('選べる見た目のフォルダに、実際に画像が入っている', () => {
  // 画像を入れ忘れたまま選択肢だけ増やすと、既定に落ちて「変わらない」ように見える。
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', 'assets');
  for (const style of a.HAIR_STYLES) {
    const folder = a.folderFor({ hairStyle: style.id });
    const faces = fs.readdirSync(path.join(root, 'hishoko', folder));
    for (const key of a.EXPRESSIONS) {
      assert.ok(faces.some((f) => f.startsWith(`${key}.`)), `${style.label}: 丸枠の ${key} が無い`);
    }
    for (const f of ['day.jpg', 'night.jpg']) {
      assert.ok(fs.existsSync(path.join(root, 'office', folder, f)), `${style.label}: ${f} が無い`);
    }
    for (const f of ['scene-idle.jpg', 'scene-joy.jpg', 'scene-sulk.jpg']) {
      assert.ok(fs.existsSync(path.join(root, 'games', folder, f)), `${style.label}: ${f} が無い`);
    }
  }
});
