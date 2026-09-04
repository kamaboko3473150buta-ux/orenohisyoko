// src/renderer/views/mailmenu.js
// 「メール文面作成」のサブメニュー。新規作成・返信作成・履歴の入口をまとめる。
window.Views = window.Views || {};

Views.mailmenu = {
  render(root) {
    App.setTitle('メール文面作成');
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('compose') }, [
      App.h('h2', { text: '📝 新規メールを作る' }),
      App.h('p', { text: '宛先と用件を入れるだけで、場面に合ったメールをAIが作成します' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('reply') }, [
      App.h('h2', { text: '↩ 返信を作る' }),
      App.h('p', { text: '受信したメールの本文を貼り付けるだけで、返信文をAIが作成します' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('history') }, [
      App.h('h2', { text: '📄 作成した文面の履歴' }),
      App.h('p', { text: '過去に作ったメールを見返し、そのまま下書きとして開けます' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('addressbook') }, [
      App.h('h2', { text: '📇 アドレス帳' }),
      App.h('p', { text: '宛先の連絡先とグループを管理します' }),
    ]));
  },
};
