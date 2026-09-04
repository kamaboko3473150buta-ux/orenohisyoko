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
    Views[viewName].render(this.el);
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
