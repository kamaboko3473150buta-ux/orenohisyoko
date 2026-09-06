// src/renderer/views/reply.js
// 返信文作成。すでにメーラーで「返信」を押している前提のため、宛先・件名・場面の入力は不要。
window.Views = window.Views || {};

Views.reply = {
  async render(root) {
    App.setTitle('返信文を作成');
    const meta = await window.hishoko.mailMeta();
    const settings = await window.hishoko.getSettings();
    const modelMeta = await window.hishoko.modelsList();

    // 前回の入力があれば引き継ぐ（プレビューから戻ってきたとき）
    const f = App.state.replyForm || {
      toneId: settings.defaultTone,
      model: settings.models.mail, // その回だけの上書き。設定は書き換えない
      received: '',
      memo: '',
    };
    App.state.replyForm = f;

    const received = App.h('textarea', { class: 'preview-body' });
    received.value = f.received;
    received.addEventListener('input', () => { f.received = received.value; });

    const tone = App.h('select');
    meta.tones.forEach((t) => {
      const opt = App.h('option', { value: t.id, text: t.label });
      if (f.toneId === t.id) opt.selected = true;
      tone.appendChild(opt);
    });
    tone.addEventListener('change', () => { f.toneId = tone.value; });

    const memo = App.h('input', { type: 'text', value: f.memo, placeholder: '例: 今回は断りたい／来週なら可能' });
    memo.addEventListener('input', () => { f.memo = memo.value; });

    // モデル選択(その回だけの上書き。初期値は設定の既定で、選んでも設定自体は変わらない）
    const modelSelect = App.h('select');
    modelMeta.models.forEach((m) => {
      const opt = App.h('option', { value: m.id, text: m.label });
      if (f.model === m.id) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    modelSelect.addEventListener('change', () => { f.model = modelSelect.value; });

    const errorEl = App.h('div', { class: 'error', hidden: true });
    const submit = App.h('button', { text: '返信文を作成する' });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '① 受信したメールを貼り付け' }), received]),
      App.h('div', { class: 'field' }, [App.h('label', { text: '② 文体' }), tone]),
      App.h('div', { class: 'field' }, [App.h('label', { text: '③ 伝えたいこと（任意・空欄でよい）' }), memo]),
      errorEl,
      App.h('div', { class: 'actions' }, [
        App.h('div', { class: 'model-inline' }, [App.h('span', { text: 'モデル' }), modelSelect]),
        submit,
      ]),
    ]));

    submit.addEventListener('click', async () => {
      // 受信メールが空のときは生成しない
      const empty = !String(f.received || '').trim();
      received.classList.toggle('invalid', empty);
      if (empty) {
        errorEl.textContent = '受信したメールの本文を貼り付けてください。';
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      submit.disabled = true;
      submit.textContent = '作成中…（10秒ほどかかります）';
      Hishoko.say('thinking', '文面を考えています…');

      const res = await window.hishoko.mailGenerateReply({
        toneId: f.toneId, received: f.received, memo: f.memo, model: f.model,
      });

      submit.disabled = false;
      submit.textContent = '返信文を作成する';

      if (!res.ok) {
        errorEl.textContent = res.message;
        errorEl.hidden = false;
        Hishoko.say('trouble', res.message);
        if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
        return;
      }
      App.state.result = { subject: '', body: res.body, to: '', mode: 'reply' };
      // 戻るときは入力画面に帰れるようにする（プレビューから直せないと困るため）
      App.state.previewFrom = 'reply';
      App.go('preview');
    });
  },
};
