// src/renderer/views/menu.js
window.Views = window.Views || {};

Views.menu = {
  render(root) {
    App.setTitle('俺の秘書子');
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('compose') }, [
      App.h('h2', { text: '✉ メール文面作成' }),
      App.h('p', { text: '宛先と用件を入れるだけで、場面に合ったメールをAIが作成します' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('history') }, [
      App.h('h2', { text: '📄 作成した文面の履歴' }),
      App.h('p', { text: '過去に作ったメールを見返し、そのまま下書きとして開けます' }),
    ]));
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '＋ 今後の機能' }),
      App.h('p', { text: '新しい機能はここに追加されます' }),
    ]));
  },
};
