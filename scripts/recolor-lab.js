// scripts/recolor-lab.js
// 髪・肌の範囲を選び出して、色を変えられるか試すための実験用。
//
//   node scripts/recolor-lab.js assets/hishoko/straight-long/normal.png
//
// 見本を1枚のPNGに並べて書き出すので、目で確かめてから本実装に進む。
//
// 考え方はゲームと同じ。**色ちがいの絵を用意するのではなく、
// 範囲（マスク）を1つ持っておいて、描くときに色相をずらす。**
// 陰影と艶は元のまま残るので、塗りつぶしとは仕上がりが違う。
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

function decode(file) {
  if (file.endsWith('.png')) {
    const p = PNG.sync.read(fs.readFileSync(file));
    return { width: p.width, height: p.height, data: p.data };
  }
  return jpeg.decode(fs.readFileSync(file), { useTArray: true });
}

function rgbToHsl(r, g, b) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (mx === G) h = ((B - R) / d + 2);
  else h = ((R - G) / d + 4);
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const H = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(H + 1 / 3) * 255), Math.round(f(H) * 255), Math.round(f(H - 1 / 3) * 255)];
}

// 色相は輪なので、340度と20度は「40度差」ではなく「40度差」ではない点に注意。
function hueDist(a, b) {
  const d = Math.abs(((a % 360) + 360) % 360 - ((b % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

// 実測にもとづく範囲（このアプリの絵の場合）。
//   髪 H=351〜17 S=0.26〜0.36 L=0.11〜0.26
//   肌 H=22〜23  S=0.76〜0.86 L=0.79〜0.82
// 髪と肌は色相が近い（どちらも橙寄り）が、**明度と彩度でくっきり分かれる**。
const RULES = {
  hair: {
    hue: 10, hueTol: 45, sMin: 0.12, sMax: 0.62, lMin: 0.04, lMax: 0.52,
  },
  skin: {
    hue: 24, hueTol: 22, sMin: 0.45, sMax: 0.99, lMin: 0.58, lMax: 0.95,
  },
};

// 色だけで選ぶと、**目の虹彩と唇まで髪に入る**（どちらも暗い赤茶なので）。
// 髪は頭のてっぺんからつながっている範囲だけに限る。
// 目や唇は肌に囲まれた「島」なので、つながりを見れば自然に外れる。
function keepConnected(img, mask, seeds) {
  const { width: W, height: H } = img;
  const keep = new Uint8Array(W * H);
  const stack = [];
  for (const [fx, fy] of seeds) {
    const x = Math.round(fx * W); const y = Math.round(fy * H);
    if (mask[y * W + x]) stack.push(y * W + x);
  }
  while (stack.length) {
    const p = stack.pop();
    if (keep[p]) continue;
    keep[p] = 1;
    const x = p % W; const y = (p - x) / W;
    if (x > 0 && mask[p - 1] && !keep[p - 1]) stack.push(p - 1);
    if (x < W - 1 && mask[p + 1] && !keep[p + 1]) stack.push(p + 1);
    if (y > 0 && mask[p - W] && !keep[p - W]) stack.push(p - W);
    if (y < H - 1 && mask[p + W] && !keep[p + W]) stack.push(p + W);
  }
  return keep;
}

// 細らせる／太らせる。
// 目や唇は肌の島だが、**まつげの細い線が前髪とつながっている**ため、
// そのままでは「つながっている範囲」に入ってしまう。
// いったん細らせて細い橋を切り、つながりを見てから、元の範囲の中で太らせ直す。
function grow(img, mask, times, on) {
  const { width: W, height: H } = img;
  let cur = mask;
  for (let k = 0; k < times; k++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const near = (q) => (q >= 0 && q < W * H ? cur[q] : (on ? 0 : 1));
        const around = near(p - 1) && near(p + 1) && near(p - W) && near(p + W);
        next[p] = on
          ? (cur[p] || near(p - 1) || near(p + 1) || near(p - W) || near(p + W)) ? 1 : 0
          : (cur[p] && around) ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

// 範囲の中にできた穴を埋める。
// 髪の艶（明るい部分）は色の条件から外れるので、髪の中に穴として残る。
// 色の条件を広げて拾おうとすると肌まで巻き込むので、形で埋める。
//
// ただし**穴なら何でも埋めてよいわけではない**。
// 髪に囲まれた耳とイヤリングも穴になるので、そのまま埋めると髪色に染まる。
// 穴の中身を見て、艶（髪と同系色でそこそこ彩度がある）だけを埋める。
function holeIsShine(img, px, hairHue) {
  const { data: D } = img;
  let ok = 0;
  for (const p of px) {
    const [h, s] = rgbToHsl(D[p * 4], D[p * 4 + 1], D[p * 4 + 2]);
    // 肌は彩度が高すぎ（0.76〜0.86）、イヤリングは低すぎ（0.1未満）。
    if (hueDist(h, hairHue) <= 60 && s >= 0.10 && s <= 0.65) ok++;
  }
  return ok / px.length >= 0.7;
}

function fillHoles(img, mask, hairHue) {
  const { width: W, height: H } = img;
  const outside = new Uint8Array(W * H);
  const st = [];
  for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
  while (st.length) {
    const p = st.pop();
    if (p < 0 || p >= W * H || outside[p] || mask[p]) continue;
    outside[p] = 1;
    const x = p % W;
    if (x > 0) st.push(p - 1);
    if (x < W - 1) st.push(p + 1);
    st.push(p - W, p + W);
  }
  // 穴ごとにまとめて、中身を見てから埋めるか決める
  const out = Uint8Array.from(mask);
  const seen = new Uint8Array(W * H);
  for (let p0 = 0; p0 < W * H; p0++) {
    if (mask[p0] || outside[p0] || seen[p0]) continue;
    const st = [p0]; const px = [];
    seen[p0] = 1;
    while (st.length) {
      const p = st.pop(); px.push(p);
      const x = p % W; const y = (p - x) / W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && !mask[q] && !outside[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    if (!holeIsShine(img, px, hairHue)) continue;
    for (const p of px) out[p] = 1;
  }
  return out;
}

// 近くに白（目の強膜）があるか。**目と、髪の房・眉毛を分ける決め手。**
// 色ではどちらも同じ暗い茶色で、区別がつかない。
function whiteTouch(img, px) {
  const { width: W, height: H, data: D } = img;
  let hits = 0;
  for (const p of px) {
    const x = p % W; const y = (p - x) / W;
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) {
      const xx = x + dx; const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = (yy * W + xx) * 4;
      const [, s2, l2] = rgbToHsl(D[i], D[i + 1], D[i + 2]);
      if (l2 > 0.82 && s2 < 0.4) hits++;
    }
  }
  return hits;
}

// 侵食で切り離された島を見直す。
// 目は捨てるが、**髪の房と眉毛は戻す**（眉は髪色に合わせたい）。
function reattachIslands(img, raw, main) {
  const { width: W, height: H } = img;
  const near = grow(img, main, 8, true);   // 本体のすぐそばか
  const seen = new Uint8Array(W * H);
  const out = Uint8Array.from(main);
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!raw[p0] || main[p0] || seen[p0]) continue;
    const st = [p0]; const px = [];
    seen[p0] = 1;
    while (st.length) {
      const p = st.pop(); px.push(p);
      const x = p % W; const y = (p - x) / W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && raw[q] && !main[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    if (whiteTouch(img, px) > 2) continue;              // 目とその周り
    if (!px.some((p) => near[p])) continue;             // 本体から離れすぎ（唇など）
    for (const p of px) out[p] = 1;
  }
  return out;
}

function buildMask(img, rule) {
  const { width: W, height: H, data: D } = img;
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const [h, s, l] = rgbToHsl(D[p * 4], D[p * 4 + 1], D[p * 4 + 2]);
    if (hueDist(h, rule.hue) <= rule.hueTol
      && s >= rule.sMin && s <= rule.sMax
      && l >= rule.lMin && l <= rule.lMax) mask[p] = 1;
  }
  return mask;
}

// 色を変える。**色相を置き換え、彩度と明度は元の陰影を活かして掛け算する。**
// 平らに塗ると立体感が消えるので、置き換えるのは色相だけにする。
function recolor(img, mask, { hue, sat = 1, light = 1, lightShift = 0 }) {
  const out = Buffer.from(img.data);
  for (let p = 0; p < img.width * img.height; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const [, s, l] = rgbToHsl(out[i], out[i + 1], out[i + 2]);
    const ns = Math.max(0, Math.min(1, s * sat));
    const nl = Math.max(0, Math.min(1, l * light + lightShift));
    const [r, g, b] = hslToRgb(hue, ns, nl);
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
  return { width: img.width, height: img.height, data: out };
}

const HAIR_PRESETS = [
  ['そのまま', null],
  ['黒', { hue: 20, sat: 0.35, light: 0.55 }],
  ['赤茶', { hue: 5, sat: 1.5, light: 1.05 }],
  ['金', { hue: 42, sat: 1.5, light: 1.9 }],
  ['アッシュ', { hue: 210, sat: 0.3, light: 1.35 }],
  ['青', { hue: 215, sat: 1.2, light: 1.0 }],
  ['桃', { hue: 335, sat: 1.4, light: 1.45 }],
];

function tile(images, cols, W, H) {
  const rows = Math.ceil(images.length / cols);
  const out = new PNG({ width: cols * W, height: rows * H });
  out.data.fill(255);
  images.forEach((img, n) => {
    const ox = (n % cols) * W; const oy = Math.floor(n / cols) * H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = (y * img.width + x) * 4; const d = ((oy + y) * out.width + ox + x) * 4;
        out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1];
        out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = 255;
      }
    }
  });
  return out;
}

const file = process.argv[2];
const img = decode(file);
// 髪の起点。頭のてっぺんの中央あたりを何点か置く（片方が外れても拾えるように）。
const HAIR_SEEDS = [[0.50, 0.06], [0.50, 0.10], [0.42, 0.12], [0.58, 0.12], [0.30, 0.35], [0.70, 0.35]];
const hairRaw = buildMask(img, RULES.hair);
const thin = grow(img, hairRaw, 2, false);                 // 細い橋を切る
const core = keepConnected(img, thin, HAIR_SEEDS);          // 頭からつながる塊だけ
const main = grow(img, core, 3, true).map((v, i) => (v && hairRaw[i] ? 1 : 0)); // 元の形に戻す
// 髪の房・眉毛は戻し、目は捨てる。そのあと艶の穴を埋める。
const hairMask = fillHoles(img, reattachIslands(img, hairRaw, main), RULES.hair.hue);
const skinMask = buildMask(img, RULES.skin);
const count = (m) => m.reduce((a, b) => a + b, 0);
console.log(`髪の範囲 ${count(hairMask)}画素 (${(100 * count(hairMask) / (img.width * img.height)).toFixed(1)}%)`);
console.log(`肌の範囲 ${count(skinMask)}画素 (${(100 * count(skinMask) / (img.width * img.height)).toFixed(1)}%)`);

// 1枚目は範囲の確認用（髪＝赤、肌＝緑で塗る）
const check = { width: img.width, height: img.height, data: Buffer.from(img.data) };
for (let p = 0; p < img.width * img.height; p++) {
  if (hairMask[p]) { check.data[p * 4] = 255; check.data[p * 4 + 1] = 0; check.data[p * 4 + 2] = 0; }
  if (skinMask[p]) { check.data[p * 4] = 0; check.data[p * 4 + 1] = 220; check.data[p * 4 + 2] = 0; }
}

const shots = [img, check];
for (const [, preset] of HAIR_PRESETS) {
  if (preset) shots.push(recolor(img, hairMask, preset));
}
// 肌も1つ試す（日焼け）
shots.push(recolor(img, skinMask, { hue: 22, sat: 1.0, light: 0.82 }));

const out = tile(shots, 3, img.width, img.height);
const dest = process.argv[3] || path.join(path.dirname(file), '_recolor-preview.png');
fs.writeFileSync(dest, PNG.sync.write(out));
console.log('並び: 元 / 範囲(髪=赤 肌=緑) /', HAIR_PRESETS.filter((p) => p[1]).map((p) => p[0]).join(' / '), '/ 肌(日焼け)');
console.log('->', dest);
