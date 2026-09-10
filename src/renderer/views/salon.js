// src/renderer/views/salon.js
// 美容室。秘書子の髪型・髪色・肌の色を変える。
//
// **髪型は絵が要るが、色は要らない。**
// 色は絵1枚につき用意した範囲（マスク）の色相を、描くときにずらしているだけなので、
// 何色でも増やせる（scripts/make-masks.js と tint.js）。
// だから髪型は「用意した分だけ」、色は「自由に」という作りになっている。
//
// 髪型を1つ足すには12枚の絵が要る（丸枠7・トップページ2・息抜き3）。
// 足りない絵は既定の見た目（ボブ）に落ちるだけで、画面は壊れない（look.js）。
window.Views = window.Views || {};

Views.salon = {
  async render(root) {
    App.setTitle('美容室');

    const meta = await window.hishoko.appearanceList();
    const settings = await window.hishoko.getSettings();
    const current = settings.appearance || {};

    const picked = {
      hairStyle: current.hairStyle || 'bob',
      hairColor: current.hairColor || '',
      skinColor: current.skinColor || '',
    };

    // 選んだ見た目の丸枠を見本として出す。保存する前に確かめられるようにする。
    const preview = App.h('div', { class: 'salon-preview' });
    const previewImgs = {};
    meta.expressions.forEach((key) => {
      const img = App.h('img', { class: 'salon-face', alt: key });
      previewImgs[key] = img;
      preview.appendChild(App.h('div', { class: 'salon-face-box' }, [img]));
    });

    let paintTimer = null;
    function paintPreview() {
      // 見本だけ一時的にその見た目に切り替えて描き、すぐ元に戻す。
      // 変えっぱなしにすると、保存していないのに右下の秘書子まで変わってしまう。
      const beforeFolder = Look.folder();
      const beforeColors = Look.colors();
      Look.set(picked);
      Look.setColors({ hair: picked.hairColor, skin: picked.skinColor });
      meta.expressions.forEach((key) => Look.setImage(previewImgs[key], 'hishoko', key));
      Look.setFolder(beforeFolder);
      Look.setColors(beforeColors);
    }

    // カラーピッカーは動かすたびに色が変わる。毎回7枚描き直すと重いので少し待つ。
    function paintSoon() {
      clearTimeout(paintTimer);
      paintTimer = setTimeout(paintPreview, 120);
    }

    // 髪型の選び方（用意した絵の分だけ）
    function buildStyles() {
      const host = App.h('div', { class: 'salon-choices' });
      meta.styles.forEach((item) => {
        const chip = App.h('button', {
          class: `salon-chip${picked.hairStyle === item.id ? ' active' : ''}`,
          type: 'button',
          title: item.note || '',
          text: item.label,
          onclick: () => {
            picked.hairStyle = item.id;
            Array.from(host.children).forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            paintPreview();
          },
        });
        host.appendChild(chip);
      });
      return host;
    }

    // 色の選び方。見本の色と、自由に選べるカラーピッカーの両方を出す。
    function buildColors(list, key) {
      const swatches = App.h('div', { class: 'salon-choices' });
      const input = App.h('input', { type: 'color', class: 'salon-picker' });
      input.value = picked[key] || '#6b4a35';

      function markActive() {
        Array.from(swatches.children).forEach((c) => {
          c.classList.toggle('active', c.dataset.hex === (picked[key] || ''));
        });
      }

      (list || []).forEach((item) => {
        const chip = App.h('button', {
          class: 'salon-swatch',
          type: 'button',
          title: item.label,
          text: item.hex ? '' : 'そのまま',
          onclick: () => {
            picked[key] = item.hex;
            if (item.hex) input.value = item.hex;
            markActive();
            paintPreview();
          },
        });
        chip.dataset.hex = item.hex;
        if (item.hex) chip.style.background = item.hex;
        else chip.classList.add('salon-swatch-none');
        swatches.appendChild(chip);
      });
      markActive();

      input.addEventListener('input', () => {
        picked[key] = input.value;
        markActive();
        paintSoon();
      });

      return App.h('div', {}, [
        swatches,
        App.h('div', { class: 'salon-picker-row' }, [
          App.h('span', { class: 'status', text: '好きな色:' }),
          input,
        ]),
      ]);
    }

    const saveBtn = App.h('button', { text: 'この見た目にする' });

    saveBtn.addEventListener('click', async () => {
      await window.hishoko.saveSettings({ appearance: picked });
      // 保存できてから初めて、画面全体の見た目を切り替える。
      Look.set(picked);
      Look.setColors({ hair: picked.hairColor, skin: picked.skinColor });
      Look.setFraming(meta.framing);
      Hishoko.say('smile', 'こんな感じでしょうか。似合っていますか?');
      App.toast('見た目を変えました');
    });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '髪型' }),
        buildStyles(),
        App.h('div', {
          class: 'status',
          text: '髪型は絵を用意した分だけ選べます。まだ絵の無いものは今の髪型のまま出ます。',
        }),
      ]),
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '髪色' }),
        buildColors(meta.colors, 'hairColor'),
        App.h('div', {
          class: 'status',
          text: '色は絵を用意しなくても変えられます（描くときに色相をずらしています）。'
            + '艶と陰影はそのまま残り、眉毛も髪色に合わせて変わります。',
        }),
      ]),
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '肌の色' }),
        buildColors(meta.skinColors, 'skinColor'),
      ]),
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '見本' }),
        preview,
        App.h('div', {
          class: 'status',
          text: '左から 微笑・笑顔・真剣・困り顔・怒り顔・照れ顔・ムッとした顔。',
        }),
      ]),
      App.h('div', { class: 'actions' }, [saveBtn]),
    ]));

    paintPreview();
    Hishoko.say('normal', '髪型と色を選んでください。見本で確かめてから決められます。');
  },
};
