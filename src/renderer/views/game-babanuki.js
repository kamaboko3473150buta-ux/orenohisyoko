// src/renderer/views/game-babanuki.js
// ババ抜きの最終局面。ルールは games/babanuki.js、ここは画面だけ。
window.Views = window.Views || {};

// 秘書子のクセのセリフ。tell.claim（この札がジョーカー／この札は安全）と
// 位置（左右）から作る。同じ言い回しが続かないよう、引いた回数でずらす。
const TELL_LINES = {
  joker: [
    (side) => `${side}のほうは……やめておいたほうがいいかもしれません。`,
    (side) => `あ、${side}。${side}はちょっと、まずいかも。`,
    (side) => `${side}を引かれると、私としては助かるんですけど……。`,
  ],
  safe: [
    (side) => `${side}のほうなら、たぶん大丈夫だと思いますよ。`,
    (side) => `私だったら${side}を選びます。たぶん。`,
    (side) => `${side}、いいと思います。ええ、いいと思います。`,
  ],
};

Views.gameBabanuki = {
  render(root) {
    App.setTitle('ババ抜き');

    const board = App.h('div', { class: 'game-board' });
    const statusEl = App.h('p', { class: 'game-status' });
    const actionRow = App.h('div', { class: 'game-actions' });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '🃏 ババ抜き（最後の1枚）' }),
      App.h('p', {
        text: '残り3枚の最終局面です。同じ数字の2枚が揃ったほうが上がり。ジョーカーが残ったら負けです。',
      }),
      board,
      statusEl,
      actionRow,
    ]));

    let state = null;
    let busy = false; // 秘書子が考えている間は触らせない

    function sideName(index) {
      return index === 0 ? '左' : '右';
    }

    function faceCard(card, extra = '') {
      const label = Cards.cardLabel(card);
      const tone = Cards.isJoker(card) ? ' joker' : (Cards.isRed(card) ? ' red' : '');
      return App.h('div', { class: `pcard${tone}${extra}` }, [App.h('span', { text: label })]);
    }

    function backCard(onclick) {
      const props = { class: 'pcard back', type: 'button' };
      if (onclick) props.onclick = onclick;
      else props.disabled = true;
      return App.h('button', props, [App.h('span', { text: '？' })]);
    }

    // その側がいま持っている札と、それを表向きに見せてよいか。
    // 決着後は両方とも見せる（上がった側は揃えた2枚、負けた側はジョーカー）。
    function handOf(side) {
      if (state.finished) {
        return { cards: state.winner === side ? state.wentOut : state.hand, faceUp: true };
      }
      if (state.holder === side) return { cards: state.hand, faceUp: side === 'you' };
      return { cards: [state.single], faceUp: side === 'you' };
    }

    function handRow(side, label) {
      const row = App.h('div', { class: 'game-hand' });
      row.appendChild(App.h('div', { class: 'game-hand-label', text: label }));
      const cards = App.h('div', { class: 'game-cards' });
      const { cards: mine, faceUp } = handOf(side);
      // あなたが引けるのは、秘書子が2枚持っていて、まだ決着していないときだけ
      const drawable = !state.finished && side === 'hishoko' && state.holder === 'hishoko';
      (mine || []).forEach((card, i) => {
        if (faceUp) cards.appendChild(faceCard(card));
        else cards.appendChild(backCard(drawable ? () => youDraw(i) : null));
      });
      if (!mine || mine.length === 0) {
        cards.appendChild(App.h('div', { class: 'game-hand-empty', text: '上がり' }));
      }
      row.appendChild(cards);
      return row;
    }

    function paint() {
      board.innerHTML = '';
      actionRow.innerHTML = '';
      if (!state) return;

      board.appendChild(handRow('hishoko', '秘書子'));
      board.appendChild(handRow('you', 'あなた'));

      if (state.finished) {
        const won = state.winner === 'you';
        statusEl.textContent = won
          ? `${Cards.cardLabel(state.drawn)} を引いて組が揃いました。あなたの勝ちです。`
          : '秘書子が先に上がりました。ジョーカーが残っています。';
        statusEl.className = `game-status ${won ? 'win' : 'lose'}`;
        actionRow.appendChild(App.h('button', { text: 'もう一勝負', onclick: newGame }));
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '息抜きに戻る', onclick: () => App.go('breaktime'),
        }));
        if (window.Hishoko) {
          Hishoko.say(won ? 'trouble' : 'praise',
            won ? 'やられました……もう一回、お願いします。' : 'いただきました。読み勝ちですね。');
        }
        return;
      }

      if (state.holder === 'hishoko') {
        statusEl.className = 'game-status';
        statusEl.textContent = '秘書子の2枚から1枚引いてください。';
        if (window.Hishoko && state.tell) {
          const lines = TELL_LINES[state.tell.claim];
          const line = lines[(state.draws + state.tell.index) % lines.length];
          Hishoko.say(state.tell.claim === 'joker' ? 'trouble' : 'smile', line(sideName(state.tell.index)));
        }
      } else {
        statusEl.className = 'game-status';
        statusEl.textContent = busy
          ? '秘書子が考えています……'
          : 'あなたの2枚から秘書子が引きます。並べ替えてから引かせましょう。';
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '⇄ 左右を入れ替える', disabled: busy,
          onclick: () => { state = Babanuki.swap(state); paint(); },
        }));
        actionRow.appendChild(App.h('button', {
          text: '引かせる', disabled: busy, onclick: hishokoDraw,
        }));
        if (window.Hishoko && !busy) Hishoko.say('normal', 'では、いただきますね。どちらにしましょう。');
      }
    }

    function finish() {
      Play.note(state.winner);
    }

    function youDraw(index) {
      if (busy || state.finished) return;
      state = Babanuki.draw(state, index, { rng: Math.random });
      if (state.finished) finish();
      paint();
    }

    function hishokoDraw() {
      if (busy || state.finished) return;
      busy = true;
      paint();
      Play.after(900, () => {
        state = Babanuki.draw(state, Babanuki.aiDraw(state), { rng: Math.random });
        busy = false;
        if (state.finished) finish();
        paint();
      });
    }

    function newGame() {
      busy = false;
      state = Babanuki.start({ rng: Math.random, tellAccuracy: Play.level().tellAccuracy });
      paint();
    }

    newGame();
  },
};
