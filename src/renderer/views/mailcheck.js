// src/renderer/views/mailcheck.js
// 受信確認：特定の相手からメールが届いているかを、メーラーを開かずに確かめる。
// AIは使わないので費用はかからない。
window.Views = window.Views || {};

const MATCH_LABELS = [
  { id: 'from', label: '相手から届いた' },
  { id: 'to', label: '相手へ送った' },
  { id: 'both', label: '両方' },
];

function formatWhen(iso) {
  if (!iso) return '日時不明';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

Views.mailcheck = {
  async render(root) {
    App.setTitle('受信確認');

    // 設定が古い形（受信確認をまだ一度も使っていない）でも画面が壊れないよう、
    // 足りない項目はここで埋める。実際に mailcheck が渡らず画面全体が出なくなった。
    const settings = await window.hishoko.getSettings();
    const conf = {
      provider: 'gmail',
      gmailAddress: '',
      watch: [],
      match: 'from',
      unreadOnly: true,
      days: 14,
      ...(settings.mailcheck || {}),
    };
    if (!Array.isArray(conf.watch)) conf.watch = [];

    const errorEl = App.h('div', { class: 'error', hidden: true });
    const statusEl = App.h('div', { class: 'status' });
    const listEl = App.h('div', { class: 'check-list' });

    // --- 確認する相手 ---
    const watchChips = App.h('div', { class: 'chips' });
    const addressInput = App.h('input', { type: 'text', placeholder: 'aite@example.co.jp' });

    function paintWatch() {
      watchChips.innerHTML = '';
      if (conf.watch.length === 0) {
        watchChips.appendChild(App.h('span', { class: 'status', text: 'まだ登録がありません' }));
      }
      for (const w of conf.watch) {
        watchChips.appendChild(App.h('span', { class: 'chip recipient-chip' }, [
          App.h('span', { text: w.label ? `${w.label}（${w.address}）` : w.address }),
          App.h('button', {
            class: 'chip-remove', type: 'button', text: '×', title: '削除',
            onclick: () => {
              conf.watch = conf.watch.filter((x) => x.address !== w.address);
              save({ watch: conf.watch });
              paintWatch();
            },
          }),
        ]));
      }
    }

    function addAddress(value) {
      const address = String(value || '').trim();
      if (!address) return;
      conf.watch = conf.watch.concat([{ address }]);
      save({ watch: conf.watch });
      addressInput.value = '';
      paintWatch();
    }

    // 設定はその場で保存する。次に開いたときも同じ相手を見に行けるようにするため。
    async function save(patch) {
      const saved = await window.hishoko.saveSettings({ mailcheck: { ...conf, ...patch } });
      Object.assign(conf, saved.mailcheck);
      paintWatch();
    }

    // アドレス帳から選べるようにする。メール文面作成で貯まった連絡先をそのまま使える。
    const bookBtn = App.h('button', {
      class: 'secondary', text: 'アドレス帳から選ぶ',
      onclick: async () => {
        const { contacts } = await window.hishoko.bookGet();
        const known = new Set(conf.watch.map((w) => w.address));
        const pick = App.h('div', { class: 'chips' });
        const rest = (contacts || []).filter((c) => c.email && !known.has(c.email.toLowerCase()));
        if (rest.length === 0) {
          App.toast('追加できる連絡先がありません');
          return;
        }
        for (const c of rest) {
          pick.appendChild(App.h('button', {
            class: 'chip', type: 'button',
            text: c.name ? `${c.name}（${c.email}）` : c.email,
            onclick: () => {
              conf.watch = conf.watch.concat([{ address: c.email, label: c.name || c.company || '' }]);
              save({ watch: conf.watch });
              pick.remove();
            },
          }));
        }
        watchChips.after(pick);
      },
    });

    // --- 探し方 ---
    const matchRow = App.h('div', { class: 'chips' });
    function paintMatch() {
      matchRow.innerHTML = '';
      for (const m of MATCH_LABELS) {
        matchRow.appendChild(App.h('button', {
          class: `chip${conf.match === m.id ? ' selected' : ''}`, type: 'button', text: m.label,
          onclick: () => { conf.match = m.id; save({ match: m.id }); paintMatch(); },
        }));
      }
    }
    paintMatch();

    const unreadInput = App.h('input', { type: 'checkbox' });
    unreadInput.checked = conf.unreadOnly;
    unreadInput.addEventListener('change', () => save({ unreadOnly: unreadInput.checked }));

    const daysInput = App.h('input', { type: 'text', value: String(conf.days) });
    daysInput.addEventListener('change', () => save({ days: Number(daysInput.value) }));

    const providerRow = App.h('div', { class: 'chips' });
    const { providers } = await window.hishoko.mailcheckMeta();
    function paintProvider() {
      providerRow.innerHTML = '';
      for (const p of providers) {
        providerRow.appendChild(App.h('button', {
          class: `chip${conf.provider === p.id ? ' selected' : ''}`, type: 'button',
          text: p.label, title: p.note,
          onclick: () => { conf.provider = p.id; save({ provider: p.id }); paintProvider(); },
        }));
      }
    }
    paintProvider();

    // --- 実行 ---
    const runBtn = App.h('button', { text: '確認する' });

    function paintResult(messages) {
      listEl.innerHTML = '';
      if (messages.length === 0) {
        listEl.appendChild(App.h('div', { class: 'status', text: '該当するメールはありませんでした。' }));
        return;
      }
      for (const m of messages) {
        const row = App.h('div', { class: `check-row${m.unread ? ' unread' : ''}` }, [
          App.h('div', { class: 'check-when', text: formatWhen(m.receivedAt) }),
          App.h('div', { class: 'check-main' }, [
            App.h('div', { class: 'check-subject', text: m.subject || '（件名なし）' }),
            App.h('div', { class: 'check-from', text: m.fromName ? `${m.fromName} <${m.from}>` : m.from }),
          ]),
          App.h('div', { class: 'check-flag', text: m.unread ? '未読' : '' }),
        ]);
        row.addEventListener('click', async () => {
          const r = await window.hishoko.mailcheckOpen(m);
          if (!r.ok) App.toast(r.error || r.message || '開けませんでした');
        });
        listEl.appendChild(row);
      }
    }

    runBtn.addEventListener('click', async () => {
      errorEl.hidden = true;
      runBtn.disabled = true;
      statusEl.textContent = '確認しています…';
      listEl.innerHTML = '';
      if (window.Hishoko) Hishoko.say('thinking', 'メールボックスを見てきます。');
      try {
        const r = await window.hishoko.mailcheckRun({});
        if (!r.ok) {
          errorEl.textContent = r.message || '確認に失敗しました。';
          errorEl.hidden = false;
          statusEl.textContent = '';
          if (window.Hishoko) Hishoko.say('trouble', 'うまく確認できませんでした。');
          return;
        }
        const unread = r.messages.filter((m) => m.unread).length;
        statusEl.textContent = `${r.messages.length}件見つかりました（未読 ${unread}件）`;
        paintResult(r.messages);
        if (window.Hishoko) {
          Hishoko.say(r.messages.length ? 'normal' : 'smile',
            r.messages.length ? `${r.messages.length}件届いています。` : '該当するメールはありませんでした。');
        }
      } finally {
        runBtn.disabled = false;
      }
    });

    // --- 画面の組み立て ---
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '📥 受信確認' }),
      App.h('p', { text: '特定の相手からメールが届いているかを、メーラーを開かずに確かめます。AIは使わないので費用はかかりません。' }),
    ]));

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '① 確認する相手' }),
      watchChips,
      App.h('div', { class: 'task-add-row' }, [addressInput,
        App.h('button', { text: '追加', onclick: () => addAddress(addressInput.value) })]),
      App.h('div', { class: 'game-actions' }, [bookBtn]),
    ]));

    addressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addAddress(addressInput.value); }
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '② 探し方' }),
      App.h('div', { class: 'field' }, [App.h('label', { text: 'どちらの向きを探すか' }), matchRow]),
      App.h('div', { class: 'field' }, [App.h('label', { text: 'どこを見るか' }), providerRow]),
      App.h('div', { class: 'row' }, [
        App.h('div', { class: 'field' }, [
          App.h('label', { text: '何日前まで見るか' }), daysInput,
        ]),
        App.h('div', { class: 'field' }, [
          App.h('label', { text: '未読だけ' }),
          App.h('div', { class: 'check-inline' }, [unreadInput,
            App.h('span', { class: 'status', text: '既読も含めるならチェックを外します' })]),
        ]),
      ]),
    ]));

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'game-actions' }, [runBtn]),
      errorEl,
      statusEl,
      listEl,
    ]));

    paintWatch();
    if (window.Hishoko) Hishoko.say('normal', '確認したい相手を選んで、「確認する」を押してください。');
  },
};
