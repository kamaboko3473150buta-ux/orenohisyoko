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
    guide: '結論を先に述べ、根拠となるデータや経緯をそのあとに続ける。読み手が知りたい結論に最速で辿り着ける構成にする。',
  },
  {
    id: 'minutes',
    label: '議事録',
    defaultFormat: 'docx',
    guide: '「決定事項」と「宿題（誰が・いつまでに）」の見出しを必ず立てる。発言をそのまま書き写すのではなく、要点だけをまとめる。',
  },
  {
    id: 'internal',
    label: '社内文書',
    defaultFormat: 'docx',
    guide: '前置きの儀礼的な文章は最小限にし、用件を簡潔に伝える。誰が・いつまでに・何をするのかを明確にする。',
  },
  {
    id: 'handover',
    label: '引継ぎ資料',
    defaultFormat: 'docx',
    guide: '手順・注意点・連絡先・よくあるトラブルの見出しを立てる。前提知識のない人が読んでも分かる書き方にする。',
  },
];

// 見つからなければ report を既定にする（種類の指定が壊れていても資料作成自体は続けられるように）。
function findDocType(id) {
  return DOC_TYPES.find((t) => t.id === id) || DOC_TYPES.find((t) => t.id === 'report');
}

module.exports = { DOC_TYPES, findDocType };
