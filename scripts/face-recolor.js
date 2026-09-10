// scripts/face-recolor.js
// 顔まわりを拡大して、**実際に色を入れた絵**を並べる。
//   node scripts/face-recolor.js <出力先.png> <色> <画像...>
const fs = require('node:fs');
const { PNG } = require('pngjs');
const lib = require('./mask-lib');
const { rgbToHsl, hslToRgb } = lib;

function readMask(f) {
  const p = PNG.sync.read(fs.readFileSync(f));
  const m = new Uint8Array(p.width * p.height);
  for (let i = 0; i < m.length; i++) m[i] = p.data[i * 4];
  return m;
}
function recolor(img, mask, hex) {
  const n0 = parseInt(hex.slice(1), 16);
  const want = rgbToHsl((n0 >> 16) & 255, (n0 >> 8) & 255, n0 & 255);
  const out = Buffer.from(img.data);
  let sS = 0; let sL = 0; let n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== 1) continue;
    const [, s, l] = rgbToHsl(out[p * 4], out[p * 4 + 1], out[p * 4 + 2]);
    sS += s; sL += l; n++;
  }
  if (!n) return { width: img.width, height: img.height, data: out };
  const g = (m, w) => ((m > 0.001 && m < 0.999 && w > 0.001 && w < 0.999) ? Math.log(w) / Math.log(m) : 1);
  const gS = g(sS / n, want[1]); const gL = g(sL / n, want[2]);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== 1) continue;
    const i = p * 4;
    const [, s, l] = rgbToHsl(out[i], out[i + 1], out[i + 2]);
    const [r, gg, b] = hslToRgb(want[0], s ** gS, l ** gL);
    out[i] = r; out[i + 1] = gg; out[i + 2] = b;
  }
  return { width: img.width, height: img.height, data: out };
}
function faceCrop(img, mask) {
  const { width: W, height: H } = img;
  const skin = new Uint8Array(W * H);
  for (let p = 0; p < skin.length; p++) skin[p] = mask[p] === 2 ? 1 : 0;
  let best = null;
  for (const px of lib.components(img, skin, null)) if (!best || px.length > best.length) best = px;
  if (!best) return { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  let x0 = W; let x1 = 0; let y0 = H; let y1 = 0;
  for (const p of best) {
    const x = p % W; const y = (p - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const w = x1 - x0; const h = y1 - y0;
  return {
    x0: Math.max(0, Math.round(x0 - w * 0.45)),
    x1: Math.min(W - 1, Math.round(x1 + w * 0.45)),
    y0: Math.max(0, Math.round(y0 - h * 0.55)),
    y1: Math.min(H - 1, Math.round(y0 + h * 0.80)),
  };
}
const TILE = 400;
function tileOf(img, box) {
  const bw = box.x1 - box.x0 + 1; const bh = box.y1 - box.y0 + 1;
  const s = Math.max(bw / TILE, bh / TILE);
  const w = Math.max(1, Math.round(bw / s)); const h = Math.max(1, Math.round(bh / s));
  const out = { width: w, height: h, data: Buffer.alloc(w * h * 4, 245) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, box.x0 + Math.round(x * s));
      const sy = Math.min(img.height - 1, box.y0 + Math.round(y * s));
      const i = (sy * img.width + sx) * 4; const o = (y * w + x) * 4;
      out.data[o] = img.data[i]; out.data[o + 1] = img.data[i + 1];
      out.data[o + 2] = img.data[i + 2]; out.data[o + 3] = 255;
    }
  }
  return out;
}
const dest = process.argv[2]; const hex = process.argv[3];
const tiles = [];
for (const f of process.argv.slice(4)) {
  const img = lib.decode(f);
  const mask = readMask(f.replace(/\.(png|jpg|jpeg)$/i, '.mask.png'));
  const box = faceCrop(img, mask);
  tiles.push(tileOf(recolor(img, mask, hex), box));
}
const cols = 4; const rows = Math.ceil(tiles.length / cols);
const sheet = new PNG({ width: cols * TILE, height: rows * TILE });
sheet.data.fill(245);
tiles.forEach((t, n) => {
  const ox = (n % cols) * TILE; const oy = Math.floor(n / cols) * TILE;
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
    const s = (y * t.width + x) * 4; const d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = t.data[s]; sheet.data[d + 1] = t.data[s + 1];
    sheet.data[d + 2] = t.data[s + 2]; sheet.data[d + 3] = 255;
  }
});
fs.writeFileSync(dest, PNG.sync.write(sheet));
console.log('->', dest);
