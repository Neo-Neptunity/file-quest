// ファイル・クエスト — 仮想の世界地図（シードから毎回同じ地図ができる）。町の数・ダンジョンの数・名前は、渡せる（部ごとの島。10章）
import { TOWN_NAMES, RUIN_NAMES } from "./data.js";

export const T = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, HILL: 4, MOUNTAIN: 5, TOWN: 6, RUIN: 7 };
export const MAP_W = 72, MAP_H = 54;
export const WALKABLE = (t) => t !== T.WATER && t !== T.MOUNTAIN;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed) {
  const h = (ix, iy) => {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => (at(x, y) + at(x * 2, y * 2) * 0.5 + at(x * 4, y * 4) * 0.25) / 1.75;
}

function build(seed, opt) {
  const W = MAP_W, H = MAP_H;
  const elev = valueNoise(seed), moist = valueNoise(seed ^ 0x9e3779b9), ridge = valueNoise(seed ^ 0x51ed270b);
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / W) * 2 - 1, ny = (y / H) * 2 - 1, d = nx * nx + ny * ny;
      const e = elev(x / 12, y / 12) - d * 0.5 + 0.14;
      const m = moist(x / 8, y / 8);
      let t;
      if (e < 0.3) t = T.WATER;
      else if (e < 0.35) t = T.SAND;
      else if (ridge(x / 9, y / 9) > 0.7) t = T.MOUNTAIN;
      else if (e < 0.66) t = m > 0.56 ? T.FOREST : T.GRASS;
      else t = m < 0.5 ? T.HILL : T.FOREST;
      tiles[y * W + x] = t;
    }
  }
  // 中心にいちばん近い歩ける場所から、つながっている所だけを残す（島に取り残されないように）
  const idx = (x, y) => y * W + x;
  let start = null, best = Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = tiles[idx(x, y)];
    if ((t === T.GRASS || t === T.SAND) && Math.hypot(x - W / 2, y - H / 2) < best) { best = Math.hypot(x - W / 2, y - H / 2); start = { x, y }; }
  }
  if (!start) return null;
  const seen = new Uint8Array(W * H), stack = [start];
  seen[idx(start.x, start.y)] = 1;
  let count = 0;
  while (stack.length) {
    const p = stack.pop();
    count++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[idx(nx, ny)] || !WALKABLE(tiles[idx(nx, ny)])) continue;
      seen[idx(nx, ny)] = 1;
      stack.push({ x: nx, y: ny });
    }
  }
  if (count < 700) return null;
  for (let i = 0; i < tiles.length; i++) if (!seen[i] && WALKABLE(tiles[i])) tiles[i] = T.WATER;

  const rand = rng(seed ^ 0xabcdef);
  const cands = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const t = tiles[idx(x, y)];
    if (seen[idx(x, y)] && (t === T.GRASS || t === T.SAND || t === T.FOREST)) cands.push({ x, y });
  }
  const far = (p, list, min) => list.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= min);
  // 数が多いほど、間をつめる（島の広さは、同じ）
  const townGap = opt.towns <= 3 ? 18 : opt.towns <= 5 ? 14 : 11, ruinGap = opt.ruins <= 5 ? 9 : 7, ruinFromTown = opt.towns <= 5 ? 8 : 6, startGap = opt.towns <= 3 && opt.ruins <= 5 ? 12 : 10;
  const townName = (i) => (opt.townNames && opt.townNames[i]) || TOWN_NAMES[i] || `町${i + 1}`;
  const ruinName = (i) => (opt.ruinNames && opt.ruinNames[i]) || RUIN_NAMES[i] || `遺跡${i + 1}`;
  const towns = [{ x: start.x, y: start.y, name: townName(0) }];
  for (let tries = 0; tries < 6000 && towns.length < opt.towns; tries++) {
    const p = cands[Math.floor(rand() * cands.length)];
    if (far(p, towns, townGap)) towns.push({ ...p, name: townName(towns.length) });
  }
  const ruins = [];
  for (let tries = 0; tries < 8000 && ruins.length < opt.ruins; tries++) {
    const p = cands[Math.floor(rand() * cands.length)];
    if (far(p, towns, ruinFromTown) && far(p, ruins, ruinGap) && Math.hypot(p.x - start.x, p.y - start.y) > startGap) ruins.push({ ...p, name: ruinName(ruins.length) });
  }
  for (const t of towns) tiles[idx(t.x, t.y)] = T.TOWN;
  for (const r of ruins) tiles[idx(r.x, r.y)] = T.RUIN;
  return { w: W, h: H, tiles, towns, ruins, start };
}

// 町の数 towns（1〜7）・ダンジョンの入口の数 ruins（0〜7）・名前の表 townNames / ruinNames を渡せる。数がそろう島ができるまで、シードをずらして作りなおす
export function generateWorld(seed, { towns = 3, ruins = 5, townNames = null, ruinNames = null } = {}) {
  const opt = { towns: Math.max(1, Math.min(7, towns | 0)), ruins: Math.max(0, Math.min(7, ruins | 0)), townNames, ruinNames };
  let best = null;
  for (let i = 0; i < 40; i++) {
    const w = build((seed + i * 7919) | 0, opt);
    if (!w) continue;
    if (opt.towns === 3 && opt.ruins === 5) { if (w.towns.length >= 2 && w.ruins.length >= 3) return w; continue; }
    if (w.towns.length === opt.towns && w.ruins.length === opt.ruins) return w;
    if (!best || w.towns.length + w.ruins.length > best.towns.length + best.ruins.length) best = w;
  }
  if (best && opt.towns !== 3) return best;
  throw new Error("world generation failed");
}
