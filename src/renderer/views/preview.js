// src/renderer/views/preview.js
window.Views = window.Views || {};

Views.preview = {
  render(root) {
    App.setTitle('プレビュー');
    const r = App.state.result;
    // 返信は下書きを開かず「コピー」で完結する。宛先・件名も無いので出さない。
    const isReply = r.mode === 'reply';

    // ここに来られるのは文面の生成に成功したとき（失敗時はcompose/replyから動かない）。
    Hishoko.say('smile', 'できました。確認してくださいね');

    // to/cc/bccは配列（複数宛先）でも文字列（履歴・返信から開いた場合）でも来る
    const joinAddr = (v) => (Array.isArray(v) ? v.filter(Boolean).join('; ') : (v || ''));

    const subject = App.h('input', { type: 'text', value: r.subject });
    const body = App.h('textarea', { class: 'preview-body' });
    body.value = r.body;

    const openBtn = App.h('button', { text: r.mailer === 'gmail' ? 'Gmailで下書きを開く' : 'Outlookで下書きを開く' });
    const copyBtn = App.h('button', { class: isReply ? '' : 'secondary', text: 'コピー' });
    const regenBtn = App.h('button', { class: 'secondary', text: '作り直す' });
    const errorEl = App.h('div', { class: 'error', hidden: true });

    const fields = [];
    if (!isReply) {
      fields.push(App.h('div', { class: 'field' }, [App.h('label', { text: '宛先' }), App.h('div', { class: 'status', text: joinAddr(r.to) })]));
      if (joinAddr(r.cc)) {
        fields.push(App.h('div', { class: 'field' }, [App.h('label', { text: 'CC' }), App.h('div', { class: 'status', text: joinAddr(r.cc) })]));
      }
      if (joinAddr(r.bcc)) {
        fields.push(App.h('div', { class: 'field' }, [App.h('label', { text: 'BCC' }), App.h('div', { class: 'status', text: joinAddr(r.bcc) })]));
      }
      fields.push(App.h('div', { class: 'field' }, [App.h('label', { text: '件名' }), subject]));
    }
    fields.push(App.h('div', { class: 'field' }, [App.h('label', { text: '本文（編集できます）' }), body]));

    root.appendChild(App.h('div', { class: 'card' }, [
      ...fields,
      errorEl,
      App.h('div', { class: 'actions' }, isReply ? [regenBtn, copyBtn] : [regenBtn, copyBtn, openBtn]),
    ]));

    const current = () => ({
      to: r.to, cc: r.cc, bcc: r.bcc, subject: subject.value, body: body.value,
    });

    copyBtn.addEventListener('click', async () => {
      await window.hishoko.mailCopy(current());
      App.toast(isReply ? '本文をコピーしました' : '件名と本文をコピーしました');
    });

    regenBtn.addEventListener('click', () => App.go(isReply ? 'reply' : 'compose'));

    if (!isReply) {
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
    }
  },
};
