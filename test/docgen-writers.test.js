const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const { Document, Packer, ImageRun, Paragraph } = require('docx');
const {
  buildHtml, buildChartSvg, writeDocx, writePresentationPptx,
} = require('../src/main/docgen/writers');
const { docxTextFromXml, pptxTextFromXml } = require('../src/main/docgen/office-text');
const { extractImages, MIN_BYTES } = require('../src/main/docgen/images');

// ---- 基本: 見出し・段落・箇条書きがそれぞれのタグになる ----

test('buildHtml: titleがh1、見出しがh2、段落がp、箇条書きがul/liになる', () => {
  const html = buildHtml({
    title: '第12回 定例会議 議事録',
    sections: [
      {
        heading: '決定事項',
        paragraphs: ['A案で進めることになった。'],
        bullets: ['予算は来月確定', '担当は田中'],
      },
    ],
  });
  assert.ok(html.includes('<h1>第12回 定例会議 議事録</h1>'), 'タイトルがh1');
  assert.ok(html.includes('<h2>決定事項</h2>'), 'セクション見出しがh2');
  assert.ok(html.includes('<p>A案で進めることになった。</p>'), '段落がp');
  assert.ok(html.includes('<ul>'), '箇条書きがul');
  assert.ok(html.includes('<li>予算は来月確定</li>'), '箇条書きの項目がli');
  assert.ok(html.includes('<li>担当は田中</li>'));
});

test('buildHtml: 複数セクションを順番通りに出す', () => {
  const html = buildHtml({
    title: 'テスト',
    sections: [
      { heading: '第一部', paragraphs: ['いち'] },
      { heading: '第二部', paragraphs: ['に'] },
    ],
  });
  const idx1 = html.indexOf('第一部');
  const idx2 = html.indexOf('第二部');
  assert.ok(idx1 !== -1 && idx2 !== -1 && idx1 < idx2, 'セクションの順序が保たれる');
});

// ---- HTML特殊文字のエスケープ ----

test('buildHtml: <script>などの特殊文字がエスケープされる（タイトル）', () => {
  const html = buildHtml({ title: '<script>alert(1)</script>', sections: [] });
  assert.ok(!html.includes('<script>alert(1)</script>'), '生のscriptタグが残らない');
  assert.ok(html.includes('&lt;script&gt;'), 'エスケープされた形で入る');
});

test('buildHtml: 段落・箇条書き・見出しの特殊文字がすべてエスケープされる', () => {
  const html = buildHtml({
    title: 'タイトル',
    sections: [
      {
        heading: '<h1>見出し</h1>',
        paragraphs: ['A & B < C > D "quote"'],
        bullets: ['<b>太字</b>'],
      },
    ],
  });
  assert.ok(html.includes('&lt;h1&gt;見出し&lt;/h1&gt;'));
  assert.ok(html.includes('A &amp; B &lt; C &gt; D &quot;quote&quot;'));
  assert.ok(html.includes('&lt;b&gt;太字&lt;/b&gt;'));
  assert.ok(!html.includes('<b>太字</b>'));
});

// ---- 想定外のデータで落ちない ----

test('buildHtml: sectionsが無くても落ちない', () => {
  assert.doesNotThrow(() => buildHtml({ title: 'タイトルのみ' }));
  const html = buildHtml({ title: 'タイトルのみ' });
  assert.ok(html.includes('タイトルのみ'));
});

test('buildHtml: docそのものがundefined/nullでも落ちない', () => {
  assert.doesNotThrow(() => buildHtml(undefined));
  assert.doesNotThrow(() => buildHtml(null));
  assert.doesNotThrow(() => buildHtml({}));
});

test('buildHtml: titleが無くても落ちない', () => {
  const html = buildHtml({ sections: [{ heading: '見出しのみ', paragraphs: [], bullets: [] }] });
  assert.ok(!html.includes('<h1></h1>'), '空のh1は出さない');
  assert.ok(html.includes('<h2>見出しのみ</h2>'));
});

