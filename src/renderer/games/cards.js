// src/renderer/games/cards.js
// トランプの札と、その混ぜ方。ババ抜きと神経衰弱で共用する。
//
// レンダラは <script> で読むだけ（require が無い）ので、
// module.exports と window の両方に出せる形で書く。テストは require で読む。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Cards = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function isJoker(card) {
    return Boolean(card && card.joker);
  }

  function makeJoker() {
    return { joker: true };
  }

  // 札の見た目の文字。ジョーカーだけ特別。
  function cardLabel(card) {
    if (isJoker(card)) return 'JOKER';
    if (!card) return '';
    return `${card.rank}${card.suit}`;
  }

  // 赤い札（ハート・ダイヤ）かどうか。文字色を変えるのに使う。
  function isRed(card) {
    return Boolean(card) && (card.suit === '♥' || card.suit === '♦');
  }

  // 同じ内容の札か（神経衰弱の組の判定は数字だけを見る）。
  function sameRank(a, b) {
    return Boolean(a) && Boolean(b) && !isJoker(a) && !isJoker(b) && a.rank === b.rank;
  }

  // 元の配列は変えずに、混ぜた新しい配列を返す（Fisher-Yates）。
  // rng を差し替えられるようにしておく（テストで結果を固定するため）。
  function shuffle(list, rng) {
    const random = typeof rng === 'function' ? rng : Math.random;
    const out = Array.isArray(list) ? list.slice() : [];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // 一覧から1つ選ぶ。空なら null。
  function pick(list, rng) {
    const random = typeof rng === 'function' ? rng : Math.random;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[Math.floor(random() * list.length)];
  }

  return { SUITS, RANKS, isJoker, makeJoker, cardLabel, isRed, sameRank, shuffle, pick };
}));
