// ファイル・クエスト — ダンジョンの階を、シードから機械的につくる（画面を持たない）
// 形は3種類：洞窟型（ぐにゃぐにゃの通路）・塔型（部屋を廊下でつなぐ）・城型（広間と回廊が左右対称）。沼は、洞窟型の形で、色だけちがう。
// どの階も、「入口の階段から、ほかの階段・宝箱・泉・ボスの所まで、歩いて着ける」ことを、つくるたびに確かめる（着けなければ、つくりなおす）。
// 同じシードなら、いつも同じ形（いつ入っても同じ）。
import { hashStr, rng } from "./pixel.js";
import { reach, farthest } from "./grid.js";

export const D = { WALL: 0, FLOOR: 1, UP: 2, DOWN: 3, CHEST: 4, SPRING: 5, BOSS: 6, OPEN: 7, WATER: 8 };       // OPEN：開けた宝箱　WATER：池（通れない）
export const passable = (t) => t !== D.WALL && t !== D.WATER;

// 世界地図の遺跡の番号ごとの、ダンジョンの型。名前（ダウンロード遺跡・スクショの洞窟・動画の巣・アーカイブの塔・一時ファイルの沼）に合わせる
export const RUIN_STYLES = ["castle", "cave", "cave", "tower", "swamp"];
export const styleFor = (ruinIndex) => RUIN_STYLES[((ruinIndex % RUIN_STYLES.length) + RUIN_STYLES.length) % RUIN_STYLES.length];
export const shapeOf = (style) => (style === "swamp" ? "cave" : style);
export const SIZES = { cave: [44, 32], tower: [40, 30], castle: [41, 31], lake: [44, 32], maze: [41, 31], hall: [41, 31], ring: [41, 31] };
// ジャンルごとの 形の組み合わせ。1階は、そのジャンルらしい形（先頭）。ほかの階は、組み合わせの中から、階ごとに ちがう形が選ばれる
export const SHAPE_POOL = { cave: ["cave", "lake", "maze"], swamp: ["lake", "cave", "maze"], tower: ["tower", "ring", "maze"], castle: ["castle", "hall", "ring"] };
export function shapeFor(style, floor, key) {
  const pool = SHAPE_POOL[style] || SHAPE_POOL.cave;
  if (floor <= 1) return pool[0];
  const h = hashStr(`${key}|shape`);
  return pool[(h + floor) % pool.length];
}
// 階に おりたときの 一言（形ごとの ようす）
export const SHAPE_FEEL = {
  cave: "ぐねぐねと 通路が うねっている。", lake: "あちこちに 水たまりが ひろがっている。", maze: "せまい 通路が 入りくんでいる。道に まよいそうだ。",
  tower: "部屋と ろうかが つらなっている。", ring: "ぐるりと めぐる 回廊が 何重にも なっている。", castle: "左右に ひろがる 城の 中だ。", hall: "柱の ならぶ 大広間が ひろがっている。",
};
export const floorsFor = (key) => 3 + (hashStr(`${key}|floors`) % 3);                // 3〜5階
export const floorLabel = (style, floor) => (style === "tower" ? `${floor}階` : `地下${floor}階`);
export const dungeonKey = (islandSeed, ruinIndex) => `${islandSeed}:${ruinIndex}`;

const idx = (w, x, y) => y * w + x;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---- 形（床=1 / 壁=0 の格子）------------------------------------------------------------------
function caveShape(r, w, h) {
  let a = new Uint8Array(w * h);
  const fill = 0.45 + r() * 0.04;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) a[idx(w, x, y)] = r() < fill ? 1 : 0;
  for (let it = 0; it < 5; it++) {                                       // 壁が5つ以上まわりにあれば壁、そうでなければ床
    const b = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!a[idx(w, x + dx, y + dy)]) walls++;
      b[idx(w, x, y)] = walls >= 5 ? 0 : 1;
    }
    a = b;
  }
  return a;
}

