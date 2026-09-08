// src/main/weather/index.js
// 今日の天気。Open-Meteo（登録もキーも要らない）から取る。**AIは使わない**ので0円。
//
// 1日1回だけ取りに行き、その日のぶんを覚えておく。
// 日付が変わったら次に見たときに取り直す（アプリが起動していなければ起動後の初回）。

const https = require('node:https');
const { ipcMain } = require('electron');
const format = require('./format');
const place = require('./place');

const TIMEOUT_MS = 10000;
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// その日のぶんを覚えておく入れ物。{ date, place, text, spot }
let cache = null;

function getJson(url) {
  return new Promise((resolve) => {
    let request;
    try {
      request = https.get(url, {
        headers: { 'user-agent': 'ore-no-hishoko' },
        timeout: TIMEOUT_MS,
      }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
        return undefined;
      });
    } catch {
      return resolve(null);
    }
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.on('error', () => resolve(null));
    return undefined;
  });
}

async function lookupOne(name) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=1&language=ja&country=JP`;
  const json = await getJson(url);
  const hit = json && Array.isArray(json.results) && json.results[0];
  if (!hit) return null;
  return { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
}

// 地名から緯度経度を引く。
// Open-Meteo の地名検索は市区町村しか持っていないので、「愛媛県」のような
// 都道府県名は1件も返ってこない。県庁所在地に読み替えて引き直す（place.js）。
async function geocode(value) {
  for (const name of place.candidates(value)) {
    // 候補は多くて4つ。順に試し、最初に見つかったものを使う。
    // eslint-disable-next-line no-await-in-loop
    const spot = await lookupOne(name);
    if (spot) return spot;
  }
  return null;
}

async function fetchForecast(spot) {
  const url = `${FORECAST_URL}?latitude=${spot.latitude}&longitude=${spot.longitude}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&hourly=weather_code&timezone=Asia%2FTokyo&forecast_days=1';
  const json = await getJson(url);
  if (!json || !json.daily) return null;
  const daily = json.daily;
  const hourly = json.hourly || {};
  return format.formatSummary({
    description: format.describeDay(hourly.weather_code, hourly.time),
    high: daily.temperature_2m_max && daily.temperature_2m_max[0],
    low: daily.temperature_2m_min && daily.temperature_2m_min[0],
    rain: daily.precipitation_probability_max && daily.precipitation_probability_max[0],
  });
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function register({ getSettings }) {
  ipcMain.handle('weather:today', async (_e, { force } = {}) => {
    const where = String(((getSettings().news || {}).region) || '').trim();
    const today = todayYmd();
    // 日付と曜日は吹き出しに入れない（2行になって顔にかぶるため）。
    // マウスを乗せたときの説明として渡す。
    const date = format.formatDate(new Date());

    // その日のぶんを取ってあれば、それを返す（1日1回だけ取りに行く）。
    if (!force && cache && cache.date === today && cache.place === where) {
      return {
        ok: true, text: cache.text, date, spot: cache.spot, cached: true,
      };
    }

    if (!where) {
      const text = '設定で住んでいる地域を入れると、天気も出せます。';
      cache = { date: today, place: where, text, spot: '' };
      return {
        ok: true, text, date, spot: '', noPlace: true,
      };
    }

    const spot = await geocode(where);
    if (!spot) {
      return { ok: false, text: `「${where}」の場所が分かりませんでした。`, date, spot: '' };
    }
    const text = await fetchForecast(spot);
    if (!text) {
      return { ok: false, text: '天気を取得できませんでした。', date, spot: spot.name };
    }
    cache = {
      date: today, place: where, text, spot: spot.name,
    };
    return {
      ok: true, text, date, spot: spot.name,
    };
  });
}

module.exports = {
  register, geocode, fetchForecast, format, place,
};
