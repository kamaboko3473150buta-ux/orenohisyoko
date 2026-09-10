// scripts/face-check.js
// 顔まわりを拡大して、マスクの当たり方を一覧にする。
//
//   node scripts/face-check.js <出力先.png>
//
// 目・まつ毛・眉毛は髪とまったく同じ暗い茶色で、全体を縮小した一覧では
// 当たり外れが見えない。**顔だけ拡大しないと確認にならない。**
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const lib = require('./mask-lib');

const ROOT = path.join(__dirname, '..');
const DIRS = ['assets/hishoko', 'assets/office', 'assets/games'];
const TILE = 260;

function readMask(file) {
  const p = PNG.sync.read(fs.readFileSync(file));
  const m = new Uint8Array(p.width * p.height);
  for (let i = 0; i < m.length; i++) m[i] = p.data[i * 4];
  return m;
}

// 肌の一番大きな塊＝顔。そこを目印に切り出す。
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
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // 眉毛の上まで見たいので、上に広めに取る。
  const w = x1 - x0; const h = y1 - y0;
  return {
    x0: Math.max(0, Math.round(x0 - w * 0.25)),
    x1: Math.min(W - 1, Math.round(x1 + w * 0.25)),
    y0: Math.max(0, Math.round(y0 - h * 0.30)),
    y1: Math.min(H - 1, Math.round(y0 + h * 0.75)),
  };
}

function tileOf(img, mask, box) {
  const bw = box.x1 - box.x0 + 1; const bh = box.y1 - box.y0 + 1;
  const s = Math.max(bw / TILE, bh / TILE);
  const w = Math.max(1, Math.round(bw / s)); const h = Math.max(1, Math.round(bh / s));
  const out = { width: w, height: h, data: Buffer.alloc(w * h * 4, 245) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, box.x0 + Math.round(x * s));
      const sy = Math.min(img.height - 1, box.y0 + Math.round(y * s));
      const p = sy * img.width + sx; const i = p * 4; const o = (y * w + x) * 4;
      let [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      // 髪＝赤で半透明に重ねる。元の絵が透けたほうが、何を拾っているか分かる。
      if (mask[p] === 1) { r = Math.round(r * 0.35 + 255 * 0.65); g = Math.round(g * 0.35); b = Math.round(b * 0.35); }
      out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b; out.data[o + 3] = 255;
    }
  }
  return out;
}

const items = [];
for (const dir of DIRS) {
  const base = path.join(ROOT, dir);
  for (const look of fs.readdirSync(base)) {
    const d = path.join(base, look);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const name of fs.readdirSync(d)) {
      if (!/\.(png|jpg|jpeg)$/i.test(name) || name.endsWith('.mask.png')) continue;
      items.push({ look, name, file: path.join(d, name) });
    }
  }
}

const tiles = [];
for (const it of items) {
  const img = lib.decode(it.file);
  const maskFile = it.file.replace(/\.(png|jpg|jpeg)$/i, '.mask.png');
  if (!fs.existsSync(maskFile)) continue;
  const mask = readMask(maskFile);
  tiles.push(tileOf(img, mask, faceCrop(img, mask)));
}

const cols = 6;
const rows = Math.ceil(tiles.length / cols);
const sheet = new PNG({ width: cols * TILE, height: rows * TILE });
sheet.data.fill(245);
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
fs.writeFileSync(process.argv[2], PNG.sync.write(sheet));
console.log('並び:', items.map((i) => `${i.look}/${i.name}`).join(' / '));
console.log('->', process.argv[2]);
