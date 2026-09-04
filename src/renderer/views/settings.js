// src/renderer/views/settings.js
window.Views = window.Views || {};

Views.settings = {
  async render(root) {
    App.setTitle('設定');
    const s = await window.hishoko.getSettings();
    const counts = await window.hishoko.getCounts();

    // APIキー
    const keyInput = App.h('input', { type: 'text', placeholder: 'sk-ant-...' });
    const keyStatus = App.h('div', { class: 'status' });
    const renderKeyStatus = (hasKey, encrypted) => {
      keyStatus.textContent = hasKey
        ? (encrypted ? '● 設定済み（暗号化して保存されています）' : '● 設定済み（※このPCでは暗号化できないため平文で保存されています）')
        : '○ 未設定';
    };
    renderKeyStatus(s.hasApiKey, s.encrypted);

    const saveKeyBtn = App.h('button', { text: '保存' });
    const clearKeyBtn = App.h('button', { class: 'secondary', text: '削除' });
    saveKeyBtn.addEventListener('click', async () => {
      const v = keyInput.value.trim();
      if (!v) { App.toast('APIキーを入力してください'); return; }
      const next = await window.hishoko.saveSettings({ apiKey: v });
      keyInput.value = '';
      renderKeyStatus(next.hasApiKey, next.encrypted);
      App.toast('APIキーを保存しました');
    });
    clearKeyBtn.addEventListener('click', async () => {
      const next = await window.hishoko.saveSettings({ apiKey: '' });
      renderKeyStatus(next.hasApiKey, next.encrypted);
      App.toast('APIキーを削除しました');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: 'Claude APIキー' }),
        keyInput, keyStatus,
        App.h('div', { class: 'status', text: '※ https://console.anthropic.com/ で取得できます' }),
      ]),
      App.h('div', { class: 'actions' }, [clearKeyBtn, saveKeyBtn]),
    ]));

    // 署名・既定値
    const sig = App.h('textarea', {});
    sig.value = s.signature;
    const tone = App.h('select');
    const meta = await window.hishoko.mailMeta();
    meta.tones.forEach((t) => {
      const opt = App.h('option', { value: t.id, text: t.label });
      if (s.defaultTone === t.id) opt.selected = true;
      tone.appendChild(opt);
    });
    const mailer = App.h('select');
    [['outlook', 'Outlook'], ['gmail', 'Gmail']].forEach(([v, label]) => {
      const opt = App.h('option', { value: v, text: label });
      if (s.defaultMailer === v) opt.selected = true;
      mailer.appendChild(opt);
    });
    const saveBtn = App.h('button', { text: '保存' });
    saveBtn.addEventListener('click', async () => {
      await window.hishoko.saveSettings({
        signature: sig.value, defaultTone: tone.value, defaultMailer: mailer.value,
      });
      App.toast('設定を保存しました');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '署名' }, []),
        App.h('div', { class: 'status', text: '本文の末尾に自動で付きます' }),
        sig,
      ]),
      App.h('div', { class: 'row' }, [
        App.h('div', { class: 'field' }, [App.h('label', { text: '既定の文体' }), tone]),
        App.h('div', { class: 'field' }, [App.h('label', { text: '既定の送信先' }), mailer]),
      ]),
      App.h('div', { class: 'actions' }, [saveBtn]),
    ]));

    // 履歴
    const contactsLabel = App.h('div', { class: 'status', text: `宛先履歴: ${counts.contacts}件` });
    const historyLabel = App.h('div', { class: 'status', text: `文面履歴: ${counts.history}件` });
    const clearContactsBtn = App.h('button', { class: 'secondary', text: '宛先履歴を消去' });
    const clearHistoryBtn = App.h('button', { class: 'secondary', text: '文面履歴を消去' });
    clearContactsBtn.addEventListener('click', async () => {
      await window.hishoko.clearContacts();
      contactsLabel.textContent = '宛先履歴: 0件';
      App.toast('宛先履歴を消去しました');
    });
    clearHistoryBtn.addEventListener('click', async () => {
      await window.hishoko.clearHistory();
      historyLabel.textContent = '文面履歴: 0件';
      App.toast('文面履歴を消去しました');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '履歴' }), contactsLabel, historyLabel]),
      App.h('div', { class: 'actions' }, [clearContactsBtn, clearHistoryBtn]),
    ]));
  },
};
