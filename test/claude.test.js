const test = require('node:test');
const assert = require('node:assert');
const {
  classifyError, extractText, MODEL, generateText, generateBody,
} = require('../src/main/claude');

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

test('SDKと同じ形の例外（nameを設定しないクラス）でも接続エラーとして分類される', () => {
  class APIConnectionError extends Error {}
  const err = new APIConnectionError('x');
  assert.strictEqual(err.name, 'Error');
  assert.strictEqual(err.constructor.name, 'APIConnectionError');
  assert.strictEqual(classifyError(err).code, 'network');
});

test('SDKと同じ形の例外（nameを設定しないクラス）でもタイムアウトとして分類される', () => {
  class APIConnectionTimeoutError extends Error {}
  const err = new APIConnectionTimeoutError('x');
  assert.strictEqual(err.name, 'Error');
  assert.strictEqual(err.constructor.name, 'APIConnectionTimeoutError');
  assert.strictEqual(classifyError(err).code, 'timeout');
});

test('err.cause.codeにENOTFOUNDがあるときnetworkになる', () => {
  const err = Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } });
  assert.strictEqual(classifyError(err).code, 'network');
});

test('extractTextはcontentが配列でない（例: 文字列）とき空文字を返し、例外を投げない', () => {
  assert.strictEqual(extractText({ content: 'not an array' }), '');
});

// APIキーが無い場合はAPIを呼ばずに即座にエラーを返すので、model指定の有無にかかわらず
// ネットワークに接続せず安全にテストできる（generateText/generateBodyがmodel引数を
// 受け取ってもクラッシュしないことの確認）。
test('generateText: APIキーが無ければmodel指定の有無に関わらずno_keyで即座に失敗する', async () => {
  const withoutModel = await generateText({ apiKey: '', system: 's', user: 'u' });
  assert.strictEqual(withoutModel.ok, false);
  assert.strictEqual(withoutModel.code, 'no_key');

  const withModel = await generateText({
    apiKey: '', system: 's', user: 'u', model: 'claude-sonnet-5',
  });
  assert.strictEqual(withModel.ok, false);
  assert.strictEqual(withModel.code, 'no_key');
});

test('generateBody: APIキーが無ければno_keyで即座に失敗する（model省略・指定どちらも）', async () => {
  const withoutModel = await generateBody({ apiKey: '', system: 's', user: 'u' });
  assert.strictEqual(withoutModel.ok, false);
  assert.strictEqual(withoutModel.code, 'no_key');

  const withModel = await generateBody({
    apiKey: '', system: 's', user: 'u', model: 'claude-haiku-4-5',
  });
  assert.strictEqual(withModel.ok, false);
  assert.strictEqual(withModel.code, 'no_key');
});
