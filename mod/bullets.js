// ファイル・クエスト — 敵のこうげきの 弾よけ（画面を持たない）
// 敵がこうげきするとき、小さな枠の中で、ハート（勇者）を動かして、飛んでくる弾をよける。
// 弾の出かたは、敵の種類ごとに決まっていて（雨・横ぎり・ねらいうち・輪・うずまき）、強い技や ボスほど 速く・多い。
// 1発当たるたびに、ふだんのダメージの半分（全部かわせば 0。いくつ当たっても 1.5倍まで）。当たったあとは、少しのあいだ 当たらない。
// 同じ種（seed）なら、同じ弾の出かた。よけられない弾の出かたに ならないよう、自動でよける人（autoDodge）で 試験している
import { rng } from "./pixel.js";

export const ARENA = { w: 260, h: 200 };
export const HEART = { r: 5, speed: 150 };
export const INVINCIBLE = 0.7;               // 当たったあとの 当たらない時間（秒）
export const HIT_SHARE = 0.5;                // 1発のダメージ（ふだんのダメージに対する割合）
export const DAMAGE_CAP = 1.5;               // 1回で受ける ダメージの 上限（ふだんのダメージに対する割合）
export const PATTERN_IDS = ["rain", "sweep", "aim", "ring", "spiral"];

// 種類ごとの 弾の出かた（先頭が いつもの。強い技・ボスは、あとのものも 重ねる）
const BY_CAT = { image: ["ring", "aim"], video: ["rain", "sweep"], audio: ["spiral", "rain"], archive: ["aim", "sweep"], exe: ["sweep", "ring"], other: ["rain", "aim"], doc: ["rain", "ring"] };

// ふだんのダメージ full に対して、当たった数 hits のとき 受けるダメージ（1発ずつ受けて、上限まで）
export const perHit = (full) => Math.max(1, Math.round(full * HIT_SHARE));
export const damageFor = (full, hits) => Math.min(Math.round(full * DAMAGE_CAP), perHit(full) * Math.max(0, hits));

// 弾よけを はじめる。intensity：技の強さ（ふつう 1・強い技 1.7・ボスの強打 2.4）。duration：秒（省くと、強さから）
export function newDodge({ seed = 1, cat = "other", boss = false, intensity = 1, duration = null } = {}) {
  const r = rng(seed >>> 0);
  const I = Math.max(0.8, Math.min(2.4, intensity));
  const ids = BY_CAT[cat] ? BY_CAT[cat].slice() : [PATTERN_IDS[Math.floor(r() * PATTERN_IDS.length)], PATTERN_IDS[Math.floor(r() * PATTERN_IDS.length)]];     // コード：そのつど ちがう
  const use = boss || I >= 1.5 ? ids : ids.slice(0, 1);
  const dur = duration ?? Math.min(5.5, 3.2 + 0.5 * I + (boss ? 0.6 : 0));
  return {
    t: 0, dur, I, boss, r,
    hx: ARENA.w / 2, hy: ARENA.h * 0.75, bullets: [], hits: 0, inv: 0, done: false,
    sp: 0.9 + 0.15 * I, dens: 0.8 + 0.3 * I,
    patterns: use.map((id, k) => ({ id, next: 0.35 + k * 0.45, n: 0, gap: ARENA.w / 2, ang: r() * 6.28 })),
  };
}

