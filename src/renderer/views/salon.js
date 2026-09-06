// src/renderer/views/salon.js
// 「美容室」は今後、秘書子の髪型を変えられるようにする予定の画面。
// いまは中身がまだ無いので、準備中であることと今後の予定だけを伝える。
window.Views = window.Views || {};

Views.salon = {
  render(root) {
    App.setTitle('美容室');
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '💇 美容室（準備中）' }),
      App.h('p', { text: 'ここでは今後、秘書子の髪型を変えられるようになる予定です。もう少しお待ちください。' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('home') }, [
      App.h('p', { text: '← トップへ戻る' }),
    ]));
    if (window.Hishoko) Hishoko.say('normal', 'ここは準備中です。もうしばらくお待ちください。');
  },
};
