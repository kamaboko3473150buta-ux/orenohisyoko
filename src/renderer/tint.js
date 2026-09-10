// src/renderer/tint.js
// 髪・肌の色を、描くときに変える。
//
// ゲームのキャラクリと同じ考え方で、**色ちがいの絵は持たない**。
// 絵1枚につき範囲（マスク）を1つ持っておき、その範囲の色相だけを置き換える。
// 彩度と明度は元の値に掛け算するので、艶と陰影がそのまま残る。
//
// マスクは scripts/make-masks.js が作ったグレースケールPNG（0=なし 1=髪 2=肌）。
window.Tint = (function () {
  // 同じ絵・同じ色の組み合わせを何度も作り直さない。
  // トップページの背景は240万画素あり、毎回やると画面の切り替えが目に見えて遅くなる。
  const cache = new Map();

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

  function hexToHsl(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }

  function load(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function readPixels(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { canvas: c, ctx, data: ctx.getImageData(0, 0, c.width, c.height) };
  }

  // その範囲の「平均の色」を目標色にそろえる。
  //
  // 色相を置き換えるだけだと、茶色から金髪にしたときに暗いままになる。
  // 平均が目標色になるよう彩度と明度に倍率をかけると、選んだ色そのものに見える。
  function applyOne(px, mask, want, markValue) {
    let sumS = 0; let sumL = 0; let n = 0;
    for (let p = 0; p < mask.length; p += 4) {
      if (mask[p] !== markValue) continue;
      const [, s, l] = rgbToHsl(px[p], px[p + 1], px[p + 2]);
      sumS += s; sumL += l; n++;
    }
    if (!n) return;
    const meanS = sumS / n; const meanL = sumL / n;
    const satScale = meanS > 0.02 ? want[1] / meanS : 1;
    const lightScale = meanL > 0.02 ? want[2] / meanL : 1;
    for (let p = 0; p < mask.length; p += 4) {
      if (mask[p] !== markValue) continue;
      const [, s, l] = rgbToHsl(px[p], px[p + 1], px[p + 2]);
      const [r, g, b] = hslToRgb(
        want[0],
        Math.max(0, Math.min(1, s * satScale)),
        Math.max(0, Math.min(1, l * lightScale)),
      );
      px[p] = r; px[p + 1] = g; px[p + 2] = b;
    }
  }

  // 色を変えた絵のURLを返す。変える必要がなければ元のURLをそのまま返す。
  // マスクが無い絵も、そのまま返す（色は変わらないが画面は壊れない）。
  async function url(baseUrl, colors) {
    const hair = hexToHsl(colors && colors.hair);
    const skin = hexToHsl(colors && colors.skin);
    if (!hair && !skin) return baseUrl;

    const key = `${baseUrl}|${(colors && colors.hair) || ''}|${(colors && colors.skin) || ''}`;
    if (cache.has(key)) return cache.get(key);

    const maskUrl = baseUrl.replace(/\.(png|jpg|jpeg)(\?.*)?$/i, '.mask.png');
    const [img, maskImg] = await Promise.all([load(baseUrl), load(maskUrl)]);
    if (!img || !maskImg) return baseUrl;

    const base = readPixels(img);
    const mask = readPixels(maskImg);
    if (mask.data.width !== base.data.width || mask.data.height !== base.data.height) return baseUrl;

    const px = base.data.data;
    const mk = mask.data.data;
    if (hair) applyOne(px, mk, hair, 1);
    if (skin) applyOne(px, mk, skin, 2);
    base.ctx.putImageData(base.data, 0, 0);

    // 大きい絵は PNG だと5MBを超える。見えない差なので JPEG にして軽くする
    // （丸枠のような小さい絵は PNG のまま。文字や細い線が多いため）。
    const big = base.canvas.width > 600;
    const out = big
      ? base.canvas.toDataURL('image/jpeg', 0.92)
      : base.canvas.toDataURL('image/png');
    cache.set(key, out);
    return out;
  }

  return {
    url, hexToHsl, rgbToHsl, hslToRgb, clear: () => cache.clear(),
  };
}());
