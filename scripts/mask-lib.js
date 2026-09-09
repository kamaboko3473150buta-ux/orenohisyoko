// scripts/mask-lib.js
// 髪と肌の範囲（マスク）を絵から取り出す手順。make-masks.js と recolor-lab.js が使う。
//
// 手順は1枚目（ストレートロングの微笑）で検証したもの:
//   1. 色で大まかに拾う
//   2. いったん細らせて、まつげのような細い橋を切る
//   3. 頭のてっぺんからつながった塊だけを残す
//   4. 元の太さに戻す
//   5. 切り離された島のうち、白に隣接しないもの（髪の房・眉毛）を戻す
//   6. 髪に囲まれた穴のうち、艶だけを埋める
//
// 2〜5が要るのは、**目の虹彩と眉毛が髪とまったく同じ暗い茶色**だから。
// 色では区別がつかず、決め手は「目のまわりには白（強膜）がある」ことだった。
const fs = require('node:fs');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

function decode(file) {
  if (file.toLowerCase().endsWith('.png')) {
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
  const H = (((h % 360) + 360) % 360) / 360;
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

function hueDist(a, b) {
  const d = Math.abs((((a % 360) + 360) % 360) - (((b % 360) + 360) % 360));
  return Math.min(d, 360 - d);
}

// 実測にもとづく範囲（このアプリの絵の場合）。
//   髪 H=351〜17 S=0.26〜0.36 L=0.11〜0.26（艶は L=0.5〜0.7 まで上がる）
//   肌 H=22〜23  S=0.76〜0.86 L=0.79〜0.82
// 色相はどちらも橙寄りで近いが、**明度と彩度でくっきり分かれる**。
const RULES = {
  hair: {
    hue: 10, hueTol: 45, sMin: 0.12, sMax: 0.62, lMin: 0.04, lMax: 0.52,
  },
  skin: {
    hue: 24, hueTol: 22, sMin: 0.45, sMax: 0.99, lMin: 0.58, lMax: 0.95,
  },
};

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

// 細らせる（on=false）／太らせる（on=true）
function grow(img, mask, times, on) {
  const { width: W, height: H } = img;
  let cur = mask;
  for (let k = 0; k < times; k++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const nb = (q) => (q >= 0 && q < W * H ? cur[q] : (on ? 0 : 1));
        next[p] = on
          ? ((cur[p] || nb(p - 1) || nb(p + 1) || nb(p - W) || nb(p + W)) ? 1 : 0)
          : ((cur[p] && nb(p - 1) && nb(p + 1) && nb(p - W) && nb(p + W)) ? 1 : 0);
      }
    }
    cur = next;
  }
  return cur;
}

function keepConnected(img, mask, seeds) {
  const { width: W, height: H } = img;
  const keep = new Uint8Array(W * H);
  const stack = [];
  for (const [fx, fy] of seeds) {
    const x = Math.round(fx * W); const y = Math.round(fy * H);
    if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) stack.push(y * W + x);
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

// 近くに白（目の強膜）があるか。**目と、髪の房・眉毛を分ける決め手。**
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

function components(img, mask, skip) {
  const { width: W, height: H } = img;
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!mask[p0] || (skip && skip[p0]) || seen[p0]) continue;
    const st = [p0]; const px = [];
    seen[p0] = 1;
    while (st.length) {
      const p = st.pop(); px.push(p);
      const x = p % W; const y = (p - x) / W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && mask[q] && !(skip && skip[q]) && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    out.push(px);
  }
  return out;
}

// 侵食で切り離された島を見直す。目は捨て、髪の房と眉毛は戻す。
//
// **白隣接の判定は小さな島にだけ使う。** 大きな髪の塊は明るい背景（オフィスの壁）に
// 接しているので白隣接が多く、目と同じ扱いになって丸ごと落ちていた
// （ボブの数枚で、前髪だけ残って後ろ髪が消えた）。
function meanColor(img, px) {
  const { data: D } = img;
  let h = 0; let s = 0; let l = 0;
  for (const p of px) {
    const [hh, ss, ll] = rgbToHsl(D[p * 4], D[p * 4 + 1], D[p * 4 + 2]);
    h += hh; s += ss; l += ll;
  }
  return { h: h / px.length, s: s / px.length, l: l / px.length };
}

function reattachIslands(img, raw, main, reach) {
  const near = grow(img, main, reach, true);
  const mainSize = main.reduce((a, b) => a + b, 0);
  const small = Math.max(64, mainSize * 0.04);
  const mainPx = [];
  for (let p = 0; p < main.length; p++) if (main[p]) mainPx.push(p);
  const base = mainPx.length ? meanColor(img, mainPx) : null;
  const out = Uint8Array.from(main);
  for (const px of components(img, raw, main)) {
    if (px.length < small && whiteTouch(img, px) > 2) continue;   // 目とその周り
    if (!px.some((p) => near[p])) continue;                       // 本体から離れすぎ（唇など）
    // 色の近さも条件にしようとしたが、**ボブの後ろ髪まで落ちた**（影で色が違うため）。
    // 机の木部を落とせても丸枠が壊れるなら割に合わない。ここは絵ごとの調整に回す。
    for (const p of px) out[p] = 1;
  }
  return out;
}

