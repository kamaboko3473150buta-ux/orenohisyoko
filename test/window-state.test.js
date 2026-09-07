// test/window-state.test.js
// ウィンドウの形の覚え方。画面より大きい形で作ると、実機でウィンドウが
// はみ出したり詰められたりして中身が入らなくなる（息抜きの卓が切れた実例あり）。
const test = require('node:test');
const assert = require('node:assert');
const { resolveBounds, boundsToSave, MIN_SIZE } = require('../src/main/window-state');

const SMALL = { x: 0, y: 0, width: 1280, height: 672 };   // 1280x720 の画面
const BIG = { x: 0, y: 0, width: 2560, height: 1400 };

test('保存が無ければ既定の大きさ。ただし画面に収まるまで詰める', () => {
  assert.deepStrictEqual(resolveBounds(null, BIG), { width: 1140, height: 880 });
  const small = resolveBounds(null, SMALL);
  assert.strictEqual(small.width, 1140);
  assert.strictEqual(small.height, 652, '画面が低ければ既定880ではなく作業領域に合わせる');
  assert.ok(small.height <= SMALL.height, '画面からはみ出さない');
});

test('前に閉じたときの形をそのまま使う', () => {
  assert.deepStrictEqual(
    resolveBounds({ width: 1140, height: 652, x: 70, y: 10 }, SMALL),
    { width: 1140, height: 652, x: 70, y: 10 }
  );
});

test('画面より大きい形が残っていても、画面に収める', () => {
  const b = resolveBounds({ width: 3000, height: 2000, x: 0, y: 0 }, SMALL);
  assert.ok(b.width <= SMALL.width && b.height <= SMALL.height);
});

test('小さすぎる形は下限まで戻す（操作できなくなるため）', () => {
  const b = resolveBounds({ width: 200, height: 100 }, SMALL);
  assert.strictEqual(b.width, MIN_SIZE.width);
  assert.strictEqual(b.height, MIN_SIZE.height);
});

test('画面の外の位置は捨てる（別のモニタで保存した値の持ち越し）', () => {
  const b = resolveBounds({ width: 1140, height: 652, x: 2400, y: 10 }, SMALL);
  assert.strictEqual(b.x, undefined, '位置を渡さなければ中央に置かれる');
  assert.strictEqual(b.y, undefined);
});

test('壊れた値でも既定に戻すだけで、例外は投げない', () => {
  for (const bad of [undefined, null, {}, { width: 'あ', height: NaN }, { width: Infinity }]) {
    const b = resolveBounds(bad, SMALL);
    assert.ok(b.width >= MIN_SIZE.width && b.height >= MIN_SIZE.height);
  }
  assert.deepStrictEqual(resolveBounds(null, null).width, 1140);
});

test('保存する値は整数にそろえる。大きさが取れなければ保存しない', () => {
  assert.deepStrictEqual(
    boundsToSave({ width: 1140.6, height: 652.2, x: 70.9, y: 10.1 }),
    { width: 1141, height: 652, x: 71, y: 10 }
  );
  assert.strictEqual(boundsToSave(null), null);
  assert.strictEqual(boundsToSave({ width: 0, height: 0 }), null);
});
