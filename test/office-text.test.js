const test = require('node:test');
const assert = require('node:assert');
const { decodeXmlEntities, docxTextFromXml, pptxTextFromXml } = require('../src/main/docgen/office-text');

test('docx: <w:t>の中身が連結され、段落ごとに改行が入る', () => {
  const xml = '<w:p><w:r><w:t>こんにちは</w:t></w:r><w:r><w:t>、世界</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>2行目</w:t></w:r></w:p>';
  assert.strictEqual(docxTextFromXml(xml), 'こんにちは、世界\n2行目');
});

test('docx: 属性付きタグ(xml:space="preserve")からも拾える', () => {
  const xml = '<w:p><w:r><w:t xml:space="preserve"> 半角スペース入り </w:t></w:r></w:p>';
  assert.strictEqual(docxTextFromXml(xml), ' 半角スペース入り ');
});

test('docx: 実体参照が元の文字に戻る', () => {
  const xml = '<w:p><w:r><w:t>A&amp;B &lt;tag&gt; &quot;quote&quot; &apos;apos&apos; &#65; &#x41;</w:t></w:r></w:p>';
  assert.strictEqual(docxTextFromXml(xml), 'A&B <tag> "quote" \'apos\' A A');
});

test('docx: 壊れたXML・空文字でも例外を投げず空文字を返す', () => {
  assert.doesNotThrow(() => docxTextFromXml('<w:p><w:t>閉じタグが無い'));
  assert.strictEqual(docxTextFromXml('<w:p><w:t>閉じタグが無い'), '');
  assert.strictEqual(docxTextFromXml(''), '');
  assert.strictEqual(docxTextFromXml(null), '');
  assert.strictEqual(docxTextFromXml(undefined), '');
});

test('pptx: <a:t>も同様に連結され、段落ごとに改行が入る', () => {
  const xml = '<a:p><a:r><a:t>タイトル</a:t></a:r></a:p>'
    + '<a:p><a:r><a:t>本文1</a:t></a:r><a:r><a:t>本文2</a:t></a:r></a:p>';
  assert.strictEqual(pptxTextFromXml(xml), 'タイトル\n本文1本文2');
});

test('pptx: 壊れたXML・空文字でも落ちない', () => {
  assert.doesNotThrow(() => pptxTextFromXml('<a:p><a:t>閉じタグなし'));
  assert.strictEqual(pptxTextFromXml(''), '');
  assert.strictEqual(pptxTextFromXml(null), '');
});

test('decodeXmlEntities: &amp;lt; のような二重エスケープを壊さない', () => {
  // 元の文字列が「&lt;」という文字そのものだった場合、XMLでは &amp;lt; とエスケープされる。
  assert.strictEqual(decodeXmlEntities('&amp;lt;'), '&lt;');
});

test('段落が無いXMLは空文字を返す', () => {
  assert.strictEqual(docxTextFromXml('<w:body></w:body>'), '');
});
