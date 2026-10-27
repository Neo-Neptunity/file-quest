// ファイル・クエスト — モンスターの絵を、ファイルごとに自動で描き分ける（ドット絵を計算で作る。素材も通信も要らない）
// 「種」（ファイル名・拡張子・サイズ）で体型・色・目・口・飾りが決まるので、同じファイルはいつも同じ姿になる。

import { C, hashStr, rng } from "./pixel.js";
import { genBossGrid, BOSS_N } from "./boss.js";

export { C, hashStr };
export const W = 16, H = 16;

// ---- 形を作る（0〜15 の格子。左右対称に作る）---------------------------------------------------
export function genGrid(seed, cat, { lv = 1, boss = false, ghost = false } = {}) {
  const r = rng(seed);
  const rf = (a, b) => a + r() * (b - a);
  const ri = (a, b) => Math.floor(rf(a, b + 1));
  const g = Array.from({ length: H }, () => new Array(W).fill(C.E));
  const inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const set = (x, y, c) => { if (inb(x, y)) g[y][x] = c; };
  const setM = (x, y, c) => { set(x, y, c); set(W - 1 - x, y, c); };
  const get = (x, y) => (inb(x, y) ? g[y][x] : C.E);
  const topAt = (x) => { for (let y = 0; y < H; y++) if (g[y][x]) return y; return 8; };
  const botAt = (x) => { for (let y = H - 1; y >= 0; y--) if (g[y][x]) return y; return 12; };
  const leftAt = (y) => { for (let x = 0; x < W; x++) if (g[y][x]) return x; return 4; };

  // 体：楕円。taper > 0 で下が太く（スライム型）、< 0 で上が太い。ふちを少しガタつかせる
  const ellipse = (cy, rx, ry, taper = 0, noise = 0.3, code = C.BODY) => {
    for (let y = 0; y < H; y++) {
      const t = (y - cy) / ry;
      if (Math.abs(t) > 1.2) continue;
      const rxy = rx * (1 + taper * t);
      for (let x = 0; x < W / 2; x++) {
        const d = W / 2 - 0.5 - x;
        if ((d / rxy) ** 2 + t * t <= 1 + (r() - 0.5) * noise) setM(x, y, code);
      }
    }
  };
  // 目（左側の x,y に2×2。右側は鏡）
  const eye = (x, y) => { setM(x, y, C.EYEW); setM(x + 1, y, C.EYEW); setM(x, y + 1, C.EYEW); setM(x + 1, y + 1, C.PUPIL); };
  const eyes = (style, y, gap = 2) => {
    const ex = 7 - gap;                              // 左目の左端
    if (style === 0) eye(ex - 1, y);
    else if (style === 1) { for (let x = 6; x <= 9; x++) { set(x, y, C.EYEW); set(x, y + 1, x === 7 || x === 8 ? C.PUPIL : C.EYEW); } }          // 一つ目
    else if (style === 2) { eye(ex - 1, y + 1); setM(7, y - 1, C.PUPIL); }                                                                         // 三つ目
    else if (style === 3) { setM(ex - 1, y + 1, C.PUPIL); setM(ex, y + 1, C.PUPIL); setM(ex, y, C.EYEW); setM(ex - 1, y, C.OUT); }                 // つり目
    else { for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) setM(ex - 2 + k, y + j - 1, k === 1 && j === 1 ? C.PUPIL : C.EYEW); }          // ふくろうの目
  };
  const mouth = (style, y) => {
    if (style === 1) { setM(6, y, C.MOUTH); setM(7, y + 1, C.MOUTH); }
    else if (style === 2) { for (let x = 6; x <= 9; x++) set(x, y, C.MOUTH); setM(6, y + 1, C.WHITE); }
    else if (style === 3) { for (let x = 6; x <= 9; x++) set(x, y, C.MOUTH); for (let x = 6; x <= 9; x++) set(x, y + 1, x === 7 || x === 8 ? C.TONGUE : C.MOUTH); }
    else if (style === 4) { set(7, y, C.MOUTH); set(8, y, C.MOUTH); }
  };

  if (cat === "archive") {                           // ミミック：宝箱
    const x0 = ri(1, 4), x1 = W - 1 - x0, yt = ri(4, 6), lid = ri(2, 4), gap = ri(1, 3), yb = ri(12, 13), dome = ri(0, 2);
    for (let y = yt; y < yt + lid; y++) for (let x = x0; x <= x1; x++) if (!(y === yt && (x <= x0 + dome || x >= x1 - dome))) set(x, y, C.BODY);
    for (let y = yt + lid + gap; y <= yb; y++) for (let x = x0; x <= x1; x++) set(x, y, C.DARK);
    for (let y = yt + lid; y < yt + lid + gap; y++) for (let x = x0 + 1; x <= x1 - 1; x++) set(x, y, C.MOUTH);
    const tooth = ri(1, 2), off = ri(0, 1);
    for (let x = x0 + 1 + off; x <= x1 - 1; x += tooth + 1) { set(x, yt + lid, C.WHITE); if (gap >= 2) set(x + 1, yt + lid + gap - 1, C.WHITE); }
    const tl = ri(1, 3), tx = ri(0, 2) === 0 ? 6 : 7;
    for (let k = 0; k < 2; k++) for (let j = 0; j < tl; j++) set(tx + k, yt + lid + gap - 1 + j, C.TONGUE);              // 舌（箱の外まで垂れることも）
    const bands = ri(0, 2), bandC = r() < 0.5 ? C.ACC : C.ACCD;
    const bandX = bands === 0 ? [7, 8] : bands === 1 ? [x0 + 2, x1 - 2] : [];
    for (const bx of bandX) for (let y = yt; y <= yb; y++) if (get(bx, y) !== C.MOUTH && get(bx, y) !== C.WHITE && get(bx, y) !== C.TONGUE) set(bx, y, y < yt + lid ? C.ACC : bandC);
    if (bands === 0) { set(7, yb - 1, C.LIGHT); set(8, yb - 1, C.LIGHT); }
    if (ri(0, 1)) { set(x0, yt + 1, C.LIGHT); set(x1, yt + 1, C.LIGHT); set(x0, yb, C.LIGHT); set(x1, yb, C.LIGHT); }          // びょう
    const hnd = ri(0, 2);
    if (hnd === 1) { setM(x0 - 1, yt + lid + 1, C.ACCD); setM(x0 - 1, yt + lid + 2, C.ACCD); } else if (hnd === 2) { setM(x0 - 1, yt + 1, C.ACC); setM(x0 - 2, yt, C.ACC); }
    if (ri(0, 2) === 0) { setM(x0 + 1, yb + 1, C.DARK); setM(x0 + 2, yb + 1, C.DARK); }                                      // 足
    if (lid >= 3) eyes([0, 3, 1, 2][ri(0, 3)], yt, 3); else { setM(5, yt, C.EYEW); setM(5, yt + 1 > yt + lid - 1 ? yt : yt, C.PUPIL); }
  } else if (cat === "exe") {                        // ガーディアン：ロボット
    const x0 = ri(2, 5), x1 = W - 1 - x0, yt = ri(4, 6), yb = ri(12, 13), round = ri(0, 1);
    for (let y = yt; y <= yb; y++) for (let x = x0; x <= x1; x++) if (!(round && (y === yt || y === yb) && (x === x0 || x === x1))) set(x, y, C.BODY);
    const vis = ri(0, 2), vy = yt + 1 + ri(0, 1);
    for (let x = x0 + 1; x <= x1 - 1; x++) { set(x, vy, C.DARK); if (vis !== 1) set(x, vy + 1, C.DARK); }
    if (vis === 0) { setM(5, vy, C.ACC); setM(6, vy, C.ACC); setM(5, vy + 1, C.ACC); setM(6, vy + 1, C.ACC); }              // 四角い目
    else if (vis === 1) { for (let x = 5; x <= 10; x++) set(x, vy, C.ACC); }                                                 // 一本線の目
    else { setM(4, vy, C.ACC); setM(6, vy + 1, C.ACC); set(7, vy, C.ACC); set(8, vy, C.ACC); }                               // 三つの光
    const chest = ri(0, 2), cy = vy + 3;
    if (chest === 0) for (let x = x0 + 2; x <= x1 - 2; x++) set(x, cy + 1, x % 2 ? C.MOUTH : C.DARK);                        // 排気口
    else if (chest === 1) { setM(6, cy, C.ACC); setM(7, cy, C.ACC); setM(6, cy + 1, C.ACC); setM(7, cy + 1, C.ACC); }       // 胸の光
    else { for (let x = x0 + 1; x <= x1 - 1; x++) set(x, cy, C.ACCD); }                                                       // ベルト
    const arm = ri(0, 3);
    if (arm === 0) { setM(x0 - 1, yt + 3, C.ACCD); setM(x0 - 1, yt + 4, C.ACCD); setM(x0 - 2, yt + 4, C.ACCD); }
    else if (arm === 1) { for (let y = yt + 2; y <= yb - 1; y++) setM(x0 - 1, y, C.ACCD); setM(x0 - 1, yb, C.ACC); }
    else if (arm === 2) { setM(x0 - 1, yt + 2, C.ACC); setM(x0 - 2, yt + 1, C.ACC); setM(x0 - 1, yt + 3, C.ACCD); }
    const ant = ri(0, 3);
    if (ant === 0) { set(7, yt - 1, C.ACCD); set(8, yt - 1, C.ACCD); set(7, yt - 2, C.ACC); set(8, yt - 2, C.ACC); }
    else if (ant === 1) { setM(5, yt - 1, C.ACCD); setM(5, yt - 2, C.ACC); }
    else if (ant === 2) { set(7, yt - 1, C.ACCD); set(7, yt - 2, C.ACCD); set(7, yt - 3, C.ACC); }
    setM(x0, yt, C.LIGHT);
    const leg = ri(0, 2);
    if (leg === 0) { setM(x0 + 1, yb + 1, C.ACCD); setM(x0 + 2, yb + 1, C.ACCD); } else if (leg === 1) { setM(x0 + 1, yb + 1, C.ACCD); setM(x0 + 1, yb + 2, C.ACCD); }
  } else if (cat === "image") {                      // 妖精：小さな体と羽
    ellipse(8, rf(2.6, 3.3), rf(3, 3.9), rf(-0.1, 0.2), 0.25);
    const wings = ri(0, 2), wl = ri(3, 4), wh = ri(3, 5);
    for (let j = 0; j < wh; j++) {
      const y = 5 + j, len = Math.max(1, wl - (wings === 1 ? j : Math.abs(j - 1)));
      const edge = leftAt(8) ;
      for (let k = 1; k <= len; k++) setM(edge - k, y, k === len ? C.ACC : C.LIGHT);
    }
    const ty = topAt(7);
    if (r() < 0.6) { setM(6, ty - 1, C.ACCD); setM(5, ty - 2, C.ACC); }                                                 // 触角
    for (let k = 0; k < 4; k++) { const x = ri(0, 15), y = ri(1, 14); if (!get(x, y) && !get(x - 1, y) && !get(x + 1, y) && !get(x, y - 1) && !get(x, y + 1)) set(x, y, C.ACC); }
    eyes(r() < 0.7 ? 0 : 3, 7, 2);
    mouth(r() < 0.5 ? 1 : 4, 11);
  } else if (cat === "video") {                      // ドラゴン：角・翼・牙
    ellipse(9, rf(4.3, 5.2), rf(3.8, 4.6), rf(-0.2, 0.1), 0.35);
    const ty = topAt(5), horn = ri(2, 4);
    for (let k = 1; k <= horn; k++) setM(4 - (k > 2 ? 1 : 0), ty - k, C.ACC);
    if (r() < 0.6) for (const x of [6, 7]) setM(x, topAt(x) - 1, C.ACCD);
    const wl = ri(2, 4);
    for (let j = 0; j < 5; j++) { const y = 6 + j, len = Math.max(1, wl - Math.abs(j - 1)); const edge = leftAt(y); for (let k = 1; k <= len; k++) setM(edge - k, y, k === len ? C.ACC : C.ACCD); }
    eyes(3, 8, 2);
    mouth(r() < 0.5 ? 2 : 3, 12);
    setM(6, 10, C.DARK);                                                                                                // 鼻
  } else if (cat === "audio") {                      // セイレーン：長い髪
    ellipse(7, rf(3.3, 4.2), rf(3.2, 4), 0, 0.2);
    const hair = ri(0, 1), edge = leftAt(7), ty = topAt(7);
    for (let x = 4; x <= 11; x++) if (get(x, ty) && r() < 0.8) set(x, ty, C.ACC);
    for (let side = 0; side < 2; side++) for (let k = 0; k < 2; k++) {
      for (let y = 5; y <= 14; y++) {
        const wave = Math.round(Math.sin((y + k * 2 + hair * 3) * 0.9));
        const x = edge - 1 - k + wave;
        if (!get(x, y)) { if (side === 0) set(x, y, C.ACC); else set(W - 1 - x, y, C.ACC); }
      }
    }
    eyes(r() < 0.6 ? 0 : 4, 6, 2);
    mouth(r() < 0.6 ? 1 : 4, 10);
    if (r() < 0.6) { setM(5, ty, C.ACCD); set(7, ty - 1, C.WHITE); set(8, ty - 1, C.WHITE); }                           // 髪かざり
  } else if (cat === "doc") {                        // 賢者：ふくろう＋帽子＋ひげ
    ellipse(9, rf(3.8, 5), rf(4, 5.2), rf(-0.2, 0.3), 0.25);
    const ty = topAt(7), hat = ri(0, 3);
    if (hat === 0) { const w = [1, 2, 4, 6]; for (let i = 0; i < 4; i++) for (let k = 0; k < w[i]; k++) set(7 - Math.floor(w[i] / 2) + k, ty - 4 + i, C.ACC); for (let x = 3; x <= 12; x++) set(x, ty, C.ACCD); }
    else if (hat === 1) { for (let x = 2; x <= 13; x++) set(x, ty - 1, C.ACCD); for (let x = 5; x <= 10; x++) set(x, ty, C.ACC); set(13, ty, C.ACC); set(13, ty + 1, C.ACC); }
    else if (hat === 2) { setM(5, ty - 1, C.ACC); set(7, ty - 1, C.ACC); set(8, ty - 1, C.ACC); setM(4, ty, C.ACCD); }
    else { for (let x = 4; x <= 11; x++) set(x, ty - 1, C.ACC); setM(4, ty - 2, C.ACC); setM(6, ty - 2, C.ACC); }
    const es = [4, 0, 1, 3][ri(0, 3)];
    eyes(es, 8, 2);
    if (r() < 0.45) for (const [x, y] of [[4, 7], [4, 8], [4, 9], [5, 6], [6, 6], [5, 10], [6, 10]]) if (!get(x, y)) setM(x, y, C.ACCD);   // めがね
    const beard = ri(0, 3);
    if (beard === 0) { for (let i = 0; i < 4; i++) for (let x = 5 + i; x <= 10 - i; x++) if (i < 3) set(x, 12 + i, C.WHITE); }
    else if (beard === 1) { for (let x = 5; x <= 10; x++) set(x, 11, C.WHITE); mouth(4, 12); }
    else if (beard === 2) { for (let i = 0; i < 3; i++) for (let x = 4 + i; x <= 11 - i; x++) set(x, 11 + i, C.WHITE); }
    else mouth(r() < 0.5 ? 1 : 3, 12);
    if (r() < 0.4) { for (let y = 5; y <= 14; y++) set(14, y, C.ACCD); set(14, 4, C.ACC); set(13, 4, C.ACC); }                    // つえ
  } else if (cat === "code") {                       // ゴブリン：とがった耳とキバ
    ellipse(9, rf(4.8, 5.8), rf(3.6, 4.4), rf(-0.1, 0.1), 0.3);
    const le = leftAt(8);
    for (const [dx, dy] of [[1, 0], [2, -1], [3, -2], [1, -1], [2, -2], [1, 1]]) setM(le - dx, 8 + dy, C.BODY);
    setM(le - 2, 7, C.LIGHT);
    if (r() < 0.5) { setM(5, topAt(5) - 1, C.ACC); setM(5, topAt(5) - 2, C.ACC); }
    if (r() < 0.4) { setM(4, topAt(4) - 1, C.ACCD); }
    eyes(r() < 0.6 ? 3 : 0, 7, 2);
    mouth(2, 11);
  } else {                                           // かげ：ぶよぶよした影に、たくさんの目
    ellipse(10, rf(5, 6), rf(3.8, 4.8), rf(0.25, 0.5), 0.5);
    const b = botAt(7);
    for (let k = 0; k < 4; k++) { const x = ri(2, 13); if (get(x, b)) { set(x, b + 1, C.BODY); if (r() < 0.5) set(x, b + 2, C.BODY); } }
    const n = ri(3, 5);
    for (let k = 0; k < n; k++) { const x = ri(4, 11), y = ri(6, 10); if (get(x, y) === C.BODY) { set(x, y, C.EYEW); if (get(x, y + 1) === C.BODY) set(x, y + 1, C.PUPIL); } }
    const my = 12; for (let x = 4; x <= 11; x++) if (get(x, my) === C.BODY) set(x, my, x % 2 ? C.MOUTH : C.WHITE);
  }

  // どの生き物にも、ときどき付くおまけ（足・ほお・傷・背中のとげ）
  if (cat !== "archive" && cat !== "exe") {
    if (!ghost && r() < 0.4) { const b = botAt(5); setM(5, b + 1, C.DARK); setM(4, b + 1, C.DARK); if (r() < 0.5) setM(5, b + 2, C.DARK); }
    if (r() < 0.3) { for (let y = 8; y <= 11; y++) if (g[y][5] === C.BODY && g[y + 1] && g[y + 1][5] === C.BODY) { setM(4, y + 1, C.TONGUE); break; } }
    if (r() < 0.2) { const y = ri(8, 10); if (g[y][10] === C.BODY && g[y][11] === C.BODY) { set(10, y, C.DARK); set(11, y + 1, C.DARK); } }
  }

  // 高レベルの印：つの・とげ、さらに強いと目が光る
  if (lv >= 6 && cat !== "archive" && cat !== "exe") { const ty = topAt(6); setM(6, ty - 1, C.ACC); }
  if (lv >= 12) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === C.PUPIL) g[y][x] = C.ACC;
  if (boss) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === C.EYEW && r() < 0.0) g[y][x] = C.ACC;

  // ぼうれい：下のふちをゆらゆらに
  if (ghost) {
    for (let x = 0; x < W; x++) { const b = botAt(x); if (g[b][x] && x % 3 === 0) g[b][x] = C.E; if (g[b - 1] && g[b - 1][x] && x % 3 === 1 && b > 10) g[b][x] = C.E; }
  }

  // 陰影：上のふちは明るく、下のふちは暗く
  const shade = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== C.BODY) continue;
    if (!get(x, y - 1)) shade.push([x, y, C.LIGHT]); else if (!get(x, y + 1)) shade.push([x, y, C.DARK]);
  }
  for (const [x, y, c] of shade) g[y][x] = c;
  // ふちどり
  const edge = [];
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
    if (!inb(x, y) || get(x, y)) continue;
    if (get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1)) edge.push([x, y]);
  }
  for (const [x, y] of edge) set(x, y, C.OUT);
  return g;
}

