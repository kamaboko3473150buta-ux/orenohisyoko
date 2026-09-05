const test = require('node:test');
const assert = require('node:assert');
const {
  buildSlideOutlineSystemPrompt, buildSlideOutlineUserPrompt,
  buildSlideBodySystemPrompt, buildSlideBodyUserPrompt,
  parseDeckJson,
} = require('../src/main/docgen/prompt');

// ---- プロンプトの中身（文字だらけの資料を作らせないための指示） ----

test('スライド構成案system: 1スライド1メッセージの指示が入り、6種のレイアウトと表紙/まとめの指示がある', () => {
  const s = buildSlideOutlineSystemPrompt();
  assert.ok(s.includes('1スライド1メッセージ'), '1スライド1メッセージの指示がある');
  assert.ok(s.includes('title'), 'titleレイアウトへの言及がある');
  assert.ok(s.includes('closing'), 'closingレイアウトへの言及がある');
  assert.ok(s.includes('JSON'), 'JSONのみの指示がある');
  assert.ok(s.includes('創作しない'), '創作しない旨の指示がある');
});

test('スライド本文system: 箇条書き最大5行・1行30字以内・1スライド1メッセージの指示が明確に入る', () => {
  const s = buildSlideBodySystemPrompt();
  assert.ok(s.includes('1スライド1メッセージ'), '1スライド1メッセージの指示がある');
  assert.ok(s.includes('最大5行'), '最大5行の指示がある');
  assert.ok(s.includes('30字以内'), '1行30字以内の指示がある');
  assert.ok(s.includes('note'), 'スピーカーノートへの言及がある');
  assert.ok(s.includes('JSON'));
  assert.ok(s.includes('創作しない'));
  assert.ok(s.includes('［') && s.includes('］'));
});

test('スライド本文system: 同じレイアウトを連続させない旨・wantsImageの説明が入る', () => {
  const s = buildSlideBodySystemPrompt();
  assert.ok(s.includes('続けない') || s.includes('連続'), '同じレイアウトを続けない旨の指示がある');
  assert.ok(s.includes('wantsImage'), 'wantsImageの説明がある');
});

// ---- imageCount ----

test('スライド構成案user: imageCountがプロンプトに入る（画像あり）', () => {
  const u = buildSlideOutlineUserPrompt({ brief: '営業提案の資料を作りたい', sources: [], imageCount: 3, today: '2026-09-05' });
  assert.ok(u.includes('3枚'), '画像の枚数が入る');
});

test('スライド構成案user: imageCountが0のとき、画像を使わない旨が入る', () => {
  const u = buildSlideOutlineUserPrompt({ brief: '', sources: [], imageCount: 0, today: '2026-09-05' });
  assert.ok(u.includes('0枚'));
  assert.ok(u.includes('画像には頼らず') || u.includes('wantsImageは使わない'), '画像が無い旨の指示がある');
});

test('スライド本文user: imageCountがプロンプトに入り、確定した構成・参考資料も入る', () => {
  const u = buildSlideBodyUserPrompt({
    brief: '営業提案の資料を作りたい',
    sources: [{ name: '実績.xlsx', text: '前年比120%' }],
    outline: { title: 'X', subtitle: 'Y', slides: [{ layout: 'title', heading: 'X' }, { layout: 'bullets', heading: '課題' }] },
    imageCount: 2,
  });
  assert.ok(u.includes('2枚'));
  assert.ok(u.includes('実績.xlsx'));
  assert.ok(u.includes('前年比120%'));
  assert.ok(u.includes('課題'));
});

test('スライド構成案user/本文user: 参考資料0件・依頼内容なしでも壊れない', () => {
  assert.doesNotThrow(() => buildSlideOutlineUserPrompt({ brief: '', sources: [], imageCount: 0, today: '2026-09-05' }));
  assert.doesNotThrow(() => buildSlideOutlineUserPrompt({}));
  assert.doesNotThrow(() => buildSlideBodyUserPrompt({ brief: '', sources: [], outline: null, imageCount: 0 }));
  assert.doesNotThrow(() => buildSlideBodyUserPrompt({}));
});

