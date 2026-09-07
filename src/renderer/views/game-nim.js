// src/renderer/views/game-nim.js
// クリップ取り（ミゼール・ニム）。ルールは games/nim.js、卓の部品は views/game-ui.js。
// こちらは緑のフェルトではなく事務机の上。文房具を取り合っている絵にする。
window.Views = window.Views || {};

Views.gameNim = {
  render(root) {
    App.setTitle('クリップ取り');

    const scene = GameUI.scene({ wide: true });
    const scatter = App.h('div', { class: 'clip-scatter' });
    const note = GameUI.note();
    const actionRow = App.h('div', { class: 'game-actions' });

    scene.table.appendChild(scatter);
    scene.table.appendChild(note);

    root.appendChild(App.h('p', { class: 'game-intro', text: '交互に1〜3個ずつ取ります。最後の1個を取ったほうが負けです。先手はあなた。' }));
    root.appendChild(scene.el);
    root.appendChild(actionRow);

    let state = null;
    let busy = false;

    function paint() {
      scatter.innerHTML = '';
      actionRow.innerHTML = '';
      if (!state) return;

      for (let i = 0; i < state.remaining; i += 1) scatter.appendChild(GameUI.clipEl(i));

      if (state.finished) {
        const won = state.winner === 'you';
        note.className = `table-note ${won ? 'win' : 'lose'}`;
        note.textContent = won
          ? '秘書子が最後の1個を取りました。あなたの勝ちです。'
          : '最後の1個を取ってしまいました。あなたの負けです。';
        actionRow.appendChild(App.h('button', { text: 'もう一勝負', onclick: newGame }));
        actionRow.appendChild(App.h('button', {
          class: 'secondary', text: '息抜きに戻る', onclick: () => App.go('breaktime'),
        }));
        scene.mood(won ? 'sulk' : 'joy');
        scene.say(won ? '取らされました。数え間違いです……' : 'いただきました。手が見えていました。');
        return;
      }

      note.className = 'table-note';
      note.textContent = `残り ${state.remaining} 個。${state.turn === 'you' ? '何個取りますか。' : '秘書子が考えています……'}`;
      if (state.turn === 'you') {
        for (let n = 1; n <= state.max; n += 1) {
          actionRow.appendChild(App.h('button', {
            text: `${n}個とる`,
            disabled: busy || !Nim.canTake(state, n),
            onclick: () => youTake(n),
          }));
        }
      }
    }

    function youTake(n) {
      if (busy || state.finished || state.turn !== 'you') return;
      state = Nim.take(state, n);
      if (state.finished) Play.note(state.winner);
      paint();
      if (!state.finished) hishokoTurn();
    }

    function hishokoTurn() {
      busy = true;
      paint();
      scene.say('……少し考えさせてください。');
      // 残りが多いほど少しだけ長く考える。即答されると対戦している感じがしない。
      Play.after(800 + Math.min(state.remaining, 12) * 30, () => {
        const n = Nim.aiTake(state, { skill: Play.level().nimSkill, rng: Math.random });
        state = Nim.take(state, n);
        busy = false;
        if (state.finished) Play.note(state.winner);
        paint();
        if (!state.finished) scene.say(`${n}個いただきました。残り${state.remaining}個です。`);
      });
    }

    function newGame() {
      busy = false;
      scene.mood('idle');
      state = Nim.start({ rng: Math.random });
      paint();
      scene.say(`${state.remaining}個あります。お先にどうぞ。`);
    }

    newGame();
    // 画面に入りきらなければ卓ごと小さくする（写真は切らない）。
    // App.go は描き終えてから本体に差し込むので、1フレーム待ってから測る。
    requestAnimationFrame(() => GameUI.fitScene(scene.el));
  },
};
