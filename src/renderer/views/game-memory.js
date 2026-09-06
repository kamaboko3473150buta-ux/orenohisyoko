// src/renderer/views/game-memory.js
// 神経衰弱。ルールは games/memory.js、ここは画面だけ。
window.Views = window.Views || {};

const REVEAL_MS = 950;   // めくった2枚を見せておく時間
const THINK_MS = 650;    // 秘書子が1枚めくるまでの間

Views.gameMemory = {
  render(root) {
    App.setTitle('神経衰弱');

    const grid = App.h('div', { class: 'memory-grid' });
    const scoreEl = App.h('p', { class: 'game-score' });
    const statusEl = App.h('p', { class: 'game-status' });
    const actionRow = App.h('div', { class: 'game-actions' });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '🂠 神経衰弱' }),
      App.h('p', {
        text: '8組16枚。交互に2枚めくり、同じ数字なら取ってもう一度。多く取ったほうの勝ちです。',
      }),
      scoreEl,
      grid,
      statusEl,
      actionRow,
    ]));

    let state = null;
    let busy = false; // 判定待ちや秘書子の手番の間は触らせない

    function paint() {
      grid.innerHTML = '';
      actionRow.innerHTML = '';
      if (!state) return;

      state.board.forEach((card, i) => {
        const open = Boolean(card.taken) || state.flipped.includes(i);
        const classes = ['pcard', 'memory-cell'];
        if (!open) classes.push('back');
        else if (Cards.isRed(card)) classes.push('red');
        if (card.taken) classes.push(`taken-${card.taken}`);
        const canPick = !busy && !state.finished && state.turn === 'you' && MemoryGame.canFlip(state, i);
        grid.appendChild(App.h('button', {
          class: classes.join(' '),
          type: 'button',
          disabled: !canPick,
          onclick: canPick ? () => youFlip(i) : null,
        }, [App.h('span', { text: open ? Cards.cardLabel(card) : '？' })]));
      });

      scoreEl.textContent = `あなた ${state.scores.you}組 ／ 秘書子 ${state.scores.hishoko}組`;

      if (state.finished) {
        statusEl.className = `game-status ${state.winner === 'you' ? 'win' : (state.winner ? 'lose' : '')}`;
        statusEl.textContent = state.winner === 'you' ? 'あなたの勝ちです。'
          : (state.winner === 'hishoko' ? '秘書子の勝ちです。' : '引き分けです。');
        actionRow.appendChild(App.h('button', { text: 'もう一勝負', onclick: newGame }));
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '息抜きに戻る', onclick: () => App.go('breaktime'),
        }));
        if (window.Hishoko) {
          Hishoko.say(state.winner === 'hishoko' ? 'praise' : 'trouble',
            state.winner === 'you' ? '負けました。よく覚えていらっしゃいますね。'
              : (state.winner === 'hishoko' ? 'いただきました。今日は冴えています。' : '互角でしたね。'));
        }
        return;
      }

      statusEl.className = 'game-status';
      statusEl.textContent = state.turn === 'you' ? 'あなたの番です。2枚めくってください。' : '秘書子の番です……';
    }

    // 2枚めくり終わったら、少し見せてから判定して次へ進める。
    function settle() {
      busy = true;
      paint();
      Play.after(REVEAL_MS, () => {
        state = MemoryGame.resolve(state);
        busy = false;
        if (state.finished) {
          Play.note(state.winner);
          paint();
          return;
        }
        paint();
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
      state = MemoryGame.start({ rng: Math.random, pairs: 8, memoryRate: Play.level().memoryRate });
      paint();
      if (window.Hishoko) Hishoko.say('smile', 'お先にどうぞ。私はときどき忘れます。');
    }

    newGame();
  },
};
