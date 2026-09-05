// src/renderer/hishoko.js
// 全画面の右下に常駐する秘書子の吹き出し。index.html で app.js より先に読み込まれる想定。
// App（画面ルーター）にはまだ何も定義されていない時点で動く可能性があるため、
// App.h には依存せず、素のDOM操作だけで組み立てる。
//
// 画像 assets/hishoko/<expression>.png はまだ配置されていない前提。
// 読み込みに失敗しても img要素を隠すだけで、吹き出し自体は問題なく表示され続ける。

window.Hishoko = (function () {
  const STORAGE_KEY = 'hishoko.collapsed';
  const EXPRESSIONS = ['normal', 'smile', 'thinking', 'trouble', 'hurry', 'praise'];

  let widget = null;
  let bubble = null;
  let bubbleText = null;
  let img = null;
  let collapsed = false;
  let hasText = false;

  function readCollapsed() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false; // localStorageが使えない環境でも致命的にしない
    }
  }

  function writeCollapsed(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // 保存できなくても表示自体は続ける
    }
  }

  function paintBubbleVisibility() {
    const visible = !collapsed && hasText;
    bubble.hidden = !visible;
    // 吹き出しが出ている間は本文側に右余白を作り、入力欄や一覧に重ならないようにする
    // （右下の空きスペースを使う。画面が狭いときはCSS側で余白を付けない）。
    document.body.classList.toggle('hishoko-open', visible);
  }

  function build() {
    widget = document.createElement('div');
    widget.className = 'hishoko-widget';
    widget.id = 'hishokoWidget';

    bubble = document.createElement('div');
    bubble.className = 'hishoko-bubble';
    bubble.hidden = true;

    bubbleText = document.createElement('p');
    bubble.appendChild(bubbleText);

    const figure = document.createElement('div');
    figure.className = 'hishoko-figure';
    figure.title = 'クリックで吹き出しの表示・非表示を切り替え';

    const fallback = document.createElement('div');
    fallback.className = 'hishoko-fallback';
    fallback.textContent = '秘書子';

    img = document.createElement('img');
    img.className = 'hishoko-img';
    img.alt = '秘書子';
    // 画像が未配置（またはパスが誤り）でも吹き出し機能自体は壊さない。
    img.addEventListener('error', () => { img.style.display = 'none'; });

    figure.appendChild(fallback);
    figure.appendChild(img);
    figure.addEventListener('click', () => {
      collapsed = !collapsed;
      writeCollapsed(collapsed);
      paintBubbleVisibility();
    });

    widget.appendChild(bubble);
    widget.appendChild(figure);
    document.body.appendChild(widget);

    collapsed = readCollapsed();
    paintBubbleVisibility();
  }

  function ensureBuilt() {
    if (!widget) build();
  }

  function setExpression(expression) {
    const key = EXPRESSIONS.includes(expression) ? expression : 'normal';
    img.style.display = ''; // 前回失敗していても、表情が変わるたびに再挑戦する
    // index.html（src/renderer/）から見て assets/ はリポジトリ直下にある。
    img.src = `../../assets/hishoko/${key}.png`;
  }

  // 表情と一言を出す。
  // opts.expand を true にすると、畳まれていても開く。
  // 「相談する」のように利用者が結果を待っている操作のときだけ使う
  // （それ以外で勝手に開くと、畳んだ意思を無視することになる）。
  function say(expression, message, opts = {}) {
    ensureBuilt();
    setExpression(expression);
    const text = message == null ? '' : String(message);
    bubbleText.textContent = text;
    hasText = Boolean(text);
    if (opts.expand && collapsed) {
      collapsed = false;
      writeCollapsed(false);
    }
    paintBubbleVisibility();
  }

  // 吹き出しを空にする（人物は残す）。
  function clear() {
    ensureBuilt();
    bubbleText.textContent = '';
    hasText = false;
    paintBubbleVisibility();
  }

  // 画面を移ったときの既定の状態に戻す。表情は「微笑」。
  // 画面ごとに伝えることがあれば、そのあと say() で上書きされる。
  function reset() {
    ensureBuilt();
    setExpression('normal');
    clear();
  }

  return { say, clear, reset };
}());
