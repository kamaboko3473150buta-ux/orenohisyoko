const test = require('node:test');
const assert = require('node:assert');
const {
  splitParagraphs, buildTranslatedParagraph, insertAfter,
} = require('../src/main/translate/docx-edit');

// ---- splitParagraphs ----

test('splitParagraphsが段落を順番に取り出し、textはw:tの中身を連結したもの', () => {
  const xml = ''
    + '<w:p><w:r><w:t>こんにちは</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>世界</w:t></w:r><w:r><w:t>です</w:t></w:r></w:p>';
  const paras = splitParagraphs(xml);
  assert.strictEqual(paras.length, 2);
  assert.strictEqual(paras[0].index, 0);
  assert.strictEqual(paras[0].text, 'こんにちは');
  assert.strictEqual(paras[1].index, 1);
  assert.strictEqual(paras[1].text, '世界です');
});

test('splitParagraphsは自己終了タグ<w:p/>でも落ちず、textは空文字になる', () => {
  const xml = '<w:p><w:r><w:t>本文</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>続き</w:t></w:r></w:p>';
  const paras = splitParagraphs(xml);
  assert.strictEqual(paras.length, 3);
  assert.strictEqual(paras[1].text, '');
  assert.strictEqual(paras[1].index, 1);
  assert.strictEqual(paras[2].text, '続き');
  assert.strictEqual(paras[2].index, 2);
});

test('splitParagraphsは図だけの段落（w:tが無い）もtext空文字で拾う', () => {
  const xml = '<w:p><w:r><w:drawing><wp:inline></wp:inline></w:drawing></w:r></w:p>';
  const paras = splitParagraphs(xml);
  assert.strictEqual(paras.length, 1);
  assert.strictEqual(paras[0].text, '');
});

test('splitParagraphsは表のセル内の段落も特別扱いせず拾う', () => {
  const xml = ''
    + '<w:p><w:r><w:t>表の前</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>セルA</w:t></w:r></w:p></w:tc>'
    + '<w:tc><w:p><w:r><w:t>セルB</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>表の後</w:t></w:r></w:p>';
  const paras = splitParagraphs(xml);
  assert.strictEqual(paras.length, 4);
  assert.deepStrictEqual(paras.map((p) => p.text), ['表の前', 'セルA', 'セルB', '表の後']);
});

test('splitParagraphsは壊れたXML（閉じタグ無し）でも例外を投げない', () => {
  assert.doesNotThrow(() => splitParagraphs('<w:p><w:r><w:t>閉じてない'));
  assert.doesNotThrow(() => splitParagraphs(null));
  assert.doesNotThrow(() => splitParagraphs(undefined));
  assert.deepStrictEqual(splitParagraphs(null), []);
});

test('splitParagraphsは実体参照をデコードする', () => {
  const xml = '<w:p><w:r><w:t>A&amp;B &lt;tag&gt;</w:t></w:r></w:p>';
  const paras = splitParagraphs(xml);
  assert.strictEqual(paras[0].text, 'A&B <tag>');
});

// ---- buildTranslatedParagraph ----

test('buildTranslatedParagraphは段落スタイル(pPr)を引き継ぐ', () => {
  const original = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
    + '<w:r><w:rPr><w:b/></w:rPr><w:t>見出し</w:t></w:r></w:p>';
  const result = buildTranslatedParagraph(original, 'Heading (EN)');
  assert.ok(result.includes('<w:pStyle w:val="Heading1"/>'), 'pPrが引き継がれる');
  assert.ok(result.includes('Heading (EN)'), '訳文が入る');
});

test('buildTranslatedParagraphは箇条書きの段落プロパティ(numPr)も引き継ぐ', () => {
  const original = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>'
    + '<w:r><w:t>箇条書き項目</w:t></w:r></w:p>';
  const result = buildTranslatedParagraph(original, 'Bullet item (EN)');
  assert.ok(result.includes('<w:numId w:val="3"/>'), '箇条書きのnumPrが引き継がれる');
});

test('buildTranslatedParagraphは文字色をグレー(666666)にする', () => {
  const original = '<w:p><w:r><w:t>本文</w:t></w:r></w:p>';
  const result = buildTranslatedParagraph(original, 'Body (EN)');
  assert.ok(/<w:color w:val="666666"\/>/.test(result), '色がグレーになる');
});

test('buildTranslatedParagraphは最初のw:rだけ残し、複数の実行(run)を1つにまとめる', () => {
  const original = '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>あ</w:t></w:r>'
    + '<w:r><w:t>い</w:t></w:r><w:r><w:t>う</w:t></w:r></w:p>';
  const result = buildTranslatedParagraph(original, 'ABC');
  const runCount = (result.match(/<w:r>/g) || []).length;
  assert.strictEqual(runCount, 1, '結果のw:rは1個だけ');
  assert.ok(result.includes('<w:i/>'), '最初のrunのrPr（斜体）は引き継がれる');
  assert.ok(result.includes('ABC'));
  assert.ok(!result.includes('あ') && !result.includes('い') && !result.includes('う'), '元の文字は残らない');
});

test('buildTranslatedParagraphは既存のw:colorを上書きする（重複させない）', () => {
  const original = '<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>赤字</w:t></w:r></w:p>';
  const result = buildTranslatedParagraph(original, '赤字(EN)');
  const colorCount = (result.match(/<w:color /g) || []).length;
  assert.strictEqual(colorCount, 1, 'w:colorは1個だけ');
  assert.ok(result.includes('666666'));
  assert.ok(!result.includes('FF0000'));
});

