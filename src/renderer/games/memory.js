// src/renderer/games/memory.js
// 神経衰弱のルールと、秘書子の記憶のしかた。
//
// 秘書子は「めくられた札を必ず覚える」わけではない。決まった確率でだけ覚える。
// 完璧に覚える相手とは勝負にならないので、そこが手加減の効きどころになる。
(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./cards.js') : root.Cards
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MemoryGame = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards) {
  const { RANKS, shuffle, pick } = Cards;

  function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function other(side) {
    return side === 'you' ? 'hishoko' : 'you';
  }

  // 8組16枚。同じ数字が4枚あると見分けがつかないので、数字は重複させず
  // 1組ずつ別の数字にする（マークは黒と赤で1枚ずつ）。
  function start(opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const pairs = Math.max(2, Math.min(RANKS.length, Math.floor(numberOr(opts.pairs, 8))));
    const memoryRate = numberOr(opts.memoryRate, 0.75);

    const ranks = shuffle(RANKS, rng).slice(0, pairs);
    const cards = [];
    for (const rank of ranks) {
      cards.push({ rank, suit: '♠' });
      cards.push({ rank, suit: '♥' });
    }

    return {
      board: shuffle(cards, rng).map((card) => ({ ...card, taken: null })),
      flipped: [],
      turn: 'you',
      scores: { you: 0, hishoko: 0 },
      memory: {},          // 秘書子が覚えている札 { 位置: 数字 }
      memoryRate,
      lastResult: null,    // 'hit' | 'miss'（直前の2枚の結果）
      finished: false,
      winner: null,        // 引き分けは null のまま finished だけ true
    };
  }

  function canFlip(state, index) {
    if (state.finished) return false;
    if (state.flipped.length >= 2) return false;
    if (!Number.isInteger(index) || index < 0 || index >= state.board.length) return false;
    if (state.board[index].taken) return false;
    return !state.flipped.includes(index);
  }

  // まだ取られていない札の位置。
  function available(state) {
    const out = [];
    for (let i = 0; i < state.board.length; i += 1) {
      if (!state.board[i].taken) out.push(i);
    }
    return out;
  }

  // 1枚めくる。めくられた札は、誰がめくったかに関係なく
  // memoryRate の確率で秘書子の記憶に入る（相手の手も見ているため）。
  function flip(state, index, opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    if (!canFlip(state, index)) return state;
    const memory = { ...state.memory };
    if (rng() < state.memoryRate) memory[index] = state.board[index].rank;
    return { ...state, flipped: state.flipped.concat([index]), memory, lastResult: null };
  }

  // めくった2枚を判定する。揃えば取って手番続行、違えば伏せて手番交代。
  function resolve(state) {
    if (state.finished || state.flipped.length !== 2) return state;
    const [a, b] = state.flipped;
    const hit = state.board[a].rank === state.board[b].rank;

    const board = state.board.slice();
    const memory = { ...state.memory };
    const scores = { ...state.scores };

    if (hit) {
      board[a] = { ...board[a], taken: state.turn };
      board[b] = { ...board[b], taken: state.turn };
      scores[state.turn] += 1;
      // 取った札はもう覚えていても仕方がない
      delete memory[a];
      delete memory[b];
    }

    const next = {
      ...state,
      board,
      memory,
      scores,
      flipped: [],
      turn: hit ? state.turn : other(state.turn),
      lastResult: hit ? 'hit' : 'miss',
    };

    if (board.every((card) => card.taken)) {
      next.finished = true;
      next.turn = null;
      if (scores.you !== scores.hishoko) next.winner = scores.you > scores.hishoko ? 'you' : 'hishoko';
    }
    return next;
  }

  // 秘書子が次にめくる位置。
  // 1枚目: 覚えている札だけで組が作れるならそれを取りにいく。無ければ未知の札をめくる。
  // 2枚目: いま表になっている札と同じ数字を覚えていればそこ。無ければ未知の札。
  function aiPick(state, opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const open = available(state).filter((i) => !state.flipped.includes(i));
    if (open.length === 0) return null;

    if (state.flipped.length === 1) {
      const rank = state.board[state.flipped[0]].rank;
      const known = open.filter((i) => state.memory[i] === rank);
      if (known.length > 0) return pick(known, rng);
    } else {
      const byRank = new Map();
      for (const i of open) {
        const rank = state.memory[i];
        if (rank === undefined) continue;
        if (byRank.has(rank)) return byRank.get(rank); // 覚えている組が揃った
        byRank.set(rank, i);
      }
    }

    // 覚えていない札を優先してめくる（覚えている札をめくっても新しい情報が増えない）。
    const unknown = open.filter((i) => state.memory[i] === undefined);
    return pick(unknown.length > 0 ? unknown : open, rng);
  }

  return { start, flip, resolve, aiPick, canFlip, available };
}));
