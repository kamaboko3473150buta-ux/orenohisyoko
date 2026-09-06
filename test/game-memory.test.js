// test/game-memory.test.js
const test = require('node:test');
const assert = require('node:assert');
const MemoryGame = require('../src/renderer/games/memory.js');

const always = () => 0;      // 必ず覚える側に倒れる乱数
const never = () => 0.999;   // 必ず覚えない側に倒れる乱数

// 盤面から、同じ数字の2枚の位置を探す。
function findPair(state, from = 0) {
  for (let i = from; i < state.board.length; i += 1) {
    if (state.board[i].taken) continue;
    for (let j = i + 1; j < state.board.length; j += 1) {
      if (state.board[j].taken) continue;
      if (state.board[i].rank === state.board[j].rank) return [i, j];
    }
  }
  return null;
}

function findMiss(state) {
  for (let i = 0; i < state.board.length; i += 1) {
    for (let j = i + 1; j < state.board.length; j += 1) {
      if (state.board[i].rank !== state.board[j].rank) return [i, j];
    }
  }
  return null;
}

test('8組16枚が伏せられ、数字は重複しない', () => {
  const s = MemoryGame.start({ rng: Math.random });
  assert.strictEqual(s.board.length, 16);
  assert.strictEqual(s.turn, 'you');
  assert.ok(s.board.every((c) => c.taken === null));
  const counts = new Map();
  for (const c of s.board) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  assert.strictEqual(counts.size, 8);
  assert.ok([...counts.values()].every((n) => n === 2), 'どの数字もちょうど2枚');
});

test('揃えたら取って手番が続き、外したら伏せて手番が移る', () => {
  const start = MemoryGame.start({ rng: Math.random });

  const [a, b] = findPair(start);
  const hit = MemoryGame.resolve(MemoryGame.flip(MemoryGame.flip(start, a), b));
  assert.strictEqual(hit.lastResult, 'hit');
  assert.strictEqual(hit.turn, 'you');
  assert.strictEqual(hit.scores.you, 1);
  assert.strictEqual(hit.board[a].taken, 'you');
  assert.strictEqual(hit.flipped.length, 0);

  const [c, d] = findMiss(start);
  const miss = MemoryGame.resolve(MemoryGame.flip(MemoryGame.flip(start, c), d));
  assert.strictEqual(miss.lastResult, 'miss');
  assert.strictEqual(miss.turn, 'hishoko');
  assert.strictEqual(miss.scores.you, 0);
  assert.strictEqual(miss.board[c].taken, null);
});

test('取った札・めくり中の札は選べない', () => {
  let s = MemoryGame.start({ rng: Math.random });
  const [a, b] = findPair(s);
  s = MemoryGame.flip(s, a);
  assert.strictEqual(MemoryGame.canFlip(s, a), false, 'めくり中の札');
  s = MemoryGame.resolve(MemoryGame.flip(s, b));
  assert.strictEqual(MemoryGame.canFlip(s, a), false, '取った札');
  assert.strictEqual(MemoryGame.canFlip(s, -1), false);
  assert.strictEqual(MemoryGame.canFlip(s, 99), false);
  assert.strictEqual(MemoryGame.flip(s, a), s, '選べない札を渡しても状態は変わらない');
});

test('3枚目はめくれない', () => {
  let s = MemoryGame.start({ rng: Math.random });
  s = MemoryGame.flip(MemoryGame.flip(s, 0), 1);
  assert.strictEqual(MemoryGame.flip(s, 2), s);
});

test('memoryRate=1 の秘書子は、一度めくられた組を必ず揃える', () => {
  const start = MemoryGame.start({ rng: Math.random, memoryRate: 1 });
  const [a, b] = findPair(start);
  // あなたが a と b をばらばらにめくって外した（秘書子はそれを見て覚えた）状態を作る
  const c = start.board.findIndex((_, i) => i !== a && start.board[i].rank !== start.board[a].rank);
  let s = MemoryGame.resolve(MemoryGame.flip(MemoryGame.flip(start, a, { rng: always }), c, { rng: always }));
  assert.strictEqual(s.turn, 'hishoko');
  s = { ...s, memory: { ...s.memory, [b]: s.board[b].rank } };

  const first = MemoryGame.aiPick(s, { rng: Math.random });
  const second = MemoryGame.aiPick(MemoryGame.flip(s, first, { rng: always }), { rng: Math.random });
  assert.strictEqual(s.board[first].rank, s.board[second].rank, '覚えている組を取りにいく');
});

test('何も覚えていない秘書子は、まだ取られていない札から選ぶ', () => {
  let s = MemoryGame.start({ rng: Math.random, memoryRate: 0 });
  const [a, b] = findPair(s);
  s = MemoryGame.resolve(MemoryGame.flip(MemoryGame.flip(s, a, { rng: never }), b, { rng: never }));
  assert.deepStrictEqual(s.memory, {}, '覚えない設定なので記憶は空のまま');
  s = { ...s, turn: 'hishoko' };
  for (let i = 0; i < 50; i += 1) {
    const pickIndex = MemoryGame.aiPick(s, { rng: Math.random });
    assert.ok(MemoryGame.canFlip(s, pickIndex), '取った札は選ばない');
  }
});

test('全部取り終えたら取得数の多いほうが勝ち、同数なら引き分け', () => {
  let s = MemoryGame.start({ rng: Math.random, pairs: 4, memoryRate: 1 });
  let guard = 0;
  while (!s.finished && guard < 100) {
    const pair = findPair(s);
    s = MemoryGame.resolve(MemoryGame.flip(MemoryGame.flip(s, pair[0]), pair[1]));
    guard += 1;
  }
  assert.strictEqual(s.finished, true);
  assert.strictEqual(s.turn, null);
  assert.strictEqual(s.scores.you + s.scores.hishoko, 4);
  assert.strictEqual(s.winner, 'you'); // 全部あなたが揃えた
  assert.strictEqual(MemoryGame.flip(s, 0), s, '終わったあとはめくれない');

  // 2組ずつ取り合って最後の1組を秘書子が揃える＝2対2の引き分け
  const fresh = MemoryGame.start({ rng: Math.random, pairs: 4 });
  const groups = new Map();
  fresh.board.forEach((card, i) => {
    groups.set(card.rank, (groups.get(card.rank) || []).concat([i]));
  });
  const [g1, g2, g3, g4] = [...groups.values()];
  const owner = new Map();
  for (const i of g1.concat(g2)) owner.set(i, 'you');
  for (const i of g3) owner.set(i, 'hishoko');

  const draw = MemoryGame.resolve({
    ...fresh,
    board: fresh.board.map((c, i) => ({ ...c, taken: owner.get(i) || null })),
    scores: { you: 2, hishoko: 1 },
    flipped: g4,
    turn: 'hishoko',
  });
  assert.strictEqual(draw.finished, true);
  assert.strictEqual(draw.scores.hishoko, 2);
  assert.strictEqual(draw.winner, null, '同数なら引き分け');
});