test('buildTranslatedParagraphは訳文中のXML特殊文字をエスケープする', () => {
  const original = '<w:p><w:r><w:t>本文</w:t></w:r></w:p>';
  const result = buildTranslatedParagraph(original, 'A & B < C > D');
  assert.ok(result.includes('A &amp; B &lt; C &gt; D'));
});

test('buildTranslatedParagraphは実行(run)が無い段落でも例外を投げない', () => {
  const original = '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr></w:p>';
  assert.doesNotThrow(() => buildTranslatedParagraph(original, '見出しだけ(EN)'));
  const result = buildTranslatedParagraph(original, '見出しだけ(EN)');
  assert.ok(result.includes('見出しだけ(EN)'));
  assert.ok(result.includes('Heading2'));
});

// ---- insertAfter ----

test('insertAfterが指定した段落の直後にXMLを差し込む', () => {
  const xml = '<w:p><w:r><w:t>1段落目</w:t></w:r></w:p><w:p><w:r><w:t>2段落目</w:t></w:r></w:p>';
  const result = insertAfter(xml, [{ index: 0, xml: '<w:p><w:r><w:t>訳1</w:t></w:r></w:p>' }]);
  const order = [...result.matchAll(/<w:t>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ['1段落目', '訳1', '2段落目']);
});

test('insertAfterは空のinsertionsで元のままを返す', () => {
  const xml = '<w:p><w:r><w:t>そのまま</w:t></w:r></w:p>';
  assert.strictEqual(insertAfter(xml, []), xml);
  assert.strictEqual(insertAfter(xml, undefined), xml);
});

test('insertAfterは複数の挿入を正しい順序・位置で行う', () => {
  const xml = '<w:p><w:r><w:t>A</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>B</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>C</w:t></w:r></w:p>';
  const result = insertAfter(xml, [
    { index: 2, xml: '<w:p><w:r><w:t>C訳</w:t></w:r></w:p>' },
    { index: 0, xml: '<w:p><w:r><w:t>A訳</w:t></w:r></w:p>' },
  ]);
  const order = [...result.matchAll(/<w:t>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ['A', 'A訳', 'B', 'C', 'C訳']);
});

test('insertAfterは存在しないindexを指定しても例外を投げず、無視する', () => {
  const xml = '<w:p><w:r><w:t>本文</w:t></w:r></w:p>';
  assert.doesNotThrow(() => insertAfter(xml, [{ index: 5, xml: '<w:p/>' }]));
  assert.strictEqual(insertAfter(xml, [{ index: 5, xml: '<w:p/>' }]), xml);
});

test('insertAfterは壊れたXMLでも例外を投げない', () => {
  assert.doesNotThrow(() => insertAfter('<w:p><w:r><w:t>閉じてない', [{ index: 0, xml: '<w:p/>' }]));
  assert.doesNotThrow(() => insertAfter(null, [{ index: 0, xml: '<w:p/>' }]));
});

// 訳文の見た目（候補Bで確定）: グレー＋斜体＋原文の9割の大きさ＋前後の余白なし。
// 余白は「w:pPr の中で pStyle や numPr より後ろ」に置かないと規格違反になる。
// テンプレート文字列の中で \s と書くと JS が s に潰してしまい一致しなくなるので、
// 位置がずれていないかをここで見張る。
test('訳文はグレー・斜体・原文の9割の大きさになる', () => {
  const src = '<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>見出し</w:t></w:r></w:p>';
  const out = buildTranslatedParagraph(src, 'Heading');
  assert.ok(out.includes('<w:color w:val="666666"/>'), 'グレー');
  assert.ok(out.includes('<w:i/>'), '斜体');
  assert.ok(out.includes('<w:sz w:val="29"/>'), '32の9割で29');
  assert.ok(out.includes('<w:b/>'), '元の太字は残る');
});

test('文字の大きさの指定が無ければ既定10.5ptの9割になる', () => {
  const out = buildTranslatedParagraph('<w:p><w:r><w:t>本文</w:t></w:r></w:p>', 'Body');
  assert.ok(out.includes('<w:sz w:val="19"/>'), '21の9割で19');
});

test('訳文の段落は前後の余白が0になる', () => {
  const src = '<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:t>本文</w:t></w:r></w:p>';
  const out = buildTranslatedParagraph(src, 'Body');
  assert.ok(out.includes('w:before="0"') && out.includes('w:after="0"'), '余白が0');
  assert.ok(!out.includes('w:before="240"'), '元の余白は残らない');
});

test('余白の指定は pStyle より後ろに入る（OOXMLの並び順）', () => {
  const src = '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>'
    + '<w:r><w:t>見出し</w:t></w:r></w:p>';
  const out = buildTranslatedParagraph(src, 'Heading');
  assert.ok(out.indexOf('w:pStyle') < out.indexOf('w:spacing'), 'pStyleの後');
  assert.ok(out.indexOf('w:spacing') < out.indexOf('w:jc'), 'jcの前');
});

test('余白の指定は numPr（箇条書き）より後ろに入る', () => {
  const src = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    + '<w:ind w:left="720"/></w:pPr><w:r><w:t>項目</w:t></w:r></w:p>';
  const out = buildTranslatedParagraph(src, 'Item');
  assert.ok(out.indexOf('</w:numPr>') < out.indexOf('w:spacing'), 'numPrの後');
  assert.ok(out.indexOf('w:spacing') < out.indexOf('w:ind'), 'indの前');
});
