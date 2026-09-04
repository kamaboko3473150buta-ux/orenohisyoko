// src/renderer/views/compose.js
window.Views = window.Views || {};

Views.compose = {
  async render(root) {
    App.setTitle('メール文面作成');
    const meta = await window.hishoko.mailMeta();
    const settings = await window.hishoko.getSettings();
    const contacts = await window.hishoko.mailContacts();

    // 前回の入力があれば引き継ぐ（プレビューから戻ってきたとき）
    const f = App.state.form || {
      sceneId: 'thanks',
      toneId: settings.defaultTone,
      mailer: settings.defaultMailer,
      recipient: { company: '', department: '', name: '', honorific: '様', email: '' },
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
    const mkInput = (key, label, hint, type = 'text') => {
      const input = App.h('input', { type, value: f.recipient[key] || '' });
      input.addEventListener('input', () => { f.recipient[key] = input.value; });
      const lab = App.h('label', { text: label });
      if (hint) lab.appendChild(App.h('span', { class: 'hint', text: hint }));
      return { wrap: App.h('div', { class: 'field' }, [lab, input]), input };
    };
    const company = mkInput('company', '会社名', '任意');
    const dept = mkInput('department', '部署', '任意');
    const name = mkInput('name', '氏名', '');
    const email = mkInput('email', 'メールアドレス', '', 'email');

    const honorific = App.h('select');
    [['様', '様'], ['御中', '御中'], ['先生', '先生'], ['', '敬称なし']].forEach(([v, label]) => {
      const opt = App.h('option', { value: v, text: label });
      if (f.recipient.honorific === v) opt.selected = true;
      honorific.appendChild(opt);
    });
    honorific.addEventListener('change', () => { f.recipient.honorific = honorific.value; });

    // 履歴から選ぶ
    const picker = App.h('select');
    picker.appendChild(App.h('option', { value: '', text: '― 履歴から選ぶ ―' }));
    contacts.forEach((c, i) => {
      const label = [c.company, c.name, c.email].filter(Boolean).join(' / ');
      picker.appendChild(App.h('option', { value: String(i), text: label }));
    });
    picker.addEventListener('change', () => {
      const c = contacts[Number(picker.value)];
      if (!c) return;
      Object.assign(f.recipient, {
        company: c.company || '', department: c.department || '',
        name: c.name || '', honorific: c.honorific || '様', email: c.email || '',
      });
      company.input.value = f.recipient.company;
      dept.input.value = f.recipient.department;
      name.input.value = f.recipient.name;
      email.input.value = f.recipient.email;
      honorific.value = f.recipient.honorific;
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [App.h('label', { text: '② 宛先' })]),
      App.h('div', { class: 'row' }, [company.wrap, dept.wrap]),
      App.h('div', { class: 'row' }, [name.wrap, App.h('div', { class: 'field' }, [App.h('label', { text: '敬称' }), honorific])]),
      email.wrap,
      contacts.length ? App.h('div', { class: 'field' }, [picker]) : null,
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
      App.h('div', { class: 'actions' }, [submit]),
    ]));

    submit.addEventListener('click', async () => {
      // 入力チェック（APIを呼ぶ前に）
      const missing = [];
      [[email.input, f.recipient.email, 'メールアドレス'], [subject, f.subject, '件名'], [memo, f.memo, '一言メモ']]
        .forEach(([el, value, label]) => {
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

      const res = await window.hishoko.mailGenerate({
        sceneId: f.sceneId, toneId: f.toneId, recipient: f.recipient,
        subject: f.subject, memo: f.memo,
      });

      submit.disabled = false;
      submit.textContent = '文面を作成する';

      if (!res.ok) {
        errorEl.textContent = res.message;
        errorEl.hidden = false;
        if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
        return;
      }
      App.state.result = { subject: f.subject, body: res.body, to: f.recipient.email, mailer: f.mailer };
      App.go('preview');
    });
  },
};
