const test = require('node:test');
const assert = require('node:assert');
const {
  classifyError, extractText, MODEL, generateText, generateBody,
  buildUserContent, usageFromResponse,
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

// Task 40: プロンプトキャッシュ（cachePrefix）。実際のAPIは呼ばず、
// content配列の組み立て（buildUserContent）とusageの取り出し（usageFromResponse）を
// 純粋関数として直接テストする。

test('generateText: APIキーが無ければcachePrefix指定があってもno_keyで即座に失敗する', async () => {
  const r = await generateText({
    apiKey: '', system: 's', user: '参考資料はこれです\n続き', cachePrefix: '参考資料はこれです',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'no_key');
});

test('buildUserContent: cachePrefix省略時はこれまでどおり文字列のまま返す（既存呼び出し互換）', () => {
  assert.strictEqual(buildUserContent('こんにちは', undefined), 'こんにちは');
  assert.strictEqual(buildUserContent('こんにちは', ''), 'こんにちは');
  assert.strictEqual(buildUserContent('こんにちは', null), 'こんにちは');
});

test('buildUserContent: cachePrefixがuser中に見つかれば、先頭に移して残りと2ブロックにする', () => {
  const user = '前置き\n【参考資料】\nりんごとみかん\n\n続きの指示';
  const cachePrefix = 'りんごとみかん';
  const content = buildUserContent(user, cachePrefix);
  assert.ok(Array.isArray(content));
  assert.strictEqual(content.length, 2);
  assert.strictEqual(content[0].type, 'text');
  assert.strictEqual(content[0].text, cachePrefix);
  assert.deepStrictEqual(content[0].cache_control, { type: 'ephemeral' });
  // 2つ目のブロックにはキャッシュ指定を付けない（変わる内容のため）
  assert.strictEqual(content[1].cache_control, undefined);
});

test('buildUserContent: 変わらない内容(cachePrefix)が先、変わる内容が後になる', () => {
  const user = '前置き\n【参考資料】\n本文A\n\n続きの指示';
  const content = buildUserContent(user, '本文A');
  // 元の文字列からcachePrefixの部分を除いた残りが、2番目のブロックに来る
  assert.strictEqual(content[1].text, '前置き\n【参考資料】\n\n\n続きの指示');
  // 2つのブロックを単純結合すると、参考資料の内容自体は失われず1回だけ含まれる
  const combined = content[0].text + content[1].text;
  assert.strictEqual((combined.match(/本文A/g) || []).length, 1);
});

test('buildUserContent: userの中にcachePrefixが見つからなければ、これまでどおり文字列のまま返す', () => {
  const user = 'まったく別の内容です';
  const content = buildUserContent(user, '存在しない参考資料');
  assert.strictEqual(content, user);
});

test('usageFromResponse: 通常のusageからinputTokens/outputTokensを取り出す', () => {
  const res = { usage: { input_tokens: 120, output_tokens: 40 } };
  const usage = usageFromResponse(res, 'claude-opus-5');
  assert.strictEqual(usage.model, 'claude-opus-5');
  assert.strictEqual(usage.inputTokens, 120);
  assert.strictEqual(usage.outputTokens, 40);
  assert.strictEqual(usage.cacheReadTokens, 0);
  assert.strictEqual(usage.cacheCreationTokens, 0);
});

test('usageFromResponse: cache_read_input_tokens/cache_creation_input_tokensを取り出す', () => {
  const res = {
    usage: {
      input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300,
    },
  };
  const usage = usageFromResponse(res, 'claude-sonnet-5');
  assert.strictEqual(usage.cacheReadTokens, 5000);
  assert.strictEqual(usage.cacheCreationTokens, 300);
});

test('usageFromResponse: usageが無い・壊れたレスポンスでも例外を投げず0になる', () => {
  const usage = usageFromResponse({}, 'claude-opus-5');
  assert.strictEqual(usage.inputTokens, 0);
  assert.strictEqual(usage.outputTokens, 0);
  assert.strictEqual(usage.cacheReadTokens, 0);
  assert.strictEqual(usage.cacheCreationTokens, 0);
  assert.deepStrictEqual(usageFromResponse(null, 'claude-opus-5'), usageFromResponse({}, 'claude-opus-5'));
});