test('buildHtml: bulletsが空配列でもulを出さない', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{ heading: '見出し', paragraphs: ['本文'], bullets: [] }],
  });
  assert.ok(!html.includes('<ul>'), '空の箇条書きはulごと出さない');
});

test('buildHtml: paragraphsに空文字が混ざっても空のpを出さない', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{ heading: '見出し', paragraphs: ['', '  ', '本文のみ'], bullets: [] }],
  });
  assert.ok(!html.includes('<p></p>'), '空文字の段落は出さない');
  assert.ok(html.includes('<p>本文のみ</p>'));
});

test('buildHtml: 見出し・段落・箇条書きが全部空のセクションは出力しない', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{ heading: '', paragraphs: [], bullets: [] }, { heading: '実在', paragraphs: [], bullets: [] }],
  });
  assert.ok(html.includes('<h2>実在</h2>'));
  // 空セクション分の余計な見出しタグが混ざらないことを確認
  const h2Count = (html.match(/<h2>/g) || []).length;
  assert.strictEqual(h2Count, 1);
});

test('buildHtml: sectionsの要素がオブジェクトでなくても落ちない', () => {
  assert.doesNotThrow(() => buildHtml({ title: 'T', sections: ['文字列', null, 123, undefined] }));
});

test('buildHtml: 日本語フォント指定が入っている', () => {
  const html = buildHtml({ title: 'T', sections: [] });
  assert.ok(html.includes('Yu Gothic') || html.includes('Meiryo'), '日本語フォントの指定がある');
});

test('buildHtml: 純粋関数（同じ入力なら同じ出力）', () => {
  const doc = { title: 'T', sections: [{ heading: 'H', paragraphs: ['P'], bullets: ['B'] }] };
  assert.strictEqual(buildHtml(doc), buildHtml(doc));
});

// ---- meta・table（Task 41: 種類ごとの雛形） ----

test('buildHtml: metaがラベル・値の表になる', () => {
  const html = buildHtml({
    title: '第12回 定例会議 議事録',
    meta: [
      { label: '日時', value: '2026年9月3日(水) 14:00〜15:00' },
      { label: '場所', value: '第2会議室' },
    ],
    sections: [],
  });
  assert.ok(html.includes('日時'));
  assert.ok(html.includes('2026年9月3日(水) 14:00〜15:00'));
  assert.ok(html.includes('場所'));
  assert.ok(html.includes('第2会議室'));
  assert.ok(html.includes('<table'), 'metaがtableタグになる');
});

test('buildHtml: metaが無ければmetaのtableを出さない', () => {
  const html = buildHtml({ title: 'T', sections: [] });
  assert.ok(!html.includes('<table'));
});

test('buildHtml: metaの特殊文字がエスケープされる', () => {
  const html = buildHtml({
    title: 'T',
    meta: [{ label: '<b>日時</b>', value: 'A & B' }],
    sections: [],
  });
  assert.ok(!html.includes('<b>日時</b>'));
  assert.ok(html.includes('&lt;b&gt;日時&lt;/b&gt;'));
  assert.ok(html.includes('A &amp; B'));
});

test('buildHtml: セクションのtableがheaders/rowsの表になる', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{
      heading: '宿題',
      paragraphs: [],
      bullets: [],
      table: { headers: ['項目', '担当', '期限'], rows: [['議事録配布', '田中', '9/10']] },
    }],
  });
  assert.ok(html.includes('項目'));
  assert.ok(html.includes('担当'));
  assert.ok(html.includes('期限'));
  assert.ok(html.includes('議事録配布'));
  assert.ok(html.includes('田中'));
  assert.ok(html.includes('9/10'));
});

test('buildHtml: tableの特殊文字がエスケープされる', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{
      heading: 'H',
      table: { headers: ['<script>'], rows: [['A & B']] },
    }],
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A &amp; B'));
});

test('buildHtml: tableが無いセクションはtableタグを出さない', () => {
  const html = buildHtml({ title: 'T', sections: [{ heading: 'H', paragraphs: ['p'], bullets: [] }] });
  assert.ok(!html.includes('<table'));
});