// ---- 色 -----------------------------------------------------------------------------------------
const BASE_HUE = { image: 300, video: 125, audio: 195, archive: 30, doc: 45, code: 110, exe: 210, other: 265 };
const HUE_SPAN = { image: 90, video: 200, audio: 50, archive: 20, doc: 45, code: 40, exe: 15, other: 50 };
export function makePalette(seed, cat, ghost = false) {
  const r = rng(seed ^ 0x5bd1e995);
  const h = (((BASE_HUE[cat] ?? 200) + (r() - 0.5) * (HUE_SPAN[cat] ?? 60) * 2) % 360 + 360) % 360;
  let s = cat === "exe" ? 20 : cat === "other" ? 26 : 52 + r() * 18;
  let l = cat === "other" ? 34 : 50;
  if (ghost) { s *= 0.4; l += 18; }
  const hsl = (hh, ss, ll) => `hsl(${Math.round(hh) % 360} ${Math.round(ss)}% ${Math.round(ll)}%)`;
  const ah = (h + 150 + r() * 40) % 360;
  return [
    "rgba(0,0,0,0)", hsl(h, s, l), hsl(h, s, l - 17), hsl(h, s * 0.8, l + 17), hsl(ah, 70, 58),
    "#ffffff", "#1a1226", "#120d1c", "#3a1020", "#f4f1e8", "#e0607a", hsl(ah, 60, 38),
  ];
}

// ---- 絵にする（同じファイルは使いまわす）----------------------------------------------------------------
const cache = new Map();
export function getSprite(key, cat, opts = {}) {
  const lvBucket = opts.lv >= 12 ? 2 : opts.lv >= 6 ? 1 : 0;
  const k = `${key}|${cat}|${lvBucket}|${opts.boss ? 1 : 0}|${opts.ghost ? 1 : 0}`;
  let cv = cache.get(k);
  if (cv) return cv;
  const seed = hashStr(key);
  const grid = opts.boss ? genBossGrid(seed, cat, { lv: opts.lv, ghost: opts.ghost }) : genGrid(seed, cat, { ...opts, lv: opts.lv });   // ボスは32×32の専用の絵
  const n = grid.length;
  const pal = makePalette(seed, cat, opts.ghost);
  cv = document.createElement("canvas");
  cv.width = n;
  cv.height = n;
  const c = cv.getContext("2d");
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (grid[y][x]) { c.fillStyle = pal[grid[y][x]]; c.fillRect(x, y, 1, 1); }
  if (cache.size > 150) cache.clear();
  cache.set(k, cv);
  return cv;
}
