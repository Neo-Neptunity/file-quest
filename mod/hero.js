// ファイル・クエスト — 勇者・仲間の見た目（人型のドット絵を計算で作る。素材も通信も要らない）
// 見た目は、5つの選択（髪型・髪の色・肌・服の色・かぶりもの）の番号だけで決まる。番号は小さな数字なので、冒険者カードに載せて、友だちに渡せる。
// カードのコードは信用しない：番号は範囲を検査し、おかしければ、種から決めた姿にする。
import { rng } from "./pixel.js";

export const HAIR_STYLES = ["ショート", "ロング", "ツンツン", "ポニーテール", "ぼうず", "おだんご"];
export const HAIR_COLORS = [["くろ", "#2a2a35"], ["ちゃいろ", "#6a4125"], ["きんいろ", "#e6bf45"], ["あか", "#c13f2b"], ["あお", "#3c6fd0"], ["みどり", "#3d9a50"], ["むらさき", "#8650c0"], ["ぎんいろ", "#d5dae6"]];
export const SKINS = [["うすい", "#ffe4d0"], ["ふつう", "#f6cba3"], ["こい", "#d9a173"], ["ちゃいろ", "#a7724a"], ["こげちゃ", "#6d4a34"]];
export const OUTFITS = [["あか", "#d6453a"], ["あお", "#3f78d6"], ["みどり", "#3f9d57"], ["きいろ", "#e7b93a"], ["むらさき", "#8d57c7"], ["しろ", "#e9eaf0"], ["くろ", "#3a3a46"], ["オレンジ", "#e57f2f"]];
export const HEADGEAR = ["なし", "とんがり帽子", "かぶと", "リボン"];

// 選ぶ項目：名前と、選択肢の名前
export const LOOK_ROWS = [
  { name: "かみがた", opts: HAIR_STYLES },
  { name: "かみの色", opts: HAIR_COLORS.map((c) => c[0]) },
  { name: "はだの色", opts: SKINS.map((c) => c[0]) },
  { name: "ふくの色", opts: OUTFITS.map((c) => c[0]) },
  { name: "かぶりもの", opts: HEADGEAR },
];
export const LOOK_N = LOOK_ROWS.map((r) => r.opts.length);

// 種から決めた姿（まだ選んでいない人・見た目の入っていない古いカードの人）
export function defaultLook(seed = 0) {
  const r = rng((seed >>> 0) ^ 0x9e3779b9);
  return LOOK_N.map((n, i) => (i === 4 ? (r() < 0.6 ? 0 : 1 + Math.floor(r() * (n - 1))) : Math.floor(r() * n)));      // かぶりもの：なしが多め
}
export const randomLook = () => defaultLook((Math.random() * 4294967296) >>> 0);

// 見た目の番号の検査：5つの整数で、それぞれ範囲の中。おかしければ、種から決めた姿
export function cleanLook(v, seed = 0) {
  if (Array.isArray(v) && v.length === LOOK_N.length && v.every((x, i) => Number.isInteger(x) && x >= 0 && x < LOOK_N[i])) return v.slice();
  return defaultLook(seed);
}
export const sameLook = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
export const lookOf = (e) => cleanLook(e && e.look, e && e.seed);          // フレンド・カード・訪れた人から、見た目を取り出す

// ---- 絵を作る（16×16。色の文字か null の格子）-----------------------------------------------------
const OUTLINE = "#1a1a24";
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (a) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const shade = (c, k) => toHex(hex(c).map((v) => v * k));            // k < 1 で暗く、k > 1 で明るく