function towerShape(r, w, h) {
  const a = new Uint8Array(w * h);
  const rooms = [];
  for (let tries = 0; tries < 400 && rooms.length < 10; tries++) {
    const rw = 5 + Math.floor(r() * 7), rh = 4 + Math.floor(r() * 4);
    const x = 2 + Math.floor(r() * (w - rw - 4)), y = 2 + Math.floor(r() * (h - rh - 4));
    if (rooms.some((o) => x < o.x + o.w + 2 && x + rw + 2 > o.x && y < o.y + o.h + 2 && y + rh + 2 > o.y)) continue;
    rooms.push({ x, y, w: rw, h: rh });
  }
  if (rooms.length < 6) return null;
  rooms.sort((p, q) => p.x + p.w / 2 - (q.x + q.w / 2));
  for (const o of rooms) {
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) a[idx(w, x, y)] = 1;
    if (o.w >= 8 && o.h >= 5) for (let y = o.y + 1; y < o.y + o.h - 1; y += 2) for (let x = o.x + 2; x < o.x + o.w - 2; x += 2) a[idx(w, x, y)] = 0;       // 柱
  }
  const mid = (o) => [o.x + (o.w >> 1), o.y + (o.h >> 1)];
  const corridor = (p, q) => {                                          // L字の廊下（柱も、廊下が通ったところは通れる）
    const [px, py] = mid(p), [qx, qy] = mid(q);
    const horizFirst = r() < 0.5;
    const hx = (y) => { for (let x = Math.min(px, qx); x <= Math.max(px, qx); x++) a[idx(w, x, y)] = 1; };
    const vy = (x) => { for (let y = Math.min(py, qy); y <= Math.max(py, qy); y++) a[idx(w, x, y)] = 1; };
    if (horizFirst) { hx(py); vy(qx); } else { vy(px); hx(qy); }
  };
  for (let i = 0; i < rooms.length - 1; i++) corridor(rooms[i], rooms[i + 1]);
  for (let k = 0; k < 2; k++) { const i = Math.floor(r() * (rooms.length - 2)); corridor(rooms[i], rooms[Math.min(rooms.length - 1, i + 2 + Math.floor(r() * 2))]); }       // ぐるっと回れる廊下
  return a;
}

function castleShape(r, w, h) {                                         // 左半分をつくって、左右対称にする（w・h は奇数）
  const a = new Uint8Array(w * h), mid = (w - 1) / 2;
  const set = (x, y, v = 1) => { a[idx(w, x, y)] = v; a[idx(w, w - 1 - x, y)] = v; };
  for (let y = 2; y <= h - 3; y++) for (let x = mid - 2; x <= mid + 2; x++) set(x, y, 1);                  // 中央の広間
  for (let y = 3; y <= h - 4; y++) set(2, y, 1);                                                          // 外まわりの回廊
  let y0 = 3;
  while (y0 + 4 < h - 3) {
    const rh = 4 + Math.floor(r() * 3), rx0 = 4 + Math.floor(r() * 2), rx1 = mid - 6 - Math.floor(r() * 2);
    const top = Math.min(y0, h - 4 - rh);
    if (r() < 0.8) {                                                                                    // 部屋（たまに、ない）
      for (let y = top; y < top + rh; y++) for (let x = rx0; x <= rx1; x++) set(x, y, 1);
      let dy = top + (rh >> 1);
      if (dy % 4 === 0) dy++;
      for (let x = rx1 + 1; x <= mid - 3; x++) set(x, dy, 1);                                           // 広間への戸
      set(3, dy, 1);                                                                                    // 回廊への戸
    }
    y0 = top + rh + 2 + Math.floor(r() * 2);
  }
  for (let y = 4; y <= h - 5; y += 4) { if (a[idx(w, mid - 3, y)] === 0) { set(mid - 2, y, 0); } }          // 柱（広間の外側が壁のところだけ）
  return a;
}

// ---- 形を ふやす：水たまりの洞窟・迷路・大広間・めぐる回廊 ----------------------------------------------------
// どの階も、ジャンルごとの 形の組み合わせから、階ごとに ちがう形が選ばれる（1階は、そのジャンルらしい形）

