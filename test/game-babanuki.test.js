// test/game-babanuki.test.js
const test = require('node:test');
const assert = require('node:assert');
const Babanuki = require('../src/renderer/games/babanuki.js');
const Cards = require('../src/renderer/games/cards.js');

// 決まった並びの乱数（テストの結果を固定するため）。使い切ったら 0 を返し続ける。
function seq(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

function jokerIndex(state) {
  return state.hand.findIndex(Cards.isJoker);
}

test('開始時は秘書子が2枚（ジョーカー＋対の片割れ）、あなたが1枚', () => {
  const s = Babanuki.start({ rng: seq([0.3, 0.1, 0.2, 0.4, 0.9, 0.1]) });
  assert.strictEqual(s.holder, 'hishoko');
  assert.strictEqual(Babanuki.drawer(s), 'you');
  assert.strictEqual(s.hand.length, 2);
  assert.strictEqual(s.hand.filter(Cards.isJoker).length, 1);
  const pair = s.hand.find((c) => !Cards.isJoker(c));
  assert.strictEqual(pair.rank, s.single.rank);
  assert.notStrictEqual(pair.suit, s.single.suit); // 同じ札が2枚ある状態にはしない
  assert.strictEqual(s.finished, false);
});

test('対の札を引いたら引いた側の勝ちで終わる', () => {
  const s = Babanuki.start({ rng: Math.random });
  const next = Babanuki.draw(s, 1 - jokerIndex(s));
  assert.strictEqual(next.finished, true);
  assert.strictEqual(next.winner, 'you');
  assert.strictEqual(next.hand.length, 1);
  assert.ok(Cards.isJoker(next.hand[0]), '負けた側にジョーカーが残る');
  assert.strictEqual(next.single, null);
  assert.strictEqual(next.wentOut.length, 2, '上がった側の2枚が残る');
  assert.strictEqual(next.wentOut[0].rank, next.wentOut[1].rank, '同じ数字の組で上がる');
  assert.strictEqual(next.wentOut[0].rank, s.pairRank);
});

test('ジョーカーを引くと立場が入れ替わり、対の札が1枚側に残る', () => {
  const s = Babanuki.start({ rng: Math.random });
  const next = Babanuki.draw(s, jokerIndex(s));
  assert.strictEqual(next.finished, false);
  assert.strictEqual(next.holder, 'you');
  assert.strictEqual(Babanuki.drawer(next), 'hishoko');
  assert.strictEqual(next.hand.filter(Cards.isJoker).length, 1);
  assert.strictEqual(next.single.rank, s.pairRank);
  assert.ok(!Cards.isJoker(next.single));
});

test('あなたが2枚持っているときだけ左右を入れ替えられる', () => {
  const s = Babanuki.start({ rng: Math.random });
  assert.deepStrictEqual(Babanuki.swap(s).hand, s.hand, '秘書子の手札は動かせない');
  const mine = Babanuki.draw(s, jokerIndex(s));
  assert.deepStrictEqual(Babanuki.swap(mine).hand, [mine.hand[1], mine.hand[0]]);
});

test('クセは tellAccuracy=1 なら必ず本当、0 なら必ず外す', () => {
  for (let i = 0; i < 60; i += 1) {
    const truth = Babanuki.start({ tellAccuracy: 1 });
    assert.strictEqual(truth.tell.truthful, true);
    const pointsAtJoker = truth.tell.index === jokerIndex(truth);
    assert.strictEqual(pointsAtJoker, truth.tell.claim === 'joker');

    const lie = Babanuki.start({ tellAccuracy: 0 });
    assert.strictEqual(lie.tell.truthful, false);
    const liePointsAtJoker = lie.tell.index === jokerIndex(lie);
    assert.strictEqual(liePointsAtJoker, lie.tell.claim === 'safe');
  }
});

test('あなたが持つ側になったらクセは出ない（自分の手札は見えている）', () => {
  const s = Babanuki.start({ rng: Math.random });
  const mine = Babanuki.draw(s, jokerIndex(s));
  assert.strictEqual(mine.tell, null);
});

test('何度引いても札は「ジョーカー1枚＋同じ数字2枚」のまま', () => {
  for (let trial = 0; trial < 200; trial += 1) {
    let s = Babanuki.start({ rng: Math.random });
    let guard = 0;
    while (!s.finished && guard < 50) {
      const all = s.hand.concat([s.single]);
      assert.strictEqual(all.length, 3);
      assert.strictEqual(all.filter(Cards.isJoker).length, 1);
      assert.strictEqual(all.filter((c) => !Cards.isJoker(c) && c.rank === s.pairRank).length, 2);
      s = Babanuki.draw(s, Babanuki.aiDraw(s));
      guard += 1;
    }
    assert.ok(s.finished, '引き続ければ必ず決着する');
    assert.ok(s.winner === 'you' || s.winner === 'hishoko');
  }
});

test('決着後は引いても状態が変わらない', () => {
  const s = Babanuki.start({ rng: Math.random });
  const done = Babanuki.draw(s, 1 - jokerIndex(s));
  assert.strictEqual(Babanuki.draw(done, 0), done);
  assert.strictEqual(Babanuki.swap(done), done);
});