// 髪に囲まれた穴のうち、艶だけを埋める。
// **耳とイヤリングも髪に囲まれて穴になる**ので、中身を見ずに埋めてはいけない。
function fillShineHoles(img, mask, hairHue) {
  const { width: W, height: H, data: D } = img;
  const outside = new Uint8Array(W * H);
  const st = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const p = st.pop();
    if (p < 0 || p >= W * H || outside[p] || mask[p]) continue;
    outside[p] = 1;
    const x = p % W;
    if (x > 0) st.push(p - 1);
    if (x < W - 1) st.push(p + 1);
    st.push(p - W, p + W);
  }
  const holes = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (!mask[p] && !outside[p]) holes[p] = 1;

  const out = Uint8Array.from(mask);
  for (const px of components(img, holes, null)) {
    let ok = 0;
    for (const p of px) {
      const [h, s] = rgbToHsl(D[p * 4], D[p * 4 + 1], D[p * 4 + 2]);
      // 肌は彩度が高すぎ（0.76〜0.86）、イヤリングは低すぎ（0.1未満）。
      if (hueDist(h, hairHue) <= 60 && s >= 0.10 && s <= 0.65) ok++;
    }
    if (ok / px.length < 0.7) continue;
    for (const p of px) out[p] = 1;
  }
  return out;
}

// 頭のてっぺんを探す。中央の列で、明るいところから暗いところに変わる最初の行。
// 絵によって人物の大きさが違うので、種（起点）を決め打ちにできない。
function headTop(img) {
  const { width: W, height: H, data: D } = img;
  const col = Math.round(W * 0.5);
  const span = Math.max(8, Math.round(W * 0.05));
  for (let y = 0; y < H; y++) {
    let dark = 0;
    for (let x = col - span; x <= col + span; x += 2) {
      if (x < 0 || x >= W) continue;
      const i = (y * W + x) * 4;
      if ((D[i] + D[i + 1] + D[i + 2]) / 3 < 120) dark++;
    }
    if (dark >= 5) return y / H;
  }
  return 0.10;
}

// 頭の幅（画素）。**侵食の量は画像の幅ではなく頭の大きさに合わせる。**
// 画像の幅に比例させると、人物が小さく写った絵（オフィスの背景など）で
// 侵食が効きすぎて髪が消える（実際に0%になった）。
function headWidth(img, top) {
  const { width: W, height: H, data: D } = img;
  const y = Math.min(H - 1, Math.round(top * H) + Math.round(H * 0.02));
  const cx = Math.round(W * 0.5);
  const dark = (x) => {
    if (x < 0 || x >= W) return false;
    const i = (y * W + x) * 4;
    return (D[i] + D[i + 1] + D[i + 2]) / 3 < 140;
  };
  let l = cx; let r = cx;
  while (l > 0 && dark(l - 1)) l--;
  while (r < W - 1 && dark(r + 1)) r++;
  return Math.max(8, r - l + 1);
}

// 髪の起点。頭のてっぺんのすぐ下に、頭の大きさに合わせた間隔で置く。
function hairSeeds(img, top, hw) {
  const { width: W, height: H } = img;
  const stepPx = Math.max(2, Math.round(hw * 0.06));
  const seeds = [];
  for (let k = 1; k <= 5; k++) seeds.push([0.5, top + (stepPx * k) / H]);
  for (const dx of [-0.12, 0.12, -0.2, 0.2]) {
    seeds.push([0.5 + (hw * dx) / W, top + (stepPx * 3) / H]);
  }
  return seeds;
}

// 何点かの中央値。外れ値（艶・影）に引っぱられないようにする。
function median(list) {
  if (!list.length) return null;
  const a = list.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// その絵の髪／肌が実際にどんな色かを測る。
//
// **固定のしきい値では夜の絵が拾えなかった**（同じ髪でも暗く写るため）。
// 絵ごとに測って、その値のまわりに範囲を作る。
function sampleAt(img, points) {
  const { width: W, height: H, data: D } = img;
  const hs = []; const ss = []; const ls = [];
  for (const [fx, fy] of points) {
    const x = Math.round(fx * W); const y = Math.round(fy * H);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = (y * W + x) * 4;
    const [h, s, l] = rgbToHsl(D[i], D[i + 1], D[i + 2]);
    hs.push(h); ss.push(s); ls.push(l);
  }
  if (!hs.length) return null;
  return { h: median(hs), s: median(ss), l: median(ls) };
}

function ruleAround(sample, base) {
  if (!sample) return base;
  return {
    hue: sample.h,
    hueTol: base.hueTol,
    sMin: Math.max(0.05, sample.s * 0.35),
    sMax: Math.min(0.99, sample.s * 2.2),
    lMin: Math.max(0.02, sample.l * 0.25),
    lMax: Math.min(0.97, sample.l * 2.6),
  };
}

// 割合で指定された箱から作る（絵ごとの調整用）。
function boxRoi(img, box) {
  const { width: W, height: H } = img;
  const roi = new Uint8Array(W * H);
  const x0 = Math.max(0, Math.round(box[0] * W));
  const y0 = Math.max(0, Math.round(box[1] * H));
  const x1 = Math.min(W - 1, Math.round(box[2] * W));
  const y1 = Math.min(H - 1, Math.round(box[3] * H));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) roi[y * W + x] = 1;
  return roi;
}

