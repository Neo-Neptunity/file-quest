// ファイル・クエスト — 素材・装備・道具・売買の計算（画面を持たない）と、セーブの v2 への変換
import { WEAPONS, ARMORS, ITEMS } from "./data.js";
import { cleanLook } from "./hero.js";
import { hashStr } from "./pixel.js";
import { cleanSeries, cleanParts } from "./series.js";
import { cleanDgState, cleanLoc } from "./dungeon.js";
import { cleanDef } from "./parts.js";
import { cleanProgress } from "./campaign.js";
import { cleanStory } from "./story.js";

export const SAVE_VERSION = 3;
export const CAT_IDS = ["image", "video", "audio", "archive", "doc", "code", "exe", "other"];

// ---- 素材 --------------------------------------------------------------------------------
export const MAT_NAMES = {
  image: ["思い出のかけら", "色褪せの羽", "記憶の結晶"],
  video: ["竜の鱗", "巨竜の牙", "竜の心臓"],
  audio: ["旋律の欠片", "歌姫の髪", "響きの宝珠"],
  archive: ["古い釘", "錠前", "宝箱の金具"],
  doc: ["古い紙", "インクの瓶", "羽根ペン"],
  code: ["バグの欠片", "錆びたネジ", "呪文の巻物"],
  exe: ["歯車", "基板", "コア"],
  other: ["影のしずく", "ほこり", "空白の石"],
};
export const MAT_PRICE = [3, 12, 60];
export const matId = (cat, rarity) => `${cat}_${rarity}`;
export function matInfo(id) {
  const [cat, r] = String(id).split("_");
  const rarity = Number(r);
  if (!MAT_NAMES[cat] || !(rarity >= 0 && rarity <= 2)) return { id, cat: "other", rarity: 0, name: "なぞの素材", price: 1 };
  return { id, cat, rarity, name: MAT_NAMES[cat][rarity], price: MAT_PRICE[rarity] };
}

// 敵を1体 倒したときの素材。並は必ず、良は25%、稀はボスだけ
export function rollDrops(cat, lv, { boss = false, thief = false, extra = 0 } = {}, rand = Math.random) {
  const out = {};
  let q = 1 + Math.floor(lv / 5) + extra;
  if (thief) q = Math.ceil(q * 1.5);
  out[matId(cat, 0)] = q;
  if (rand() < 0.25) out[matId(cat, 1)] = 1 + Math.floor(lv / 10);
  if (boss) out[matId(cat, 2)] = 1;
  return out;
}

// ---- 装備 --------------------------------------------------------------------------------
export const SLOT_NAMES = { weapon: "武器", armor: "防具", acc: "アクセサリ" };
export const TIER_MAX = WEAPONS.length - 1;
export const AFFINITY_PREFIX = { image: "妖精の", video: "竜の", audio: "歌姫の", archive: "箱の", doc: "賢者の", code: "鬼の", exe: "機械の", other: "影の" };
export const AFFINITY_BONUS = 1.15;                   // 得意な相手への ダメージ倍率（防具は 受けるダメージが 1/1.15）
export const ACC_DEFS = {
  image: { name: "妖精のお守り", desc: "逃げやすくなる", flee: 0.25 },
  video: { name: "竜のきば", desc: "会心が 出やすくなる", crit: 0.06 },
  audio: { name: "歌姫のブローチ", desc: "回復が 3割 強くなる", heal: 0.3 },
  archive: { name: "宝箱の鍵", desc: "ゴールドが 2割 増える", gold: 0.2 },
  doc: { name: "賢者のしおり", desc: "経験値が 15% 増える", exp: 0.15 },
  code: { name: "バグよけの札", desc: "素材が 1つ 多く出る", mats: 1 },
  exe: { name: "守りの歯車", desc: "ぼうぎょが よく効く", guard: 0.35 },
  other: { name: "かげの指輪", desc: "とくぎの MPが 1 へる", mpCut: 1 },
};

