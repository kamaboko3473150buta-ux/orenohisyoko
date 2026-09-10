// scripts/recolor-check.js
// **アプリと同じ計算**で色を入れた結果を並べて書き出す。
//
//   node scripts/recolor-check.js <出力先.png> <画像> [画像...]
//
// マスクの見た目が正しくても、色を入れた結果が良いとは限らない。
// 確認するのは常に「実際に描いた絵」でなければならない。
// 計算は src/renderer/tint.js の applyOne と同じにしてある（ずれたら意味がない）。
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const lib = require('./mask-lib');

const { rgbToHsl, hslToRgb } = lib;

// tint.js と同じ: その範囲の「平均の色」が目標色になるよう倍率をかける。
function recolor(img, mask, markValue, hex) {
  const want = (() => {
    const n = parseInt(hex.slice(1), 16);
    return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  })();
  const out = Buffer.from(img.data);
  let sumS = 0; let sumL = 0; let n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== markValue) continue;
    const [, s, l] = rgbToHsl(out[p * 4], out[p * 4 + 1], out[p * 4 + 2]);
    sumS += s; sumL += l; n++;
  }
  if (!n) return { width: img.width, height: img.height, data: out };
  const g = (mean, w) => ((mean > 0.001 && mean < 0.999 && w > 0.001 && w < 0.999)
    ? Math.log(w) / Math.log(mean) : 1);
  const gS = g(sumS / n, want[1]);
  const gL = g(sumL / n, want[2]);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== markValue) continue;
    const i = p * 4;
    const [, s, l] = rgbToHsl(out[i], out[i + 1], out[i + 2]);
    const [r, gg, b] = hslToRgb(want[0], s ** gS, l ** gL);
    out[i] = r; out[i + 1] = gg; out[i + 2] = b;
  }
  return { width: img.width, height: img.height, data: out };
}

function readMask(file) {
  const p = PNG.sync.read(fs.readFileSync(file));
  const m = new Uint8Array(p.width * p.height);
  for (let i = 0; i < m.length; i++) m[i] = p.data[i * 4];
  return { mask: m, width: p.width, height: p.height };
}

const TILE = 380;
function tile(img) {
  const s = Math.max(img.width / TILE, img.height / TILE);
  const w = Math.max(1, Math.round(img.width / s));
  const h = Math.max(1, Math.round(img.height / s));
  const out = { width: w, height: h, data: Buffer.alloc(w * h * 4, 255) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.round(x * s));
      const sy = Math.min(img.height - 1, Math.round(y * s));
      const i = (sy * img.width + sx) * 4; const o = (y * w + x) * 4;
      out.data[o] = img.data[i]; out.data[o + 1] = img.data[i + 1];
      out.data[o + 2] = img.data[i + 2]; out.data[o + 3] = 255;
    }
  }
  return out;
}

const dest = process.argv[2];
const files = process.argv.slice(3);
const COLORS = [['そのまま', null], ['金', '#c9a24a'], ['桃', '#c96b93'], ['青', '#3a5b8c']];

const tiles = [];
for (const f of files) {
  const img = lib.decode(f);
  const maskFile = f.replace(/\.(png|jpg|jpeg)$/i, '.mask.png');
  if (!fs.existsSync(maskFile)) { console.log('マスクが無い:', f); continue; }
  const { mask } = readMask(maskFile);
  for (const [, hex] of COLORS) {
    tiles.push(tile(hex ? recolor(img, mask, 1, hex) : img));
  }
  console.log(f.split(/[\\/]/).slice(-2).join('/'), '->', COLORS.map((c) => c[0]).join(' / '));
}

const cols = COLORS.length;
const rows = Math.ceil(tiles.length / cols);
const sheet = new PNG({ width: cols * TILE, height: rows * TILE });
sheet.data.fill(235);
tiles.forEach((t, n) => {
  const ox = (n % cols) * TILE; const oy = Math.floor(n / cols) * TILE;
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const s = (y * t.width + x) * 4; const d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[d] = t.data[s]; sheet.data[d + 1] = t.data[s + 1];
      sheet.data[d + 2] = t.data[s + 2]; sheet.data[d + 3] = 255;
    }
  }
});
fs.writeFileSync(dest, PNG.sync.write(sheet));
console.log('->', path.resolve(dest));
