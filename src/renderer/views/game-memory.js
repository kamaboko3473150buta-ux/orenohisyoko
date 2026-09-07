// src/renderer/views/game-memory.js
// 神経衰弱。ルールは games/memory.js、卓の部品は views/game-ui.js。
//
// 札の要素は毎回作り直さず、置いたまま状態だけを塗り替える。
// 作り直すとCSSの遷移が始まらず、めくる動きが出ないため。
window.Views = window.Views || {};

const REVEAL_MS = 950;   // めくった2枚を見せておく時間
const THINK_MS = 700;    // 秘書子が1枚めくるまでの間

Views.gameMemory = {
  render(root) {
    App.setTitle('神経衰弱');

    const scene = GameUI.scene();
    const grid = App.h('div', { class: 'memory-grid' });
    const side = App.h('div', { class: 'memory-side' });
    const note = GameUI.note();
    const actionRow = App.h('div', { class: 'game-actions' });

    scene.table.appendChild(App.h('div', { class: 'memory-area' }, [grid, side]));
    scene.table.appendChild(note);

    root.appendChild(App.h('p', { class: 'game-intro', text: '12組24枚。交互に2枚めくり、同じ数字なら取ってもう一度。多く取ったほうの勝ちです。' }));
    root.appendChild(scene.el);
    root.appendChild(actionRow);

    let state = null;
    let busy = false;   // 判定待ちや秘書子の手番の間は触らせない
    let slots = [];     // 盤面の各マス（置きっぱなしにする）

    // 盤面を組み立てる。配り直したときだけ呼ぶ。
    function buildBoard() {
      grid.innerHTML = '';
      slots = state.board.map((card, i) => {
        const cardButton = GameUI.cardEl(card, { onClick: () => youFlip(i) });
        const slot = App.h('div', { class: 'memory-slot' }, [GameUI.emptySlot(), cardButton]);
        grid.appendChild(slot);
        return { slot, cardButton };
      });
    }

    function paint() {
      actionRow.innerHTML = '';
      side.innerHTML = '';
      if (!state) return;

      state.board.forEach((card, i) => {
        const { slot, cardButton } = slots[i];
        const open = Boolean(card.taken) || state.flipped.includes(i);
        cardButton.classList.toggle('is-up', open);
        // 取られた札は卓から下げる（取った人の山に移った、という見え方にする）
        slot.classList.toggle('is-empty', Boolean(card.taken));
        cardButton.disabled = !(!busy && !state.finished && state.turn === 'you' && MemoryGame.canFlip(state, i));
      });

      side.appendChild(GameUI.pile('秘書子', state.scores.hishoko));
      side.appendChild(GameUI.pile('あなた', state.scores.you));

      if (state.finished) {
        note.className = `table-note ${state.winner === 'you' ? 'win' : (state.winner ? 'lose' : '')}`;
        note.textContent = state.winner === 'you' ? 'あなたの勝ちです。'
          : (state.winner === 'hishoko' ? '秘書子の勝ちです。' : '引き分けです。');
        actionRow.appendChild(App.h('button', { text: 'もう一勝負', onclick: newGame }));
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '息抜きに戻る', onclick: () => App.go('breaktime'),
        }));
        scene.mood(state.winner === 'you' ? 'sulk' : (state.winner === 'hishoko' ? 'joy' : 'idle'));
        scene.say(state.winner === 'you' ? '負けました。よく覚えていらっしゃいますね。'
            : (state.winner === 'hishoko' ? 'いただきました。今日は冴えています。' : '互角でしたね。'));
        return;
      }

      note.className = 'table-note';
      if (state.turn === 'you') {
        note.textContent = state.flipped.length === 1 ? 'もう1枚めくってください。' : 'あなたの番です。2枚めくってください。';
        scene.say('どうぞ。');
      } else {
        note.textContent = '秘書子の番です……';
        scene.say('えっと、この辺に……');
      }
    }

    // 2枚めくり終わったら、少し見せてから判定して次へ進める。
    function settle() {
      busy = true;
      paint();
      Play.after(REVEAL_MS, () => {
        const hitBy = state.turn;
        state = MemoryGame.resolve(state);
        busy = false;
        if (state.finished) {
          Play.note(state.winner);
          paint();
          return;
        }
        paint();
        if (state.lastResult === 'hit' && hitBy === 'hishoko') scene.say('ありました。もう一度いただきます。');
        if (state.turn === 'hishoko') hishokoTurn();
      });
    }

    function youFlip(index) {
      if (busy || state.finished || state.turn !== 'you') return;
      state = MemoryGame.flip(state, index, { rng: Math.random });
      if (state.flipped.length === 2) settle();
      else paint();
    }

    // 秘書子の番。1枚めくって見せてから、間を置いて2枚目をめくる。
    function hishokoTurn() {
      busy = true;
      paint();
      Play.after(THINK_MS, () => {
        const first = MemoryGame.aiPick(state, { rng: Math.random });
        if (first === null) { busy = false; paint(); return; }
        state = MemoryGame.flip(state, first, { rng: Math.random });
        paint();
        Play.after(THINK_MS, () => {
          const second = MemoryGame.aiPick(state, { rng: Math.random });
          if (second === null) { busy = false; paint(); return; }
          state = MemoryGame.flip(state, second, { rng: Math.random });
          settle();
        });
      });
    }

    function newGame() {
      busy = false;
      scene.mood('idle');
      state = MemoryGame.start({ rng: Math.random, pairs: 12, memoryRate: Play.level().memoryRate });
      buildBoard();
      paint();
      scene.say('お先にどうぞ。私はときどき忘れます。');
    }

    newGame();
  },
};
