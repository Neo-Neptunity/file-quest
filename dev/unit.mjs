// 画面を持たない部品（items・appraise・encounter・party・visitors・card・ai・roots・volume・discover・idle・hero・reset・world・sprite）のテスト
//   使い方：node file-quest/dev/unit.mjs
import assert from "node:assert/strict";
import { stage } from "./stage.mjs";

const st = stage("unit");
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push([name, true]); console.log("  ok  ", name); }
  catch (e) { results.push([name, false]); console.log("  NG  ", name, "\n       ", e.message, process.env.UNIT_STACK ? "\n" + e.stack : ""); }
};

// ---- items ----------------------------------------------------------------------------------
const items = await import(st.url("items.js"));
const data = await import(st.url("data.js"));

await test("items: 古いセーブ（wep/arm/items）を v3 に変換できる", () => {
  const old = { lv: 5, wep: 3, arm: 2, items: { herb: 7, ether: 2, smoke: 0 }, gold: 100 };
  const s = items.migrateSave(old);
  assert.equal(s.v, 3);
  assert.equal(s.items, undefined);
  assert.equal(s.wep, undefined);
  assert.equal(s.inv.item.herb, 7);
  assert.equal(s.inv.item.bomb, 0);
  const eq = items.equippedGear(s);
  assert.equal(eq.weapon.tier, 3);
  assert.equal(eq.armor.tier, 2);
  assert.equal(eq.acc, null);
  assert.equal(s.heroName, "ゆうしゃ");
});
await test("items: 新規のセーブは、開始装備と やくそう5個", () => {
  const s = items.migrateSave({});
  assert.equal(s.inv.item.herb, 5);
  assert.equal(items.equippedGear(s).weapon.tier, 0);
});
await test("items: 変換は 2回 かけても 同じ", () => {
  const a = items.migrateSave({ wep: 2 });
  const json = JSON.stringify(a);
  assert.equal(JSON.stringify(items.migrateSave(JSON.parse(json))), json);
});
await test("items: 素材のドロップ（並は必ず・稀はボスだけ）", () => {
  let rare = 0, uncommon = 0;
  for (let i = 0; i < 2000; i++) {
    const d = items.rollDrops("video", 10, {});
    assert.ok(d.video_0 >= 3);
    assert.equal(d.video_2, undefined);
    if (d.video_1) uncommon++;
    assert.equal(items.rollDrops("image", 3, { boss: true }).image_2, 1);
    rare += items.rollDrops("image", 3, {}).image_2 ? 1 : 0;
  }
  assert.equal(rare, 0);
  assert.ok(uncommon > 400 && uncommon < 600, `良は約25%のはず：${uncommon}/2000`);
  assert.equal(items.rollDrops("doc", 4, { thief: true }).doc_0, 2);
  assert.equal(items.rollDrops("doc", 4, { extra: 1 }).doc_0, 2);
});
await test("items: 作る（素材とゴールドが足りれば、得意な相手の付いた装備ができる）", () => {
  const s = items.migrateSave({});
  assert.equal(items.craft(s, "weapon", "video"), null);          // 足りない
  s.gold = 1000;
  items.addAll(s.inv.mat, { video_0: 10, video_1: 3 });
  const g = items.craft(s, "weapon", "video");
  assert.equal(g.tier, 1);
  assert.equal(g.affinity, "video");
  assert.equal(items.gearName(g), "竜のどうのつるぎ");
  assert.equal(s.gold, 1000 - 60);
  assert.equal(s.inv.mat.video_0, 10 - 6);
  assert.equal(s.inv.mat.video_1, 3 - 1);
  assert.equal(items.bestTier(s, "weapon"), 1);
});
await test("items: アクセサリは 稀の素材3つ", () => {
  const s = items.migrateSave({});
  s.gold = 500;
  items.addAll(s.inv.mat, { audio_2: 3 });
  const g = items.craft(s, "acc", "audio");
  assert.equal(g.slot, "acc");
  assert.equal(items.gearEffect(g, "heal"), 0.3);
  assert.equal(s.inv.mat.audio_2, undefined);
});
await test("items: 買う・売る・装備", () => {
  const s = items.migrateSave({});
  s.gold = 500;
  const g = items.buyNextGear(s, "weapon");
  assert.equal(g.tier, 1);
  assert.equal(s.gold, 500 - 90);
  assert.equal(items.sellGear(s, g.id), 36);                       // 装備していなければ売れる
  s.gold = 500;
  const g2 = items.buyNextGear(s, "armor");
  items.equipGear(s, g2.id);
  assert.equal(items.sellGear(s, g2.id), 0);                       // 装備中は売れない
  items.addAll(s.inv.mat, { image_1: 5 });
  assert.equal(items.sellMats(s, "image_1", 3), 36);
  assert.equal(s.inv.mat.image_1, 2);
});
await test("items: 最高の段階を超えては 作れない・買えない", () => {
  const s = items.migrateSave({ wep: 7 });
  s.gold = 1e6;
  items.addAll(s.inv.mat, { code_0: 99, code_1: 99 });
  assert.equal(items.craft(s, "weapon", "code"), null);
  assert.equal(items.buyNextGear(s, "weapon"), null);
});
await test("items: 日替わり特価は、同じ日なら同じ", () => {
  const d = items.dayNum(Date.UTC(2026, 9, 22, 12));
  assert.equal(items.dailySpecial(d), items.dailySpecial(d));
  const sp = items.dailySpecial(d);
  assert.equal(items.itemPrice(sp, d), Math.round(data.ITEMS[sp].price * 0.8));
  const other = items.SHOP_ITEMS.find((k) => k !== sp);
  assert.equal(items.itemPrice(other, d), data.ITEMS[other].price);
});

// ---- appraise -------------------------------------------------------------------------------
const ap = await import(st.url("appraise.js"));
const BS = String.fromCharCode(92);                                   // バックスラッシュ（パスの区切り）
const F = (name, ext, extra = {}) => ({ id: "id-" + name, path: `C:${BS}x${BS}${name}`, name, ext, size: 1000, ...extra });

await test("appraise: 手元の判定（税金・契約・鍵・思い出・ごみ）", () => {
  assert.ok(ap.ruleAppraise(F("確定申告2023.pdf", "pdf")).imp >= 70);
  assert.ok(ap.ruleAppraise(F("invoice_0412.pdf", "pdf")).imp >= 70);
  assert.ok(ap.ruleAppraise(F("passport_scan.jpg", "jpg")).imp >= 70);
  assert.ok(ap.ruleAppraise(F("wallet.kdbx", "kdbx")).imp >= 90);
  assert.ok(ap.ruleAppraise(F("卒業アルバム.zip", "zip")).imp >= 70);
  assert.ok(ap.ruleAppraise(F("スクリーンショット 2024-05-05.png", "png")).imp < 40);
  assert.ok(ap.ruleAppraise(F("download.crdownload", "crdownload")).imp < 40);
  const mid = ap.ruleAppraise(F("提出_最終版.docx", "docx"));
  assert.ok(mid.imp >= ap.IMP_DOUBT && mid.imp < ap.IMP_GUARD);
  assert.ok(ap.ruleAppraise(F("IMG_2041.jpg", "jpg")).imp >= ap.IMP_DOUBT);
});
await test("appraise: AI の返事の検査（範囲外・形の崩れ・タグ）", () => {
  const rows = [{ k: 0, imp: 150, why: "あ".repeat(50), tag: "税金" }, { k: 1, imp: -5, why: "<b>x</b>", tag: "へんなタグ" }, { k: 9, imp: 50 }, { k: "a", imp: 1 }, null, { k: 2, imp: "NaN" }];
  const out = ap.validateAiRows(rows, 3);
  assert.equal(out.size, 2);
  assert.equal(out.get(0).imp, 100);
  assert.equal(out.get(0).why.length, 20);
  assert.equal(out.get(1).imp, 0);
  assert.equal(out.get(1).tag, "");
  assert.ok(!out.get(1).why.includes("<"));
  assert.equal(ap.validateAiRows("壊れた", 3).size, 0);
  assert.equal(ap.validateAiRows(null, 3).size, 0);
});
await test("appraise: AI は 守る判定を 下げない（高いほうを採る）", async () => {
  const files = [F("確定申告.pdf", "pdf"), F("memo.txt", "txt")];
  const askAi = async (items) => items.map((it) => ({ k: it.k, imp: 0, why: "全部ごみ", tag: "ゴミ" }));   // AI が全部 0 と言っても
  const r = await ap.appraiseAll(files, { askAi, cache: {} });
  assert.ok(r.get(ap.appraiseKey(files[0])).imp >= 70);
});
await test("appraise: AI が 上げる分は 採る・失敗しても 手元の判定になる", async () => {
  const files = [F("memo.txt", "txt")];
  const up = await ap.appraiseAll(files, { askAi: async (it) => it.map((x) => ({ k: x.k, imp: 88, why: "仕事の記録", tag: "仕事" })), cache: {} });
  assert.equal(up.get(ap.appraiseKey(files[0])).imp, 88);
  const fail = await ap.appraiseAll(files, { askAi: async () => { throw new Error("通信できない"); }, cache: {} });
  assert.equal(fail.get(ap.appraiseKey(files[0])).imp, 15);
  const broken = await ap.appraiseAll(files, { askAi: async () => "これは配列ではない", cache: {} });
  assert.equal(broken.get(ap.appraiseKey(files[0])).imp, 15);
});
await test("appraise: 40件ずつ・最大25回・覚えたものは呼ばない", async () => {
  const files = Array.from({ length: 1100 }, (_, i) => F(`file${i}.dat`, "dat"));
  let calls = 0, maxItems = 0;
  const cache = {};
  const askAi = async (items) => { calls++; maxItems = Math.max(maxItems, items.length); return items.map((x) => ({ k: x.k, imp: 20, why: "", tag: "ゴミ" })); };
  await ap.appraiseAll(files, { askAi, cache });
  assert.equal(calls, 25);
  assert.equal(maxItems, 40);
  assert.equal(Object.keys(cache).length, 1100);        // 呼び出せなかった分も、手元の判定で入る
  calls = 0;
  await ap.appraiseAll(files.slice(0, 100), { askAi, cache });
  assert.equal(calls, 0);
});
await test("appraise: フォルダ名は 指定したときだけ 送る", async () => {
  const files = [F("a.txt", "txt")];
  let seen = null;
  await ap.appraiseAll(files, { askAi: async (it) => { seen = it; return []; }, cache: {} });
  assert.equal(seen[0].d, undefined);
  await ap.appraiseAll([F("b.txt", "txt")], { askAi: async (it) => { seen = it; return []; }, cache: {}, folderOf: () => "資料" });
  assert.equal(seen[0].d, "資料");
});

