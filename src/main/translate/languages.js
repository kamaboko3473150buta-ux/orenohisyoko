// src/main/translate/languages.js
// 言語翻訳の対象言語一覧（一覧から選ぶ＋自由入力を許すための照合）。
// Electron非依存の純粋な定数・関数のみを置く。

const LANGUAGES = [
  { id: 'en', label: '英語' },
  { id: 'vi', label: 'ベトナム語' },
  { id: 'zh-CN', label: '中国語（簡体）' },
  { id: 'zh-TW', label: '中国語（繁体）' },
  { id: 'ko', label: '韓国語' },
  { id: 'th', label: 'タイ語' },
  { id: 'id', label: 'インドネシア語' },
  { id: 'pt', label: 'ポルトガル語' },
  { id: 'es', label: 'スペイン語' },
  { id: 'ja', label: '日本語' },
];

// 一覧のid・labelどちらでも見つけられるようにする（自由入力の言語名はここでは
// 見つからず null になるが、それ自体は正常——一覧に無い言語も選べる仕様のため）。
// idは大文字小文字を区別しない（"EN"のような入力でも拾えるように）。
function findLanguage(idOrLabel) {
  const q = typeof idOrLabel === 'string' ? idOrLabel.trim() : '';
  if (!q) return null;
  const lower = q.toLowerCase();
  return LANGUAGES.find((l) => l.id.toLowerCase() === lower || l.label === q) || null;
}

module.exports = { LANGUAGES, findLanguage };
