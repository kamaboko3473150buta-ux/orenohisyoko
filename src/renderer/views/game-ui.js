// src/renderer/views/game-ui.js
// ミニゲームの「卓」まわりの部品。3つのゲームで共通に使う。
//
// ねらいは、画面の中に机が一つあって、その上で札が動いて見えること。
// 見た目だけの担当で、ルールは games/*.js、進行は views/game-*.js が持つ。
window.GameUI = (function () {
  // 位置や傾きを「毎回同じだがバラついて見える」ようにする種。
  // Math.random だと描き直すたびに札が飛び跳ねてしまうので、番号から決める。
  function jitter(index, salt) {
    const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  // 秘書子が向かいに座っている卓。上半分は写真、その下に天板を継ぎ足す。
  // 写真の天板だけでは24枚を並べる高さが足りないため。
  //
  // 写真は3枚あり、勝敗で丸ごと差し替える（同じ部屋・同じ構図で描いてもらった）。
  //   idle … ふだん   sulk … 秘書子が負けて悔しい   joy … 秘書子が勝って嬉しい
  // 3枚は「天板が木目だけになる行」の位置が違うので、拡大率と上の切り落とし量を
  // 1枚ずつ実測して styles.css に持たせている（.scene-photo.idle など）。
  // 写真を差し替えたら測り直すこと。
  const MOODS = ['idle', 'sulk', 'joy'];

  function scene(opts = {}) {
    const bubbleText = App.h('p', {});
    const bubble = App.h('div', { class: 'scene-bubble' }, [bubbleText]);
    bubble.hidden = true;

    // 3枚とも最初に読み込んでおき、表示だけを切り替える。
    // 勝敗が決まってから読みに行くと、一瞬なにも出ない時間ができてしまう。
    // index.html（src/renderer/）から見て assets/ はリポジトリ直下にある。
    const photos = {};
    const figure = App.h('div', { class: 'scene-figure' });
    for (const mood of MOODS) {
      const img = App.h('img', { class: `scene-photo ${mood}`, src: `../../assets/games/scene-${mood}.jpg`, alt: '' });
      img.hidden = mood !== 'idle';
      photos[mood] = img;
      figure.appendChild(img);
    }
    figure.appendChild(bubble);

    const table = App.h('div', { class: 'scene-table' });
    const el = App.h('div', { class: `scene mood-idle${opts.wide ? ' scene-wide' : ''}` }, [figure, table]);

    return {
      el,
      table,
      say(text) {
        bubbleText.textContent = text || '';
        bubble.hidden = !text;
      },
      // mood('sulk') で悔しい顔、mood('joy') で嬉しい顔、mood() でふだんに戻す。
      // 天板の色も写真ごとに変わるので、el のクラスで切り替える。
      mood(kind) {
        const next = MOODS.includes(kind) ? kind : 'idle';
        for (const m of MOODS) photos[m].hidden = m !== next;
        for (const m of MOODS) el.classList.toggle(`mood-${m}`, m === next);
      },
    };
  }

  // 卓が画面に入りきらないとき、**写真を切らずに卓ごと小さくする**。
  //
  // 以前は卓に max-height を掛けて写真の窓を縮めていたが、それだと画面が低い環境で
  // 秘書子の首から上が切れてしまった（実機で発生）。写真の構図は動かさず、
  // 卓の幅を詰めて全体を縮めるほうが、絵としても札の見やすさとしても素直。
  //
  // 幅を詰めると写真の高さ（幅の .545 倍）もそのぶん減るので、数回で収まる。
  // --scale は札の大きさに掛かる（styles.css 側で calc に入れてある）。
  const FIT_MIN_SCALE = 0.55;   // これ以上は小さくしない（札が読めなくなる）
  const FIT_RESERVE = 62;       // 卓の下に要る高さ（ボタン列＋下余白）

  function fitScene(el) {
    if (!el) return;
    const baseWidth = el.getBoundingClientRect().width;
    if (!baseWidth) return;

    function apply() {
      if (!el.isConnected) {
        window.removeEventListener('resize', apply);
        return;
      }
      el.style.width = '';
      el.style.removeProperty('--scale');
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - FIT_RESERVE - 2;   // 端数で1pxはみ出すのを防ぐ
      const full = el.getBoundingClientRect().width;
      let width = full;
      for (let i = 0; i < 5; i += 1) {
        const height = el.getBoundingClientRect().height;
        if (height <= avail) break;
        const next = Math.floor(width * (avail / height));
        width = Math.max(Math.round(full * FIT_MIN_SCALE), next);
        el.style.width = `${width}px`;
        el.style.setProperty('--scale', (width / full).toFixed(3));
        if (width <= full * FIT_MIN_SCALE) break;
      }
    }

    apply();
    window.addEventListener('resize', apply);
  }

  // 卓の上に置く一言（手番や勝敗）。ディーラーの声のつもり。
  function note(text = '') {
    return App.h('div', { class: 'table-note', text });
  }

  function corner(rank, suit) {
    return App.h('span', { class: 'pcorner' }, [
      App.h('span', { class: 'pcorner-rank', text: rank }),
      App.h('span', { class: 'pcorner-suit', text: suit }),
    ]);
  }

  // 札の表。隅に数字とマーク、中央に大きなマーク。
  function front(card) {
    const cls = ['pface', 'pface-front'];
    if (Cards.isJoker(card)) cls.push('joker');
    else if (Cards.isRed(card)) cls.push('red');
    const face = App.h('span', { class: cls.join(' ') });
    if (!card) return face;
    if (Cards.isJoker(card)) {
      // 中央は★と小さな JOKER の2段。縦書きにすると小さい札で文字が切れる。
      face.appendChild(corner('JK', '★'));
      face.appendChild(App.h('span', { class: 'ppip ppip-joker' }, [
        App.h('span', { class: 'ppip-star', text: '★' }),
        App.h('span', { class: 'ppip-word', text: 'JOKER' }),
      ]));
      face.appendChild(corner('JK', '★'));
      return face;
    }
    face.appendChild(corner(card.rank, card.suit));
    face.appendChild(App.h('span', { class: 'ppip', text: card.suit }));
    face.appendChild(corner(card.rank, card.suit));
    return face;
  }

  // 1枚の札。faceUp で表裏、onClick があれば押せる札になる。
  // tilt を渡すと少し傾けて置く（きっちり揃っていると盤面が硬く見える）。
  function cardEl(card, opts = {}) {
    const tag = opts.onClick ? 'button' : 'div';
    const props = { class: `pcard${opts.faceUp ? ' is-up' : ''}${opts.extraClass ? ` ${opts.extraClass}` : ''}` };
    if (tag === 'button') {
      props.type = 'button';
      props.onclick = opts.onClick;
    }
    if (opts.disabled) props.disabled = true;
    const el = App.h(tag, props, [
      App.h('span', { class: 'pcard-inner' }, [
        App.h('span', { class: 'pface pface-back' }),
        front(card),
      ]),
    ]);
    if (Number.isFinite(opts.tilt) && opts.tilt !== 0) {
      el.style.setProperty('--tilt', `${opts.tilt}deg`);
    }
    return el;
  }

  // 札が無くなった場所（上がった手や、取り終えた枠）。へこみだけを残す。
  function emptySlot(label) {
    return App.h('div', { class: 'pslot' }, label ? [App.h('span', { text: label })] : []);
  }

  // 取った札の山。実際に重ねて置く（数字だけより、取った量が目で分かる）。
  function pile(label, count) {
    const stack = App.h('div', { class: 'pile-stack' });
    for (let i = 0; i < Math.min(count, 8); i += 1) {
      const chip = App.h('span', { class: 'pile-chip' });
      chip.style.setProperty('--i', String(i));
      chip.style.setProperty('--nudge', `${(jitter(i, 3) - 0.5) * 4}px`);
      stack.appendChild(chip);
    }
    return App.h('div', { class: 'pile' }, [
      stack,
      App.h('div', { class: 'pile-label', text: `${label} ${count}組` }),
    ]);
  }

  // ゼムクリップ1個。机にばらまいた感じを出すため、番号ごとに傾きと位置をずらす。
  const CLIP_SVG = '<svg viewBox="0 0 28 52" aria-hidden="true">'
    + '<path d="M8 42 V13 A6 6 0 0 1 20 13 V36 A4.5 4.5 0 0 1 11 36 V17"'
    + ' fill="none" stroke="#8d979c" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M8 42 V13 A6 6 0 0 1 20 13 V36 A4.5 4.5 0 0 1 11 36 V17"'
    + ' fill="none" stroke="#dfe5e8" stroke-width="1.1" stroke-linecap="round"/>'
    + '</svg>';

  function clipEl(index) {
    const el = App.h('span', { class: 'clip' });
    el.innerHTML = CLIP_SVG;
    el.style.setProperty('--rot', `${(jitter(index, 1) - 0.5) * 70}deg`);
    el.style.setProperty('--dx', `${(jitter(index, 2) - 0.5) * 10}px`);
    el.style.setProperty('--dy', `${(jitter(index, 5) - 0.5) * 18}px`);
    return el;
  }

  return { scene, fitScene, note, cardEl, emptySlot, pile, clipEl, jitter };
}());