// ---- encounter ------------------------------------------------------------------------------
const en = await import(st.url("encounter.js"));
const party = await import(st.url("party.js"));
const vis = await import(st.url("visitors.js"));
const card = await import(st.url("card.js"));
const seeded = (seed) => { let a = seed; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

await test("encounter: 敵の数の出方が 表のとおり（何千回も引く）", () => {
  const r = seeded(7), N = 40000;
  for (const P of [1, 2, 3, 4]) {
    const cnt = {};
    for (let i = 0; i < N; i++) { const c = en.rollCount(P, 10, r); cnt[c] = (cnt[c] || 0) + 1; }
    for (const [count, w] of en.COUNT_TABLE[P]) assert.ok(Math.abs((cnt[count] / N) * 100 - w) < 1.5, `P${P} ${count}体：${((cnt[count] / N) * 100).toFixed(1)}% ≠ ${w}%`);
    assert.ok(Math.max(...Object.keys(cnt).map(Number)) <= P + 1, "上限は 人数＋1");
    assert.ok(Math.max(...Object.keys(cnt).map(Number)) <= en.MAX_ENEMIES);
  }
});
await test("encounter: ソロでレベル4以下は 必ず1体", () => {
  const r = seeded(3);
  for (let i = 0; i < 5000; i++) assert.equal(en.rollCount(1, 4, r), 1);
});
await test("encounter: 敵のレベルの上限（数が人数より多いと 1下げる・ボスは＋2）", () => {
  assert.equal(en.levelCap(8, 3, 3), 9);
  assert.equal(en.levelCap(8, 4, 3), 8);
  assert.equal(en.levelCap(8, 2, 1), 8);
  assert.equal(en.levelCap(8, 1, 3, true), 11);
  assert.equal(en.levelCap(1, 1, 1), 2);
});
await test("encounter: 群れは 同じフォルダを 優先して集める", () => {
  const mk = (n, dir, size) => ({ id: "i" + n, path: `C:${BS}${dir}${BS}f${n}.txt`, name: `f${n}.txt`, size });
  const leader = mk(0, "A", 5000);
  const pool = [leader, mk(1, "A", 4000), mk(2, "A", 100000), mk(3, "B", 5000), mk(4, "A", 5200), mk(5, "C", 5000)];
  const f = en.pickFollowers(pool, leader, 2, { rand: seeded(1) });
  assert.deepEqual(f.map((x) => x.id).sort(), ["i1", "i4"]);          // 同じフォルダで、大きさの近い2つ
  const f3 = en.pickFollowers(pool, leader, 4, { rand: seeded(1) });
  assert.equal(f3.length, 4);
  assert.ok(!f3.some((x) => x.id === "i0"), "リーダー自身は入らない");
  assert.equal(new Set(f3.map((x) => x.id)).size, 4, "重ならない");
  assert.equal(en.pickFollowers([leader], leader, 3).length, 0, "足りなければ減らす");
  const big = en.pickFollowers([leader, { ...mk(9, "A", 99e6) }], leader, 1, { maxSize: 20e6 });
  assert.equal(big.length, 0, "ボスの大きさの敵は、取り巻きにしない");
});
await test("encounter: 人数による敵の補正（ソロはそのまま・人数が増えるほど少し強い）", () => {
  assert.deepEqual(en.partyScale(1), { hp: 1, atk: 1 });
  const a = en.partyScale(2), b = en.partyScale(4);
  assert.ok(a.hp > 1 && b.hp > a.hp && b.atk > a.atk);
  assert.ok(b.hp <= 2 && b.atk <= 1.5, "補正が 大きすぎない");
  assert.deepEqual(en.partyScale(9), en.partyScale(4), "4人までで 止まる");
});
await test("encounter: 絵の大きさは 16 の倍数（ボスは 32 の倍数）", () => {
  for (const n of [1, 2, 3, 4, 5]) assert.equal(en.spriteSize(n, false) % 16, 0);
  assert.equal(en.spriteSize(1, true) % 32, 0);
  assert.equal(en.spriteSize(3, true) % 32, 0);
});

await test("encounter: 敵のレベル（部のないとき）は、大きさ由来と、平均レベルの上限の小さいほう。勇者が育てば、弱くなる", () => {
  const f = (sizeLv, avg, N, P, boss) => Math.max(1, Math.min(sizeLv + (boss ? 2 : 0), en.levelCap(avg, N, P, boss)));
  for (let avg = 1; avg <= 50; avg += 3) for (let sizeLv = 1; sizeLv <= 20; sizeLv++) for (const boss of [false, true]) for (let P = 1; P <= 4; P++) for (let N = 1; N <= 5; N++) {
    assert.equal(en.enemyLevel(sizeLv, avg, N, P, boss), f(sizeLv, avg, N, P, boss), `avg${avg} 大きさLv${sizeLv} boss${boss} P${P} N${N}`);
  }
  // 小さいファイルは、勇者が育つと そのまま（敵のレベルは ついてこない）。大きいファイルは、上限
  assert.equal(en.enemyLevel(2, 30, 1, 1), 2); assert.equal(en.enemyLevel(2, 5, 1, 1), 2);
  assert.equal(en.enemyLevel(12, 5, 1, 1), en.levelCap(5, 1, 1), "大きいファイルは、上限（平均+1）");
  // 平均レベルが上がっても、敵のレベルは 下がらず・大きさ由来をこえない
  for (let sizeLv = 1; sizeLv <= 20; sizeLv += 3) { let prev = 0; for (let avg = 1; avg <= 60; avg++) { const lv = en.enemyLevel(sizeLv, avg, 1, 1); assert.ok(lv >= prev && lv <= sizeLv, `大きさLv${sizeLv} avg${avg}：${lv}`); prev = lv; } }
});
await test("encounter: 部の中の敵のレベルは、章ごとに決まった範囲。勇者のレベルでは変わらない（遅れているときだけ、上限）", async () => {
  const ch = { lv: [4, 8], minSize: 1000, maxSize: 1e9 };
  // 小さいほど低く、大きいほど高い。範囲の中
  let prev = 0;
  for (const size of [1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]) { const lv = en.partEnemyLevel(ch, size, 99); assert.ok(lv >= prev && lv >= 4 && lv <= 8, `${size}：${lv}`); prev = lv; }
  assert.equal(en.partEnemyLevel(ch, 1000, 99), 4); assert.equal(en.partEnemyLevel(ch, 1e9, 99), 8);
  assert.equal(en.partEnemyLevel(ch, 5e8, 99, { boss: true }), en.partEnemyLevel(ch, 5e8, 99) + 2, "ボスは +2");
  assert.equal(en.partEnemyLevel(ch, 1e9, 99, { boss: true, nushi: true }), 11, "ぬしは +3");
  // 勇者が育っても、敵は強くならない（平均10〜50 で、同じ）
  for (const size of [1000, 1e6, 1e9]) for (const boss of [false, true]) assert.equal(new Set([10, 20, 30, 50].map((avg) => en.partEnemyLevel(ch, size, avg, { boss }))).size, 1, `${size} ${boss}`);
  // 勇者が遅れているときだけ、上限（平均+3・ボスは+4）で、手に負えなくならない
  assert.equal(en.partEnemyLevel(ch, 1e9, 1), 4); assert.equal(en.partEnemyLevel(ch, 1e9, 1, { boss: true }), 5); assert.equal(en.partEnemyLevel(ch, 1e9, 6), 8);
  assert.equal(en.partEnemyLevel(ch, 1e9, 1, { boss: true, nushi: true }), 5);
  // 大きさが全部同じ章でも、決まる
  assert.equal(en.partEnemyLevel({ lv: [3, 6], minSize: 5, maxSize: 5 }, 5, 99), 6);
  assert.ok(en.partEnemyLevel({ lv: [3, 6] }, 100, 99) >= 3);
});

// ---- party ----------------------------------------------------------------------------------
await test("party: 役割ごとの能力（前衛は硬く、盗賊は速い）", () => {
  const f = party.memberStats("front", 10), h = party.memberStats("healer", 10), t = party.memberStats("thief", 10);
  assert.ok(f.maxHp > h.maxHp && f.def > h.def);
  assert.ok(t.spd > f.spd);
  assert.ok(h.maxMp > f.maxMp);
});
await test("party: 絆の段階でとくぎが増える・カードは レベルで底上げ", () => {
  assert.deepEqual(party.skillsFor("healer", 0), ["heal"]);
  assert.deepEqual(party.skillsFor("healer", 3), ["heal", "healAll", "revive", "mega"]);
  assert.deepEqual(party.skillsFor("thief", 0), []);
  assert.equal(party.stageOf(0), 0);
  assert.equal(party.stageOf(5), 1);
  assert.equal(party.stageOf(30), 3);
  assert.equal(party.friendStage({ kind: "card", bond: 0 }, 18), 3);
  assert.equal(party.friendStage({ kind: "npc", bond: 0 }, 18), 0);
  assert.equal(party.companionLv({ kind: "npc" }, 8), 7);
  assert.equal(party.companionLv({ kind: "card", lv0: 30 }, 8), 10);
  assert.equal(party.companionLv({ kind: "card", lv0: 4 }, 8), 4);
});
await test("party: おまかせ（回復役は 弱った味方を 回復・MPが無ければ 殴る）", () => {
  const mk = (role, hp, maxHp, mp, skills) => ({ role, hp, maxHp, mp, skills, mpCut: 0 });
  const hero = mk("hero", 20, 100, 5, []), healer = mk("healer", 80, 80, 20, party.skillsFor("healer", 1));
  const foe = [{ hp: 50, maxHp: 50 }];
  const a = party.autoAction(healer, [hero, healer], foe, seeded(1));
  assert.equal(a.type, "skill");
  assert.equal(a.skill, "heal");
  assert.equal(a.target, hero);
  const dry = mk("healer", 80, 80, 0, party.skillsFor("healer", 1));
  assert.equal(party.autoAction(dry, [hero, dry], foe, seeded(1)).type, "attack");
  const down = { role: "front", hp: 0, maxHp: 90, mp: 0, skills: [] };
  const rv = party.autoAction(mk("healer", 80, 80, 20, party.skillsFor("healer", 2)), [mk("hero", 100, 100, 5, []), down], foe, seeded(1));
  assert.equal(rv.skill, "revive");
  assert.equal(rv.target, down);
});
await test("party: 敵の狙いは 前衛が当たりやすい・倒れた味方は 狙わない", () => {
  const al = [{ role: "front", hp: 10 }, { role: "healer", hp: 10 }, { role: "thief", hp: 0 }];
  const r = seeded(5); let front = 0, thief = 0;
  for (let i = 0; i < 6000; i++) { const t = party.pickAlly(al, r); if (t.role === "front") front++; if (t.role === "thief") thief++; }
  assert.equal(thief, 0);
  assert.ok(front / 6000 > 0.6 && front / 6000 < 0.72, `前衛が狙われる割合 ${front / 6000}`);
  assert.equal(party.pickAlly([{ role: "front", hp: 0 }], r), null);
});

// ---- visitors -------------------------------------------------------------------------------
await test("visitors: カードが無ければ 誰も来ない（ダミーの旅人はいない）", () => {
  assert.deepEqual(vis.visitorsFor({}), []);
  assert.deepEqual(vis.visitorsFor({ cards: [] }), []);
  for (const seed of [1, 7, 123456]) for (const day of [0, 100, 20000]) assert.deepEqual(vis.visitorsFor({ town: 0, day, worldSeed: seed, heroLv: 5 }), []);
});
await test("visitors: 取りこんだカードの人は ぜんいん いつでも来ている", () => {
  const cards = [1, 2, 3].map((i) => ({ id: "c" + i, name: "友" + i, role: "healer", lv: 8 + i, quip: "やあ" + i, seed: i }));
  const v = vis.visitorsFor({ cards });
  assert.deepEqual(v.map((x) => x.id), ["c1", "c2", "c3"]);
  for (const x of v) { assert.equal(x.kind, "card"); assert.equal(x.role, "healer"); assert.ok(x.name && x.quip); }
  assert.deepEqual(vis.visitorsFor({ cards }), v, "日や町に よらない");
  assert.equal(vis.visitorsFor({ cards, limit: 2 }).length, 2);
});
await test("visitors: フレンド申請は 記録を作る（絆0・HP/MPは満タン扱い）", () => {
  const v = vis.cardVisitor({ id: "cx", name: "友x", role: "thief", lv: 10, quip: "ヒヒ", seed: 5 });
  const f = vis.friendFrom(v, 42);
  assert.equal(f.id, "cx"); assert.equal(f.kind, "card"); assert.equal(f.role, "thief"); assert.equal(f.lv0, 10);
  assert.equal(f.bond, 0); assert.equal(f.since, 42); assert.equal(f.hp, null); assert.equal(f.mp, null);
  assert.ok(vis.FRIEND_MAX >= 4);
});

// ---- card -----------------------------------------------------------------------------------
await test("card: 出したコードを 取り込める（ふつうの往復）", () => {
  const code = card.encodeCard({ name: "テスト太郎", role: "healer", lv: 12, quip: "よろしくね", seed: 123456 });
  assert.ok(code.startsWith("FQ1-") && code.length < 300);
  const r = card.decodeCard("\n  " + code.slice(0, 20) + "\n" + code.slice(20) + "  ");        // 改行や空白が混ざってもよい
  assert.ok(r.ok, r.error);
  assert.equal(r.card.name, "テスト太郎");
  assert.equal(r.card.role, "healer");
  assert.equal(r.card.lv, 12);
  assert.equal(r.card.quip, "よろしくね");
  assert.equal(r.card.id, card.decodeCard(code).card.id);
});
await test("card: 壊れたコード・切れたコード・別のものは 拒否する", () => {
  const code = card.encodeCard({ name: "A", role: "front", lv: 3, quip: "q", seed: 1 });
  for (const bad of ["", "   ", "hello", "FQ1-", "FQ1-abc", code.slice(0, code.length - 6), code.slice(0, 30), code.replace("FQ1-", "FQ2-"), "FQ1-" + "あ".repeat(10) + "-0000", "x".repeat(2000)]) {
    assert.equal(card.decodeCard(bad).ok, false, `拒否のはず：${bad.slice(0, 20)}`);
  }
});
const pixel = await import(st.url("pixel.js"));
await test("card: 数値を盛ったコード・変な役割・記号だらけの名前は 拒否か 無害化", () => {
  // チェックサムを 正しく付けた「偽造カード」。チェックサムは 誤字を 見つけるだけで、改ざんの防止ではない（防ぐのは 検査と 上限）
  const forge = (o) => { const body = Buffer.from(JSON.stringify(o)).toString("base64url"); return card.CARD_PREFIX + body + "-" + (pixel.hashStr(body) & 0xffff).toString(16).padStart(4, "0"); };
  assert.ok(card.decodeCard(forge({ v: 1, n: "ok", r: "front", l: 5, q: "q", s: 1 })).ok, "正しい偽造は 形が合えば 通る（能力は 計算で決まる）");
  for (const o of [{ v: 1, n: "x", r: "front", l: 99999, q: "", s: 1 }, { v: 1, n: "x", r: "dragonlord", l: 5, q: "", s: 1 }, { v: 1, n: "x", r: "front", l: 5, q: "", s: -4 },
    { v: 2, n: "x", r: "front", l: 5, q: "", s: 1 }, { v: 1, n: "", r: "front", l: 5, q: "", s: 1 }, { v: 1, n: "x", r: "front", l: 1.5, q: "", s: 1 }, [1, 2, 3], "text"]) {
    assert.equal(card.decodeCard(forge(o)).ok, false, `拒否のはず：${JSON.stringify(o)}`);
  }
  const nasty = ["<", ">", "&", String.fromCharCode(34), String.fromCharCode(39), String.fromCharCode(96), String.fromCharCode(92)].join("");
  const good = card.decodeCard(card.encodeCard({ name: "<script>alert(1)</script>", role: "front", lv: 5, quip: `${nasty} ok ${nasty}`, seed: 5 }));
  assert.ok(good.ok);
  assert.ok(!/[<>&]/.test(good.card.name + good.card.quip) && !(good.card.name + good.card.quip).includes(String.fromCharCode(34)), "記号は 取りのぞく");
  assert.ok(good.card.name.length <= 12 && good.card.quip.length <= 30);
  const lvHigh = card.decodeCard(card.encodeCard({ name: "強い人", role: "thief", lv: 9999, quip: "x", seed: 1 }));
  assert.equal(lvHigh.card.lv, 50, "レベルは 50 で止まる");
  assert.equal(party.companionLv({ kind: "card", lv0: lvHigh.card.lv }, 5), 7, "同行するときは ヒーロー＋2 まで");
});

// ---- quests・ai ----------------------------------------------------------------------------
const qs = await import(st.url("quests.js"));
const aimod = await import(st.url("ai.js"));
const MBn = 1024 * 1024;
const mkPool = (n, ext, size, age = 800) => Array.from({ length: n }, (_, i) => ({ id: `${ext}${i}`, path: `C:${BS}p${BS}${ext}${i}.${ext}`, name: `${ext}${i}.${ext}`, ext, size, modified: Date.now() - age * 86400000 }));

await test("quests: 集計と手元の依頼（達成できる数だけ）", () => {
  const list = [...mkPool(12, "png", 3 * MBn), ...mkPool(4, "mp4", 30 * MBn), ...mkPool(2, "txt", 1000)];
  const st2 = qs.poolStats(list, 365);
  assert.equal(st2.counts.image, 12);
  assert.equal(st2.bossCount, 4);
  assert.ok(st2.ghostCount >= 1);
  for (let i = 0; i < 50; i++) {
    const offers = qs.localOffers(st2, []);
    assert.ok(offers.length >= 1 && offers.length <= 3);
    for (const q of offers) {
      assert.ok(q.gold > 0 && q.exp > 0 && q.title);
      assert.ok(q.need <= qs.maxNeed(q.type, q.cat, st2) || q.type === "any" || q.type === "bytes", `${q.title}：必要数が 敵の数を超えている`);
    }
  }
});
await test("quests: AI の依頼の検査（型・種類・数・重複・報酬は計算）", () => {
  const stats = qs.poolStats([...mkPool(12, "png", 3 * MBn), ...mkPool(3, "mp4", 30 * MBn)], 365);
  const rows = [
    { title: "妖精の森を掃除", story: "ほこりだらけだ", type: "cat", cat: "image", need: 99 },       // 多すぎる → 上限に切り詰める
    { title: "x", type: "cat", cat: "image", need: 3 },                                                  // 重複 → 捨てる
    { title: "ドラゴン", type: "cat", cat: "dragon", need: 2 },                                          // 知らない種類 → 捨てる
    { title: "<b>大物</b>", type: "boss", need: 1 },
    { title: "ばらばら", type: "teleport", need: 1 },                                                   // 知らない型 → 捨てる
    { title: "ゴースト", type: "ghost", need: 1 },
    { title: "なんでも", type: "any", need: 999 },
    "壊れた行", null,
  ];
  const out = qs.validateAiQuests(rows, stats, []);
  assert.ok(out.length <= 3 && out.length >= 2);
  const cat = out.find((q) => q.type === "cat");
  assert.equal(cat.need, 8, "12体の 2/3 まで");
  assert.equal(cat.gold, qs.rewardFor("cat", 8).gold, "報酬は 計算");
  assert.ok(!out.some((q) => q.title.includes("<")), "記号は 取りのぞく");
  assert.equal(new Set(out.map((q) => q.type + (q.cat || ""))).size, out.length);
  assert.deepEqual(qs.validateAiQuests("壊れた", stats), []);
  const none = qs.validateAiQuests([{ title: "大物", type: "boss", need: 1 }], qs.poolStats(mkPool(5, "png", 1000), 365));
  assert.equal(none.length, 0, "大物がいないのに 大物の依頼は 出さない");
  const act = [{ type: "cat", cat: "image" }];
  assert.ok(!qs.validateAiQuests(rows, stats, act).some((q) => q.type === "cat"), "受けている依頼と 同じ型は 出さない");
});
await test("quests: 進み具合", () => {
  assert.equal(qs.progressAdd({ type: "cat", cat: "image" }, { cat: "image", size: 5 }), 1);
  assert.equal(qs.progressAdd({ type: "cat", cat: "image" }, { cat: "video", size: 5 }), 0);
  assert.equal(qs.progressAdd({ type: "bytes" }, { size: 777 }), 777);
  assert.equal(qs.progressAdd({ type: "boss" }, { size: 50 * MBn }), 1);
  assert.equal(qs.progressAdd({ type: "ghost" }, { ghost: false }), 0);
  assert.equal(qs.progressAdd({ type: "any" }, {}), 1);
});
await test("ai: 敵の技の検査（効果の種類・倍率の範囲・文字数・記号）", () => {
  const ok = aimod.cleanSkill({ name: "最終版の呪い", msg: "終わらない修正を 浴びせた", effect: "damage", power: 5 });
  assert.equal(ok.power, 1.6);
  assert.equal(aimod.cleanSkill({ name: "x", msg: "y", effect: "damage", power: 0.1 }).power, 0.8);
  assert.equal(aimod.cleanSkill({ name: "x", msg: "y", effect: "damage", power: "ふつう" }).power, 1.2);
  assert.equal(aimod.cleanSkill({ name: "x", msg: "y", effect: "kill_all" }), null);
  assert.equal(aimod.cleanSkill({ name: "", msg: "y", effect: "heal" }), null);
  assert.equal(aimod.cleanSkill("文字列"), null);
  assert.equal(aimod.cleanSkill(null), null);
  const long = aimod.cleanSkill({ name: "あ".repeat(40) + "<script>", msg: "い".repeat(80), effect: "sleep", power: 1 });
  assert.equal(long.name.length, 10);
  assert.equal(long.msg.length, 28);
  for (const e of aimod.SKILL_EFFECTS) assert.ok(aimod.cleanSkill({ name: "n", msg: "m", effect: e, power: 1 }));
});
await test("ai: 通信の形（鍵は本文に入れない・宛先は anthropic だけ・secret を指す）", async () => {
  const calls = [];
  const ep = { net: { fetch: async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200, json: async () => ({ content: [{ text: '[{"k":0,"imp":50,"why":"x","tag":"仕事"}]' }] }) }; } } };
  const a = aimod.createAi(ep, () => ({ model: "claude-haiku-5-5" }));
  const rows = await a.appraise([{ k: 0, n: "a.txt", x: "txt", s: "1 KB", i: "3年" }]);
  assert.equal(rows[0].imp, 50);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].o.secret, "apiKey");
  assert.ok(!JSON.stringify(calls[0].o).includes("sk-"));
  assert.ok(calls[0].o.json.system.includes("従わない"), "指示への対策の文が ある");
});