// 人物の入る箱。頭のてっぺんと頭の幅から決める。
// 横は頭の幅の3倍（肩と腕まで）、縦は頭のてっぺんから頭幅の6倍（胸まで）。
function insideRoi(img, top, hw) {
  const { width: W, height: H } = img;
  const cx = W * 0.5;
  const x0 = Math.max(0, Math.round(cx - hw * 3));
  const x1 = Math.min(W - 1, Math.round(cx + hw * 3));
  const y0 = Math.max(0, Math.round(top * H) - Math.round(hw * 0.5));
  const y1 = Math.min(H - 1, Math.round(top * H) + Math.round(hw * 6));
  const roi = new Uint8Array(W * H);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) roi[y * W + x] = 1;
  return roi;
}

// 1枚ぶんの髪・肌の範囲を出す。
function extract(img, opts = {}) {
  const head = opts.head || {};
  const top = head.top != null ? head.top : headTop(img);
  const hw = head.width || headWidth(img, top);
  // 丸枠の1枚で検証したときは「頭の幅74px・侵食2・戻し8」が合っていた。
  // その比を保って、絵ごとの人物の大きさに合わせる。
  const thinBy = opts.thin || Math.max(1, Math.round(hw / 37));
  const reach = opts.reach || Math.max(3, Math.round(hw / 10));
  const seeds = opts.seeds || hairSeeds(img, top, hw);
  // 人物のいる範囲だけを対象にする。
  // **絵の全体を見ると、木の机・背景の家具まで髪と同じ色で拾ってしまう。**
  // 頭の位置と大きさは測ってあるので、そこから人物の入る箱を作る。
  // 絵ごとの箱があればそれを使う。無ければ頭の位置から自動で作る。
  const roi = opts.hairRoi ? boxRoi(img, opts.hairRoi) : insideRoi(img, top, hw);
  const skinRoi = opts.skinRoi ? boxRoi(img, opts.skinRoi) : roi;
  const hairRule = RULES.hair;
  const hairRaw = buildMask(img, hairRule);
  for (let p = 0; p < hairRaw.length; p++) if (!roi[p]) hairRaw[p] = 0;
  const thin = grow(img, hairRaw, thinBy, false);
  const core = keepConnected(img, thin, seeds);
  const back = grow(img, core, thinBy + 1, true);
  const main = new Uint8Array(img.width * img.height);
  for (let p = 0; p < main.length; p++) main[p] = (back[p] && hairRaw[p]) ? 1 : 0;
  let hair = fillShineHoles(img, reattachIslands(img, hairRaw, main, reach), hairRule.hue);

  // 夜の絵は同じ髪でも暗く写り、明度の下限から外れて何も拾えないことがある
  // （オフィスの夜で0%になった）。ほとんど拾えていなければ、暗いほうへずらして取り直す。
  const roiSize = roi.reduce((a, b) => a + b, 0);
  if (hair.reduce((a, b) => a + b, 0) < roiSize * 0.004) {
    const dark = {
      ...hairRule, lMin: hairRule.lMin * 0.3, lMax: hairRule.lMax * 0.62, sMin: hairRule.sMin * 0.5,
    };
    const raw2 = buildMask(img, dark);
    for (let p = 0; p < raw2.length; p++) if (!roi[p]) raw2[p] = 0;
    const thin2 = grow(img, raw2, thinBy, false);
    const core2 = keepConnected(img, thin2, seeds);
    const back2 = grow(img, core2, thinBy + 1, true);
    const main2 = new Uint8Array(img.width * img.height);
    for (let p = 0; p < main2.length; p++) main2[p] = (back2[p] && raw2[p]) ? 1 : 0;
    hair = fillShineHoles(img, reattachIslands(img, raw2, main2, reach), dark.hue);
  }

  // 肌は色だけで足りる（背景は青緑、スーツは紺で、色相が大きく離れている）。
  // ただし髪に取られた画素は肌から外す（境目の重なりを避ける）。
  const skinRaw = buildMask(img, RULES.skin);
  for (let p = 0; p < skinRaw.length; p++) if (!skinRoi[p]) skinRaw[p] = 0;
  const skin = new Uint8Array(img.width * img.height);
  for (let p = 0; p < skin.length; p++) skin[p] = (skinRaw[p] && !hair[p]) ? 1 : 0;
  return { hair, skin };
}

// 色を変える。色相を置き換え、彩度と明度は元の陰影に掛け算する。
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

module.exports = {
  decode, rgbToHsl, hslToRgb, hueDist, RULES,
  buildMask, grow, keepConnected, components, headTop, headWidth, hairSeeds, boxRoi,
  extract, recolor,
};