// 水たまりの洞窟：洞窟に、池（2）を うかべる。池をつくっても、床が とぎれない（歩いて 全部に 着ける）ところにだけ、おく
function lakeShape(r, w, h) {
  const a = caveShape(r, w, h);
  let base = largestComponent(a, w, h);
  const ponds = 6 + Math.floor(r() * 4);
  for (let k = 0, tries = 0; k < ponds && tries < 60; tries++) {
    const cx = 4 + Math.floor(r() * (w - 8)), cy = 4 + Math.floor(r() * (h - 8)), rr = 2 + Math.floor(r() * 3);
    if (a[idx(w, cx, cy)] !== 1) continue;
    const changed = [];
    for (let y = cy - rr; y <= cy + rr; y++) for (let x = cx - rr; x <= cx + rr; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
      if (Math.hypot(x - cx, y - cy) <= rr + r() * 0.8 && a[idx(w, x, y)] === 1) { a[idx(w, x, y)] = 2; changed.push(idx(w, x, y)); }
    }
    if (changed.length < 6) { for (const i of changed) a[i] = 1; continue; }
    const cut = changed.filter((i) => base.comp[i] === base.best).length;                                  // 池になった、いちばん大きな つながりの床
    const now = largestComponent(a, w, h);
    if (now.size >= base.size - cut - 2) { base = now; k++; }                                               // 床が とぎれていない
    else for (const i of changed) a[i] = 1;
  }
  return a;
}

// 迷路：せまい通路が 入りくむ。行き止まりと、ところどころの小部屋。ぐるっと回れる道も すこし
function mazeShape(r, w, h) {                                           // w・h は奇数
  const a = new Uint8Array(w * h), cw = (w - 1) >> 1, ch = (h - 1) >> 1;
  const seen = new Uint8Array(cw * ch), stack = [[Math.floor(r() * cw), Math.floor(r() * ch)]];
  seen[stack[0][1] * cw + stack[0][0]] = 1;
  a[idx(w, stack[0][0] * 2 + 1, stack[0][1] * 2 + 1)] = 1;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const next = N4.map(([dx, dy]) => [x + dx, y + dy, dx, dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny * cw + nx]);
    if (!next.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = next[Math.floor(r() * next.length)];
    seen[ny * cw + nx] = 1;
    a[idx(w, x * 2 + 1 + dx, y * 2 + 1 + dy)] = 1;
    a[idx(w, nx * 2 + 1, ny * 2 + 1)] = 1;
    stack.push([nx, ny]);
  }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {                                       // 壁を ところどころ 抜いて、ぐるっと回れるように
    if (a[idx(w, x, y)] || (x + y) % 2 === 0) continue;
    const horiz = a[idx(w, x - 1, y)] && a[idx(w, x + 1, y)], vert = a[idx(w, x, y - 1)] && a[idx(w, x, y + 1)];
    if ((horiz || vert) && r() < 0.07) a[idx(w, x, y)] = 1;
  }
  const rooms = 3 + Math.floor(r() * 3);
  for (let k = 0; k < rooms; k++) {                                                                      // 小部屋（奇数の位置・奇数の大きさ）
    const rw = 3 + 2 * Math.floor(r() * 3), rh = 3 + 2 * Math.floor(r() * 2);
    const x0 = 1 + 2 * Math.floor(r() * ((w - rw - 1) >> 1)), y0 = 1 + 2 * Math.floor(r() * ((h - rh - 1) >> 1));
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) a[idx(w, x, y)] = 1;
  }
  return a;
}

