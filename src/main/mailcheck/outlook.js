// src/main/mailcheck/outlook.js
// インストール済みの Outlook（デスクトップ版）を COM 経由で読む。
// すでにサインイン済みの Outlook を使うので、パスワードの入力も保存も要らない。
// 下書きを開く機能（mail-compose/draft.js）と同じやり方にそろえてある。

const path = require('node:path');
const { execFile } = require('node:child_process');
const query = require('./query');

const TIMEOUT_MS = 60000;
const LIMIT = 300;   // 直近何通まで見るか。多すぎると Outlook の応答が遅くなる

// パッケージ後(.exe)は __dirname が app.asar 内を指す。PowerShell は asar 内のファイルを
// 実行できないため、asarUnpack で実体化した app.asar.unpacked 側を参照する。
function resolveScriptPath(baseDir = __dirname) {
  let ps1 = path.join(baseDir, 'check-outlook.ps1');
  if (ps1.includes(`app.asar${path.sep}`)) {
    ps1 = ps1.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  }
  return ps1;
}

// PowerShell が返した JSON を配列にする。壊れていても例外にせず、理由を返す。
function parseScriptOutput(stdout) {
  const text = String(stdout == null ? '' : stdout).trim();
  if (!text) return { ok: true, rows: [] };
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { ok: true, rows: parsed };
    if (parsed && typeof parsed === 'object') return { ok: true, rows: [parsed] };
    return { ok: false, message: 'Outlookからの応答を読み取れませんでした。' };
  } catch {
    return { ok: false, message: 'Outlookからの応答を読み取れませんでした。' };
  }
}

// Outlook が入っていない・プロファイルが無いといった、よくある失敗を言葉にする。
function classify(stderr, err) {
  const text = String(stderr || (err && err.message) || '');
  if (/800401f3|Outlook\.Application|クラスが登録されていません|Invalid class/i.test(text)) {
    return {
      kind: 'not-installed',
      message: 'Outlook（デスクトップ版）が見つかりませんでした。インストールされているか確認してください。',
    };
  }
  if (/profile|プロファイル/i.test(text)) {
    return { kind: 'no-profile', message: 'Outlookのプロファイルが設定されていません。一度Outlookを起動して設定してください。' };
  }
  return { kind: 'unknown', message: `Outlookの確認に失敗しました: ${text.trim() || '原因不明'}` };
}

function runScript(args) {
  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolveScriptPath(), ...args,
    ], { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
    (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
}

// Outlook が使える状態かを確かめる（設定画面の「接続テスト」用）。
async function testConnection() {
  const since = query.sinceDate(1, new Date());
  const { err, stdout, stderr } = await runScript(['-SinceIso', since.toISOString(), '-Limit', '1']);
  if (err) return { ok: false, ...classify(stderr, err) };
  const parsed = parseScriptOutput(stdout);
  if (!parsed.ok) return { ok: false, kind: 'unknown', message: parsed.message };
  return { ok: true };
}

// 監視している相手のメールを探す。
// 絞り込みは「日付と未読」だけ PowerShell 側でやり、相手・向きの判定は query.js に任せる。
async function check(options = {}) {
  const watch = query.normalizeWatchList(options.watch);
  if (watch.length === 0) return { ok: true, messages: [] };

  const since = query.sinceDate(options.days, options.now);
  const args = ['-SinceIso', since.toISOString(), '-Limit', String(LIMIT)];
  if (options.unreadOnly) args.push('-UnreadOnly');

  const { err, stdout, stderr } = await runScript(args);
  if (err) return { ok: false, ...classify(stderr, err) };

  const parsed = parseScriptOutput(stdout);
  if (!parsed.ok) return { ok: false, kind: 'unknown', message: parsed.message };

  const messages = query.sortMessages(query.dedupe(
    parsed.rows
      .map((row) => query.normalizeMessage(row, 'outlook'))
      .filter((m) => query.matchesWatch(m, { watch, match: options.match }))
  ));
  return { ok: true, messages };
}

// 一覧で選んだメールを Outlook で開く。EntryID があればその1通を直接開ける。
async function openMessage(entryId) {
  const id = String(entryId || '').trim();
  if (!/^[0-9A-Fa-f]+$/.test(id)) return { ok: false, error: '開くメールを特定できませんでした。' };
  const script = "$o = New-Object -ComObject Outlook.Application; "
    + "$n = $o.GetNamespace('MAPI'); "
    + `$i = $n.GetItemFromID('${id}'); $i.Display()`;
  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], { windowsHide: true, timeout: TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) resolve({ ok: false, error: classify(stderr, err).message });
      else resolve({ ok: true });
    });
  });
}

module.exports = { check, testConnection, openMessage, resolveScriptPath, parseScriptOutput, classify, LIMIT };
