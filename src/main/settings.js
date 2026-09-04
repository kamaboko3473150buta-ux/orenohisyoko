// src/main/settings.js
// 設定の読み書き。APIキーは Electron の safeStorage（WindowsのDPAPI）で暗号化して保存する。
// safeStorage は呼び出し側から渡す（テストで差し替えられるようにするため）。

const { readJson, writeJson } = require('./jsonfile');

const DEFAULT_SETTINGS = {
  signature: '',
  defaultTone: 'formal_external',
  defaultMailer: 'outlook',
  defaultTaskInput: 'manual',
};

// ファイルに保存する形:
// { apiKeyEncrypted: '<base64>' | null, apiKeyPlain: '<平文>' | null, signature, defaultTone, defaultMailer }
function loadSettings(filePath, crypto) {
  const raw = readJson(filePath, {});
  const settings = {
    ...DEFAULT_SETTINGS,
    signature: typeof raw.signature === 'string' ? raw.signature : DEFAULT_SETTINGS.signature,
    defaultTone: raw.defaultTone || DEFAULT_SETTINGS.defaultTone,
    defaultMailer: raw.defaultMailer || DEFAULT_SETTINGS.defaultMailer,
    // 未知の値は既定の'manual'に倒す（誤った値でAI取り込みが勝手に選ばれないように）。
    defaultTaskInput: raw.defaultTaskInput === 'ai' ? 'ai' : DEFAULT_SETTINGS.defaultTaskInput,
    apiKey: '',
    encrypted: false,
  };

  if (raw.apiKeyEncrypted) {
    try {
      settings.apiKey = crypto.decryptString(Buffer.from(raw.apiKeyEncrypted, 'base64'));
      settings.encrypted = true;
    } catch {
      settings.apiKey = ''; // 復号できない（別PC・OS再インストール等）。再入力してもらう
    }
  } else if (raw.apiKeyPlain) {
    settings.apiKey = raw.apiKeyPlain;
    settings.encrypted = false;
  }
  return settings;
}

// 部分更新。渡したキーだけ書き換え、渡さなかったものは元の値を保つ。
function saveSettings(filePath, patch, crypto) {
  const raw = readJson(filePath, {});
  const next = { ...raw };

  if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
    const key = String(patch.apiKey || '').trim();
    delete next.apiKeyEncrypted;
    delete next.apiKeyPlain;
    if (key) {
      if (crypto.isEncryptionAvailable()) {
        next.apiKeyEncrypted = Buffer.from(crypto.encryptString(key)).toString('base64');
      } else {
        next.apiKeyPlain = key; // 暗号化できない環境でのフォールバック
      }
    }
  }
  for (const field of ['signature', 'defaultTone', 'defaultMailer', 'defaultTaskInput']) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) next[field] = patch[field];
  }

  writeJson(filePath, next);
  return loadSettings(filePath, crypto);
}

module.exports = { DEFAULT_SETTINGS, loadSettings, saveSettings };
