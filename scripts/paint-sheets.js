// scripts/paint-sheets.js
// マスクを手で直すためのシートを書き出す／読み戻す。
//
//   node scripts/paint-sheets.js out    … paint/ にシートを書き出す
//   node scripts/paint-sheets.js in     … 塗ったシートを読んでマスクを作り直す
//
// **なぜ手で塗るのか。**
// まつ毛・眉毛・虹彩・首の影・線画は、髪とまったく同じ色をしている。
// 「この暗い茶色は髪か、まつ毛か」は色や形の問題ではなく意味の問題で、
// 機械には決められない。条件を足すたびに、別の表情で破綻した。
// ゲームでもマスクは絵と一緒に人が作る。
//
// **塗りは大雑把でよい。**
// 塗った範囲は「どのあたりが髪か」を伝えるだけに使い、
// **どの画素が髪かは、その中で色の判定に任せる**（輪郭は機械のほうが正確）。
// はみ出しても、そこに髪の色が無ければ拾われない。
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const lib = require('./mask-lib');

const ROOT = path.join(__dirname, '..');
const PAINT = path.join(ROOT, 'paint');
const INDEX = path.join(PAINT, '_index.json');
const DIRS = ['assets/hishoko', 'assets/office', 'assets/games'];

// 画面に出す日本語の名前。どの絵を塗っているのか分かるようにする。
const PLACE = { hishoko: '丸枠', office: 'トップ', games: '息抜き' };
const LOOK = { bob: 'ボブ', 'straight-long': 'ストレートロング' };
const FACE = {
  normal: '微笑', smile: '笑顔', thinking: '真剣', trouble: '困り顔',
  hurry: '怒り顔', praise: '照れ顔', sulk: 'ムッとした顔',
  day: '昼', night: '夜',
  'scene-idle': '通常', 'scene-joy': '勝利', 'scene-sulk': '敗北',
};

function listImages() {
  const out = [];
  for (const dir of DIRS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const look of fs.readdirSync(base)) {
      const d = path.join(base, look);
      if (!fs.statSync(d).isDirectory()) continue;
      for (const name of fs.readdirSync(d)) {
        if (!/\.(png|jpg|jpeg)$/i.test(name)) continue;
        if (name.endsWith('.mask.png')) continue;
        out.push({ dir, look, name, file: path.join(d, name) });
      }
    }
  }
  return out;
}

function readMask(file) {
  if (!fs.existsSync(file)) return null;
  const p = PNG.sync.read(fs.readFileSync(file));
  const m = new Uint8Array(p.width * p.height);
  for (let i = 0; i < m.length; i++) m[i] = p.data[i * 4];
  return m;
}

function writeOut() {
  fs.mkdirSync(PAINT, { recursive: true });
  const items = listImages();
  const index = [];
  items.forEach((it, n) => {
    const img = lib.decode(it.file);
    const mask = readMask(it.file.replace(/\.(png|jpg|jpeg)$/i, '.mask.png'));
    const png = new PNG({ width: img.width, height: img.height });
    for (let p = 0; p < img.width * img.height; p++) {
      const i = p * 4;
      if (mask && mask[p] === 1) { png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 0; }
      else if (mask && mask[p] === 2) { png.data[i] = 0; png.data[i + 1] = 255; png.data[i + 2] = 0; }
      else {
        // 塗っていないところは灰色の下絵。**赤にも緑にも近づけない**ので、
        // 読み戻すときに塗りと取り違えない。
        const g = Math.round(
          (img.data[i] * 0.30 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11) * 0.45 + 120,
        );
        png.data[i] = g; png.data[i + 1] = g; png.data[i + 2] = g;
      }
      png.data[i + 3] = 255;
    }
    const place = PLACE[it.dir.replace('assets/', '')] || it.dir;
    const label = `${String(n + 1).padStart(2, '0')}_${place}_${LOOK[it.look] || it.look}_${FACE[it.name.replace(/\.(png|jpg|jpeg)$/i, '')] || it.name}`;
    const dest = path.join(PAINT, `${label}.png`);
    fs.writeFileSync(dest, PNG.sync.write(png));
    index.push({ sheet: `${label}.png`, target: path.relative(ROOT, it.file).replace(/\\/g, '/') });
    console.log('  ', `${label}.png`);
  });
  fs.writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`\n${items.length}枚を paint/ に書き出しました。`);
  console.log('赤(255,0,0)=髪 / 緑(0,255,0)=肌 / それ以外の色=どちらでもない');
  console.log('塗りは大雑把で構いません（輪郭は機械が合わせます）。');
}

