const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const {
  Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell,
} = require('docx');
const { splitParagraphs, buildTranslatedParagraph, insertAfter } = require('../src/main/translate/docx-edit');
const { docxTextFromXml } = require('../src/main/docgen/office-text');

// 実機で「保存に失敗しました（ADM-ZIP: Invalid LOC header (bad signature)）」が出た。
// adm-zip の updateFile + writeZipPromise が壊れるためで、元のエントリを展開して
// 新しい zip に詰め直す方式に変えて解消した。同じ壊れ方を繰り返さないよう、
// .docx を作る → 訳文を挿入する → 保存する → 読み返す、を通しで確かめる。

function makeDocx(filePath) {
  const cell = (t) => new TableCell({ children: [new Paragraph({ text: t })] });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: '見出し', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: '本文です。' }),
        new Paragraph({ text: '' }),
        new Table({ rows: [new TableRow({ children: [cell('セルA'), cell('セルB')] })] }),
      ],
    }],
  });
  return Packer.toBuffer(doc).then((buf) => fs.writeFileSync(filePath, buf));
}

test('翻訳した.docxを保存して読み返せる（表の中も原文→訳文の順に並ぶ）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trt-'));
  const src = path.join(dir, 'src.docx');
  const out = path.join(dir, 'out.docx');
  await makeDocx(src);

  const zip = new AdmZip(src);
  const xml = zip.readAsText(zip.getEntry('word/document.xml'));
  const targets = splitParagraphs(xml).filter((p) => p.text && p.text.trim());
  assert.ok(targets.length >= 4, '見出し・本文・表のセルが対象になる');

  const newXml = insertAfter(xml, targets.map((p) => ({
    index: p.index, xml: buildTranslatedParagraph(p.xml, `${p.text} [EN]`),
  })));

  // 保存（本体と同じ、詰め直す方式）
  const outZip = new AdmZip();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    outZip.addFile(entry.entryName, entry.entryName === 'word/document.xml'
      ? Buffer.from(newXml, 'utf8') : entry.getData());
  }
  fs.writeFileSync(out, outZip.toBuffer());

  const check = new AdmZip(out);
  const lines = docxTextFromXml(check.readAsText(check.getEntry('word/document.xml')))
    .split('\n').filter((l) => l.trim());
  assert.deepStrictEqual(lines, [
    '見出し', '見出し [EN]',
    '本文です。', '本文です。 [EN]',
    'セルA', 'セルA [EN]',
    'セルB', 'セルB [EN]',
  ], '原文と訳文が交互に並ぶ');

  fs.rmSync(dir, { recursive: true, force: true });
});