// ---- parseDeckJson: 解析 ----

test('parseDeckJson: 素のJSONを解析できる', () => {
  const raw = JSON.stringify({
    title: '新販売管理システムの導入提案',
    subtitle: '2026年度 業務改善計画',
    slides: [
      { layout: 'title', heading: '新販売管理システムの導入提案', lead: '2026年度 業務改善計画', note: '' },
      { layout: 'statement', heading: '現場の入力に月40時間かかっている', lead: '手入力と転記が二重に発生', note: '背景説明' },
      { layout: 'bullets', heading: '課題', bullets: ['二重入力', '転記ミス'], note: '' },
      {
        layout: 'compare', heading: '現行と新方式',
        left: { heading: '現行', bullets: ['手入力'] },
        right: { heading: '新方式', bullets: ['自動連携'] },
        note: '',
      },
      { layout: 'image', heading: '現在の画面', lead: '入力欄が多い', wantsImage: true, note: '' },
      { layout: 'closing', heading: 'まとめ', bullets: ['来月から導入'], note: '' },
    ],
  });
  const { deck, failed } = parseDeckJson(raw);
  assert.strictEqual(failed, false);
  assert.strictEqual(deck.title, '新販売管理システムの導入提案');
  assert.strictEqual(deck.subtitle, '2026年度 業務改善計画');
  assert.strictEqual(deck.slides.length, 6);
  assert.strictEqual(deck.slides[0].layout, 'title');
  assert.strictEqual(deck.slides[2].layout, 'bullets');
  assert.deepStrictEqual(deck.slides[2].bullets, ['二重入力', '転記ミス']);
  assert.strictEqual(deck.slides[3].layout, 'compare');
  assert.deepStrictEqual(deck.slides[3].left, { heading: '現行', bullets: ['手入力'] });
  assert.deepStrictEqual(deck.slides[3].right, { heading: '新方式', bullets: ['自動連携'] });
  assert.strictEqual(deck.slides[4].wantsImage, true);
  assert.strictEqual(deck.slides[5].layout, 'closing');
});

test('parseDeckJson: コードフェンス付き・前後に説明文が付いていても解析できる', () => {
  const base = { title: 'X', subtitle: '', slides: [{ layout: 'title', heading: 'X' }] };
  const raw1 = '```json\n' + JSON.stringify(base) + '\n```';
  assert.strictEqual(parseDeckJson(raw1).failed, false);
  assert.strictEqual(parseDeckJson(raw1).deck.title, 'X');

  const raw2 = 'かしこまりました。\n' + JSON.stringify(base) + '\nご確認ください。';
  assert.strictEqual(parseDeckJson(raw2).failed, false);
});

test('parseDeckJson: 壊れたJSON・配列・nullで例外を投げずfailed:trueになる', () => {
  assert.doesNotThrow(() => parseDeckJson('これはJSONではない'));
  assert.strictEqual(parseDeckJson('これはJSONではない').failed, true);
  assert.strictEqual(parseDeckJson('[1,2,3]').failed, true);
  assert.strictEqual(parseDeckJson('null').failed, true);
  assert.strictEqual(parseDeckJson('').failed, true);
  assert.strictEqual(parseDeckJson(null).failed, true);
  assert.strictEqual(parseDeckJson(undefined).failed, true);
  assert.deepStrictEqual(parseDeckJson('').deck, { title: '', subtitle: '', slides: [] });
});

test('parseDeckJson: slidesが無い・配列でないとfailed:trueになる', () => {
  assert.strictEqual(parseDeckJson(JSON.stringify({ title: 'X' })).failed, true);
  assert.strictEqual(parseDeckJson(JSON.stringify({ title: 'X', slides: '配列じゃない' })).failed, true);
  assert.strictEqual(parseDeckJson(JSON.stringify({ title: 'X', slides: { a: 1 } })).failed, true);
});

// ---- parseDeckJson: 正規化（AIの出力は必ず崩れるものとして扱う） ----

