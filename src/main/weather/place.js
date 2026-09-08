// src/main/weather/place.js
// 設定に入れた地名から、天気を引ける名前の候補を作る。Electronにもネットワークにも依存しない。
//
// Open-Meteo の地名検索は**市区町村しか持っていない**。
// 「愛媛県」「大阪府」では1件も返ってこず、「松山市」なら返る（実測）。
// 都道府県名を入れた人にも天気を出すため、県庁所在地に読み替えて引き直す。

// 都道府県 → その県で天気を引く代表の市。県庁所在地を使う。
// 「東京都」は例外で、そのままの名前で引ける（実測）ので表には入れつつ同じ名前を返さない。
const PREFECTURE_CITY = {
  北海道: '札幌市',
  青森県: '青森市',
  岩手県: '盛岡市',
  宮城県: '仙台市',
  秋田県: '秋田市',
  山形県: '山形市',
  福島県: '福島市',
  茨城県: '水戸市',
  栃木県: '宇都宮市',
  群馬県: '前橋市',
  埼玉県: 'さいたま市',
  千葉県: '千葉市',
  東京都: '新宿区',
  神奈川県: '横浜市',
  新潟県: '新潟市',
  富山県: '富山市',
  石川県: '金沢市',
  福井県: '福井市',
  山梨県: '甲府市',
  長野県: '長野市',
  岐阜県: '岐阜市',
  静岡県: '静岡市',
  愛知県: '名古屋市',
  三重県: '津市',
  滋賀県: '大津市',
  京都府: '京都市',
  大阪府: '大阪市',
  兵庫県: '神戸市',
  奈良県: '奈良市',
  和歌山県: '和歌山市',
  鳥取県: '鳥取市',
  島根県: '松江市',
  岡山県: '岡山市',
  広島県: '広島市',
  山口県: '山口市',
  徳島県: '徳島市',
  香川県: '高松市',
  愛媛県: '松山市',
  高知県: '高知市',
  福岡県: '福岡市',
  佐賀県: '佐賀市',
  長崎県: '長崎市',
  熊本県: '熊本市',
  大分県: '大分市',
  宮崎県: '宮崎市',
  鹿児島県: '鹿児島市',
  沖縄県: '那覇市',
};

// 「愛媛」のように県を付けずに書く人もいるので、県名なしでも引けるようにする。
const SHORT_TO_FULL = {};
for (const full of Object.keys(PREFECTURE_CITY)) {
  const short = full.replace(/[都道府県]$/, '');
  if (short && short !== full) SHORT_TO_FULL[short] = full;
}

const MAX_CANDIDATES = 4;

// 入れてもらった地名から、順に試す名前を作る。前のものほど本人の書いた形に近い。
function candidates(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name) return [];

  const out = [name];
  const push = (v) => {
    if (v && !out.includes(v) && out.length < MAX_CANDIDATES) out.push(v);
  };

  // 都道府県そのもの（「愛媛県」→「松山市」）
  push(PREFECTURE_CITY[name]);
  // 県を省いた書き方（「愛媛」→「松山市」）
  push(PREFECTURE_CITY[SHORT_TO_FULL[name]]);
  // 「松山市」で見つからないときのために、末尾の市区町村も落としてみる
  const bare = name.replace(/[都道府県市区町村]$/, '');
  push(bare !== name ? bare : '');

  return out;
}

// 都道府県名を渡されたときに、その県を代表する市。無ければ空。
function representativeCity(value) {
  const name = String(value == null ? '' : value).trim();
  return PREFECTURE_CITY[name] || PREFECTURE_CITY[SHORT_TO_FULL[name]] || '';
}

module.exports = {
  PREFECTURE_CITY, SHORT_TO_FULL, MAX_CANDIDATES, candidates, representativeCity,
};
