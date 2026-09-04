// src/renderer/views/addressbook.js
// アドレス帳画面。連絡先の一覧・追加・編集・削除と、グループの作成・編集・削除を行う。
window.Views = window.Views || {};

Views.addressbook = {
  async render(root) {
    App.setTitle('アドレス帳');
    let book = await window.hishoko.bookGet(); // { version, contacts（会社→氏名順）, groups }

    // --- ① 連絡先 ---
    const contactFormHost = App.h('div');
    const contactListHost = App.h('div');
    const addContactBtn = App.h('button', { class: 'secondary', text: '＋ 新しい連絡先' });

    function closeContactForm() {
      while (contactFormHost.firstChild) contactFormHost.removeChild(contactFormHost.firstChild);
    }

    function buildContactForm(initial, opts) {
      const isEdit = Boolean(opts.existingId);

      const companyInput = App.h('input', { type: 'text', value: initial.company || '' });
      const deptInput = App.h('input', { type: 'text', value: initial.department || '' });
      const nameInput = App.h('input', { type: 'text', value: initial.name || '' });
      const emailInput = App.h('input', { type: 'email', value: initial.email || '' });

      const honorific = App.h('select');
      [['様', '様'], ['御中', '御中'], ['先生', '先生'], ['', '敬称なし']].forEach(([v, label]) => {
        const opt = App.h('option', { value: v, text: label });
        if ((initial.honorific || '様') === v) opt.selected = true;
        honorific.appendChild(opt);
      });

      const errorEl = App.h('div', { class: 'error', hidden: true });
      const saveBtn = App.h('button', { text: '保存' });
      const cancelBtn = App.h('button', { class: 'secondary', text: 'キャンセル' });
      const deleteBtn = isEdit ? App.h('button', { class: 'secondary', text: '削除' }) : null;

      saveBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        emailInput.classList.toggle('invalid', !email);
        if (!email) {
          errorEl.textContent = 'メールアドレスを入力してください。';
          errorEl.hidden = false;
          return;
        }
        errorEl.hidden = true;
        book = await window.hishoko.bookUpsertContact({
          id: opts.existingId,
          company: companyInput.value.trim(),
          department: deptInput.value.trim(),
          name: nameInput.value.trim(),
          honorific: honorific.value,
          email,
        });
        closeContactForm();
        refreshContacts();
      });

      cancelBtn.addEventListener('click', () => closeContactForm());

      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          book = await window.hishoko.bookRemoveContact({ id: opts.existingId });
          closeContactForm();
          closeGroupForm(); // 開いていたグループ編集のメンバー一覧が古くなるため閉じる
          refreshContacts();
          refreshGroups();
        });
      }

      return App.h('div', { class: 'card' }, [
        App.h('h2', { text: isEdit ? '連絡先を編集' : '連絡先を追加' }),
        App.h('div', { class: 'row' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '会社名' }), companyInput]),
          App.h('div', { class: 'field' }, [App.h('label', { text: '部署' }), deptInput]),
        ]),
        App.h('div', { class: 'row' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '氏名' }), nameInput]),
          App.h('div', { class: 'field' }, [App.h('label', { text: '敬称' }), honorific]),
        ]),
        App.h('div', { class: 'field' }, [App.h('label', { text: 'メールアドレス' }), emailInput]),
        errorEl,
        App.h('div', { class: 'actions' }, [deleteBtn, cancelBtn, saveBtn].filter(Boolean)),
      ]);
    }

    function openContactForm(initial, opts = {}) {
      closeContactForm();
      contactFormHost.appendChild(buildContactForm(initial, opts));
    }

    addContactBtn.addEventListener('click', () => openContactForm({ honorific: '様' }, {}));

    function renderContactRow(c) {
      const label = [c.company, c.department, c.name, c.email].filter(Boolean).join(' / ');
      const row = App.h('div', { class: 'task-row' }, [
        App.h('span', { class: 'task-title', text: label || '(名称未設定)' }),
      ]);
      row.addEventListener('click', () => openContactForm(c, { existingId: c.id }));
      return row;
    }

    function refreshContacts() {
      while (contactListHost.firstChild) contactListHost.removeChild(contactListHost.firstChild);
      if (!book.contacts.length) {
        contactListHost.appendChild(App.h('div', { class: 'status', text: '連絡先はまだありません。' }));
        return;
      }
      book.contacts.forEach((c) => contactListHost.appendChild(renderContactRow(c)));
    }

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '① 連絡先' })]),
      contactListHost,
      App.h('div', { class: 'actions' }, [addContactBtn]),
    ]));
    root.appendChild(contactFormHost);

    // --- ② グループ ---
    const groupFormHost = App.h('div');
    const groupListHost = App.h('div');
    const addGroupBtn = App.h('button', { class: 'secondary', text: '＋ 新しいグループ' });

    function closeGroupForm() {
      while (groupFormHost.firstChild) groupFormHost.removeChild(groupFormHost.firstChild);
    }

    function buildGroupForm(initial, opts) {
      const isEdit = Boolean(opts.existingId);
      const nameInput = App.h('input', { type: 'text', value: initial.name || '' });
      const memberIds = new Set(initial.memberIds || []);

      const checksWrap = App.h('div', { class: 'chips' });
      book.contacts.forEach((c) => {
        const cbId = `gm-${c.id}`;
        const cb = App.h('input', { type: 'checkbox', id: cbId });
        cb.checked = memberIds.has(c.id);
        cb.addEventListener('change', () => {
          if (cb.checked) memberIds.add(c.id);
          else memberIds.delete(c.id);
        });
        const label = App.h('label', { for: cbId, text: [c.company, c.name].filter(Boolean).join(' ') || c.email });
        checksWrap.appendChild(App.h('span', {}, [cb, label]));
      });
      if (!book.contacts.length) {
        checksWrap.appendChild(App.h('div', { class: 'status', text: '先に連絡先を登録してください。' }));
      }

      const errorEl = App.h('div', { class: 'error', hidden: true });
      const saveBtn = App.h('button', { text: '保存' });
      const cancelBtn = App.h('button', { class: 'secondary', text: 'キャンセル' });
      const deleteBtn = isEdit ? App.h('button', { class: 'secondary', text: '削除' }) : null;

      saveBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        nameInput.classList.toggle('invalid', !name);
        if (!name) {
          errorEl.textContent = 'グループ名を入力してください。';
          errorEl.hidden = false;
          return;
        }
        errorEl.hidden = true;
        book = await window.hishoko.bookUpsertGroup({
          id: opts.existingId,
          name,
          memberIds: Array.from(memberIds),
        });
        closeGroupForm();
        refreshGroups();
      });

      cancelBtn.addEventListener('click', () => closeGroupForm());

      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          book = await window.hishoko.bookRemoveGroup({ id: opts.existingId });
          closeGroupForm();
          refreshGroups();
        });
      }

      return App.h('div', { class: 'card' }, [
        App.h('h2', { text: isEdit ? 'グループを編集' : 'グループを追加' }),
        App.h('div', { class: 'field' }, [App.h('label', { text: 'グループ名' }), nameInput]),
        App.h('div', { class: 'field' }, [App.h('label', { text: 'メンバー' }), checksWrap]),
        errorEl,
        App.h('div', { class: 'actions' }, [deleteBtn, cancelBtn, saveBtn].filter(Boolean)),
      ]);
    }

    function openGroupForm(initial, opts = {}) {
      closeGroupForm();
      groupFormHost.appendChild(buildGroupForm(initial, opts));
    }

    addGroupBtn.addEventListener('click', () => openGroupForm({}, {}));

    function renderGroupRow(g) {
      const count = (g.memberIds || []).length;
      const row = App.h('div', { class: 'task-row' }, [
        App.h('span', { class: 'task-title', text: g.name || '(名称未設定)' }),
        App.h('span', { class: 'task-meta', text: `${count}人` }),
      ]);
      row.addEventListener('click', () => openGroupForm(g, { existingId: g.id }));
      return row;
    }

    function refreshGroups() {
      while (groupListHost.firstChild) groupListHost.removeChild(groupListHost.firstChild);
      if (!book.groups.length) {
        groupListHost.appendChild(App.h('div', { class: 'status', text: 'グループはまだありません。' }));
        return;
      }
      book.groups.forEach((g) => groupListHost.appendChild(renderGroupRow(g)));
    }

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '② グループ' })]),
      groupListHost,
      App.h('div', { class: 'actions' }, [addGroupBtn]),
    ]));
    root.appendChild(groupFormHost);

    refreshContacts();
    refreshGroups();
  },
};