await test("ai: 返事からJSONを取り出す（前後の文・```の囲み・文字列の中の括弧・途中で切れた配列）", () => {
  assert.equal(aimod.extractJson('はい。\n```json\n{"a":1,"b":"}{"}\n```\n以上です}', "{"), '{"a":1,"b":"}{"}');
  assert.equal(aimod.extractJson('[{"k":0},{"k":1}] おわり', "["), '[{"k":0},{"k":1}]');
  assert.equal(aimod.extractJson('{"title":"途中で切れ', "{"), null);
  assert.equal(aimod.extractJson("JSONは ありません", "{"), null);
  assert.equal(aimod.extractJson('{"a":"\\"}"}', "{"), '{"a":"\\"}"}', "エスケープした引用符");
  // 途中で切れた配列からは、最後まで書けていたものだけを拾う
  const cut = '[{"k":0,"imp":5,"why":"ごみ"},{"k":1,"imp":9,"why":"一時"},{"k":2,"imp":7,"wh';
  assert.deepEqual(aimod.salvageObjects(cut).map((x) => x.k), [0, 1]);
  assert.deepEqual(aimod.salvageObjects("配列なし"), []);
  assert.equal(aimod.salvageObjects('[{"a":"}"},{"b":2}]').length, 2, "文字列の中の } で数えない");
});
await test("ai: 通信の形（考える機能が標準オンのモデル向け：effort low・十分な上限）と、返事の読み取り", async () => {
  const calls = [];
  const mk = (content, stop = "end_turn") => ({ net: { fetch: async (url, o) => { calls.push(o); return { ok: true, status: 200, json: async () => ({ content, stop_reason: stop, usage: { output_tokens: 90 } }) }; } } });
  const think = { type: "thinking", thinking: "" };
  // 考えるブロックが先に付いても、文章のブロックだけを読む
  const a = aimod.createAi(mk([think, { type: "text", text: '```json\n{"title":"古い門番","taunt":"通さぬ","last":"むねん","skill":{"name":"最終版の呪い","msg":"終わらない修正を浴びせた","effect":"damage","power":1.2}}\n```' }]), () => ({ model: "claude-haiku-5-5" }));
  const lore = await a.lore({ name: "a.txt" });
  assert.equal(lore.title, "古い門番"); assert.equal(lore.skill.effect, "damage");
  const o = calls[0].json;
  assert.deepEqual(o.output_config, { effort: "low" }, "考える深さを低くする");
  assert.ok(o.max_tokens >= 1000, `上限が小さいと、考えた分で答えが切れる：${o.max_tokens}`);
  // 切れた鑑定の返事でも、書けていた分は使う
  const b = aimod.createAi(mk([{ type: "text", text: '[{"k":0,"imp":5,"why":"a","tag":"ゴミ"},{"k":1,"imp":8,"why":"b","tag":"ゴミ"},{"k":2,"i' }], "max_tokens"), () => ({ model: "claude-haiku-5-5" }));
  assert.equal((await b.appraise([{}, {}, {}])).length, 2);
  // 考えただけで文章が無い（上限で切れた）：原因が分かる形で失敗する
  const c = aimod.createAi(mk([think], "max_tokens"), () => ({ model: "claude-haiku-5-5" }));
  const err = await c.lore({}).then(() => null, (e) => e);
  assert.equal(err.message, "bad-json");
  assert.ok(err.detail.includes("max_tokens") && err.detail.includes("thinking"), err.detail);
  // 説明だけで JSON が無い
  const d = aimod.createAi(mk([{ type: "text", text: "申し訳ありませんが、お手伝いできません。" }]), () => ({ model: "claude-haiku-5-5" }));
  const err2 = await d.lore({}).then(() => null, (e) => e);
  assert.ok(err2.detail.includes("申し訳ありません"), "返事の先頭がメモに残る");
  // 接続の確認
  const e = aimod.createAi(mk([{ type: "text", text: '{"ok":true,"say":"げんき"}' }]), () => ({ model: "claude-sonnet-5-5" }));
  const p = await e.ping();
  assert.equal(p.say, "げんき"); assert.equal(p.meta.stop, "end_turn"); assert.equal(p.meta.out, 90);
});
await test("ai: HTTPエラーは、状態と本体の返した理由を持つ", async () => {
  const ep = { net: { fetch: async () => ({ ok: false, status: 404, text: async () => '{"type":"error","error":{"type":"not_found_error","message":"model: claude-x"}}' }) } };
  const a = aimod.createAi(ep, () => ({ model: "claude-x" }));
  const err = await a.ping().then(() => null, (e) => e);
  assert.equal(err.status, 404); assert.ok(err.detail.includes("not_found_error") && err.detail.includes("claude-x"), err.detail);
});
await test("roots: IDの分かる出発点から たどって、打ち込んだパスのIDを手に入れる", async () => {
  const roots = await import(st.url("roots.js"));
  const D = "C:\\Users\\me\\Documents";
  const tree = {
    [D]: [{ id: "i1", name: "写真", path: D + "\\写真" }],
    [D + "\\写真"]: [{ id: "i2", name: "2020", path: D + "\\写真\\2020" }],
  };
  const calls = [];
  const list = async (ref) => { calls.push(ref.id); return tree[ref.path] || []; };
  const bases = [{ id: "q1", path: D }, { id: "q2", path: "C:\\Users\\me\\Downloads" }, { id: "", path: "C:\\" }];
  assert.deepEqual(await roots.refByDescent("c:/users/me/documents/写真/2020/", bases, list), { id: "i2", path: D + "\\写真\\2020" }, "大文字小文字・区切りの違い・末尾の区切りは気にしない");
  assert.deepEqual(calls, ["q1", "i1"], "1段ずつ たどる");
  assert.deepEqual(await roots.refByDescent(D, bases, list), { id: "q1", path: D }, "出発点そのもの");
  assert.equal(await roots.refByDescent("D:\\写真", bases, list), null, "IDの分かる出発点が無い");
  assert.equal(await roots.refByDescent("C:\\", bases, list), null, "ドライブの直下は、IDが分からない");
  assert.equal(await roots.refByDescent(D + "\\無い", bases, list), null, "途中で見つからない");
  const withId = bases.filter((b) => b.id);
  assert.equal(roots.baseFor(D + "X\\a", withId), null, "名前の前半が同じだけのフォルダは別物");
  assert.equal(roots.baseFor(D + "\\a", [...bases, { id: "q3", path: D + "\\a" }]).id, "q3", "いちばん深い出発点");
});

// ---- volume ---------------------------------------------------------------------------------
await test("volume: 冒険の地の大きさの検査（下限・上限・途中でやめたとき）", async () => {
  const v = await import(st.url("volume.js"));
  const lim = v.limitsFrom({});
  assert.deepEqual(lim, { minCount: 30, minMB: 200, maxCount: 600 }, "決めた既定の値");
  const MB = 1024 * 1024;
  assert.equal(v.checkVolume({ count: 100, bytes: 500 * MB }, lim).ok, true);
  // 境目：ちょうどの値は通る
  assert.equal(v.checkVolume({ count: 30, bytes: 200 * MB }, lim).ok, true);
  assert.equal(v.checkVolume({ count: 600, bytes: 200 * MB }, lim).ok, true);
  assert.equal(v.checkVolume({ count: 601, bytes: 500 * MB }, lim).reason, "too-many");
  assert.equal(v.checkVolume({ count: 29, bytes: 500 * MB }, lim).reason, "too-few");
  assert.equal(v.checkVolume({ count: 100, bytes: 200 * MB - 1 }, lim).reason, "too-small");
  // 多すぎるのが先（数が多すぎるのに、サイズの下限の話はしない）
  assert.equal(v.checkVolume({ count: 5000, bytes: 1 }, lim).reason, "too-many");
  // 途中でやめた（over）は、数が少なく見えても「多すぎる」
  const over = v.checkVolume({ count: 1800, bytes: 0, over: true }, lim);
  assert.equal(over.reason, "too-many"); assert.equal(over.over, true);
  assert.equal(v.abortAt(lim), 1800, "上限の3倍で、調べるのをやめる");
});
await test("volume: 設定の値が壊れていても、下限が上限をこえない・既定に戻る", async () => {
  const v = await import(st.url("volume.js"));
  assert.deepEqual(v.limitsFrom({ minCount: "あ", minMB: null, maxCount: undefined }), { minCount: 30, minMB: 200, maxCount: 600 });
  assert.equal(v.limitsFrom({ minCount: 900, maxCount: 100 }).minCount, 100, "下限は上限まで");
  assert.equal(v.limitsFrom({ maxCount: 1e9 }).maxCount, 100000);
  assert.equal(v.limitsFrom({ minMB: -5 }).minMB, 0);
  assert.equal(v.limitsFrom({ maxCount: 250.6 }).maxCount, 251);
});
await test("volume: AIの鑑定の回数（40件ずつ・最大25回）と、断る文", async () => {
  const v = await import(st.url("volume.js"));
  assert.equal(v.aiCalls(0), 0); assert.equal(v.aiCalls(1), 1); assert.equal(v.aiCalls(40), 1); assert.equal(v.aiCalls(41), 2);
  assert.equal(v.aiCalls(600), 15, "既定の上限なら、最大15回");
  assert.equal(v.aiCalls(100000), 25, "どれだけ多くても25回まで");
  const lim = v.limitsFrom({});
  const fmt = (n) => `${Math.round(n / 1048576)} MB`;
  for (const r of [{ reason: "too-many", count: 700 }, { reason: "too-many", count: 1800, over: true }, { reason: "too-few", count: 5 }, { reason: "too-small", count: 80, bytes: 3 * 1048576 }]) {
    const m = v.volumeMessage(r, lim, fmt);
    assert.ok(m.length > 20 && !/[（）()]/.test(m), `括弧の注釈を使わない：${m}`);
  }
  assert.ok(v.volumeMessage({ reason: "too-many", count: 1800, over: true }, lim, fmt).includes("1800個 以上"));
  assert.ok(v.volumeMessage({ reason: "too-many", count: 700 }, lim, fmt).includes("600個"), "上限の数を知らせる");
  assert.ok(v.volumeMessage({ reason: "too-small", count: 80, bytes: 3 * 1048576 }, lim, fmt).includes("3 MB"));
});

// ---- discover ---------------------------------------------------------------------------------
await test("discover: 古いファイルを、フォルダごとに集計する（途中のフォルダも・大物も・出発点の外は数えない）", async () => {
  const d = await import(st.url("discover.js"));
  const R = "C:\\Users\\me\\Documents";
  const MB = 1024 * 1024;
  const f = (p, size = MB) => ({ path: R + p, size });
  const files = [f("\\a.txt"), f("\\写真\\1.jpg"), f("\\写真\\2020\\2.jpg"), f("\\写真\\2020\\movie.mp4", 50 * MB), f("\\仕事\\x.doc"), { path: "C:\\Users\\me\\Downloads\\z.zip", size: 9 * MB }, { path: R + "X\\no.txt", size: MB }];
  const agg = d.aggregate(files, R);
  const at = (p) => agg.get((R + p).toLowerCase());
  assert.equal(at("").count, 5, "出発点の下ぜんぶ（外のファイル・名前の前半だけ同じフォルダは数えない）");
  assert.equal(at("\\写真").count, 3);
  assert.equal(at("\\写真\\2020").count, 2);
  assert.equal(at("\\写真\\2020").boss, 1, "20MB以上は大物");
  assert.equal(at("").boss, 1);
  assert.equal(at("\\仕事").count, 1);
  assert.equal(at("").bytes, 54 * MB);
  assert.equal(agg.size, 4, "ファイルのあるフォルダと、その上のフォルダだけ");
  // 区切りが / でも、大文字小文字がちがっても同じ
  assert.equal(d.aggregate([{ path: "c:/users/ME/documents/写真/1.jpg", size: 1 }], R).get(R.toLowerCase()).count, 1);
});
await test("discover: 検査に通る、いちばん上のフォルダだけを選ぶ（大きすぎれば中へ・小さすぎは出さない）", async () => {
  const d = await import(st.url("discover.js"));
  const R = "C:\\D";
  const files = [];
  const add = (dir, n) => { for (let i = 0; i < n; i++) files.push({ path: `${R}\\${dir}\\f${i}.dat`, size: 1024 * 1024 }); };
  add("写真", 200); add("書類", 150); add("雑多", 50); add("ちょっと", 5);
  const agg = d.aggregate(files, R);
  const lim = { minCount: 30, minMB: 0, maxCount: 600 };
  assert.deepEqual(d.pickFitting(agg, lim).map((c) => c.path), [R], "全体(405)が入るなら、全体だけ。中の小さなフォルダは出さない");
  assert.deepEqual(d.pickFitting(agg, { ...lim, maxCount: 300 }).map((c) => c.path).sort(), [R + "\\写真", R + "\\書類", R + "\\雑多"].sort(), "全体が大きすぎるなら、中の3つ。5個しかないフォルダは出さない");
  assert.deepEqual(d.pickFitting(agg, { ...lim, minCount: 100, maxCount: 300 }).map((c) => c.path).sort(), [R + "\\写真", R + "\\書類"].sort(), "下限に届かない雑多は出ない");
  assert.deepEqual(d.pickFitting(agg, { ...lim, minMB: 100000 }), [], "合計サイズの下限に届かなければ、なし");
  assert.deepEqual(d.pickFitting(agg, { ...lim, maxCount: 100 }).map((c) => c.path), [R + "\\雑多"], "上限100なら、50個の雑多だけ（写真・書類は上限をこえ、ちょっとは下限に届かない）");
});
await test("discover: 出発点がちがう候補を、ひとまとめにする（ほかの候補の中のものは外す・大きい順・最大数）", async () => {
  const d = await import(st.url("discover.js"));
  const c = (path, bytes) => ({ path, count: 50, bytes, boss: 0 });
  const merged = d.mergeCandidates([[c("C:\\U\\Documents", 100), c("C:\\U\\Pictures", 500)], [c("C:\\U\\Documents\\写真", 90), c("C:\\U\\Downloads", 300)]], 12);
  assert.deepEqual(merged.map((x) => x.path), ["C:\\U\\Pictures", "C:\\U\\Downloads", "C:\\U\\Documents"], "Documents の中の 写真 は外す。大きい順");
  assert.equal(d.mergeCandidates([Array.from({ length: 30 }, (_, i) => c("C:\\X\\" + i, i))], 5).length, 5);
});
await test("discover: 大きさの説明（遊びごたえ・AIの鑑定の回数・括弧の注釈なし）", async () => {
  const d = await import(st.url("discover.js"));
  assert.deepEqual([30, 99, 100, 299, 300, 600].map(d.feel), ["短め", "短め", "ふつう", "ふつう", "長め", "長め"]);
  const fmt = (n) => `${Math.round(n / 1048576)} MB`;
  const t = d.describe({ count: 120, bytes: 300 * 1048576, boss: 2 }, fmt);
  assert.ok(t.includes("約120体") && t.includes("300 MB") && t.includes("大物2体") && t.includes("ふつう") && t.includes("AIの鑑定 3回"), t);
  assert.ok(!d.describe({ count: 40, bytes: 1, boss: 0 }, fmt).includes("大物"), "大物がいなければ書かない");
  assert.ok(!/[（）()]/.test(t));
  const t2 = d.describe({ count: 120, bytes: 300 * 1048576, boss: 2, chapters: 4, bosses: 5, minutes: 80 }, fmt);          // 見込みがあれば、章・ボス・長さ
  assert.ok(t2.includes("4章") && t2.includes("ボス5体") && t2.includes("およそ1時間20分") && t2.includes("AIの鑑定 3回") && !t2.includes("長さ"), t2);
  assert.ok(!/[（）()]/.test(t2));
  assert.equal(d.lastName("C:\\Users\\me\\火の鳥\\"), "火の鳥");
});

// ---- idle -----------------------------------------------------------------------------------
await test("idle: 日付が分からないファイル（1980・1970）を、46年放置にしない", async () => {
  const idle = await import(st.url("idle.js"));
  const now = Date.UTC(2026, 9, 23);
  const YEAR = 365 * 86400000;
  const dos = Date.UTC(1980, 0, 1), unix = 0;
  // 日付が分からない値
  for (const t of [0, unix, dos, Date.UTC(1989, 11, 31), undefined, null, NaN, "あ"]) assert.equal(idle.isBogusTime(t), true, String(t));
  for (const t of [Date.UTC(1990, 0, 1), Date.UTC(2005, 5, 5), now]) assert.equal(idle.isBogusTime(t), false, String(t));
  // 放置の起点：信用できる更新日時はそのまま。信用できないなら、このPCに来た日時
  assert.equal(idle.sinceOf({ modified: Date.UTC(2022, 0, 1), created: now }), Date.UTC(2022, 0, 1), "ふつうのファイルは、更新日時");
  assert.equal(idle.sinceOf({ modified: dos, created: now - 2 * YEAR }), now - 2 * YEAR, "1980 は、作成日時から");
  assert.equal(idle.sinceOf({ modified: dos, created: 0 }), 0, "どちらも分からなければ 0（古いとは言えない）");
  // 年数の計算：46年と出ない
  const data = await import(st.url("data.js"));
  const zip = { modified: dos, since: now - 2 * YEAR };
  assert.equal(data.fmtAge(idle.idleMs(zip, now)).startsWith("2年"), true, data.fmtAge(idle.idleMs(zip, now)));
  assert.equal(data.fmtAge(now - dos).startsWith("46年"), true, "もとの計算が「46年」を出していた（再現）");
  assert.equal(idle.idleMs({ modified: now + 5 * YEAR }, now), 0, "起点が未来でも、負にならない");
  assert.equal(idle.touched({ modified: 5, since: 9 }), 9);
  assert.equal(idle.touched({ modified: 5 }), 5);
});
await test("idle: 本体の時刻（数字・日付の文字）を読む。ありえない値は 0", async () => {
  const idle = await import(st.url("idle.js"));
  assert.equal(idle.parseTime(1700000000000), 1700000000000);
  assert.equal(idle.parseTime("2024-05-01T00:00:00Z"), Date.UTC(2024, 4, 1));
  for (const v of [0, "", "ことば", null, undefined, Date.UTC(1980, 0, 1), 9e15]) assert.equal(idle.parseTime(v), 0, String(v));
});
await test("quests: ぼうれい（長く放置）の数は、日付が分からないファイルの 1980 年に惑わされない", async () => {
  const qs = await import(st.url("quests.js"));
  const DAYMS = 86400000, now = Date.UTC(2026, 9, 23);
  const mk = (extra) => ({ name: "a.zip", ext: "zip", size: 1000, modified: Date.UTC(1980, 0, 1), ...extra });
  assert.equal(qs.poolStats([mk({ since: now - 100 * DAYMS })], 730, now).ghostCount, 0, "100日前に来たファイルは、ぼうれいではない");
  assert.equal(qs.poolStats([mk({ since: now - 2000 * DAYMS })], 730, now).ghostCount, 1);
});

