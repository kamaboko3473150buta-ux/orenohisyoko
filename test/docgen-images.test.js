const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Document, Packer, Paragraph, ImageRun } = require('docx');
const { pickImageEntries, extractImages, IMAGE_EXTENSIONS, MIN_BYTES, MAX_IMAGES } = require('../src/main/docgen/images');

// ---- pickImageEntries（純粋関数） ----

test('pickImageEntries: word/ppt/xlのmediaフォルダの画像だけを選ぶ', () => {
  const names = [
    'word/media/image1.png',
    'word/document.xml',
    'ppt/slides/slide1.xml',
    'ppt/media/image1.jpeg',
    'xl/media/image1.gif',
    'xl/worksheets/sheet1.xml',
    '[Content_Types].xml',
  ];
  const picked = pickImageEntries(names);
  assert.deepStrictEqual(picked.sort(), [
    'ppt/media/image1.jpeg',
    'word/media/image1.png',
    'xl/media/image1.gif',
  ].sort());
  assert.ok(!picked.includes('ppt/slides/slide1.xml'));
  assert.ok(!picked.includes('word/document.xml'));
});

test('pickImageEntries: 番号順に並ぶ（image2がimage10より先、文字列順にならない）', () => {
  const names = [
    'word/media/image10.png',
    'word/media/image2.png',
    'word/media/image1.png',
  ];
  const picked = pickImageEntries(names);
  assert.deepStrictEqual(picked, [
    'word/media/image1.png',
    'word/media/image2.png',
    'word/media/image10.png',
  ]);
});

test('pickImageEntries: 対応拡張子以外（.emf, .wmf, .bmp）は選ばない', () => {
  const names = [
    'word/media/image1.emf',
    'word/media/image2.wmf',
    'word/media/image3.bmp',
    'word/media/image4.png',
  ];
  assert.deepStrictEqual(pickImageEntries(names), ['word/media/image4.png']);
});

test('pickImageEntries: 大文字の拡張子でも選ぶ', () => {
  const names = ['word/media/image1.PNG', 'word/media/image2.JPG'];
  assert.deepStrictEqual(pickImageEntries(names), ['word/media/image1.PNG', 'word/media/image2.JPG']);
});

test('pickImageEntries: 空配列・想定外の入力で落ちない', () => {
  assert.deepStrictEqual(pickImageEntries([]), []);
  assert.deepStrictEqual(pickImageEntries(null), []);
  assert.deepStrictEqual(pickImageEntries(undefined), []);
  assert.deepStrictEqual(pickImageEntries('not-an-array'), []);
  assert.deepStrictEqual(pickImageEntries([1, null, undefined, {}, 'word/media/image1.png']), ['word/media/image1.png']);
});

test('IMAGE_EXTENSIONS / MIN_BYTES / MAX_IMAGES が計画通りの値', () => {
  assert.deepStrictEqual(IMAGE_EXTENSIONS, ['.png', '.jpg', '.jpeg', '.gif']);
  assert.strictEqual(MIN_BYTES, 8000);
  assert.strictEqual(MAX_IMAGES, 20);
});

// ---- extractImages（実際にファイルを作って動作確認） ----

// 1x1のPNG（8000バイト未満なので「小さすぎて捨てられる」側のテストに使う）
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// MIN_BYTES(8000)を超える適当なPNGを作る（正しいPNGヘッダ＋ダミーの大きなデータ列）。
// 実際のPNGとしてデコードできる必要はなく、adm-zipから取り出したバイト列の
// 長さ判定だけをテストしているため、ヘッダだけ本物にして残りは0で埋める。
function makeLargeFakePngBuffer(size) {
  const header = Buffer.from(TINY_PNG_BASE64, 'base64');
  const pad = Buffer.alloc(Math.max(0, size - header.length), 0);
  return Buffer.concat([header, pad]);
}

async function mkTmpDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('extractImages: 画像入りの.docxを実際に作って抽出できる（1枚以上取り出せる）', async () => {
  const workDir = await mkTmpDir('docgen-images-src-');
  const outDir = await mkTmpDir('docgen-images-out-');
  try {
    const bigPng = makeLargeFakePngBuffer(MIN_BYTES + 500);
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: bigPng,
                  transformation: { width: 100, height: 100 },
                  type: 'png',
                }),
              ],
            }),
          ],
        },
      ],
    });
    const buf = await Packer.toBuffer(doc);
    const docxPath = path.join(workDir, '画像入り資料.docx');
    await fs.writeFile(docxPath, buf);

    const images = await extractImages([docxPath], outDir);
    assert.strictEqual(images.length, 1, '1枚取り出せる');
    assert.strictEqual(images[0].id, 'img-1');
    assert.strictEqual(images[0].sourceName, '画像入り資料.docx');
    assert.ok(images[0].bytes >= MIN_BYTES);
    const written = await fs.readFile(images[0].path);
    assert.strictEqual(written.length, images[0].bytes);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('extractImages: 小さすぎる画像は捨てられる', async () => {
  const workDir = await mkTmpDir('docgen-images-src-');
  const outDir = await mkTmpDir('docgen-images-out-');
  try {
    const tinyPng = Buffer.from(TINY_PNG_BASE64, 'base64');
    assert.ok(tinyPng.length < MIN_BYTES, 'このテスト自体の前提: MIN_BYTES未満であること');
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: tinyPng,
                  transformation: { width: 10, height: 10 },
                  type: 'png',
                }),
              ],
            }),
          ],
        },
      ],
    });
    const buf = await Packer.toBuffer(doc);
    const docxPath = path.join(workDir, '小さい画像.docx');
    await fs.writeFile(docxPath, buf);

    const images = await extractImages([docxPath], outDir);
    assert.deepStrictEqual(images, [], '小さすぎる画像は捨てられて0枚になる');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('extractImages: 壊れたファイル・対象外の形式が混ざっても他のファイルは処理される', async () => {
  const workDir = await mkTmpDir('docgen-images-src-');
  const outDir = await mkTmpDir('docgen-images-out-');
  try {
    const bigPng = makeLargeFakePngBuffer(MIN_BYTES + 500);
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new ImageRun({ data: bigPng, transformation: { width: 100, height: 100 }, type: 'png' }),
              ],
            }),
          ],
        },
      ],
    });
    const buf = await Packer.toBuffer(doc);
    const goodPath = path.join(workDir, '正常.docx');
    await fs.writeFile(goodPath, buf);

    const brokenZipPath = path.join(workDir, '壊れた資料.docx');
    await fs.writeFile(brokenZipPath, Buffer.from('これはzipではない普通のテキストです'));

    const notOfficePath = path.join(workDir, 'メモ.txt');
    await fs.writeFile(notOfficePath, 'テキストファイル');

    const missingPath = path.join(workDir, '存在しない.docx');

    const images = await extractImages([brokenZipPath, notOfficePath, missingPath, goodPath], outDir);
    assert.strictEqual(images.length, 1, '壊れた/対象外/存在しないファイルはスキップされ、正常な1件だけ処理される');
    assert.strictEqual(images[0].sourceName, '正常.docx');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('extractImages: 空配列・想定外の入力で例外を投げない', async () => {
  const outDir = await mkTmpDir('docgen-images-out-');
  try {
    await assert.doesNotReject(() => extractImages([], outDir));
    await assert.doesNotReject(() => extractImages(null, outDir));
    await assert.doesNotReject(() => extractImages(undefined, outDir));
    assert.deepStrictEqual(await extractImages([], outDir), []);
    assert.deepStrictEqual(await extractImages(null, outDir), []);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
