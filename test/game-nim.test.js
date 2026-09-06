// test/game-nim.test.js
const test = require('node:test');
const assert = require('node:assert');
const Nim = require('../src/renderer/games/nim.js');

test('配られるのは13〜21個で、先手はあなた', () => {
  for (let i = 0; i < 200; i += 1) {
    const s = Nim.start({ rng: Math.random });
    assert.ok(s.remaining >= Nim.MIN_CLIPS && s.remaining <= Nim.MAX_CLIPS);
    assert.strictEqual(s.turn, 'you');
    assert.strictEqual(s.finished, false);
  }
});

test('最後の1個を取った側の負け', () => {
  const s = { remaining: 1, max: 3, turn: 'you', finished: false, winner: null, lastTake: null };
  const done = Nim.take(s, 1);
  assert.strictEqual(done.finished, true);
  assert.strictEqual(done.winner, 'hishoko');
  assert.strictEqual(done.turn, null);
  assert.strictEqual(Nim.take(done, 1), done, '終わったあとは取れない');
});

test('1〜3個以外や、残りより多い数は受け付けない', () => {
  const s = { remaining: 2, max: 3, turn: 'you', finished: false, winner: null, lastTake: null };
  for (const n of [0, -1, 4, 3, 1.5, NaN, '2', null, undefined]) {
    assert.strictEqual(Nim.canTake(s, n), false, `${n} は取れないはず`);
    assert.strictEqual(Nim.take(s, n), s);
  }
  assert.strictEqual(Nim.canTake(s, 1), true);
  assert.strictEqual(Nim.canTake(s, 2), true);
});

test('bestTake は相手に 4n+1 を残す手を返し、自分が 4n+1 なら null', () => {
  for (let remaining = 1; remaining <= 40; remaining += 1) {
    const n = Nim.bestTake(remaining);
    if (remaining % 4 === 1) {
      assert.strictEqual(n, null, `残り${remaining}は勝ち手が無い形`);
    } else {
      assert.ok(n >= 1 && n <= 3, `残り${remaining}の手は1〜3個`);
      assert.strictEqual((remaining - n) % 4, 1, `残り${remaining}→相手に4n+1を残す`);
      assert.notStrictEqual(remaining - n, 0, '自分から最後の1個は取らない');
    }
  }
});

test('本気の秘書子（skill=1）は、勝てる形で手番が回れば必ず勝つ', () => {
  // あなたの打ち方を総当たりにして、それでも秘書子が勝つことを確かめる。
  function hishokoAlwaysWins(remaining) {
    let s = { remaining, max: 3, turn: 'hishoko', finished: false, winner: null, lastTake: null };
    s = Nim.take(s, Nim.aiTake(s, { skill: 1, rng: Math.random }));
    if (s.finished) return s.winner === 'hishoko';
    // ここから先はあなたの番。どの手を選んでも秘書子が勝てなければならない。
    for (let n = 1; n <= Math.min(3, s.remaining); n += 1) {
      const after = Nim.take(s, n);
      if (after.finished) {
        if (after.winner !== 'hishoko') return false;
      } else if (!hishokoAlwaysWins(after.remaining)) {
        return false;
      }
    }
    return true;
  }

  for (let remaining = 2; remaining <= 22; remaining += 1) {
    if (remaining % 4 === 1) continue; // 先に打つ側が負ける形なので対象外
    assert.ok(hishokoAlwaysWins(remaining), `残り${remaining}から秘書子が負ける手順がある`);
  }
});

test('手加減した秘書子でも、取れない数は打たない', () => {
  for (let remaining = 1; remaining <= 21; remaining += 1) {
    const s = { remaining, max: 3, turn: 'hishoko', finished: false, winner: null, lastTake: null };
    for (let i = 0; i < 40; i += 1) {
      const n = Nim.aiTake(s, { skill: 0, rng: Math.random });
      assert.ok(Nim.canTake(s, n), `残り${remaining}で${n}個は打てない`);
    }
  }
});

test('まだ他に選べるのに、自分から最後の1個は取らない', () => {
  for (let remaining = 2; remaining <= 4; remaining += 1) {
    const s = { remaining, max: 3, turn: 'hishoko', finished: false, winner: null, lastTake: null };
    for (let i = 0; i < 40; i += 1) {
      assert.notStrictEqual(remaining - Nim.aiTake(s, { skill: 0, rng: Math.random }), 0);
    }
  }
  const one = { remaining: 1, max: 3, turn: 'hishoko', finished: false, winner: null, lastTake: null };
  assert.strictEqual(Nim.aiTake(one, { skill: 0, rng: Math.random }), 1, '残り1個なら取るしかない');
});
