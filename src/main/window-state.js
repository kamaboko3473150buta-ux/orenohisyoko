// src/main/window-state.js
// ウィンドウの大きさと位置を覚えておき、次に開いたときに同じ形で開く。
//
// 既定値を決め打ちにすると、画面の小さい環境ではみ出す（実機で
// 1280x720 の画面に高さ880で作ってしまい、息抜きの卓が入らなくなった）。
// 覚えた値も画面の作業領域に収まるか必ず確かめてから使う。
// Electron に依存しない純粋な計算にして、テストできるようにしてある。

const DEFAULT_SIZE = { width: 1140, height: 880 };
const MIN_SIZE = { width: 900, height: 560 };
const MARGIN = 20;   // 画面の縁とのすき間

function toFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// 保存されていた形と、いまの画面の作業領域から、実際に使う形を決める。
// - 大きさは作業領域に収まるまで詰める（下限あり）
// - 位置は画面の外に出ていたら捨てて中央に置く（別モニタで保存した値の持ち越し対策）
function resolveBounds(saved, workArea) {
  const area = {
    x: toFinite(workArea && workArea.x) || 0,
    y: toFinite(workArea && workArea.y) || 0,
    // 画面の情報が取れないときは制限なしとして扱う（既定の大きさをそのまま使う）
    width: toFinite(workArea && workArea.width) || Number.POSITIVE_INFINITY,
    height: toFinite(workArea && workArea.height) || Number.POSITIVE_INFINITY,
  };

  const wanted = {
    width: toFinite(saved && saved.width) || DEFAULT_SIZE.width,
    height: toFinite(saved && saved.height) || DEFAULT_SIZE.height,
  };

  const width = Math.max(
    Math.min(MIN_SIZE.width, area.width),
    Math.min(Math.round(wanted.width), area.width - MARGIN)
  );
  const height = Math.max(
    Math.min(MIN_SIZE.height, area.height),
    Math.min(Math.round(wanted.height), area.height - MARGIN)
  );

  const x = toFinite(saved && saved.x);
  const y = toFinite(saved && saved.y);
  const fits = x !== null && y !== null
    && x >= area.x - MARGIN && y >= area.y - MARGIN
    && x + width <= area.x + area.width + MARGIN
    && y + height <= area.y + area.height + MARGIN;

  if (fits) return { width, height, x: Math.round(x), y: Math.round(y) };
  return { width, height };   // 位置を渡さなければ Electron が中央に置く
}

// 閉じるときに残す値。最大化中は「元に戻したときの形」を残す
// （最大化した形を覚えると、次に開いたとき戻せなくなる）。
function boundsToSave(bounds) {
  const width = toFinite(bounds && bounds.width);
  const height = toFinite(bounds && bounds.height);
  if (!width || !height) return null;
  return {
    width: Math.round(width),
    height: Math.round(height),
    x: toFinite(bounds.x) === null ? undefined : Math.round(bounds.x),
    y: toFinite(bounds.y) === null ? undefined : Math.round(bounds.y),
  };
}

module.exports = { resolveBounds, boundsToSave, DEFAULT_SIZE, MIN_SIZE };
