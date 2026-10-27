// ファイル・クエスト — 仲間（役割・能力・とくぎ・おまかせの行動）。画面を持たない
import { SKILL_DEFS } from "./data.js";

export const MAX_PARTY = 4;                    // ヒーロー＋同行3人
export const ROLES = {
  front: { name: "前衛", emoji: "🛡️", hp: 1.25, atk: 1.0, def: 1.3, spd: 0.9, mp: 0.5, crit: 0, weight: 2 },
  healer: { name: "回復役", emoji: "🌿", hp: 0.9, atk: 0.7, def: 0.9, spd: 1.0, mp: 1.3, crit: 0, weight: 1 },
  appraiser: { name: "鑑定士", emoji: "🔮", hp: 0.8, atk: 0.8, def: 0.8, spd: 1.0, mp: 1.4, crit: 0, weight: 1 },
  thief: { name: "盗賊", emoji: "🗡️", hp: 0.95, atk: 0.95, def: 0.85, spd: 1.3, mp: 0.7, crit: 0.1, weight: 1 },
};
export const ROLE_IDS = Object.keys(ROLES);

// 能力は、役割とレベルから計算する（カードの数値は使わない）
export function memberStats(role, lv) {
  const r = ROLES[role] || ROLES.front;
  return {
    maxHp: Math.round((44 + 13 * lv) * r.hp), maxMp: Math.round((10 + 4 * lv) * r.mp),
    atk: (11 + 3.3 * lv) * r.atk, def: (4.5 + 1.6 * lv) * r.def, spd: (8 + 1.2 * lv) * r.spd, crit: r.crit,
  };
}

// 絆（いっしょに勝った回数）の段階 0〜3 で、とくぎが増える
export const BOND_STEPS = [0, 5, 15, 30];
export const stageOf = (bond) => BOND_STEPS.filter((t) => (bond || 0) >= t).length - 1;
const BASE = { front: [], healer: ["heal"], appraiser: ["bolt"], thief: [] };
const UNLOCK = { front: ["power", "sweep", "guardAll"], healer: ["healAll", "revive", "mega"], appraiser: ["seal", "bolt2", "boltAll"], thief: ["double", "steal", "vital"] };
export const skillsFor = (role, stage) => [...(BASE[role] || []), ...(UNLOCK[role] || []).slice(0, Math.max(0, Math.min(3, stage)))];

// 同行する仲間のレベル。NPC：ヒーロー−1。本物のカード：カードのレベルと、ヒーロー＋2の低いほう
export function companionLv(friend, heroLv) {
  if (friend.kind === "card") return Math.max(1, Math.min(friend.lv0 || 1, heroLv + 2));
  return Math.max(1, heroLv - 1);
}
// カードの絆の段階は、レベルで底上げする（遊んでいなくても、強い人は技を知っている）
export function friendStage(friend, lv) {
  const s = stageOf(friend.bond);
  return friend.kind === "card" ? Math.max(s, Math.min(3, Math.floor(lv / 6))) : s;
}

// 「おまかせ」の行動を決める。unit：{role, hp, maxHp, mp, skills, mpCut}、allies：味方ぜんいん（倒れた人を含む）、enemies：生きている敵
export function autoAction(unit, allies, enemies, rand = Math.random) {
  const cost = (id) => Math.max(1, SKILL_DEFS[id].mp - (unit.mpCut || 0));
  const can = (id) => unit.skills.includes(id) && unit.mp >= cost(id);
  const alive = allies.filter((a) => a.hp > 0);
  const weakest = [...alive].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (unit.role === "healer") {
    const down = allies.filter((a) => a.hp <= 0);
    if (can("revive") && down.length) return { type: "skill", skill: "revive", target: down[0] };
    const hurt = alive.filter((a) => a.hp < a.maxHp * 0.6);
    if (can("healAll") && hurt.length >= 2) return { type: "skill", skill: "healAll" };
    if (weakest && weakest.hp < weakest.maxHp * 0.45) {
      if (can("mega") && weakest.hp < weakest.maxHp * 0.3) return { type: "skill", skill: "mega", target: weakest };
      if (can("heal")) return { type: "skill", skill: "heal", target: weakest };
    }
  }
  const target = pickEnemy(enemies, rand);
  if (unit.role === "front" && can("guardAll") && alive.some((a) => a.hp < a.maxHp * 0.5) && rand() < 0.4) return { type: "skill", skill: "guardAll" };
  const offense = unit.skills.filter((id) => ["dmg", "dmgAll", "seal"].includes(SKILL_DEFS[id].kind) && can(id));
  if (offense.length && rand() < 0.45) {
    const id = offense[Math.floor(rand() * offense.length)];
    if (SKILL_DEFS[id].kind === "dmgAll" && enemies.length < 2) return { type: "attack", target };
    return { type: "skill", skill: id, target };
  }
  return { type: "attack", target };
}
// 敵を狙う：よわった敵を6割、それ以外は無作為
export function pickEnemy(enemies, rand = Math.random) {
  if (!enemies.length) return null;
  if (rand() < 0.6) return [...enemies].sort((a, b) => a.hp - b.hp)[0];
  return enemies[Math.floor(rand() * enemies.length)];
}
// 敵が味方を狙う：前衛は当たりやすい（重み2）
export function pickAlly(allies, rand = Math.random) {
  const alive = allies.filter((a) => a.hp > 0);
  if (!alive.length) return null;
  const w = (a) => (ROLES[a.role] ? ROLES[a.role].weight : 1);
  let r = rand() * alive.reduce((t, a) => t + w(a), 0);
  for (const a of alive) { if ((r -= w(a)) < 0) return a; }
  return alive[alive.length - 1];
}