// 大広間：柱のならぶ大きな広間と、まわりの小部屋。小部屋は 細い廊下で 広間と つながる
function hallShape(r, w, h) {
  const a = new Uint8Array(w * h);
  const hx0 = 9 + Math.floor(r() * 2), hx1 = w - 1 - hx0, hy0 = 8 + Math.floor(r() * 2), hy1 = h - 1 - hy0;
  for (let y = hy0; y <= hy1; y++) for (let x = hx0; x <= hx1; x++) a[idx(w, x, y)] = 1;
  for (let y = hy0 + 2; y <= hy1 - 2; y += 4) for (let x = hx0 + 2; x <= hx1 - 2; x += 4) a[idx(w, x, y)] = 0;     // 柱
  const chambers = [];
  const zones = [[2, 2, hx0 - 5, hy0 - 4], [w - hx0 + 3, 2, w - 3, hy0 - 4], [2, hy1 + 3, hx0 - 5, h - 3], [w - hx0 + 3, hy1 + 3, w - 3, h - 3], [hx0 + 3, 2, hx1 - 3, hy0 - 3], [hx0 + 3, hy1 + 2, hx1 - 3, h - 3]];
  for (const [zx0, zy0, zx1, zy1] of zones) {
    if (zx1 - zx0 < 3 || zy1 - zy0 < 3 || r() < 0.12) continue;
    const rw = Math.min(zx1 - zx0 + 1, 4 + Math.floor(r() * 5)), rh = Math.min(zy1 - zy0 + 1, 3 + Math.floor(r() * 3));
    const x0 = zx0 + Math.floor(r() * (zx1 - zx0 - rw + 2)), y0 = zy0 + Math.floor(r() * (zy1 - zy0 - rh + 2));
    for (let y = y0; y < y0 + rh && y < h - 1; y++) for (let x = x0; x < x0 + rw && x < w - 1; x++) a[idx(w, x, y)] = 1;
    chambers.push({ x: x0 + (rw >> 1), y: y0 + (rh >> 1) });
  }
  for (const c of chambers) {                                                                           // 広間の いちばん近い ふちまで、まっすぐ
    const tx = Math.max(hx0, Math.min(hx1, c.x)), ty = Math.max(hy0, Math.min(hy1, c.y));
    for (let y = Math.min(c.y, ty); y <= Math.max(c.y, ty); y++) a[idx(w, c.x, y)] = 1;
    for (let x = Math.min(c.x, tx); x <= Math.max(c.x, tx); x++) a[idx(w, x, ty)] = 1;
  }
  for (let i = 0; i + 1 < chambers.length; i += 2) {                                                    // 小部屋どうしの 近道
    const p = chambers[i], q = chambers[i + 1];
    for (let x = Math.min(p.x, q.x); x <= Math.max(p.x, q.x); x++) a[idx(w, x, p.y)] = 1;
    for (let y = Math.min(p.y, q.y); y <= Math.max(p.y, q.y); y++) a[idx(w, q.x, y)] = 1;
  }
  return a;
}

// めぐる回廊：3重の輪の廊下。輪と輪は ところどころの門で つながり、輪には 崩れた所（通れない）がある。まんなかに 小さな広間
function ringShape(r, w, h) {
  const a = new Uint8Array(w * h);
  const rings = [2, 7, 12];
  for (const o of rings) {
    for (let y = o; y <= h - 1 - o; y++) for (let x = o; x <= w - 1 - o; x++) {
      if (x < o + 2 || x > w - 3 - o || y < o + 2 || y > h - 3 - o) a[idx(w, x, y)] = 1;
    }
  }
  for (let y = 14; y <= h - 15; y++) for (let x = 14; x <= w - 15; x++) a[idx(w, x, y)] = 1;                  // まんなかの広間
  const gate = (o, side) => {                                                                            // 輪 o と、そのうち側の輪を つなぐ（壁の 3マスぶん）
    const gap = [o + 2, o + 3, o + 4];
    if (side === 0) { const x = o + 2 + Math.floor(r() * (w - 2 * o - 6)); for (const gy of gap) a[idx(w, x, gy)] = 1; a[idx(w, x + 1, gap[1])] = a[idx(w, x + 1, gap[1])]; }
    else if (side === 1) { const x = o + 2 + Math.floor(r() * (w - 2 * o - 6)); for (const gy of gap) a[idx(w, x, h - 1 - gy)] = 1; }
    else if (side === 2) { const y = o + 2 + Math.floor(r() * (h - 2 * o - 6)); for (const gx of gap) a[idx(w, gx, y)] = 1; }
    else { const y = o + 2 + Math.floor(r() * (h - 2 * o - 6)); for (const gx of gap) a[idx(w, w - 1 - gx, y)] = 1; }
  };
  for (let k = 0; k < 2; k++) for (let n = 0; n < 2; n++) gate(rings[k], Math.floor(r() * 4));
  gate(rings[2], 0); gate(rings[2], 3);
  for (const o of rings) {                                                                               // 崩れた所：廊下を 2か所、ふさぐ（まわり道を させる）
    for (let n = 0; n < 2; n++) {
      const horiz = r() < 0.5;
      if (horiz) { const x = o + 4 + Math.floor(r() * (w - 2 * o - 8)), y = r() < 0.5 ? o : h - 1 - o; for (let d = 0; d < 2; d++) { a[idx(w, x, y + (y === o ? d : -d))] = 0; a[idx(w, x + 1, y + (y === o ? d : -d))] = 0; } }
      else { const y = o + 4 + Math.floor(r() * (h - 2 * o - 8)), x = r() < 0.5 ? o : w - 1 - o; for (let d = 0; d < 2; d++) { a[idx(w, x + (x === o ? d : -d), y)] = 0; a[idx(w, x + (x === o ? d : -d), y + 1)] = 0; } }
    }
  }
  return a;
}

