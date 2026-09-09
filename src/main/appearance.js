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
const HAIR_COLORS = [
  { id: 'brown', label: 'ブラウン', note: '今の髪色' },
];

const DEFAULT_STYLE = 'bob';
const DEFAULT_COLOR = 'brown';

function findStyle(id) {
  return HAIR_STYLES.find((s) => s.id === id) || HAIR_STYLES.find((s) => s.id === DEFAULT_STYLE);
}

function findColor(id) {
  return HAIR_COLORS.find((c) => c.id === id) || HAIR_COLORS.find((c) => c.id === DEFAULT_COLOR);
}

// 保存された値をそのまま信用せず、一覧にあるものだけに直す。
function normalizeAppearance(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    hairStyle: findStyle(r.hairStyle).id,
    hairColor: findColor(r.hairColor).id,
  };
}

// 画像を置くフォルダの名前。
// 既定の髪色のときは髪型の名前だけにする（今ある bob / straight-long がそれ）。
// 色ちがいを足すときは <髪型>-<髪色> になる。
function folderFor(appearance) {
  const a = normalizeAppearance(appearance);
  return a.hairColor === DEFAULT_COLOR ? a.hairStyle : `${a.hairStyle}-${a.hairColor}`;
}

module.exports = {
  EXPRESSIONS,
  HAIR_STYLES,
  HAIR_COLORS,
  DEFAULT_STYLE,
  DEFAULT_COLOR,
  findStyle,
  findColor,
  normalizeAppearance,
  folderFor,
};