function readIn() {
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  for (const row of index) {
    const sheetFile = path.join(PAINT, row.sheet);
    if (!fs.existsSync(sheetFile)) { console.log('  シートが無い:', row.sheet); continue; }
    const sheet = PNG.sync.read(fs.readFileSync(sheetFile));
    const img = lib.decode(path.join(ROOT, row.target));
    if (sheet.width !== img.width || sheet.height !== img.height) {
      console.log('  大きさが違う（塗り直しが必要）:', row.sheet);
      continue;
    }
    // 塗った色を読む。にじみに強いよう、どの色に近いかで決める。
    const painted = new Uint8Array(img.width * img.height);
    for (let p = 0; p < painted.length; p++) {
      const r = sheet.data[p * 4]; const g = sheet.data[p * 4 + 1]; const b = sheet.data[p * 4 + 2];
      if (r > 150 && g < 110 && b < 110) painted[p] = 1;
      else if (g > 150 && r < 110 && b < 110) painted[p] = 2;
    }
    // 塗った範囲を、**内側と縁で扱い分ける。**
    //
    // 内側 … 塗りを信じてほぼそのまま採る。線画は真っ黒に近く彩度も無いので、
    //        色の判定に通すと落ちてしまい、**線のまわりだけ色が変わらない**。
    //        線も髪の一部なので、色相を回してやったほうが自然に見える。
    // 縁   … 色の判定で絞る。ここで輪郭が元の絵に沿い、塗りのはみ出しが消える。
    //        だから塗りは大雑把でよい。
    const hairPaint = new Uint8Array(painted.length);
    const skinPaint = new Uint8Array(painted.length);
    for (let p = 0; p < painted.length; p++) {
      if (painted[p] === 1) hairPaint[p] = 1;
      else if (painted[p] === 2) skinPaint[p] = 1;
    }
    const edge = Math.max(2, Math.round(img.width / 160));
    const hairInner = lib.grow(img, hairPaint, edge, false);
    const skinInner = lib.grow(img, skinPaint, edge, false);

    const hairRaw = lib.buildMask(img, lib.RULES.hair);
    const wide = lib.buildMask(img, { ...lib.RULES.hair, lMax: 0.78, sMin: 0.06 });
    const skinRaw = lib.buildMask(img, { ...lib.RULES.skin, lMin: 0.45, sMin: 0.30 });
    // 内側でも、これだけは採らない（塗りが多少ずれても壊れないように）。
    const skinStrict = lib.buildMask(img, lib.RULES.skin);
    const isLightBack = (p) => {
      const i = p * 4;
      const [, s, l] = lib.rgbToHsl(img.data[i], img.data[i + 1], img.data[i + 2]);
      return l > 0.72 && s < 0.30;   // 明るい壁・窓・白い服
    };

    const out = new PNG({ width: img.width, height: img.height, colorType: 0 });
    let hair = 0; let skin = 0;
    for (let p = 0; p < painted.length; p++) {
      let v = 0;
      if (hairPaint[p]) {
        if (hairInner[p]) v = skinStrict[p] || isLightBack(p) ? 0 : 1;
        else if (hairRaw[p] || wide[p]) v = 1;
      } else if (skinPaint[p]) {
        if (skinInner[p]) v = isLightBack(p) ? 0 : 2;
        else if (skinRaw[p]) v = 2;
      }
      if (v === 1) hair++;
      if (v === 2) skin++;
      out.data[p] = v;
    }
    const dest = path.join(ROOT, row.target).replace(/\.(png|jpg|jpeg)$/i, '.mask.png');
    fs.writeFileSync(dest, PNG.sync.write(out, { colorType: 0, inputColorType: 0 }));
    const total = img.width * img.height;
    console.log(`  ${row.sheet.padEnd(34)} 髪${(100 * hair / total).toFixed(1)}%  肌${(100 * skin / total).toFixed(1)}%`);
  }
  console.log('\nマスクを作り直しました。');
}

const mode = process.argv[2];
if (mode === 'out') writeOut();
else if (mode === 'in') readIn();
else console.log('使い方: node scripts/paint-sheets.js out | in');
