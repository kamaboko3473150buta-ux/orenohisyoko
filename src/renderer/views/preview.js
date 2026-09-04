// src/renderer/views/preview.js
window.Views = window.Views || {};

Views.preview = {
  render(root) {
    App.setTitle('プレビュー');
    const r = App.state.result;

    const subject = App.h('input', { type: 'text', value: r.subject });
    const body = App.h('textarea', { class: 'preview-body' });
    body.value = r.body;

    const openBtn = App.h('button', { text: r.mailer === 'gmail' ? 'Gmailで下書きを開く' : 'Outlookで下書きを開く' });
    const copyBtn = App.h('button', { class: 'secondary', text: 'コピー' });
    const regenBtn = App.h('button', { class: 'secondary', text: '作り直す' });
    const errorEl = App.h('div', { class: 'error', hidden: true });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '宛先' }), App.h('div', { class: 'status', text: r.to })]),
      App.h('div', { class: 'field' }, [App.h('label', { text: '件名' }), subject]),
      App.h('div', { class: 'field' }, [App.h('label', { text: '本文（編集できます）' }), body]),
      errorEl,
      App.h('div', { class: 'actions' }, [regenBtn, copyBtn, openBtn]),
    ]));

    const current = () => ({ to: r.to, subject: subject.value, body: body.value });

    copyBtn.addEventListener('click', async () => {
      await window.hishoko.mailCopy(current());
      App.toast('件名と本文をコピーしました');
    });

    regenBtn.addEventListener('click', () => App.go('compose'));

    openBtn.addEventListener('click', async () => {
      openBtn.disabled = true;
      const res = r.mailer === 'gmail'
        ? await window.hishoko.mailOpenGmail(current())
        : await window.hishoko.mailOpenOutlook(current());
      openBtn.disabled = false;

      if (!res.ok) {
        errorEl.textContent = `Outlookを開けませんでした（${res.error}）。Gmailで開くか、コピーして手で貼り付けてください。`;
        errorEl.hidden = false;
        return;
      }
      App.toast(res.copiedToClipboard
        ? '本文が長いためクリップボードにコピーしました。Gmailの本文欄に貼り付けてください'
        : '下書きを開きました。内容を確認してから送信してください');
    });
  },
};
