// src/renderer/games/babanuki.js
// ババ抜きの「最後の1枚」だけを取り出したゲームのルール。
//
// 2人でやるババ抜きは、揃った組を捨てていくと必ず
// 「2枚（ジョーカー＋対の片割れ）対 1枚（対のもう片方）」の形になり、
// そこに至るまでの手順には選択の余地がない。だから最終局面だけを何度も遊ぶ。
//
// 状態は書き換えず、必ず新しい状態を返す（画面側の取り回しを楽にするため）。
(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./cards.js') : root.Cards
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Babanuki = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Cards) {
  const { RANKS, SUITS, isJoker, makeJoker, shuffle } = Cards;

  function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function other(side) {
    return side === 'you' ? 'hishoko' : 'you';
  }

  // 秘書子が2枚持っているときだけ「クセ」を作る。
  // claim は言い方（この札がジョーカー／この札は安全）、truthful が本当かどうか。
  // tellAccuracy が 0.5 なら当てにならない＝本気の秘書子は顔に出さない。
  function makeTell(hand, tellAccuracy, rng) {
    const jokerIndex = hand.findIndex(isJoker);
    if (jokerIndex < 0) return null;
    const truthful = rng() < tellAccuracy;
    const claim = rng() < 0.5 ? 'joker' : 'safe';
    const pointsAtJoker = claim === 'joker' ? truthful : !truthful;
    return { index: pointsAtJoker ? jokerIndex : 1 - jokerIndex, claim, truthful };
  }

  // 秘書子が2枚を持つ側になったら、札を混ぜてクセを引き直す。
  // あなたが持つ側なら、自分の札は見えているのでどちらも要らない。
  function afterHolderChanged(state, rng) {
    if (state.finished || state.holder !== 'hishoko') return { ...state, tell: null };
    const hand = shuffle(state.hand, rng);
    return { ...state, hand, tell: makeTell(hand, state.tellAccuracy, rng) };
  }

  // 秘書子が2枚（ジョーカー＋対の片割れ）、あなたが1枚（対のもう片方）から始める。
  // 対になる数字は毎回ランダム。
  function start(opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const tellAccuracy = numberOr(opts.tellAccuracy, 0.7);
    const rank = RANKS[Math.floor(rng() * RANKS.length)];
    const suits = shuffle(SUITS, rng);
    const pairA = { rank, suit: suits[0] };
    const pairB = { rank, suit: suits[1] };

    return afterHolderChanged({
      pairRank: rank,
      holder: 'hishoko',        // 2枚持っている側。引くのはその相手
      hand: [makeJoker(), pairA],
      single: pairB,
      tellAccuracy,
      tell: null,
      drawn: null,              // 直前に引かれた札（画面の演出用）
      wentOut: null,            // 上がった側が揃えた2枚
      draws: 0,
      finished: false,
      winner: null,
    }, rng);
  }

  // 引く側（2枚持っていないほう）。
  function drawer(state) {
    return other(state.holder);
  }

  // あなたが2枚持っているときだけ、左右を入れ替えられる。
  function swap(state) {
    if (state.finished || state.holder !== 'you') return state;
    return { ...state, hand: [state.hand[1], state.hand[0]] };
  }

  // index（0か1）の札を引く。
  // - 対の札を引いたら、引いた側は手札が揃って上がり＝勝ち
  // - ジョーカーを引いたら立場が入れ替わって続く
  function draw(state, index, opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    if (state.finished) return state;
    if (index !== 0 && index !== 1) return state;

    const taker = drawer(state);
    const drawn = state.hand[index];
    const left = state.hand[1 - index];
    const draws = state.draws + 1;

    if (!isJoker(drawn)) {
      // 引いた札が自分の持ち札と同じ数字なので、組が揃って上がる。
      // 残された側にジョーカーが1枚だけ残る＝負け。
      // 揃えた2枚は wentOut に残す（画面で「上がった手」として見せるため。
      // hand と single だけだと、上がった側の札がどこにも無くなってしまう）。
      return {
        ...state,
        hand: [left],
        single: null,
        wentOut: [state.single, drawn],
        drawn,
        draws,
        finished: true,
        winner: taker,
      };
    }

    return afterHolderChanged({
      ...state,
      holder: taker,
      hand: [drawn, state.single],
      single: left,
      drawn,
      draws,
    }, rng);
  }

  // 秘書子が引くときの選び方。あなたの並べ方は見えていないので当てずっぽう。
  function aiDraw(state, opts = {}) {
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    return rng() < 0.5 ? 0 : 1;
  }

  return { start, draw, swap, aiDraw, drawer, makeTell };
}));
