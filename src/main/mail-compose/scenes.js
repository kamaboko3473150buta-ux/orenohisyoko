// src/main/mail-compose/scenes.js
// メール文面作成の「場面」と「文体」の定義。
// guide はプロンプトにそのまま埋め込まれ、AIへの指示になる。

const SCENES = [
  { id: 'thanks', label: '御礼',
    guide: '相手にしてもらったことへの感謝を具体的に述べる。社交辞令だけで終わらせず、何に対する礼なのかを明確にする。' },
  { id: 'apology', label: '謝罪',
    guide: '何について詫びるのかを最初に明確に述べ、言い訳を並べない。可能なら再発防止か対応策に触れる。' },
  { id: 'schedule', label: '日程調整',
    guide: '目的を述べたうえで日程の候補や希望を示し、相手が返信しやすい形にする。所要時間や場所にも触れる。' },
  { id: 'request', label: '依頼',
    guide: '何を・いつまでに・なぜ必要かを明確に伝える。相手の負担に配慮する一文を添える。' },
  { id: 'report', label: '報告',
    guide: '結論を先に書き、経緯や詳細をそのあとに続ける。相手に判断や対応を求める場合はそれを明示する。' },
  { id: 'reminder', label: '督促',
    guide: '相手を責める調子にせず、行き違いの可能性に配慮しつつ、期限と必要な対応を明確に伝える。' },
  { id: 'decline', label: 'お断り',
    guide: '感謝や打診への謝意を述べたうえで、断る旨を曖昧にせず伝える。理由は簡潔にし、今後の関係に配慮する。' },
  { id: 'greeting', label: '挨拶',
    guide: '就任・異動・年始などの挨拶。時候や立場に触れ、今後の関係への意欲を述べる。' },
  { id: 'inquiry', label: '問い合わせ',
    guide: '何について知りたいのかを具体的に列挙し、回答しやすい形で尋ねる。急ぎなら期限を添える。' },
  { id: 'other', label: 'その他',
    guide: 'メモの内容から用件を読み取り、その用件にふさわしい構成のビジネスメールにする。' },
];

const TONES = [
  { id: 'formal_external', label: 'かしこまった社外向け',
    guide: '初対面や目上の取引先に送る、格式のある丁寧な文体。定型の挨拶と結語を用いる。' },
  { id: 'standard_external', label: '標準的な社外向け',
    guide: '日常的にやりとりのある取引先向け。丁寧だが過度にかしこまらない文体。' },
  { id: 'internal', label: '社内向け・簡潔に',
    guide: '社内の相手向け。前置きを短くし、用件を簡潔に伝える。時候の挨拶は使わない。' },
  { id: 'friendly', label: '親しい相手にやわらかく',
    guide: '付き合いの長い相手向け。敬意は保ちつつ、堅苦しさを避けたやわらかい表現にする。' },
];

function findScene(id) {
  return SCENES.find((s) => s.id === id) || SCENES[SCENES.length - 1]; // 既定: other
}

function findTone(id) {
  return TONES.find((t) => t.id === id) || TONES[0]; // 既定: formal_external
}

module.exports = { SCENES, TONES, findScene, findTone };