test('buildHtml: tableの列数が合わない行は捨てて描く（headersと行の長さが揃う）', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{
      heading: 'H',
      table: { headers: ['A', 'B'], rows: [['a1', 'b1'], ['壊れた行のみ']] },
    }],
  });
  assert.ok(html.includes('a1'));
  assert.ok(html.includes('b1'));
  assert.ok(!html.includes('壊れた行のみ'), '列数が合わない行は出さない');
});

test('buildHtml: meta・tableが型違い（文字列・null等）でも落ちない', () => {
  assert.doesNotThrow(() => buildHtml({ title: 'T', meta: 'not-an-array', sections: [] }));
  assert.doesNotThrow(() => buildHtml({
    title: 'T',
    sections: [{ heading: 'H', table: 'not-an-object' }],
  }));
  assert.doesNotThrow(() => buildHtml({
    title: 'T',
    sections: [{ heading: 'H', table: { headers: [], rows: [] } }],
  }));
});

// ---- buildChartSvg（Task 43） ----

function barChart() {
  return {
    type: 'bar',
    title: '月別売上',
    labels: ['1月', '2月', '3月'],
    series: [{ name: '売上', values: [120, 150, 90] }],
  };
}

test('buildChartSvg: bar/line/pieそれぞれで妥当な<svg>を返す', () => {
  for (const type of ['bar', 'line', 'pie']) {
    const svg = buildChartSvg({ ...barChart(), type });
    assert.ok(svg.startsWith('<svg'), `${type}: <svg>で始まる`);
    assert.ok(svg.trim().endsWith('</svg>'), `${type}: </svg>で終わる`);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), `${type}: 名前空間がある`);
  }
});

test('buildChartSvg: typeが3種以外ならbarとして描く（例外を投げない）', () => {
  assert.doesNotThrow(() => buildChartSvg({ ...barChart(), type: 'radar' }));
});

test('buildChartSvg: ラベルの<script>や&がエスケープされる', () => {
  const svg = buildChartSvg({
    type: 'bar',
    title: '<b>売上</b> & 実績',
    labels: ['<script>alert(1)</script>', '正常'],
    // 凡例は系列が2本以上のときだけ描くので、系列名のエスケープを見るには2本必要
    series: [{ name: '<i>系列</i>', values: [1, 2] }, { name: '比較', values: [2, 1] }],
  });
  assert.ok(!svg.includes('<script>alert(1)</script>'), '生のscriptタグが残らない');
  assert.ok(svg.includes('&lt;script&gt;'), 'ラベルがエスケープされている');
  assert.ok(svg.includes('&lt;b&gt;売上&lt;/b&gt; &amp; 実績'), 'titleもエスケープされている');
  assert.ok(svg.includes('&lt;i&gt;系列&lt;/i&gt;'), '凡例の系列名もエスケープされている');
});

test('buildChartSvg: 値が1件（項目1つ・系列1つ）でも落ちない', () => {
  const svg = buildChartSvg({
    type: 'pie', title: '内訳', labels: ['唯一'], series: [{ name: 'X', values: [42] }],
  });
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('唯一'));
});

test('buildChartSvg: 値が全部0件（項目0）でも例外を投げず空のsvgを返す', () => {
  assert.doesNotThrow(() => buildChartSvg({
    type: 'bar', title: '', labels: [], series: [],
  }));
  const svg = buildChartSvg({ type: 'bar', title: '', labels: [], series: [] });
  assert.ok(svg.startsWith('<svg'));
});

test('buildChartSvg: chartがnull/undefined/型違いでも例外を投げず空のsvgを返す', () => {
  for (const bad of [null, undefined, '文字列', 123]) {
    assert.doesNotThrow(() => buildChartSvg(bad));
    assert.ok(buildChartSvg(bad).startsWith('<svg'));
  }
});

test('buildChartSvg: 複数系列の凡例（系列名）が入る', () => {
  const svg = buildChartSvg({
    type: 'bar',
    labels: ['1月', '2月'],
    series: [
      { name: '今年', values: [100, 120] },
      { name: '昨年', values: [90, 95] },
    ],
  });
  assert.ok(svg.includes('今年'));
  assert.ok(svg.includes('昨年'));
});

