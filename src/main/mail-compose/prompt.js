// src/main/mail-compose/prompt.js
// 宛名・プロンプト・署名の組み立て。Electron に依存しない純粋な関数だけを置く。

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// 宛名ブロックを作る。
// 会社名は独立した行、部署と氏名は同じ行。敬称は「氏名がある行」の末尾に付ける。
// 氏名も部署も無いときは会社名の行に敬称を付ける（例: 株式会社○○ 御中）。
function buildAddressBlock({ company, department, name, honorific } = {}) {
  const co = clean(company);
  const dept = clean(department);
  const nm = clean(name);
  const hon = clean(honorific);

  const personLine = [dept, nm].filter(Boolean).join(' ');
  const lines = [];

  if (personLine) {
    if (co) lines.push(co);
    lines.push(hon ? `${personLine} ${hon}` : personLine);
  } else if (co) {
    lines.push(hon ? `${co} ${hon}` : co);
  }
  return lines.join('\n');
}

module.exports = { buildAddressBlock };
