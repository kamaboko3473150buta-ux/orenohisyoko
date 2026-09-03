const test = require('node:test');
const assert = require('node:assert');
const { SCENES, TONES, findScene, findTone } = require('../src/main/mail-compose/scenes');

test('場面は10種あり、すべてid・label・guideを持つ', () => {
  assert.strictEqual(SCENES.length, 10);
  for (const s of SCENES) {
    assert.ok(s.id, 'idがある');
    assert.ok(s.label, 'labelがある');
    assert.ok(s.guide, 'guideがある');
  }
});

test('文体は4種あり、既定はformal_external', () => {
  assert.strictEqual(TONES.length, 4);
  assert.strictEqual(TONES[0].id, 'formal_external');
});

test('findSceneは該当するものを返し、無ければotherを返す', () => {
  assert.strictEqual(findScene('thanks').label, '御礼');
  assert.strictEqual(findScene('存在しないID').id, 'other');
});

test('findToneは該当するものを返し、無ければ既定を返す', () => {
  assert.strictEqual(findTone('internal').label, '社内向け・簡潔に');
  assert.strictEqual(findTone('存在しないID').id, 'formal_external');
});