// ---- hero（見た目）-------------------------------------------------------------------------------
await test("hero: 見た目の番号の検査（範囲・個数・型。おかしければ、種から決めた姿）", async () => {
  const h = await import(st.url("hero.js"));
  assert.deepEqual(h.LOOK_N, [6, 8, 5, 8, 4]);
  const ok = [5, 7, 4, 7, 3];
  assert.deepEqual(h.cleanLook(ok, 1), ok);
  assert.notEqual(h.cleanLook(ok, 1), ok, "写しを返す");
  const d1 = h.defaultLook(777);
  for (const bad of [null, undefined, "x", [], [0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [6, 0, 0, 0, 0], [0, 8, 0, 0, 0], [0, 0, 5, 0, 0], [0, 0, 0, 0, 4], [-1, 0, 0, 0, 0], [0.5, 0, 0, 0, 0], ["1", 0, 0, 0, 0], [NaN, 0, 0, 0, 0], { 0: 1 }]) {
    assert.deepEqual(h.cleanLook(bad, 777), d1, `おかしい値は種から決めた姿：${JSON.stringify(bad)}`);
  }
  // 種から決めた姿：同じ種なら同じ・範囲の中・種がちがえばばらける
  assert.deepEqual(h.defaultLook(777), d1);
  const seen = new Set();
  for (let s = 0; s < 400; s++) { const l = h.defaultLook(s); l.forEach((v, i) => assert.ok(Number.isInteger(v) && v >= 0 && v < h.LOOK_N[i])); seen.add(l.join()); }
  assert.ok(seen.size > 300, `種ごとに ばらける：${seen.size}`);
  for (let i = 0; i < 50; i++) h.randomLook().forEach((v, j) => assert.ok(v >= 0 && v < h.LOOK_N[j]));
  assert.equal(h.sameLook([1, 2, 3, 4, 0], [1, 2, 3, 4, 0]), true);
  assert.equal(h.sameLook([1, 2, 3, 4, 0], [1, 2, 3, 4, 1]), false);
  // フレンド・カード・訪れた人から取り出す
  assert.deepEqual(h.lookOf({ look: ok, seed: 5 }), ok);
  assert.deepEqual(h.lookOf({ seed: 5 }), h.defaultLook(5), "見た目が無い古い記録は、種から");
  assert.equal(h.lookOf(null).length, 5);
  assert.ok(h.LOOK_ROWS.length === 5 && h.LOOK_ROWS.every((r) => r.name && r.opts.length >= 4 && r.opts.every(Boolean)), "選ぶ項目の名前");
  assert.ok(h.LOOK_ROWS.every((r) => r.opts.every((o) => !/[（）()]/.test(o))) && h.LOOK_ROWS.every((r) => !/[（）()]/.test(r.name)), "括弧の注釈なし");
});
await test("hero: 絵は 16×16。どの組み合わせでも描ける・ふちどりがある・選ぶと変わる", async () => {
  const h = await import(st.url("hero.js"));
  const colorRe = /^#[0-9a-f]{6}$/;
  const roles = ["hero", "front", "healer", "appraiser", "thief"];
  let min = 999, max = 0;
  for (let hs = 0; hs < 6; hs++) for (let hc = 0; hc < 8; hc++) for (let sk = 0; sk < 5; sk++) for (let of = 0; of < 8; of++) for (let hg = 0; hg < 4; hg++) {
    const g = h.genHeroGrid([hs, hc, sk, of, hg], roles[(hs + hc + hg) % 5]);
    assert.equal(g.length, 16);
    let n = 0, edge = 0;
    for (const row of g) { assert.equal(row.length, 16); for (const c of row) { if (c === null) continue; assert.ok(colorRe.test(c), String(c)); n++; if (c === "#1a1a24") edge++; } }
    assert.ok(edge > 20, "ふちどりがある");
    min = Math.min(min, n); max = Math.max(max, n);
    // 絵のはしの行・列は、ふちどりだけ（絵が はみ出して、切れていない）
    for (let i = 0; i < 16; i++) for (const c of [g[0][i], g[15][i], g[i][0], g[i][15]]) assert.ok(c === null || c === "#1a1a24", "はしは ふちどりだけ");
  }
  assert.ok(min >= 90 && max <= 200, `絵の大きさ ${min}〜${max}`);
  const base = [0, 0, 1, 0, 0];
  const key = (look, role = "hero") => JSON.stringify(h.genHeroGrid(look, role));
  assert.equal(key(base), key([...base]), "同じ番号は 同じ絵");
  for (let i = 0; i < 5; i++) {
    const other = base.slice(); other[i] = (other[i] + 1) % h.LOOK_N[i];
    assert.notEqual(key(other), key(base), `${h.LOOK_ROWS[i].name}を変えると 絵が変わる`);
  }
  assert.equal(new Set(roles.map((r) => key(base, r))).size, 4, "持ちものは、剣（勇者と前衛）・杖・虫めがね・短剣の4種");
  assert.equal(key(base, "hero"), key(base, "front"), "勇者と前衛は、同じ剣");
  assert.equal(key([9, 9, 9, 9, 9]), key(h.defaultLook(0)), "おかしな番号でも 落ちない");
});
await test("card: 見た目を載せて渡せる。古いカード・おかしな見た目は、種から決めた姿", async () => {
  const look = [3, 5, 2, 6, 1];
  const code = card.encodeCard({ name: "見た目の人", role: "thief", lv: 9, quip: "やあ", seed: 4242, look });
  const r = card.decodeCard(code);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.card.look, look, "カードを出した時点の見た目が、そのまま伝わる");
  // 見た目を変えて出し直しても、同じ人（id が同じ）
  const r2 = card.decodeCard(card.encodeCard({ name: "見た目の人", role: "thief", lv: 12, quip: "やあ", seed: 4242, look: [0, 0, 0, 0, 0] }));
  assert.equal(r2.card.id, r.card.id);
  assert.deepEqual(r2.card.look, [0, 0, 0, 0, 0]);
  // 見た目の入っていない古いカード
  const { hashStr } = await import(st.url("pixel.js"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const mk = (o) => { const body = b64(o); return `FQ1-${body}-${(hashStr(body) & 0xffff).toString(16).padStart(4, "0")}`; };
  const hero = await import(st.url("hero.js"));
  const old = card.decodeCard(mk({ v: 1, n: "古い人", r: "front", l: 5, q: "x", s: 123 }));
  assert.ok(old.ok);
  assert.deepEqual(old.card.look, hero.defaultLook(123), "種から決めた姿");
  // 盛った・おかしな見た目は、受け取らずに 種から決めた姿にする（カード全体は拒否しない）
  for (const lk of [[99, 0, 0, 0, 0], ["a", 0, 0, 0, 0], [1, 2], "てきとう", { a: 1 }, null]) {
    const bad = card.decodeCard(mk({ v: 1, n: "盛る人", r: "front", l: 5, q: "x", s: 55, lk }));
    assert.ok(bad.ok, "カードは通る");
    assert.deepEqual(bad.card.look, hero.defaultLook(55), JSON.stringify(lk));
  }
  assert.ok(code.length < 300, `コードは短いまま：${code.length}`);
});
await test("visitors・items・reset・roots: 見た目がフレンドや保存に引き継がれる／島の種は冒険の地から", async () => {
  const hero = await import(st.url("hero.js"));
  const rst = await import(st.url("reset.js"));
  const roots = await import(st.url("roots.js"));
  const c = { id: "c1", name: "ミライ", role: "healer", lv: 14, quip: "やあ", seed: 9, look: [1, 2, 3, 4, 2] };
  const v = vis.cardVisitor(c);
  assert.deepEqual(v.look, c.look);
  assert.deepEqual(vis.friendFrom(v, 5).look, c.look, "フレンドになっても 見た目は同じ");
  // 古い保存：見た目も島の種も無い → 足される。2回かけても同じ
  const s1 = items.migrateSave({ seed: 31337, lv: 4 });
  assert.deepEqual(s1.look, hero.defaultLook(31337));
  assert.equal(s1.islandSeed, 31337);
  assert.equal(JSON.stringify(items.migrateSave(JSON.parse(JSON.stringify(s1)))), JSON.stringify(s1));
  const s2 = items.migrateSave({ seed: 1, look: [2, 2, 2, 2, 2], islandSeed: 777 });
  assert.deepEqual(s2.look, [2, 2, 2, 2, 2]); assert.equal(s2.islandSeed, 777, "選んだ見た目・島は そのまま");
  assert.deepEqual(items.migrateSave({ seed: 1, look: [99, 0, 0, 0, 0] }).look, hero.defaultLook(1), "壊れた見た目は 直る");
  // リセットでも、見た目と島は残る
  const r = rst.resetSave(s2, items.migrateSave({ seed: 5 }));
  assert.deepEqual(r.look, [2, 2, 2, 2, 2]); assert.equal(r.islandSeed, 777);
  // 島の種：同じ場所なら同じ・大文字小文字や区切りは気にしない・場所がちがえばちがう・順番によらない
  const A = [{ path: "C:\\Users\\me\\Documents\\火の鳥" }], B = [{ path: "C:\\Users\\me\\Downloads" }];
  assert.equal(roots.islandSeedFor(A), roots.islandSeedFor([{ path: "c:/users/ME/documents/火の鳥/" }]));
  assert.notEqual(roots.islandSeedFor(A), roots.islandSeedFor(B));
  assert.equal(roots.islandSeedFor([...A, ...B]), roots.islandSeedFor([...B, ...A]));
  for (const p of ["C:\\a", "D:\\写真\\2020", "C:\\Users\\me\\OneDrive\\ドキュメント"]) { const sd = roots.islandSeedFor([{ path: p }]); assert.ok(Number.isInteger(sd) && sd >= 0 && sd <= 2147483647); }
});

// ---- series（シリーズ・部の記録）-----------------------------------------------------------------
await test("series・セーブ v3：古いセーブに、シリーズ・部の記録が足される（ほかは そのまま・2回かけても同じ）", async () => {
  const sr = await import(st.url("series.js"));
  const old = { seed: 5, lv: 23, gold: 777, exp: 100, hp: 200, mp: 50, heroName: "歴戦", roots: [{ id: "q", path: "C:\\X" }], kills: 321, friends: [{ id: "c1", name: "友", role: "front", lv0: 5, bond: 9 }], party: ["c1"], cards: [], inv: { mat: { image_0: 3 }, item: { herb: 9 }, gear: [], nextGear: 1 }, v: 2 };
  const v3 = items.migrateSave(JSON.parse(JSON.stringify(old)));
  assert.equal(v3.v, 3);
  assert.deepEqual(v3.series, { done: [], threads: [], joined: {} });
  assert.deepEqual(v3.parts, {}); assert.equal(v3.activePart, null);
  assert.ok(v3.active === undefined || Array.isArray(v3.active), "save.active は、受けている依頼の一覧のもの（部の印にしない）");
  // レベル・持ち物・仲間などは、そのまま続く
  assert.equal(v3.lv, 23); assert.equal(v3.gold, 777); assert.equal(v3.kills, 321); assert.equal(v3.inv.item.herb, 9); assert.deepEqual(v3.party, ["c1"]); assert.equal(v3.friends[0].bond, 9);
  assert.equal(JSON.stringify(items.migrateSave(JSON.parse(JSON.stringify(v3)))), JSON.stringify(v3), "2回かけても同じ");
  assert.equal(sr.emptySeries().done.length, 0);
});
await test("series：おかしな記録は捨てる（形・文字数・個数）", async () => {
  const sr = await import(st.url("series.js"));
  const dirty = {
    done: [null, 5, { id: "bad id!", title: "x" }, { id: "p1", title: "あ".repeat(60) + "<b>", summary: "い".repeat(300), ending: "keep", day: 20000 }, { id: "p2", title: "第2部", summary: "ok", ending: "release", day: "x" }],
    threads: ["", "伏線1", 5, "あ".repeat(200), "3", "4", "5", "6", "7"],
    joined: { mina: true, "bad key": true, garr: "yes", lily: true },
  };
  const c = sr.cleanSeries(dirty);
  assert.deepEqual(c.done.map((d) => d.id), ["p1", "p2"], "idの形がおかしい・オブジェクトでないものは捨てる");
  assert.equal(c.done[0].title.length, 24); assert.equal(c.done[0].summary.length, 100); assert.ok(!c.done[0].title.includes("<"), "記号は除く");
  assert.equal(c.done[1].day, 0, "日が数でなければ 0");
  assert.equal(c.threads.length, sr.THREADS_MAX); assert.ok(c.threads.every((t) => t.length <= 60 && t));
  assert.deepEqual(c.joined, { mina: true, lily: true });
  assert.deepEqual(sr.cleanSeries("てきとう"), sr.emptySeries());
  assert.deepEqual(sr.cleanSeries(null), sr.emptySeries());
  const many = sr.cleanSeries({ done: Array.from({ length: 80 }, (_, i) => ({ id: "p" + i, title: "t", summary: "s", ending: "e", day: i })) });
  assert.equal(many.done.length, sr.DONE_MAX); assert.equal(many.done.at(-1).id, "p79", "古いものから捨てる");
  // 部ごとの記録
  const parts = sr.cleanParts({ "p1": { def: { a: 1 }, loc: { kind: "town" }, progress: { chapter: 2 } }, "bad id": { def: {} }, p2: 5, p3: { def: "x", loc: null } });
  assert.deepEqual(Object.keys(parts).sort(), ["p1", "p3"]);
  assert.deepEqual(parts.p3, { def: null, loc: null, progress: {}, story: null });
  const big = {}; for (let i = 0; i < 30; i++) big["p" + i] = { def: {} };
  assert.equal(Object.keys(sr.cleanParts(big)).length, sr.PARTS_MAX);
  // いまの部が、記録に無ければ、無いことにする
  assert.equal(items.migrateSave({ activePart: "p9", parts: {} }).activePart, null);
  const ptm = await import(st.url("parts.js"));
  const mkf = (i) => ({ id: "f" + i, path: "C:\\R\\d" + (i % 4) + "\\f" + i + ".jpg", name: "f" + i + ".jpg", ext: "jpg", size: 1000 + i, modified: 1 });
  const dmod = ptm.buildPart({ files: Array.from({ length: 40 }, (_, i) => mkf(i)), roots: ["C:\\R"], seed: 1, at: 1 });
  const mg = items.migrateSave({ activePart: dmod.id, parts: { [dmod.id]: { def: dmod, progress: { chapter: 2 } } } });
  assert.equal(mg.activePart, dmod.id, "正しい部は 残る"); assert.equal(mg.parts[dmod.id].progress.chapter, 2); assert.ok(mg.parts[dmod.id].story.title, "物語の設計図が なければ つくる");
  assert.equal(items.migrateSave({ activePart: "p1", parts: { p1: { def: {} } } }).activePart, null, "形が合わない部は 捨てる");
  assert.deepEqual(items.migrateSave({ active: [{ id: "q1" }] }).active, [{ id: "q1" }], "依頼の一覧は、触らない");
});
await test("series：部を終えると記録が増え、伏線が入れかわる。次の部には、新しいあらすじ3件だけ渡す", async () => {
  const sr = await import(st.url("series.js"));
  let s = sr.emptySeries();
  for (let i = 1; i <= 5; i++) s = sr.finishPart(s, { id: "p" + i, title: "第" + i + "部", summary: "あらすじ" + i, ending: i % 2 ? "keep" : "release", day: 100 + i }, ["伏線" + i]);
  assert.equal(s.done.length, 5);
  assert.deepEqual(s.threads, ["伏線5"], "伏線は、最新のものに入れかわる");
  const r = sr.recentSummaries(s);
  assert.deepEqual(r.map((x) => x.summary), ["あらすじ3", "あらすじ4", "あらすじ5"]);
  // 同じ部をもう一度終えても、重ならない
  s = sr.finishPart(s, { id: "p5", title: "第5部", summary: "書きなおし", ending: "both", day: 200 }, []);
  assert.equal(s.done.filter((d) => d.id === "p5").length, 1);
  assert.equal(s.done.at(-1).summary, "書きなおし");
  assert.deepEqual(s.threads, []);
  // 壊れた記録を渡しても、落ちない
  assert.equal(sr.finishPart(null, null, "x").done.length, 0);
});

// ---- grid（歩く・カメラ・着けるか）-------------------------------------------------------------
await test("grid: 歩く（1マス歩いて、着いたら知らせる・壁ではね返る・向き）", async () => {
  const g = await import(st.url("grid.js"));
  const w = g.newWalker(5, 5);
  const open = () => true;
  assert.equal(g.stepWalker(w, 0.016, null, open), null, "押していなければ、動かない");
  assert.equal(g.stepWalker(w, 0.016, "right", open), "started");
  assert.deepEqual([w.fx, w.fy, w.tx, w.ty, w.moving, w.face], [5, 5, 6, 5, true, 1]);
  assert.equal(g.stepWalker(w, 0.05, "right", open), null, "歩いている途中は、新しく始めない");
  assert.ok(w.px > 5 && w.px < 6, `途中の位置：${w.px}`);
  assert.equal(g.stepWalker(w, 0.2, null, open), "arrived");
  assert.deepEqual([w.px, w.py, w.moving], [6, 5, false]);
  // 左に歩くと向きが変わる。上下では変わらない
  assert.equal(g.stepWalker(w, 0.016, "left", open), "started"); assert.equal(w.face, -1);
  g.stepWalker(w, 0.3, null, open);
  assert.equal(g.stepWalker(w, 0.016, "down", open), "started"); assert.equal(w.face, -1, "上下では向きを変えない");
  g.stepWalker(w, 0.3, null, open);
  // 壁：入れない。すぐには もう一度ためさない（少し待つ）
  const wall = (x, y) => !(x === w.tx + 1 && y === w.ty);
  assert.equal(g.stepWalker(w, 0.016, "right", wall), "blocked");
  assert.equal(g.stepWalker(w, 0.016, "right", () => true), null, "はね返った直後は、少し待つ");
  assert.equal(g.stepWalker(w, 0.2, "right", () => true), "started");
  // 4方向
  for (const [d, dx, dy] of [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]]) {
    const v = g.newWalker(10, 10);
    assert.equal(g.stepWalker(v, 0.016, d, open), "started");
    assert.deepEqual([v.tx - 10, v.ty - 10], [dx, dy], d);
  }
  // 置きなおす
  g.placeWalker(w, 1, 2);
  assert.deepEqual([w.tx, w.ty, w.px, w.py, w.moving], [1, 2, 1, 2, false]);
  // 1マスの時間：歩きつづけたとき、1秒あたりのマス数
  const v = g.newWalker(0, 0); let steps = 0;
  for (let i = 0; i < 1000; i++) { const r = g.stepWalker(v, 0.01, "right", open); if (r === "arrived") steps++; }
  assert.ok(steps >= 60 && steps <= 80, `10秒（0.01秒きざみ）で歩くマス数：${steps}（1マス 約0.13秒＋はじめの1コマ）`);
});
await test("grid: カメラ（真ん中に・地図のはしではみ出さない・見えるマスの範囲）", async () => {
  const g = await import(st.url("grid.js"));
  const c = g.cameraFor(36, 27, 72, 54, 48, 960, 540);
  assert.equal(c.camX, 36 * 48 + 24 - 480); assert.equal(c.camY, 27 * 48 + 24 - 270);
  assert.ok(c.x0 <= 36 && c.x1 >= 36 && c.y0 <= 27 && c.y1 >= 27);
  const corner = g.cameraFor(0, 0, 72, 54, 48, 960, 540);
  assert.deepEqual([corner.camX, corner.camY, corner.x0, corner.y0], [0, 0, 0, 0], "左上のはしでは、はみ出さない");
  const far = g.cameraFor(71, 53, 72, 54, 48, 960, 540);
  assert.equal(far.camX, 72 * 48 - 960); assert.equal(far.camY, 54 * 48 - 540); assert.equal(far.x1, 72); assert.equal(far.y1, 54 + 0);
  const small = g.cameraFor(3, 3, 10, 8, 48, 960, 540);
  assert.deepEqual([small.camX, small.camY], [0, 0], "地図が画面より小さいときは、動かさない");
});
await test("grid: 歩いて着けるか（歩数・行き止まり・いちばん遠いマス）", async () => {
  const g = await import(st.url("grid.js"));
  // 5×3：真ん中の列に壁（上だけ空いている）。左の下から、右の下へは、上を回る
  const rows = ["..#..", "..#..", "....."];
  const W = 5, H = 3;
  const wallAt = [[2, 0], [2, 1]];
  const passable = (x, y) => !wallAt.some(([a, b]) => a === x && b === y);
  const d = g.reach(W, H, passable, { x: 0, y: 0 });
  assert.equal(d[0], 0); assert.equal(d[2 * W + 0], 2);
  assert.equal(d[0 * W + 4], 8, "壁を回って、右上へ（下を通る）");
  assert.equal(d[0 * W + 2], -1, "壁は着けない");
  assert.deepEqual(g.farthest(d, W), { x: 4, y: 0, d: 8 });
  // 閉じこめられた場所は、着けない
  const sealed = (x, y) => !(x === 1 && y >= 0 && y <= 2);
  const d2 = g.reach(W, H, sealed, { x: 0, y: 0 });
  assert.equal(d2[0 * W + 3], -1); assert.equal(d2.filter((v) => v >= 0).length, 3);
  // 出発点が壁・はみ出しなら、どこにも着けない
  assert.ok(g.reach(W, H, passable, { x: 2, y: 0 }).every((v) => v === -1));
  assert.ok(g.reach(W, H, passable, { x: -1, y: 0 }).every((v) => v === -1));
  assert.equal(g.farthest(new Int32Array(4).fill(-1), 2), null);
  void rows;
});

// ---- dungeon（ダンジョンの階の生成）-----------------------------------------------------------
await test("dungeon: どの型・どの階でも、入口から全部に歩いて着ける（階段・宝箱・泉・ボス）", async () => {
  const dg = await import(st.url("dungeon.js"));
  const gr = await import(st.url("grid.js"));
  const D = dg.D;
  let total = 0, plain = 0;
  for (const style of ["cave", "swamp", "tower", "castle"]) {
    for (let seed = 1; seed <= 25; seed++) for (const floors of [3, 4, 5]) for (let floor = 1; floor <= floors; floor++) {
      const f = dg.buildFloor({ key: `${seed * 7919}:${seed % 5}`, style, floor, floors });
      total++;
      if (f.w === 30) plain++;
      const where = `${style} シード${seed} ${floor}/${floors}階`;
      assert.equal(f.tiles.length, f.w * f.h);
      assert.ok(f.tiles.every((t) => t >= 0 && t <= 8), where);
      assert.deepEqual([f.w, f.h], f.w === 30 ? [30, 14] : dg.SIZES[f.shape], where + " " + f.shape);
      // まわりは壁
      for (let x = 0; x < f.w; x++) assert.ok(f.tiles[x] === D.WALL && f.tiles[(f.h - 1) * f.w + x] === D.WALL, `${where}：上下のはし`);
      for (let y = 0; y < f.h; y++) assert.ok(f.tiles[y * f.w] === D.WALL && f.tiles[y * f.w + f.w - 1] === D.WALL, `${where}：左右のはし`);
      // 入口は上り階段。最後の階は ボス、それ以外は 下り階段
      const count = (v) => f.tiles.filter((t) => t === v).length;
      assert.equal(count(D.UP), 1, where); assert.deepEqual(f.up, f.start); assert.equal(f.tiles[f.start.y * f.w + f.start.x], D.UP);
      if (floor === floors) { assert.equal(count(D.BOSS), 1, where); assert.equal(count(D.DOWN), 0, where); assert.ok(f.boss && !f.down, where); assert.equal(f.tiles[f.boss.y * f.w + f.boss.x], D.BOSS); }
      else { assert.equal(count(D.DOWN), 1, where); assert.equal(count(D.BOSS), 0, where); assert.ok(f.down && !f.boss, where); assert.equal(f.tiles[f.down.y * f.w + f.down.x], D.DOWN); }
      // 宝箱：数・ID・場所
      assert.equal(count(D.CHEST), f.chests.length, where);
      assert.ok(f.chests.length >= 2 && f.chests.length <= 4, `${where}：宝箱 ${f.chests.length}`);
      assert.equal(new Set(f.chests.map((c) => c.id)).size, f.chests.length);
      for (const c of f.chests) { assert.equal(f.tiles[c.y * f.w + c.x], D.CHEST); assert.match(c.id, new RegExp(`^${floor}:\\d$`)); }
      // 泉：最後の階と、途中の偶数階にある
      const wantSpring = floor === floors || floor % 2 === 0;
      assert.equal(!!f.spring, wantSpring, `${where}：泉`);
      assert.equal(count(D.SPRING), f.spring ? 1 : 0, where);
      // 歩いて着ける：入口から、ぜんぶの特別な場所へ。床はぜんぶ、つながっている
      const dist = gr.reach(f.w, f.h, (x, y) => dg.passable(f.tiles[y * f.w + x]), f.start);
      for (const p of [f.down, f.boss, f.spring, ...f.chests].filter(Boolean)) assert.ok(dist[p.y * f.w + p.x] >= 0, `${where}：(${p.x},${p.y}) に着けない`);
      for (let i = 0; i < f.tiles.length; i++) if (dg.passable(f.tiles[i])) assert.ok(dist[i] >= 0, `${where}：つながっていない床 ${f.shape}`);
      assert.ok(f.length >= 22 || f.w === 30, `${where}：奥まで ${f.length}歩`);
    }
  }
  assert.equal(plain, 0, "代わりの部屋（まっすぐな部屋）に なっていない");
  assert.ok(total >= 1000, `${total}階`);
});
await test("dungeon: 同じ種なら同じ形・ちがう種ならちがう形。型ごとの特ちょう（城は左右対称）", async () => {
  const dg = await import(st.url("dungeon.js"));
  const D = dg.D;
  const mk = (key, style = "cave", floor = 1, floors = 3) => dg.buildFloor({ key, style, floor, floors });
  assert.equal(Buffer.from(mk("1:1").tiles).toString("hex"), Buffer.from(mk("1:1").tiles).toString("hex"), "同じ種は同じ形");
  assert.notEqual(Buffer.from(mk("1:1").tiles).toString("hex"), Buffer.from(mk("2:1").tiles).toString("hex"), "ちがう種は ちがう形");
  assert.notEqual(Buffer.from(mk("1:1", "cave", 1).tiles).toString("hex"), Buffer.from(mk("1:1", "cave", 2).tiles).toString("hex"), "階がちがえば ちがう形");
  assert.notEqual(Buffer.from(mk("1:1", "cave").tiles).toString("hex"), Buffer.from(mk("1:1", "tower").tiles).toString("hex"));
  // 城：階段・宝箱などを床とみなして、左右がぴったり対称
  for (let seed = 1; seed <= 15; seed++) {
    const f = mk(`${seed}:0`, "castle", 1, 3);                         // 1階は、そのジャンルらしい形（城は、左右対称）
    assert.equal(f.shape, "castle");
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) assert.equal(dg.passable(f.tiles[y * f.w + x]), dg.passable(f.tiles[y * f.w + (f.w - 1 - x)]), `城 シード${seed} (${x},${y})`);
  }
  // 塔：部屋と廊下。床の割合が、洞窟よりやや少ない・柱（部屋の中の壁）がある
  let pillars = 0;
  for (let seed = 1; seed <= 12; seed++) { const f = mk(`${seed}:3`, "tower"); for (let y = 2; y < f.h - 2; y++) for (let x = 2; x < f.w - 2; x++) if (f.tiles[y * f.w + x] === D.WALL && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => f.tiles[(y + dy) * f.w + x + dx] !== D.WALL)) pillars++; }
  assert.ok(pillars > 10, `柱の数 ${pillars}`);
  // 型と階の数
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(dg.styleFor), ["castle", "cave", "cave", "tower", "swamp", "castle", "cave"]);
  assert.equal(dg.shapeOf("swamp"), "cave"); assert.equal(dg.shapeOf("tower"), "tower");
  const fl = new Set(); for (let s = 0; s < 200; s++) fl.add(dg.floorsFor(`${s}:1`));
  assert.deepEqual([...fl].sort(), [3, 4, 5], "階の数は 3〜5");
  assert.equal(dg.floorsFor("9:2"), dg.floorsFor("9:2"));
  assert.equal(dg.floorLabel("tower", 2), "2階"); assert.equal(dg.floorLabel("cave", 2), "地下2階");
  assert.equal(dg.dungeonKey(77, 3), "77:3");
});
await test("dungeon: 階ごとに形がちがう（ジャンルごとの組み合わせ・1階は そのジャンルらしい形・池と迷路と大広間と回廊が 出る）", async () => {
  const dg = await import(st.url("dungeon.js"));
  const D = dg.D;
  const seen = new Set();
  for (const style of ["cave", "swamp", "tower", "castle"]) {
    for (let seed = 1; seed <= 20; seed++) {
      const key = `${seed * 31}:${seed % 5}`, here = new Set();
      for (let floor = 1; floor <= 5; floor++) {
        const s = dg.shapeFor(style, floor, key);
        assert.ok(dg.SHAPE_POOL[style].includes(s), `${style} ${floor}階 ${s}`);
        if (floor === 1) assert.equal(s, dg.SHAPE_POOL[style][0], "1階は そのジャンルらしい形");
        assert.equal(dg.buildFloor({ key, style, floor, floors: 5 }).shape, s, "つくった形が 選んだ形");
        here.add(s); seen.add(s);
      }
      assert.ok(here.size >= 2, `${style} シード${seed}：5階が ぜんぶ同じ形 ${[...here]}`);
    }
  }
  assert.deepEqual([...seen].sort(), ["castle", "cave", "hall", "lake", "maze", "ring", "tower"], "7つの形が ぜんぶ 出る");
  for (const s of Object.keys(dg.SIZES)) assert.ok(dg.SHAPE_FEEL[s] && !/[（）()]/.test(dg.SHAPE_FEEL[s]), s);
  // 池：水（通れない）がある。水の中に 階段・宝箱は ない。池のまわりを歩いて 全部に 着ける（上の試験）
  let water = 0, floors = 0;
  for (let seed = 1; seed <= 20; seed++) { const f = dg.buildFloor({ key: `${seed}:1`, style: "swamp", floor: 1, floors: 3 }); floors++; const n = f.tiles.filter((t) => t === D.WATER).length; if (n > 15) water++; assert.ok(!dg.passable(D.WATER)); }
  assert.ok(water >= 15, `池の ある階 ${water}/${floors}`);
  // 迷路は 通路がせまく、大広間には 柱（床の中の壁）が ならぶ
  let narrow = 0, pillars = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const m = dg.buildFloor({ key: `${seed}:2`, style: "tower", floor: 1, floors: 3 }); void m;
    const f = dg.buildFloor({ key: `${seed}:4`, style: "castle", floor: 1, floors: 3 }); void f;
  }
  for (let seed = 1; seed <= 40; seed++) {
    for (const style of ["cave", "castle"]) for (let floor = 2; floor <= 5; floor++) {
      const f = dg.buildFloor({ key: `${seed}:0`, style, floor, floors: 5 });
      if (f.shape === "maze") { let one = 0, all = 0; for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) if (dg.passable(f.tiles[y * f.w + x])) { all++; const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => dg.passable(f.tiles[(y + dy) * f.w + x + dx])).length; if (n <= 2) one++; } if (one / all > 0.55) narrow++; }
      if (f.shape === "hall") for (let y = 2; y < f.h - 2; y++) for (let x = 2; x < f.w - 2; x++) if (f.tiles[y * f.w + x] === D.WALL && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => dg.passable(f.tiles[(y + dy) * f.w + x + dx]))) pillars++;
    }
  }
  assert.ok(narrow >= 5, `せまい通路の迷路 ${narrow}`); assert.ok(pillars >= 50, `広間の柱 ${pillars}`);
});
await test("dungeon: 宝箱の中身（ゴールドは かならず・道具と素材は ときどき。ファイルは出ない）", async () => {
  const dg = await import(st.url("dungeon.js"));
  const data = await import(st.url("data.js"));
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const a = dg.chestLoot(seq([0.5, 0.9, 0.9]), { floor: 1, heroLv: 1 });
  assert.equal(a.gold, Math.round(31 * 1.0)); assert.deepEqual(a.items, {}); assert.deepEqual(a.mats, {}, "運が悪ければ、ゴールドだけ");
  const b = dg.chestLoot(seq([0.5, 0.1, 0.0, 0.1, 0.0]), { floor: 1, heroLv: 1 });
  assert.ok(Object.keys(b.items).length === 1 && Object.keys(b.mats).length === 1, JSON.stringify(b));
  // 深い階・高いレベルほど、ゴールドが多い
  const g = (floor, lv) => dg.chestLoot(() => 0.5, { floor, heroLv: lv }).gold;
  assert.ok(g(3, 1) > g(1, 1) && g(1, 20) > g(1, 1));
  // 何千回出しても、道具は表のもの・素材は「良」（_1）だけ・個数は正
  const ids = Object.keys(data.ITEMS);
  for (let i = 0; i < 3000; i++) {
    const r = dg.chestLoot(Math.random, { floor: 1 + (i % 5), heroLv: 1 + (i % 40) });
    assert.ok(r.gold >= 1);
    for (const [k, n] of Object.entries(r.items)) { assert.ok(ids.includes(k) && n >= 1 && n <= 3, k); }
    for (const [k, n] of Object.entries(r.mats)) { assert.match(k, /^(image|video|audio|archive|doc|code|exe|other)_1$/); assert.equal(n, 1); }
  }
});
await test("dungeon: セーブの検査（開けた宝箱・いる場所）", async () => {
  const dg = await import(st.url("dungeon.js"));
  assert.deepEqual(dg.cleanDgState(null), {}); assert.deepEqual(dg.cleanDgState("x"), {}); assert.deepEqual(dg.cleanDgState([1]), {});
  const c = dg.cleanDgState({ "77:3": { opened: ["1:0", "2:1", "bad", 5, "1:00x"] }, "bad key": { opened: [] }, "5:1": 3, "-9:0": { opened: "x" } });
  assert.deepEqual(c, { "77:3": { opened: ["1:0", "2:1"] }, "-9:0": { opened: [] } });
  const many = {}; for (let i = 0; i < 50; i++) many[`${i}:1`] = { opened: [] };
  assert.equal(Object.keys(dg.cleanDgState(many)).length, 30);
  assert.deepEqual(dg.cleanLoc({ kind: "dungeon", ruin: 2, floor: 3, x: 10, y: 20 }), { kind: "dungeon", ruin: 2, floor: 3, x: 10, y: 20 });
  for (const bad of [null, "x", { kind: "town" }, { kind: "dungeon", ruin: -1, floor: 1, x: 1, y: 1 }, { kind: "dungeon", ruin: 1, floor: 0, x: 1, y: 1 }, { kind: "dungeon", ruin: 1, floor: 6, x: 1, y: 1 }, { kind: "dungeon", ruin: 1, floor: 1, x: 99, y: 1 }, { kind: "dungeon", ruin: 1.5, floor: 1, x: 1, y: 1 }]) assert.equal(dg.cleanLoc(bad), null, JSON.stringify(bad));
});