test('parseDeckJson: 未知のlayoutはbulletsに倒れる', () => {
  const raw = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      { layout: 'weird-layout', heading: '謎レイアウト', bullets: ['A'] },
    ],
  });
  const { deck } = parseDeckJson(raw);
  assert.strictEqual(deck.slides[1].layout, 'bullets');
  assert.deepStrictEqual(deck.slides[1].bullets, ['A']);
});

test('parseDeckJson: 6行以上の箇条書きは5行に切り詰められる', () => {
  const raw = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      { layout: 'bullets', heading: '課題', bullets: ['1', '2', '3', '4', '5', '6', '7'] },
    ],
  });
  const { deck } = parseDeckJson(raw);
  assert.deepStrictEqual(deck.slides[1].bullets, ['1', '2', '3', '4', '5']);
});

test('parseDeckJson: bulletsが文字列や数値混じりでも文字列だけ残す', () => {
  const raw = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      { layout: 'bullets', heading: '課題', bullets: ['正常', 123, null, '正常2'] },
    ],
  });
  const { deck } = parseDeckJson(raw);
  assert.deepStrictEqual(deck.slides[1].bullets, ['正常', '正常2']);
});

test('parseDeckJson: compareでleft/rightが欠けているとbulletsに倒れる', () => {
  const raw1 = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      { layout: 'compare', heading: '比較', left: { heading: '左', bullets: ['A'] } },
    ],
  });
  assert.strictEqual(parseDeckJson(raw1).deck.slides[1].layout, 'bullets');
  assert.strictEqual(parseDeckJson(raw1).deck.slides[1].left, undefined);
  assert.strictEqual(parseDeckJson(raw1).deck.slides[1].right, undefined);

  const raw2 = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      { layout: 'compare', heading: '比較' },
    ],
  });
  assert.strictEqual(parseDeckJson(raw2).deck.slides[1].layout, 'bullets');
});

test('parseDeckJson: compareでleft/rightが揃っていればcompareのまま残る', () => {
  const raw = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      {
        layout: 'compare', heading: '比較',
        left: { heading: '現行', bullets: ['A', 'B'] },
        right: { heading: '新方式', bullets: ['C'] },
      },
    ],
  });
  const { deck } = parseDeckJson(raw);
  assert.strictEqual(deck.slides[1].layout, 'compare');
  assert.deepStrictEqual(deck.slides[1].left, { heading: '現行', bullets: ['A', 'B'] });
  assert.deepStrictEqual(deck.slides[1].right, { heading: '新方式', bullets: ['C'] });
});

test('parseDeckJson: 先頭にtitleが無ければアプリ側で足す', () => {
  const raw = JSON.stringify({
    title: '導入提案', subtitle: '副題',
    slides: [
      { layout: 'bullets', heading: '課題', bullets: ['A'] },
      { layout: 'closing', heading: 'まとめ' },
    ],
  });
  const { deck } = parseDeckJson(raw);
  assert.strictEqual(deck.slides[0].layout, 'title');
  assert.strictEqual(deck.slides.length, 3, '足りないtitleスライドが1枚追加される');
  assert.strictEqual(deck.slides[1].layout, 'bullets');
});

test('parseDeckJson: 想定外の要素（文字列・null・非オブジェクト）が混ざったslidesを捨てる', () => {
  const raw = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      '文字列の要素',
      null,
      123,
      { layout: 'bullets', heading: 'OK', bullets: [] },
    ],
  });
  const { deck } = parseDeckJson(raw);
  assert.strictEqual(deck.slides.length, 2);
  assert.strictEqual(deck.slides[1].heading, 'OK');
});

test('parseDeckJson: wantsImageは真偽値以外なら false になる', () => {
  const raw = JSON.stringify({
    title: 'X', subtitle: '',
    slides: [
      { layout: 'title', heading: '表紙' },
      { layout: 'image', heading: '画面', wantsImage: 'yes' },
      { layout: 'image', heading: '画面2', wantsImage: true },
    ],
  });
  const { deck } = parseDeckJson(raw);
  assert.strictEqual(deck.slides[1].wantsImage, false);
  assert.strictEqual(deck.slides[2].wantsImage, true);
});