export function makeGear(inv, slot, tier, affinity = null) {
  const id = `g${inv.nextGear++}`;
  return { id, slot, tier: Math.max(0, Math.min(TIER_MAX, tier | 0)), affinity: CAT_IDS.includes(affinity) ? affinity : null, aiName: null };
}
export function gearTitle(g) {
  if (g.slot === "acc") return (ACC_DEFS[g.affinity] || ACC_DEFS.other).name;
  const base = (g.slot === "weapon" ? WEAPONS : ARMORS)[g.tier].name;
  return (g.affinity ? AFFINITY_PREFIX[g.affinity] : "") + base;
}
export const gearName = (g) => g.aiName || gearTitle(g);
export const gearAtk = (g) => (g && g.slot === "weapon" ? WEAPONS[g.tier].atk : 0);
export const gearDef = (g) => (g && g.slot === "armor" ? ARMORS[g.tier].def : 0);
export const gearEffect = (g, key) => (g && g.slot === "acc" ? (ACC_DEFS[g.affinity] || {})[key] || 0 : 0);

// ---- 値段・作る条件 ------------------------------------------------------------------------
export const buyPrice = (slot, tier) => Math.round((slot === "weapon" ? 90 : 75) * tier * tier);     // 店で買う（得意な相手は付かない）
export const sellGearPrice = (g) => (g.slot === "acc" ? 120 : Math.round(buyPrice(g.slot, g.tier) * 0.4));
export function craftCost(slot, tier, cat) {
  if (slot === "acc") return { gold: 300, mats: { [matId(cat, 2)]: 3 } };
  const gold = Math.round((slot === "weapon" ? 60 : 50) * tier * tier);
  return { gold, mats: { [matId(cat, 0)]: 4 + 2 * tier, [matId(cat, 1)]: tier } };
}

// ---- 持ち物の増減 ----------------------------------------------------------------------------
export const newInv = () => ({ mat: {}, item: { herb: 5, herb2: 0, ether: 1, smoke: 1, bomb: 0 }, gear: [], nextGear: 1 });
export function addAll(map, add) { for (const [k, n] of Object.entries(add)) map[k] = Math.min(99, (map[k] || 0) + n); }
export const hasAll = (map, need) => Object.entries(need).every(([k, n]) => (map[k] || 0) >= n);
export function spendAll(map, need) { for (const [k, n] of Object.entries(need)) { map[k] = (map[k] || 0) - n; if (map[k] <= 0) delete map[k]; } }

export function equippedGear(save) {
  const find = (id) => save.inv.gear.find((g) => g.id === id) || null;
  return { weapon: find(save.equip.weapon), armor: find(save.equip.armor), acc: find(save.equip.acc) };
}
export function equipGear(save, gearId) {
  const g = save.inv.gear.find((x) => x.id === gearId);
  if (!g) return false;
  save.equip[g.slot] = g.id;
  return true;
}
export const bestTier = (save, slot) => Math.max(0, ...save.inv.gear.filter((g) => g.slot === slot).map((g) => g.tier));
export const ownedGear = (save, slot) => save.inv.gear.filter((g) => g.slot === slot);
// 売れるのは、装備していないものだけ。売ったゴールドを返す（売れなければ 0）
export function sellGear(save, gearId) {
  const i = save.inv.gear.findIndex((g) => g.id === gearId);
  if (i < 0) return 0;
  const g = save.inv.gear[i];
  if (save.equip[g.slot] === g.id) return 0;
  save.inv.gear.splice(i, 1);
  const price = sellGearPrice(g);
  save.gold += price;
  return price;
}
export function sellMats(save, id, n) {
  const have = save.inv.mat[id] || 0, k = Math.max(0, Math.min(n, have));
  if (!k) return 0;
  spendAll(save.inv.mat, { [id]: k });
  const gold = k * matInfo(id).price;
  save.gold += gold;
  return gold;
}
// 素材を使って、武器・防具・アクセサリを作る。作れなければ null、作れれば作ったものを返す
export function craft(save, slot, cat) {
  const tier = slot === "acc" ? 0 : bestTier(save, slot) + 1;
  if (slot !== "acc" && tier > TIER_MAX) return null;
  const cost = craftCost(slot, tier, cat);
  if (save.gold < cost.gold || !hasAll(save.inv.mat, cost.mats)) return null;
  save.gold -= cost.gold;
  spendAll(save.inv.mat, cost.mats);
  const g = makeGear(save.inv, slot, tier, cat);
  save.inv.gear.push(g);
  return g;
}
export function buyNextGear(save, slot) {
  const tier = bestTier(save, slot) + 1;
  if (tier > TIER_MAX) return null;
  const price = buyPrice(slot, tier);
  if (save.gold < price) return null;
  save.gold -= price;
  const g = makeGear(save.inv, slot, tier, null);
  save.inv.gear.push(g);
  return g;
}

