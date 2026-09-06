// src/renderer/app.js
// 画面の切り替えと、全画面で使う小さな道具。

// サイドバーの項目ごとに、どの画面名がその項目に属するかをまとめる。
// 「仕事を頼む」配下は既存の4機能とその中の全画面（メール文面作成・タスク・資料作成・翻訳）。
const SIDEBAR_SECTIONS = {
  menu: 'menu',
  mailmenu: 'menu',
  addressbook: 'menu',
  compose: 'menu',
  reply: 'menu',
  preview: 'menu',
  history: 'menu',
  tasks: 'menu',
  docgen: 'menu',
  translate: 'menu',
  salon: 'salon',
  breaktime: 'breaktime',
  settings: 'settings',
  home: null, // トップページはサイドバーのどの項目も選択状態にしない
};

const App = {
  el: document.getElementById('app'),
  titleEl: document.getElementById('pageTitle'),
  backBtn: document.getElementById('backBtn'),
  sidebarItems: Array.from(document.querySelectorAll('.sidebar-item')),
  state: {},   // 画面をまたいで持ち回るデータ（入力内容・生成結果など）
  history: [],

  go(viewName, opts = {}) {
    if (!opts.replace) this.history.push(viewName);
    // トップページでは戻る先があっても戻るボタンは出さない（画面の役割上、常に起点のため）。
    this.backBtn.hidden = viewName === 'home' || this.history.length <= 1;
    this.el.innerHTML = '';

    document.body.classList.toggle('home-view', viewName === 'home');
    this.paintSidebar(viewName);

    // 画面を移ったら秘書子はいったん既定（微笑・吹き出しなし）に戻す。
    // 伝えることがある画面は、このあと自分で say() して上書きする。
    if (window.Hishoko) {
      Hishoko.reset();
      // トップページ（home）は大きな秘書子が背景内に立っているので、
      // 右下の常駐ウィジェットは隠す（二重表示を避ける）。他の画面では出す。
      if (viewName === 'home') Hishoko.hide(); else Hishoko.show();
    }

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
    const prev = this.history[this.history.length - 1] || 'home';
    this.history.pop();
    this.go(prev);
  },

  setTitle(t) { this.titleEl.textContent = t; },

  // 今いる画面に対応するサイドバー項目だけを選択状態にする。
  // 「仕事を頼む」配下の各画面（メール文面作成・タスク・資料作成・翻訳など）は
  // すべて同じ「仕事を頼む」項目を選択状態にする。
  paintSidebar(viewName) {
    const section = SIDEBAR_SECTIONS[viewName] || null;
    for (const btn of this.sidebarItems) {
      btn.classList.toggle('active', btn.dataset.view === section);
    }
  },

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

// サイドバー: ロゴでトップページへ、各項目でそれぞれの画面へ。
const sidebarHomeBtn = document.getElementById('sidebarHome');
if (sidebarHomeBtn) sidebarHomeBtn.addEventListener('click', () => App.go('home'));
for (const btn of App.sidebarItems) {
  btn.addEventListener('click', () => App.go(btn.dataset.view));
}

App.go('home');