const push = (sim, x, y, vx, vy, rad = 5.5) => sim.bullets.push({ x, y, vx, vy, r: rad });
const EMIT = {
  // 雨：上から、ばらばらに 落ちてくる
  rain(sim, p) {
    const n = sim.I >= 1.7 ? 2 : 1;
    for (let k = 0; k < n; k++) push(sim, 8 + sim.r() * (ARENA.w - 16), -6, (sim.r() - 0.5) * 30, 115 * sim.sp);
    return 0.115 / sim.dens;
  },
  // 横ぎり：すきまの ある 横の列が、上から 降りてくる。すきまは、前から そう遠くない所に あく（まにあう）
  sweep(sim, p) {
    p.gap = Math.max(46, Math.min(ARENA.w - 46, p.gap + (sim.r() - 0.5) * 140));
    for (let x = 9; x < ARENA.w; x += 20) if (Math.abs(x - p.gap) >= 31) push(sim, x, -6, 0, 100 * sim.sp);
    return 0.95 / sim.dens;
  },
  // ねらいうち：ふちから、いまの ハートの 位置をねらって 飛んでくる
  aim(sim, p) {
    const side = Math.floor(sim.r() * 3);
    const x = side === 0 ? sim.r() * ARENA.w : side === 1 ? -6 : ARENA.w + 6, y = side === 0 ? -6 : sim.r() * ARENA.h * 0.5;
    const a = Math.atan2(sim.hy - y, sim.hx - x), sp = 125 * sim.sp;
    const fan = sim.I >= 1.7 ? [-0.32, 0, 0.32] : [0];
    for (const d of fan) push(sim, x, y, Math.cos(a + d) * sp, Math.sin(a + d) * sp);
    return 0.46 / sim.dens;
  },
  // 輪：上の ほうで はじけて、広がる
  ring(sim, p) {
    const cx = 50 + sim.r() * (ARENA.w - 100), cy = 18 + sim.r() * ARENA.h * 0.28, n = 11 + Math.floor(sim.I * 2), off = sim.r() * 6.28, sp = 82 * sim.sp;
    for (let k = 0; k < n; k++) { const a = off + (k * 6.2832) / n; push(sim, cx, cy, Math.cos(a) * sp, Math.sin(a) * sp); }
    return 1.05 / sim.dens;
  },
  // うずまき：まんなか上から、角度を ずらしながら ぐるぐると
  spiral(sim, p) {
    p.ang += 0.72;
    const sp = 82 * sim.sp;
    push(sim, ARENA.w / 2, 26, Math.cos(p.ang) * sp, Math.sin(p.ang) * sp, 4);
    return 0.075 / sim.dens;
  },
};

// ハート・弾を dt 秒すすめる。dir：{ x, y }（-1〜1）。このあいだに 当たった数を返す。細かく刻んで 動かすので、弾を すり抜けない
export function stepDodge(sim, dt, dir = { x: 0, y: 0 }) {
  let gotHit = 0;
  while (dt > 1e-9 && !sim.done) {
    const h = Math.min(dt, 1 / 60);
    dt -= h;
    let dx = Math.sign(dir.x || 0), dy = Math.sign(dir.y || 0);
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    sim.hx = Math.max(HEART.r, Math.min(ARENA.w - HEART.r, sim.hx + dx * HEART.speed * h));
    sim.hy = Math.max(HEART.r, Math.min(ARENA.h - HEART.r, sim.hy + dy * HEART.speed * h));
    if (sim.t < sim.dur - 0.5) for (const p of sim.patterns) while (sim.t >= p.next) { p.next += EMIT[p.id](sim, p); p.n++; }     // おわりぎわは、新しい弾を 出さない
    for (const b of sim.bullets) { b.x += b.vx * h; b.y += b.vy * h; }
    sim.bullets = sim.bullets.filter((b) => b.x > -24 && b.x < ARENA.w + 24 && b.y > -24 && b.y < ARENA.h + 24);
    sim.inv = Math.max(0, sim.inv - h);
    if (sim.inv <= 0) {
      for (const b of sim.bullets) {
        if (Math.hypot(b.x - sim.hx, b.y - sim.hy) < b.r + HEART.r - 2) { sim.hits++; gotHit++; sim.inv = INVINCIBLE; break; }
      }
    }
    sim.t += h;
    if (sim.t >= sim.dur) sim.done = true;
  }
  return gotHit;
}

// 自動でよける人（試験と、ボットが使う）：9方向（止まる・8方向）のうち、すこし先まで見て、弾からいちばん遠くなる方向を選ぶ
export function autoDodge(sim) {
  const DIRS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let best = DIRS[0], bestScore = -Infinity;
  for (const [dx, dy] of DIRS) {
    const n = Math.hypot(dx, dy) || 1;
    let score = Infinity;
    for (let k = 1; k <= 8; k++) {
      const tt = k * 0.05;
      const hx = Math.max(HEART.r, Math.min(ARENA.w - HEART.r, sim.hx + (dx / n) * HEART.speed * tt)), hy = Math.max(HEART.r, Math.min(ARENA.h - HEART.r, sim.hy + (dy / n) * HEART.speed * tt));
      for (const b of sim.bullets) score = Math.min(score, Math.hypot(b.x + b.vx * tt - hx, b.y + b.vy * tt - hy) - b.r);
    }
    score = Math.min(score, 60) - (dx || dy ? 0.6 : 0) - Math.abs(sim.hx + dx * 8 - ARENA.w / 2) * 0.004 - Math.abs(sim.hy + dy * 8 - ARENA.h * 0.72) * 0.004;       // 近いところでは 動かない・まんなかへ 少し
    if (score > bestScore) { bestScore = score; best = [dx, dy]; }
  }
  return { x: best[0], y: best[1] };
}
