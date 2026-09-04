// src/renderer/views/history.js
window.Views = window.Views || {};

Views.history = {
  async render(root) {
    App.setTitle('作成した文面の履歴');
    const list = await window.hishoko.mailHistory();

    if (!list.length) {
      root.appendChild(App.h('div', { class: 'card' }, [
        App.h('p', { text: 'まだ履歴はありません。メールを作成すると、ここに最新100件が残ります。' }),
      ]));
      return;
    }

    list.forEach((item) => {
      const when = String(item.createdAt || '').slice(0, 16).replace('T', ' ');
      const head = [when, item.to].filter(Boolean).join('  /  ');
      root.appendChild(App.h('div', {
        class: 'card clickable',
        onclick: () => {
          App.state.result = {
            subject: item.subject || '', body: item.body || '',
            to: item.to || '', mailer: 'outlook',
          };
          App.go('preview');
        },
      }, [
        App.h('p', { text: head }),
        App.h('h2', { text: item.subject || '（件名なし）' }),
        App.h('p', { text: String(item.body || '').replace(/\n/g, ' ').slice(0, 60) + '…' }),
      ]));
    });
  },
};
