// src/main/settings.js
// 設定の読み書き。APIキーは Electron の safeStorage（WindowsのDPAPI）で暗号化して保存する。
// safeStorage は呼び出し側から渡す（テストで差し替えられるようにするため）。

const { readJson, writeJson } = require('./jsonfile');
const { FEATURES, findModel } = require('./models');

// 機能ごとの既定モデル（FEATURESのdefaultModelそのまま）。
// 例: { mail: 'claude-opus-5', task: 'claude-opus-5', docgen: 'claude-sonnet-5' }
const DEFAULT_MODELS = FEATURES.reduce((acc, f) => ({ ...acc, [f.id]: f.defaultModel }), {});

const DEFAULT_SETTINGS = {
  signature: '',
  defaultTone: 'formal_external',
  defaultMailer: 'outlook',
  defaultTaskInput: 'manual',
  models: DEFAULT_MODELS,
};

// 保存されているmodelsに欠け・未知の値があっても、機能ごとの既定へ倒す
// （資料作成の既定はSonnet 5であり、一律Opus 5に倒すと既定が変わってしまうため、
// findModelの汎用フォールバックではなく、機能ごとのdefaultModelを使う）。
// 部分更新で片方の機能だけ変えても、他の機能の設定が消えないようにするため
// 常に全機能ぶんそろえて返す。
function normalizeModels(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return FEATURES.reduce((acc, f) => {
    const saved = r[f.id];
    const isKnown = typeof saved === 'string' && findModel(saved).id === saved;
    return { ...acc, [f.id]: isKnown ? saved : f.defaultModel };
  }, {});
}

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
    models: normalizeModels(raw.models),
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

  // modelsは機能ごとのキー（mail/task/docgen）を持つ入れ子のオブジェクト。
  // 片方の機能だけ渡しても他の機能の設定が消えないよう、既存の値にマージする。
  if (Object.prototype.hasOwnProperty.call(patch, 'models')) {
    next.models = { ...(raw.models || {}), ...(patch.models || {}) };
  }

  writeJson(filePath, next);
  return loadSettings(filePath, crypto);
}

module.exports = { DEFAULT_SETTINGS, loadSettings, saveSettings };
