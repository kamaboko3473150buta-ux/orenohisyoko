// src/renderer/views/game-nim.js
// クリップ取り（ミゼール・ニム）。ルールは games/nim.js、ここは画面だけ。
window.Views = window.Views || {};

Views.gameNim = {
  render(root) {
    App.setTitle('クリップ取り');

    const pileEl = App.h('div', { class: 'clip-pile' });
    const countEl = App.h('p', { class: 'game-score' });
    const statusEl = App.h('p', { class: 'game-status' });
    const actionRow = App.h('div', { class: 'game-actions' });

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '📎 クリップ取り' }),
      App.h('p', {
        text: '交互に1〜3個ずつ取ります。最後の1個を取ったほうが負けです。先手はあなた。',
      }),
      pileEl,
      countEl,
      statusEl,
      actionRow,
    ]));

    let state = null;
    let busy = false;

    function paint() {
      pileEl.innerHTML = '';
      actionRow.innerHTML = '';
      if (!state) return;

      for (let i = 0; i < state.remaining; i += 1) {
        pileEl.appendChild(App.h('span', { class: 'clip', text: '📎' }));
      }
      countEl.textContent = `残り ${state.remaining} 個`;

      if (state.finished) {
        const won = state.winner === 'you';
        statusEl.className = `game-status ${won ? 'win' : 'lose'}`;
        statusEl.textContent = won
          ? '秘書子が最後の1個を取りました。あなたの勝ちです。'
          : '最後の1個を取ってしまいました。あなたの負けです。';
        actionRow.appendChild(App.h('button', { text: 'もう一勝負', onclick: newGame }));
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '息抜きに戻る', onclick: () => App.go('breaktime'),
        }));
        if (window.Hishoko) {
          Hishoko.say(won ? 'trouble' : 'praise',
            won ? '取らされました。数え間違いです……' : 'いただきました。手が見えていました。');
        }
        return;
      }

      statusEl.className = 'game-status';
      if (state.turn === 'you') {
        statusEl.textContent = '何個取りますか。';
        for (let n = 1; n <= state.max; n += 1) {
          actionRow.appendChild(App.h('button', {
            text: `${n}個とる`,
            disabled: busy || !Nim.canTake(state, n),
            onclick: () => youTake(n),
          }));
        }
      } else {
        statusEl.textContent = '秘書子が考えています……';
      }
    }

    function finishIfDone() {
      if (state.finished) Play.note(state.winner);
    }

    function youTake(n) {
      if (busy || state.finished || state.turn !== 'you') return;
      state = Nim.take(state, n);
      finishIfDone();
      paint();
      if (!state.finished) hishokoTurn();
    }

    function hishokoTurn() {
      busy = true;
      paint();
      // 残りが多いほど少しだけ長く考える。即答されると対戦している感じがしない。
      Play.after(700 + Math.min(state.remaining, 12) * 30, () => {
        const n = Nim.aiTake(state, { skill: Play.level().nimSkill, rng: Math.random });
        state = Nim.take(state, n);
        busy = false;
        finishIfDone();
        paint();
        if (!state.finished && window.Hishoko) {
          Hishoko.say('normal', `${n}個いただきました。残り${state.remaining}個です。`);
        }
      });
    }

    function newGame() {
      busy = false;
      state = Nim.start({ rng: Math.random });
      paint();
      if (window.Hishoko) Hishoko.say('smile', `${state.remaining}個あります。お先にどうぞ。`);
    }

    newGame();
  },
};
