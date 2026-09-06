// src/renderer/views/breaktime.js
// 「息抜き」は今後、秘書子と1対1のミニゲームで遊べるようにする予定の画面。
// いまは中身がまだ無いので、準備中であることと今後の予定だけを伝える。
window.Views = window.Views || {};

Views.breaktime = {
  render(root) {
    App.setTitle('息抜き');
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '🎮 息抜き（準備中）' }),
      App.h('p', { text: 'ここでは今後、秘書子と1対1のミニゲームで遊べるようになる予定です。もう少しお待ちください。' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('home') }, [
      App.h('p', { text: '← トップへ戻る' }),
    ]));
    if (window.Hishoko) Hishoko.say('normal', 'ここは準備中です。もうしばらくお待ちください。');
  },
};