// ---- town（町の地図の生成）--------------------------------------------------------------------
await test("town: どの種・どの町でも、出口から全部のドアと出口に歩いて着ける（人はよけて通る）", async () => {
  const tw = await import(st.url("town.js"));
  const seen = new Set();
  for (let seed = 0; seed < 400; seed++) for (let index = 0; index < 7; index++) {
    const m = tw.buildTown({ seed: seed * 7919 + 13, index });
    seen.add(m.type);
    assert.equal(m.tiles.length, m.w * m.h);
    assert.ok(tw.townOpen(m, m.start.x, m.start.y), "はじまりの場所は 歩ける");
    const dist = tw.townReach(m);
    assert.equal(m.doors.length, 6);
    for (const d of m.doors) {
      assert.equal(m.tiles[d.y * m.w + d.x], tw.TT.DOOR);
      assert.ok(dist[d.y * m.w + d.x] >= 0, `ドア ${d.label} に着けない ${m.key}`);
      assert.ok(tw.townOpen(m, d.x, d.y + 1), "ドアの前は 歩ける");
    }
    assert.ok(m.exits.length >= 1);
    for (const e of m.exits) { assert.equal(m.tiles[e.y * m.w + e.x], tw.TT.EXIT); assert.ok(dist[e.y * m.w + e.x] >= 0, `出口に着けない ${m.key}`); assert.equal(e.y, m.h - 1, "出口は いちばん南"); }
    assert.equal(m.folk.length, 3);
    for (const f of m.folk) {
      assert.ok(tw.townPassable(m.tiles[f.y * m.w + f.x]), "人は 歩ける場所に立つ（壁に埋まらない）");
      assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => dist[(f.y + dy) * m.w + f.x + dx] >= 0), "人の となりまで 歩いて着ける");
    }
  }
  assert.deepEqual([...seen].sort(), ["harbor", "plaza", "ring", "river"], "4つの型が 出る");
});
await test("town: 建物は6つが1つずつ・重ならない。同じ島の町は 型が重ならない。同じ入力なら同じ町", async () => {
  const tw = await import(st.url("town.js"));
  const kinds = tw.BUILDINGS.map((b) => b.kind).sort();
  for (let seed = 1; seed < 80; seed++) for (let index = 0; index < 4; index++) {
    const m = tw.buildTown({ seed, index });
    assert.deepEqual(m.doors.map((d) => d.kind).sort(), kinds, "宿屋・道具屋・鍛冶屋・依頼所・回収所・酒場が 1つずつ");
    let roof = 0, wall = 0, door = 0;
    for (const t of m.tiles) { if (t === tw.TT.ROOF) roof++; else if (t === tw.TT.WALL) wall++; else if (t === tw.TT.DOOR) door++; }
    assert.equal(roof, 36); assert.equal(wall, 12); assert.equal(door, 6);
    const a = tw.buildTown({ seed, index });
    assert.deepEqual([...a.tiles], [...m.tiles]); assert.deepEqual(a.doors, m.doors); assert.deepEqual(a.folk, m.folk);
  }
  for (let seed = 0; seed < 50; seed++) assert.equal(new Set([0, 1, 2, 3].map((i) => tw.buildTown({ seed, index: i }).type)).size, 4, "4つまでは 型が重ならない");
  // 島がちがえば、町もちがう（建物の並び・人の名前・木の置き方）
  const sig = (m) => m.doors.map((d) => d.kind).join() + m.folk.map((f) => f.name).join() + m.tiles.join("").slice(0, 400);
  assert.ok(new Set(Array.from({ length: 30 }, (_, s) => sig(tw.buildTown({ seed: s, index: 0 })))).size > 20);
});
await test("town: 町の人の名前は町の中で重ならない。話は 空でなく、（）を使わず、1ページが長すぎない", async () => {
  const tw = await import(st.url("town.js"));
  for (let seed = 0; seed < 60; seed++) {
    const m = tw.buildTown({ seed, index: 1 });
    assert.equal(new Set(m.folk.map((f) => f.name)).size, 3);
    assert.deepEqual(m.folk.map((f) => f.role), ["guide", "collector", "rumor"]);
    const hm = await import(st.url("hero.js"));
    for (const f of m.folk) assert.equal(hm.cleanLook(f.look).join(), f.look.join(), "人の見た目は 正しい番号");
  }
  const ctxs = [{ town: "ホコリ港", root: "Downloads", pending: 0, pool: 0, ruins: 0, cleared: 0 }, { town: "はじまりの町", root: "古い写真", pending: 7, pool: 120, ruins: 5, cleared: 2 }, {}];
  for (const ctx of ctxs) for (const role of tw.FOLK_ROLES) for (let n = 0; n < 12; n++) {
    const pages = tw.folkLines(role, ctx, n);
    assert.ok(Array.isArray(pages) && pages.length >= 1);
    for (const p of pages) { assert.ok(p.length >= 4 && p.length <= 90, p); assert.ok(!/[（）()]/.test(p), "（）の注釈を入れない: " + p); }
  }
  assert.ok(tw.folkLines("collector", { pending: 7 }, 0)[0].includes("7体"), "回収待ちの数が 話に出る");
  assert.ok(tw.folkLines("rumor", { pool: 120, root: "Downloads" }, 0)[0].includes("120体"));
  assert.ok(tw.folkLines("rumor", { ruins: 5, cleared: 2 }, 1)[0].includes("5か所") && tw.folkLines("rumor", { ruins: 5, cleared: 2 }, 1)[0].includes("2か所"));
  assert.notEqual(tw.folkLines("guide", {}, 0)[0], tw.folkLines("guide", {}, 1)[0], "話しかけるたびに 話が変わる");
});

