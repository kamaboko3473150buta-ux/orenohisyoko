// src/main/docgen/images.js
// 添付資料（docx/pptx/xlsx）の中に埋め込まれた画像を取り出す。
// プレゼン資料を「文字だらけ」にしないための材料集め。PDFは画像抽出の仕組みが違うため対象外。
//
// 方針: readers.js と同じく、1つのファイルが壊れていても他のファイルの処理を続けられるように
// 例外を投げない。zipが開けない・エントリが読めない、といった失敗はすべて
// 「その1件（またはその1枚）を諦めて次へ」で処理する。

const fs = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif'];
const OFFICE_ZIP_EXTENSIONS = ['.docx', '.pptx', '.xlsx'];
const MIN_BYTES = 8000; // これ未満はアイコン・装飾とみなして捨てる
const MAX_IMAGES = 20; // 多すぎても使い切れないので上限を設ける

const MEDIA_FOLDER_RE = /^(?:word|ppt|xl)\/media\//i;

// 「image2」が「image10」より先に来るよう、数字部分は数値として比較する自然順ソート。
// 文字列部分と数字部分に分割し、両方が数字の並びのときだけ数値として比較する。
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const pa = String(a).match(re) || [];
  const pb = String(b).match(re) || [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] || '';
    const y = pb[i] || '';
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    } else if (x < y) {
      return -1;
    } else if (x > y) {
      return 1;
    }
  }
  return 0;
}

// zip の中のエントリ名一覧から、埋め込み画像とみなせるものだけを選ぶ純粋関数。
// word/media・ppt/media・xl/media 配下の対応拡張子のみを対象にし、番号順に並べる。
function pickImageEntries(zipEntryNames) {
  const names = Array.isArray(zipEntryNames) ? zipEntryNames : [];
  return names
    .filter((n) => typeof n === 'string' && MEDIA_FOLDER_RE.test(n))
    .filter((n) => IMAGE_EXTENSIONS.includes(path.extname(n).toLowerCase()))
    .sort(naturalCompare);
}

// 1件のOffice文書（zip）から画像バイナリを読み出す。壊れたzip・読めないエントリは
// 例外を投げず、読めたものだけを返す（呼び出し元でファイル単位／画像単位のスキップとして扱う）。
function readImageBuffersFromZip(filePath) {
  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch (err) {
    return [];
  }

  let entryNames;
  try {
    entryNames = zip.getEntries().map((e) => e.entryName);
  } catch (err) {
    return [];
  }

  const picked = pickImageEntries(entryNames);
  const out = [];
  for (const name of picked) {
    try {
      const entry = zip.getEntry(name);
      if (!entry) continue;
      const data = zip.readFile(entry);
      if (!data) continue;
      out.push({ name, data });
    } catch (err) {
      // この1枚だけ諦めて続ける
    }
  }
  return out;
}

// 添付ファイル群から画像を取り出し、outDir にファイルとして書き出す。
// 例外は投げない。対象外の形式・壊れたファイルは黙って飛ばし、他のファイルの処理を続ける。
// outDir は呼び出し側が用意した一時フォルダを想定（使い終わったら消すのは呼び出し側の責任）。
async function extractImages(filePaths, outDir) {
  const list = Array.isArray(filePaths) ? filePaths : [];
  const images = [];
  let counter = 0;

  for (const filePath of list) {
    if (images.length >= MAX_IMAGES) break;

    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (!OFFICE_ZIP_EXTENSIONS.includes(ext)) continue; // PDF・テキスト等は対象外

    const buffers = readImageBuffersFromZip(filePath);
    for (const { name, data } of buffers) {
      if (images.length >= MAX_IMAGES) break;
      if (!data || data.length < MIN_BYTES) continue; // アイコン・装飾とみなして捨てる

      counter += 1;
      const id = `img-${counter}`;
      const outExt = path.extname(name).toLowerCase();
      const outPath = path.join(outDir, `${id}${outExt}`);
      try {
        await fs.writeFile(outPath, data);
      } catch (err) {
        counter -= 1; // 書き出せなかった分は番号を戻して次へ
        continue;
      }

      images.push({
        id,
        path: outPath,
        sourceName: path.basename(String(filePath || '')),
        bytes: data.length,
      });
    }
  }

  return images;
}

module.exports = {
  IMAGE_EXTENSIONS,
  MIN_BYTES,
  MAX_IMAGES,
  pickImageEntries,
  extractImages,
};
