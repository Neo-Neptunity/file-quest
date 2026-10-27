// バランスの計算：人数ごとの敵の数の分布どおりに引いて、1戦の強さ（勝率・減るHP・倒れる味方・ターン数）を見る。
//   使い方：node file-quest/dev/balance.mjs [試行回数] [レベル（カンマ区切り。既定 3,8,15,30,50）]
//   実際の部品（encounter・party・data）を使う。状態異常と、とくぎの外れは 省いた簡易版
import { stage } from "./stage.mjs";

const st = stage("balance");
const en = await import(st.url("encounter.js"));
const pt = await import(st.url("party.js"));
const data = await import(st.url("data.js"));
const N_TRIALS = Number(process.argv[2] || 3000);
const LEVELS = (process.argv[3] || "3,8,15,30,50").split(",").map(Number);          // 見るレベル（第2引数。カンマ区切り）
const rnd = (a, b) => a + Math.random() * (b - a);
const ROLES4 = ["front", "healer", "appraiser", "thief"];

function makeAllies(P, L) {
  const hero = { role: "hero", lv: L, maxHp: 44 + 13 * L, maxMp: 10 + 4 * L, atk: 11 + 3.3 * L, def: 4.5 + 1.6 * L, spd: 8 + 1.2 * L, crit: 0.06, mpCut: 0, skills: data.HERO_SKILLS.filter((k) => L >= k.lv).map((k) => k.id) };
  const list = [hero];
  for (let i = 1; i < P; i++) {
    const role = ROLES4[(i - 1) % 4], lv = Math.max(1, L - 1), s = pt.memberStats(role, lv);
    list.push({ role, lv, ...s, mpCut: 0, skills: pt.skillsFor(role, Math.min(3, Math.floor(L / 6))) });
  }
  for (const a of list) { a.hp = a.maxHp; a.mp = a.maxMp; }
  return list;
}

function fight(P, L, N, rand = Math.random, boss = false, delta = null) {
  const allies = makeAllies(P, L);
  const avg = allies.reduce((t, a) => t + a.lv, 0) / P;
  const foes = Array.from({ length: N }, (_, idx) => {
    const isBoss = boss && idx === 0;                                        // ボス戦：先頭がボス（ボスは 上限より、ふつう +2）
    const cap = en.levelCap(avg, N, P, isBoss);
    const lv = delta != null ? Math.max(1, Math.round(avg) + delta) : isBoss ? cap : Math.max(1, Math.min(cap, cap - (rand() < 0.35 ? 1 : 0)));        // 実際は、ファイルの大きさで 上限より低くなることもある
    const s = en.enemyStats(lv, { boss: isBoss }, rand);
    const k = en.partyScale ? en.partyScale(P) : { hp: 1, atk: 1 };          // 人数が増えたときの、敵の補正
    const ez = isBoss && en.bossEase ? en.bossEase(P) : { hp: 1, atk: 1 };              // ボスは、ひとりのときだけ やわらげる
    return { ...s, maxHp: s.maxHp * k.hp * ez.hp, hp: s.maxHp * k.hp * ez.hp, atk: s.atk * k.atk * ez.atk, lv, boss: isBoss };
  });
  let herbs = 5, rounds = 0;
  const alive = (l) => l.filter((x) => x.hp > 0);
  while (rounds < 80) {
    rounds++;
    const queue = [...alive(allies).map((a) => ({ a, ally: true, spd: a.spd + rnd(0, 6) })), ...alive(foes).map((f) => ({ a: f, ally: false, spd: f.spd + rnd(0, 6) }))].sort((x, y) => y.spd - x.spd);
    let guard = new Set();
    for (const q of queue) {
      if (q.a.hp <= 0) continue;
      if (!alive(foes).length) return finish(allies, true, rounds);
      if (allies[0].hp <= 0) return finish(allies, false, rounds);
      if (q.ally) {
        const u = q.a, es = alive(foes);
        let act;
        if (u.role === "hero") {
          const weak = allies.filter((a) => a.hp > 0).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (weak.hp < weak.maxHp * 0.4 && herbs > 0) act = { type: "herb", target: weak };
          else if (es.length >= 3 && u.skills.includes("sweep") && u.mp >= 5) act = { type: "skill", skill: "sweep" };
          else if (u.skills.includes("slash") && u.mp >= 4 && Math.random() < 0.3) act = { type: "skill", skill: "slash", target: pt.pickEnemy(es) };
          else act = { type: "attack", target: pt.pickEnemy(es) };
        } else act = pt.autoAction(u, allies, es);
        exec(u, act, allies, foes, es, () => herbs--, L);
      } else {
        const t = pt.pickAlly(allies);
        if (!t) return finish(allies, false, rounds);
        const mul = Math.random() < (q.a.boss ? 0.4 : 0.28) ? 1.4 : 1;          // ボスは、ためて 強打する
        t.hp -= Math.max(1, (q.a.atk * rnd(0.85, 1.15) - t.def * 0.5) * mul * (guard.has(t) ? 0.5 : 1));
      }
    }
  }
  return finish(allies, false, rounds);
}
function exec(u, act, allies, foes, es, useHerb, L) {
  const hit = (t, mul, pierce = false) => { if (t.hp > 0) t.hp -= Math.max(1, (u.atk * rnd(0.85, 1.15) - t.def * (pierce ? 0.25 : 0.5)) * mul * (Math.random() < u.crit ? 2 : 1)); };
  if (act.type === "herb") { act.target.hp = Math.min(act.target.maxHp, act.target.hp + 50 + 2 * L); useHerb(); return; }
  if (act.type === "attack") { hit(act.target || pt.pickEnemy(es), 1); return; }
  const d = data.SKILL_DEFS[act.skill];
  u.mp -= d.mp;
  if (d.kind === "dmg") { const t = act.target && act.target.hp > 0 ? act.target : pt.pickEnemy(es); for (let h = 0; h < (d.hits || 1); h++) if (t) hit(t, d.mul * (Math.random() < (d.acc ?? 1) ? 1 : 0), d.pierce); }
  else if (d.kind === "dmgAll") for (const t of es) hit(t, d.mul * (Math.random() < (d.acc ?? 1) ? 1 : 0), d.pierce);
  else if (d.kind === "heal1") { const t = act.target; t.hp = Math.min(t.maxHp, t.hp + d.base + d.perLv * u.lv + rnd(0, d.rand || 0)); }
  else if (d.kind === "healAll") for (const a of allies) if (a.hp > 0) a.hp = Math.min(a.maxHp, a.hp + d.base + d.perLv * u.lv);
  else if (d.kind === "revive") { const t = act.target; if (t && t.hp <= 0) t.hp = Math.max(1, t.maxHp * 0.5); }
  else if (d.kind === "seal") { /* 簡易版では 無視 */ }
}
function finish(allies, win, rounds) {
  const lost = allies.reduce((t, a) => t + (a.maxHp - Math.max(0, a.hp)) / a.maxHp, 0) / allies.length;
  return { win, rounds, lost, down: allies.filter((a) => a.hp <= 0).length / allies.length, heroDown: allies[0].hp <= 0 };
}

