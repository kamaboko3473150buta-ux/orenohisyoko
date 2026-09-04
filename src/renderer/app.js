// src/renderer/app.js
// 画面の切り替えと、全画面で使う小さな道具。

const App = {
  el: document.getElementById('app'),
  titleEl: document.getElementById('pageTitle'),
  backBtn: document.getElementById('backBtn'),
  state: {},   // 画面をまたいで持ち回るデータ（入力内容・生成結果など）
  history: [],

  go(viewName, opts = {}) {
    if (!opts.replace) this.history.push(viewName);
    this.backBtn.hidden = this.history.length <= 1;
    this.el.innerHTML = '';

    // 画面によっては render が非同期（設定や履歴の読み込みを待つ）。
    // 待っている間に別画面へ移ると、古い画面の要素が今の画面に紛れ込んでしまう。
    // そこで、いったん画面から切り離した器に描き、描き終わった時点で
    // まだ自分が最新の画面なら本体に差し込む。古くなっていたら捨てる。
    this.generation = (this.generation || 0) + 1;
    const myGeneration = this.generation;
    const buffer = document.createElement('div');

    Promise.resolve(Views[viewName].render(buffer))
      .then(() => {
        if (myGeneration !== this.generation) return; // すでに別の画面に移っている
        this.el.appendChild(buffer);
      })
      .catch((err) => {
        if (myGeneration !== this.generation) return;
        this.el.appendChild(this.h('div', { class: 'card' }, [
          this.h('div', { class: 'error', text: `画面の表示に失敗しました: ${err.message}` }),
        ]));
      });
  },

  back() {
    this.history.pop();
    const prev = this.history[this.history.length - 1] || 'menu';
    this.history.pop();
    this.go(prev);
  },

  setTitle(t) { this.titleEl.textContent = t; },

  toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  },

  // よく使うDOM生成
  h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) el.appendChild(c);
    return el;
  },
};

document.getElementById('backBtn').addEventListener('click', () => App.back());
document.getElementById('settingsBtn').addEventListener('click', () => App.go('settings'));

App.go('menu');