test('buildChartSvg: widthとheightを指定できる（省略時は既定値になる）', () => {
  const svgDefault = buildChartSvg(barChart());
  assert.ok(svgDefault.includes('width="480"') && svgDefault.includes('height="320"'));
  const svgCustom = buildChartSvg(barChart(), { width: 200, height: 100 });
  assert.ok(svgCustom.includes('width="200"') && svgCustom.includes('height="100"'));
});

test('buildChartSvg: 純粋関数（同じ入力なら同じ出力）', () => {
  const chart = barChart();
  assert.strictEqual(buildChartSvg(chart), buildChartSvg(chart));
  assert.strictEqual(buildChartSvg(chart), buildChartSvg(JSON.parse(JSON.stringify(chart))));
});

test('buildHtml: sectionのchartがsvgとして埋め込まれる', () => {
  const html = buildHtml({
    title: 'T',
    sections: [{ heading: '売上推移', chart: barChart() }],
  });
  assert.ok(html.includes('<svg'), 'chartがsvgとして入る');
  assert.ok(html.includes('月別売上'));
  assert.ok(html.includes('1月'));
});

test('buildHtml: chartが無いセクションはsvgを出さない', () => {
  const html = buildHtml({ title: 'T', sections: [{ heading: 'H', paragraphs: ['p'] }] });
  assert.ok(!html.includes('<svg'));
});

test('buildHtml: chartが型違い（文字列等）でも落ちない', () => {
  assert.doesNotThrow(() => buildHtml({ title: 'T', sections: [{ heading: 'H', chart: 'not-an-object' }] }));
});

// ---- writeDocx: 実際に.docxとして書き出し、office-text.jsで読み返す ----

test('writeDocx: metaと表を含む資料を書き出し、読み返して中身が入っていることを確認する', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docgen-docx-verify-'));
  try {
    const outPath = path.join(workDir, 'verify.docx');
    const doc = {
      title: '第12回 定例会議 議事録',
      meta: [
        { label: '日時', value: '2026年9月3日(水) 14:00〜15:00' },
        { label: '場所', value: '第2会議室' },
        { label: '出席者', value: '田中・佐藤・鈴木' },
      ],
      sections: [
        {
          heading: '決定事項',
          paragraphs: ['A案で進めることになった。'],
          bullets: [],
        },
        {
          heading: '宿題',
          paragraphs: [],
          bullets: [],
          table: {
            headers: ['項目', '担当', '期限'],
            rows: [
              ['議事録の配布', '田中', '9/10'],
              ['資料の作成', '鈴木', '9/12'],
            ],
          },
        },
      ],
    };

    await writeDocx(doc, outPath);

    const zip = new AdmZip(outPath);
    const xml = zip.readAsText('word/document.xml');
    const text = docxTextFromXml(xml);

    assert.match(text, /第12回 定例会議 議事録/);
    assert.match(text, /日時/);
    assert.match(text, /2026年9月3日\(水\) 14:00〜15:00/);
    assert.match(text, /場所/);
    assert.match(text, /第2会議室/);
    assert.match(text, /出席者/);
    assert.match(text, /田中・佐藤・鈴木/);
    assert.match(text, /決定事項/);
    assert.match(text, /A案で進めることになった。/);
    assert.match(text, /宿題/);
    assert.match(text, /項目/);
    assert.match(text, /担当/);
    assert.match(text, /期限/);
    assert.match(text, /議事録の配布/);
    assert.match(text, /田中/);
    assert.match(text, /9\/10/);
    assert.match(text, /資料の作成/);
    assert.match(text, /鈴木/);
    assert.match(text, /9\/12/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writeDocx: metaもtableも無い資料（既存呼び出し）でもこれまで通り書き出せる', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docgen-docx-legacy-'));
  try {
    const outPath = path.join(workDir, 'legacy.docx');
    const doc = {
      title: 'これまで通りの資料',
      sections: [{ heading: '見出し', paragraphs: ['段落'], bullets: ['箇条書き'] }],
    };
    await assert.doesNotReject(writeDocx(doc, outPath));
    const zip = new AdmZip(outPath);
    const text = docxTextFromXml(zip.readAsText('word/document.xml'));
    assert.match(text, /これまで通りの資料/);
    assert.match(text, /見出し/);
    assert.match(text, /段落/);
    assert.match(text, /箇条書き/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writeDocx: meta・sectionsが想定外の型（文字列・null等）でも例外を投げない', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docgen-docx-broken-'));
  try {
    const cases = [
      { title: 'T', meta: 'not-an-array', sections: [] },
      { title: 'T', sections: [{ heading: 'H', table: 'not-an-object' }] },
      { title: 'T', sections: [{ heading: 'H', table: { headers: ['A'], rows: 'not-an-array' } }] },
      null,
      undefined,
      {},
    ];
    let n = 0;
    for (const doc of cases) {
      n += 1;
      const outPath = path.join(workDir, `broken-${n}.docx`);
      await assert.doesNotReject(writeDocx(doc, outPath), `case ${n}`);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

// ---- writePresentationPptx（Task 37: プレゼン専用のレイアウト付き書き出し） ----

// 実物のPNGヘッダを持つ1x1の小さな透明PNG（extractImagesの出力と同じ形の
// { id, path, sourceName, bytes } を自分で用意して渡す）。
const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function mkTmpDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

// 書き出した.pptxをadm-zipで開き、スライド本文・ノート・メディアを読み返すための小さなヘルパー。
function readPptx(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries().map((e) => e.entryName);
  const slideNames = entries
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)[1]) - Number(b.match(/slide(\d+)\.xml/)[1]));
  const noteNames = entries
    .filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/notesSlide(\d+)\.xml/)[1]) - Number(b.match(/notesSlide(\d+)\.xml/)[1]));
  const mediaNames = entries.filter((n) => /^ppt\/media\/.+\.(png|jpe?g|gif)$/i.test(n));
  return {
    slideTexts: slideNames.map((n) => pptxTextFromXml(zip.readAsText(n))),
    slideXmls: slideNames.map((n) => zip.readAsText(n)),
    noteTexts: noteNames.map((n) => pptxTextFromXml(zip.readAsText(n))),
    mediaNames,
  };
}

