// src/renderer/views/menu.js
window.Views = window.Views || {};

Views.menu = {
  render(root) {
    App.setTitle('俺の秘書子');
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('mailmenu') }, [
      App.h('h2', { text: '✉ メール文面作成' }),
      App.h('p', { text: '新規メールの作成・返信文の作成・作成した文面の履歴はこちらから' }),
    ]));
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '＋ 今後の機能' }),
      App.h('p', { text: '新しい機能はここに追加されます' }),
    ]));
  },
};
