// src/main/news/index.js
// 「今日のニュース」。RSSをアプリが直接取りに行き、見出しだけをAIに渡してまとめさせる。
//
// ウェブ検索で集めると記事本文が文脈に入り、1回20〜40円かかる。
// この作り（見出しだけ）なら1〜3円で済む。取りに行くのは無料なので、
// AIには「選ぶ・まとめる」という判断が要る部分だけを任せる。

const https = require('node:https');
const http = require('node:http');
const { ipcMain } = require('electron');
const rss = require('./rss');
const feeds = require('./feeds');
const { generateText } = require('../claude');
const { addUsage } = require('../usage');

const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const NEWS_MAX_TOKENS = 700;

// 1本取ってくる。リダイレクトを追う（NHKの配信は別ドメインへ転送される）。
// 失敗しても例外にせず、空で返す（1本落ちても他は出したい）。
function fetchText(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > MAX_REDIRECTS) return resolve('');
    let request;
    try {
      const client = url.startsWith('http://') ? http : https;
      request = client.get(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (ore-no-hishoko)' },
        timeout: TIMEOUT_MS,
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, url).toString();
          } catch {
            return resolve('');
          }
          return resolve(fetchText(next, depth + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(''); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve(body));
        return undefined;
      });
    } catch {
      return resolve('');
    }
    request.on('timeout', () => { request.destroy(); resolve(''); });
    request.on('error', () => resolve(''));
    return undefined;
  });
}

// 設定された配信をすべて取り、見出しをまとめる。
//
// 地域の配信は別枠で数える。日付順にそのまま混ぜると、地域の配信のほうが
// 更新が細かいぶん上位を占めてしまい、全国のニュースが押し出される。
async function collectArticles(feedList, region) {
  const areaFeed = feeds.regionFeed(region);
  const all = areaFeed ? feedList.concat([areaFeed]) : feedList;

  const results = await Promise.all(all.map(async (f) => {
    const xml = await fetchText(f.url);
    return rss.parseFeed(xml, f.name);
  }));

  const areaResult = areaFeed ? results[results.length - 1] : [];
  const mainResults = areaFeed ? results.slice(0, -1) : results;

  const area = rss.mergeArticles([areaResult], feeds.MAX_REGION_ARTICLES);
  const main = rss.mergeArticles(mainResults, feeds.MAX_ARTICLES - area.length);
  return {
    // 地域を先に置く。重複はここで落ちる（同じ話が全国にも載っているとき）。
    articles: rss.mergeArticles([area, main], feeds.MAX_ARTICLES),
    regionCount: area.length,
    failed: all.filter((f, i) => results[i].length === 0).map((f) => f.name),
  };
}

function register({ getSettings, getUsage, saveUsage }) {
  ipcMain.handle('news:today', async (_e, { model } = {}) => {
    const settings = getSettings();
    const conf = settings.news || {};
    const feedList = feeds.normalizeFeeds(conf.feeds);

    const { articles, failed, regionCount } = await collectArticles(feedList, conf.region);
    if (articles.length === 0) {
      return {
        ok: false,
        message: 'ニュースを取得できませんでした。ネットワークの状態を確認してください。',
      };
    }

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = await generateText({
      apiKey: settings.apiKey,
      system: feeds.buildSystemPrompt(),
      user: feeds.buildUserPrompt({ articles, region: conf.region, today }),
      maxTokens: NEWS_MAX_TOKENS,
      model: model || settings.models.news || settings.models.task,
    });
    if (!result.ok) return result;

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    return {
      ok: true,
      message: result.body,
      articleCount: articles.length,
      regionCount,
      failedFeeds: failed,
    };
  });
}

module.exports = { register, collectArticles, fetchText };
