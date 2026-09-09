// scripts/make-masks.js
// 秘書子の絵から髪と肌の範囲（マスク）を作る。
//
//   node scripts/make-masks.js            … 作って、確認用の一覧も書き出す
//   node scripts/make-masks.js --check    … 一覧だけ（マスクは書かない）
//
// これがあると、**髪色・肌色は絵を足さずに無段階で変えられる**。
// 色ちがいを描き下ろすと1色につき12枚だが、マスクなら1枚も要らない。
//
// マスクは1枚のグレースケールPNGに詰める（0=なし 1=髪 2=肌）。
// ほとんど同じ値が続くので、PNGの圧縮がよく効いて数KBに収まる。
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const lib = require('./mask-lib');

// 絵ごとの調整。共通の判定では木製家具を髪と間違える絵があるため。
let OVERRIDES = {};
try {
  OVERRIDES = JSON.parse(fs.readFileSync(path.join(__dirname, 'mask-overrides.json'), 'utf8'));
} catch { OVERRIDES = {}; }

const ROOT = path.join(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');
const SHEET = process.argv[process.argv.indexOf('--sheet') + 1] || path.join(ROOT, 'mask-check.png');

const DIRS = ['assets/hishoko', 'assets/office', 'assets/games'];
const TILE = 300;

function listImages() {
  const out = [];
  for (const dir of DIRS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const look of fs.readdirSync(base)) {
      const d = path.join(base, look);
      if (!fs.statSync(d).isDirectory()) continue;
      for (const name of fs.readdirSync(d)) {
        if (!/\.(png|jpg|jpeg)$/i.test(name) || name.endsWith('.mask.png')) continue;
        out.push({ dir, look, name, file: path.join(d, name) });
      }
    }
  }
  return out;
}

// 確認用の一覧に貼る小さな絵。髪＝赤、肌＝緑で塗る。
function overlayTile(img, hair, skin) {
  const s = Math.max(img.width / TILE, img.height / TILE);
  const w = Math.max(1, Math.round(img.width / s));
  const h = Math.max(1, Math.round(img.height / s));
  const tile = { width: w, height: h, data: Buffer.alloc(w * h * 4, 255) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.round(x * s));
      const sy = Math.min(img.height - 1, Math.round(y * s));
      const p = sy * img.width + sx;
      const i = p * 4; const o = (y * w + x) * 4;
      let [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (hair[p]) [r, g, b] = [255, 40, 40];
      else if (skin[p]) [r, g, b] = [40, 220, 40];
      tile.data[o] = r; tile.data[o + 1] = g; tile.data[o + 2] = b; tile.data[o + 3] = 255;
    }
  }
  return tile;
}

const items = listImages();
const tiles = [];
console.log(`${items.length}枚を処理します`);
for (const it of items) {
  const img = lib.decode(it.file);
  const key = `${it.dir.replace('assets/', '')}/${it.look}/${it.name}`;
  const { hair, skin } = lib.extract(img, OVERRIDES[key] || {});
  const total = img.width * img.height;
  const pct = (m) => (100 * m.reduce((a, b) => a + b, 0) / total).toFixed(1);
  console.log(`  ${it.dir.replace('assets/', '').padEnd(8)} ${it.look.padEnd(14)} ${it.name.padEnd(16)} 髪${pct(hair).padStart(5)}%  肌${pct(skin).padStart(5)}%`);

  if (!CHECK_ONLY) {
    const png = new PNG({ width: img.width, height: img.height, colorType: 0 });
    for (let p = 0; p < total; p++) png.data[p] = hair[p] ? 1 : (skin[p] ? 2 : 0);
    const dest = it.file.replace(/\.(png|jpg|jpeg)$/i, '.mask.png');
    fs.writeFileSync(dest, PNG.sync.write(png, { colorType: 0, inputColorType: 0 }));
  }
  tiles.push({ tile: overlayTile(img, hair, skin), label: `${it.look}/${it.name}` });
}

// 一覧を1枚にまとめる
const cols = 6;
const rows = Math.ceil(tiles.length / cols);
const sheet = new PNG({ width: cols * TILE, height: rows * TILE });
sheet.data.fill(230);
tiles.forEach((t, n) => {
  const ox = (n % cols) * TILE; const oy = Math.floor(n / cols) * TILE;
  for (let y = 0; y < t.tile.height; y++) {
    for (let x = 0; x < t.tile.width; x++) {
      const s = (y * t.tile.width + x) * 4;
      const d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data[d] = t.tile.data[s]; sheet.data[d + 1] = t.tile.data[s + 1];
      sheet.data[d + 2] = t.tile.data[s + 2]; sheet.data[d + 3] = 255;
    }
  }
});
fs.writeFileSync(SHEET, PNG.sync.write(sheet));
console.log('確認用の一覧 ->', SHEET);
console.log('並び:', tiles.map((t) => t.label).join(' / '));