// ---- 仕上げ：いちばん大きい つながりだけ残し、階段・宝箱・泉・ボスを置く --------------------------------
function largestComponent(a, w, h) {
  const comp = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 1 || comp[i] >= 0) continue;
    const queue = [i];
    comp[i] = id;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q], x = c % w, y = (c - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = idx(w, nx, ny);
        if (a[j] === 1 && comp[j] < 0) { comp[j] = id; queue.push(j); }
      }
    }
    if (queue.length > bestSize) { bestSize = queue.length; best = id; }
    id++;
  }
  return { comp, best, size: bestSize };
}

function furnish(a, w, h, r, { floor, floors }) {
  const { comp, best, size } = largestComponent(a, w, h);
  if (best < 0 || size < w * h * 0.16) return null;
  const tiles = new Uint8Array(w * h);
  const floorCells = [];
  for (let i = 0; i < tiles.length; i++) { if (comp[i] === best) { tiles[i] = D.FLOOR; floorCells.push(i); } else if (a[i] === 2) tiles[i] = D.WATER; }
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < w && y < h && passable(tiles[idx(w, x, y)]);
  const A = floorCells[Math.floor(r() * floorCells.length)];
  const d1 = reach(w, h, (x, y) => isFloor(x, y), { x: A % w, y: Math.floor(A / w) });
  const S = farthest(d1, w);                                              // 入口：どこかから、いちばん遠いところ
  const dS = reach(w, h, (x, y) => isFloor(x, y), S);
  const E = farthest(dS, w);                                              // 奥：入口から、いちばん遠いところ
  if (!S || !E || E.d < 22) return null;
  const used = [S, E];
  const far = (p, min) => used.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= min);
  const deadEnd = (x, y) => N4.reduce((n, [dx, dy]) => n + (isFloor(x + dx, y + dy) ? 1 : 0), 0) === 1;
  // 宝箱：行き止まりを優先（入口から遠い順）。なければ、遠い床
  const cands = floorCells.map((i) => ({ x: i % w, y: Math.floor(i / w), d: dS[i] })).filter((p) => p.d >= 8 && !(p.x === S.x && p.y === S.y) && !(p.x === E.x && p.y === E.y));
  const dead = cands.filter((p) => deadEnd(p.x, p.y)).sort((p, q) => q.d - p.d || p.x - q.x || p.y - q.y);
  const rest = cands.filter((p) => !deadEnd(p.x, p.y)).sort((p, q) => q.d - p.d || p.x - q.x || p.y - q.y);
  const want = 2 + (floor === floors ? 1 : 0) + (r() < 0.5 ? 1 : 0);
  const chests = [];
  for (const p of [...dead, ...rest]) {
    if (chests.length >= want) break;
    if (!far(p, 7)) continue;
    chests.push({ x: p.x, y: p.y, id: `${floor}:${chests.length}` });
    used.push(p);
  }
  // 泉：2階（と、4階）は、中ほどに。最後の階は、ボスの前の 入口の近くに
  let spring = null;
  const wantSpring = floor === floors ? "near" : floor % 2 === 0 ? "mid" : null;
  if (wantSpring) {
    const target = wantSpring === "near" ? 7 : Math.round(E.d / 2);
    const sp = cands.filter((p) => far(p, 4)).sort((p, q) => Math.abs(p.d - target) - Math.abs(q.d - target) || p.x - q.x || p.y - q.y)[0];
    if (sp) spring = { x: sp.x, y: sp.y };
  }
  tiles[idx(w, S.x, S.y)] = D.UP;
  const last = floor === floors;
  tiles[idx(w, E.x, E.y)] = last ? D.BOSS : D.DOWN;
  for (const c of chests) tiles[idx(w, c.x, c.y)] = D.CHEST;
  if (spring) tiles[idx(w, spring.x, spring.y)] = D.SPRING;
  // 確かめ：入口から、ぜんぶに歩いて着ける
  const dd = reach(w, h, (x, y) => passable(tiles[idx(w, x, y)]), S);
  const specials = [E, ...chests, ...(spring ? [spring] : [])];
  if (specials.some((p) => dd[idx(w, p.x, p.y)] < 0)) return null;
  return { w, h, tiles, start: { x: S.x, y: S.y }, up: { x: S.x, y: S.y }, down: last ? null : { x: E.x, y: E.y }, boss: last ? { x: E.x, y: E.y } : null, spring, chests, floor, floors, length: E.d };
}

