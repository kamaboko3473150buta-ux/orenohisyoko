const test = require('node:test');
const assert = require('node:assert');
const { classifyError, extractText, MODEL } = require('../src/main/claude');

test('使うモデルはclaude-opus-5', () => {
  assert.strictEqual(MODEL, 'claude-opus-5');
});

test('401はAPIキーの問題として分類される', () => {
  const r = classifyError({ status: 401 });
  assert.strictEqual(r.code, 'auth');
  assert.ok(r.message.includes('APIキー'), 'APIキーに言及する');
});

test('429は利用上限として分類される', () => {
  assert.strictEqual(classifyError({ status: 429 }).code, 'rate_limit');
});

test('500番台はサーバー側の問題として分類される', () => {
  assert.strictEqual(classifyError({ status: 503 }).code, 'server');
});

test('400はリクエストの問題として分類される', () => {
  assert.strictEqual(classifyError({ status: 400 }).code, 'bad_request');
});

test('接続エラーはネットワークとして分類される', () => {
  assert.strictEqual(classifyError({ name: 'APIConnectionError' }).code, 'network');
  assert.strictEqual(classifyError({ code: 'ENOTFOUND' }).code, 'network');
});

test('タイムアウトはタイムアウトとして分類される', () => {
  assert.strictEqual(classifyError({ name: 'APIConnectionTimeoutError' }).code, 'timeout');
});

test('分類できないものはunknownになるが、必ずメッセージを持つ', () => {
  const r = classifyError(new Error('謎のエラー'));
  assert.strictEqual(r.code, 'unknown');
  assert.ok(r.message.length > 0, 'メッセージが空でない');
});

test('エラーメッセージにAPIキーの文字列が混ざらない', () => {
  const r = classifyError({ status: 401, message: 'invalid x-api-key: sk-ant-abc123' });
  assert.ok(!r.message.includes('sk-ant-'), 'キーの断片が出ない');
});

test('レスポンスからテキストブロックだけを取り出す', () => {
  const msg = { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '本文です' }] };
  assert.strictEqual(extractText(msg), '本文です');
});

test('テキストブロックが複数あれば連結する', () => {
  const msg = { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] };
  assert.strictEqual(extractText(msg), 'AB');
});

test('テキストブロックが無ければ空文字', () => {
  assert.strictEqual(extractText({ content: [] }), '');
  assert.strictEqual(extractText({}), '');
});
