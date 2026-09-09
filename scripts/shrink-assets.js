// scripts/shrink-assets.js
// 秘書子の絵を、実際に表示される大きさに合わせて縮める。
//
//   node scripts/shrink-assets.js          … 何が変わるかを出すだけ
//   node scripts/shrink-assets.js --write  … 実際に書き換える
//
// 生成した原本は 1024〜2400px あるが、丸枠は132pxでしか表示されない（8〜18倍）。
// そのままだとリポジトリとexeが重くなるだけで、見た目は1ドットも良くならない。
//
// **縮小は面積平均で行う。** 間引きだと線画の細い線が消える。
// 丸枠は縮小後にPNG（無劣化）で書く。JPEGで二度目の圧縮をかけない。
const fs = require('node:fs');
const path = require('node:path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');

// 表示される大きさに対して2倍まで持たせる（高解像度の画面ぶん）。
const TARGET = [
  { dir: 'assets/hishoko', width: 384, as: 'png' },   // 丸枠132px・見本76px
  // 背景だけは画面いっぱいに広がる。1920pxの画面を最大化すると約1730px要る。
  { dir: 'assets/office', width: 1800, as: 'jpg' },
  // 卓は幅880pxで頭打ち（.scene の --max）なので、これ以上は要らない。
  { dir: 'assets/games', width: 1200, as: 'jpg' },
];

function decode(file) {
  if (file.endsWith('.png')) {
    const png = PNG.sync.read(fs.readFileSync(file));
    return { width: png.width, height: png.height, data: png.data };
  }
  return jpeg.decode(fs.readFileSync(file), { useTArray: true });
}

// 面積平均で縮める。1ドットおきに拾う（間引き）と線が消えるので使わない。
function shrink(img, outW) {
  const outH = Math.max(1, Math.round((img.height * outW) / img.width));
  const out = Buffer.alloc(outW * outH * 4, 255);
  const sx = img.width / outW;
  const sy = img.height / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const o = (y * outW + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return { width: outW, height: outH, data: out };
}

let saved = 0;
for (const t of TARGET) {
  const base = path.join(ROOT, t.dir);
  if (!fs.existsSync(base)) continue;
  for (const look of fs.readdirSync(base)) {
    const dir = path.join(base, look);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      const before = fs.statSync(file).size;
      const img = decode(file);
      if (img.width <= t.width) {
        console.log(`  そのまま ${t.dir}/${look}/${name} (${img.width}px)`);
        continue;
      }
      const small = shrink(img, t.width);
      const wantPng = t.as === 'png';
      const outName = name.replace(/\.(jpg|jpeg|png)$/i, wantPng ? '.png' : '.jpg');
      const buf = wantPng
        ? PNG.sync.write(Object.assign(new PNG({ width: small.width, height: small.height }), { data: small.data }))
        : jpeg.encode({ data: small.data, width: small.width, height: small.height }, 95).data;
      saved += before - buf.length;
      console.log(`  ${img.width}px→${t.width}px  ${(before / 1024).toFixed(0)}KB→${(buf.length / 1024).toFixed(0)}KB  ${t.dir}/${look}/${name}${outName !== name ? ` → ${outName}` : ''}`);
      if (WRITE) {
        fs.writeFileSync(path.join(dir, outName), buf);
        if (outName !== name) fs.unlinkSync(file);
      }
    }
  }
}
console.log(`合計 ${(saved / 1024 / 1024).toFixed(1)}MB 減る${WRITE ? '（書き換えました）' : '（--write で実行）'}`);
