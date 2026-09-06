// src/renderer/views/compose.js
window.Views = window.Views || {};

Views.compose = {
  async render(root) {
    App.setTitle('メール文面作成');
    const meta = await window.hishoko.mailMeta();
    const settings = await window.hishoko.getSettings();
    const book = await window.hishoko.bookGet();
    const modelMeta = await window.hishoko.modelsList();

    // 前回の入力があれば引き継ぐ（プレビューから戻ってきたとき）
    const f = App.state.form || {
      sceneId: 'thanks',
      toneId: settings.defaultTone,
      mailer: settings.defaultMailer,
      model: settings.models.mail, // その回だけの上書き。設定は書き換えない
      recipients: [], // { company, department, name, honorific, email, field: 'to'|'cc'|'bcc' } の配列
      subject: '',
      memo: '',
    };
    App.state.form = f;

    // ① 場面
    const chips = App.h('div', { class: 'chips' });
    meta.scenes.forEach((s) => {
      const chip = App.h('button', {
        class: `chip${f.sceneId === s.id ? ' selected' : ''}`,
        text: s.label,
        onclick: () => {
          f.sceneId = s.id;
          chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
          chip.classList.add('selected');
        },
      });
      chips.appendChild(chip);
    });
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '① 場面を選ぶ' }), chips]),
    ]));

    // ② 宛先
    function sameEmail(a, b) {
      return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    const mkLabel = (text, hint) => {
      const lab = App.h('label', { text });
      if (hint) lab.appendChild(App.h('span', { class: 'hint', text: hint }));
      return lab;
    };

    // 選んだ相手をchipへ追加する。メールアドレスが空、またはすでに追加済みなら何もしない。
    function addRecipient(entry) {
      const email = String((entry && entry.email) || '').trim();
      if (!email) return false;
      if (f.recipients.some((r) => sameEmail(r.email, email))) return false;
      f.recipients.push({
        company: (entry && entry.company) || '',
        department: (entry && entry.department) || '',
        name: (entry && entry.name) || '',
        honorific: (entry && entry.honorific) || '',
        email,
        field: (entry && entry.field) || 'to',
      });
      return true;
    }

    const chipsHost = App.h('div', { class: 'chips' });
    function renderChips() {
      while (chipsHost.firstChild) chipsHost.removeChild(chipsHost.firstChild);
      if (!f.recipients.length) {
        chipsHost.appendChild(App.h('div', { class: 'status', text: '宛先がまだ選ばれていません。' }));
        return;
      }
      f.recipients.forEach((r, i) => {
        const label = [r.company, r.name, r.email].filter(Boolean).join(' / ') || r.email;

        const fieldSelect = App.h('select');
        [['to', 'To'], ['cc', 'CC'], ['bcc', 'BCC']].forEach(([v, l]) => {
          const opt = App.h('option', { value: v, text: l });
          if ((r.field || 'to') === v) opt.selected = true;
          fieldSelect.appendChild(opt);
        });
        fieldSelect.addEventListener('change', () => { r.field = fieldSelect.value; });

        const removeBtn = App.h('button', { class: 'chip-remove', text: '×' });
        removeBtn.addEventListener('click', () => {
          f.recipients.splice(i, 1);
          renderChips();
        });

        chipsHost.appendChild(App.h('div', { class: 'chip recipient-chip' }, [
          App.h('span', { text: label }),
          fieldSelect,
          removeBtn,
        ]));
      });
    }

    // 「アドレス帳から選ぶ」パネル（連絡先・グループをチェックボックスで複数選択）
    const pickerHost = App.h('div', { class: 'card', hidden: true });
    const contactChecks = new Map();
    const groupChecks = new Map();

    const contactsWrap = App.h('div', { class: 'chips' });
    book.contacts.forEach((c) => {
      const cbId = `pick-c-${c.id}`;
      const cb = App.h('input', { type: 'checkbox', id: cbId });
      contactChecks.set(c.id, cb);
      const label = App.h('label', { for: cbId, text: [c.company, c.name, c.email].filter(Boolean).join(' / ') });
      contactsWrap.appendChild(App.h('span', {}, [cb, label]));
    });

    const groupsWrap = App.h('div', { class: 'chips' });
    book.groups.forEach((g) => {
      const cbId = `pick-g-${g.id}`;
      const cb = App.h('input', { type: 'checkbox', id: cbId });
      groupChecks.set(g.id, cb);
      const label = App.h('label', { for: cbId, text: `${g.name}（${(g.memberIds || []).length}人）` });
      groupsWrap.appendChild(App.h('span', {}, [cb, label]));
    });

    const applyPickBtn = App.h('button', { text: '選択した相手を追加' });
    applyPickBtn.addEventListener('click', () => {
      book.contacts.forEach((c) => {
        const cb = contactChecks.get(c.id);
        if (cb && cb.checked) addRecipient({ ...c, field: 'to' });
      });
      book.groups.forEach((g) => {
        const cb = groupChecks.get(g.id);
        if (!cb || !cb.checked) return;
        (g.memberIds || []).forEach((mid) => {
          const member = book.contacts.find((c) => c.id === mid);
          if (member) addRecipient({ ...member, field: 'to' });
        });
      });
      pickerHost.hidden = true;
      renderChips();
    });

    pickerHost.appendChild(App.h('h2', { text: 'アドレス帳から選ぶ' }));
    if (book.contacts.length) {
      pickerHost.appendChild(App.h('div', { class: 'field' }, [App.h('label', { text: '連絡先' }), contactsWrap]));
    }
    if (book.groups.length) {
      pickerHost.appendChild(App.h('div', { class: 'field' }, [mkLabel('グループ', '選ぶとメンバー全員が一括で入ります'), groupsWrap]));
    }
    if (!book.contacts.length && !book.groups.length) {
      pickerHost.appendChild(App.h('div', { class: 'status', text: 'アドレス帳にまだ連絡先がありません。' }));
    }
    pickerHost.appendChild(App.h('div', { class: 'actions' }, [applyPickBtn]));

    const pickerToggleBtn = App.h('button', { class: 'secondary', text: 'アドレス帳から選ぶ' });
    pickerToggleBtn.addEventListener('click', () => { pickerHost.hidden = !pickerHost.hidden; });

    // アドレス帳に無い相手のための直接入力欄
    const directCompany = App.h('input', { type: 'text' });
    const directDept = App.h('input', { type: 'text' });
    const directName = App.h('input', { type: 'text' });
    const directEmail = App.h('input', { type: 'email' });
    const directHonorific = App.h('select');
    [['様', '様'], ['御中', '御中'], ['先生', '先生'], ['', '敬称なし']].forEach(([v, label]) => {
      const opt = App.h('option', { value: v, text: label });
      if (v === '様') opt.selected = true;
      directHonorific.appendChild(opt);
    });
    const directAddBtn = App.h('button', { class: 'secondary', text: '追加' });
    const directErrorEl = App.h('div', { class: 'error', hidden: true });

    directAddBtn.addEventListener('click', () => {
      const email = directEmail.value.trim();
      directEmail.classList.toggle('invalid', !email);
      if (!email) {
        directErrorEl.textContent = 'メールアドレスを入力してください。';
        directErrorEl.hidden = false;
        return;
      }
      const added = addRecipient({
        company: directCompany.value.trim(),
        department: directDept.value.trim(),
        name: directName.value.trim(),
        honorific: directHonorific.value,
        email,
        field: 'to',
      });
      if (!added) {
        directErrorEl.textContent = 'すでに追加されているメールアドレスです。';
        directErrorEl.hidden = false;
        return;
      }
      directErrorEl.hidden = true;
      directEmail.classList.remove('invalid');
      directCompany.value = '';
      directDept.value = '';
      directName.value = '';
      directEmail.value = '';
      directHonorific.value = '様';
      renderChips();
    });

    renderChips();

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '② 宛先' }), chipsHost]),
      App.h('div', { class: 'actions' }, [pickerToggleBtn]),
    ]));
    root.appendChild(pickerHost);
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: 'アドレス帳に無い相手を直接入力' })]),
      App.h('div', { class: 'row' }, [
        App.h('div', { class: 'field' }, [mkLabel('会社名', '任意'), directCompany]),
        App.h('div', { class: 'field' }, [mkLabel('部署', '任意'), directDept]),
      ]),
      App.h('div', { class: 'row' }, [
        App.h('div', { class: 'field' }, [App.h('label', { text: '氏名' }), directName]),
        App.h('div', { class: 'field' }, [App.h('label', { text: '敬称' }), directHonorific]),
      ]),
      App.h('div', { class: 'row' }, [
        App.h('div', { class: 'field' }, [App.h('label', { text: 'メールアドレス' }), directEmail]),
      ]),
      directErrorEl,
      App.h('div', { class: 'actions' }, [directAddBtn]),
    ]));

    // ③④⑤⑥
    const subject = App.h('input', { type: 'text', value: f.subject });
    subject.addEventListener('input', () => { f.subject = subject.value; });
    const memo = App.h('textarea', {});
    memo.value = f.memo;
    memo.addEventListener('input', () => { f.memo = memo.value; });

    const tone = App.h('select');
    meta.tones.forEach((t) => {
      const opt = App.h('option', { value: t.id, text: t.label });
      if (f.toneId === t.id) opt.selected = true;
      tone.appendChild(opt);
    });
    tone.addEventListener('change', () => { f.toneId = tone.value; });

    const mailer = App.h('select');
    [['outlook', 'Outlook'], ['gmail', 'Gmail']].forEach(([v, label]) => {
      const opt = App.h('option', { value: v, text: label });
      if (f.mailer === v) opt.selected = true;
      mailer.appendChild(opt);
    });
    mailer.addEventListener('change', () => { f.mailer = mailer.value; });

    // モデル選択（その回だけの上書き。初期値は設定の既定で、選んでも設定自体は変わらない）
    const modelSelect = App.h('select');
    modelMeta.models.forEach((m) => {
      const opt = App.h('option', { value: m.id, text: m.label });
      if (f.model === m.id) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    modelSelect.addEventListener('change', () => { f.model = modelSelect.value; });

    const errorEl = App.h('div', { class: 'error', hidden: true });
    const submit = App.h('button', { text: '文面を作成する' });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '③ 件名' }), subject]),
      App.h('div', { class: 'field' }, [App.h('label', { text: '④ 一言メモ（何を伝えたいか）' }), memo]),
      App.h('div', { class: 'row' }, [
        App.h('div', { class: 'field' }, [App.h('label', { text: '⑤ 文体' }), tone]),
        App.h('div', { class: 'field' }, [App.h('label', { text: '⑥ 送信先' }), mailer]),
      ]),
      errorEl,
      App.h('div', { class: 'actions' }, [
        App.h('div', { class: 'model-inline' }, [App.h('span', { text: 'モデル' }), modelSelect]),
        submit,
      ]),
    ]));

    submit.addEventListener('click', async () => {
      // 入力チェック（APIを呼ぶ前に）
      const missing = [];
      if (!f.recipients.some((r) => r.field === 'to')) missing.push('宛先（Toを1件以上）');
      [[subject, f.subject, '件名'], [memo, f.memo, '一言メモ']].forEach(([el, value, label]) => {
        const empty = !String(value || '').trim();
        el.classList.toggle('invalid', empty);
        if (empty) missing.push(label);
      });
      if (missing.length) {
        errorEl.textContent = `${missing.join('・')}を入力してください。`;
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      submit.disabled = true;
      submit.textContent = '作成中…（10秒ほどかかります）';
      Hishoko.say('thinking', '文面を考えています…');

      const res = await window.hishoko.mailGenerate({
        sceneId: f.sceneId, toneId: f.toneId, recipients: f.recipients,
        subject: f.subject, memo: f.memo, model: f.model,
      });

      submit.disabled = false;
      submit.textContent = '文面を作成する';

      if (!res.ok) {
        errorEl.textContent = res.message;
        errorEl.hidden = false;
        Hishoko.say('trouble', res.message);
        if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
        return;
      }

      const byField = (field) => f.recipients.filter((r) => r.field === field).map((r) => r.email);
      App.state.result = {
        subject: f.subject,
        body: res.body,
        to: byField('to'),
        cc: byField('cc'),
        bcc: byField('bcc'),
        mailer: f.mailer,
      };
      // 戻るときは入力画面に帰れるようにする（プレビューから直せないと困るため）
      App.state.previewFrom = 'compose';
      App.go('preview');
    });
  },
};