function sixLayoutDeck() {
  return {
    title: '検証用資料',
    subtitle: '副題テスト',
    slides: [
      { layout: 'title', heading: '表紙のタイトル', lead: '副題テキスト', note: '表紙のノート' },
      { layout: 'statement', heading: '結論はこれだ', lead: '補足の一言', note: 'statementのノート' },
      {
        layout: 'bullets',
        heading: '課題一覧',
        bullets: ['課題1', '課題2', '課題3', '課題4', '課題5', '課題6（6行目、切り詰め確認用）'],
        note: 'bulletsのノート',
      },
      {
        layout: 'compare',
        heading: '現行と新方式',
        left: { heading: '現行', bullets: ['手入力', '転記あり'] },
        right: { heading: '新方式', bullets: ['自動入力', '転記なし'] },
        note: 'compareのノート',
      },
      {
        layout: 'image', heading: '画像スライド', lead: '画像の説明', wantsImage: true, note: '画像のノート',
      },
      { layout: 'closing', heading: 'まとめ', bullets: ['次の一歩1', '次の一歩2'], note: 'closingのノート' },
    ],
  };
}

test('writePresentationPptx: 6レイアウトすべてを書き出し、スライド数・本文・ノート・画像を読み返せる', async () => {
  const workDir = await mkTmpDir('docgen-pptx-verify-');
  try {
    const imgPath = path.join(workDir, 'sample.png');
    await fs.writeFile(imgPath, Buffer.from(TEST_PNG_BASE64, 'base64'));
    const outPath = path.join(workDir, 'verify.pptx');
    const images = [{ id: 'img-1', path: imgPath, sourceName: 'sample.docx', bytes: 999999 }];

    await writePresentationPptx(sixLayoutDeck(), images, outPath);

    const { slideTexts, noteTexts, mediaNames } = readPptx(outPath);

    assert.ok(slideTexts.length >= 6, `スライドは6枚以上あるはず（実際: ${slideTexts.length}）`);

    assert.match(slideTexts[0], /表紙のタイトル/);
    assert.match(slideTexts[0], /副題テキスト/);
    assert.match(slideTexts[1], /結論はこれだ/);
    assert.match(slideTexts[2], /課題一覧/);
    assert.match(slideTexts[2], /課題5/);
    assert.doesNotMatch(slideTexts[2], /課題6/, '6行目は切り詰められて出ない');
    assert.match(slideTexts[3], /現行/);
    assert.match(slideTexts[3], /新方式/);
    assert.match(slideTexts[3], /手入力/);
    assert.match(slideTexts[3], /自動入力/);
    assert.match(slideTexts[4], /画像スライド/);
    assert.match(slideTexts[4], /画像の説明/);
    assert.match(slideTexts[5], /まとめ/);
    assert.match(slideTexts[5], /次の一歩1/);

    assert.ok(mediaNames.length >= 1, '画像入りスライドの分、ppt/media/に画像が入っているはず');

    assert.strictEqual(noteTexts.length, slideTexts.length, 'スライドごとにノートがあるはず');
    assert.match(noteTexts[0], /表紙のノート/);
    assert.match(noteTexts[4], /画像のノート/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writePresentationPptx: 16:9・Yu Gothic・濃紺(#1F3864)がXMLに入っている', async () => {
  const workDir = await mkTmpDir('docgen-pptx-look-');
  try {
    const outPath = path.join(workDir, 'look.pptx');
    await writePresentationPptx(sixLayoutDeck(), [], outPath);
    const zip = new AdmZip(outPath);
    const presentationXml = zip.readAsText('ppt/presentation.xml');
    assert.match(presentationXml, /sldSz[^>]*cx="9144000"[^>]*cy="5143500"/, '16:9のスライドサイズ');
    const { slideXmls } = readPptx(outPath);
    const joined = slideXmls.join('\n');
    assert.match(joined, /Yu Gothic/, 'フォント指定がYu Gothic');
    assert.match(joined, /1F3864/i, '濃紺の配色が使われている');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writePresentationPptx: 画像が足りないimageスライドはstatementとして描かれる（画像を割り当てない）', async () => {
  const workDir = await mkTmpDir('docgen-pptx-noimg-');
  try {
    const outPath = path.join(workDir, 'noimg.pptx');
    const deck = {
      title: 'T',
      slides: [
        { layout: 'title', heading: '表紙' },
        {
          layout: 'image', heading: '画像が欲しいスライド', lead: '画像の代わりの説明', wantsImage: true,
        },
      ],
    };
    await writePresentationPptx(deck, [], outPath); // 画像を1枚も渡さない
    const { slideTexts, mediaNames } = readPptx(outPath);
    assert.match(slideTexts[1], /画像が欲しいスライド/);
    assert.match(slideTexts[1], /画像の代わりの説明/);
    assert.strictEqual(mediaNames.length, 0, '画像が無いので ppt/media/ に何も入らない');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writePresentationPptx: compareでleft/rightが欠けていればbulletsとして描かれ、中身が残る', async () => {
  const workDir = await mkTmpDir('docgen-pptx-compare-');
  try {
    const outPath = path.join(workDir, 'compare.pptx');
    const deck = {
      title: 'T',
      slides: [
        { layout: 'compare', heading: '比較のはずが壊れている', left: { heading: '現行', bullets: ['手入力'] } },
      ],
    };
    await writePresentationPptx(deck, [], outPath);
    const { slideTexts } = readPptx(outPath);
    assert.match(slideTexts[0], /比較のはずが壊れている/);
    assert.match(slideTexts[0], /手入力/, 'leftにあった箇条書きの中身が救済される');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writePresentationPptx: 未知のlayoutはbulletsとして描かれる', async () => {
  const workDir = await mkTmpDir('docgen-pptx-unknown-');
  try {
    const outPath = path.join(workDir, 'unknown.pptx');
    const deck = { title: 'T', slides: [{ layout: 'nonsense', heading: '謎レイアウト', bullets: ['中身'] }] };
    await writePresentationPptx(deck, [], outPath);
    const { slideTexts } = readPptx(outPath);
    assert.match(slideTexts[0], /謎レイアウト/);
    assert.match(slideTexts[0], /中身/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writePresentationPptx: slidesが無い・型違い・nullでも例外を投げず、最低1枚は出る', async () => {
  const workDir = await mkTmpDir('docgen-pptx-broken-');
  try {
    const cases = [
      { title: 'スライド無し' },
      { title: '型違い', slides: 'not-an-array' },
      null,
      undefined,
      {},
    ];
    let n = 0;
    for (const deck of cases) {
      n += 1;
      const outPath = path.join(workDir, `broken-${n}.pptx`);
      await assert.doesNotReject(writePresentationPptx(deck, null, outPath));
      const { slideTexts } = readPptx(outPath);
      assert.ok(slideTexts.length >= 1, `少なくとも1枚は出る（case ${n}）`);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('writePresentationPptx: 画像のpathが存在しなくても例外を投げず、statementに倒れる', async () => {
  const workDir = await mkTmpDir('docgen-pptx-badimg-');
  try {
    const outPath = path.join(workDir, 'badimg.pptx');
    const deck = {
      title: 'T',
      slides: [{
        layout: 'image', heading: '画像スライド', lead: '画像が無いので統計文へ', wantsImage: true,
      }],
    };
    const images = [{ id: 'img-1', path: path.join(workDir, 'does-not-exist.png'), sourceName: 'x', bytes: 1 }];
    await assert.doesNotReject(writePresentationPptx(deck, images, outPath));
    const { slideTexts, mediaNames } = readPptx(outPath);
    assert.match(slideTexts[0], /画像スライド/);
    assert.match(slideTexts[0], /画像が無いので統計文へ/);
    assert.strictEqual(mediaNames.length, 0, '読めない画像はppt/media/に入らない');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

// ---- 画像抽出（images.js）→ プレゼン書き出し（writers.js）の一連の流れ ----
// index.js（Task 38）はこの2つを橋渡しするだけなので、Electronに依存しないここで
// 「添付から実際に画像を抜き出し、そのままpptxに埋め込む」までを通しで確認する。

test('extractImagesで取り出した画像をそのままwritePresentationPptxに渡すと、media配下に入る', async () => {
  const workDir = await mkTmpDir('docgen-pptx-pipeline-src-');
  const imgOutDir = await mkTmpDir('docgen-pptx-pipeline-img-');
  const pptxDir = await mkTmpDir('docgen-pptx-pipeline-out-');
  try {
    // MIN_BYTESを超える適当なPNG（docgen-images.test.jsと同じ考え方: ヘッダのみ本物）。
    const header = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const bigPng = Buffer.concat([header, Buffer.alloc(MIN_BYTES + 500 - header.length, 0)]);

    const wordDoc = new Document({
      sections: [{
        children: [new Paragraph({
          children: [new ImageRun({ data: bigPng, transformation: { width: 100, height: 100 }, type: 'png' })],
        })],
      }],
    });
    const buf = await Packer.toBuffer(wordDoc);
    const docxPath = path.join(workDir, '参考資料.docx');
    await fs.writeFile(docxPath, buf);

    const images = await extractImages([docxPath], imgOutDir);
    assert.strictEqual(images.length, 1, '前提: 添付から1枚取り出せている');

    const outPath = path.join(pptxDir, 'pipeline.pptx');
    const deck = {
      title: '通し確認用資料',
      slides: [
        { layout: 'title', heading: '表紙' },
        {
          layout: 'image', heading: '添付から拾った画像', lead: '説明', wantsImage: true,
        },
      ],
    };
    await writePresentationPptx(deck, images, outPath);

    const { slideTexts, mediaNames } = readPptx(outPath);
    assert.match(slideTexts[1], /添付から拾った画像/);
    assert.strictEqual(mediaNames.length, 1, '抽出した画像がppt/media/に1枚入る');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(imgOutDir, { recursive: true, force: true });
    await fs.rm(pptxDir, { recursive: true, force: true });
  }
});
