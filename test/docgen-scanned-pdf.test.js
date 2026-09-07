// test/docgen-scanned-pdf.test.js
// 文字が入っていないPDF（スキャンPDF）の扱い。
// これまでは抽出できた文字（＝ほぼ空）だけを送っていたため、添付したのに中身が
// まったく反映されない状態だった。黙って無視されないことを確かめる。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { looksScanned, MIN_CHARS_PER_PAGE } = require('../src/main/docgen/readers');
const sp = require('../src/main/docgen/scanned-pdf');
const { withDocuments } = require('../src/main/claude');

test('文字が入っているPDFはスキャン扱いしない', () => {
  assert.strictEqual(looksScanned('あ'.repeat(MIN_CHARS_PER_PAGE * 3), 3), false);
  assert.strictEqual(looksScanned('本文がしっかり入っています。'.repeat(20), 1), false);
});

test('文字がほとんど無いPDFはスキャン扱いにする', () => {
  assert.strictEqual(looksScanned('', 5), true);
  assert.strictEqual(looksScanned('   \n\t  ', 3), true, '空白や改行だけは「無い」とみなす');
  assert.strictEqual(looksScanned('1', 10), true, 'ページ番号だけ拾えた状態');
});

test('ページ数が分からなくても1ページとして判断する', () => {
  assert.strictEqual(looksScanned('', 0), true);
  assert.strictEqual(looksScanned('あ'.repeat(100), null), false);
});

function makeTempPdf(bytes) {
  const p = path.join(os.tmpdir(), `hishoko-test-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
}

test('APIに添える形にする', async () => {
  const p = makeTempPdf(64);
  try {
    const d = await sp.toDocument({ name: 'スキャン.pdf', path: p, pdfPages: 3 });
    assert.strictEqual(d.ok, true);
    assert.strictEqual(d.pages, 3);
    assert.ok(d.base64.length > 0);
  } finally { fs.unlinkSync(p); }
});

test('送れないときは必ず理由を返す（黙って落とさない）', async () => {
  const noPath = await sp.toDocument({ name: 'a.pdf', path: '' });
  assert.strictEqual(noPath.ok, false);
  assert.ok(noPath.message);

  const missing = await sp.toDocument({ name: 'b.pdf', path: path.join(os.tmpdir(), 'no-such-file.pdf') });
  assert.strictEqual(missing.ok, false);

  const tooMany = await sp.toDocument({ name: 'c.pdf', path: 'x', pdfPages: sp.MAX_PAGES + 1 });
  assert.strictEqual(tooMany.ok, false);
  assert.ok(tooMany.message.includes(String(sp.MAX_PAGES)));
});

test('件数の上限を超えた分も、理由として残す', async () => {
  const paths = [];
  try {
    const entries = [];
    for (let i = 0; i < sp.MAX_FILES + 2; i += 1) {
      const p = makeTempPdf(32);
      paths.push(p);
      entries.push({ name: `s${i}.pdf`, path: p, pdfPages: 2, scanned: true });
    }
    const r = await sp.collect(entries);
    assert.strictEqual(r.documents.length, sp.MAX_FILES);
    assert.strictEqual(r.skipped.length, 2);
    assert.ok(r.skipped[0].message.includes(String(sp.MAX_FILES)));
    assert.strictEqual(r.pages, sp.MAX_FILES * 2, '送った分のページ数だけを数える');
  } finally { paths.forEach((p) => fs.unlinkSync(p)); }
});

test('スキャンでないものは対象にしない', async () => {
  const r = await sp.collect([{ name: 'a.pdf', path: 'x', scanned: false }, null, 'あ']);
  assert.deepStrictEqual(r.documents, []);
  assert.deepStrictEqual(r.skipped, []);
});

test('ページ数から費用の目安トークンを出す', () => {
  assert.strictEqual(sp.tokensForPages(3), 3 * sp.TOKENS_PER_PAGE);
  assert.strictEqual(sp.tokensForPages(0), 0);
  assert.strictEqual(sp.tokensForPages('あ'), 0);
});

test('PDFは本文より前に置き、無ければ今までどおり文字列のまま送る', () => {
  assert.strictEqual(withDocuments('本文', []), '本文', 'PDFが無ければ形を変えない');
  assert.strictEqual(withDocuments('本文', undefined), '本文');

  const withOne = withDocuments('本文', [{ name: 'a.pdf', base64: 'AAA' }]);
  assert.ok(Array.isArray(withOne));
  assert.strictEqual(withOne[0].type, 'document');
  assert.strictEqual(withOne[0].source.media_type, 'application/pdf');
  assert.strictEqual(withOne[1].type, 'text');
  assert.strictEqual(withOne[1].text, '本文');

  // キャッシュ用に配列になっている content でも、前に足せること
  const cached = [{ type: 'text', text: '資料', cache_control: { type: 'ephemeral' } }, { type: 'text', text: '指示' }];
  const merged = withDocuments(cached, [{ name: 'a.pdf', base64: 'AAA' }]);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0].type, 'document');
  assert.deepStrictEqual(merged[1], cached[0], 'キャッシュ指定を壊さない');
});
