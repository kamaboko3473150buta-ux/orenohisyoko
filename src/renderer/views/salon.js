// src/renderer/views/salon.js
// 美容室。秘書子の髪型・髪色を変える。
//
// 見た目を1つ足すには12枚の絵が要る（丸枠7・トップページ2・息抜き3）。
// 手作業で作るものなので、**そろっていない見た目も選べる**ようにしてある。
// 足りない絵は既定の見た目（ボブ）に落ちるだけで、画面は壊れない（look.js）。
window.Views = window.Views || {};

Views.salon = {
  async render(root) {
    App.setTitle('美容室');

    const meta = await window.hishoko.appearanceList();
    const settings = await window.hishoko.getSettings();
    const current = settings.appearance || {};

    let picked = {
      hairStyle: current.hairStyle || 'bob',
      hairColor: current.hairColor || 'brown',
    };

    // 選んだ見た目の丸枠を、そのまま見本として出す。
    // 保存する前に、どんな顔になるのかが分かるようにする。
    const preview = App.h('div', { class: 'salon-preview' });
    const previewImgs = {};
    meta.expressions.forEach((key) => {
      const img = App.h('img', { class: 'salon-face', alt: key });
      previewImgs[key] = img;
      preview.appendChild(App.h('div', { class: 'salon-face-box' }, [img]));
    });

    function paintPreview() {
      // 見本だけ一時的にその見た目に切り替えて描き、すぐ元に戻す。
      // 変えっぱなしにすると、保存していないのに右下の秘書子まで変わってしまう。
      const before = Look.folder();
      Look.set(picked);
      meta.expressions.forEach((key) => Look.setImage(previewImgs[key], 'hishoko', key));
      Look.setFolder(before);
    }

    // 髪型・髪色の選び方。どちらも同じ形の並びにする。
    function buildChoices(items, key) {
      const host = App.h('div', { class: 'salon-choices' });
      items.forEach((item) => {
        const chip = App.h('button', {
          class: `salon-chip${picked[key] === item.id ? ' active' : ''}`,
          type: 'button',
          title: item.note || '',
          text: item.label,
          onclick: () => {
            picked[key] = item.id;
            Array.from(host.children).forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            paintPreview();
          },
        });
        host.appendChild(chip);
      });
      return host;
    }

    const saveBtn = App.h('button', { text: 'この髪型にする' });
    const status = App.h('div', { class: 'status' });

    saveBtn.addEventListener('click', async () => {
      await window.hishoko.saveSettings({ appearance: picked });
      // 保存できてから初めて、画面全体の見た目を切り替える。
      Look.set(picked);
      Look.setFraming(meta.framing);   // 卓の置き方も見た目ごとに違う
      Hishoko.say('smile', 'こんな感じでしょうか。似合っていますか?');
      App.toast('髪型を変えました');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '髪型' }),
        buildChoices(meta.styles, 'hairStyle'),
      ]),
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '髪色' }),
        buildChoices(meta.colors, 'hairColor'),
        App.h('div', {
          class: 'status',
          text: '髪色は今のところ1色だけです。色ちがいの絵ができたら増やせます。',
        }),
      ]),
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '見本' }),
        preview,
        App.h('div', {
          class: 'status',
          text: '左から 微笑・笑顔・真剣・困り顔・怒り顔・照れ顔・ムッとした顔。'
            + 'まだ絵の無い見た目は、今の髪型のまま出ます。',
        }),
      ]),
      App.h('div', { class: 'actions' }, [saveBtn]),
      status,
    ]));

    paintPreview();
    Hishoko.say('normal', '髪型を選んでください。見本で確かめてから決められます。');
  },
};
