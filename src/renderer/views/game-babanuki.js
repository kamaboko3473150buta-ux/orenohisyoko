// src/renderer/views/game-babanuki.js
// ババ抜きの最終局面。ルールは games/babanuki.js、卓の部品は views/game-ui.js。
// この画面は進行だけを持つ。
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

    const scene = GameUI.scene();
    const hishokoCards = App.h('div', { class: 'seat-cards' });
    const yourCards = App.h('div', { class: 'seat-cards' });
    const note = GameUI.note();
    const actionRow = App.h('div', { class: 'game-actions' });

    // 秘書子の手札は卓の向こう側（写真の手前）、あなたの手札は手前に置く。
    scene.table.appendChild(hishokoCards);
    scene.table.appendChild(App.h('div', { class: 'table-middle' }));
    scene.table.appendChild(yourCards);
    scene.table.appendChild(App.h('div', { class: 'seat-label', text: 'あなた' }));
    scene.table.appendChild(note);

    root.appendChild(App.h('p', { class: 'game-intro', text: '残り3枚の最終局面です。同じ数字の2枚が揃ったほうが上がり。ジョーカーが残ったら負けです。' }));
    root.appendChild(scene.el);
    root.appendChild(actionRow);

    let state = null;
    let busy = false; // 秘書子が考えている間は触らせない

    function sideName(index) {
      return index === 0 ? '左' : '右';
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

    function paintHand(host, side) {
      host.innerHTML = '';
      const { cards, faceUp } = handOf(side);
      // あなたが引けるのは、秘書子が2枚持っていて、まだ決着していないときだけ
      const drawable = !state.finished && side === 'hishoko' && state.holder === 'hishoko';
      (cards || []).forEach((card, i) => {
        host.appendChild(GameUI.cardEl(card, {
          faceUp,
          tilt: (GameUI.jitter(i + (side === 'you' ? 7 : 0), state.draws + 1) - 0.5) * 5,
          onClick: drawable && !busy ? () => youDraw(i) : null,
        }));
      });
      if (!cards || cards.length === 0) host.appendChild(GameUI.emptySlot('上がり'));
    }

    function paint() {
      actionRow.innerHTML = '';
      if (!state) return;
      paintHand(hishokoCards, 'hishoko');
      paintHand(yourCards, 'you');

      if (state.finished) {
        const won = state.winner === 'you';
        note.className = `table-note ${won ? 'win' : 'lose'}`;
        note.textContent = won
          ? `${Cards.cardLabel(state.drawn)} を引いて組が揃いました。あなたの勝ちです。`
          : '秘書子が先に上がりました。ジョーカーが残っています。';
        actionRow.appendChild(App.h('button', { text: 'もう一勝負', onclick: newGame }));
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '息抜きに戻る', onclick: () => App.go('breaktime'),
        }));
        scene.mood(won ? 'sulk' : 'joy');
        scene.say(won ? 'やられました……もう一回、お願いします。' : 'いただきました。読み勝ちですね。');
        return;
      }

      note.className = 'table-note';
      if (state.holder === 'hishoko') {
        note.textContent = '秘書子の2枚から1枚引いてください。';
        if (state.tell) {
          const lines = TELL_LINES[state.tell.claim];
          const line = lines[(state.draws + state.tell.index) % lines.length];
          scene.say(line(sideName(state.tell.index)));
        }
      } else {
        note.textContent = busy
          ? '秘書子が考えています……'
          : 'あなたの2枚から秘書子が引きます。並べ替えてから引かせましょう。';
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '⇄ 左右を入れ替える', disabled: busy,
          onclick: () => { state = Babanuki.swap(state); paint(); },
        }));
        actionRow.appendChild(App.h('button', {
          text: '引かせる', disabled: busy, onclick: hishokoDraw,
        }));
        scene.say(busy ? '……どちらにしましょう。' : 'では、いただきますね。');
      }
    }

    function youDraw(index) {
      if (busy || state.finished) return;
      state = Babanuki.draw(state, index, { rng: Math.random });
      if (state.finished) Play.note(state.winner);
      paint();
    }

    function hishokoDraw() {
      if (busy || state.finished) return;
      busy = true;
      paint();
      Play.after(1100, () => {
        state = Babanuki.draw(state, Babanuki.aiDraw(state), { rng: Math.random });
        busy = false;
        if (state.finished) Play.note(state.winner);
        paint();
      });
    }

    function newGame() {
      busy = false;
      scene.mood('idle');
      state = Babanuki.start({ rng: Math.random, tellAccuracy: Play.level().tellAccuracy });
      paint();
    }

    newGame();
    // 画面に入りきらなければ卓ごと小さくする（写真は切らない）。
    // まだ差し込まれていなければ、fitScene 側が差し込まれるまで待ってくれる。
    GameUI.fitScene(scene.el);
  },
};
