// src/renderer/today.js
// 「今日の予定」と「今日のニュース」の中身を、アプリを開いている間だけ覚えておく。
//
// 画面を移っても消えないようにする（毎回聞き直すとAPI費用がかかるため）。
// ただし**あくまで今日の情報**なので、日付が変わったら捨てる。
// 日付の確認は画面を移るたびに行う（アプリを開きっぱなしで日をまたぐことがあるため）。
window.Today = (function () {
  function ymd(date) {
    const d = date instanceof Date ? date : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // collapsed は「見出しだけの小さい形にしてある」かどうか。中身は消さない
  // （消すと聞き直すことになり、そのたびにAPI費用がかかる）。
  const store = {
    date: ymd(), plan: '', news: '', collapsed: { plan: false, news: false },
  };

  function key(kind) {
    return kind === 'news' ? 'news' : 'plan';
  }

  // 日付が変わっていたら中身を捨てる。捨てたら true を返す。
  function expireIfStale(now) {
    const today = ymd(now);
    if (store.date === today) return false;
    store.date = today;
    store.plan = '';
    store.news = '';
    store.collapsed = { plan: false, news: false };
    return true;
  }

  return {
    ymd,
    expireIfStale,
    get(kind) {
      expireIfStale();
      return kind === 'news' ? store.news : store.plan;
    },
    set(kind, text) {
      expireIfStale();
      if (kind === 'news') store.news = String(text || '');
      else store.plan = String(text || '');
    },
    clear(kind) {
      store[key(kind)] = '';
      store.collapsed[key(kind)] = false;
    },
    isCollapsed(kind) {
      expireIfStale();
      return !!store.collapsed[key(kind)];
    },
    setCollapsed(kind, value) {
      store.collapsed[key(kind)] = !!value;
    },
    toggleCollapsed(kind) {
      store.collapsed[key(kind)] = !store.collapsed[key(kind)];
      return store.collapsed[key(kind)];
    },
  };
}());
