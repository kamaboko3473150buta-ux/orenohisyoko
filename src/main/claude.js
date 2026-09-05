// src/main/claude.js
// Claude API の呼び出し。公式SDK @anthropic-ai/sdk を使う。
// APIキーはこのファイル（メインプロセス）の外に出さない。

// CommonJS から読み込むときは default 付き／無しの両方に備える
const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;

// モデルを変えたいときはこの1行を書き換える。
// 例: 費用を抑えたいなら 'claude-sonnet-5'（品質は少し落ちる）
const MODEL = 'claude-opus-5';
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 60000;

// レスポンスの content からテキストだけを取り出す。
// thinking ブロックなどが混ざるため、type で絞り込む必要がある。
function extractText(message) {
  const blocks = (message && message.content) || [];
  if (!Array.isArray(blocks)) return '';
  return blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
}

// エラーを画面に出せる日本語メッセージに分類する。
// 例外の中身にAPIキーが含まれることがあるため、元のメッセージは絶対に使わない。
//
// 注意: SDK の APIConnectionError / APIConnectionTimeoutError は name を設定しないため、
// err.name は 'Error' のままになる。instanceof と constructor.name の両方で判定し、
// 元の原因コードは err.cause.code からも拾う。
function classifyError(err) {
  const status = err && err.status;
  const ctor = (err && err.constructor && err.constructor.name) || '';
  const name = (err && err.name) || '';
  const code = (err && err.code) || (err && err.cause && err.cause.code) || '';

  // タイムアウトは接続エラーの一種（クラスも継承関係）なので、必ず先に判定する
  const isTimeout = (Anthropic.APIConnectionTimeoutError && err instanceof Anthropic.APIConnectionTimeoutError)
    || ctor === 'APIConnectionTimeoutError' || name === 'APIConnectionTimeoutError'
    || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT';
  if (isTimeout) {
    return { code: 'timeout', message: '時間内に応答がありませんでした。もう一度お試しください。' };
  }

  const isNetwork = (Anthropic.APIConnectionError && err instanceof Anthropic.APIConnectionError)
    || ctor === 'APIConnectionError' || name === 'APIConnectionError'
    || ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'].includes(code);
  if (isNetwork) {
    return { code: 'network', message: 'インターネットに接続できませんでした。通信環境を確認してください。' };
  }

  if (status === 401 || status === 403) {
    return { code: 'auth', message: 'APIキーが正しくないようです。設定画面で確認してください。' };
  }
  if (status === 429 || status === 402) {
    return { code: 'rate_limit', message: 'Anthropic側の利用上限に達している可能性があります。しばらく待つか、契約内容を確認してください。' };
  }
  if (status === 400 || status === 404 || status === 422) {
    return { code: 'bad_request', message: 'リクエストの内容に問題がありました。入力を変えてお試しください。' };
  }
  if (typeof status === 'number' && status >= 500) {
    return { code: 'server', message: 'Anthropic側で一時的な障害が起きているようです。しばらく待ってお試しください。' };
  }
  return { code: 'unknown', message: '文面の作成に失敗しました。もう一度お試しください。' };
}

// テキストを生成する汎用関数。成功なら { ok:true, body, usage }、失敗なら { ok:false, code, message }。
// メール本文（generateBody）とタスクのAI連携（Task 22）の両方がこれを呼ぶ。
// model は省略可（省略時はこれまでどおり MODEL＝claude-opus-5）。既存の呼び出しを壊さないため。
async function generateText({
  apiKey, system, user, maxTokens, model,
}) {
  if (!apiKey) {
    return { ok: false, code: 'no_key', message: 'Claude APIキーが設定されていません。設定画面で登録してください。' };
  }
  const usedModel = model || MODEL;
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  try {
    const res = await client.messages.create({
      model: usedModel,
      max_tokens: maxTokens || MAX_TOKENS,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') {
      return { ok: false, code: 'refusal', message: 'この内容では文面を作成できませんでした。書き方を変えてお試しください。' };
    }
    const body = extractText(res).trim();
    if (!body) {
      return { ok: false, code: 'empty', message: '文面が空で返ってきました。もう一度お試しください。' };
    }
    // 利用状況の記録（Task 19・32）に使う。無ければ0（SDKのレスポンス形式が変わった場合の保険）。
    // model も含める。どのモデルで使ったかが分からないと、モデル別の費用集計ができないため。
    const usage = {
      model: usedModel,
      inputTokens: (res.usage && res.usage.input_tokens) || 0,
      outputTokens: (res.usage && res.usage.output_tokens) || 0,
    };
    return { ok: true, body, usage };
  } catch (err) {
    const info = classifyError(err);
    return { ok: false, ...info };
  }
}

// 本文を生成する。generateText を既定のトークン数で呼ぶだけ。
// 戻り値の形・挙動は既存のメール機能が依存しているため変えない。model は追加のオプション。
async function generateBody({
  apiKey, system, user, model,
}) {
  return generateText({
    apiKey, system, user, maxTokens: MAX_TOKENS, model,
  });
}

module.exports = {
  MODEL, extractText, classifyError, generateText, generateBody,
};