console.log(`試行 ${N_TRIALS}回ずつ。敵の数は、人数ごとの表のとおりに引く（ソロは、Lv5以上でまれに2体）`);
console.log("Lv  人数 | 勝率   平均で減るHP  倒れた味方  ターン | 敵の数が 人数と同じ／1多いときの減るHP");
let worst = 0;
for (const L of LEVELS) {
  for (const P of [1, 2, 3, 4]) {
    let win = 0, lost = 0, down = 0, rounds = 0;
    const bySame = [], byPlus = [];
    for (let i = 0; i < N_TRIALS; i++) {
      const N = en.rollCount(P, L);
      const r = fight(P, L, N);
      if (r.win) win++;
      lost += r.lost; down += r.down; rounds += r.rounds;
      (N > P ? byPlus : bySame).push(r.lost);
    }
    const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length * 100).toFixed(0) + "%" : "—");
    worst = Math.max(worst, 1 - win / N_TRIALS);
    console.log(`${String(L).padStart(2)}  ${P}人  | ${(win / N_TRIALS * 100).toFixed(1).padStart(5)}%  ${(lost / N_TRIALS * 100).toFixed(0).padStart(6)}%     ${(down / N_TRIALS * 100).toFixed(0).padStart(6)}%    ${(rounds / N_TRIALS).toFixed(1).padStart(5)} | ${avg(bySame)} / ${avg(byPlus)}`);
  }
}
console.log(`\n最も負けやすい条件の負け率：${(worst * 100).toFixed(1)}%`);

// ボス戦：ボス1体（HP3倍・こうげき1.25倍・レベルは平均+3まで）と、3人以上なら おとも1〜2体。章を進める関門なので、勝てなくなっていないかを見る
console.log("\nボス戦（ボス＋おとも。強打は、ためる分を 確率で 近似）");
console.log("Lv  人数 | 勝率   平均で減るHP  倒れた味方  ターン");
let worstBoss = 0;
for (const L of LEVELS) {
  for (const P of [1, 2, 3, 4]) {
    let win = 0, lost = 0, down = 0, rounds = 0;
    for (let i = 0; i < N_TRIALS; i++) {
      const r = fight(P, L, 1 + en.bossMinions(P), Math.random, true);
      if (r.win) win++;
      lost += r.lost; down += r.down; rounds += r.rounds;
    }
    worstBoss = Math.max(worstBoss, 1 - win / N_TRIALS);
    console.log(`${String(L).padStart(2)}  ${P}人  | ${(win / N_TRIALS * 100).toFixed(1).padStart(5)}%  ${(lost / N_TRIALS * 100).toFixed(0).padStart(6)}%     ${(down / N_TRIALS * 100).toFixed(0).padStart(6)}%    ${(rounds / N_TRIALS).toFixed(1).padStart(5)}`);
  }
}
console.log(`\nボス戦で 最も負けやすい条件の負け率：${(worstBoss * 100).toFixed(1)}%`);

// 敵のレベルが、平均レベルより どれだけ高い（低い）と、どれくらい勝てるか：章ごとの敵のレベル帯を決めるための 目安
console.log("\n敵のLv − 平均Lv の 差ごとの勝率（ふつうの戦い／ボス戦。Lv10と30。1人・2人・4人）");
console.log("差   | Lv10 1人  2人  4人 | ボス 1人  2人  4人 | Lv30 1人  2人  4人");
for (let d = -8; d <= 6; d += 2) {
  const cells = [];
  for (const L of [10, 30]) for (const boss of L === 10 ? [false, true] : [false]) {
    const row = [];
    for (const P of [1, 2, 4]) {
      let win = 0;
      for (let i = 0; i < 600; i++) { const N = boss ? 1 + en.bossMinions(P) : en.rollCount(P, L); if (fight(P, L, N, Math.random, boss, d).win) win++; }
      row.push(String(Math.round(win / 6)).padStart(3) + "%");
    }
    cells.push(row.join(" "));
  }
  console.log(String(d).padStart(3) + "  | " + cells[0] + " | " + cells[1] + " | " + cells[2]);
}
