// Windows 用ワークアラウンド。
// electron のインストーラが使う extract-zip が一部の Windows 環境で機能せず、
// dist に LICENSES.chromium.html だけを残して electron.exe を展開できないことがある
// （ダウンロード自体は成功し、zip は %LOCALAPPDATA%\electron\Cache に置かれる）。
// その場合、ダウンロード済みの zip を PowerShell の Expand-Archive で展開し直す。
// electron.exe が既に存在する／Windows 以外なら何もしない（postinstall から安全に呼べる）。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'win32') process.exit(0);

const elDir = path.join(__dirname, '..', 'node_modules', 'electron');
const dist = path.join(elDir, 'dist');
const distExe = path.join(dist, 'electron.exe');
if (fs.existsSync(distExe)) process.exit(0); // 既に正常

let version;
try {
  version = require(path.join(elDir, 'package.json')).version;
} catch {
  process.exit(0); // electron 未インストール
}

const cacheRoot = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'electron', 'Cache'
);
const zipName = `electron-v${version}-win32-${process.arch === 'ia32' ? 'ia32' : 'x64'}.zip`;

function findZip(dir) {
  let found = null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { found = findZip(p); if (found) return found; }
    else if (e.name === zipName) return p;
  }
  return found;
}

const zip = findZip(cacheRoot);
if (!zip) {
  console.error(`[fix-electron] キャッシュに ${zipName} が見つかりません。ネットワーク接続のある環境で 'npm install' を実行してください。`);
  process.exit(0);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-Command',
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dist}' -Force`,
], { stdio: 'inherit' });
fs.writeFileSync(path.join(elDir, 'path.txt'), 'electron.exe');

if (fs.existsSync(distExe)) {
  console.log('[fix-electron] Expand-Archive で electron.exe を展開しました。');
} else {
  console.error('[fix-electron] 展開を試みましたが electron.exe を確認できませんでした。');
}
