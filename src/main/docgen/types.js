// src/main/docgen/types.js
// 資料作成で選べる資料の種類。guide はプロンプトにそのまま埋め込まれ、AIへの指示になる
// （mail-compose/scenes.js の SCENES/TONES と同じ考え方）。

const DOC_TYPES = [
  {
    id: 'presentation',
    label: 'プレゼン資料',
    defaultFormat: 'pptx',
    guide: '1スライド1メッセージにする。箇条書きは1行を短くし、詳しい説明はノート的な補足に回す。',
  },
  {
    id: 'report',
    label: 'レポート',
    defaultFormat: 'docx',
    guide: '冒頭に「結論」を置き、次に「根拠」、そのあとに詳細を続ける。読み手が知りたい結論に最速で辿り着ける構成にする。'
      + '数値データを示すときは文章で並べず、見出し・列（headers）と行（rows）が揃った表（table）にする。',
  },
  {
    id: 'minutes',
    label: '議事録',
    defaultFormat: 'docx',
    guide: '会議の日時・場所・出席者は本文の見出しにせず、meta（{label, value}の一覧）として渡す。'
      + '「決定事項」と「宿題」の見出しを必ず立て、宿題は「項目・担当・期限」の3列の表（table）にする。'
      + '発言をそのまま書き写すのではなく、要点だけをまとめる。',
  },
  {
    id: 'internal',
    label: '社内文書',
    defaultFormat: 'docx',
    guide: '発信日・宛先・発信者・件名は本文の見出しにせず、meta（{label, value}の一覧）として渡す。'
      + '前置きの儀礼的な文章は最小限にし、用件を簡潔に伝える。'
      + '本文のあとに「記」書き（箇条書き）を置き、誰が・いつまでに・何をするのかを整理する。',
  },
  {
    id: 'handover',
    label: '引継ぎ資料',
    defaultFormat: 'docx',
    guide: '「業務の概要」「手順」「注意点」「連絡先」「よくあるトラブル」の見出しを必ず立てる。'
      + '手順は番号付きの箇条書きにする。連絡先は表（table）にする。'
      + '前提知識のない人が読んでも分かる書き方にする。',
  },
];

// 見つからなければ report を既定にする（種類の指定が壊れていても資料作成自体は続けられるように）。
function findDocType(id) {
  return DOC_TYPES.find((t) => t.id === id) || DOC_TYPES.find((t) => t.id === 'report');
}

module.exports = { DOC_TYPES, findDocType };
