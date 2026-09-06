// src/renderer/views/breaktime.js
// 「息抜き」= 秘書子と1対1のミニゲームを選ぶ画面。
// ここから先のゲームは AI（Claude API）を一切使わない。通信もファイル保存もしない。
// 休憩のたびに費用が出たり、業務データと同じ場所に遊びの記録が溜まるのは筋が悪いため。
window.Views = window.Views || {};

// 本気度と戦績は、アプリを開いている間だけ覚えておく共有の入れ物。
// 各ゲームの画面はここから強さを読む。
window.Play = {
  LEVELS: [
    { id: 'easy', label: 'ゆるめ', tellAccuracy: 0.85, memoryRate: 0.45, nimSkill: 0.35 },
    { id: 'normal', label: 'ふつう', tellAccuracy: 0.70, memoryRate: 0.75, nimSkill: 0.70 },
    { id: 'hard', label: '本気', tellAccuracy: 0.50, memoryRate: 0.95, nimSkill: 1.00 },
  ],
  levelId: 'normal',
  record: { win: 0, lose: 0, draw: 0 },

  level() {
    return this.LEVELS.find((l) => l.id === this.levelId) || this.LEVELS[1];
  },

  note(result) {
    if (result === 'you') this.record.win += 1;
    else if (result === 'hishoko') this.record.lose += 1;
    else this.record.draw += 1;
  },

  recordText() {
    const { win, lose, draw } = this.record;
    if (win + lose + draw === 0) return 'まだ対戦していません';
    const base = `${win}勝${lose}敗`;
    return draw > 0 ? `${base}${draw}分` : base;
  },

  // 秘書子の手番を少し待ってから動かすためのタイマー。
  // 待っている間に別の画面へ移ったら、もう動かさない
  // （画面を離れたあとに勝手に手が進んでいると気持ちが悪い）。
  after(ms, fn) {
    const generation = App.generation;
    setTimeout(() => {
      if (App.generation === generation) fn();
    }, ms);
  },
};

const GAMES = [
  { view: 'gameBabanuki', title: '🃏 ババ抜き（最後の1枚）', desc: '2枚対1枚の最終局面だけを何度でも。秘書子のクセを読めますか' },
  { view: 'gameMemory', title: '🂠 神経衰弱', desc: '8組16枚。秘書子はときどき忘れます' },
  { view: 'gameNim', title: '📎 クリップ取り', desc: '交互に1〜3個。最後の1個を取ったほうが負け' },
];

Views.breaktime = {
  render(root) {
    App.setTitle('息抜き');

    const levelRow = App.h('div', { class: 'chips' });
    const paintLevels = () => {
      levelRow.innerHTML = '';
      for (const level of Play.LEVELS) {
        levelRow.appendChild(App.h('button', {
          class: `chip${level.id === Play.levelId ? ' selected' : ''}`,
          type: 'button',
          text: level.label,
          onclick: () => { Play.levelId = level.id; paintLevels(); },
        }));
      }
    };
    paintLevels();

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '秘書子の本気度' }),
      App.h('p', { text: '3つのゲームに共通します。対戦の途中で変えても、次の勝負から効きます。' }),
      levelRow,
    ]));

    for (const game of GAMES) {
      root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go(game.view) }, [
        App.h('h2', { text: game.title }),
        App.h('p', { text: game.desc }),
      ]));
    }

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '戦績' }),
      App.h('p', { text: `${Play.recordText()}（アプリを閉じると消えます）` }),
    ]));

    if (window.Hishoko) Hishoko.say('smile', 'ひと休みしましょうか。どれで遊びます？');
  },
};
