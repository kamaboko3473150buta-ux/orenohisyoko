// src/main/weather/index.js
// 今日の天気。Open-Meteo（登録もキーも要らない）から取る。**AIは使わない**ので0円。
//
// 1日1回だけ取りに行き、その日のぶんを覚えておく。
// 日付が変わったら次に見たときに取り直す（アプリが起動していなければ起動後の初回）。

const https = require('node:https');
const { ipcMain } = require('electron');
const format = require('./format');

const TIMEOUT_MS = 10000;
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// その日のぶんを覚えておく入れ物。{ date, place, text }
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

// 地名から緯度経度を引く。見つからなければ null。
async function geocode(place) {
  const name = String(place || '').trim();
  if (!name) return null;
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=1&language=ja&country=JP`;
  const json = await getJson(url);
  const hit = json && Array.isArray(json.results) && json.results[0];
  if (!hit) return null;
  return { name: hit.name, latitude: hit.latitude, longitude: hit.longitude };
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
    date: new Date(),
    place: spot.name,
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
    const place = String(((getSettings().news || {}).region) || '').trim();
    const today = todayYmd();

    // その日のぶんを取ってあれば、それを返す（1日1回だけ取りに行く）。
    if (!force && cache && cache.date === today && cache.place === place) {
      return { ok: true, text: cache.text, cached: true };
    }

    if (!place) {
      // 地名が無いと引けない。日付だけでも出す（吹き出しは常に何か言う場所なので）。
      const text = `${format.formatDate(new Date())}\n設定で住んでいる地域を入れると、天気も出せます。`;
      cache = { date: today, place, text };
      return { ok: true, text, noPlace: true };
    }

    const spot = await geocode(place);
    if (!spot) {
      const text = `${format.formatDate(new Date())}\n「${place}」の場所が分かりませんでした。`;
      return { ok: false, text };
    }
    const text = await fetchForecast(spot);
    if (!text) {
      return { ok: false, text: `${format.formatDate(new Date())}\n天気を取得できませんでした。` };
    }
    cache = { date: today, place, text };
    return { ok: true, text };
  });
}

module.exports = { register, geocode, fetchForecast, format };
