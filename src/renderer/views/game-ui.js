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

  // 秘書子が向かいに座っている卓。上半分は写真（オフィスと秘書子）、
  // その下に天板を継ぎ足して、そこがゲームの場所になる。
  // 写真の天板は下1/3しかなく、札を並べる幅が足りないため、
  // 木目のつづきをCSSで描いて伸ばしている（継ぎ目の色は写真から採った）。
  //
  // 返り値の table に札や駒を入れる。say() で秘書子が一言しゃべる。
  function scene(opts = {}) {
    const bubbleText = App.h('p', {});
    const bubble = App.h('div', { class: 'scene-bubble' }, [bubbleText]);
    bubble.hidden = true;

    // index.html（src/renderer/）から見て assets/ はリポジトリ直下にある。
    const figure = App.h('div', { class: 'scene-figure' }, [bubble]);
    const table = App.h('div', { class: 'scene-table' });
    const el = App.h('div', { class: `scene${opts.wide ? ' scene-wide' : ''}` }, [figure, table]);

    return {
      el,
      table,
      say(text) {
        bubbleText.textContent = text || '';
        bubble.hidden = !text;
      },
    };
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
      face.appendChild(corner('JK', '★'));
      face.appendChild(App.h('span', { class: 'ppip ppip-joker', text: 'JOKER' }));
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

  return { scene, note, cardEl, emptySlot, pile, clipEl, jitter };
}());