// ---- parts（部の生成）-------------------------------------------------------------------------
const MB = 1024 * 1024;
function fakeFiles(seed, { n, folders, cats = ["jpg", "mp4", "docx", "zip", "js", "mp3", "exe", "tmp"], same = false, sizes = "mixed", giant = false }) {
  const r = (() => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const out = [];
  for (let i = 0; i < n; i++) {
    const folder = same ? "all" : `dir${Math.floor(r() * folders)}`;
    const ext = cats[Math.floor(r() * cats.length)];
    const size = sizes === "equal" ? 3 * MB : sizes === "small" ? Math.floor(r() * 1 * MB) + 1024 : r() < 0.08 ? Math.floor(r() * 300 * MB) + 20 * MB : Math.floor(r() * 15 * MB) + 1024;
    out.push({ id: `id${seed}_${i}`, path: `C:\\Root\\${folder}\\file${i}.${ext}`, name: `file${i}.${ext}`, ext, size: giant && i === 0 ? 900 * MB : size, modified: 1500000000000 + i * 86400000 });
  }
  return out;
}
const SHAPES = [
  { n: 100, folders: 5 }, { n: 100, folders: 1 }, { n: 60, folders: 1, cats: ["jpg"] }, { n: 60, folders: 1, cats: ["jpg"], sizes: "equal" }, { n: 60, folders: 12 },
  { n: 30, folders: 30 }, { n: 31, folders: 1, giant: true }, { n: 600, folders: 20 }, { n: 600, folders: 1 }, { n: 30, folders: 3 }, { n: 30, folders: 2 },
  { n: 45, folders: 9, sizes: "small" }, { n: 200, folders: 60 }, { n: 300, folders: 2, cats: ["docx", "zip"] },
];
await test("parts: どんな形のフォルダでも、章は3〜7・全部のファイルがちょうど1つの章に入る・全部の章にボスがいる", async () => {
  const pt = await import(st.url("parts.js"));
  const data = await import(st.url("data.js"));
  let k = 0;
  for (const shape of SHAPES) for (let seed = 1; seed <= 6; seed++, k++) {
    const files = fakeFiles(seed * 31 + k, shape);
    const def = pt.buildPart({ files, roots: ["C:\\Root"], seed: seed * 7, at: 1700000000000 });
    const tag = JSON.stringify(shape) + " seed" + seed;
    assert.ok(def, tag);
    const K = def.chapters.length;
    assert.ok(K >= 3 && K <= 7, `章の数 ${K} ${tag}`);
    // 全部のファイルが、ちょうど1つの章に入る
    let total = 0;
    for (const f of files) {
      const hits = def.chapters.filter((c) => c.rules.some((r) => pt.matchRule(r, f)));
      assert.equal(hits.length, 1, `${f.path} が ${hits.length} 個の章に ${tag}`);
    }
    for (const c of def.chapters) {
      const mine = pt.chapterFiles(def, files, c.n);
      assert.equal(mine.length, c.count, `章${c.n}の数 ${tag}`);
      assert.ok(c.count >= 1);
      total += c.count;
      assert.ok(c.bosses.length >= 1 && c.bosses.length <= 3, `ボスの数 ${c.bosses.length}`);
      for (const b of c.bosses) assert.equal(pt.chapterOf(def, b), c.n, "ボスは、その章のファイル");
      const big = mine.filter((f) => f.size >= data.BOSS_BYTES).length;
      if (big === 0) assert.equal(c.bosses.length, 1, "20MB以上が無い章は、いちばん大きいものが1体");
      else assert.equal(c.bosses.length, Math.min(3, big));
      for (let i = 1; i < c.bosses.length; i++) assert.ok(c.bosses[i].size >= c.bosses[i - 1].size, "深い階ほど大きい");
      assert.ok(c.floors >= 3 && c.floors <= 5);
      assert.ok(["cave", "tower", "castle", "swamp"].includes(c.style));
      assert.ok(c.name.length >= 1 && !/[（）()]/.test(c.name + c.ruinName + c.town), "名前に（）を入れない");
      assert.equal(c.bosses[c.bosses.length - 1].size, Math.max(...mine.map((f) => f.size)), "いちばん大きいファイルが、その章の最後のボス");
    }
    assert.equal(total, files.length);
    // ぬし：部全体でいちばん大きなファイルが、最終章の最後のボス
    const maxSize = Math.max(...files.map((f) => f.size));
    assert.equal(def.nushi.size, maxSize);
    const last = def.chapters[K - 1];
    assert.equal(last.bosses[last.bosses.length - 1].path, def.nushi.path, `ぬしが最終章の最後 ${tag}`);
    // 章は、やさしい順（最大のファイルが小さい順）
    for (let i = 1; i < K; i++) assert.ok(def.chapters[i].bosses.at(-1).size >= def.chapters[i - 1].bosses.at(-1).size, "章は だんだん強い");
    // 島：町と遺跡は章の数。名前は重ならない
    assert.equal(def.island.towns, K); assert.equal(def.island.ruins, K);
    assert.equal(new Set(def.island.townNames).size, K); assert.equal(new Set(def.island.ruinNames).size, K);
    assert.match(def.id, /^[A-Za-z0-9_.:-]{1,60}$/);
    assert.ok(JSON.stringify(def).length < 24000, "保存する大きさ " + JSON.stringify(def).length);
  }
});
await test("parts: 同じ入力なら同じ部。冒険の地・種が変われば、別の部（id・町の名前）", async () => {
  const pt = await import(st.url("parts.js"));
  const files = fakeFiles(5, { n: 120, folders: 8 });
  const a = pt.buildPart({ files, roots: ["C:\\Root"], seed: 11, at: 5 }), b = pt.buildPart({ files: files.slice().reverse(), roots: ["C:\\Root"], seed: 11, at: 5 });
  assert.deepEqual(a, b, "並び順がちがっても 同じ部");
  const c = pt.buildPart({ files, roots: ["C:\\Other"], seed: 11, at: 5 }), d = pt.buildPart({ files, roots: ["C:\\Root"], seed: 12, at: 5 });
  assert.notEqual(c.id, a.id); assert.notEqual(d.id, a.id);
  assert.equal(pt.buildPart({ files: files.slice(0, 2), roots: [], seed: 1, at: 1 }), null, "3つに満たなければ つくらない");
  // 凍結した部は、ファイルが増えても、前のファイルの章は変わらない
  const more = files.concat(fakeFiles(99, { n: 10, folders: 8 }).map((f, i) => ({ ...f, id: "new" + i, path: f.path.replace("file", "new") })));
  for (const f of files) assert.equal(pt.chapterOf(a, f), pt.chapterOf(a, more.find((x) => x.id === f.id)));
});
await test("parts: 見込み（章の数）が、実際につくった部と合う。小さい群れは近い群れに合わさる", async () => {
  const pt = await import(st.url("parts.js"));
  const dis = await import(st.url("discover.js"));
  let k = 0;
  for (const shape of SHAPES) for (let seed = 1; seed <= 4; seed++, k++) {
    const files = fakeFiles(seed * 13 + k, shape);
    const agg = dis.aggregate(files, "C:\\Root");
    const o = pt.outlookFromAgg(agg, "C:\\Root");
    const def = pt.buildPart({ files, roots: ["C:\\Root"], seed: 1, at: 1 });
    assert.equal(o.chapters, def.chapters.length, `${JSON.stringify(shape)} 見込み ${o.chapters} 実際 ${def.chapters.length}`);
    assert.ok(o.bosses >= o.chapters && o.bosses <= o.chapters * 3);
    assert.equal(o.minutes, o.chapters * 20);
  }
  // 小さい群れ（2〜3個）は、章にならず、近い群れに入る
  const files = [];
  for (let i = 0; i < 30; i++) files.push({ id: "a" + i, path: `C:\\R\\A\\f${i}.jpg`, name: `f${i}.jpg`, ext: "jpg", size: MB + i, modified: 1 });
  for (let i = 0; i < 30; i++) files.push({ id: "b" + i, path: `C:\\R\\B\\f${i}.mp4`, name: `f${i}.mp4`, ext: "mp4", size: 2 * MB + i, modified: 1 });
  for (let i = 0; i < 30; i++) files.push({ id: "c" + i, path: `C:\\R\\C\\f${i}.zip`, name: `f${i}.zip`, ext: "zip", size: 3 * MB + i, modified: 1 });
  files.push({ id: "t1", path: "C:\\R\\A\\tiny\\x.txt", name: "x.txt", ext: "txt", size: 5, modified: 1 }, { id: "t2", path: "C:\\R\\Z\\y.txt", name: "y.txt", ext: "txt", size: 5, modified: 1 });
  const def = pt.buildPart({ files, roots: ["C:\\R"], seed: 1, at: 1 });
  assert.equal(def.chapters.length, 3, "大きい3つが章。小さい2つは合わさる");
  assert.equal(pt.chapterOf(def, files.find((f) => f.id === "t1")), pt.chapterOf(def, files.find((f) => f.id === "a1")), "近い場所（A）の群れに入る");
});
await test("parts: 画面に出す文（見込み・名前・ダンジョンの型）", async () => {
  const pt = await import(st.url("parts.js"));
  assert.equal(pt.fmtMinutes(60), "1時間"); assert.equal(pt.fmtMinutes(80), "1時間20分"); assert.equal(pt.fmtMinutes(45), "45分"); assert.equal(pt.fmtMinutes(140), "2時間20分");
  assert.equal(pt.outlookText({ chapters: 3, bosses: 4, minutes: 60 }), "3章　ボス4体　およそ1時間");
  assert.equal(pt.cleanName("Screenshots"), "Screenshots"); assert.equal(pt.cleanName("写真 (2023)"), "写真 2023"); assert.equal(pt.cleanName("###___!!!"), ""); assert.equal(pt.cleanName("あ".repeat(30)).length, 12);
  assert.ok(!/[<>]/.test(pt.cleanName("<b>x</b>")), "HTMLの記号は 除く");
  // 型：画像→洞窟、書類→塔、コード→城、音楽→沼
  const mk = (ext) => Array.from({ length: 40 }, (_, i) => ({ id: ext + i, path: `C:\\R\\d${i % 3}\\f${i}.${ext}`, name: `f${i}.${ext}`, ext, size: MB * (1 + i), modified: 1 }));
  const style = (ext) => pt.buildPart({ files: mk(ext), roots: ["C:\\R"], seed: 1, at: 1 }).chapters[0].style;
  assert.equal(style("jpg"), "cave"); assert.equal(style("docx"), "tower"); assert.equal(style("js"), "castle"); assert.equal(style("mp3"), "swamp");
  const def = pt.buildPart({ files: mk("jpg"), roots: ["C:\\R"], seed: 1, at: 1 });
  assert.ok(def.chapters.every((c) => c.ruinName === c.name + "の洞窟"), def.chapters.map((c) => c.ruinName).join());
  assert.equal(pt.outlookOfPart(def).chapters, def.chapters.length);
});
await test("parts: まぼろし（ファイルではない敵）", async () => {
  const pt = await import(st.url("parts.js"));
  for (const cat of ["image", "video", "audio", "archive", "doc", "code", "exe", "other", "unknown"]) {
    const ph = pt.phantomFor(cat, 5 * MB, () => 0.5);
    assert.equal(ph.phantom, true); assert.equal(ph.path, ""); assert.equal(ph.id, ""); assert.ok(ph.name.length >= 2 && ph.size === 5 * MB && ph.ext);
    assert.ok(!/[（）()]/.test(ph.name));
  }
  assert.equal(pt.phantomFor("image", 10, () => 0).size, 1024, "小さすぎない");
  assert.ok(pt.PHANTOM_EXP_RATE > 0 && pt.PHANTOM_EXP_RATE < 1);
});

// ---- story（物語の設計図）---------------------------------------------------------------------
const BAD_CHARS = /[（）()<>&"`\\]/;
function checkStory(st, def, tag) {
  assert.equal(st.v, 1);
  assert.ok(st.title.length >= 3 && st.title.length <= 24, tag + " 題名 " + st.title);
  assert.ok(st.intro.length >= 2 && st.intro.every((p) => p.length >= 8 && p.length <= 100), tag + " 序");
  assert.equal(st.chapters.length, def.chapters.length, tag + " 章の数");
  for (const c of st.chapters) {
    assert.ok(c.tale.length >= 2 && c.tale.length <= 4 && c.tale.every((p) => p.length >= 8 && p.length <= 84), tag + " 小さな物語 " + c.tale.map((p) => p.length));
    assert.ok(c.clue.length >= 6 && c.clue.length <= 60, tag + " 手がかり");
    assert.ok(c.folk.length >= 1 && c.folk.every((p) => p.length >= 6 && p.length <= 84));
    assert.ok(c.troubles.length >= 1 && c.troubles.every((p) => p.length >= 6 && p.length <= 60));
    assert.equal(typeof c.cleaner, "boolean");
    assert.ok(["序", "展", "転", "結"].includes(c.act));
  }
  for (const k of ["keep", "release", "both"]) assert.ok(st.endings[k].length >= 10 && st.endings[k].length <= 120, tag + " 結末 " + k);
  assert.ok(st.hook.length >= 8 && st.hook.length <= 60);
  assert.ok(st.nushi.name && st.nushi.motive && st.nushi.twist);
  const walk = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(walk) : v && typeof v === "object" ? Object.values(v).flatMap(walk) : []);
  for (const s of walk(st)) assert.ok(!BAD_CHARS.test(s), tag + " 記号 " + s);
}
await test("story: どんな部でも、テンプレートの設計図が 同じ形で できる（章の数・文字数・記号）", async () => {
  const pt = await import(st.url("parts.js"));
  const sy = await import(st.url("story.js"));
  let k = 0;
  const kinds = new Set(), acts = new Set();
  for (const shape of SHAPES) for (let seed = 1; seed <= 4; seed++, k++) {
    const files = fakeFiles(seed * 17 + k, shape);
    const def = pt.buildPart({ files, roots: ["C:\\Users\\me\\写真 (旧)"], seed, at: 1 });
    const story = sy.buildStory(def);
    checkStory(story, def, JSON.stringify(shape));
    assert.equal(story.by, "template");
    assert.deepEqual(sy.buildStory(def), story, "同じ部は 同じ物語");
    kinds.add(story.nushi.type); story.chapters.forEach((c) => acts.add(c.act));
    assert.equal(story.chapters[story.chapters.length - 1].act, "結", "最終章は 結");
    assert.equal(story.chapters[0].act, "序", "最初の章は 序");
  }
  assert.deepEqual([...acts].sort(), ["序", "展", "結", "転"].sort(), "4幕が そろう");
  assert.ok(kinds.size >= 3, "ぬしの型が 部によって ちがう");
  // 前の部があれば、序に 触れる
  const def = pt.buildPart({ files: fakeFiles(3, SHAPES[0]), roots: ["C:\\R"], seed: 1, at: 1 });
  const s2 = sy.buildStory(def, { prev: [{ title: "ほこり降る 写真", summary: "x", ending: "整理の達人" }] });
  assert.ok(s2.intro.length === 3 && s2.intro[2].includes("ほこり降る 写真"));
  checkStory(s2, def, "prev");
});
await test("story: ぬしの正体の型（名前・種類から）・伏せ字・かけら・結末・あらすじ", async () => {
  const sy = await import(st.url("story.js"));
  const ref = (name, ext = "bin", size = 50 * MB, modified = Date.UTC(2019, 2, 5)) => ({ name, ext, size, modified });
  const t = (n, e) => sy.nushiType(ref(n, e)).id;
  assert.equal(t("企画書_最終_v3.docx", "docx"), "deadline"); assert.equal(t("写真のコピー.png", "png"), "twin"); assert.equal(t("無題.txt", "txt"), "nameless");
  assert.equal(t("IMG_0042.jpg", "jpg"), "photo"); assert.equal(t("backup_2018.zip", "zip"), "backup"); assert.equal(t("旅行.mp4", "mp4"), "movie");
  assert.equal(t("data.zip", "zip"), "archive"); assert.equal(t("memo.docx", "docx"), "doc"); assert.equal(t("tool.js", "js"), "code"); assert.equal(t("setup.exe", "exe"), "exe");
  assert.equal(t("song.mp3", "mp3"), "audio"); assert.equal(t("xyz.qq", "qq"), "other");
  assert.equal(sy.maskedName("写真の亡霊", 0), "■■■■■"); assert.equal(sy.maskedName("写真の亡霊", 2), "写真■■■"); assert.equal(sy.maskedName("写真の亡霊", 99), "写真の亡霊");
  assert.equal(sy.maskedName("a.txt", 0), "■");
  // かけらが たまると、少しずつ 読める。全部たまれば、ぜんぶ
  const seq = [0, 1, 2, 3, 4].map((g) => sy.revealedChars("写真の亡霊", g, 4));
  assert.ok(seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq[0] === 0 && seq[4] === 99, seq.join());
  assert.equal(sy.revealedChars("x", 0, 0), 0);
  // かけら：実際の記録から
  const f = sy.fragmentFor({ name: "a.mp4", ext: "mp4", size: 3 * 1024 * MB, modified: Date.UTC(2015, 6, 1) }, Date.UTC(2026, 9, 1));
  assert.ok(f.includes("2015年7月") && f.includes("動画") && f.includes("GB") && f.includes("11年"), f);
  assert.ok(!BAD_CHARS.test(f) && f.length <= 90);
  assert.ok(sy.fragmentFor({ name: "a", ext: "x", size: 1, modified: 0 }).includes("いつか"), "日付が分からないとき");
  // 結末
  const story = { endings: { keep: "K", release: "R", both: "B" }, place: "写真", nushi: { name: "写真の亡霊" } };
  assert.equal(sy.endingFor(story, { choice: "keep", bosses: 4, spared: 3 }).title, "思い出の守り手");
  assert.equal(sy.endingFor(story, { choice: "keep", bosses: 4, spared: 0 }).title, "ちょうどいい人");
  assert.equal(sy.endingFor(story, { choice: "release", bosses: 4, spared: 0 }).title, "整理の達人");
  assert.equal(sy.endingFor(story, { choice: "release", bosses: 4, spared: 2 }).title, "ちょうどいい人");
  assert.equal(sy.endingFor(story, { choice: "keep", bosses: 4, spared: 3 }).text, "K");
  const sm = sy.summaryFor(story, { title: "整理の達人" });
  assert.ok(sm.length <= 100 && sm.includes("写真") && sm.includes("整理の達人") && !BAD_CHARS.test(sm), sm);
});
await test("story: AIの返事は検査して 重ねる（壊れた返事・長すぎる・範囲外・記号は、テンプレートのまま）", async () => {
  const pt = await import(st.url("parts.js"));
  const sy = await import(st.url("story.js"));
  const def = pt.buildPart({ files: fakeFiles(8, { n: 120, folders: 6 }), roots: ["C:\\R"], seed: 3, at: 1 });
  const base = sy.buildStory(def);
  const K = def.chapters.length;
  // 壊れた返事は、そのまま テンプレート
  for (const bad of [null, undefined, "x", 5, [], [1, 2], {}, { chapters: "x" }, { title: 5, intro: "a", chapters: [null, 1, "x"] }]) {
    const out = sy.validateStory(bad, base);
    assert.deepEqual(out, base, JSON.stringify(bad));
  }
  // 良い返事：題・序・章ごとの文・結末・引きが、入れかわる。章の数は変わらない
  const good = {
    title: "ホコリの 国の ひみつ", intro: ["はじまりの 一文です。ここに ほこりが 降る。", "つづきの 一文です。ぬしの うわさが ある。"],
    nushi: { motive: "ずっと ひとりで 待っていた", twist: "じつは 手紙を 渡したかった" },
    chapters: Array.from({ length: K + 5 }, (_, i) => ({ tale: [`章${i + 1}の 一つめの ページです。`, `章${i + 1}の 二つめの ページです。`, "三つめの ページです。"], clue: `手がかり${i + 1}の ことばです。`, folk: `町の人の ひとこと${i + 1}です。`, troubles: [`困りごと${i + 1}の 文です。`] })),
    cleaner: [1, 2, 99, -1, "x", 1.5], endings: { keep: "守った 結末の 文章です。ありがとう。", release: "手放した 結末の 文章です。さようなら。", both: "ほどよい 結末の 文章です。" }, hook: "つぎの 町で また ほこりが 降る。",
  };
  const out = sy.validateStory(good, base);
  assert.equal(out.by, "ai"); assert.equal(out.title, good.title); assert.equal(out.chapters.length, K, "章の数は 変えられない");
  assert.equal(out.chapters[0].tale[0], "章1の 一つめの ページです。"); assert.equal(out.chapters[K - 1].clue, `手がかり${K}の ことばです。`);
  assert.deepEqual(out.chapters.map((c) => c.cleaner), out.chapters.map((_, i) => i < 2), "そうじ屋の章は 範囲の中の整数だけ");
  assert.equal(out.endings.keep, good.endings.keep); assert.equal(out.hook, good.hook);
  assert.equal(out.nushi.type, base.nushi.type, "ぬしの型・名前は ルールが決める"); assert.equal(out.nushi.name, base.nushi.name);
  checkStory(out, def, "ai");
  // 長すぎる・記号・HTML：切って 除く
  const evil = { title: "<script>alert(1)</script>" + "あ".repeat(60), intro: ["（注釈）です。" + "い".repeat(300), "<b>太字</b>" + "う".repeat(30)], chapters: [{ tale: ["x".repeat(500), "ok です。".repeat(5)], clue: "`code`" + "え".repeat(100) }], hook: "お".repeat(200) };
  const o2 = sy.validateStory(evil, base);
  checkStory(o2, def, "evil");
  assert.ok(o2.title.length <= 24 && o2.hook.length <= 60);
  // 数・進行は AI が決められない：返事に何が入っていても、章の構造は 元のまま
  const o3 = sy.validateStory({ chapters: [{ bosses: 99, reward: 9999, floors: 50, n: 77, tale: ["一つめの ページです。", "二つめの ページです。"] }], rules: [], count: 5 }, base);
  assert.deepEqual(Object.keys(o3.chapters[0]).sort(), Object.keys(base.chapters[0]).sort()); assert.ok(!("rules" in o3) && !("count" in o3));
});
await test("story: AIに渡す材料（ファイルの中身・場所は渡さない。フォルダ名は 許されたときだけ）", async () => {
  const pt = await import(st.url("parts.js"));
  const sy = await import(st.url("story.js"));
  const def = pt.buildPart({ files: fakeFiles(2, { n: 80, folders: 5 }), roots: ["C:\\Users\\taro\\秘密のフォルダ"], seed: 2, at: 1 });
  const a = sy.aiBrief(def, { heroName: "テスター", heroLv: 7, allowFolder: false });
  const text = JSON.stringify(a);
  assert.ok(!text.includes("taro") && !text.includes("C:") && !text.includes("秘密のフォルダ") && !text.includes("dir"), "場所は 渡さない: " + text.slice(0, 200));
  assert.equal(a.chapters.length, def.chapters.length); assert.ok(a.chapters.every((c) => c.boss.length >= 1));
  assert.ok(sy.aiBrief(def, { allowFolder: true }).place.includes("秘密のフォルダ"));
  assert.equal(sy.aiBrief(def, { prev: [1, 2, 3, 4, 5].map((i) => ({ title: "t" + i, summary: "s", ending: "e" })), threads: ["a", "b", "c", "d", "e", "f", "g"] }).previous.length, 3);
  assert.equal(sy.aiBrief(def, { threads: ["a", "b", "c", "d", "e", "f", "g"] }).threads.length, 5);
});

// ---- campaign（部の進み方のルール）-------------------------------------------------------------
await test("campaign: ボスは深い階から順に置く・最後の階は最大のボス・階段を守るのは最後の階以外", async () => {
  const pt = await import(st.url("parts.js"));
  const cp = await import(st.url("campaign.js"));
  let k = 0;
  for (const shape of SHAPES) for (let seed = 1; seed <= 3; seed++, k++) {
    const def = pt.buildPart({ files: fakeFiles(seed * 5 + k, shape), roots: ["C:\\R"], seed, at: 1 });
    for (const c of def.chapters) {
      const b = c.bosses.length, F = c.floors;
      const at = Array.from({ length: F }, (_, f) => cp.bossIndexAt(def, c.n, f + 1));
      assert.equal(at[F - 1], b - 1, "最後の階に いちばん大きい（最後の）ボス");
      assert.deepEqual(at.filter((i) => i >= 0), Array.from({ length: b }, (_, i) => i), "ボスは 小さいほうから 深いほうへ、1体ずつ");
      assert.equal(at.slice(0, F - b).every((i) => i === -1), true, "浅い階には ボスがいない");
      const pr = cp.newProgress();
      for (let f = 1; f <= F; f++) assert.equal(cp.guardedFloor(def, pr, c.n, f), f < F && cp.bossIndexAt(def, c.n, f) >= 0, "階段を守るのは、最後の階以外のボスの階");
    }
  }
});
await test("campaign: ボスを倒すと、かけら・章の完了・封印が解ける・ぬしを倒すと部が終わる（同じボスは2回数えない）", async () => {
  const pt = await import(st.url("parts.js"));
  const cp = await import(st.url("campaign.js"));
  const def = pt.buildPart({ files: fakeFiles(9, { n: 200, folders: 9 }), roots: ["C:\\R"], seed: 4, at: 1 });
  const K = def.chapters.length, pr = cp.newProgress();
  assert.equal(pr.chapter, 1); assert.ok(cp.chapterOpen(pr, 1) && !cp.chapterOpen(pr, 2));
  let frags = 0, opens = [];
  for (const c of def.chapters) {
    assert.ok(cp.chapterOpen(pr, c.n), `章${c.n}が ひらいている`);
    if (c.n < K) assert.ok(!cp.chapterOpen(pr, c.n + 1), "次の章は まだ とじている");
    c.bosses.forEach((_, i) => {
      const r = cp.beatBoss(def, pr, c.n, i, "かけら" + c.n + i);
      assert.ok(r.ok);
      assert.equal(r.nushi, c.n === K && i === c.bosses.length - 1);
      assert.equal(!!r.frag, !r.nushi); if (r.frag) frags++;
      const last = i === c.bosses.length - 1;
      assert.equal(r.chapterDone, last);
      assert.equal(r.partDone, last && c.n === K);
      if (r.opened) opens.push(r.opened);
      assert.deepEqual(cp.beatBoss(def, pr, c.n, i, "again"), { ok: false, again: true }, "2回は 数えない");
    });
    assert.ok(cp.chapterCleared(def, pr, c.n));
  }
  assert.deepEqual(opens, Array.from({ length: K - 1 }, (_, i) => i + 2), "章が終わるたびに 次の章が ひらく");
  assert.equal(frags, cp.fragTotal(def)); assert.equal(cp.fragCount(pr), cp.fragTotal(def), "かけらは ぬし以外の ボスの数");
  assert.equal(cp.bossTotal(def), def.chapters.reduce((s, c) => s + c.bosses.length, 0));
  assert.deepEqual(cp.beatBoss(def, pr, 99, 0), { ok: false }); assert.deepEqual(cp.beatBoss(def, pr, 1, 9), { ok: false });
  cp.finish(pr, "keep", "思い出の守り手");
  assert.equal(pr.done, true); assert.equal(pr.choice, "keep"); assert.equal(pr.ending, "思い出の守り手");
  cp.finish(pr, "bad", "x".repeat(30));
  assert.equal(pr.choice, "release"); assert.equal(pr.ending.length, 12);
});
await test("campaign: 保存した記録は 信用しない（範囲外・型ちがいは直す。部の形が合わないものは捨てる）", async () => {
  const pt = await import(st.url("parts.js"));
  const cp = await import(st.url("campaign.js"));
  const def = pt.buildPart({ files: fakeFiles(3, { n: 150, folders: 8 }), roots: ["C:\\R"], seed: 2, at: 1 });
  const K = def.chapters.length;
  for (const bad of [null, undefined, "x", 5, [], {}, { chapter: "2", beaten: 3 }, { chapter: 999, beaten: { 1: "x", 2: [true] }, frags: [1, null, { n: 99 }], told: [], done: "yes" }]) {
    const o = cp.cleanProgress(bad, def);
    assert.ok(o.chapter >= 1 && o.chapter <= K); assert.equal(typeof o.done, "boolean"); assert.ok(Array.isArray(o.frags));
    for (const n of Object.keys(o.beaten)) assert.equal(o.beaten[n].length, def.chapters[n - 1].bosses.length);
  }
  const o = cp.cleanProgress({ chapter: 2, beaten: { 1: def.chapters[0].bosses.map(() => true), 2: [true] }, frags: [{ n: 1, i: 0, text: "<b>かけら</b>" + "あ".repeat(200) }], told: { 1: true, 2: "yes" }, choice: "keep", ending: "整理の達人", done: false }, def);
  assert.equal(o.chapter, 2); assert.deepEqual(o.beaten[1], def.chapters[0].bosses.map(() => true));
  assert.equal(o.beaten[2].length, def.chapters[1].bosses.length); assert.equal(o.beaten[2][0], true);
  assert.ok(o.frags[0].text.length <= 100 && !o.frags[0].text.includes("<")); assert.deepEqual(o.told, { 1: true });
  assert.equal(cp.cleanProgress({ done: true, chapter: 1 }, def).chapter, K, "終えた部は 最後の章");
  assert.equal(cp.cleanProgress({ chapter: 2 }, null).chapter, 1);
  // 部の形の検査
  assert.ok(pt.cleanDef(JSON.parse(JSON.stringify(def))));
  for (const bad of [null, "x", {}, { ...def, id: "bad id!" }, { ...def, chapters: [] }, { ...def, nushi: null }, { ...def, island: { ...def.island, towns: 99 } },
    { ...def, chapters: def.chapters.map((c, i) => (i === 0 ? { ...c, floors: 99 } : c)) }, { ...def, chapters: def.chapters.map((c, i) => (i === 0 ? { ...c, style: "lava" } : c)) },
    { ...def, chapters: def.chapters.map((c, i) => (i === 0 ? { ...c, bosses: [] } : c)) }, { ...def, chapters: def.chapters.map((c, i) => (i === 0 ? { ...c, bosses: [{ name: 5 }] } : c)) },
    { ...def, island: { ...def.island, townNames: ["a"] } }]) assert.equal(pt.cleanDef(bad), null, JSON.stringify(bad).slice(0, 80));
});

await test("town: 町の人が、部の物語（小さな物語・手がかり・目的地・ぬしの名前）を話す", async () => {
  const tw = await import(st.url("town.js"));
  const story = { tale: ["はじめの ページです。ほこりが 降る。", "つぎの ページです。かげが 歩く。", "さいごの ページです。ぬしの うわさ。"], clue: "ぬしは 昔の 夜に 生まれたらしい。", folk: ["町の人の ひとことです。ゆっくり 休もう。"], goal: "次は 洞窟。ボスは「a.mp4」らしい。", nushi: "ぬしの 名前は「写■■■」らしい。" };
  const ctx = { town: "ホコリ港", pending: 0, pool: 5, ruins: 3, cleared: 0, story };
  assert.deepEqual(tw.folkLines("rumor", ctx, 0), story.tale); assert.deepEqual(tw.folkLines("rumor", ctx, 1), [story.clue]); assert.deepEqual(tw.folkLines("rumor", ctx, 2), story.folk);
  assert.ok(tw.folkLines("rumor", ctx, 3).length >= 1, "4回目は ふつうのうわさ");
  assert.deepEqual(tw.folkLines("guide", ctx, 0), [story.goal]); assert.deepEqual(tw.folkLines("guide", ctx, 1), [story.nushi]);
  assert.ok(tw.folkLines("guide", ctx, 2)[0].length > 4, "3回目は ふつうの手引き");
  assert.deepEqual(tw.folkLines("collector", ctx, 0), tw.folkLines("collector", { ...ctx, story: undefined }, 0), "回収所の番人は、変わらない");
  for (let n = 0; n < 12; n++) for (const role of tw.FOLK_ROLES) for (const p of tw.folkLines(role, ctx, n)) { assert.ok(p.length >= 4 && p.length <= 90 && !/[（）()]/.test(p), p); }
});
await test("save: 前の版で 勝手に加わっていた物語の仲間は、はずれる（ふつうのフレンドは のこる）", async () => {
  const m = items.migrateSave({ friends: [{ id: "story_mina", kind: "story", name: "ミナ", role: "appraiser" }, { id: "c1", kind: "card", name: "ミライ", role: "healer", lv0: 5 }, null], party: ["story_mina", "c1", "zzz"] });
  assert.deepEqual(m.friends.map((f) => f.id), ["c1"]); assert.deepEqual(m.party, ["c1"]);
});
await test("encounter: ボスは、ひとりのときだけ やわらぐ（2人以上は そのまま）", async () => {
  const en = await import(st.url("encounter.js"));
  assert.ok(en.bossEase(1).hp < 1 && en.bossEase(1).atk < 1 && en.bossEase(1).hp > 0.3);
  for (const P of [2, 3, 4]) assert.deepEqual(en.bossEase(P), { hp: 1, atk: 1 });
});
await test("parts: 敵のレベルの計画（部ぜんたいで 1 から Lmax。章ごとに、つづく範囲）。前の版の部にも 補う", async () => {
  const pt = await import(st.url("parts.js"));
  const en2 = await import(st.url("encounter.js"));
  assert.equal(pt.levelMax(30), 6); assert.equal(pt.levelMax(600), 22); assert.ok(pt.levelMax(100) >= 7 && pt.levelMax(100) <= 9); assert.equal(pt.levelMax(100000), 24);
  let k = 0;
  for (const shape of SHAPES) for (let seed = 1; seed <= 3; seed++, k++) {
    const files = fakeFiles(seed * 3 + k, shape);
    const def = pt.buildPart({ files, roots: ["C:\R"], seed, at: 1 });
    const K = def.chapters.length, L = pt.levelMax(files.length);
    assert.equal(def.chapters[0].lv[0], 1); assert.equal(def.chapters[K - 1].lv[1], L, "最後の章の上は Lmax");
    for (let i = 0; i < K; i++) {
      const c = def.chapters[i];
      assert.ok(c.lv[0] <= c.lv[1] && c.lv[0] >= 1, JSON.stringify(c.lv));
      if (i) assert.equal(c.lv[0], def.chapters[i - 1].lv[1], "章の範囲は つづいている");
      const mine = pt.chapterFiles(def, files, c.n);
      assert.equal(c.maxSize, Math.max(...mine.map((f) => f.size))); assert.equal(c.minSize, Math.min(...mine.map((f) => f.size)));
      for (const f of mine) { const lv = en2.partEnemyLevel(c, f.size, 99); assert.ok(lv >= c.lv[0] && lv <= c.lv[1]); }
    }
  }
  // 前の版の部（レベルの計画が無い）は、補われる
  const old = JSON.parse(JSON.stringify(pt.buildPart({ files: fakeFiles(4, SHAPES[0]), roots: ["C:\R"], seed: 1, at: 1 })));
  for (const c of old.chapters) { delete c.lv; delete c.minSize; delete c.maxSize; }
  const fixed = pt.cleanDef(old);
  assert.ok(fixed && fixed.chapters.every((c, i) => c.lv.length === 2 && c.maxSize > 0 && c.minSize > 0 && c.lv[0] >= 1 && (i === 0 || c.lv[0] === fixed.chapters[i - 1].lv[1])));
});

// ---- bullets（敵のこうげきの弾よけ）-------------------------------------------------------------
await test("bullets: ダメージは、1発ごとにふだんの半分・上限は1.5倍・全部かわせば0", async () => {
  const bl = await import(st.url("bullets.js"));
  assert.equal(bl.damageFor(100, 0), 0); assert.equal(bl.damageFor(100, 1), 50); assert.equal(bl.damageFor(100, 2), 100); assert.equal(bl.damageFor(100, 3), 150); assert.equal(bl.damageFor(100, 9), 150);
  assert.equal(bl.damageFor(1, 1), 1); assert.equal(bl.damageFor(1, 5), 2); assert.equal(bl.perHit(0), 1);
  for (let full = 1; full <= 400; full += 7) for (let h = 0; h <= 8; h++) { const d = bl.damageFor(full, h); assert.ok(d >= 0 && d <= Math.round(full * 1.5) && (h === 0 ? d === 0 : d >= 1)); }
});
await test("bullets: 弾のあたり（当たると1発・しばらく当たらない・速い弾も すり抜けない・枠の外には出ない）", async () => {
  const bl = await import(st.url("bullets.js"));
  const base = () => { const s = bl.newDodge({ seed: 3, cat: "exe" }); s.patterns = []; s.bullets = []; return s; };
  let s = base();
  s.bullets.push({ x: s.hx, y: s.hy, vx: 0, vy: 0, r: 5 });
  assert.equal(bl.stepDodge(s, 1 / 60), 1); assert.equal(s.hits, 1);
  assert.equal(bl.stepDodge(s, 0.3), 0, "当たったあとは、しばらく 当たらない"); assert.equal(s.hits, 1);
  assert.ok(bl.stepDodge(s, bl.INVINCIBLE) >= 1 && s.hits === 2, "時間がたてば、また当たる");
  // 速い弾が、1コマで ハートを とびこえない
  s = base();
  s.bullets.push({ x: s.hx - 40, y: s.hy, vx: 400, vy: 0, r: 5 });
  assert.equal(bl.stepDodge(s, 0.3), 1, "細かく刻んで 動かす");
  // 枠の外には 出ない・遠い弾は 当たらない
  s = base();
  s.bullets.push({ x: 5, y: 5, vx: 0, vy: 0, r: 5 });
  for (let i = 0; i < 300; i++) bl.stepDodge(s, 1 / 60, { x: 1, y: 1 });
  assert.ok(s.hx <= bl.ARENA.w - bl.HEART.r + 1e-9 && s.hy <= bl.ARENA.h - bl.HEART.r + 1e-9 && s.hx >= bl.HEART.r && s.hy >= bl.HEART.r);
  assert.equal(s.hits, 0);
  const fresh = bl.newDodge({ seed: 1, cat: "image" });
  assert.ok(!fresh.done); for (let i = 0; i < 700 && !fresh.done; i++) bl.stepDodge(fresh, 1 / 60); assert.ok(fresh.done && fresh.t >= fresh.dur, "時間がきたら 終わる");
  assert.ok(fresh.bullets.length < 300, "弾が たまりすぎない");
});
await test("bullets: 同じ種なら同じ弾の出かた・種類ごとにちがう・強い技やボスは 重なって 速い", async () => {
  const bl = await import(st.url("bullets.js"));
  const trace = (o, dir = { x: 0, y: 0 }) => { const s = bl.newDodge(o); const out = []; for (let i = 0; i < 120; i++) { bl.stepDodge(s, 1 / 60, dir); out.push(s.bullets.length, Math.round(s.bullets[0] ? s.bullets[0].x : 0)); } return out.join(); };
  assert.equal(trace({ seed: 5, cat: "video" }), trace({ seed: 5, cat: "video" }));
  assert.notEqual(trace({ seed: 5, cat: "video" }), trace({ seed: 6, cat: "video" }));
  assert.notEqual(trace({ seed: 5, cat: "video" }), trace({ seed: 5, cat: "audio" }));
  const n = (o) => bl.newDodge(o).patterns.length;
  assert.equal(n({ cat: "video" }), 1); assert.equal(n({ cat: "video", intensity: 1.7 }), 2); assert.equal(n({ cat: "video", boss: true }), 2);
  assert.ok(bl.newDodge({ cat: "image", intensity: 2.4, boss: true }).dur > bl.newDodge({ cat: "image" }).dur);
  assert.ok(bl.newDodge({ cat: "image", intensity: 9 }).dur <= 5.5 && bl.newDodge({ cat: "image", duration: 2.5 }).dur === 2.5);
  for (const cat of ["image", "video", "audio", "archive", "code", "exe", "other", "doc"]) assert.ok(bl.newDodge({ seed: 1, cat }).patterns.every((p) => bl.PATTERN_IDS.includes(p.id)), cat);
});
await test("bullets: どの弾の出かたも、動かずにいれば当たり、自動でよける人なら ほぼ よけられる（よけられない形に なっていない）", async () => {
  const bl = await import(st.url("bullets.js"));
  const play = (o, bot) => { const s = bl.newDodge(o); while (!s.done) bl.stepDodge(s, 1 / 60, bot ? bl.autoDodge(s) : { x: 0, y: 0 }); return s.hits; };
  const N = 60;
  const cases = [["image", false, 1], ["video", false, 1], ["audio", false, 1], ["archive", false, 1], ["exe", false, 1], ["doc", false, 1], ["other", false, 1], ["code", false, 1], ["video", false, 1.7], ["image", false, 1.7], ["audio", true, 2.4], ["archive", true, 2.4], ["image", true, 2.4], ["exe", true, 2.4], ["doc", true, 2.4]];
  for (const [cat, boss, I] of cases) {
    let still = 0, bot = 0, worst = 0, zero = 0;
    for (let k = 1; k <= N; k++) { const o = { seed: k * 91, cat, boss, intensity: I }; still += play(o, false); const h = play(o, true); bot += h; worst = Math.max(worst, h); if (!h) zero++; }
    const tag = `${cat} boss${boss} 強さ${I}`;
    assert.ok(still / N >= 0.4, `${tag}：動かないと ほとんど当たらない ${(still / N).toFixed(2)}`);
    assert.ok(bot / N <= (boss || I > 1 ? 1.4 : 0.25), `${tag}：自動でも よけられない ${(bot / N).toFixed(2)}`);
    assert.ok(worst <= 5, `${tag}：最悪 ${worst}発`);
    assert.ok(zero / N >= (boss || I > 1 ? 0.3 : 0.85), `${tag}：ぜんぶ かわせる割合 ${zero / N}`);
  }
});

// ---- reset ----------------------------------------------------------------------------------
await test("reset: 進行度だけ戻り、世界の種・冒険の地・名前・カード・フレンド・助けた一覧は残る", async () => {
  const rst = await import(st.url("reset.js"));
  const card = { id: "c1", name: "ミライ", role: "healer", lv: 14, quip: "やあ", seed: 1 };
  const old = items.migrateSave({
    seed: 123, x: 5, y: 6, home: 2, lv: 9, exp: 500, hp: 80, mp: 30, gold: 999, kills: 80, freed: 3, steps: 400,
    roots: [{ id: "", path: "C:\Data" }], spared: ["f1", "f2"], cleared: [1, 2], questsDone: 4, heroName: "テスター",
    offers: [{ title: "a" }], active: [{ title: "b" }], log: [{ species: "x" }],
    cards: [card], friends: [{ id: "c1", kind: "card", name: "ミライ", role: "healer", lv0: 14, bond: 25, hp: 12, mp: 3, since: 5 }], party: ["c1"],
  });
  old.inv.item.herb = 50; old.inv.mat.image_0 = 9; old.inv.gear.push({ id: "g9", slot: "weapon", tier: 4, affinity: null, aiName: null });
  const fresh = items.migrateSave({ seed: 1, x: -1, y: -1, home: 0, lv: 1, exp: 0, hp: 57, mp: 14, gold: 30, kills: 0, freed: 0, offers: [], active: [], questsDone: 0, cleared: [], roots: [], steps: 0, log: [], spared: [] });
  const r = rst.resetSave(old, fresh);
  // 戻るもの
  assert.equal(r.lv, 1); assert.equal(r.exp, 0); assert.equal(r.gold, 30); assert.equal(r.kills, 0); assert.equal(r.steps, 0);
  assert.equal(r.x, -1); assert.deepEqual(r.cleared, []); assert.deepEqual(r.active, []); assert.deepEqual(r.offers, []); assert.equal(r.questsDone, 0);
  assert.equal(r.inv.item.herb, 5); assert.deepEqual(r.inv.mat, {}); assert.equal(r.inv.gear.length, 2);
  assert.deepEqual(r.party, []);
  // 残るもの
  assert.equal(r.seed, 123); assert.equal(r.heroName, "テスター");
  assert.deepEqual(r.roots, [{ id: "", path: "C:\Data" }]); assert.deepEqual(r.spared, ["f1", "f2"]);
  assert.deepEqual(r.cards, [card]);
  assert.equal(r.friends.length, 1); assert.equal(r.friends[0].id, "c1"); assert.equal(r.friends[0].bond, 0);
  assert.equal(r.friends[0].hp, null); assert.equal(r.friends[0].mp, null);
  // 元のセーブは変えない（配列は写しを持つ）
  assert.equal(old.lv, 9); assert.equal(old.friends[0].bond, 25); assert.deepEqual(old.party, ["c1"]);
  r.roots.push({ id: "x", path: "D:\\" }); r.spared.push("f3"); r.cards.push(card);
  assert.equal(old.roots.length, 1); assert.equal(old.spared.length, 2); assert.equal(old.cards.length, 1);
});
await test("reset: まっさらなセーブに かけても落ちない・2回かけても同じ", async () => {
  const rst = await import(st.url("reset.js"));
  const mk = () => items.migrateSave({ seed: 7, x: -1, y: -1, home: 0, lv: 1, exp: 0, hp: 57, mp: 14, gold: 30, kills: 0, freed: 0, offers: [], active: [], questsDone: 0, cleared: [], roots: [], steps: 0, log: [], spared: [] });
  const a = rst.resetSave(mk(), mk());
  assert.equal(a.lv, 1); assert.equal(a.heroName, "ゆうしゃ"); assert.deepEqual(a.friends, []); assert.deepEqual(a.cards, []);
  const b = rst.resetSave(a, mk());
  assert.equal(JSON.stringify(b), JSON.stringify(a));
});

// ---- 世界・絵 ---------------------------------------------------------------------------------------
const world = await import(st.url("world.js"));
await test("world: どのシードでも 町3・遺跡が作れて、町が全部たどりつける", () => {
  for (const seed of [1, 42, 99, 123456, 987654321, 2000000000, 31337]) {
    const w = world.generateWorld(seed);
    assert.ok(w.towns.length >= 2 && w.ruins.length >= 3, `シード${seed}`);
    const seen = new Uint8Array(w.w * w.h), stack = [w.start];
    seen[w.start.y * w.w + w.start.x] = 1;
    while (stack.length) {
      const p = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= w.w || y >= w.h || seen[y * w.w + x] || !world.WALKABLE(w.tiles[y * w.w + x])) continue;
        seen[y * w.w + x] = 1; stack.push({ x, y });
      }
    }
    for (const t of [...w.towns, ...w.ruins]) assert.ok(seen[t.y * w.w + t.x], `${t.name} に たどりつけない（シード${seed}）`);
  }
});