const SHAPES = { cave: caveShape, tower: towerShape, castle: castleShape, lake: lakeShape, maze: mazeShape, hall: hallShape, ring: ringShape };

// 階をつくる。key はダンジョンごとの印（islandSeed:遺跡の番号）、style は RUIN_STYLES のどれか
export function buildFloor({ key, style, floor, floors }) {
  const shape = shapeFor(style, floor, key), [w, h] = SIZES[shape];
  for (let i = 0; i < 60; i++) {
    const r = rng(hashStr(`${key}|${style}|${floor}|${i}`));
    const a = SHAPES[shape](r, w, h);
    if (!a) continue;
    const f = furnish(a, w, h, r, { floor, floors });
    if (f) return { ...f, style, shape, key };
  }
  return plainFloor({ key, style, floor, floors });                      // どうしてもできなければ、まっすぐな部屋（めったに使わない）
}
function plainFloor({ key, style, floor, floors }) {
  const w = 30, h = 14, tiles = new Uint8Array(w * h);
  for (let y = 3; y < 11; y++) for (let x = 2; x < 28; x++) tiles[idx(w, x, y)] = D.FLOOR;
  const last = floor === floors;
  tiles[idx(w, 3, 7)] = D.UP;
  tiles[idx(w, 26, 7)] = last ? D.BOSS : D.DOWN;
  const chests = [{ x: 14, y: 4, id: `${floor}:0` }, { x: 14, y: 10, id: `${floor}:1` }];
  for (const c of chests) tiles[idx(w, c.x, c.y)] = D.CHEST;
  return { w, h, tiles, start: { x: 3, y: 7 }, up: { x: 3, y: 7 }, down: last ? null : { x: 26, y: 7 }, boss: last ? { x: 26, y: 7 } : null, spring: null, chests, floor, floors, length: 23, style, shape: "cave", key };
}

// ---- 宝箱の中身（ゴールド・道具・素材。ファイルは、出ない）-------------------------------------------------
const LOOT_ITEMS = ["herb", "herb", "herb2", "ether", "smoke", "bomb"];
const LOOT_CATS = ["image", "video", "audio", "archive", "doc", "code", "exe", "other"];
export function chestLoot(rand, { floor = 1, heroLv = 1 } = {}) {
  const gold = Math.round((24 + 7 * heroLv) * (0.7 + rand() * 0.6) * (1 + (floor - 1) * 0.25));
  const items = {}, mats = {};
  if (rand() < 0.55) { const id = LOOT_ITEMS[Math.floor(rand() * LOOT_ITEMS.length)]; items[id] = 1 + (id === "herb" ? Math.floor(rand() * 3) : 0); }
  if (rand() < 0.3) mats[`${LOOT_CATS[Math.floor(rand() * LOOT_CATS.length)]}_1`] = 1;
  return { gold, items, mats };
}

// ---- セーブの検査：開けた宝箱・いる場所 ---------------------------------------------------------------
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export function cleanDgState(v) {
  const o = {};
  if (!isObj(v)) return o;
  for (const k of Object.keys(v).slice(-30)) {
    if (!/^-?\d{1,10}:\d{1,2}$/.test(k) || !isObj(v[k])) continue;
    o[k] = { opened: Array.isArray(v[k].opened) ? v[k].opened.filter((x) => typeof x === "string" && /^\d{1,2}:\d{1,2}$/.test(x)).slice(0, 40) : [] };
  }
  return o;
}
export function cleanLoc(v) {
  if (!isObj(v) || v.kind !== "dungeon") return null;
  const int = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!int(v.ruin, 0, 9) || !int(v.floor, 1, 5) || !int(v.x, 0, 63) || !int(v.y, 0, 63)) return null;
  return { kind: "dungeon", ruin: v.ruin, floor: v.floor, x: v.x, y: v.y };
}
