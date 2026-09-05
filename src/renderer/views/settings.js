// src/renderer/views/settings.js
window.Views = window.Views || {};

Views.settings = {
  async render(root) {
    App.setTitle('設定');
    const s = await window.hishoko.getSettings();
    const counts = await window.hishoko.getCounts();
    const modelMeta = await window.hishoko.modelsList(); // { models, features }
    const modelLabel = (id) => {
      const m = modelMeta.models.find((x) => x.id === id);
      return m ? m.label : id;
    };

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

    // 使うモデル（Task 33）。機能ごとに既定モデルを選ぶ。ここでの選択が各画面の初期値になる。
    const modelSelects = {};
    const modelFields = modelMeta.features.map((f) => {
      const select = App.h('select');
      const noteEl = App.h('div', { class: 'status' });
      const paintNote = () => {
        const m = modelMeta.models.find((x) => x.id === select.value);
        noteEl.textContent = m ? m.note : '';
      };
      modelMeta.models.forEach((m) => {
        const opt = App.h('option', { value: m.id, text: m.label });
        if ((s.models && s.models[f.id]) === m.id) opt.selected = true;
        select.appendChild(opt);
      });
      paintNote();
      select.addEventListener('change', paintNote);
      modelSelects[f.id] = select;
      return App.h('div', { class: 'field' }, [App.h('label', { text: f.label }), select, noteEl]);
    });

    const saveModelsBtn = App.h('button', { text: '保存' });
    saveModelsBtn.addEventListener('click', async () => {
      const patch = {};
      modelMeta.features.forEach((f) => { patch[f.id] = modelSelects[f.id].value; });
      await window.hishoko.saveSettings({ models: patch });
      App.toast('使うモデルを保存しました');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '使うモデル' }),
        App.h('div', { class: 'status', text: '各画面ではこの回だけ変えられます（ここでの設定は既定値です）。' }),
      ]),
      ...modelFields,
      App.h('div', { class: 'actions' }, [saveModelsBtn]),
    ]));

    // アドレス帳と文面履歴
    // 「履歴」ではなく自分で育てた資産なので、消すときは必ず確認を挟む。
    const contactsLabel = App.h('div', { class: 'status', text: `アドレス帳の連絡先: ${counts.contacts}件` });
    const historyLabel = App.h('div', { class: 'status', text: `文面履歴: ${counts.history}件` });
    const clearContactsBtn = App.h('button', { class: 'secondary', text: 'アドレス帳を空にする' });
    const clearHistoryBtn = App.h('button', { class: 'secondary', text: '文面履歴を消去' });
    clearContactsBtn.addEventListener('click', async () => {
      const ok = window.confirm('アドレス帳の連絡先をすべて削除します。元に戻せません。よろしいですか？');
      if (!ok) return;
      await window.hishoko.clearContacts();
      contactsLabel.textContent = 'アドレス帳の連絡先: 0件';
      App.toast('アドレス帳を空にしました');
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

    // API利用状況（Task 19・33）。トークン数はこのアプリで記録した実績、金額はそこからの概算。
    // Task 33: モデル別の内訳（byModel）も添える。
    const fmtNum = (n) => Number(n || 0).toLocaleString('ja-JP');
    const fmtJpy = (n) => `¥${Math.round(n || 0).toLocaleString('ja-JP')}`;
    const fmtUsd = (n) => `$${(n || 0).toFixed(2)}`;
    const describeMonth = (m) => (m.count
      ? `${m.month}: ${fmtNum(m.count)}通 / 入力${fmtNum(m.inputTokens)}・出力${fmtNum(m.outputTokens)}トークン / 概算 ${fmtJpy(m.costJpy)}（${fmtUsd(m.costUsd)}）`
      : `${m.month}: まだ利用がありません`);
    const describeTotal = (t) => `${fmtNum(t.count)}通 / 概算 ${fmtJpy(t.costJpy)}（${fmtUsd(t.costUsd)}）`;
    // モデル別の内訳の行だけを作る（利用が無いモデルは出さない）。
    const byModelLines = (byModel) => Object.entries(byModel || {})
      .filter(([, e]) => e.count)
      .map(([id, e]) => `　- ${modelLabel(id)}: ${fmtNum(e.count)}通 / 入力${fmtNum(e.inputTokens)}・出力${fmtNum(e.outputTokens)}トークン / 概算 ${fmtJpy(e.costJpy)}（${fmtUsd(e.costUsd)}）`);
    const appendByModel = (host, byModel) => {
      byModelLines(byModel).forEach((line) => host.appendChild(App.h('div', { class: 'status', text: line })));
    };

    const usageWrap = App.h('div');
    const paintUsage = (u) => {
      while (usageWrap.firstChild) usageWrap.removeChild(usageWrap.firstChild);

      const currentBlock = App.h('div');
      currentBlock.appendChild(App.h('div', { class: 'status', text: describeMonth(u.current) }));
      appendByModel(currentBlock, u.current.byModel);

      const monthsBlock = App.h('div');
      if (u.months.length) {
        u.months.forEach((m) => {
          monthsBlock.appendChild(App.h('div', { class: 'status', text: describeMonth(m) }));
          appendByModel(monthsBlock, m.byModel);
        });
      } else {
        monthsBlock.appendChild(App.h('div', { class: 'status', text: '記録はまだありません' }));
      }

      const totalBlock = App.h('div');
      totalBlock.appendChild(App.h('div', { class: 'status', text: describeTotal(u.total) }));
      appendByModel(totalBlock, u.total.byModel);

      usageWrap.appendChild(App.h('div', { class: 'field' }, [App.h('label', { text: '当月' }), currentBlock]));
      usageWrap.appendChild(App.h('div', { class: 'field' }, [App.h('label', { text: '月別' }), monthsBlock]));
      usageWrap.appendChild(App.h('div', { class: 'field' }, [App.h('label', { text: '累計' }), totalBlock]));
    };

    const usage = await window.hishoko.getUsage();
    paintUsage(usage);

    const clearUsageBtn = App.h('button', { class: 'secondary', text: '記録を消去' });
    clearUsageBtn.addEventListener('click', async () => {
      await window.hishoko.clearUsage();
      paintUsage(await window.hishoko.getUsage());
      App.toast('利用状況の記録を消去しました');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: 'API利用状況' }),
        App.h('div', { class: 'status', text: '※ 金額はこのアプリでの利用実績からの概算です。実際の請求額とは異なる場合があります。' }),
      ]),
      usageWrap,
      App.h('div', { class: 'actions' }, [clearUsageBtn]),
    ]));
  },
};
