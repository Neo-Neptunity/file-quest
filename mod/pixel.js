// ファイル・クエスト — ドット絵づくりの共通部品（色の番号・乱数・格子の道具）
export const C = { E: 0, BODY: 1, DARK: 2, LIGHT: 3, ACC: 4, EYEW: 5, PUPIL: 6, OUT: 7, MOUTH: 8, WHITE: 9, TONGUE: 10, ACCD: 11 };

export function hashStr(str) {                     // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n×n の格子と、描くための道具（左右対称に置く setM など）
export function makeGrid(n, r) {
  const g = Array.from({ length: n }, () => new Array(n).fill(C.E));
  const inb = (x, y) => x >= 0 && x < n && y >= 0 && y < n;
  const set = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (inb(x, y)) g[y][x] = c; };
  const setM = (x, y, c) => { set(x, y, c); set(n - 1 - Math.round(x), y, c); };
  const get = (x, y) => { x = Math.round(x); y = Math.round(y); return inb(x, y) ? g[y][x] : C.E; };
  const rf = (a, b) => a + r() * (b - a);
  const ri = (a, b) => Math.floor(rf(a, b + 1));
  const topAt = (x) => { for (let y = 0; y < n; y++) if (g[y][x]) return y; return Math.floor(n / 2); };
  const botAt = (x) => { for (let y = n - 1; y >= 0; y--) if (g[y][x]) return y; return Math.floor(n / 2); };
  const leftAt = (y) => { for (let x = 0; x < n; x++) if (g[y][x]) return x; return Math.floor(n / 2) - 4; };
  // 楕円（左右対称）。taper > 0 で下が太く、< 0 で上が太い。ふちを少しガタつかせる
  const ellipse = (cy, rx, ry, taper = 0, noise = 0.3, code = C.BODY) => {
    for (let y = 0; y < n; y++) {
      const t = (y - cy) / ry;
      if (Math.abs(t) > 1.2) continue;
      const rxy = rx * (1 + taper * t);
      for (let x = 0; x < n / 2; x++) {
        const d = n / 2 - 0.5 - x;
        if ((d / rxy) ** 2 + t * t <= 1 + (r() - 0.5) * noise) setM(x, y, code);
      }
    }
  };
  const rect = (x0, y0, x1, y1, code) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, code); };
  return { n, g, inb, set, setM, get, rf, ri, topAt, botAt, leftAt, ellipse, rect, r };
}

// 仕上げ：ぼうれいの下のふち・質感・陰影・ふちどり
export function finish(h, { texture = "none", ghost = false } = {}) {
  const { n, g, get, set, r } = h;
  if (ghost) {
    for (let x = 0; x < n; x++) { let b = n - 1; while (b > 0 && !g[b][x]) b--; if (g[b][x] && x % 4 < 2) g[b][x] = C.E; if (g[b - 1] && g[b - 1][x] && x % 4 === 0) g[b - 1][x] = C.E; }
  }
  if (texture === "scales") { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x] === C.BODY && y % 2 === 0 && (x + (y % 4)) % 4 === 0 && r() < 0.85) g[y][x] = C.DARK; }
  else if (texture === "speckle") { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x] === C.BODY && r() < 0.07) g[y][x] = C.DARK; }
  else if (texture === "feather") { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x] === C.BODY && y % 3 === 0 && x % 2 === 0) g[y][x] = C.LIGHT; }
  else if (texture === "plate") { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x] === C.BODY && (x % 8 === 0 || y % 8 === 0)) g[y][x] = C.DARK; }
  // 陰影：左と上のふちは明るく、右と下のふちは暗く（太く）
  const shade = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (g[y][x] !== C.BODY) continue;
    if (!get(x, y - 1) || !get(x - 1, y)) shade.push([x, y, C.LIGHT]);
    else if (!get(x, y + 1) || !get(x + 1, y) || (!get(x, y + 2) && r() < 0.5)) shade.push([x, y, C.DARK]);
  }
  for (const [x, y, c] of shade) g[y][x] = c;
  const edge = [];
  for (let y = -1; y <= n; y++) for (let x = -1; x <= n; x++) {
    if (!h.inb(x, y) || get(x, y)) continue;
    if (get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1)) edge.push([x, y]);
  }
  for (const [x, y] of edge) set(x, y, C.OUT);
}
