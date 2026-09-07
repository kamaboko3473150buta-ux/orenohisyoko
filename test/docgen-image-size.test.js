// test/docgen-image-size.test.js
// 画像の縦横をファイルの中身から読む。決め打ちの大きさで差し込むと、
// 縦長のスクリーンショットが横に潰れるため。
const test = require('node:test');
const assert = require('node:assert');
const { pngSize, jpegSize, imageSize, fitWidth } = require('../src/main/docgen/image-size');

// 幅×高さだけを持つ最小のPNGヘッダを作る
function fakePng(w, h) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf, 0);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

// SOF0 だけを持つ最小のJPEG。前に長さ付きの別マーカー（APP0）を挟んで読み飛ばしも見る
function fakeJpeg(w, h) {
  const app0 = Buffer.concat([Buffer.from([0xFF, 0xE0]), Buffer.alloc(2), Buffer.alloc(14)]);
  app0.writeUInt16BE(16, 2);
  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xFF, 0); sof.writeUInt8(0xC0, 1);
  sof.writeUInt16BE(8, 2);   // 長さ
  sof.writeUInt8(8, 4);      // 精度
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), app0, sof]);
}

test('PNGの大きさを読む', () => {
  assert.deepStrictEqual(pngSize(fakePng(1920, 1080)), { width: 1920, height: 1080 });
  assert.strictEqual(pngSize(Buffer.from('これはPNGではない')), null);
  assert.strictEqual(pngSize(null), null);
  assert.strictEqual(pngSize(Buffer.alloc(5)), null, '短すぎるファイルでも落ちない');
});

test('JPEGの大きさを読む（途中のマーカーは読み飛ばす）', () => {
  assert.deepStrictEqual(jpegSize(fakeJpeg(800, 600)), { width: 800, height: 600 });
  assert.strictEqual(jpegSize(Buffer.from([0xFF, 0xD8])), null, 'SOFが無ければ読めない');
  assert.strictEqual(jpegSize(Buffer.from('ただの文字')), null);
});

test('どちらでもない形式は null（差し込まない判断に使う）', () => {
  assert.strictEqual(imageSize(Buffer.from('GIF89a')), null);
  assert.deepStrictEqual(imageSize(fakePng(10, 20)), { width: 10, height: 20 });
  assert.deepStrictEqual(imageSize(fakeJpeg(30, 40)), { width: 30, height: 40 });
});

test('指定した幅に収める。もとが小さければ拡大しない', () => {
  assert.deepStrictEqual(fitWidth({ width: 1000, height: 500 }, 500), { width: 500, height: 250 });
  assert.deepStrictEqual(fitWidth({ width: 300, height: 900 }, 500), { width: 300, height: 900 },
    '小さい画像を引き伸ばさない');
  assert.deepStrictEqual(fitWidth({ width: 1000, height: 3000 }, 500), { width: 500, height: 1500 },
    '縦長でも比率を保つ');
  assert.strictEqual(fitWidth(null, 500), null);
  assert.strictEqual(fitWidth({ width: 0, height: 10 }, 500), null);
});

// ---- 見出しに添える画像（本文の編集画面で利用者が選ぶ） ----

const { parseBodyJson } = require('../src/main/docgen/prompt');

test('見出しの画像は path のあるものだけを残す', () => {
  const raw = JSON.stringify({
    title: 'T',
    sections: [{
      heading: '手順',
      images: [
        { path: 'C:/a.png', name: 'a.png', caption: '① ログイン画面' },
        { path: '', name: '空' },
        { name: 'pathが無い' },
        'おかしな値',
        null,
      ],
    }],
  });
  const { doc } = parseBodyJson(raw);
  assert.deepStrictEqual(doc.sections[0].images, [
    { path: 'C:/a.png', name: 'a.png', caption: '① ログイン画面' },
  ]);
});

test('画像が無いときは空配列（既存の資料を壊さない）', () => {
  const { doc } = parseBodyJson(JSON.stringify({ title: 'T', sections: [{ heading: 'h', paragraphs: ['p'] }] }));
  assert.deepStrictEqual(doc.sections[0].images, []);
});
