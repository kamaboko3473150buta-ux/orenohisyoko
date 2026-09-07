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
  gameBabanuki: 'breaktime',
  gameMemory: 'breaktime',
  gameNim: 'breaktime',
  settings: 'settings',
  home: null, // トップページはサイドバーのどの項目も選択状態にしない
};

// 「戻る」は今までたどった順（ページバック）ではなく、画面の上下関係でひとつ上に戻る。
// 「仕事を頼む」→「設定」→戻る、で「仕事を頼む」ではなくトップに戻るのが自然なため。
// preview だけは、どこから開いたかで戻り先が変わる（入力画面に戻れないと直せない）ので、
// 開いた画面が App.state.previewFrom に入れておく。
const PARENT_VIEW = {
  home: null,
  menu: 'home',
  salon: 'home',
  breaktime: 'home',
  settings: 'home',
  mailmenu: 'menu',
  tasks: 'menu',
  docgen: 'menu',
  translate: 'menu',
  gameBabanuki: 'breaktime',
  gameMemory: 'breaktime',
  gameNim: 'breaktime',
  compose: 'mailmenu',
  reply: 'mailmenu',
  history: 'mailmenu',
  addressbook: 'mailmenu',
  preview: 'mailmenu',
};

// 秘書子を画面の中に自前で描く画面。ここでは右下の常駐ウィジェットを出さない
// （トップは背景の中に立っていて、対戦中は卓の対面に座っている。二重に出すと
//  同じ人が2人いることになる）。
const OWN_HISHOKO = ['home', 'gameBabanuki', 'gameMemory', 'gameNim'];

const App = {
  el: document.getElementById('app'),
  titleEl: document.getElementById('pageTitle'),
  backBtn: document.getElementById('backBtn'),
  sidebarItems: Array.from(document.querySelectorAll('.sidebar-item')),
  state: {},   // 画面をまたいで持ち回るデータ（入力内容・生成結果など）
  current: null,

  go(viewName, opts = {}) {
    this.current = viewName;
    // 上に戻る先がある画面だけ「戻る」を出す（トップページには出さない）。
    this.backBtn.hidden = !this.parentOf(viewName);
    this.el.innerHTML = '';

    document.body.classList.toggle('home-view', viewName === 'home');
    // 対戦画面は「秘書子の手札」と「自分の手札」が同時に見えないと遊べないので、
    // 下の余白を詰めて1画面に収める。
    document.body.classList.toggle('game-view', viewName.startsWith('game'));
    this.paintSidebar(viewName);

    // 画面を移ったら秘書子はいったん既定（微笑・吹き出しなし）に戻す。
    // 伝えることがある画面は、このあと自分で say() して上書きする。
    if (window.Hishoko) {
      Hishoko.reset();
      if (OWN_HISHOKO.includes(viewName)) Hishoko.hide(); else Hishoko.show();
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
        // 器そのものではなく中身だけを移す。器をそのまま入れると main と画面の間に
        // 余計な div が挟まり、main を flex にしたときに高さが伝わらなくなる
        // （トップページの背景が高さ0になった）。
        while (buffer.firstChild) this.el.appendChild(buffer.firstChild);
      })
      .catch((err) => {
        if (myGeneration !== this.generation) return;
        this.el.appendChild(this.h('div', { class: 'card' }, [
          this.h('div', { class: 'error', text: `画面の表示に失敗しました: ${err.message}` }),
        ]));
      });
  },

  // ひとつ上の画面の名前。無ければ null（＝戻るボタンを出さない）。
  parentOf(viewName) {
    if (viewName === 'preview' && this.state.previewFrom) return this.state.previewFrom;
    return PARENT_VIEW[viewName] || null;
  },

  back() {
    const parent = this.parentOf(this.current);
    if (parent) this.go(parent);
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
