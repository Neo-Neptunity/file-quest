// ファイル・クエスト — 依頼の生成・検査・進み具合（画面を持たない）。達成の判定と報酬は、ゲームが計算する（AI は題と文章だけ）
import { SPECIES, BOSS_BYTES, catOf, clamp, fmtSize, DAY } from "./data.js";
import { touched } from "./idle.js";

export const QUEST_TYPES = ["cat", "bytes", "boss", "ghost", "any"];
const MB = 1024 * 1024;

// 敵の候補（pool.list）の集計。達成できない依頼を避けるために使う
export function poolStats(list, staleDays, now = Date.now()) {
  const counts = {};
  let total = 0, bossCount = 0, ghostCount = 0;
  for (const e of list) {
    const c = catOf(e.ext);
    counts[c] = (counts[c] || 0) + 1;
    total += e.size;
    if (e.size >= BOSS_BYTES) bossCount++;
    if (now - touched(e) > staleDays * 2 * DAY) ghostCount++;
  }
  return { counts, total, bossCount, ghostCount };
}

export function rewardFor(type, need) {
  if (type === "cat") return { gold: 30 + need * 14, exp: 25 + need * 18 };
  if (type === "bytes") return { gold: 40 + Math.min(400, Math.round((need / MB) * 1.5)), exp: 60 };
  if (type === "boss") return { gold: 150 * need, exp: 150 * need };
  if (type === "ghost") return { gold: 30 * need, exp: 30 * need };
  return { gold: Math.round(need * 9), exp: Math.round(need * 7.5) };
}
export function titleFor(type, need, cat) {
  if (type === "cat") return `${SPECIES[cat].name}を ${need}体 たおせ`;
  if (type === "bytes") return `ごみを 合計${fmtSize(need)} ぶん たおせ`;
  if (type === "boss") return need === 1 ? "20MB以上の大物を 1体 たおせ" : `20MB以上の大物を ${need}体 たおせ`;
  if (type === "ghost") return `ぼうれいを ${need}体 たおせ`;
  return `あいては 誰でもいい。${need}回 かて`;
}

// 達成できる数の上限（実際にいる敵の、2/3まで）と、下限
export function maxNeed(type, cat, stats) {
  if (type === "cat") return Math.floor(((stats.counts[cat] || 0) * 2) / 3);
  if (type === "bytes") return Math.floor((stats.total * 0.4) / MB) * MB;
  if (type === "boss") return stats.bossCount >= 1 ? Math.max(1, Math.floor((stats.bossCount * 2) / 3)) : 0;
  if (type === "ghost") return Math.floor((stats.ghostCount * 2) / 3);
  return 12;
}
export const minNeed = (type) => (type === "bytes" ? 5 * MB : type === "any" ? 5 : type === "boss" ? 1 : 2);

const keyOfOffer = (q) => q.type + (q.cat || "");
const build = (type, need, cat, i, story = "") => ({
  id: Date.now() + i, type, cat: type === "cat" ? cat : undefined, need, title: titleFor(type, need, cat), story, ...rewardFor(type, need), have: 0,
});

// 手元の依頼（AI が無いとき・AI の返事が使えなかったとき）
export function localOffers(stats, active = [], rand = Math.random) {
  const c = [];
  for (const [cat, n] of Object.entries(stats.counts)) if (n >= 3) c.push(["cat", Math.min(maxNeed("cat", cat, stats), 3 + Math.floor(rand() * 4)), cat]);
  const bytes = clamp(Math.round((stats.total * 0.15) / MB) * MB, 5 * MB, 2048 * MB);
  if (stats.total >= 8 * MB) c.push(["bytes", bytes, null]);
  if (stats.bossCount >= 1) c.push(["boss", 1, null]);
  c.push(["any", 8, null]);
  if (stats.ghostCount >= 3) c.push(["ghost", 3, null]);
  c.sort(() => rand() - 0.5);
  const act = active.map(keyOfOffer);
  return c.filter(([type, , cat]) => !act.includes(type + (cat || ""))).slice(0, 3).map(([type, need, cat], i) => build(type, need, cat, i));
}

// AI の依頼を検査する。型・種類・数が合わないものは捨てる。題と文章だけを AI から受け取り、報酬は計算する
export function validateAiQuests(rows, stats, active = []) {
  if (!Array.isArray(rows)) return [];
  const act = new Set(active.map(keyOfOffer)), seen = new Set(), out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object" || !QUEST_TYPES.includes(r.type)) continue;
    const cat = r.type === "cat" ? String(r.cat) : null;
    if (r.type === "cat" && !SPECIES[cat]) continue;
    const need = Math.round(Number(r.need));
    if (!Number.isFinite(need)) continue;
    const lo = minNeed(r.type), hi = maxNeed(r.type, cat, stats);
    if (hi < lo) continue;                                  // その依頼を 達成できるだけの 敵が いない
    const key = r.type + (cat || "");
    if (act.has(key) || seen.has(key)) continue;
    seen.add(key);
    const q = build(r.type, clamp(need, lo, hi), cat, out.length, String(r.story ?? "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 40));
    const title = String(r.title ?? "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 24);
    if (title) q.title = title;
    out.push(q);
    if (out.length >= 3) break;
  }
  return out;
}

// 敵を1体倒したときの進み。f：{cat, size, ghost, boss}
export function progressAdd(q, f) {
  if (q.type === "cat") return q.cat === f.cat ? 1 : 0;
  if (q.type === "bytes") return f.size;
  if (q.type === "boss") return f.boss || f.size >= BOSS_BYTES ? 1 : 0;
  if (q.type === "ghost") return f.ghost ? 1 : 0;
  return 1;
}
export const progressText = (q) => (q.type === "bytes" ? `${fmtSize(q.have)} / ${fmtSize(q.need)}` : `${q.have} / ${q.need}`);
