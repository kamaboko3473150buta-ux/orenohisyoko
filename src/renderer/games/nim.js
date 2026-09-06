// src/renderer/games/nim.js
// クリップ取り（ミゼール・ニム）。交互に1〜3個取り、最後の1個を取ったほうが負け。
//
// 必勝法がある。相手に残す数を「4で割って1余る数」にできれば、あとは
// 相手が何個取っても同じ形を作り続けられ、最後の1個を相手に押しつけられる。
// 秘書子はこの手をどれくらいの確率で打つかで強さが変わる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nim = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MIN_CLIPS = 13;
  const MAX_CLIPS = 21;
  const MAX_TAKE = 3;

  function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function other(side) {
    return side === 'you' ? 'hishoko' : 'you';
  }

  function start(opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const remaining = MIN_CLIPS + Math.floor(rng() * (MAX_CLIPS - MIN_CLIPS + 1));
    return {
      remaining,
      max: MAX_TAKE,
      turn: 'you',        // 先手はあなた
      lastTake: null,
      finished: false,
      winner: null,
    };
  }

  function canTake(state, n) {
    if (state.finished) return false;
    if (!Number.isInteger(n)) return false;
    return n >= 1 && n <= state.max && n <= state.remaining;
  }

  function take(state, n) {
    if (!canTake(state, n)) return state;
    const remaining = state.remaining - n;
    const taker = state.turn;
    const next = { ...state, remaining, lastTake: { by: taker, n } };
    if (remaining === 0) {
      // 最後の1個を取った側の負け
      next.finished = true;
      next.winner = other(taker);
      next.turn = null;
      return next;
    }
    next.turn = other(taker);
    return next;
  }

  // 相手に 4で割って1余る数 を残す手。作れないなら null（＝いま負けの形）。
  function bestTake(remaining, max = MAX_TAKE) {
    const limit = Math.min(max, remaining);
    for (let n = 1; n <= limit; n += 1) {
      if ((remaining - n) % (max + 1) === 1) return n;
    }
    return null;
  }

  // 秘書子の手。skill の確率で最善手、外したら適当に取る。
  // ただし「まだ取らずに済むのに最後の1個を自分で取る」ことはしない
  // （そこまで見えない相手というのは、対戦していて不自然に映る）。
  function aiTake(state, opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const skill = numberOr(opts.skill, 0.7);

    const best = bestTake(state.remaining, state.max);
    if (best !== null && rng() < skill) return best;

    const limit = Math.min(state.max, state.remaining);
    const choices = [];
    for (let n = 1; n <= limit; n += 1) {
      if (state.remaining - n !== 0) choices.push(n);
    }
    if (choices.length === 0) return 1; // 残り1個。取るしかない
    return choices[Math.floor(rng() * choices.length)];
  }

  return { start, take, canTake, bestTake, aiTake, MIN_CLIPS, MAX_CLIPS, MAX_TAKE };
}));
