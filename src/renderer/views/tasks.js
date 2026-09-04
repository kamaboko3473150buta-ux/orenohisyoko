// src/renderer/views/tasks.js
// タスク・スケジュール管理画面。
// 予定（日時のある約束）とタスク（期限のあるやること）を1つのリストで扱う。
window.Views = window.Views || {};

Views.tasks = {
  async render(root) {
    App.setTitle('タスク・スケジュール管理');

    const settings = await window.hishoko.getSettings();
    let inputMode = settings.defaultTaskInput === 'ai' ? 'ai' : 'manual';
    let doneOpen = false; // 完了したものの折りたたみ。既定は閉じる（localStorageには保存しない）

    // --- ① 追加欄 ---
    const lineInput = App.h('input', {
      type: 'text',
      placeholder: '例: 来週金曜までにA社へ見積書を送る',
    });
    const addBtn = App.h('button', { text: '追加' });
    const addErrorEl = App.h('div', { class: 'error', hidden: true });

    const radioAi = App.h('input', { type: 'radio', name: 'taskInputMode', id: 'taskInputAi' });
    const radioManual = App.h('input', { type: 'radio', name: 'taskInputMode', id: 'taskInputManual' });
    radioAi.checked = inputMode === 'ai';
    radioManual.checked = inputMode === 'manual';

    const setMode = (mode) => {
      inputMode = mode;
      radioAi.checked = mode === 'ai';
      radioManual.checked = mode === 'manual';
      window.hishoko.saveSettings({ defaultTaskInput: mode });
    };
    radioAi.addEventListener('change', () => setMode('ai'));
    radioManual.addEventListener('change', () => setMode('manual'));

    const radioRow = App.h('div', { class: 'radio-row' }, [
      App.h('span', {}, [radioAi, App.h('label', { for: 'taskInputAi', text: 'AIで取り込む' })]),
      App.h('span', {}, [radioManual, App.h('label', { for: 'taskInputManual', text: '手で入力する' })]),
    ]);

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: 'やること・予定を入力' }),
        App.h('div', { class: 'task-add-row' }, [lineInput, addBtn]),
        App.h('div', { class: 'status', text: '話し言葉のまま入力 → AIが期限・相手・種別を推定します' }),
        radioRow,
        addErrorEl,
      ]),
    ]));

    // --- 確認・編集フォームの差し込み先 ---
    const formHost = App.h('div');
    root.appendChild(formHost);

    function closeForm() {
      while (formHost.firstChild) formHost.removeChild(formHost.firstChild);
    }

    function openForm(initial, opts = {}) {
      closeForm();
      formHost.appendChild(buildTaskForm(initial, opts));
    }

    function buildTaskForm(initial, opts) {
      const isEdit = Boolean(opts.existingId);
      const failed = Boolean(opts.failed);

      const titleInput = App.h('input', { type: 'text', value: initial.title || '' });
      const dueInput = App.h('input', { type: 'date', value: initial.due || '' });
      const atInput = App.h('input', { type: 'time', value: initial.at || '' });
      const whoInput = App.h('input', { type: 'text', value: initial.who || '' });
      const kindInput = App.h('input', { type: 'text', value: initial.kind || '', list: 'taskKindOptions' });
      const datalist = App.h('datalist', { id: 'taskKindOptions' });
      ['提出', '連絡', '会議', '移動', 'その他'].forEach((k) => {
        datalist.appendChild(App.h('option', { value: k }));
      });

      const priorityInput = App.h('select');
      [['high', '高'], ['normal', '普通'], ['low', '低']].forEach(([v, label]) => {
        const opt = App.h('option', { value: v, text: label });
        if ((initial.priority || 'normal') === v) opt.selected = true;
        priorityInput.appendChild(opt);
      });

      const noteInput = App.h('textarea', {});
      noteInput.value = initial.note || '';

      const errorEl = App.h('div', { class: 'error', hidden: true });
      const saveBtn = App.h('button', { text: '保存' });
      const cancelBtn = App.h('button', { class: 'secondary', text: 'キャンセル' });
      const deleteBtn = isEdit ? App.h('button', { class: 'secondary', text: '削除' }) : null;

      const notice = failed
        ? App.h('div', { class: 'status', text: '読み取れなかったので件名だけ入れました。内容を確認してください。' })
        : null;

      saveBtn.addEventListener('click', async () => {
        const t = titleInput.value.trim();
        titleInput.classList.toggle('invalid', !t);
        if (!t) {
          errorEl.textContent = '件名を入力してください。';
          errorEl.hidden = false;
          return;
        }
        errorEl.hidden = true;

        const patch = {
          title: t,
          due: dueInput.value || null,
          at: atInput.value || null,
          who: whoInput.value.trim() || null,
          kind: kindInput.value.trim() || null,
          priority: priorityInput.value,
          note: noteInput.value,
        };

        if (isEdit) {
          await window.hishoko.taskUpdate({ id: opts.existingId, patch });
        } else {
          await window.hishoko.taskAdd(patch);
        }
        closeForm();
        await refresh();
      });

      cancelBtn.addEventListener('click', () => closeForm());

      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          await window.hishoko.taskRemove({ id: opts.existingId });
          closeForm();
          await refresh();
        });
      }

      return App.h('div', { class: 'card' }, [
        App.h('h2', { text: isEdit ? '内容を編集' : '内容を確認' }),
        notice,
        App.h('div', { class: 'field' }, [App.h('label', { text: '件名' }), titleInput]),
        App.h('div', { class: 'row' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '期限（日付・任意）' }), dueInput]),
          App.h('div', { class: 'field' }, [App.h('label', { text: '時刻（予定の場合・任意）' }), atInput]),
        ]),
        App.h('div', { class: 'row' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '相手（任意）' }), whoInput]),
          App.h('div', { class: 'field' }, [App.h('label', { text: '種別（任意）' }), kindInput, datalist]),
        ]),
        App.h('div', { class: 'field' }, [App.h('label', { text: '優先度' }), priorityInput]),
        App.h('div', { class: 'field' }, [App.h('label', { text: 'メモ（任意）' }), noteInput]),
        errorEl,
        App.h('div', { class: 'actions' }, [deleteBtn, cancelBtn, saveBtn].filter(Boolean)),
      ]);
    }

    addBtn.addEventListener('click', async () => {
      const text = lineInput.value.trim();
      addErrorEl.hidden = true;
      if (!text) {
        addErrorEl.textContent = '内容を入力してください。';
        addErrorEl.hidden = false;
        return;
      }

      if (inputMode === 'ai') {
        addBtn.disabled = true;
        addBtn.textContent = '取り込み中…（数秒かかります）';
        const res = await window.hishoko.taskParse({ text });
        addBtn.disabled = false;
        addBtn.textContent = '追加';

        if (!res.ok) {
          addErrorEl.textContent = res.message;
          addErrorEl.hidden = false;
          if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
          return;
        }
        lineInput.value = '';
        openForm(res.task, { failed: res.failed });
      } else {
        lineInput.value = '';
        openForm({ title: text }, { failed: false });
      }
    });

    // --- 「今日の進め方を相談する」 ---
    const briefBtn = App.h('button', { class: 'secondary', text: '今日の進め方を相談する' });
    const briefResult = App.h('div', { class: 'status', hidden: true });

    briefBtn.addEventListener('click', async () => {
      briefBtn.disabled = true;
      briefBtn.textContent = '相談中…（数秒かかります）';
      briefResult.hidden = true;

      const res = await window.hishoko.taskBrief();

      briefBtn.disabled = false;
      briefBtn.textContent = '今日の進め方を相談する';

      briefResult.className = res.ok ? 'status' : 'error';
      briefResult.textContent = res.message;
      briefResult.hidden = false;
      if (!res.ok && (res.code === 'no_key' || res.code === 'auth')) App.go('settings');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      briefResult,
      App.h('div', { class: 'actions' }, [briefBtn]),
    ]));

    // --- 一覧 ---
    const listHost = App.h('div');
    root.appendChild(App.h('div', { class: 'card' }, [listHost]));

    const GROUPS = [
      ['overdue', '期限切れ'],
      ['today', '今日'],
      ['tomorrow', '明日'],
      ['thisWeek', '今週'],
      ['later', 'それ以降'],
      ['noDue', '期限なし'],
    ];

    function formatMeta(t) {
      const bits = [];
      if (t.due) bits.push(t.at ? `${t.due} ${t.at}` : `${t.due} まで`);
      else if (t.at) bits.push(t.at);
      if (t.who) bits.push(t.who);
      return bits.join('　');
    }

    function renderRow(t, groupKey) {
      const checkbox = App.h('input', { type: 'checkbox' });
      checkbox.checked = Boolean(t.done);
      checkbox.addEventListener('click', (ev) => ev.stopPropagation());
      checkbox.addEventListener('change', async () => {
        const willBeDone = checkbox.checked;
        await window.hishoko.taskToggle({ id: t.id });
        await refresh();
        if (willBeDone) Hishoko.say('praise', 'おつかれさまです');
      });

      const rowClass = ['task-row'];
      if (groupKey === 'overdue') rowClass.push('task-overdue');
      if (groupKey === 'today') rowClass.push('task-today');

      const row = App.h('div', { class: rowClass.join(' ') }, [
        checkbox,
        App.h('span', { class: 'task-title', text: t.title || '(無題)' }),
        App.h('span', { class: 'task-meta', text: formatMeta(t) }),
      ]);
      row.addEventListener('click', () => openForm(t, { existingId: t.id }));
      return row;
    }

    function sayDueSoon(dueSoon) {
      const overdue = (dueSoon && dueSoon.overdue) || 0;
      const todayCount = (dueSoon && dueSoon.today) || 0;
      if (overdue > 0) {
        Hishoko.say('hurry', `期限切れが${overdue}件あります。今日中の締切は${todayCount}件です。`);
      } else if (todayCount > 0) {
        Hishoko.say('normal', `今日締切のタスクが${todayCount}件あります。`);
      } else {
        Hishoko.say('normal', '今日締切のタスクはありません。');
      }
    }

    async function refresh() {
      const { groups, dueSoon } = await window.hishoko.taskList();
      sayDueSoon(dueSoon);

      while (listHost.firstChild) listHost.removeChild(listHost.firstChild);

      let any = false;
      GROUPS.forEach(([key, label]) => {
        const items = groups[key] || [];
        if (!items.length) return;
        any = true;
        listHost.appendChild(App.h('div', { class: 'task-group-heading', text: `● ${label} (${items.length})` }));
        items.forEach((t) => listHost.appendChild(renderRow(t, key)));
      });

      const doneItems = groups.done || [];
      if (doneItems.length) {
        any = true;
        const toggle = App.h('div', {
          class: 'task-group-heading task-group-toggle',
          text: `${doneOpen ? '∨' : '>'} 完了したもの (${doneItems.length})`,
        });
        toggle.addEventListener('click', () => {
          doneOpen = !doneOpen;
          refresh();
        });
        listHost.appendChild(toggle);
        if (doneOpen) doneItems.forEach((t) => listHost.appendChild(renderRow(t, 'done')));
      }

      if (!any) {
        listHost.appendChild(App.h('div', { class: 'status', text: 'タスクはまだありません。上の欄から追加してください。' }));
      }
    }

    await refresh();
  },
};
