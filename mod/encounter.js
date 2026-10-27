// ファイル・クエスト — 敵の数の決め方と、群れの作り方（画面を持たない）
import { clamp } from "./data.js";

export const MAX_ENEMIES = 5;
export const keyOf = (e) => e.id || String(e.path).toLowerCase();
export const dirOf = (p) => { const i = String(p).lastIndexOf("\\"); return i <= 2 ? String(p).slice(0, i + 1) : String(p).slice(0, i); };

// パーティの人数ごとの、敵の数の出方（%）。上限は「人数＋1」。人数より2体以上多いと、ほぼ全滅するので出さない
export const COUNT_TABLE = {
  1: [[1, 90], [2, 10]],
  2: [[1, 20], [2, 55], [3, 25]],
  3: [[2, 25], [3, 50], [4, 25]],
  4: [[2, 15], [3, 30], [4, 40], [5, 15]],
};
export function rollCount(partySize, heroLv, rand = Math.random) {
  const P = clamp(Math.round(partySize), 1, 4), table = COUNT_TABLE[P];
  let r = rand() * 100, n = table[table.length - 1][0];
  for (const [count, w] of table) { if ((r -= w) < 0) { n = count; break; } }
  if (P === 1 && heroLv < 5) n = 1;                         // ひとりで挑む序盤は、必ず1体
  return n;
}

// 敵のレベルの上限：パーティの平均レベル＋1。数が人数より多いときは、1下げる。ボスは＋2（ボスの部屋）
export function levelCap(avgLv, count, partySize, boss = false) {
  return Math.max(1, Math.round(avgLv) + 1 + (boss ? 2 : 0) - (!boss && count > partySize ? 1 : 0));
}

// 敵のレベル（部のないとき）：ファイルの大きさ由来のレベル（大きいほど強い。最大20）と、パーティの平均レベルに合わせた上限の、小さいほう。
// 勇者が育って、ファイルの大きさ由来のレベルをこえたら、そのファイルは弱くなる（敵のレベルは、勇者に ついてこない）
export function enemyLevel(sizeLv, avgLv, count, partySize, boss = false) {
  return Math.max(1, Math.min(sizeLv + (boss ? 2 : 0), levelCap(avgLv, count, partySize, boss)));
}

// 部の中の敵のレベル：章ごとに決まった範囲 chapter.lv = [低, 高]（その章の中で、小さいファイルほど低く、大きいファイルほど高い）。
// 勇者のレベルでは変わらない：育てば、前の章の敵は 弱くなり、ひとふりで倒せる。
// 勇者が 遅れているときだけ、上限（平均+3。ボスは +4）で、手に負えなくならないようにする
export const PART_CAP = { normal: 3, boss: 4 };
export function partEnemyLevel(chapter, size, avgLv, { boss = false, nushi = false } = {}) {
  const [lo, hi] = chapter.lv, min = chapter.minSize || 1, max = chapter.maxSize || size || 1;
  const t = max > min ? clamp((Math.log((size || 1) + 1) - Math.log(min + 1)) / (Math.log(max + 1) - Math.log(min + 1)), 0, 1) : 1;
  const base = Math.round(lo + (hi - lo) * t) + (boss ? (nushi ? 3 : 2) : 0);
  return Math.max(1, Math.min(base, Math.round(avgLv) + (boss ? PART_CAP.boss : PART_CAP.normal)));
}

// 群れの仲間：リーダーと同じフォルダのファイルから、大きさの近い順に。足りなければ、近い大きさのファイルから
export function pickFollowers(pool, leader, count, { maxSize = Infinity, rand = Math.random } = {}) {
  if (count <= 0) return [];
  const lk = keyOf(leader), dir = dirOf(leader.path);
  const near = (a) => Math.abs(Math.log((a.size + 1) / (leader.size + 1)));
  const others = pool.filter((e) => keyOf(e) !== lk && e.size < maxSize);
  const picked = others.filter((e) => dirOf(e.path) === dir).sort((a, b) => near(a) - near(b)).slice(0, count);
  if (picked.length < count) {
    const rest = others.filter((e) => !picked.includes(e)).sort((a, b) => near(a) - near(b)).slice(0, Math.max(6, (count - picked.length) * 3));
    while (picked.length < count && rest.length) picked.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  }
  return picked;
}

export const bossMinions = (partySize, rand = Math.random) => (partySize >= 3 ? 1 + (rand() < 0.5 ? 1 : 0) : 0);

// 仲間が増えると、回復役やとくぎで 計算より強くなるので、敵の能力を 少し上げて 1戦の手ごたえを保つ（ソロは そのまま）
// 計算（../dev/balance.mjs）で、パーティ3〜4人の1戦が 6〜7ターン・勝率98%以上・減るHP 2〜3割になるように決めた
export const SCALE_HP = 0.25, SCALE_ATK = 0.1;
export const partyScale = (partySize) => ({ hp: 1 + SCALE_HP * (clamp(partySize, 1, 4) - 1), atk: 1 + SCALE_ATK * (clamp(partySize, 1, 4) - 1) });

// ボス戦は、章を進める関門。ひとりだと 勝てないので、ひとりのときだけ ボスを やわらげる（2人以上は そのまま。../dev/balance.mjs のボス戦で確かめた）
export const BOSS_SOLO = { hp: 0.62, atk: 0.9 };
export const bossEase = (partySize) => (partySize <= 1 ? BOSS_SOLO : { hp: 1, atk: 1 });

// 敵ひとりの能力と報酬
export function enemyStats(lv, { boss = false, cat = "other" } = {}, rand = Math.random) {
  return {
    maxHp: Math.round((18 + lv * 14) * (boss ? 3 : 1)),
    atk: (5 + lv * 2.1) * (boss ? 1.25 : 1),
    def: (1 + lv * 0.8) * (cat === "archive" ? 1.5 : 1),
    spd: 6 + lv * 1.1 + rand() * 3,
  };
}
export const enemyExp = (lv, boss, ghost) => Math.round((10 + lv * 9) * (boss ? 3 : 1) * (ghost ? 1.5 : 1));
export const enemyGold = (lv, boss, rand = Math.random) => Math.round((5 + lv * 6) * (boss ? 3 : 1) * (0.8 + rand() * 0.4));

// 画面での大きさ（px）。16マスの絵は16の倍数、ボスの32マスの絵は32の倍数にして、にじませない
export const SPRITE_SIZE = { 1: 224, 2: 176, 3: 144, 4: 112, 5: 96 };
export function spriteSize(count, boss) {
  if (boss) return count === 1 ? 256 : 192;
  return SPRITE_SIZE[clamp(count, 1, 5)];
}
