// src/main/docgen/image-size.js
// 画像ファイルの縦横の大きさをファイルの中身から読む。
//
// Word に画像を差し込むときは幅と高さを指定しなければならず、決め打ちにすると
// 縦長のスクリーンショットが横に潰れる。画像ライブラリを足すほどのことでもないので、
// PNG と JPEG のヘッダだけを自前で読む（スクリーンショットはこの2つで足りる）。
// 読めない形式は null を返し、呼び出し側で「差し込まない」判断をする。

// PNG は先頭8バイトが決まった並びで、そのすぐ後の IHDR に大きさが入っている。
function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < signature.length; i += 1) {
    if (buf[i] !== signature[i]) return null;
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// JPEG はマーカーを順にたどり、SOF（フレーム開始）に大きさが入っている。
// SOF は種類が複数あり、DHT/DRI などの別マーカーは長さぶん読み飛ばす。
const SOF_MARKERS = new Set([
  0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
]);

function jpegSize(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;   // SOI が無ければJPEGでない
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i += 1; continue; }            // 詰め物をまたぐ
    const marker = buf[i + 1];
    if (marker === 0xFF) { i += 1; continue; }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      i += 2;                                             // 長さを持たないマーカー
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;                          // 壊れている
    if (SOF_MARKERS.has(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function imageSize(buf) {
  return pngSize(buf) || jpegSize(buf);
}

// 指定した幅に収まるよう縮める。もとが小さければ拡大はしない
// （粗い画像を引き伸ばすと、かえって見づらくなるため）。
function fitWidth(size, maxWidth) {
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  const limit = Number(maxWidth) > 0 ? Number(maxWidth) : size.width;
  if (size.width <= limit) return { width: size.width, height: size.height };
  const scale = limit / size.width;
  return { width: Math.round(limit), height: Math.max(1, Math.round(size.height * scale)) };
}

module.exports = { pngSize, jpegSize, imageSize, fitWidth };
