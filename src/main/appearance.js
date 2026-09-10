// src/main/appearance.js
// 秘書子の見た目（髪型・髪色）の一覧と、画像の置き場所の決まり。
//
// 画像は「見た目の組み合わせ」ごとにフォルダを分ける。
//   assets/hishoko/<id>/normal.jpg   … 丸枠の表情（7種）
//   assets/office/<id>/day.jpg       … トップページの背景（2種）
//   assets/games/<id>/scene-idle.jpg … 息抜きの卓（3種）
//
// **1つの見た目につき12枚。** 画像を作るのは手作業なので、
// できたものから順に増やせるように、無い画像は既定の見た目に落とす。
// 落ちる仕組みが無いと、1枚足りないだけでその見た目が使いものにならない。

// 丸枠に出す表情。画面側（hishoko.js）の表情キーと1対1で対応する。
// sulk（ムッとした顔）は今どこにも出していないが、画像はそろえてある。
const EXPRESSIONS = ['normal', 'smile', 'thinking', 'trouble', 'hurry', 'praise', 'sulk'];

// 髪型。id はフォルダ名になるので ASCII にする（日本語だと URL に入れたときに面倒）。
const HAIR_STYLES = [
  { id: 'bob', label: 'ボブ', note: '肩より上で切りそろえた、今の髪型' },
  { id: 'straight-long', label: 'ストレートロング', note: '胸まで伸ばした、まっすぐな髪' },
];

// 髪色。**まだ色ちがいの画像が無いので、今は既定の1色だけ。**
// 画像ができたら、ここに足して <髪型>-<髪色> のフォルダを置けば増える。
// 髪色・肌色は**絵を持たない**。描くときにマスクの範囲だけ色相をずらす
// （scripts/make-masks.js が作った範囲を使う）。だから何色でも増やせる。
// ここにあるのは「よく使う色」の見本で、画面では自由な色も選べる。
const HAIR_COLORS = [
  { id: '', label: 'そのまま', hex: '' },
  { id: 'black', label: '黒', hex: '#2b2523' },
  { id: 'red-brown', label: '赤茶', hex: '#7a3020' },
  { id: 'blonde', label: '金', hex: '#c9a24a' },
  { id: 'ash', label: 'アッシュ', hex: '#8f9aa3' },
  { id: 'blue', label: '青', hex: '#3a5b8c' },
  { id: 'pink', label: '桃', hex: '#c96b93' },
  { id: 'purple', label: '紫', hex: '#7a4b8c' },
  { id: 'silver', label: '白銀', hex: '#d3d0cc' },
];

const SKIN_COLORS = [
  { id: '', label: 'そのまま', hex: '' },
  { id: 'fair', label: '色白', hex: '#f7e2d4' },
  { id: 'tan', label: '日焼け', hex: '#c98a5e' },
  { id: 'deep', label: '褐色', hex: '#a3653f' },
];

// 息抜きの卓の写真をどう置くか（scripts/measure-scene.js が採寸して書き出す）。
// 髪型ごとに頭の位置が違うので、共通の値だと**どれかの髪型で頭が切れる**。
// 実際、ストレートロングは頭がボブより2.2%高く、そのぶん切れていた。
// ファイルが無い・その髪型の分が無いときは、画面側のCSSの既定値のままになる。
let FRAMING = {};
try {
  // eslint-disable-next-line global-require
  FRAMING = require('./scene-framing.json');
} catch {
  FRAMING = {};   // 採寸していなくてもアプリは動く（既定の置き方になるだけ）
}

const DEFAULT_STYLE = 'bob';
// 色は絵を分けないので「既定の色」は空文字（＝元の絵のまま）。
const DEFAULT_COLOR = '';

function findStyle(id) {
  return HAIR_STYLES.find((s) => s.id === id) || HAIR_STYLES.find((s) => s.id === DEFAULT_STYLE);
}

// 色は #rrggbb か空文字（＝元の色のまま）。一覧に無い色も受け付ける
// （画面のカラーピッカーで自由に選べるようにするため）。
function normalizeHex(value) {
  const v = String(value == null ? '' : value).trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '';
}

// 保存された値をそのまま信用せず、一覧にあるものだけに直す。
function normalizeAppearance(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    hairStyle: findStyle(r.hairStyle).id,
    hairColor: normalizeHex(r.hairColor),
    skinColor: normalizeHex(r.skinColor),
  };
}

// 画像を置くフォルダの名前。
// 既定の髪色のときは髪型の名前だけにする（今ある bob / straight-long がそれ）。
// 色ちがいを足すときは <髪型>-<髪色> になる。
// 画像を置くフォルダは**髪型だけ**で決まる。
// 色は絵を分けず、描くときに変えるので、フォルダは増えない。
function folderFor(appearance) {
  return normalizeAppearance(appearance).hairStyle;
}

// その見た目の卓の置き方。採寸していなければ空（画面側の既定が使われる）。
function framingFor(appearance) {
  return FRAMING[folderFor(appearance)] || {};
}

module.exports = {
  EXPRESSIONS,
  FRAMING,
  framingFor,
  HAIR_STYLES,
  HAIR_COLORS,
  DEFAULT_STYLE,
  DEFAULT_COLOR,
  findStyle,
  SKIN_COLORS,
  normalizeHex,
  normalizeAppearance,
  folderFor,
};
