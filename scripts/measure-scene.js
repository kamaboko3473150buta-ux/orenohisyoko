// scripts/measure-scene.js
// 息抜きの卓の写真を採寸して、見た目ごとの表示位置を出す。
//
//   node scripts/measure-scene.js
//
// 写真は下端をそろえて置き、はみ出したぶんを下に押し出している（styles.css）。
// 押し出す量が写真に合っていないと、**秘書子の頭が上で切れる**。
// この量は髪型ごとに違う（ストレートロングは頭の位置がボブより2.2%高かった）。
//
// 髪型を足すたびに手で測っていると、いつか必ず測り忘れる。
// ここで測って src/main/scene-framing.json に書き出し、アプリはそれを読む。
const fs = require('node:fs');
const path = require('node:path');
const jpeg = require('jpeg-js');

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'assets', 'games');
const OUT = path.join(ROOT, 'src', 'main', 'scene-framing.json');

const MOODS = ['idle', 'joy', 'sulk'];
// 写真を出す窓の高さ（幅に対する割合）。styles.css の .scene-figure と同じ値。
const WINDOW = 0.545;
// 頭の上に残す余白（幅に対する割合）。0だと「ぎりぎり切れていない」になり、
// 画像が少し変わっただけで切れる。
const HEAD_MARGIN = 0.015;
// 左右の枠を切り落とすための拡大率。写真の縁に額のような枠が入っているため。
const ZOOM = { idle: 1.0, joy: 1.0544, sulk: 1.0544 };
// これまでの見え方（styles.css の値）。**頭が切れないなら動かさない。**
// 「いつも同じ余白にそろえる」ようにすると、今きれいに見えている画面まで作り変えてしまう。
const KEEP = { idle: 0.1889, joy: 0.1620, sulk: 0.1147 };

function decode(file) {
  return jpeg.decode(fs.readFileSync(file), { useTArray: true });
}

// 中央の列で、明るい天井から暗い髪に変わる最初の行＝頭のてっぺん。
function headTop({ width: W, height: H, data: D }) {
  const col = Math.round(W * 0.5);
  for (let y = 0; y < H; y++) {
    let dark = 0;
    for (let x = col - 60; x <= col + 60; x += 4) {
      const i = (y * W + x) * 4;
      if ((D[i] + D[i + 1] + D[i + 2]) / 3 < 120) dark++;
    }
    if (dark >= 6) return y / H;
  }
  return 0.15;   // 見つからなければ、これまでの実測に近い値にしておく
}

// その行の中央あたりの色。継ぎ目から下に描く天板の色に使う。
function rowColor({ width: W, height: H, data: D }, frac) {
  const y = Math.min(H - 1, Math.max(0, Math.round(frac * H)));
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let x = Math.round(W * 0.3); x < Math.round(W * 0.7); x += 3) {
    const i = (y * W + x) * 4;
    r += D[i]; g += D[i + 1]; b += D[i + 2]; n++;
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function measureMood(file, mood) {
  const img = decode(file);
  const zoom = ZOOM[mood];
  const ratio = img.height / img.width;
  const photo = zoom * ratio;                 // 写真の高さ（窓の幅に対する割合）
  const head = headTop(img);

  // 頭のてっぺんが窓の上端より HEAD_MARGIN だけ下に来るように押し出す量を決める。
  //   頭の位置 = 窓の高さ + 押し出す量 - 写真の高さ + 写真の高さ×頭の割合
  const needed = HEAD_MARGIN - WINDOW + photo * (1 - head);
  // 足りないときだけ押し出しを増やす。足りているならこれまでの値のまま。
  let under = Math.max(KEEP[mood], needed);
  under = Math.min(0.30, Math.max(0.05, under));

  // 継ぎ目（窓の下端）が写真のどの行に当たるか。そこの色を天板の色にする。
  const seam = (photo - under) / photo;
  return {
    zoom: Number((zoom * 100).toFixed(2)),
    under: Number((under * 100).toFixed(2)),
    woodTop: rowColor(img, seam),
    woodBottom: rowColor(img, Math.min(0.999, seam + (1 - seam) * 0.9)),
    // 参考（人が見て確かめるため）
    headTopPercent: Number((head * 100).toFixed(1)),
    changed: under > KEEP[mood] + 0.0001,
  };
}

function main() {
  const looks = fs.readdirSync(GAMES).filter((d) => fs.statSync(path.join(GAMES, d)).isDirectory());
  const out = {};
  for (const look of looks) {
    out[look] = {};
    for (const mood of MOODS) {
      const file = path.join(GAMES, look, `scene-${mood}.jpg`);
      if (!fs.existsSync(file)) continue;
      out[look][mood] = measureMood(file, mood);
      const m = out[look][mood];
      console.log(`${look.padEnd(14)} ${mood.padEnd(5)} 頭 ${String(m.headTopPercent).padStart(5)}%  押し出し ${String(m.under).padStart(5)}%  天板 ${m.woodTop}  ${m.changed ? '← 切れるので下げた' : ''}`);
    }
  }
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log('->', path.relative(ROOT, OUT));
}

main();
