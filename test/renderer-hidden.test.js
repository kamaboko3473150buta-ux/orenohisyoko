// test/renderer-hidden.test.js
// 「hidden 属性で隠すつもりの要素が、実は隠れていない」不具合を防ぐ。
//
// ブラウザ既定の [hidden]{display:none} は要素セレクタと同じ強さしかないため、
// クラスやIDで display:flex などを指定すると、そちらが勝って hidden が効かなくなる。
// 実機で「トップページの丸枠秘書子が消えない」という形で表面化した。
// 画面が出ないわけではないので、目で見るまで気づけない種類の失敗。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

// JS から el.hidden で出し入れしている、画面に常駐する要素たち。
const HIDDEN_TOGGLED = ['.hishoko-widget', '.hishoko-bubble', '.toast', '.scene-bubble', '.scene-photo'];

// コメントを取り除いたうえで「セレクタ { 宣言 }」をすべて拾い、
// セレクタが完全一致するものの宣言部だけを返す（.a と .a[hidden] は別物として扱う）。
const RULES = (() => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    for (const sel of m[1].split(',')) out.push({ selector: sel.trim(), body: m[2] });
  }
  return out;
})();

function declarationsFor(selector) {
  return RULES.filter((r) => r.selector === selector).map((r) => r.body);
}

function setsVisibleDisplay(selector) {
  return declarationsFor(selector).some((body) => {
    const m = body.match(/display\s*:\s*([a-z-]+)/);
    return Boolean(m) && m[1] !== 'none';
  });
}

for (const selector of HIDDEN_TOGGLED) {
  test(`${selector} は hidden で確実に消える`, () => {
    assert.ok(declarationsFor(selector).length > 0, `${selector} のルールが見つからない`);
    if (!setsVisibleDisplay(selector)) return; // display を指定していないなら既定の [hidden] で消える
    const guard = declarationsFor(`${selector}[hidden]`);
    assert.ok(guard.length > 0,
      `${selector} は display を指定しているので、${selector}[hidden] { display: none } が必要`);
    assert.ok(guard.some((body) => /display\s*:\s*none/.test(body)),
      `${selector}[hidden] は display: none にすること`);
  });
}