// ---- 日替わり ------------------------------------------------------------------------------
export const dayNum = (now = Date.now()) => Math.floor((now - new Date(now).getTimezoneOffset() * 60000) / 86400000);
export const SHOP_ITEMS = ["herb", "herb2", "ether", "smoke", "bomb"];
export const dailySpecial = (day) => SHOP_ITEMS[hashStr(`shop|${day}`) % SHOP_ITEMS.length];
export const itemPrice = (id, day) => Math.round(ITEMS[id].price * (id === dailySpecial(day) ? 0.8 : 1));

// ---- セーブの変換（v1 → v2）と、足りない項目の補い ------------------------------------------------
export function migrateSave(save) {
  if (!save.inv) {
    const inv = newInv();
    inv.item = Object.assign({ herb: 5, herb2: 0, ether: 1, smoke: 1, bomb: 0 }, save.items || {});
    const w = makeGear(inv, "weapon", Math.max(0, save.wep | 0));
    const a = makeGear(inv, "armor", Math.max(0, save.arm | 0));
    inv.gear.push(w, a);
    save.inv = inv;
    save.equip = { weapon: w.id, armor: a.id, acc: null };
    delete save.items;
    delete save.wep;
    delete save.arm;
  }
  for (const k of ["herb", "herb2", "ether", "smoke", "bomb"]) save.inv.item[k] = save.inv.item[k] || 0;
  save.equip = Object.assign({ weapon: null, armor: null, acc: null }, save.equip);
  save.friends = save.friends || [];
  save.friends = save.friends.filter((x) => x && x.kind !== "story");                  // 物語の仲間は いない（前の版で 勝手に加わっていたものを はずす）
  save.party = save.party || [];
  save.party = save.party.filter((id) => save.friends.some((x) => x.id === id));        // フレンドでなくなった人は、同行から はずす
  save.cards = save.cards || [];
  delete save.aff;                        // 旅人との親しさ（廃止）
  save.heroName = save.heroName || "ゆうしゃ";
  save.look = cleanLook(save.look, save.seed);                                  // 勇者の見た目（5つの番号）
  if (!Number.isInteger(save.islandSeed)) save.islandSeed = (save.seed | 0) & 0x7fffffff;      // 島の形の種（選んだ冒険の地で変わる）
  save.dgState = cleanDgState(save.dgState);                                    // ダンジョンで開けた宝箱
  save.loc = cleanLoc(save.loc);                                                // いる場所（ダンジョンの中のときだけ）
  save.series = cleanSeries(save.series);                                       // シリーズ（終えた部・伏線・加わった仲間）。v3 で足した
  save.parts = cleanParts(save.parts);
  for (const id of Object.keys(save.parts)) {                                   // 部の形が合わないものは捨てる。進みは、部に合わせて直す
    const rec = save.parts[id], def = cleanDef(rec.def);
    if (!def || def.id !== id) { delete save.parts[id]; continue; }
    rec.def = def;
    rec.progress = cleanProgress(rec.progress, def);
    rec.story = cleanStory(rec.story, def);
  }                                          // 部ごとの記録（部の本体・いる場所・進み）
  save.activePart = typeof save.activePart === "string" && save.parts[save.activePart] ? save.activePart : null;      // 進行中の部。無ければ、いまの遊び方（save.active は、受けている依頼の一覧なので、名前を分けた）
  save.v = SAVE_VERSION;
  return save;
}
