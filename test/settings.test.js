const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSettings, saveSettings, DEFAULT_SETTINGS } = require('../src/main/settings');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hishoko-set-'));
  return path.join(dir, 'settings.json');
}

// Electron の safeStorage を模したもの（実際はDPAPIで暗号化される）
const fakeCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
  decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
};
const noCrypto = { isEncryptionAvailable: () => false };

test('保存していない状態では既定値が返る', () => {
  const s = loadSettings(tmpFile(), fakeCrypto);
  assert.strictEqual(s.apiKey, '');
  assert.strictEqual(s.signature, DEFAULT_SETTINGS.signature);
  assert.strictEqual(s.defaultTone, 'formal_external');
  assert.strictEqual(s.defaultMailer, 'outlook');
});

test('APIキーを保存すると取り出せる', () => {
  const f = tmpFile();
  saveSettings(f, { apiKey: 'sk-ant-test123' }, fakeCrypto);
  assert.strictEqual(loadSettings(f, fakeCrypto).apiKey, 'sk-ant-test123');
});

test('保存されたファイルにAPIキーが平文で残らない', () => {
  const f = tmpFile();
  saveSettings(f, { apiKey: 'sk-ant-test123' }, fakeCrypto);
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(!raw.includes('sk-ant-test123'), '平文のキーがファイルに無い');
});

test('暗号化が使えない環境では平文で保存されるが読み書きはできる', () => {
  const f = tmpFile();
  saveSettings(f, { apiKey: 'sk-ant-test123' }, noCrypto);
  const s = loadSettings(f, noCrypto);
  assert.strictEqual(s.apiKey, 'sk-ant-test123');
  assert.strictEqual(s.encrypted, false, '暗号化されていないことが分かる');
});

test('APIキー以外の設定を保存してもキーは消えない', () => {
  const f = tmpFile();
  saveSettings(f, { apiKey: 'sk-ant-test123' }, fakeCrypto);
  saveSettings(f, { signature: '株式会社△△\n松原' }, fakeCrypto);
  const s = loadSettings(f, fakeCrypto);
  assert.strictEqual(s.apiKey, 'sk-ant-test123', 'キーが残っている');
  assert.strictEqual(s.signature, '株式会社△△\n松原', '署名も保存されている');
});

test('APIキーを空文字で保存すると削除される', () => {
  const f = tmpFile();
  saveSettings(f, { apiKey: 'sk-ant-test123' }, fakeCrypto);
  saveSettings(f, { apiKey: '' }, fakeCrypto);
  assert.strictEqual(loadSettings(f, fakeCrypto).apiKey, '');
});

test('復号に失敗しても落ちず、キーは空になる', () => {
  const f = tmpFile();
  saveSettings(f, { apiKey: 'sk-ant-test123' }, fakeCrypto);
  const brokenCrypto = {
    isEncryptionAvailable: () => true,
    encryptString: fakeCrypto.encryptString,
    decryptString: () => { throw new Error('復号できない'); },
  };
  assert.strictEqual(loadSettings(f, brokenCrypto).apiKey, '');
});