await test("world: 町の数・ダンジョンの数・名前を渡せる（数がそろい、全部たどりつける）", () => {
  const reach = (w) => {
    const seen = new Uint8Array(w.w * w.h), stack = [w.start];
    seen[w.start.y * w.w + w.start.x] = 1;
    while (stack.length) {
      const p = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= w.w || y >= w.h || seen[y * w.w + x] || !world.WALKABLE(w.tiles[y * w.w + x])) continue;
        seen[y * w.w + x] = 1; stack.push({ x, y });
      }
    }
    return seen;
  };
  let exact = 0, total = 0;
  for (const [towns, ruins] of [[3, 3], [3, 5], [4, 4], [5, 5], [7, 7], [1, 0], [3, 7]]) {
    for (const seed of [1, 42, 99, 123456, 987654321, 2000000000, 31337, 777]) {
      const w = world.generateWorld(seed, { towns, ruins });
      total++;
      if (w.towns.length === towns && w.ruins.length === ruins) exact++;
      assert.ok(w.towns.length >= Math.min(towns, 3) && w.ruins.length >= Math.min(ruins, 3), `${towns}/${ruins} シード${seed}：${w.towns.length}/${w.ruins.length}`);
      const seen = reach(w);
      for (const t of [...w.towns, ...w.ruins]) assert.ok(seen[t.y * w.w + t.x], `${t.name} に たどりつけない（${towns}/${ruins} シード${seed}）`);
      const names = [...w.towns, ...w.ruins].map((t) => t.name);
      assert.ok(names.every(Boolean), "名前がある");
      assert.equal(new Set(w.towns.map((t) => t.name)).size, w.towns.length, "町の名前が重ならない");
    }
  }
  assert.ok(exact / total > 0.9, `数がそろう島が 9割以上：${exact}/${total}`);
  // 名前の表を渡すと、そのとおりになる
  const w = world.generateWorld(42, { towns: 4, ruins: 4, townNames: ["A町", "B町", "C町", "D町"], ruinNames: ["あ洞", "い塔", "う城", "え沼"] });
  assert.deepEqual(w.towns.map((t) => t.name), ["A町", "B町", "C町", "D町"]);
  assert.deepEqual(w.ruins.map((t) => t.name), ["あ洞", "い塔", "う城", "え沼"]);
  // 既定は、今までどおり（町3・遺跡5）
  assert.equal(world.generateWorld(42).towns.length, 3);
  assert.equal(world.generateWorld(42).ruins.length, 5);
  assert.equal(JSON.stringify(world.generateWorld(42).towns), JSON.stringify(world.generateWorld(42, { towns: 3, ruins: 5 }).towns), "渡さなくても、3・5と同じ");
});

// ---- まとめ ------------------------------------------------------------------------------------
const ng = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - ng} / ${results.length} 件 通った`);
process.exit(ng ? 1 : 0);
