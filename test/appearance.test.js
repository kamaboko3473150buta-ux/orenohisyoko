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
  for (const c of a.HAIR_COLORS) {
    assert.match(c.id, /^[a-z0-9-]+$/);
  }
});

test('保存された値は一覧にあるものだけに直す', () => {
  assert.deepStrictEqual(
    a.normalizeAppearance({ hairStyle: 'straight-long', hairColor: 'brown' }),
    { hairStyle: 'straight-long', hairColor: 'brown' },
  );
  // 知らない値・壊れた値は既定に倒す（画像の無いフォルダを見に行かせない）
  assert.deepStrictEqual(a.normalizeAppearance({ hairStyle: 'no-such' }), { hairStyle: 'bob', hairColor: 'brown' });
  assert.deepStrictEqual(a.normalizeAppearance(null), { hairStyle: 'bob', hairColor: 'brown' });
  assert.deepStrictEqual(a.normalizeAppearance('こわれた'), { hairStyle: 'bob', hairColor: 'brown' });
});

test('既定の髪色なら、フォルダ名は髪型だけ', () => {
  // 今ある assets/hishoko/bob と straight-long がこの形。
  assert.strictEqual(a.folderFor({ hairStyle: 'bob', hairColor: 'brown' }), 'bob');
  assert.strictEqual(a.folderFor({ hairStyle: 'straight-long', hairColor: 'brown' }), 'straight-long');
  assert.strictEqual(a.folderFor({}), 'bob');
});

test('選べる見た目のフォルダに、実際に画像が入っている', () => {
  // 画像を入れ忘れたまま選択肢だけ増やすと、既定に落ちて「変わらない」ように見える。
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', 'assets');
  for (const style of a.HAIR_STYLES) {
    const folder = a.folderFor({ hairStyle: style.id, hairColor: a.DEFAULT_COLOR });
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