export function genHeroGrid(look, role = "hero") {
  const [hs, hc, sk, of, hg] = cleanLook(look);
  const H = HAIR_COLORS[hc][1], Hd = shade(H, 0.72);
  const S = SKINS[sk][1], Sd = shade(S, 0.88);
  const O = OUTFITS[of][1], Od = shade(O, 0.74), Ol = shade(O, 1.18);
  const g = Array.from({ length: 16 }, () => new Array(16).fill(null));
  const p = (x, y, c) => { y += 1; if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };           // 絵ぜんたいを1マス下げる（上にも ふちどりの余白）
  const row = (y, x0, x1, c) => { for (let x = x0; x <= x1; x++) p(x, y, c); };

  // 後ろ髪（体より後ろ）
  if (hs === 1) for (let y = 4; y <= 11; y++) { p(3, y, Hd); p(12, y, Hd); if (y <= 9) { p(4, y, H); p(11, y, H); } }
  if (hs === 3) { p(12, 3, H); p(12, 4, H); p(13, 4, H); p(13, 5, Hd); p(13, 6, H); p(13, 7, Hd); p(12, 8, H); }
  // 体：服・うで・ベルト・くつ
  row(9, 6, 9, O); p(7, 9, Ol); p(8, 9, Ol);
  row(10, 4, 11, O); row(11, 4, 11, O);
  for (let y = 10; y <= 11; y++) { p(10, y, Od); p(11, y, Od); }
  p(4, 12, S); p(11, 12, S);
  row(12, 5, 10, "#5a3a22"); p(7, 12, "#e7c14a"); p(8, 12, "#e7c14a");
  for (const x of [5, 6, 9, 10]) p(x, 13, "#4a3524");                                                      // 足
  // 頭（顔）
  row(3, 5, 10, S); row(4, 4, 11, S); row(5, 4, 11, S); row(6, 4, 11, S); row(7, 5, 10, S); row(8, 6, 9, S);
  row(8, 6, 9, Sd);
  p(6, 5, "#1d1d2b"); p(6, 6, "#1d1d2b"); p(9, 5, "#1d1d2b"); p(9, 6, "#1d1d2b");        // 目
  p(5, 6, "#f2a090"); p(10, 6, "#f2a090");                                               // ほお
  p(7, 7, "#a54a3f"); p(8, 7, "#a54a3f");                                                // 口
  // 髪（前髪）
  if (hs === 0) { p(6, 1, H); p(7, 1, H); p(8, 1, H); p(9, 1, H); row(2, 5, 10, H); row(3, 4, 11, H); p(4, 4, H); p(5, 4, H); p(10, 4, H); p(11, 4, H); p(5, 3, Hd); p(10, 3, Hd); }
  else if (hs === 1) { row(1, 6, 9, H); row(2, 5, 10, H); row(3, 4, 11, H); p(4, 4, H); p(5, 4, H); p(10, 4, H); p(11, 4, H); p(6, 4, Hd); p(9, 4, Hd); }
  else if (hs === 2) { p(6, 0, H); p(9, 0, H); row(1, 5, 10, H); row(2, 4, 11, H); p(4, 3, H); p(5, 3, H); p(10, 3, H); p(11, 3, H); p(4, 4, Hd); p(11, 4, Hd); p(7, 3, Hd); }
  else if (hs === 3) { row(1, 6, 9, H); row(2, 5, 10, H); row(3, 4, 11, H); p(4, 4, H); p(11, 4, H); p(5, 4, H); p(10, 4, H); }
  else if (hs === 4) { row(2, 6, 9, Hd); p(5, 3, Hd); p(10, 3, Hd); }
  else { row(0, 7, 8, H); row(1, 6, 9, H); p(7, 1, Hd); row(2, 5, 10, H); p(4, 3, H); p(5, 3, H); p(10, 3, H); p(11, 3, H); p(4, 4, Hd); p(11, 4, Hd); }
  // かぶりもの
  if (hg === 1) {                                                                         // とんがり帽子（服の色）
    row(3, 3, 12, Od); row(2, 4, 11, O); row(1, 6, 9, O); row(0, 7, 8, Ol); p(3, 3, O); p(12, 3, O); row(2, 4, 11, O); p(5, 2, Ol);
  } else if (hg === 2) {                                                                  // かぶと
    const st = "#aab4c6", sd = "#7c879c";
    row(1, 6, 9, st); row(2, 5, 10, st); row(3, 4, 11, st); row(3, 4, 4, sd); row(3, 11, 11, sd); p(7, 4, sd); p(8, 4, sd); p(7, 5, sd); p(8, 5, sd);
    p(7, 0, "#d6453a"); p(8, 0, "#d6453a"); p(7, 1, "#d6453a"); p(8, 1, "#d6453a");
  } else if (hg === 3) {                                                                  // リボン
    const ri = "#e24d73", rd = "#a8284a";
    p(9, 1, ri); p(11, 1, ri); p(10, 2, rd); p(9, 3, ri); p(11, 3, ri); p(10, 1, ri); p(10, 3, ri);
  }
  // 役割の持ちもの
  if (role === "hero" || role === "front") {                                              // 剣
    for (let y = 5; y <= 10; y++) p(13, y, "#cfd6e4"); p(13, 4, "#eef2fa");
    row(11, 12, 14, "#e7c14a"); p(13, 12, "#6a4125"); p(12, 12, S);
  } else if (role === "healer") {                                                         // 杖
    for (let y = 6; y <= 13; y++) p(2, y, "#8a5a2e");
    p(1, 4, "#7be0a0"); p(2, 4, "#b8ffd4"); p(1, 5, "#3fb87a"); p(2, 5, "#7be0a0"); p(3, 12, S);
  } else if (role === "appraiser") {                                                      // 虫めがね
    p(13, 6, "#8a5a2e"); p(12, 7, "#8a5a2e"); p(14, 7, "#8a5a2e"); p(13, 8, "#8a5a2e"); p(13, 7, "#bfe6ff");
    p(12, 9, "#8a5a2e"); p(12, 10, "#8a5a2e"); p(12, 11, S);
  } else if (role === "thief") {                                                          // 短剣と、赤いスカーフ
    p(13, 9, "#cfd6e4"); p(13, 10, "#cfd6e4"); row(11, 12, 14, "#6a4125"); p(12, 12, S);
    row(8, 4, 11, "#c44a3a"); p(10, 9, "#c44a3a");
  }
  // ふちどり：絵のまわりを1マス、暗い色で囲む
  const edge = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (g[y][x]) continue;
    if ((x > 0 && g[y][x - 1]) || (x < 15 && g[y][x + 1]) || (y > 0 && g[y - 1][x]) || (y < 15 && g[y + 1][x])) edge.push([x, y]);
  }
  for (const [x, y] of edge) g[y][x] = OUTLINE;
  return g;
}

// ---- 画面用：canvas にして覚えておく ----------------------------------------------------------------
const cache = new Map();
export function getHeroSprite(look, role = "hero") {
  const l = cleanLook(look);
  const key = `${l.join(",")}|${role}`;
  let cv = cache.get(key);
  if (cv) return cv;
  const grid = genHeroGrid(l, role);
  cv = document.createElement("canvas");
  cv.width = 16;
  cv.height = 16;
  const c = cv.getContext("2d");
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (grid[y][x]) { c.fillStyle = grid[y][x]; c.fillRect(x, y, 1, 1); }
  if (cache.size > 200) cache.clear();
  cache.set(key, cv);
  return cv;
}
