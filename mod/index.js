// ファイル・クエスト — 長く使われていないファイルと戦う、ターン制のRPG（フォルダの場所とは関係なく遊べる）
// 倒したファイルは「回収待ち」にたまり、町の回収所で1回だけ本体の確認を通してからごみ箱へ送る。
// 設計：../docs/design.md　画面を持たない計算は、items・appraise・encounter・party・visitors・card・quests に分けてある。
import {
  DAY, BOSS_BYTES, EXCLUDE_PATH, PROTECTED_EXT, PROTECTED_NAME, SPECIES, catOf, LORE, lvOf,
  ITEMS, SKILL_DEFS, HERO_SKILLS, rnd, pick, clamp, fmtSize, fmtAge,
} from "./data.js";
import { T, MAP_W, MAP_H, WALKABLE, generateWorld } from "./world.js";
import { createAi } from "./ai.js";
import { getSprite } from "./sprite.js";
import { hashStr } from "./pixel.js";
import {
  CAT_IDS, MAT_NAMES, matInfo, matId, rollDrops, SLOT_NAMES, ACC_DEFS, AFFINITY_BONUS, gearName, gearAtk, gearDef, gearEffect,
  buyPrice, sellGearPrice, craftCost, craft, buyNextGear, equipGear, equippedGear, ownedGear, bestTier, TIER_MAX, sellGear, sellMats,
  addAll, hasAll, dayNum, dailySpecial, itemPrice, SHOP_ITEMS, migrateSave, newInv,
} from "./items.js";
import { appraiseAll, appraiseKey, IMP_GUARD, IMP_DOUBT } from "./appraise.js";
import { rollCount, bossEase, enemyLevel, partEnemyLevel, pickFollowers, bossMinions, enemyStats, partyScale, enemyExp, enemyGold, spriteSize, keyOf, dirOf, MAX_ENEMIES } from "./encounter.js";
import { ROLES, ROLE_IDS, MAX_PARTY, memberStats, skillsFor, stageOf, companionLv, friendStage, autoAction, pickEnemy, pickAlly } from "./party.js";
import { visitorsFor, friendFrom, FRIEND_MAX } from "./visitors.js";
import { encodeCard, decodeCard, sanitizeText } from "./card.js";
import { poolStats, localOffers, validateAiQuests, progressAdd, progressText } from "./quests.js";
import { resetSave } from "./reset.js";
import { newDodge, stepDodge, perHit, DAMAGE_CAP, ARENA } from "./bullets.js";
import { DIRS, newWalker, placeWalker, stepWalker, cameraFor } from "./grid.js";
import { TT, TOWN_PALS, buildTown, townOpen, folkAt, doorAt, isExit, folkLines } from "./town.js";
import { D, passable as dgPassable, buildFloor, styleFor, floorsFor, floorLabel, dungeonKey, chestLoot, SHAPE_FEEL } from "./dungeon.js";
import { VW, VH, TS, canvas, ctx, view, ui, config, sfx, text, fit, wrap, win, bar, say, finishMsg, choose, endChoice, pop, clearMsg, held, press, drawMsg, drawChoice, drawPortrait, drawPops } from "./ui.js";
import { refByDescent, islandSeedFor } from "./roots.js";
import { getHeroSprite, LOOK_ROWS, LOOK_N, randomLook, lookOf } from "./hero.js";
import { limitsFrom, checkVolume, abortAt, volumeMessage } from "./volume.js";
import { aggregate, pickFitting, mergeCandidates, describe } from "./discover.js";
import { outlookFromAgg, buildPart, chapterOf, phantomFor, outlookOfPart, fmtMinutes, keyOfRef, PHANTOM_EXP_RATE } from "./parts.js";
import { newProgress, chapterOpen, bossBeaten, bossIndexAt, guardedFloor, chapterCleared, beatBoss, fragTotal, fragCount, finish as finishProgress } from "./campaign.js";
import { buildStory, validateStory, aiBrief, chapterStory, fragmentFor, maskedName, revealedChars, endingFor, summaryFor, clean as cleanText } from "./story.js";
import { recentSummaries, finishPart as finishSeries, PARTS_MAX } from "./series.js";
import { isBogusTime, parseTime, sinceOf, idleMs } from "./idle.js";

const ep = window.explorerPlus;
const POOL_MAX = 1500;
const limits = () => limitsFrom(s);       // 冒険の地の下限・上限（設定）
const TIER_COLORS = ["#8b949e", "#57ab5a", "#4c9be8", "#a371f7", "#f0883e", "#f85149"];

await ep.ready();
let s = await ep.settings.get();
ep.onSettings((next) => {
  const was = { debug: !!s.debug, key: !!s.apiKey, llm: !!s.llm, model: s.model };
  s = next;
  if (!!s.debug !== was.debug) registerCommands();
  if (!!s.apiKey !== was.key || !!s.llm !== was.llm || s.model !== was.model) { llmDownUntil = 0; llmFails = 0; }     // キーやモデルを変えたら、AIの休みを解く
});

// ---- AI（任意。キーが無くても遊べる）----------------------------------------------------------
const ai = createAi(ep, () => s);
const loreStore = (await ep.storage.get("lore")) || {};               // AI が作った二つ名・セリフ・技（新しい 200 件まで）
const appraisal = (await ep.storage.get("appraisal")) || {};          // 鑑定の結果（新しい 3000 件まで）
let guarded = (await ep.storage.get("guarded")) || [];                // 鑑定で守られたファイル（500 件まで）
let llmDownUntil = 0, llmFails = 0;
const aiStat = { ok: 0, fail: 0, last: "", told: 0 };                  // 成功・失敗の数と、最後の失敗の理由（「つよさ」と「AIの接続を確かめる」に出す）
const aiReady = () => !!(s.llm && s.apiKey) && Date.now() > llmDownUntil;
const llmOk = () => { llmFails = 0; aiStat.ok++; };
function llmFailed(err) {
  aiStat.fail++;
  aiStat.last = `${err.message}${err.detail ? `　${err.detail}` : ""}`.slice(0, 220);
  console.warn("AI の呼び出しに失敗：", err.message, err.detail || "");
  if (err.status === 401 || err.status === 403) { llmDownUntil = Date.now() + 3600e3; ep.ui.toast("AI の API キーが使えません。設定で確かめてください").catch(() => {}); }
  else {
    if (++llmFails >= 3) { llmDownUntil = Date.now() + 5 * 60e3; llmFails = 0; }
    if (Date.now() - aiStat.told > 600e3) { aiStat.told = Date.now(); ep.ui.toast("AI がうまく働きません。コマンドの『AIの接続を確かめる』で理由を見られます").catch(() => {}); }
  }
}
// 画面に出す、AIの状態
function aiStatusText() {
  if (!s.llm) return "AI： オフ\n設定の『AIでセリフ・鑑定・依頼を作る』で オンにできる。";
  if (!s.apiKey) return "AI： APIキーが 入っていない\n設定の『Anthropic の API キー』に 入れると 使える。";
  const rest = Math.ceil((llmDownUntil - Date.now()) / 60000);
  const head = rest > 0 ? `AI： しばらく 休み中　あと${rest}分` : "AI： つながっている";
  return `${head}\n成功 ${aiStat.ok}回　失敗 ${aiStat.fail}回${aiStat.last ? `\n最後の失敗： ${aiStat.last}` : ""}`;
}
// 失敗の理由を、やさしい言葉にする
function aiReason(err) {
  if (err.code === "not-found") return "APIキーが 預けられていない。設定で もう一度 入れてみよう。";
  if (err.code === "network") return "つながらなかった。ネットワークを 確かめよう。";
  if (err.code === "not-declared") return "通信の許可が 足りない。MODを 入れなおしてみよう。";
  if (err.status === 401 || err.status === 403) return "APIキーが 使えない。キーが 合っているか 確かめよう。";
  if (err.status === 404) return `モデルが 見つからない。設定の『AIのモデル』を かえてみよう。${err.detail ? `\n${err.detail}` : ""}`;
  if (err.status === 400) return `AIに 断られた。${err.detail ? `\n${err.detail}` : ""}`;
  if (err.status === 429) return "使いすぎで 制限されている。少し まってから もう一度。";
  if (err.status >= 500) return "AIのサービス側が 不調。あとで もう一度。";
  if (err.message === "bad-json") return `返事の形が 読めなかった。\n${err.detail || ""}`;
  return String(err.message || err);
}
const trimMap = (obj, max) => { const ks = Object.keys(obj); if (ks.length > max) for (const k of ks.slice(0, ks.length - max)) delete obj[k]; };

// ---- セーブ -------------------------------------------------------------------------
const newSave = () => ({
  seed: (Math.random() * 2147483647) | 0, x: -1, y: -1, home: 0,
  lv: 1, exp: 0, hp: 57, mp: 14, gold: 30, kills: 0, freed: 0,
  offers: [], active: [], questsDone: 0, cleared: [], roots: [], steps: 0, log: [], spared: [],
});
let save = migrateSave(Object.assign(newSave(), await ep.storage.get("save")));
let pool = Object.assign({ at: 0, days: 0, list: [], truncated: false }, await ep.storage.get("pool"));
let pending = (await ep.storage.get("pending")) || [];     // 倒したが、まだごみ箱に送っていない { id, path, name, size }
const persist = () => ep.storage.set("save", save).catch(() => {});
const persistPending = () => ep.storage.set("pending", pending).catch(() => {});
const persistPool = () => ep.storage.set("pool", pool).catch(() => {});
const persistGuarded = () => ep.storage.set("guarded", guarded).catch(() => {});

// ---- ヒーローの能力 ---------------------------------------------------------------------
const gear = () => equippedGear(save);
const accEffect = (k) => gearEffect(gear().acc, k);
const hpMax = () => 44 + 13 * save.lv;
const mpMax = () => 10 + 4 * save.lv;
const heroAtk = () => 11 + 3.3 * save.lv + gearAtk(gear().weapon);
const heroDef = () => 4.5 + 1.6 * save.lv + gearDef(gear().armor);
const heroSpd = () => 8 + 1.2 * save.lv;
const expNeed = (lv) => Math.round(18 * lv * lv + 12 * lv);
save.hp = clamp(save.hp, 1, hpMax());
save.mp = clamp(save.mp, 0, mpMax());

// 数値の見せ方：HP・MP・ダメージ・こうげき・まもりは、ポイントの数字のまま出す。
// 敵ごとに換算しない（同じこうげきは、どの敵にも 同じダメージ。敵の体力に合わせて ダメージの見せかたが かわることはない）。
// ファイルの大きさと放置の長さは、敵の窓に 別に出す
const U = (points) => String(Math.max(0, Math.round(points)));

// ---- 世界 --------------------------------------------------------------------------
// 進行中の部（なければ null）。部は、保存の中に 本体・進み・物語の設計図を持つ（凍結）
const partRec = () => (save.activePart && save.parts[save.activePart]) || null;
const partDef = () => (partRec() ? partRec().def : null);
const partProg = () => (partRec() ? partRec().progress : null);
const partStory = () => (partRec() ? partRec().story : null);
// 島の形：部があれば、部の 町と遺跡の数・名前で。なければ、いまの島
function makeWorld() {
  const d = partDef();
  return d ? generateWorld(save.islandSeed, { towns: d.island.towns, ruins: d.island.ruins, townNames: d.island.townNames, ruinNames: d.island.ruinNames }) : generateWorld(save.islandSeed);
}
let world = makeWorld();          // 島の形は、部（なければ、選んだ冒険の地）で変わる（setIsland）
if (save.x < 0) { save.x = world.start.x; save.y = world.start.y; }
const tileAt = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? T.WATER : world.tiles[y * MAP_W + x]);
const hero = newWalker(save.x, save.y);
const townAt = (x, y) => world.towns.findIndex((t) => t.x === x && t.y === y);
const ruinAt = (x, y) => world.ruins.findIndex((t) => t.x === x && t.y === y);
const mini = document.createElement("canvas");
mini.width = MAP_W;
mini.height = MAP_H;
function drawMini() {
  const mc = mini.getContext("2d"), col = ["#2f62b5", "#d8c37b", "#58a14a", "#2f7a30", "#9aa05a", "#7b7b86", "#ffffff", "#ff5555"];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) { mc.fillStyle = col[tileAt(x, y)]; mc.fillRect(x, y, 1, 1); }
}
drawMini();
// 島を作りなおす（冒険の地が変わったとき）。勇者は、新しい島の はじまりの町に立つ
function setIsland(seed) {
  clearDungeon();
  clearTown();
  save.islandSeed = seed;
  world = makeWorld();
  drawMini();
  save.x = world.start.x;
  save.y = world.start.y;
  save.home = 0;
  placeWalker(hero, save.x, save.y);
  stepsSince = 0;
  persist();
}

// ---- 状態 --------------------------------------------------------------------------
let scene = "map";          // "map" | "battle" | "scan" | "dungeon" | "town"
let busy = true;            // true の間は、地図の操作を受け付けない（会話・戦闘・メニュー中）
let bs = null;              // 戦闘中の見た目の状態
let scanInfo = "";
let stepsSince = 0;
let dg = null;             // いるダンジョン { ruin, name, style, key, floors, floor, map, seen }（なければ null）
let tn = null;             // いる町 { index, name, map, roofAt }（なければ null）
let dodge = null;          // 弾よけの最中 { sim, res, skip, over, onHit, label, cat }（なければ null）
const toast = (m) => ep.ui.toast(m).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 画面の部品は ui.js。ゲーム側が決める 2 つを渡す ----------------------------------------------
config.sound = () => s.sound;
// 会話も選択も出ていないときの、地図の上の操作（Enter：町に入る・メニュー／Esc：メニュー）
config.field = (a) => {
  if (dodge) { if (a === "cancel") dodge.skip = true; return; }                              // 弾よけの最中：Esc で とばす
  if (busy || (scene !== "map" && scene !== "dungeon" && scene !== "town")) return;
  if (a === "ok") {
    if (scene === "town") { const f = facingFolk(); runEvent(f ? () => talkToFolk(f) : fieldMenu); }       // 町：向いている人に話しかける
    else { const ti = scene === "map" ? townAt(hero.tx, hero.ty) : -1; if (ti >= 0) runEvent(() => enterTown(ti)); else runEvent(fieldMenu); }
  } else if (a === "cancel") runEvent(fieldMenu);
};

// ---- 仲間（フレンド）の部隊 ------------------------------------------------------------------
const friendById = (id) => save.friends.find((f) => f.id === id) || null;
const partyFriends = () => save.party.map(friendById).filter(Boolean);
const newStatus = () => ({ blind: 0, asleep: 0, guard: false });
function makeHeroUnit() {
  return {
    kind: "hero", id: "hero", role: "hero", emoji: "🧙", name: save.heroName, flash: 0, st: newStatus(),
    get look() { return save.look; }, get lv() { return save.lv; }, get maxHp() { return hpMax(); }, get maxMp() { return mpMax(); },
    get hp() { return save.hp; }, set hp(v) { save.hp = v; }, get mp() { return save.mp; }, set mp(v) { save.mp = v; },
    get atk() { return heroAtk(); }, get def() { return heroDef(); }, get spd() { return heroSpd(); },
    get crit() { return 0.06 + accEffect("crit"); }, get mpCut() { return accEffect("mpCut"); },
    get skills() { return HERO_SKILLS.filter((k) => save.lv >= k.lv).map((k) => k.id); },
  };
}
function makeFriendUnit(fr) {
  const lv = companionLv(fr, save.lv), st = memberStats(fr.role, lv), stage = friendStage(fr, lv);
  if (fr.hp == null || fr.hp > st.maxHp) fr.hp = st.maxHp;
  if (fr.mp == null || fr.mp > st.maxMp) fr.mp = st.maxMp;
  return {
    kind: "friend", id: fr.id, fr, role: fr.role, emoji: ROLES[fr.role].emoji, look: lookOf(fr), name: fr.name, lv, stage, flash: 0, st: newStatus(),
    maxHp: st.maxHp, maxMp: st.maxMp, atk: st.atk, def: st.def, spd: st.spd, crit: st.crit, mpCut: 0, skills: skillsFor(fr.role, stage),
    get hp() { return fr.hp; }, set hp(v) { fr.hp = v; }, get mp() { return fr.mp; }, set mp(v) { fr.mp = v; },
  };
}
const partyUnits = () => [makeHeroUnit(), ...partyFriends().map(makeFriendUnit)];

// ---- 描画：地図 ----------------------------------------------------------------------------
const tileHash = (x, y) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const TILE_COLOR = ["#2f62b5", "#d8c37b", "#58a14a", "#3f8a3a", "#9aa05a", "#7b7b86", "#58a14a", "#58a14a"];
function drawMap(t) {
  const { cx, cy, camX, camY, x0, x1, y0, y1 } = cameraFor(hero.px, hero.py, MAP_W, MAP_H, TS, VW, VH);
  ctx.save();
  ctx.translate(-camX, -camY);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const tt = tileAt(x, y), px = x * TS, py = y * TS;
      ctx.fillStyle = TILE_COLOR[tt];
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = `rgba(0,0,0,${tileHash(x, y) * 0.1})`;
      ctx.fillRect(px, py, TS, TS);
      if (tt === T.WATER) {
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(px + 6 + ((t * 18 + x * 9) % 30), py + 14 + tileHash(x, y) * 18, 12, 2);
      } else if (tt === T.FOREST) text("🌲", px + TS / 2, py + TS / 2, { size: 34, align: "center", base: "middle" });
      else if (tt === T.HILL) text("⛰️", px + TS / 2, py + TS / 2, { size: 26, align: "center", base: "middle" });
      else if (tt === T.MOUNTAIN) text("🏔️", px + TS / 2, py + TS / 2, { size: 38, align: "center", base: "middle" });
      else if (tt === T.TOWN) text("🏘️", px + TS / 2, py + TS / 2, { size: 40, align: "center", base: "middle" });
      else if (tt === T.RUIN) {
        const i = ruinAt(x, y);
        text(save.cleared.includes(i) ? "🪦" : "🏛️", px + TS / 2, py + TS / 2, { size: 38, align: "center", base: "middle" });
      }
    }
  }
  for (const tw of world.towns) if (tw.x >= x0 && tw.x < x1 && tw.y >= y0 && tw.y < y1) text(tw.name, tw.x * TS + TS / 2, tw.y * TS - 6, { size: 15, align: "center", base: "bottom", color: "#fff" });
  const bob = hero.moving ? Math.abs(Math.sin(t * 20)) * -4 : Math.sin(t * 3) * -1;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 16, 15, 5, 0, 0, 6.28);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy + bob - 2);
  if (hero.face < 0) ctx.scale(-1, 1);                 // 左を向いたら、絵も左向きに
  drawPortrait(save.look, "hero", -26, -30, 52);
  ctx.restore();
  ctx.restore();
  const g = ctx.createRadialGradient(VW / 2, VH / 2, 260, VW / 2, VH / 2, 640);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);
  drawMapHud(t);
}
function drawMapHud(t) {
  drawStatusPanel();
  drawWorldMini(t);
}
function drawStatusPanel() {
  win(12, 12, 270, 108);
  text(`${save.heroName} Lv.${save.lv}`, 28, 24, { size: 20 });
  text(`HP ${U(save.hp)} / ${U(hpMax())}`, 28, 52, { size: 18, color: save.hp < hpMax() * 0.3 ? "#ff7777" : "#fff" });
  text(`MP ${U(save.mp)} / ${U(mpMax())}`, 28, 76, { size: 18, color: "#9ad1ff" });
  text(`${save.gold} G`, 266, 100, { size: 16, color: "#ffd866", align: "right", base: "bottom" });
  const pf = partyFriends();
  if (pf.length) {
    win(12, 126, 270, 12 + pf.length * 24);
    pf.forEach((fr, i) => {
      const lv = companionLv(fr, save.lv), st = memberStats(fr.role, lv), hp = fr.hp ?? st.maxHp;
      drawPortrait(lookOf(fr), fr.role, 18, 130 + i * 24, 22);
      text(fit(fr.name, 100, 15), 44, 136 + i * 24, { size: 15 });
      bar(170, 139 + i * 24, 100, 10, hp / st.maxHp, hp < st.maxHp * 0.3 ? "#e0463c" : "#4ac05a");
    });
  }
}
function drawWorldMini(t) {
  const mw = MAP_W * 2, mh = MAP_H * 2, mx = VW - mw - 12, my = 12;
  ctx.fillStyle = "#000";
  ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mini, mx, my, mw, mh);
  if (Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = "#ffee33"; ctx.fillRect(mx + hero.tx * 2 - 2, my + hero.ty * 2 - 2, 6, 6); }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(mx - 3, my - 3, mw + 6, mh + 6);
  text(`回収待ち ${pending.length}体 ／ 残りの敵 ${pool.list.length}体`, VW - 12, my + mh + 12, { size: 16, align: "right", color: "#e6e1f5" });
  if (!ui.msg && !ui.choice) text("矢印／WASD：移動　Enter：決定・町に入る　Esc：メニュー", 14, VH - 12, { size: 15, base: "bottom", color: "rgba(255,255,255,0.75)" });
}

// ---- 描画：ダンジョン ----------------------------------------------------------------------
// 暗がり：近くだけが見え、歩いたところは うっすら覚えている（ミニマップにも出る）
const dgSight = () => (dg.floor === dg.floors ? 4 : dg.floor >= 3 ? 5 : 6);          // 深い階ほど、見える範囲が せまい
function drawDungeon(t) {
  const m = dg.map, pal = DG_STYLE[dg.style], SIGHT = dgSight();
  const { cx, cy, camX, camY, x0, x1, y0, y1 } = cameraFor(hero.px, hero.py, m.w, m.h, TS, VW, VH);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VW, VH);
  for (let y = Math.max(0, Math.floor(hero.py - SIGHT)); y <= Math.min(m.h - 1, Math.ceil(hero.py + SIGHT)); y++) {
    for (let x = Math.max(0, Math.floor(hero.px - SIGHT)); x <= Math.min(m.w - 1, Math.ceil(hero.px + SIGHT)); x++) {
      if (Math.hypot(x - hero.px, y - hero.py) <= SIGHT + 0.5) dg.seen[y * m.w + x] = 1;       // 見えたところを覚える
    }
  }
  ctx.save();
  ctx.translate(-camX, -camY);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const i = y * m.w + x;
      if (!dg.seen[i]) continue;
      const tt = m.tiles[i], px = x * TS, py = y * TS, dist = Math.hypot(x - hero.px, y - hero.py);
      if (tt === D.WALL) {
        ctx.fillStyle = pal.wall;
        ctx.fillRect(px, py, TS, TS);
        if (y + 1 < m.h && m.tiles[i + m.w] !== D.WALL) {                                     // 壁の手前の面
          ctx.fillStyle = pal.face;
          ctx.fillRect(px, py + TS * 0.4, TS, TS * 0.6);
          ctx.fillStyle = "rgba(255,255,255,0.07)";
          ctx.fillRect(px, py + TS * 0.4, TS, 3);
          const th = tileHash(x * 3 + dg.floor, y * 7 + dg.ruin);
          if ((dg.style === "tower" || dg.style === "castle") && th < 0.14) {              // かべの たいまつ
            ctx.fillStyle = `rgba(255,170,60,${0.16 + Math.sin(t * 7 + x) * 0.04})`;
            ctx.beginPath();
            ctx.arc(px + TS / 2, py + TS * 0.62, 26, 0, 6.28);
            ctx.fill();
            text("🔥", px + TS / 2, py + TS * 0.66, { size: 22, align: "center", base: "middle" });
          } else if ((dg.style === "cave" || dg.style === "swamp") && th < 0.1) text(dg.style === "cave" ? "🍄" : "🌿", px + TS / 2, py + TS * 0.7, { size: 20, align: "center", base: "middle" });
        }
      } else if (tt === D.WATER) {                                                          // 池
        ctx.fillStyle = pal.water;
        ctx.fillRect(px, py, TS, TS);
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillRect(px + 6 + ((t * 14 + x * 11) % 30), py + 10 + tileHash(x, y) * 22, 14, 2);
        ctx.fillRect(px + 20 + ((t * 9 + y * 7) % 20), py + 30 + tileHash(y, x) * 8, 10, 2);
      } else {
        ctx.fillStyle = pal.floor;
        ctx.fillRect(px, py, TS, TS);
        ctx.fillStyle = `rgba(0,0,0,${tileHash(x, y) * 0.2})`;
        ctx.fillRect(px, py, TS, TS);
        const mx = px + TS / 2, my = py + TS / 2;
        if (tt === D.FLOOR) {                                                             // 床の 小さな飾り（歩くのには じゃまにならない）
          const dh = tileHash(x + dg.floor * 31, y + dg.ruin * 17);
          if (dh < 0.03) { ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(px + 10, py + 28, 12, 7); ctx.fillRect(px + 24, py + 22, 9, 6); ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(px + 10, py + 28, 12, 2); }
          else if (dh < 0.045) text(dg.style === "cave" ? "🍄" : dg.style === "swamp" ? "🌾" : dg.style === "tower" ? "📚" : "🕯️", mx, my + 6, { size: 18, align: "center", base: "middle" });
        }
        if (tt === D.UP) text(dg.floor === 1 ? "🚪" : "🔼", mx, my, { size: 34, align: "center", base: "middle" });
        else if (tt === D.DOWN) text("🔽", mx, my, { size: 34, align: "center", base: "middle" });
        else if (tt === D.CHEST) text("🎁", mx, my, { size: 32, align: "center", base: "middle" });
        else if (tt === D.OPEN) text("📭", mx, my, { size: 28, align: "center", base: "middle" });
        else if (tt === D.SPRING) text("⛲", mx, my, { size: 34, align: "center", base: "middle" });
        else if (tt === D.BOSS) text("👹", mx, my + Math.sin(t * 3) * 2, { size: 40 + Math.sin(t * 4) * 2, align: "center", base: "middle" });
      }
      const dark = dist <= SIGHT + 0.5 ? clamp((dist - 2.5) / 3.2, 0, 0.8) : 0.72;               // 遠いほど暗く。覚えているだけの所は、さらに暗く
      if (dark > 0) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(px, py, TS, TS); }
    }
  }
  const bob = hero.moving ? Math.abs(Math.sin(t * 20)) * -4 : Math.sin(t * 3) * -1;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 16, 15, 5, 0, 0, 6.28);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy + bob - 2);
  if (hero.face < 0) ctx.scale(-1, 1);
  drawPortrait(save.look, "hero", -26, -30, 52);
  ctx.restore();
  ctx.restore();
  drawDungeonHud(t);
}
function drawDungeonHud(t) {
  drawStatusPanel();
  const m = dg.map, label = `${dg.name}　${floorLabel(dg.style, dg.floor)}`;
  win(VW / 2 - 150, 12, 300, 38);
  text(fit(label, 280, 20), VW / 2, 22, { size: 20, align: "center" });
  // ミニマップ（歩いたところ）
  const k = 3, mw = m.w * k, mh = m.h * k, mx = VW - mw - 12, my = 12;
  ctx.fillStyle = "#000";
  ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x;
    if (!dg.seen[i]) continue;
    const tt = m.tiles[i];
    ctx.fillStyle = tt === D.WALL ? "#2a2a33" : tt === D.WATER ? "#3a6ea5" : tt === D.UP ? "#6ab0ff" : tt === D.DOWN ? "#ffb04a" : tt === D.BOSS ? "#ff5555" : tt === D.CHEST ? "#ffd866" : tt === D.SPRING ? "#7be0ff" : "#8a8a96";
    ctx.fillRect(mx + x * k, my + y * k, k, k);
  }
  if (Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = "#ffee33"; ctx.fillRect(mx + hero.tx * k - 1, my + hero.ty * k - 1, k + 2, k + 2); }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(mx - 3, my - 3, mw + 6, mh + 6);
  text(`残りの敵 ${pool.list.length}体`, VW - 12, my + mh + 12, { size: 16, align: "right", color: "#e6e1f5" });
  if (!ui.msg && !ui.choice) text("矢印／WASD：移動　Esc：メニュー　階段・宝箱・泉・ボスを さがそう", 14, VH - 12, { size: 15, base: "bottom", color: "rgba(255,255,255,0.75)" });
}

// ---- 描画：町 ----------------------------------------------------------------------------------
function drawTown(t) {
  const m = tn.map, pal = TOWN_PALS[m.pal];
  const { cx, cy, camX, camY, x0, x1, y0, y1 } = cameraFor(hero.px, hero.py, m.w, m.h, TS, VW, VH);
  ctx.fillStyle = "#1b2b1b";
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(-camX, -camY);
  const xa = Math.max(0, x0), xb = Math.min(m.w, x1), ya = Math.max(0, y0), yb = Math.min(m.h, y1);
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const tt = m.tiles[y * m.w + x], px = x * TS, py = y * TS, hh = tileHash(x, y), mx = px + TS / 2, my = py + TS / 2;
      if (tt === TT.WATER) {
        ctx.fillStyle = pal.water;
        ctx.fillRect(px, py, TS, TS);
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillRect(px + 6 + ((t * 16 + x * 9) % 30), py + 12 + hh * 20, 12, 2);
      } else if (tt === TT.PATH || tt === TT.EXIT) {
        ctx.fillStyle = pal.path;
        ctx.fillRect(px, py, TS, TS);
        ctx.fillStyle = `rgba(0,0,0,${0.04 + hh * 0.08})`;
        ctx.fillRect(px + hh * 30, py + 10 + hh * 24, 8, 4);
      } else if (tt === TT.ROOF) {
        ctx.fillStyle = tn.roofAt.get(`${x},${y}`) || "#aa4444";
        ctx.fillRect(px, py, TS, TS);
        ctx.fillStyle = "rgba(0,0,0,0.16)";
        for (let k = 1; k < 4; k++) ctx.fillRect(px, py + k * 12, TS, 2);
        if (y > 0 && m.tiles[(y - 1) * m.w + x] !== TT.ROOF) { ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(px, py, TS, 4); }
        if (m.tiles[(y + 1) * m.w + x] === TT.WALL) { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(px, py + TS - 6, TS, 6); }
      } else if (tt === TT.WALL || tt === TT.DOOR) {
        ctx.fillStyle = pal.wall;
        ctx.fillRect(px, py, TS, TS);
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(px, py + TS - 5, TS, 5);
        if (tt === TT.WALL) { ctx.fillStyle = "#35506e"; ctx.fillRect(px + 12, py + 10, TS - 24, 16); ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.fillRect(px + 12, py + 10, TS - 24, 4); }
        else {
          ctx.fillStyle = "#6e4a22";
          ctx.fillRect(px + 8, py + 4, TS - 16, TS - 4);
          ctx.fillStyle = "#4d3216";
          ctx.fillRect(px + 8, py + 4, TS - 16, 4);
          ctx.fillStyle = "#f0c34a";
          ctx.fillRect(px + TS - 18, py + 26, 4, 4);
        }
      } else {
        ctx.fillStyle = hh > 0.5 ? pal.grass : pal.grass2;
        ctx.fillRect(px, py, TS, TS);
        if (tt === TT.TREE) text(hh > 0.45 ? "🌳" : "🌲", mx, my, { size: 40, align: "center", base: "middle" });
        else if (tt === TT.FLOWER) text(hh > 0.5 ? "🌼" : "🌸", mx + (hh - 0.5) * 12, my + 6, { size: 18, align: "center", base: "middle" });
        else if (tt === TT.WELL) text("⛲", mx, my, { size: 38, align: "center", base: "middle" });
      }
      if (tt === TT.EXIT) {
        ctx.fillStyle = "rgba(255,220,80,0.22)";
        ctx.fillRect(px, py, TS, TS);
        text("▼", mx, my + 4 + Math.sin(t * 5) * 3, { size: 22, align: "center", base: "middle", color: "#ffd866" });
      }
    }
  }
  // 建物の看板：屋根の上に、絵と名前
  for (const d of m.doors) {
    const lx = d.lot[0], ly = d.lot[1];
    if (lx + 3 < x0 || lx > x1 || ly + 3 < y0 || ly > y1) continue;
    const bx = (lx + 1.5) * TS;
    text(d.icon, bx, (ly + 1) * TS + 4, { size: 32, align: "center", base: "middle" });
    const w = d.label.length * 16 + 14;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bx - w / 2, ly * TS + 8, w, 22);
    text(d.label, bx, ly * TS + 11, { size: 16, align: "center" });
  }
  // 町の人
  const facing = facingFolk();
  for (const f of m.folk) {
    if (f.x < x0 - 1 || f.x > x1 || f.y < y0 - 1 || f.y > y1) continue;
    const fx = f.x * TS + TS / 2, fy = f.y * TS + TS / 2, bob = Math.sin(t * 2.4 + f.x * 1.7) * -1.2;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(fx, fy + 16, 14, 5, 0, 0, 6.28);
    ctx.fill();
    drawPortrait(f.look, "villager", fx - 26, fy - 30 + bob, 52);
    if (f === facing && !busy) text("💬", fx + 14, fy - 38 + Math.sin(t * 6) * 2, { size: 22, align: "center", base: "middle" });
  }
  const bob = hero.moving ? Math.abs(Math.sin(t * 20)) * -4 : Math.sin(t * 3) * -1;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 16, 15, 5, 0, 0, 6.28);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy + bob - 2);
  if (hero.face < 0) ctx.scale(-1, 1);
  drawPortrait(save.look, "hero", -26, -30, 52);
  ctx.restore();
  ctx.restore();
  drawStatusPanel();
  win(VW / 2 - 150, 12, 300, 38);
  text(fit(tn.name, 280, 20), VW / 2, 22, { size: 20, align: "center" });
  if (!ui.msg && !ui.choice) text("矢印／WASD：移動　Enter：話す　Esc：メニュー　ドアの上で 店に はいる　南の出口で 町を出る", 14, VH - 12, { size: 15, base: "bottom", color: "rgba(255,255,255,0.8)" });
}

// ---- 描画：戦闘 ----------------------------------------------------------------------------
const GROUND_Y = 292;
const allyPanelH = (n) => 14 + n * 46;
const allyPanelBottom = () => 16 + allyPanelH(bs ? bs.allies.length : 1) + 8;
function drawBattle(t) {
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, "#05070f");
  g.addColorStop(0.55, bs.bg);
  g.addColorStop(1, "#05070f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);
  const en = bs.enemies, N = en.length, gap = 24;
  const sizes = en.map((e) => spriteSize(N, e.boss));
  let x = (VW - (sizes.reduce((a, b) => a + b, 0) + gap * (N - 1))) / 2;
  const target = ui.choice && ui.choice.target ? ui.choice.items[ui.choice.idx] : null;
  const focusIdx = target && target.enemyIndex != null ? target.enemyIndex : -1;
  en.forEach((e, i) => {
    const size = sizes[i], cx = x + size / 2, cy = GROUND_Y - size / 2;
    x += size + gap;
    e.cx = cx; e.cy = cy;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(cx, GROUND_Y - 4, size * 0.42, 18, 0, 0, 6.28);
    ctx.fill();
    if (e.alpha > 0.01) {
      const bob = Math.sin(t * 2.4 + i) * 5;
      ctx.save();
      ctx.globalAlpha = e.alpha * (e.flash > 0 && Math.floor(t * 30) % 2 === 0 ? 0.25 : 1) * (e.ghost ? 0.75 : 1);
      ctx.translate(cx + e.shake * Math.sin(t * 90), cy + bob);
      ctx.scale(e.scale, e.scale);
      const tier = TIER_COLORS[Math.min(TIER_COLORS.length - 1, Math.floor(e.lv / 4))];     // 強いほど、まわりが光る
      const aura = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, size * 0.78);
      aura.addColorStop(0, tier + (e.boss ? "99" : "44"));
      aura.addColorStop(1, tier + "00");
      ctx.fillStyle = aura;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(e.sprite, -size / 2, -size / 2, size, size);
      if (e.boss) text("👑", 0, -size * 0.5, { size: Math.round(size * 0.19), align: "center", base: "middle" });
      if (e.charge) text("💢", size * 0.42, -size * 0.38, { size: Math.round(size * 0.19), align: "center", base: "middle" });
      ctx.restore();
    }
    if (!e.dead) {
      text(fit(e.name, size + gap - 4, 14), cx, GROUND_Y + 8, { size: 14, align: "center", color: i === focusIdx ? "#ffd866" : "#e6e1f5" });
      bar(cx - size / 2, GROUND_Y + 28, size, 9, e.hp / e.maxHp, "#e5484d");
      if (i === focusIdx) text("▼", cx, cy - size / 2 - 14 + Math.sin(t * 8) * 3, { size: 28, align: "center", base: "middle", color: "#ffd866" });
    }
  });
  // 味方の窓
  const al = bs.allies;
  win(16, 16, 260, allyPanelH(al.length));
  al.forEach((u, i) => {
    const y = 26 + i * 46, down = u.hp <= 0;
    u.rowY = y;
    ctx.globalAlpha = down ? 0.4 : 1;
    drawPortrait(u.look, u.role, 22, y - 8, 32);
    ctx.globalAlpha = 1;
    text(fit(u.name, 112, 17), 60, y, { size: 17, color: down ? "#777" : "#fff" });
    text(`Lv.${u.lv}`, 190, y + 1, { size: 15, color: "#ffd866" });
    if (u.mp != null && u.maxMp > 0) text(`MP ${U(u.mp)}`, 262, y + 1, { size: 12, color: "#9ad1ff", align: "right" });
    if (u.flash > 0 && Math.floor(t * 30) % 2 === 0) { ctx.fillStyle = "rgba(255,70,70,0.35)"; ctx.fillRect(20, y - 4, 252, 44); }
    bar(30, y + 22, 120, 11, u.hp / u.maxHp, u.hp < u.maxHp * 0.3 ? "#e0463c" : "#4ac05a");
    text(down ? "ひんし" : U(u.hp), 262, y + 20, { size: 14, align: "right", color: down ? "#ff7777" : "#fff" });
  });
  // 見ている敵の窓（狙いを選んでいる敵、なければ先頭の敵）
  const f = focusIdx >= 0 ? en[focusIdx] : en.find((e) => !e.dead) || en[0];
  if (f) {
    win(VW - 336, 16, 320, 112);
    text(fit(f.name, 290, 18), VW - 320, 26, { size: 18 });
    text(`${SPECIES[f.cat].emoji}${SPECIES[f.cat].name}「${f.lore.title}」 Lv.${f.lv}`, VW - 320, 52, { size: 15, color: "#ffd866" });
    text(f.file.phantom ? "まぼろし　ファイルではない" : `${fmtSize(f.file.size)} ／ ${fmtAge(idleMs(f.file))} 放置${f.ghost ? "　ぼうれい" : ""}`, VW - 320, 74, { size: 15, color: "#cfd3ff" });
    bar(VW - 320, 98, 180, 14, f.hp / f.maxHp, "#e5484d");
    text(`${U(f.hp)} / ${U(f.maxHp)}`, VW - 32, 96, { size: 15, align: "right", color: "#ffb3b3" });
  }
}

// ---- 描画：弾よけ ----------------------------------------------------------------------------
const DODGE_COLOR = { image: "#ffe08a", video: "#ff8a5c", audio: "#c79bff", archive: "#9be08a", code: "#7bd7ff", exe: "#d0d6e4", doc: "#fff2c7", other: "#ff9ec7" };
function drawDodge(t) {
  const d = dodge, sim = d.sim, bx = (VW - ARENA.w) / 2, by = 132;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(0, 0, VW, VH);
  text(fit(d.label, 560, 22), VW / 2, by - 40, { size: 22, align: "center", color: "#ffd866" });
  ctx.fillStyle = "#000";
  ctx.fillRect(bx, by, ARENA.w, ARENA.h);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.strokeRect(bx - 1.5, by - 1.5, ARENA.w + 3, ARENA.h + 3);
  const col = DODGE_COLOR[d.cat] || "#fff";
  for (const b of sim.bullets) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(bx + b.x, by + b.y, b.r, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(bx + b.x - b.r * 0.25, by + b.y - b.r * 0.25, b.r * 0.4, 0, 6.28);
    ctx.fill();
  }
  if (!(sim.inv > 0 && Math.floor(t * 20) % 2 === 0)) text("♥", bx + sim.hx, by + sim.hy + 1, { size: 20, align: "center", base: "middle", color: "#ff3355" });
  bar(bx, by + ARENA.h + 12, ARENA.w, 8, 1 - sim.t / sim.dur, "#9ad1ff");
  text("矢印／WASD：よける　Esc：とばす", VW / 2, by + ARENA.h + 30, { size: 15, align: "center", color: "rgba(255,255,255,0.8)" });
}

// ---- 描画：調査中 -------------------------------------------------------------------------
function drawScan(t) {
  ctx.fillStyle = "#05070f";
  ctx.fillRect(0, 0, VW, VH);
  text("ちずを ひろげています" + ".".repeat(1 + Math.floor(t * 2) % 3), VW / 2, VH / 2 - 20, { size: 30, align: "center", base: "middle" });
  text(fit(scanInfo, 860, 18), VW / 2, VH / 2 + 30, { size: 18, align: "center", base: "middle", color: "#9a95b5" });
}

function draw(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { dpr, scale, ox, oy } = view;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VW, VH);
  ctx.clip();
  if (ui.shake > 0) ctx.translate((Math.random() - 0.5) * ui.shake * 2, (Math.random() - 0.5) * ui.shake * 2);
  if (scene === "battle" && bs) { drawBattle(t); if (dodge) drawDodge(t); }
  else if (scene === "scan") drawScan(t);
  else if (scene === "dungeon" && dg) drawDungeon(t);
  else if (scene === "town" && tn) drawTown(t);
  else drawMap(t);
  drawPops();
  drawChoice();
  drawMsg(t);
  if (ui.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${ui.flash})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  ctx.restore();
}

// ---- 更新 ---------------------------------------------------------------------------------
function update(dt) {
  ui.shake = Math.max(0, ui.shake - dt * 30);
  ui.flash = Math.max(0, ui.flash - dt * 2.5);
  for (const p of ui.pops) p.t += dt;
  ui.pops = ui.pops.filter((p) => p.t < 1.4);
  const m = ui.msg;
  if (m && !m.done) {
    if (!m.full) {
      m.shown = Math.min(m.text.length, m.shown + dt * 50);
      if (m.shown >= m.text.length) m.full = true;
    } else if (m.auto) {
      m.wait += dt;
      if (m.wait >= m.auto / 1000) finishMsg();
    }
  }
  if (bs) {
    for (const e of bs.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      e.shake = Math.max(0, e.shake - dt * 40);
      if (e.dying) { e.alpha = Math.max(0, e.alpha - dt * 1.8); e.scale = 1 + (1 - e.alpha) * 0.25; }
    }
    for (const u of bs.allies) u.flash = Math.max(0, u.flash - dt);
  }
  if (dodge) {                                                                       // 弾よけ：矢印・WASD で ハートを動かす
    const dir = { x: (held.includes("right") ? 1 : 0) - (held.includes("left") ? 1 : 0), y: (held.includes("down") ? 1 : 0) - (held.includes("up") ? 1 : 0) };
    const n = stepDodge(dodge.sim, dt, dir);
    if (n > 0) dodge.onHit(n);
    if (dodge.sim.done || dodge.skip || dodge.over) { const d = dodge; dodge = null; d.res(d.skip); }
  }
  if (scene !== "map" && scene !== "dungeon" && scene !== "town") return;
  // 歩く（会話・戦闘・メニューの最中は、新しく歩きはじめない）。歩き終えたら、着いた場所のできごと
  const dir = busy || !held.length ? null : held[held.length - 1];
  const inDg = scene === "dungeon" && dg, inTn = scene === "town" && tn;
  const r = stepWalker(hero, dt, dir, inDg ? dgCanEnter : inTn ? townCanEnter : (x, y) => WALKABLE(tileAt(x, y)));
  if (r === "arrived") runEvent(inDg ? arriveDungeon : inTn ? arriveTown : arrive);
  else if (r === "started") sfx("move");
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

// 地図の上で起きるできごとは、ここを通す（同時に2つ走らないように）
async function runEvent(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (err) { console.error("[error]", err); toast(`エラー：${err.message}`); } finally { busy = false; if (!ui.choice) clearMsg(); persist(); }
}

// ---- 調査：冒険の地・敵のプール -------------------------------------------------------------------
const createdOf = (r) => parseTime(r && r["System.DateCreated"]);
const usedTime = (r) => {
  const acc = parseTime(r && r["System.DateAccessed"]), made = createdOf(r);
  return acc > made + 3600e3 ? acc : 0;     // 作られた（OneDrive の同期・コピー）直後のアクセスは「使った」とみなさない
};
const goodCandidate = (e, limit) =>
  e.kind === "file" && e.size > 0 && e.modified && e.modified < limit && !EXCLUDE_PATH.test(e.path) &&
  !PROTECTED_EXT.has(e.ext) && !PROTECTED_NAME.has(e.name.toLowerCase());

// 冒険の地を選ぶ。本体は、IDの合わないフォルダを断る（roots.js）。IDの分かるクイックアクセスから出発して、中へたどる
const quickFolders = async () => (await ep.quickAccess.list().catch(() => [])).filter((e) => e.kind === "folder");
async function listSubfolders(ref) {
  const r = await ep.search.find(ref, { kind: "folder", hidden: false }, { depth: 1, limit: 3000 });
  return r.entries.filter((e) => e.kind === "folder" && !EXCLUDE_PATH.test(e.path + "\\")).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}
const shortPath = (p) => (p.length > 44 ? "…" + p.slice(-42) : p);

// フォルダをたどって選ぶ。「ここを えらぶ」で、そのフォルダが入る（もう一度で外れる）
async function browseFolder(chosen) {
  const qa = await quickFolders();
  const trail = [];
  let cur = null;
  for (;;) {
    if (!cur) {
      const id = await ep.ui.choose([...qa.map((e) => ({ id: "dir:" + e.path, label: `　${e.name}`, hint: e.path })), { id: "back", label: "もどる" }], { title: "どこから たどる？" });
      if (id === null || id === "back") return;
      const e = qa.find((q) => "dir:" + q.path === id);
      if (e) cur = { id: e.id, path: e.path };
      continue;
    }
    let subs;
    try { subs = await listSubfolders(cur); }
    catch (err) { console.warn(`中を見られませんでした：${cur.path}`, err.message); toast("このフォルダの中は 見られません"); cur = trail.pop() || null; continue; }
    const on = chosen.has(cur.path.toLowerCase());
    const id = await ep.ui.choose([
      { id: "pick", label: `${on ? "✔ " : "　"}ここを えらぶ`, hint: on ? "もう一度で はずれる" : "" },
      ...subs.map((e) => ({ id: "dir:" + e.path, label: `　${e.name}` })),
      { id: "up", label: "↑ もどる" },
    ], { title: shortPath(cur.path) });
    if (id === null || id === "up") { cur = trail.pop() || null; continue; }
    if (id === "pick") { const k = cur.path.toLowerCase(); if (chosen.has(k)) chosen.delete(k); else chosen.set(k, cur); return; }
    const e = subs.find((x) => "dir:" + x.path === id);
    if (e) { trail.push(cur); cur = { id: e.id, path: e.path }; }
  }
}

// ---- 冒険の地の候補を、機械的に見つける ---------------------------------------------------------
// クイックアクセスの場所ごとに、古いファイルを1回の検索で集め、フォルダごとに数と大きさを集計する（AI は使わない）。
// 大きさの検査（下限・上限）に通る場所だけを候補にして、大きさの目安といっしょに見せる。ユーザーは、選ぶだけ
const CAND_SHOWN = 12;
let candCache = null;
async function discoverCandidates() {
  const lim = limits(), stale = Date.now() - s.staleDays * DAY;
  const ck = JSON.stringify([s.staleDays, lim]);
  if (candCache && candCache.key === ck && Date.now() - candCache.at < 120e3) return candCache.found;     // 選びなおしのたびに、調べなおさない
  const qa = (await quickFolders()).filter((e) => !EXCLUDE_PATH.test(e.path + "\\"));
  const budget = { calls: 0, max: 60, until: Date.now() + 45e3, stopped: false };           // 調べる回数と時間に上限
  const lists = [];
  const visit = async (ref) => {
    if (budget.calls >= budget.max || Date.now() > budget.until) { budget.stopped = true; return; }
    budget.calls++;
    scanInfo = `${ref.path} を調べています…`;
    ep.ui.status(scanInfo).catch(() => {});
    let res;
    try { res = await ep.search.find(ref, { kind: "file", modifiedBefore: stale, hidden: false }, { limit: 5000 }); }
    catch (err) { console.warn(`候補を調べられませんでした：${ref.path}`, err.message); return; }
    if (!res.truncated) {
      const agg = aggregate(res.entries.filter((e) => goodCandidate(e, stale) && !isBogusTime(e.modified)), ref.path);
      const fit = pickFitting(agg, lim);
      for (const c of fit) Object.assign(c, outlookFromAgg(agg, c.path));          // 章・ボス・長さの見込みを添える
      lists.push(fit);
      return;
    }
    let subs = [];                                      // 多すぎて ここから下は見きれない：このフォルダは大きすぎる。中を 1つずつ調べる
    try { subs = await listSubfolders(ref); } catch (err) { console.warn(`中を見られませんでした：${ref.path}`, err.message); return; }
    for (const sub of subs) { if (budget.stopped) break; await visit({ id: sub.id, path: sub.path }); }
  };
  for (const r of qa) { if (budget.stopped) break; await visit({ id: r.id, path: r.path }); }
  const found = { list: mergeCandidates(lists, CAND_SHOWN), stopped: budget.stopped };
  candCache = { key: ck, at: Date.now(), found };
  return found;
}

// おすすめから選ぶ。選んだら、その場所だけが冒険の地になる。"manual" は、自分で さがす
async function suggestRoots() {
  const lim = limits();
  const prevScene = scene;
  scene = "scan";
  scanInfo = "冒険の地の 候補を さがしています…";
  ep.ui.status(scanInfo).catch(() => {});
  let found;
  try { found = await discoverCandidates(); }
  catch (err) { console.warn("候補を探せませんでした：", err.message); found = { list: [], stopped: false }; }
  finally { scene = prevScene; ep.ui.status(null).catch(() => {}); }
  if (!found.list.length) {
    await say(`ちょうどよい 大きさの 場所は 見つからなかった。\n古いファイルが ${lim.minCount}〜${lim.maxCount}個 ある フォルダが 候補になる。\n自分で さがそう。`);
    return "manual";
  }
  for (;;) {
    const id = await ep.ui.choose([
      ...found.list.map((c, i) => ({ id: "cand:" + i, label: shortPath(c.path), hint: describe(c, fmtSize) })),
      { id: "manual", label: "　自分で さがす…", hint: found.stopped ? "調べきれなかった場所も あります" : "クイックアクセスから たどる" },
    ], { title: "冒険の地を えらぼう" });
    if (id === null || id === "manual") return "manual";
    const c = found.list[Number(String(id).slice(5))];
    if (!c) continue;
    const ref = await refByDescent(c.path, await quickFolders(), listSubfolders).catch(() => null);
    if (!ref) { toast("この場所は 開けませんでした。ほかを えらんでください"); continue; }
    save.roots = [ref];
    persist();
    return "picked";
  }
}
async function pickRoots() {
  if ((await suggestRoots()) === "picked") return;
  await pickRootsManually();
}

// 自分で さがす：クイックアクセス・フォルダをたどる・パスを入力
async function pickRootsManually() {
  const qa = await quickFolders();
  const chosen = new Map(save.roots.map((r) => [r.path.toLowerCase(), r]));
  for (;;) {
    const items = qa.map((e) => ({ id: "qa:" + e.path, label: `${chosen.has(e.path.toLowerCase()) ? "✔ " : "　"}${e.name}`, hint: e.path }));
    for (const r of chosen.values()) if (!qa.some((e) => e.path.toLowerCase() === r.path.toLowerCase())) items.push({ id: "old:" + r.path, label: `✔ ${r.path.slice(r.path.lastIndexOf("\\") + 1) || r.path}`, hint: r.path });
    items.push({ id: "browse", label: "　フォルダを たどって えらぶ…", hint: "クイックアクセスから 中へ" }, { id: "type", label: "　パスを入力…", hint: "クイックアクセスの中の フォルダ" },
      { id: "done", label: `決定　${chosen.size}か所` });
    const id = await ep.ui.choose(items, { title: "冒険の地を選ぶ" });
    if (id === null) { if (chosen.size) break; continue; }
    if (id === "done") { if (chosen.size) break; toast("1か所以上 選んでください"); continue; }
    if (id === "browse") { await browseFolder(chosen); continue; }
    let ref = null;
    if (id.startsWith("qa:")) { const e = qa.find((q) => "qa:" + q.path === id); if (e) ref = { id: e.id, path: e.path }; }
    else if (id.startsWith("old:")) chosen.delete(id.slice(4).toLowerCase());                  // 選んであったフォルダを外す
    else if (id === "type") {
      const p = await ep.ui.ask({ label: "フォルダのパス", placeholder: "D:\\写真" });
      if (p && p.trim()) {
        const path = p.trim().replace(/[\\/]+$/, "") || p.trim();
        ref = await refByDescent(path, [...qa, ...chosen.values()], listSubfolders).catch(() => null);
        if (!ref) toast("そのフォルダは 選べません。クイックアクセスに ある フォルダの中だけ 選べます");
      }
    }
    if (!ref) continue;
    if (EXCLUDE_PATH.test(ref.path + "\\")) { toast("システムのフォルダは選べません"); continue; }
    const k = ref.path.toLowerCase();
    if (chosen.has(k)) chosen.delete(k); else chosen.set(k, ref);     // もう一度選ぶと外れる
  }
  save.roots = [...chosen.values()].slice(0, 8);
  persist();
}

// 調べる前に、冒険の地の指し方を最新にする（IDが無いものはたどって手に入れる／名前を変えた・動かしたフォルダは追いかける）
async function freshRoots() {
  const qa = await quickFolders();
  const out = [];
  for (const r of save.roots) {
    let ref = r;
    try {
      if (!r.id) ref = (await refByDescent(r.path, qa, listSubfolders)) || r;
      else { const [now] = await ep.resolve([{ id: r.id, path: r.path }]); if (now && now.kind === "folder") ref = { id: now.id || r.id, path: now.path }; }
    } catch (err) { console.warn(`冒険の地を確かめられませんでした：${r.path}`, err.message); }
    out.push(ref);
  }
  save.roots = out;
}

// 読めないフォルダは飛ばして、読めるところだけ集める。ドライブやユーザーフォルダのような広い場所は、最初から1つずつ分けて調べる
const WIDE = /^[a-z]:\\?$|\\users\\?$|\\users\\[^\\]+\\?$/i;
let lastSkipped = 0, lastAiCalls = 0;
const scanNote = () => (lastSkipped ? `\n読めなかった フォルダ ${lastSkipped}か所は とばした。` : "") + (pool.truncated ? "\n広いので 途中までを 調べた。" : "") +
  (guarded.length ? `\n鑑定士が ${guarded.length}件を 大事そうだと 守った。` : "") +
  (lastAiCalls ? `\nAIの鑑定は ${lastAiCalls}回 かかった。` : "");
async function crawl(folder, depth, c) {
  if (c.over) return;                                  // 候補が上限をはるかにこえた：これ以上は調べない
  const find = (q, o) => ep.search.find(folder, q, o);
  scanInfo = `${folder.path} を調べています…`;
  if (!WIDE.test(folder.path)) {
    try { c.take(await find({ kind: "file", modifiedBefore: c.limit, hidden: false }, { limit: 5000 })); return; }
    catch (err) {
      console.warn(`まとめて読めなかったので、分けて調べます：${folder.path}`, err.message);
      if (depth >= 5) { lastSkipped++; return; }
    }
  }
  try { c.take(await find({ kind: "file", modifiedBefore: c.limit, hidden: false }, { depth: 1, limit: 5000 })); }       // このフォルダ直下のファイル
  catch (err) { lastSkipped++; console.warn(`読めませんでした：${folder.path}`, err.message); }
  let subs;
  try { subs = (await find({ kind: "folder", hidden: false }, { depth: 1, limit: 3000 })).entries; }
  catch (err) { lastSkipped++; console.warn(`中を見られませんでした：${folder.path}`, err.message); return; }
  for (const sub of subs) {
    if (c.over) break;
    if (EXCLUDE_PATH.test(sub.path + "\\")) continue;
    await crawl({ id: sub.id, path: sub.path }, depth + 1, c);
  }
}

async function scanWorld() {
  const prev = scene;
  scene = "scan";
  lastSkipped = 0;
  lastAiCalls = 0;
  const limit = Date.now() - s.staleDays * DAY;
  const found = new Map();
  let truncated = false;
  const stopAt = abortAt(limits());
  const c = {
    over: false, limit,
    take(res) { truncated ||= res.truncated; for (const e of res.entries) if (goodCandidate(e, limit)) found.set(keyOf(e), e); if (found.size >= stopAt) this.over = true; },
  };
  try {
    await freshRoots();
    for (const r of save.roots) {
      if (c.over) break;
      scanInfo = `${r.path} を調べています…`;
      ep.ui.status(scanInfo).catch(() => {});
      await crawl(r, 0, c);
    }
    if (c.over) { ep.ui.status(null).catch(() => {}); return { ok: false, reason: "too-many", count: found.size, bytes: 0, over: true }; }       // 大きすぎる：鑑定（AI）の前に断る
    const taken = new Set([...pending.map(keyOf), ...(save.spared || [])]);     // 回収待ち・助けたファイルは敵にしない
    let list = [...found.values()].filter((e) => !taken.has(keyOf(e))).sort((a, b) => b.size - a.size).slice(0, POOL_MAX);
    const rec = await ep.recent.list().catch(() => []);       // このアプリで最近開いたものは守る
    const recent = new Set(rec.flatMap((r) => [r.id, (r.path || "").toLowerCase()]).filter(Boolean));
    list = list.filter((e) => !recent.has(e.id) && !recent.has(e.path.toLowerCase()));
    if (s.useAccessTime) {                                   // 使われた形跡があるものは守る。調べられなかったものも守る
      const keep = [];
      for (let i = 0; i < list.length; i += 200) {
        scanInfo = `使われた形跡を調べています… ${Math.min(i + 200, list.length)}/${list.length}`;
        const part = list.slice(i, i + 200);
        try {
          const res = await ep.files.properties(part, ["System.DateAccessed", "System.DateCreated"]);
          part.forEach((e, j) => {
            if (!res[j] || usedTime(res[j]) !== 0) return;
            const since = sinceOf({ modified: e.modified, created: createdOf(res[j]) });        // 日付が分からないファイルは、このPCに来た日時から数える
            if (!since || since >= limit) return;                                                 // 来て間もない・分からない：古いとは言えないので守る
            keep.push(since === e.modified ? e : { ...e, since });
          });
        } catch (err) { console.warn("アクセス日時を取れませんでした（その分は守られます）：", err.message); }
      }
      list = keep;
    } else list = list.filter((e) => !isBogusTime(e.modified));          // 作成日時を調べないときは、日付が分からないファイルは守る
    // 大きさの検査：小さすぎても、大きすぎても断る。AI を呼ぶ前にする（断るときに、トークンを使わない）
    const vol = checkVolume({ count: list.length, bytes: list.reduce((a, e) => a + e.size, 0) }, limits());
    if (!vol.ok) { ep.ui.status(null).catch(() => {}); return vol; }
    // 鑑定士：大事そうなものを守る（手元のルール判定は、AI が無くても常に働く）
    scanInfo = "鑑定士が ファイルを 見ています…";
    const now = Date.now();
    const files = list.map((e) => ({ ...e, sizeText: fmtSize(e.size), idleText: fmtAge(idleMs(e, now)) }));
    const folderName = (f) => { const d = dirOf(f.path); return d.slice(d.lastIndexOf("\\") + 1); };
    const askAi = aiReady() ? async (items) => { lastAiCalls++; try { const r = await ai.appraise(items); llmOk(); return r; } catch (err) { llmFailed(err); throw err; } } : null;
    const res = await appraiseAll(files, {
      askAi, cache: appraisal, folderOf: s.appraiseFolder ? folderName : null,
      onProgress: (a, b) => { scanInfo = `鑑定士が ファイルを 見ています… ${a}/${b}`; },
    });
    trimMap(appraisal, 3000);
    ep.storage.set("appraisal", appraisal).catch(() => {});
    const keepList = [], guard = [];
    for (const e of list) {
      const a = res.get(appraiseKey(e)) || { imp: 0, why: "", tag: "" };
      if (a.imp >= IMP_GUARD) guard.push({ id: e.id, path: e.path, name: e.name, ext: e.ext, size: e.size, modified: e.modified, ...(e.since ? { since: e.since } : {}), imp: a.imp, why: a.why, tag: a.tag });
      else keepList.push({ id: e.id, path: e.path, name: e.name, ext: e.ext, size: e.size, modified: e.modified, ...(e.since ? { since: e.since } : {}), imp: a.imp, why: a.why });
    }
    guarded = guard.slice(0, 500);
    persistGuarded();
    pool = { at: Date.now(), days: s.staleDays, truncated, list: keepList };
    if (!partDef()) save.cleared = [];                       // 部の進みは、調べなおしても 消えない
    await ep.storage.set("pool", pool).catch(() => {});
    ep.ui.status(null).catch(() => {});
  } finally { scene = prev; }
  makeOffers();
  return { ok: true };
}

// 冒険の地を調べる。大きさの検査（下限・上限）に通らなければ、理由を言う。
// pick のときは、選びなおしてもらう（最初の一度目は、通るまで。ふだんは、選びなおすか、前の冒険の地にもどるか）
async function scanFlow({ pick = false, first = false, confirm = "" } = {}) {
  const prevRoots = save.roots.map((r) => ({ ...r }));
  for (;;) {
    if (pick) await pickRoots();
    if (confirm && !(await ep.ui.confirm(confirm, { okLabel: "調べる" }))) {
      if (pick) { save.roots = prevRoots; persist(); }
      return false;
    }
    const r = await scanWorld();
    if (r.ok) {
      await ensurePart();                                                  // 冒険の地ごとに、部と島が決まる（同じ冒険の地なら、同じ部の続き）
      return true;
    }
    await sayLong(volumeMessage(r, limits(), fmtSize));
    if (!pick) return false;
    if (!first) {
      const k = await choose([{ label: "えらびなおす" }, { label: "前の 冒険の地に もどる" }], { x: 280, y: 190, w: 400, title: "この場所は 使えない" });
      if (k !== 0) { save.roots = prevRoots; persist(); return false; }
    }
  }
}
const scanReport = () => (pool.list.length ? `あたらしい 地図が できた！\n${pool.list.length}体の モンスターが うろついている。` : "モンスターは みつからなかった…\n未使用の日数を 短くしてみよう。") + scanNote();

// 戦う直前に、まだ古いままか・まだあるかを確かめる
async function freshFile(c) {
  const drop = () => { pool.list = pool.list.filter((e) => keyOf(e) !== keyOf(c)); persistPool(); return null; };
  try {
    const [en] = await ep.resolve([{ id: c.id, path: c.path }]);
    if (!en || en.kind !== "file") return drop();
    const limit = Date.now() - s.staleDays * DAY;
    const file = { ...en, size: en.size ?? c.size, modified: en.modified ?? c.modified, imp: c.imp, why: c.why };
    if (!goodCandidate(file, limit)) return drop();
    if (s.useAccessTime) {
      const [r] = await ep.files.properties([{ id: file.id, path: file.path }], ["System.DateAccessed", "System.DateCreated"]);
      if (!r || usedTime(r) !== 0) return drop();
      const since = sinceOf({ modified: file.modified, created: createdOf(r) });
      if (!since || since >= limit) return drop();
      if (since !== file.modified) file.since = since;                 // 日付が分からないファイルは、このPCに来た日時から数える
    } else if (isBogusTime(file.modified)) return drop();
    return file;
  } catch (err) {
    console.warn("確かめられませんでした：", err.message);
    return null;
  }
}

// ---- 依頼 ---------------------------------------------------------------------------------
// 手元の依頼をすぐ作り、AI が使えれば、できあがり次第 差し替える（受ける前の依頼だけ）
function makeOffers() {
  const list = enemyPool(0);
  const stats = poolStats(list, s.staleDays);
  save.offers = list.length ? localOffers(stats, save.active).map((q) => ({ ...q, local: true })) : [];
  const d = partDef();
  if (d && save.offers.length) {                                              // 困りごと：依頼の型に、その章の町の言い回しを つける
    const tr = chapterStory(partStory(), partProg().chapter).troubles;
    save.offers.forEach((q, i) => { if (!q.story && tr[i % tr.length]) q.story = tr[i % tr.length]; });
  }
  if (aiReady() && list.length) refreshOffersByAi(stats);
}
async function refreshOffersByAi(stats) {
  const ids = save.offers.map((q) => q.id).join();
  try {
    const rows = await ai.quests({
      species: Object.entries(stats.counts).map(([id, count]) => ({ id, name: SPECIES[id].name, count })),
      totalSize: fmtSize(stats.total), bossCount: stats.bossCount, ghostCount: stats.ghostCount,
    });
    llmOk();
    const out = validateAiQuests(rows, stats, save.active);
    if (out.length && save.offers.map((q) => q.id).join() === ids) save.offers = out;    // 受ける前に、手元の依頼が減っていたら、そのまま
  } catch (err) { llmFailed(err); }
}
function questProgress(f) {
  for (const q of save.active) {
    if (q.have >= q.need) continue;
    const add = progressAdd(q, f);
    q.have = Math.min(q.need, q.have + add);
    if (q.have >= q.need && add) toast(`依頼を達成！「${q.title}」→ 依頼所で報告しよう`);
  }
}
const qProgress = progressText;

// ---- 成長 ---------------------------------------------------------------------------------
async function gainExp(n) {
  save.exp += n;
  while (save.lv < 50 && save.exp >= expNeed(save.lv)) {
    save.exp -= expNeed(save.lv);
    save.lv++;
    save.hp = Math.min(hpMax(), save.hp + 13);
    save.mp = Math.min(mpMax(), save.mp + 4);
    sfx("level");
    await say(`${save.heroName}は レベル ${save.lv} に あがった！\nさいだいHP ${U(hpMax())}　さいだいMP ${U(mpMax())}`);
    for (const k of HERO_SKILLS.filter((x) => x.lv === save.lv)) await say(`${save.heroName}は 「${SKILL_DEFS[k.id].name}」を おぼえた！`);
  }
}

// ---- 戦闘 ---------------------------------------------------------------------------------
// セリフ：手元のものをすぐ返し、AI が使えれば、できあがり次第 差し替える（done は AI の返事を待つ約束）。AI に頼むのはリーダーだけ
function startLore(info, file, useAi) {
  const k = `${keyOf(file)}|${file.name}`;
  if (loreStore[k]) return { lore: { ...loreStore[k] }, done: Promise.resolve() };
  const l = LORE[info.cat] || LORE.other;
  const lore = { title: pick(l.titles), taunt: pick(l.taunt), last: pick(l.last) };
  if (!useAi || !aiReady()) return { lore, done: Promise.resolve() };
  const done = ai.lore({
    name: info.name, species: SPECIES[info.cat].name, level: info.lv, boss: info.boss, ghost: info.ghost,
    size: fmtSize(file.size), unusedFor: fmtAge(idleMs(file)),
  }).then((r) => {
    llmOk();
    Object.assign(lore, r);
    loreStore[k] = r;
    trimMap(loreStore, 200);
    ep.storage.set("lore", loreStore).catch(() => {});
  }).catch(llmFailed);
  return { lore, done };
}

// 敵のレベル：部の中は、その章のレベルの範囲と ファイルの大きさから。勇者のレベルでは 変わらない（遅れているときの上限だけ）
function enemyLvOf(file, { boss, N, P, avgLv }) {
  const d = partDef();
  const n = d ? file.chapter || chapterOf(d, file) : 0;
  if (d && n) return partEnemyLevel(d.chapters[n - 1], file.size, avgLv, { boss, nushi: boss && keyOf(file) === keyOfRef(d.nushi) });
  return enemyLevel(lvOf(file.size), avgLv, N, P, boss);
}
function makeEnemy(file, { boss, leader, N, P, avgLv }) {
  const cat = catOf(file.ext);
  const lv = enemyLvOf(file, { boss, N, P, avgLv });                    // 部の中は 章ごとに決まった範囲（勇者が育てば、弱くなる）。部のないときは、大きさ由来
  const ghost = !file.phantom && idleMs(file) > s.staleDays * 2 * DAY;
  const { lore, done } = startLore({ cat, name: file.name, lv, boss, ghost }, file, leader);
  const st = enemyStats(lv, { boss, cat }), k = partyScale(P);          // 仲間が増えたら、敵も少し強くなる
  const ez = boss ? bossEase(P) : { hp: 1, atk: 1 };                   // ボスは、ひとりのときだけ やわらげる
  st.maxHp = Math.round(st.maxHp * k.hp * ez.hp);
  st.atk *= k.atk * ez.atk;
  return {
    file, cat, lv, boss, lore, loreDone: done, name: file.name, ghost, ...st, hp: st.maxHp,
    sealed: 0, guard: false, turn: 0, charge: false, chargeTarget: null, lastHit: 0,
    dead: false, dying: false, alpha: 1, scale: 1, flash: 0, shake: 0, cx: VW / 2, cy: 200,
    sprite: getSprite(`${file.name}|${file.ext}|${file.size}`, cat, { lv, boss, ghost }),    // 同じファイルは、いつも同じ姿
  };
}

// 戦闘で、狙う敵・味方を選ぶ。1人（1体）しかいなければ、聞かずに決める
async function chooseEnemy() {
  const alive = bs.enemies.map((e, i) => ({ e, i })).filter((x) => !x.e.dead);
  if (alive.length === 1) return alive[0].e;
  const j = await choose(alive.map(({ e, i }) => ({
    label: e.name, hint: U(e.hp), enemyIndex: i,
    desc: `${SPECIES[e.cat].emoji}${SPECIES[e.cat].name}　${fmtSize(e.file.size)}　${e.file.phantom ? "まぼろし" : `${fmtAge(idleMs(e.file))} 放置`}` + (e.file.imp >= IMP_DOUBT ? `　鑑定：${e.file.why || "大事かもしれない"}` : ""),
  })), { x: 16, y: allyPanelBottom(), w: 330, title: "どれを ねらう？", target: true });
  return j >= 0 ? alive[j].e : null;
}
async function chooseAlly({ down = false } = {}) {
  const list = bs.allies.filter((a) => (down ? a.hp <= 0 : a.hp > 0));
  if (!list.length) return null;
  if (bs.allies.length === 1) return list[0];
  const j = await choose(list.map((a) => ({ label: `${a.emoji}${a.name}`, hint: a.hp <= 0 ? "ひんし" : U(a.hp) })), { x: 16, y: allyPanelBottom(), w: 300, title: "だれに？" });
  return j >= 0 ? list[j] : null;
}

async function commandMenu(u) {
  const x = 16, y = allyPanelBottom();
  for (;;) {
    const i = await choose([{ label: "たたかう" }, { label: "とくぎ" }, { label: "ぼうぎょ" }, { label: "どうぐ" }, { label: "にげる" }],
      { x, y, w: 170, cancel: false, title: bs.allies.length > 1 ? fit(u.name, 140, 20) : "" });
    if (i === 0) { const t = await chooseEnemy(); if (t) return { type: "attack", target: t }; continue; }
    if (i === 2) return { type: "defend" };
    if (i === 4) return { type: "flee" };
    if (i === 1) {
      if (!u.skills.length) { await say(`${u.name}は まだ とくぎを おぼえていない。`, { auto: 700 }); continue; }
      const list = u.skills.map((id) => ({ id, def: SKILL_DEFS[id], cost: Math.max(1, SKILL_DEFS[id].mp - (u.mpCut || 0)) }));
      const j = await choose(list.map((k) => ({ label: k.def.name, hint: `MP ${U(k.cost)}`, desc: k.def.desc, disabled: u.mp < k.cost })), { x: x + 180, y, w: 330, title: "とくぎ" });
      if (j < 0) continue;
      const { id, def } = list[j];
      let target = null;
      if (def.kind === "dmg" || def.kind === "seal") { target = await chooseEnemy(); if (!target) continue; }
      else if (def.kind === "heal1") { target = await chooseAlly(); if (!target) continue; }
      else if (def.kind === "revive") {
        target = await chooseAlly({ down: true });
        if (!target) { await say("たおれた 仲間は いない。", { auto: 700 }); continue; }
      }
      return { type: "skill", skill: id, target };
    } else if (i === 3) {
      const keys = Object.keys(ITEMS).filter((k) => (save.inv.item[k] || 0) > 0);
      if (!keys.length) { await say("どうぐを もっていない。", { auto: 600 }); continue; }
      const j = await choose(keys.map((k) => ({ label: ITEMS[k].name, hint: `×${save.inv.item[k]}`, desc: ITEMS[k].desc })), { x: x + 180, y, w: 330, title: "どうぐ" });
      if (j < 0) continue;
      const id = keys[j];
      let target = null;
      if (id === "herb" || id === "herb2" || id === "ether") { target = await chooseAlly(); if (!target) continue; }
      return { type: "item", item: id, target };
    }
  }
}

// 敵の こうげき1回ぶんの 弾よけ。full：ふだんのダメージ。1発ごとに、その半分（上限 1.5倍）。ハートの HP は その場で へる。
// statusOnly：ねむり・めくらましの技（当たったかどうかだけ）。skip（Esc）：ふだんのダメージを そのまま 受ける
const useDodge = (t) => s.dodge !== false && t.kind === "hero" && t.hp > 0 && !(t.st.asleep > 0);
async function dodgePhase(e, t, full, mul, { statusOnly = false } = {}) {
  const alive = bs ? bs.enemies.filter((x) => !x.dead).length : 1;
  const sim = newDodge({ seed: (Math.random() * 4294967295) >>> 0, cat: e.cat, boss: !!e.boss, intensity: mul, duration: alive >= 3 ? 2.6 : null });
  const ph = perHit(full), cap = Math.round(full * DAMAGE_CAP);
  let total = 0;
  const hurt = (d) => { total += d; t.hp -= d; t.flash = 0.4; ui.shake = 7; sfx("hurt"); pop(130, (t.rowY || 40) + 10, U(d), "#ff7777"); };
  const skipped = await new Promise((res) => {
    dodge = {
      sim, res, skip: false, over: false, cat: e.cat, label: `${e.name}の こうげき！ よけろ！`,
      onHit(n) {
        for (let k = 0; k < n; k++) {
          if (statusOnly) { sfx("hurt"); ui.shake = 5; continue; }
          const d = Math.min(ph, cap - total, t.hp);
          if (d > 0) hurt(d);
        }
        if (t.hp <= 0) dodge.over = true;
      },
    };
  });
  if (skipped) {
    if (statusOnly) return { hits: 1, total: 0, skipped: true };
    const d = Math.min(Math.max(0, full - total), t.hp);
    if (d > 0) hurt(d);
    return { hits: Math.max(sim.hits, 2), total, skipped: true };
  }
  return { hits: sim.hits, total };
}

async function battle(files, { boss = false, bg = "#1f4a2a" } = {}) {
  const allies = partyUnits();
  const P = allies.length, avgLv = allies.reduce((t, a) => t + a.lv, 0) / P;
  const enemies = files.map((f, i) => makeEnemy(f, { boss: boss && i === 0, leader: i === 0, N: files.length, P, avgLv }));
  const N = enemies.length, leader = enemies[0];
  bs = { enemies, allies, bg };
  const heroU = allies[0];
  const rewards = { exp: 0, gold: 0, mats: {}, files: 0, steal: 0, ph: 0 };
  let result = null;
  scene = "battle";
  ui.flash = 1;
  sfx("encounter");
  await Promise.race([leader.loreDone, sleep(1800)]);                 // AI の二つ名・セリフを少しだけ待つ。間に合わなければ手元のもの
  if (N === 1) await say(`${boss ? "ボス！ " : ""}${SPECIES[leader.cat].name}「${leader.lore.title}」が あらわれた！\n${leader.name}`);
  else await say(`${boss ? "ボス！ " : ""}${SPECIES[leader.cat].name}「${leader.lore.title}」の 一味が あらわれた！\n${N}体： ${enemies.slice(0, 3).map((e) => e.name).join("、")}${N > 3 ? " ほか" : ""}`);
  await say(`「${leader.lore.taunt}」`, { auto: 800 });
  const doubt = enemies.filter((e) => e.file.imp >= IMP_DOUBT).sort((a, b) => b.file.imp - a.file.imp)[0];
  if (doubt) await say(`鑑定士の ひとこと\n「${doubt.name}」は ${doubt.file.why || "大事かもしれない"}。\nよく 考えて たたかおう。`, { auto: 1500 });

  const aliveE = () => enemies.filter((e) => !e.dead);
  const aliveA = () => allies.filter((a) => a.hp > 0);
  const thief = () => aliveA().some((a) => a.role === "thief");

  // 敵を倒した：ごほうびを数えて、ファイルは「回収待ち」にためる（ごみ箱へ送るのは、あとで回収所から）
  const onDown = async (e) => {
    e.dead = true;
    e.dying = true;
    sfx("win");
    if (e.file.phantom) {                                              // まぼろし：回収待ちには ならない。経験値は 3割。ゴールドも 素材も 無し
      rewards.exp += Math.round(enemyExp(e.lv, e.boss, e.ghost) * PHANTOM_EXP_RATE);
      rewards.ph++;
      if (e === leader || e.boss) await say(`「${e.lore.last}」`, { auto: 900 });
      await say(`${e.name}は すうっと きえていった。`, { auto: 700 });
      return;
    }
    rewards.exp += enemyExp(e.lv, e.boss, e.ghost);
    rewards.gold += enemyGold(e.lv, e.boss);
    const drops = rollDrops(e.cat, e.lv, { boss: e.boss, thief: thief(), extra: accEffect("mats") });
    addAll(save.inv.mat, drops);
    addAll(rewards.mats, drops);
    save.kills++;
    pending.push({ id: e.file.id, path: e.file.path, name: e.file.name, size: e.file.size });
    save.log = [...(save.log || []), { species: SPECIES[e.cat].name, size: fmtSize(e.file.size), unusedFor: fmtAge(idleMs(e.file)), boss: e.boss }].slice(-20);
    pool.list = pool.list.filter((p) => keyOf(p) !== keyOf(e.file));
    rewards.files++;
    persistPending();
    persistPool();
    mirrorToCollection(e.file);
    questProgress({ cat: e.cat, size: e.file.size, ghost: e.ghost, boss: e.boss });
    if (e === leader || e.boss) await say(`「${e.lore.last}」`, { auto: 900 });
    await say(`${e.name}を たおした！`, { auto: 700 });
  };

  // 味方が敵にダメージを与える。与えたダメージ（外れたら 0）を返す
  const strikeEnemy = async (u, e, { mul = 1, acc = 0.97, crit = true, forceCrit = false, pierce = false, brief = false } = {}) => {
    if (e.dead) return 0;
    if ((u.st.blind > 0 && Math.random() < 0.5) || Math.random() > acc) { await say(`ミス！ ${e.name}に ダメージを あたえられない！`, { auto: 600 }); return 0; }
    if (e.ghost && Math.random() < 0.2) { await say(`${e.name}は すうっと すりぬけた！`, { auto: 600 }); return 0; }
    const isCrit = forceCrit || (crit && Math.random() < u.crit);
    if (isCrit && !brief) await say("かいしんの いちげき！！", { auto: 450 });
    const w = u.kind === "hero" ? gear().weapon : null;
    const aff = w && w.affinity === e.cat ? AFFINITY_BONUS : 1;
    const defense = pierce ? e.def * 0.25 : e.def * 0.5;
    const dmg = Math.max(1, Math.round((u.atk * rnd(0.85, 1.15) - defense) * mul * (isCrit ? 2 : 1) * (e.guard ? 0.5 : 1) * aff));
    e.hp = Math.max(0, e.hp - dmg);
    e.lastHit = dmg;
    e.flash = 0.35;
    e.shake = 10;
    pop(e.cx, e.cy, U(dmg), isCrit ? "#ffd866" : "#fff");
    sfx(isCrit ? "crit" : "hit");
    await say(`${e.name}に ${U(dmg)} の ダメージ！${brief ? "" : `\nのこり ${U(e.hp)}`}`, { auto: brief ? 500 : 700 });
    if (e.hp <= 0) await onDown(e);
    return dmg;
  };
  const healUnit = async (u, amount, label) => {
    const real = Math.min(u.maxHp - u.hp, Math.max(0, Math.round(amount)));
    u.hp = Math.min(u.maxHp, u.hp + Math.round(amount));
    sfx("heal");
    await say(`${label}\n${u.name}の HPが ${U(real)} かいふくした！`, { auto: 750 });
  };
  const healBonus = () => 1 + accEffect("heal");

  const allyAct = async (u, act) => {
    if (!act) act = autoAction(u, allies, aliveE());
    if (act.type === "sleep") return;
    if (act.type === "defend") { u.st.guard = true; await say(`${u.name}は みを まもっている！`, { auto: 550 }); return; }
    if (act.type === "flee") {
      if (aliveE().some((e) => e.boss)) { await say(`${u.name}は にげだした！\nしかし まわりこまれてしまった！`, { auto: 800 }); return; }
      const sp = (list) => list.reduce((t, x) => t + x.spd, 0) / list.length;
      if (Math.random() < clamp(0.55 + (sp(aliveA()) - sp(aliveE())) * 0.03 + accEffect("flee"), 0.2, 0.95)) { await say("みんなは にげだした！", { auto: 600 }); result = "flee"; }
      else await say("しかし まわりこまれてしまった！", { auto: 700 });
      return;
    }
    let target = act.target || null;            // 敵（kind なし）か味方（kind あり）。倒れていたら、使う側で選びなおす
    if (act.type === "attack") {
      if (!target || target.dead || target.kind) target = pickEnemy(aliveE());
      if (!target) return;
      await say(`${u.name}の こうげき！`, { auto: 450 });
      await strikeEnemy(u, target, {});
      return;
    }
    if (act.type === "item") {
      save.inv.item[act.item]--;
      const t = act.target;
      if (act.item === "herb" || act.item === "herb2") {
        const tgt = t && t.hp > 0 ? t : aliveA().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        await healUnit(tgt, (act.item === "herb" ? 50 + save.lv * 2 : 120 + save.lv * 4) * healBonus(), `${u.name}は ${ITEMS[act.item].name}を つかった！`);
      } else if (act.item === "ether") {
        const tgt = t && t.hp > 0 ? t : u;
        tgt.mp = Math.min(tgt.maxMp, tgt.mp + 25);
        sfx("heal");
        await say(`${u.name}は せいすいを つかった！\n${tgt.name}の MPが かいふくした！`, { auto: 750 });
      } else if (act.item === "smoke") {
        if (aliveE().some((e) => e.boss)) await say("けむりだまを つかった！\nしかし にげられない！", { auto: 800 });
        else { await say("けむりだまで みんなは にげだした！", { auto: 700 }); result = "flee"; }
      } else if (act.item === "bomb") {
        await say(`${u.name}は ばくだんを なげた！`, { auto: 550 });
        sfx("magic");
        for (const e of aliveE()) {
          const dmg = Math.max(1, Math.round((25 + save.lv * 5) * rnd(0.9, 1.1)));
          e.hp = Math.max(0, e.hp - dmg);
          e.flash = 0.35; e.shake = 10;
          pop(e.cx, e.cy, U(dmg), "#ffb347");
          await say(`${e.name}に ${U(dmg)} の ダメージ！`, { auto: 450 });
          if (e.hp <= 0) await onDown(e);
        }
      }
      return;
    }
    if (act.type === "skill") {
      const def = SKILL_DEFS[act.skill];
      const cost = Math.max(1, def.mp - (u.mpCut || 0));
      if (u.mp < cost) { await say(`${u.name}は MPが たりない！`, { auto: 600 }); return; }
      u.mp -= cost;
      sfx("magic");
      if (def.kind === "dmg") {
        if (!target || target.dead || target.kind) target = pickEnemy(aliveE());
        if (!target) return;
        await say(`${u.name}の ${def.name}！`, { auto: 500 });
        for (let h = 0; h < (def.hits || 1); h++) {
          const cur = target.dead ? pickEnemy(aliveE()) : target;
          if (!cur) break;
          const dealt = await strikeEnemy(u, cur, { mul: def.mul, acc: def.acc, crit: !!def.crit || false, forceCrit: !!def.crit, pierce: !!def.pierce, brief: (def.hits || 1) > 1 });
          if (def.steal && dealt && Math.random() < 0.6) {
            const m = { [matId(cur.cat, 1)]: 1 };
            addAll(save.inv.mat, m);
            addAll(rewards.mats, m);
            await say(`${u.name}は ${matInfo(matId(cur.cat, 1)).name}を ぬすんだ！`, { auto: 700 });
          }
        }
      } else if (def.kind === "dmgAll") {
        await say(`${u.name}の ${def.name}！`, { auto: 500 });
        for (const e of aliveE()) await strikeEnemy(u, e, { mul: def.mul, acc: def.acc, crit: false, pierce: !!def.pierce, brief: true });
      } else if (def.kind === "heal1") {
        const tgt = target && target.hp > 0 ? target : aliveA().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        await healUnit(tgt, (def.base + def.perLv * u.lv + rnd(0, def.rand || 0)) * healBonus(), `${u.name}は ${def.name}を となえた！`);
      } else if (def.kind === "healAll") {
        await say(`${u.name}は ${def.name}を となえた！`, { auto: 500 });
        for (const a of aliveA()) a.hp = Math.min(a.maxHp, a.hp + Math.round((def.base + def.perLv * u.lv) * healBonus()));
        sfx("heal");
        await say("みんなの HPが かいふくした！", { auto: 700 });
      } else if (def.kind === "revive") {
        const tgt = target && target.hp <= 0 ? target : allies.find((a) => a.hp <= 0);
        if (!tgt) { await say("しかし だれも たおれていない！", { auto: 600 }); return; }
        tgt.hp = Math.max(1, Math.round(tgt.maxHp * 0.5));
        sfx("heal");
        await say(`${u.name}は ${def.name}を となえた！\n${tgt.name}が 起きあがった！`, { auto: 800 });
      } else if (def.kind === "guardAll") {
        for (const a of aliveA()) a.st.guard = true;
        await say(`${u.name}の ${def.name}！\nみんなの まもりが 高まった！`, { auto: 700 });
      } else if (def.kind === "seal") {
        if (!target || target.dead || target.kind) target = pickEnemy(aliveE());
        if (!target) return;
        await say(`${u.name}は ${def.name}を となえた！`, { auto: 600 });
        if (Math.random() < (target.boss ? 0.4 : 0.8)) { target.sealed = 2; await say(`${target.name}は うごけなくなった！`, { auto: 700 }); }
        else await say("しかし こうかが なかった！", { auto: 700 });
      }
    }
  };

  // 敵が味方にダメージを与える
  const enemyHit = async (e, t, mul) => {
    const w = t.kind === "hero" ? gear().armor : null;
    const affDef = w && w.affinity === e.cat ? AFFINITY_BONUS : 1;
    const guardF = t.st.guard ? (t.kind === "hero" && accEffect("guard") ? accEffect("guard") : 0.5) : 1;
    const dmg = Math.max(1, Math.round((e.atk * rnd(0.85, 1.15) - t.def * 0.5) * mul * guardF / affDef));
    if (useDodge(t)) {                                                                  // 勇者がねらわれた：弾よけ。かわせば 0・当たるごとに ふだんの半分
      const r = await dodgePhase(e, t, dmg, mul);
      if (!r.hits) { await say(`${t.name}は うまく かわした！`, { auto: 700 }); return 0; }
      await say(`${t.name}は ${U(r.total)} の ダメージを うけた！${t.hp <= 0 ? `\n${t.name}は たおれた！` : ""}`, { auto: t.hp <= 0 ? 900 : 700 });
      return r.total;
    }
    t.hp = Math.max(0, t.hp - dmg);
    t.flash = 0.4;
    ui.shake = 9;
    sfx("hurt");
    pop(130, (t.rowY || 40) + 10, U(dmg), "#ff7777");
    await say(`${t.name}は ${U(dmg)} の ダメージを うけた！${t.hp <= 0 ? `\n${t.name}は たおれた！` : ""}`, { auto: t.hp <= 0 ? 900 : 700 });
    return dmg;
  };

  // 状態異常の技：勇者なら 弾よけで 当たったときだけ かかる（null：弾よけでない。ふつうの判定）
  const statusHit = async (e, t) => (useDodge(t) ? (await dodgePhase(e, t, 1, 1, { statusOnly: true })).hits > 0 : null);
  const dodged = (t) => say(`${t.name}は うまく かわした！`, { auto: 700 });
  const SPECIES_MOVE = {
    image: async (e, t) => { await say(`${e.name}の まどわしのひかり！`, { auto: 700 }); const hit = await statusHit(e, t); if (hit === false) { await dodged(t); return; } t.st.blind = 2; await say(`${t.name}は めがくらんだ！`, { auto: 900 }); },
    video: async (e, t) => { await say(`${e.name}は ほのおの ブレスを はいた！`, { auto: 600 }); await enemyHit(e, t, 1.7); },
    audio: async (e, t) => {
      await say(`${e.name}は ねむりのうたを うたった！`, { auto: 700 });
      const hit = await statusHit(e, t);
      if (hit === false) { await dodged(t); return; }
      if (hit === true || Math.random() < 0.6) { t.st.asleep = 1; await say(`${t.name}は ねむってしまった！`, { auto: 700 }); } else await say(`${t.name}は ねむらなかった！`, { auto: 600 });
    },
    archive: async (e, t) => { await say(`${e.name}は ガブッと かみついた！`, { auto: 600 }); await enemyHit(e, t, 1.4); },
    code: async (e, t) => { await say(`${e.name}は バグった！`, { auto: 600 }); await enemyHit(e, t, rnd(0.3, 2.2)); },
    exe: async (e) => { e.guard = true; await say(`${e.name}は ガードを かためた！`, { auto: 700 }); },
    other: async (e, t) => { await say(`${e.name}は ${t.name}の わざを まねた！`, { auto: 600 }); await enemyHit(e, t, clamp(e.lastHit / Math.max(1, e.atk), 0.6, 2)); },
    doc: async (e, t) => {
      if (e.hp >= e.maxHp * 0.6) { await say(`${e.name}の こうげき！`, { auto: 450 }); await enemyHit(e, t, 1); return; }
      const g = Math.round(e.maxHp * 0.25);
      e.hp = Math.min(e.maxHp, e.hp + g);
      sfx("heal");
      await say(`${e.name}は 古い版を よみがえらせた！\nHPが かいふくした！`, { auto: 800 });
    },
  };
  // AI が考えた技：決まった部品の組み合わせだけ。強さは、検査した範囲に収まっている
  const aiMove = async (e, t, sk) => {
    await say(`${e.name}の ${sk.name}！\n${sk.msg}`, { auto: 900 });
    if (sk.effect === "damage") await enemyHit(e, t, sk.power);
    else if (sk.effect === "drain") { const d = await enemyHit(e, t, clamp(sk.power, 0.6, 1.2)); e.hp = Math.min(e.maxHp, e.hp + Math.round(d * 0.5)); }
    else if (sk.effect === "heal") { e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * clamp(sk.power * 0.12, 0.1, 0.25))); sfx("heal"); await say(`${e.name}の HPが かいふくした！`, { auto: 700 }); }
    else if (sk.effect === "sleep") { const hit = await statusHit(e, t); if (hit === false) { await dodged(t); return; } if (hit === true || Math.random() < 0.6) { t.st.asleep = 1; await say(`${t.name}は ねむってしまった！`, { auto: 700 }); } else await say(`${t.name}は ねむらなかった！`, { auto: 600 }); }
    else if (sk.effect === "blind") { const hit = await statusHit(e, t); if (hit === false) { await dodged(t); return; } t.st.blind = 2; await say(`${t.name}は めがくらんだ！`, { auto: 700 }); }
    else if (sk.effect === "guard") { e.guard = true; await say(`${e.name}は ガードを かためた！`, { auto: 700 }); }
  };

  const enemyAct = async (e) => {
    e.guard = false;
    if (e.sealed > 0) { e.sealed--; await say(`${e.name}は ふういんされていて うごけない！`, { auto: 700 }); return; }
    let t = pickAlly(allies);
    if (!t) return;
    if (e.boss) {
      if (e.charge) {
        e.charge = false;
        const ct = e.chargeTarget && e.chargeTarget.hp > 0 ? e.chargeTarget : t;
        await say(`${e.name}の つうこんの いちげき！`, { auto: 600 });
        await enemyHit(e, ct, 2.4);
        return;
      }
      if (e.turn % 3 === 1) { e.charge = true; e.chargeTarget = t; await say(`${e.name}は ${t.name}を ねらって ちからを ためている…！`, { auto: 1000 }); return; }
    }
    if (Math.random() < (e.boss ? 0.35 : 0.28)) {
      const sk = e.lore.skill;
      if (sk) { await aiMove(e, t, sk); return; }
      await SPECIES_MOVE[e.cat](e, t);
      return;
    }
    await say(`${e.name}の こうげき！`, { auto: 450 });
    await enemyHit(e, t, 1);
  };

  // ---- 戦闘の本体：1ラウンドごとに、入力 → すばやさ順に実行 ----
  while (!result) {
    const acts = new Map();
    for (const u of aliveA()) {
      if (u.st.asleep > 0) { u.st.asleep--; acts.set(u, { type: "sleep" }); await say(`${u.name}は ねむっている…`, { auto: 650 }); continue; }
      if (u.kind === "hero" || s.autoParty === "manual") acts.set(u, await commandMenu(u));
    }
    const queue = [];
    for (const u of aliveA()) { const a = acts.get(u) || null; queue.push({ u, act: a, spd: u.spd + rnd(0, 6) + (a && (a.type === "defend" || a.type === "item") ? 100 : 0) }); }
    for (const e of aliveE()) queue.push({ e, spd: e.spd + rnd(0, 6) });
    queue.sort((a, b) => b.spd - a.spd);
    for (const q of queue) {
      if (result) break;
      if (q.u) { if (q.u.hp <= 0) continue; await allyAct(q.u, q.act); }
      else { if (q.e.dead) continue; await enemyAct(q.e); }
      if (!aliveE().length) result = "win";
      else if (heroU.hp <= 0) result = "lose";
    }
    for (const a of allies) { a.st.guard = false; a.st.blind = Math.max(0, a.st.blind - 1); }
    for (const e of aliveE()) e.turn++;
  }

  // ---- 戦闘のあと ----
  const goldBonus = 1 + accEffect("gold"), expBonus = 1 + accEffect("exp");
  const gold = Math.round(rewards.gold * goldBonus), exp = Math.round(rewards.exp * expBonus);
  if (rewards.files) {
    save.gold += gold;
    let drop = "";
    if (Math.random() < 0.18 * Math.min(2, rewards.files)) { save.inv.item.herb++; drop = "\nやくそうを てにいれた！"; }
    const mats = Object.entries(rewards.mats).map(([id, n]) => `${matInfo(id).name}×${n}`);
    const matLine = mats.length ? `\n素材： ${mats.slice(0, 4).join("、")}${mats.length > 4 ? " ほか" : ""}` : "";
    await sleep(500);
    await say(`けいけんち ${exp} ポイントと ${gold} ゴールドを かくとく！\n${rewards.files}体が 回収待ちに なった。${matLine}${drop}`);
  }
  if (!rewards.files && rewards.ph) {
    await sleep(400);
    await say(`けいけんち ${exp} ポイントを かくとく！\nまぼろしは 回収待ちに ならない。`);
  }
  if (result === "win" || result === "flee") {
    for (const a of allies) if (a.kind === "friend") { if (a.hp <= 0) a.hp = 1; if (result === "win") a.fr.bond = (a.fr.bond || 0) + 1; }
  }
  if (rewards.files || rewards.ph) await gainExp(exp);
  if (result === "lose") {
    sfx("lose");
    await say(`${save.heroName}は たおれてしまった…`);
    save.gold = Math.floor(save.gold / 2);
    save.hp = hpMax();
    save.mp = mpMax();
    for (const f of save.friends) { f.hp = null; f.mp = null; }
    clearDungeon();                                                     // ダンジョンの中で負けたら、町に戻る
    const home = world.towns[save.home] || world.towns[0];
    Object.assign(hero, { tx: home.x, ty: home.y, px: home.x, py: home.y, moving: false });
    save.x = home.x;
    save.y = home.y;
    await say("目がさめると 町の ベッドの上だった。\n所持金が はんぶんに なった。");
  }
  scene = dg ? "dungeon" : "map";
  bs = null;
  held.length = 0;
  persist();
  return result;
}

// 回収待ちをコレクションにも入れておく（エクスプローラからも見える。失敗しても遊びには影響しない）
let colId = null;
async function mirrorToCollection(file) {
  try {
    if (!colId) {
      const name = "ファイル・クエスト 討伐済み", old = "討伐済み（ファイル・クエスト）";
      const col = (await ep.collections.list()).find((c) => c.name === name || c.name === old) || (await ep.collections.create(name, { color: "#e5484d" }));
      colId = col.id;
    }
    await ep.collections.add(colId, [{ id: file.id, path: file.path }]);
  } catch (err) { console.warn("コレクションに入れられませんでした：", err.message); }
}

// ---- 部：1つの冒険の地が、1つの部になる ------------------------------------------------------------
// 部（章・ボス・ぬし・町と遺跡の名前）は parts.js が、物語の設計図は story.js が、進み方のルールは campaign.js が決める。ここは、画面とつなぐ部分。
// 部は、冒険の地を調べた直後に つくって、保存して凍結する（同じ冒険の地・同じセーブなら 同じ部。フォルダの中身が変わっても 筋は変わらない）。
// 部が つくれないほど小さいときだけ、部なしで（島の遺跡のボス＝いちばん大きい敵）遊ぶ。
const bossKeys = () => { const d = partDef(); return new Set(d ? [...d.chapters.flatMap((c) => c.bosses), d.nushi].map(keyOfRef) : []); };

// 敵になるファイル：部の中では、封印が解けている章のファイル（ボスは、ボス戦だけ）。chapter があれば、その章だけ
function enemyPool(chapter = 0) {
  const d = partDef();
  if (!d) return pool.list;
  const pr = partProg(), boss = bossKeys();
  return pool.list.filter((f) => {
    if (boss.has(keyOf(f))) return false;
    const n = chapterOf(d, f);
    return chapter ? n === chapter : n >= 1 && n <= pr.chapter;
  });
}
// 倒した章が、地図の遺跡に 映る（save.cleared は、遺跡の見た目と、再開の判定に使う）
function syncCleared() {
  const d = partDef(), pr = partProg();
  if (d) save.cleared = d.chapters.filter((c) => chapterCleared(d, pr, c.n)).map((c) => c.n - 1);
}

// 物語の設計図：AI が使えれば1回頼む。使えない・失敗・おかしな返事のときは、テンプレート（どちらも同じ形）
async function makeStory(def) {
  const ctx = { prev: recentSummaries(save.series), threads: save.series.threads, heroName: save.heroName, heroLv: save.lv, allowFolder: !!s.appraiseFolder };
  let story = buildStory(def, ctx);
  if (aiReady()) {
    ep.ui.status("物語を 考えています…").catch(() => {});
    try { const raw = await ai.story(aiBrief(def, ctx)); llmOk(); story = validateStory(raw, story); }
    catch (err) { llmFailed(err); }
    finally { ep.ui.status(null).catch(() => {}); }
  }
  return story;
}

// 冒険の地を調べたあと：部をつくる（同じ部が すでにあれば、続きから）。島も、部の形に合わせる
async function ensurePart() {
  const roots = save.roots.map((r) => r.path);
  const probe = pool.list.length >= 6 ? buildPart({ files: pool.list, roots, seed: save.seed, at: Date.now() }) : null;
  if (!probe) {                                                           // 小さすぎて 部にならない：部なしで 遊ぶ
    save.activePart = null;
    const sd = islandSeedFor(save.roots);
    if (sd !== save.islandSeed || world.towns.length !== 3) setIsland(sd);
    return null;
  }
  let rec = save.parts[probe.id];
  const fresh = !rec;
  if (fresh) {
    rec = { def: probe, loc: null, progress: newProgress(), story: null };
    save.parts[probe.id] = rec;
    const ids = Object.keys(save.parts);                                   // 保存しておく部は 12まで（いまの部と、終えた部が 新しい順に）
    for (const id of ids) { if (Object.keys(save.parts).length <= PARTS_MAX) break; if (id !== probe.id) delete save.parts[id]; }
  }
  save.activePart = probe.id;
  const seed = hashStr(probe.id);
  if (save.islandSeed !== seed || world.towns.length !== rec.def.island.towns || world.ruins.length !== rec.def.island.ruins) setIsland(seed);
  syncCleared();
  if (fresh) {
    rec.story = await makeStory(rec.def);
    persist();
    await introPart(rec);
    await enterTown(0);                                                  // はじまりの町へ。章1の物語と、さいしょの仲間（ミナ）が ここで加わる
  } else if (!rec.story) rec.story = buildStory(rec.def);
  persist();
  return rec;
}
async function introPart(rec) {
  const st = rec.story, o = outlookOfPart(rec.def), no = save.series.done.length + 1;
  sfx("level");
  await say(`第${no}部\n「${st.title}」`, { auto: 1400 });
  for (const p of st.intro) await sayPages(p, 96);
  await say(`この 冒険は ${o.chapters}章。ボスは ぜんぶで ${o.bosses}体。\nおよそ ${fmtMinutes(o.minutes)} の 旅に なる。`);
  await say(`まずは ${rec.def.chapters[0].town}へ。\n${rec.def.chapters[0].ruinName}の おくに、さいしょの ボスが いる。`);
}

// いまの目的地（物語の窓・町の人が 話す）
function goalText() {
  const d = partDef(), pr = partProg();
  if (!d) return "";
  if (pr.done) return "ぬしは しずまった。つぎの 冒険の地を えらぼう。";
  const n = pr.chapter, c = d.chapters[n - 1];
  const i = c.bosses.findIndex((_, k) => !bossBeaten(pr, n, k));
  const b = c.bosses[i < 0 ? c.bosses.length - 1 : i];
  return `次は ${c.ruinName}。ボスは「${cleanText(b.name, 20)}」らしい。`;
}
const nushiLine = () => {
  const d = partDef(), pr = partProg(), st = partStory();
  if (!d) return "";
  const got = fragCount(pr), total = fragTotal(d);
  return `ぬしの 名前は「${maskedName(st.nushi.name, revealedChars(st.nushi.name, got, total))}」らしい。`;
};

// 章の町に はじめて入ったとき：小さな物語を語る。仲間が加わる。困りごとが 出る
async function townStory(n) {
  const d = partDef(), pr = partProg(), st = partStory();
  if (!d || pr.told[n]) return;
  pr.told[n] = true;
  const cs = chapterStory(st, n);
  await say(`第${n}章　${d.chapters[n - 1].town}`, { auto: 900 });
  for (const pg of cs.tale) await say(pg);
  if (cs.cleaner) await say(cs.cleanerLine);
  makeOffers();
  persist();
}
// ボスと戦う：ボスは、凍結した部に決まっているファイル。戦う直前に 確かめて、もう使えなければ、まぼろしが 姿を借りる
async function partBoss(ref, n) {
  const P = partySize();
  let leader = null;
  const have = pool.list.find((f) => keyOf(f) === keyOfRef(ref));
  if (have) leader = await freshFile(have);
  if (!leader) leader = { ...phantomFor("other", ref.size), name: ref.name, ext: ref.ext, phantom: true, chapter: n, modified: Date.now() - s.staleDays * 1.1 * DAY };
  const minions = leader.phantom ? [] : pickFollowers(enemyPool(n), leader, bossMinions(P), { maxSize: BOSS_BYTES });
  const fresh = leader.phantom ? [leader] : await Promise.all([leader, ...minions].map((f) => (f === leader ? f : freshFile(f))));
  return battle(fresh.filter(Boolean), { boss: true, bg: "#241334" });
}
// ファイルの敵が 尽きたとき：その章の まぼろしが 出る（ファイルではない。回収待ちには ならない）
async function phantomEncounter(n, { bg }) {
  const d = partDef(), c = d.chapters[n - 1];
  const P = partySize(), N = Math.min(MAX_ENEMIES, rollCount(P, save.lv));
  const avg = clamp(c.bytes / Math.max(1, c.count), 64 * 1024, 40 * 1024 * 1024);
  const list = Array.from({ length: N }, () => ({ ...phantomFor(c.dominant, avg * (0.5 + Math.random())), chapter: n, modified: Date.now() - s.staleDays * 1.1 * DAY }));
  await battle(list, { bg });
}

// ボスを倒した：かけら・章の完了・封印が解ける・ぬし
async function bossWon(n, i) {
  const d = partDef(), pr = partProg(), st = partStory(), c = d.chapters[n - 1], ref = c.bosses[i];
  const text = fragmentFor(ref);
  const r = beatBoss(d, pr, n, i, text);
  if (!r.ok) return;
  const gold = 40 + 20 * c.floors + 30 * i;
  save.gold += gold;
  await say(`ほうびの たからばこから ${gold} ゴールドを てにいれた！`, { auto: 900 });
  if (r.frag) {
    sfx("level");
    await say(`記憶の かけらを 手に いれた！\n${text}`);
    await say(nushiLine());
  }
  syncCleared();
  if (r.partDone) { await finishPartFlow(); return; }
  if (r.chapterDone) {
    await say(`${c.ruinName}の ボスを ぜんぶ たおした！\n${c.name}に ひかりが もどった。`);
    if (r.opened) { sfx("level"); await say(`封印が とけた！\n${d.chapters[r.opened - 1].town}への 道が ひらいた。`); }
    await say("ひかりに つつまれて、ダンジョンの そとへ…", { auto: 700 });
    leaveDungeon();
  } else {
    const m = dg.map;                                                          // 階段を守っていた：ボスが 消えて、階段が あらわれる
    m.tiles[hero.ty * m.w + hero.tx] = D.DOWN;
    m.guard = false;
    await say("ボスが きえて、階段が あらわれた！", { auto: 800 });
    loadFloor(dg.floor + 1, "up");
    sfx("ok");
    await say(`${floorLabel(dg.style, dg.floor)}に おりた。\n${SHAPE_FEEL[dg.map.shape] || ""}${dg.floor === dg.floors ? "\nここが いちばん おく。さいごの ボスの けはいが する…" : ""}`, { auto: 1500 });
  }
  persist();
}

// ぬしを倒したあと：結末を えらぶ・称号・殿堂入り・次の部へ
async function finishPartFlow() {
  const d = partDef(), pr = partProg(), st = partStory();
  await say(`${chapterStory(st, d.chapters.length).tale[1]}`);
  await say(`ぬし「${st.nushi.name}」は ゆっくり 顔を あげた。\n${st.nushi.twist.replace(/^じつは /, "じつは、")}。`);
  const k = await choose([
    { label: "手放す", desc: "ぬしを ひかりに かえす。ファイルは 回収待ちの まま。ごみ箱に送るかは、回収所で えらべる" },
    { label: "守る", desc: "守りの印を つける。ファイルは のこり、もう 敵としては 出ない" },
  ], { x: 280, y: 190, w: 420, title: "ぬしを どうする？", cancel: false });
  const choice = k === 1 ? "keep" : "release";
  const nk = keyOfRef(d.nushi);
  if (choice === "keep") {
    pending = pending.filter((x) => keyOf(x) !== nk);
    save.spared = [...(save.spared || []), nk].slice(-1000);
    persistPending();
    if (colId) ep.collections.remove(colId, [{ id: d.nushi.id, path: d.nushi.path }]).catch(() => {});
  }
  const bosses = d.chapters.flatMap((c) => c.bosses).filter((b) => keyOfRef(b) !== nk);
  const spared = bosses.filter((b) => (save.spared || []).includes(keyOfRef(b))).length;
  const ending = endingFor(st, { choice, bosses: bosses.length, spared });
  sfx("level");
  await sayPages(ending.text);
  await say(`称号『${ending.title}』を 手に いれた！`, { auto: 1200 });
  finishProgress(pr, choice, ending.title);
  save.series = finishSeries(save.series, { id: d.id, title: st.title, summary: summaryFor(st, ending), ending: ending.title, day: dayNum() }, [st.hook]);
  syncCleared();
  persist();
  await say(`第${save.series.done.length}部「${st.title}」は 終わった。\nメニューの『物語』から、殿堂を 見られる。`);
  await say(st.hook);
  const next = await choose([{ label: "つぎの 冒険の地を えらぶ", desc: "新しい 部が はじまる。レベルも 持ち物も 仲間も そのまま" }, { label: "この島に のこる" }], { x: 280, y: 190, w: 440, title: "つぎは？", cancel: true });
  if (next === 0) { leaveDungeon(); if (await scanFlow({ pick: true })) await say(scanReport()); }
  else leaveDungeon();
}

// 物語の窓：あらすじ・かけら・殿堂
async function storyMenu() {
  const d = partDef(), pr = partProg(), st = partStory();
  for (;;) {
    const k = await choose([
      { label: "いまの 冒険", desc: d ? "いまの 部の あらすじと 目的地" : "部は まだ はじまっていない" },
      { label: "記憶の かけら", hint: d ? `${fragCount(pr)}/${fragTotal(d)}` : "" },
      { label: "殿堂", hint: `${save.series.done.length}部`, desc: "終えた 冒険の 記録" },
      { label: "もどる" },
    ], { x: 16, y: 100, w: 340, title: "物語" });
    if (k < 0 || k === 3) return;
    if (k === 0) {
      if (!d) { await say("いまは 部が はじまっていない。\nファイルの メニューから 冒険の地を えらぼう。"); continue; }
      await say(`『${st.title}』\n第${pr.done ? d.chapters.length : pr.chapter}章／${d.chapters.length}章　${d.chapters[(pr.done ? d.chapters.length : pr.chapter) - 1].town}`);
      for (const p of st.intro.slice(0, 2)) await say(p);
      await say(`${goalText()}\n${nushiLine()}`);
    } else if (k === 1) {
      if (!d || !pr.frags.length) { await say("まだ かけらは ない。\nボスを たおすと 手に はいる。"); continue; }
      await say(`${nushiLine()}\nかけら ${fragCount(pr)}/${fragTotal(d)}`);
      for (const f of pr.frags) await say(`第${f.n}章の かけら\n${f.text}`);
    } else {
      if (!save.series.done.length) { await say("まだ 終えた 冒険は ない。"); continue; }
      for (const [idx, r] of save.series.done.entries()) await say(`第${idx + 1}部『${r.title}』\n称号：${r.ending}\n${r.summary}`);
    }
  }
}

// ---- 地図のできごと -----------------------------------------------------------------------------
const bgFor = (tt) => (tt === T.FOREST ? "#14301c" : tt === T.SAND ? "#5a4c25" : tt === T.HILL ? "#3b4020" : "#1f4a2a");
function nearestTownDist() {
  return Math.min(...world.towns.map((t) => Math.hypot(t.x - hero.tx, t.y - hero.ty)));
}
const partySize = () => 1 + Math.min(MAX_PARTY - 1, partyFriends().length);
let hintedEmpty = 0;                                  // 地図の敵が いなくなったと 知らせた章
async function encounter(tt, { bg = bgFor(tt), tier: tierIn = null, list = null, chapter = 0 } = {}) {
  const src = list || enemyPool(0);
  if (!src.length) {
    if (chapter) await phantomEncounter(chapter, { bg });                                    // 部の ダンジョンで ファイルが尽きた：まぼろし
    else if (partDef() && hintedEmpty !== partProg().chapter) { hintedEmpty = partProg().chapter; toast("この あたりの モンスターは たおしつくした。ダンジョンの ボスを たおして、先へ すすもう"); }
    return;
  }
  const tier = tierIn ?? Math.min(4, Math.floor(nearestTownDist() / 8));
  const small = src.filter((e) => e.size < BOSS_BYTES);
  const base = small.length ? small : src;
  const asc = base.slice().sort((a, b) => a.size - b.size);
  const P = partySize();
  const N = Math.min(MAX_ENEMIES, rollCount(P, save.lv));
  for (let i = 0; i < 5 && asc.length; i++) {
    const f = clamp((tier + Math.random()) / 5, 0, 1);
    const c = asc[Math.floor(f * (asc.length - 1))];
    const followers = pickFollowers(base, c, N - 1, { maxSize: BOSS_BYTES });
    const fresh = await Promise.all([c, ...followers].map(freshFile));          // 全員、戦う直前の確認（外れた敵は、補充せずに減らす）
    if (!fresh[0]) { asc.splice(asc.indexOf(c), 1); continue; }
    await battle(fresh.filter(Boolean), { bg });
    return;
  }
  if (chapter && !enemyPool(chapter).length) await phantomEncounter(chapter, { bg });
}
async function enterRuin(i) {
  const ruin = world.ruins[i];
  const d = partDef(), pr = partProg();
  if (d) {                                                                     // 部：章ごとに 1つの遺跡。前の章を終えるまで 封印されている
    const n = i + 1, c = d.chapters[n - 1];
    if (!c) { await say(`${ruin.name}は ひっそりと している。`); return; }
    if (!chapterOpen(pr, n)) { await say(`${c.ruinName}は 封印されている。\nさきに すすむべき 場所が ある。`); return; }
    if (chapterCleared(d, pr, n)) { await say(`${c.ruinName}は しずまりかえっている。`); return; }
    const P = partySize(), avg = partyUnits().reduce((t, a) => t + a.lv, 0) / P;
    const last = c.bosses[c.bosses.length - 1];
    const bl = partEnemyLevel(c, last.size, avg, { boss: true, nushi: n === d.chapters.length });
    await say(`${c.ruinName}だ。\nおくから ただならぬ けはいを かんじる…\nボスは ${c.bosses.length}体。てきの めやす Lv.${bl}　みんなの へいきん Lv.${Math.round(avg)}`);
    if (P < 2) await say("ボスは 手ごわい。ひとりでは きびしい かもしれない。\nメニューの『仲間』で、同行してもらおう。");
  } else {
    if (save.cleared.includes(i)) { await say(`${ruin.name}は しずまりかえっている。`); return; }
    if (!pool.list.length) { await say(`${ruin.name}… だが なにも いないようだ。`); return; }
    const P = partySize(), avg = partyUnits().reduce((t, a) => t + a.lv, 0) / P;
    const bl = enemyLevel(lvOf(pool.list[0].size), avg, 1, P, true);
    await say(`${ruin.name}だ。\nおくから ただならぬ けはいを かんじる…\nてきの めやす Lv.${bl}　みんなの へいきん Lv.${Math.round(avg)}`);
  }
  const go = await choose([{ label: "はいる" }, { label: "やめておく" }], { x: 16, y: 150, w: 190, cancel: true });
  if (go !== 0) return;
  await enterDungeon(i);
}

// ---- ダンジョン：階を歩く ----------------------------------------------------------------------
// 世界地図の遺跡に入ると、階を歩いて進む（形は dungeon.js が、番号から機械的につくる。いつ入っても同じ形）。
// 階段を見つけて下り、宝箱を開け、泉で休み、ボスに挑む。部の中では、ボスは 深い階から順に置かれ、最後の階まで 階段を守る。
const DG_STYLE = {
  cave: { floor: "#463b2c", wall: "#17120d", face: "#2b2218", bg: "#2b2216", water: "#2c5f94" },
  swamp: { floor: "#2f4a3a", wall: "#0f1a14", face: "#1d3027", bg: "#10241a", water: "#2f7a58" },
  tower: { floor: "#575c78", wall: "#1c1e2d", face: "#2d3046", bg: "#1d2233", water: "#3a6aa8" },
  castle: { floor: "#5b3d4a", wall: "#1d1420", face: "#33202f", bg: "#2a1830", water: "#3a5f9a" },
};
const dgCanEnter = (x, y) => !!dg && x >= 0 && y >= 0 && x < dg.map.w && y < dg.map.h && dgPassable(dg.map.tiles[y * dg.map.w + x]);
const dgTier = () => Math.min(4, Math.round(((dg.floor - 1) * 4) / Math.max(1, dg.floors - 1)));      // 深い階ほど、大きなファイルが出る

// 遺跡 i の中身：部があれば、その章のもの。なければ、番号から
function dgInfo(i) {
  const d = partDef();
  if (d && d.chapters[i]) { const c = d.chapters[i]; return { name: c.ruinName, style: c.style, floors: c.floors, chapter: c.n }; }
  const key = dungeonKey(save.islandSeed, i);
  return { name: world.ruins[i].name, style: styleFor(i), floors: floorsFor(key), chapter: 0 };
}

// 階を読みこんで、勇者を立たせる。where：「下りてきた」なら "up"（上り階段に立つ）、「上ってきた」なら "down"、再開なら { x, y }
function loadFloor(f, where) {
  dg.floor = f;
  dg.map = buildFloor({ key: dg.key, style: dg.style, floor: f, floors: dg.floors });
  const opened = new Set((save.dgState[dg.key] && save.dgState[dg.key].opened) || []);
  for (const c of dg.map.chests) if (opened.has(c.id)) dg.map.tiles[c.y * dg.map.w + c.x] = D.OPEN;
  if (dg.chapter && guardedFloor(partDef(), partProg(), dg.chapter, f) && dg.map.down) {          // 階段を ボスが守っている
    const p = dg.map.down;
    dg.map.tiles[p.y * dg.map.w + p.x] = D.BOSS;
    dg.map.boss = { x: p.x, y: p.y };
    dg.map.guard = true;
  }
  dg.seen = new Uint8Array(dg.map.w * dg.map.h);
  let p = where === "down" ? dg.map.down : where && where.x != null ? where : dg.map.up;
  if (!p || !dgCanEnter(p.x, p.y)) p = dg.map.up;
  placeWalker(hero, p.x, p.y);
  stepsSince = 0;
  held.length = 0;
  save.loc = { kind: "dungeon", ruin: dg.ruin, floor: f, x: p.x, y: p.y };
}

async function enterDungeon(i) {
  const key = dungeonKey(save.islandSeed, i), info = dgInfo(i);
  dg = { ruin: i, ...info, key, floor: 1, map: null, seen: null };
  loadFloor(1, "up");
  scene = "dungeon";
  sfx("ok");
  const nb = dg.chapter ? partDef().chapters[dg.chapter - 1].bosses.length : 1;
  await say(`${dg.name}に はいった！\n全部で ${dg.floors}階。${nb > 1 ? `ボスが ${nb}体、深い階から 道を ふさいでいる。` : "いちばん おくに ボスが まっている。"}\n${SHAPE_FEEL[dg.map.shape] || ""}`);
}
function leaveDungeon() {
  const ruin = dg && world.ruins[dg.ruin];
  dg = null;
  save.loc = null;
  scene = "map";
  held.length = 0;
  if (ruin) { placeWalker(hero, ruin.x, ruin.y); save.x = ruin.x; save.y = ruin.y; }
}
// ダンジョンの外へ出たことにする（島を作りなおしたとき・最初からやりなおすとき・負けて町に戻ったとき）
function clearDungeon() {
  if (!dg && !save.loc) return;
  dg = null;
  save.loc = null;
  if (scene === "dungeon") scene = "map";
}
// 前回、ダンジョンの中で終えたなら、その階のその場所から続ける
function resumeDungeon() {
  const loc = save.loc;
  if (!loc) return;
  const d = partDef(), pr = partProg();
  if (loc.ruin >= world.ruins.length) { save.loc = null; return; }
  if (d ? (!d.chapters[loc.ruin] || !chapterOpen(pr, loc.ruin + 1) || chapterCleared(d, pr, loc.ruin + 1)) : save.cleared.includes(loc.ruin)) { save.loc = null; return; }
  const key = dungeonKey(save.islandSeed, loc.ruin), info = dgInfo(loc.ruin);
  if (loc.floor > info.floors) { save.loc = null; return; }
  dg = { ruin: loc.ruin, ...info, key, floor: loc.floor, map: null, seen: null };
  loadFloor(loc.floor, { x: loc.x, y: loc.y });
  scene = "dungeon";
}

async function openChest() {
  const m = dg.map, c = m.chests.find((q) => q.x === hero.tx && q.y === hero.ty);
  if (!c) return;
  const st = (save.dgState[dg.key] ||= { opened: [] });
  const keys = Object.keys(save.dgState);
  if (keys.length > 30) delete save.dgState[keys[0]];
  if (st.opened.includes(c.id)) { m.tiles[c.y * m.w + c.x] = D.OPEN; return; }
  st.opened.push(c.id);
  m.tiles[c.y * m.w + c.x] = D.OPEN;
  const loot = chestLoot(Math.random, { floor: dg.floor, heroLv: save.lv });
  save.gold += loot.gold;
  for (const [k, n] of Object.entries(loot.items)) save.inv.item[k] = Math.min(99, (save.inv.item[k] || 0) + n);
  addAll(save.inv.mat, loot.mats);
  const got = [`${loot.gold}ゴールド`, ...Object.entries(loot.items).map(([k, n]) => `${ITEMS[k].name}×${n}`), ...Object.entries(loot.mats).map(([k, n]) => `${matInfo(k).name}×${n}`)];
  sfx("coin");
  await say(`たからばこを あけた！\n${got.join("、")} を てにいれた！`);
}
async function useSpring() {
  save.hp = hpMax();
  save.mp = mpMax();
  for (const f of save.friends) { f.hp = null; f.mp = null; }
  sfx("heal");
  await say("いずみの みずを のんだ。\nみんなの HPと MPが ぜんかいふくした！");
}
// 部のないとき：遺跡のボス＝いちばん大きな古いファイルと、おともの敵。勝てば、遺跡は しずまる
async function ruinBoss() {
  const P = partySize();
  for (let tries = 0; tries < 6; tries++) {
    const c = pool.list[0];
    if (!c) { await say("ここには もう だれも いない。"); return null; }
    const minions = pickFollowers(pool.list, c, bossMinions(P), { maxSize: BOSS_BYTES });
    const fresh = await Promise.all([c, ...minions].map(freshFile));
    if (!fresh[0]) continue;
    return battle(fresh.filter(Boolean), { boss: true, bg: "#241334" });
  }
  return null;
}
async function dungeonBoss() {
  if (dg.chapter) {                                                            // 部：この階に いるボスと戦う
    const d = partDef(), pr = partProg(), n = dg.chapter, i = bossIndexAt(d, n, dg.floor);
    if (i < 0 || bossBeaten(pr, n, i)) return;
    const r = await partBoss(d.chapters[n - 1].bosses[i], n);
    if (!dg) return;                                                           // 負けて、町に戻った
    if (r === "win") await bossWon(n, i);
    return;
  }
  const i = dg.ruin, name = dg.name, floors = dg.floors;
  const r = await ruinBoss();
  if (!dg) return;                                                    // 負けて、町に戻った
  if (r === "win") {
    const gold = 60 + 25 * floors;
    save.gold += gold;
    save.cleared.push(i);
    await say(`${name}の ぬしを たおした！\nおくの たからばこから ${gold} ゴールドを てにいれた！`);
    await say("ひかりに つつまれて、ダンジョンの そとへ…", { auto: 700 });
    leaveDungeon();
  } else if (r === null) leaveDungeon();
}

// 1マス歩いて着いたとき（ダンジョン）：階段・宝箱・泉・ボス・ランダムエンカウント
async function arriveDungeon() {
  if (!dg) return;
  const m = dg.map, t = m.tiles[hero.ty * m.w + hero.tx];
  save.loc = { kind: "dungeon", ruin: dg.ruin, floor: dg.floor, x: hero.tx, y: hero.ty };
  save.steps++;
  if (t === D.UP) {
    if (dg.floor === 1) { await say(`${dg.name}を でた。`, { auto: 500 }); leaveDungeon(); return; }
    loadFloor(dg.floor - 1, "down");
    sfx("ok");
    await say(`${floorLabel(dg.style, dg.floor)}に もどった。`, { auto: 500 });
    return;
  }
  if (t === D.DOWN) {
    loadFloor(dg.floor + 1, "up");
    sfx("ok");
    await say(`${floorLabel(dg.style, dg.floor)}に おりた。\n${SHAPE_FEEL[dg.map.shape] || ""}${dg.floor === dg.floors ? "\nここが いちばん おく。ボスの けはいが する…" : ""}`, { auto: 1500 });
    return;
  }
  if (t === D.CHEST) { await openChest(); return; }
  if (t === D.SPRING) { await useSpring(); return; }
  if (t === D.BOSS) { await dungeonBoss(); return; }
  stepsSince++;
  if (stepsSince >= 5 && pool.list.length && Math.random() < (RATE[s.encounter] ?? RATE.normal) * 1.25) {
    stepsSince = 0;
    await encounter(null, { bg: DG_STYLE[dg.style].bg, tier: dgTier(), list: enemyPool(dg.chapter), chapter: dg.chapter });
  }
}

// 1マス歩いて着いたとき：町・遺跡・ランダムエンカウント
const RATE = { low: 0.03, normal: 0.055, high: 0.09 };
async function arrive() {
  save.x = hero.tx;
  save.y = hero.ty;
  save.steps++;
  const tt = tileAt(hero.tx, hero.ty);
  const ti = townAt(hero.tx, hero.ty), ri = ruinAt(hero.tx, hero.ty);
  if (tt === T.TOWN && ti >= 0) { await enterTown(ti); return; }
  if (tt === T.RUIN && ri >= 0) { await enterRuin(ri); return; }
  stepsSince++;
  if (stepsSince >= 6 && pool.list.length && Math.random() < (RATE[s.encounter] ?? RATE.normal) * (tt === T.FOREST ? 1.4 : tt === T.SAND ? 0.7 : 1)) {
    stepsSince = 0;
    await encounter(tt);
  }
}

// ---- 町：歩ける町 -------------------------------------------------------------------------------
// 世界地図の町に入ると、町を歩ける。建物のドアに立つと、その店の画面が開く（閉じると、町に戻る）。南の出口で、世界地図へ。
// 町の形は town.js が、島の種と町の番号から機械的につくる。人は、この町に住む人。話は、ゲームの本当の状態から作る。
const townCanEnter = (x, y) => !!tn && townOpen(tn.map, x, y);
const rootName = () => { const r = save.roots[0]; return r ? r.path.slice(r.path.lastIndexOf("\\") + 1) || r.path : ""; };

async function enterTown(i) {
  const town = world.towns[i];
  const d = partDef();
  if (d && !chapterOpen(partProg(), i + 1)) { await say(`${town.name}への 道は まだ ふさがれている。\n前の ダンジョンの ボスを たおして、道を ひらこう。`); return; }
  save.home = i;
  save.hp = Math.max(save.hp, 1);
  const map = buildTown({ seed: save.islandSeed, index: i });
  const roofAt = new Map();                                                       // 屋根の色（マスごと）
  for (const d of map.doors) for (let j = 0; j < 2; j++) for (let k = -1; k <= 1; k++) roofAt.set(`${d.x + k},${d.y - 2 + j}`, d.roof);
  tn = { index: i, name: town.name, map, roofAt };
  scene = "town";
  placeWalker(hero, map.start.x, map.start.y);
  hero.dir = "up";
  held.length = 0;
  stepsSince = 0;
  sfx("ok");
  await say(`${town.name}へ ようこそ！`, { auto: 700 });
  if (d) await townStory(i + 1);
}
function leaveTown() {
  const t = tn && world.towns[tn.index];
  tn = null;
  scene = "map";
  held.length = 0;
  if (t) { placeWalker(hero, t.x, t.y); save.x = t.x; save.y = t.y; }
}
// 町の外へ出たことにする（島を作りなおしたとき・最初からやりなおすとき）
function clearTown() {
  if (!tn) return;
  tn = null;
  if (scene === "town") scene = "map";
}
const facingFolk = () => {
  if (!tn) return null;
  const [dx, dy] = DIRS[hero.dir] || DIRS.down;
  return folkAt(tn.map, hero.tx + dx, hero.ty + dy);
};
async function talkToFolk(f) {
  sfx("ok");
  const ctx = { town: tn.name, root: rootName(), pending: pending.length, pool: pool.list.length, ruins: world.ruins.length, cleared: save.cleared.length };
  const d = partDef();
  if (d) {                                                                    // 部の中：その章の物語と 手がかり、いまの目的地、ぬしの名前
    const cs = chapterStory(partStory(), tn.index + 1);
    ctx.story = { tale: cs.tale, clue: cs.clue, folk: cs.folk, goal: goalText(), nushi: nushiLine() };
    ctx.pool = enemyPool(0).length;
  }
  for (const pg of folkLines(f.role, ctx, f.talks++)) await say(`${f.name}「${pg}」`);
}
async function enterBuilding(d) {
  if (d.kind === "inn") await inn();
  else if (d.kind === "item") await itemShop();
  else if (d.kind === "forge") await forge();
  else if (d.kind === "guild") await guild();
  else if (d.kind === "depot") await depot();
  else if (d.kind === "tavern") await tavern();
  clearMsg();
}
// 1マス歩いて着いたとき（町）：ドアなら店に入る・出口なら町を出る
async function arriveTown() {
  if (!tn) return;
  const d = doorAt(tn.map, hero.tx, hero.ty);
  if (d) { await enterBuilding(d); return; }
  if (isExit(tn.map, hero.tx, hero.ty)) leaveTown();
}

// 物語の文章：空白は そのまま。文の きれめで、窓に入る長さ（84字）に区切って 1ページずつ見せる
async function sayPages(str, per = 84) {
  const pages = [];
  let page = "";
  for (const sn of String(str).split(/(?<=[。！？!?])/)) {
    for (let i = 0; i < sn.length; i += per) {
      const part = sn.slice(i, i + per);
      if (page && page.length + part.length > per) { pages.push(page); page = ""; }
      page += part;
    }
  }
  if (page) pages.push(page);
  for (const pg of pages) await say(pg);
}
// 長い文章を、窓に入る長さに区切って1ページずつ見せる
async function sayLong(str, per = 96) {
  const pages = [];
  let page = "";
  for (const sn of str.replace(/\s+/g, "").split(/(?<=[。！？!?])/)) {
    for (let i = 0; i < sn.length; i += per) {
      const part = sn.slice(i, i + per);
      if (page && page.length + part.length > per) { pages.push(page); page = ""; }
      page += part;
    }
  }
  if (page) pages.push(page);
  for (const p of pages) await say(p);
}

async function inn() {
  await say("いらっしゃい！ 宿屋へ ようこそ。");
  for (;;) {
    const ok = aiReady();
    const k = await choose([
      { label: "ゆっくり やすむ" },
      { label: "冒険日誌を かく", hint: ok ? "AI" : "AIなし", disabled: !ok, desc: ok ? "ここまでの ぼうけんを AIが 日誌に まとめてくれる" : "設定で AIをオンにして APIキーを入れると、AIが 日誌を かいてくれる" },
      { label: "やめる" },
    ], { x: 16, y: 150, w: 300 });
    if (k < 0 || k === 2) break;
    if (k === 0) {
      save.hp = hpMax();
      save.mp = mpMax();
      for (const f of save.friends) { f.hp = null; f.mp = null; }          // 仲間も、全回復
      sfx("heal");
      await say(`${save.heroName}たちの HPと MPが ぜんかいふくした！`);
      continue;
    }
    await say("ペンを とって、日誌を かきはじめた…", { auto: 300 });
    try {
      const text = await ai.journal({
        heroLevel: save.lv, defeatedTotal: save.kills, freedTotal: fmtSize(save.freed), waitingForTrash: pending.length,
        questsDone: save.questsDone, place: (world.towns[save.home] || world.towns[0]).name, friends: save.friends.length,
        recentBattles: (save.log || []).slice(-10),
        ...(partStory() ? { adventure: partStory().title, chapter: partProg().chapter, defeatedBosses: Object.values(partProg().beaten).flat().filter(Boolean).length } : {}),
      });
      llmOk();
      await sayLong(text);
    } catch (err) {
      llmFailed(err);
      await say("インクが かすれて、うまく かけなかった…");
    }
  }
}

// 道具屋：道具を買う・素材を売る
async function itemShop() {
  await say("いらっしゃい！ なにを おもとめかな？");
  for (;;) {
    const k = await choose([{ label: "買う" }, { label: "売る", hint: "素材" }, { label: "やめる" }], { x: 16, y: 150, w: 260, title: `しょじきん ${save.gold}G` });
    if (k < 0 || k === 2) break;
    if (k === 0) await buyItems();
    else await sellMaterials();
  }
}
async function buyItems() {
  const day = dayNum();
  for (;;) {
    const keys = SHOP_ITEMS;
    const i = await choose([...keys.map((k) => ({ label: ITEMS[k].name, hint: `${itemPrice(k, day)}G${k === dailySpecial(day) ? " 特価" : ""}`, desc: `${ITEMS[k].desc}　もっている ${save.inv.item[k] || 0}` })), { label: "やめる" }],
      { x: 16, y: 100, w: 400, title: `しょじきん ${save.gold}G　きょうの 特価は ${ITEMS[dailySpecial(day)].name}` });
    if (i < 0 || i >= keys.length) break;
    const id = keys[i], price = itemPrice(id, day);
    if (save.gold < price) { await say("おかねが たりないようだ。"); continue; }
    if ((save.inv.item[id] || 0) >= 99) { await say("それ以上は もてないぞ。"); continue; }
    save.gold -= price;
    save.inv.item[id] = (save.inv.item[id] || 0) + 1;
    sfx("coin");
    await say(`${ITEMS[id].name}を かった！`, { auto: 600 });
  }
}
async function sellMaterials() {
  for (;;) {
    const ids = Object.keys(save.inv.mat).sort();
    if (!ids.length) { await say("売れる 素材を もっていない。"); return; }
    const i = await choose([...ids.map((id) => ({ label: matInfo(id).name, hint: `×${save.inv.mat[id]}　${matInfo(id).price}G`, desc: `${SPECIES[matInfo(id).cat].name}の素材。ひとつ ${matInfo(id).price}ゴールド` })), { label: "やめる" }],
      { x: 16, y: 60, w: 460, title: `素材を 売る　${save.gold}G` });
    if (i < 0 || i >= ids.length) return;
    const id = ids[i], n = save.inv.mat[id];
    const m = n > 1 ? await choose([{ label: "ひとつ 売る" }, { label: `ぜんぶ 売る　${n}個` }, { label: "やめる" }], { x: 16, y: 150, w: 320 }) : 0;
    if (m < 0 || m === 2) continue;
    const gold = sellMats(save, id, m === 0 ? 1 : n);
    sfx("coin");
    await say(`${matInfo(id).name}を 売って ${gold}ゴールドに なった。`, { auto: 700 });
  }
}

// 鍛冶屋：買う・作る（素材から。得意な相手が付く）・アクセサリ・売る
async function forge() {
  await say("いらっしゃい。ここは 鍛冶屋だ。\n素材を もってくれば、とくべつな 装備を 作ってやるよ。");
  for (;;) {
    const k = await choose([{ label: "買う" }, { label: "作る", hint: "素材から" }, { label: "アクセサリを 作る" }, { label: "装備を 売る" }, { label: "やめる" }], { x: 16, y: 120, w: 340, title: `しょじきん ${save.gold}G` });
    if (k < 0 || k === 4) break;
    if (k === 0) await buyGear();
    else if (k === 1) await craftGear();
    else if (k === 2) await craftAccessory();
    else await sellGearMenu();
  }
}
const matCostText = (mats) => Object.entries(mats).map(([id, n]) => `${matInfo(id).name}×${n}`).join("　");
async function buyGear() {
  for (;;) {
    const wt = bestTier(save, "weapon") + 1, at = bestTier(save, "armor") + 1;
    const row = (slot, t) => (t > TIER_MAX ? { label: `${SLOT_NAMES[slot]}は もう さいきょう`, disabled: true }
      : { label: `${gearName({ slot, tier: t, affinity: null })}`, hint: `${buyPrice(slot, t)}G`, desc: `${slot === "weapon" ? "こうげき" : "まもり"} +${U((slot === "weapon" ? gearAtk : gearDef)({ slot, tier: t }) - (slot === "weapon" ? gearAtk : gearDef)(gear()[slot]))}　店で 買うと 得意な相手は 付かない` });
    const i = await choose([row("weapon", wt), row("armor", at), { label: "やめる" }], { x: 16, y: 120, w: 460, title: `しょじきん ${save.gold}G` });
    if (i < 0 || i === 2) break;
    const slot = i === 0 ? "weapon" : "armor";
    if (save.gold < buyPrice(slot, i === 0 ? wt : at)) { await say("おかねが たりないようだ。"); continue; }
    const g = buyNextGear(save, slot);
    if (!g) continue;
    equipGear(save, g.id);
    sfx("coin");
    await say(`${gearName(g)}を かった！ そうびした！`);
  }
}
async function craftGear() {
  for (;;) {
    const s0 = await choose([{ label: "武器" }, { label: "防具" }, { label: "やめる" }], { x: 16, y: 150, w: 240, title: "なにを 作る？" });
    if (s0 < 0 || s0 === 2) return;
    const slot = s0 === 0 ? "weapon" : "armor", tier = bestTier(save, slot) + 1;
    if (tier > TIER_MAX) { await say(`${SLOT_NAMES[slot]}は もう これ以上 強くできない。`); continue; }
    for (;;) {
      const rows = CAT_IDS.map((cat) => {
        const cost = craftCost(slot, tier, cat), ok = save.gold >= cost.gold && hasAll(save.inv.mat, cost.mats);
        return { cat, cost, ok };
      });
      const j = await choose([...rows.map((r) => ({
        label: `${SPECIES[r.cat].emoji}${SPECIES[r.cat].name}の 素材`, hint: `${r.cost.gold}G`, disabled: !r.ok,
        desc: `${gearName({ slot, tier, affinity: r.cat })}　${SPECIES[r.cat].name}への ${slot === "weapon" ? "ダメージ" : "まもり"}が 1.15倍\n${matCostText(r.cost.mats)}`,
      })), { label: "もどる" }], { x: 16, y: 50, w: 420, title: `${SLOT_NAMES[slot]}を 作る　${save.gold}G` });
      if (j < 0 || j >= rows.length) break;
      const g = craft(save, slot, rows[j].cat);
      if (!g) { await say("素材か おかねが たりない。"); continue; }
      equipGear(save, g.id);
      sfx("coin");
      await say(`${gearName(g)}が できた！ そうびした！`);
      break;
    }
  }
}
async function craftAccessory() {
  for (;;) {
    const rows = CAT_IDS.map((cat) => {
      const cost = craftCost("acc", 0, cat);
      return { cat, cost, ok: save.gold >= cost.gold && hasAll(save.inv.mat, cost.mats) };
    });
    const j = await choose([...rows.map((r) => ({ label: ACC_DEFS[r.cat].name, hint: `${r.cost.gold}G`, disabled: !r.ok, desc: `${ACC_DEFS[r.cat].desc}\n${matCostText(r.cost.mats)}` })), { label: "もどる" }],
      { x: 16, y: 50, w: 420, title: `アクセサリを 作る　${save.gold}G` });
    if (j < 0 || j >= rows.length) return;
    const g = craft(save, "acc", rows[j].cat);
    if (!g) { await say("素材か おかねが たりない。"); continue; }
    equipGear(save, g.id);
    sfx("coin");
    await say(`${gearName(g)}が できた！ そうびした！`);
  }
}
async function sellGearMenu() {
  for (;;) {
    const list = save.inv.gear.filter((g) => save.equip[g.slot] !== g.id);
    if (!list.length) { await say("売れる 装備は ない。\nそうびしているものは 売れない。"); return; }
    const i = await choose([...list.map((g) => ({ label: gearName(g), hint: `${sellGearPrice(g)}G`, desc: `${SLOT_NAMES[g.slot]}` })), { label: "やめる" }], { x: 16, y: 60, w: 460, title: "装備を 売る" });
    if (i < 0 || i >= list.length) return;
    const gold = sellGear(save, list[i].id);
    sfx("coin");
    await say(`${gold}ゴールドで 売れた。`, { auto: 600 });
  }
}

async function guild() {
  // 達成した依頼は、まず報告
  for (const q of [...save.active]) {
    if (q.have < q.need) continue;
    sfx("win");
    await say(`「${q.title}」を たっせいしたのか！ ありがとう。\nほうしゅうの ${q.gold}ゴールドと けいけんち ${q.exp}だ。`);
    save.gold += q.gold;
    save.active = save.active.filter((x) => x.id !== q.id);
    save.questsDone++;
    await gainExp(q.exp);
  }
  if (!save.offers.length) makeOffers();
  await say("ここは 依頼所。ごみ退治の 仕事が あるぞ。");
  for (;;) {
    const k = await choose([{ label: "依頼を うける" }, { label: "うけている 依頼" }, { label: "新しい 依頼を 聞く" }, { label: "地図を ひろげなおす" }, { label: "やめる" }], { x: 16, y: 150, w: 300 });
    if (k < 0 || k === 4) break;
    if (k === 0) {
      if (save.active.length >= 3) { await say("3つまでしか うけられないぞ。"); continue; }
      if (!save.offers.length) { await say("いまは 依頼が ないようだ。"); continue; }
      const j = await choose([...save.offers.map((q) => ({ label: q.title, hint: `${q.gold}G`, desc: `${q.story ? q.story + "\n" : ""}ほうしゅう ${q.gold}ゴールド・けいけんち ${q.exp}` })), { label: "やめる" }], { x: 16, y: 100, w: 700, title: "依頼" });
      if (j < 0 || j >= save.offers.length) continue;
      const q = save.offers.splice(j, 1)[0];
      delete q.local;
      save.active.push(q);
      await say(`「${q.title}」を うけた！${q.story ? `\n${q.story}` : ""}`, { auto: 900 });
    } else if (k === 1) {
      if (!save.active.length) { await say("いま うけている 依頼は ない。"); continue; }
      await say(save.active.map((q) => `・${q.title}　${qProgress(q)}`).join("\n"));
    } else if (k === 2) {
      makeOffers();
      await say(save.offers.length ? "新しい 依頼を 用意した。" : "いまは 出せる 依頼が ない。");
    } else if (k === 3) {
      if (await scanFlow({ confirm: "冒険の地をもう一度 調べて、敵を集めなおします。時間がかかることがあります。" })) await say(scanReport());
    }
  }
}

// ---- 酒場（友だちの分身）・フレンド・仲間 ------------------------------------------------------------
// 酒場にいるのは、取りこんだ冒険者カードの友だちだけ（ランダムに作った旅人はいない）。申請は、必ず受け入れられる
async function tavern() {
  for (;;) {
    const list = visitorsFor({ cards: save.cards });
    await say(list.length ? "酒場には、友だちの 分身が 来ている。" : "酒場は しずかだ。\n友だちの 冒険者カードを 取りこむと、その人の 分身が 来てくれる。", { auto: 1000 });
    const items = list.map((v) => ({
      label: `${ROLES[v.role].emoji}${v.name}`, hint: `分身　Lv.${v.lv}${friendById(v.id) ? "　フレンド" : ""}`, desc: `${ROLES[v.role].name}　「${v.quip}」`, look: lookOf(v), role: v.role, caption: v.name, caption2: `${ROLES[v.role].name}　Lv.${v.lv}`,
    }));
    items.push({ label: "カードを 取りこむ", desc: "友だちから もらった コードを 貼ると、その人の 分身が 来ます" },
      { label: "フレンド", hint: `${save.friends.length}/${FRIEND_MAX}　同行 ${save.party.length}/${MAX_PARTY - 1}` }, { label: "もどる" });
    const i = await choose(items, { x: 16, y: 16, w: 520, title: "この町に 訪れた人物" });
    if (i < 0 || i === items.length - 1) break;
    if (i === items.length - 3) { await importCard(); continue; }
    if (i === items.length - 2) { await friendsMenu(); continue; }
    await visitorMenu(list[i]);
  }
}
async function visitorMenu(v) {
  for (;;) {
    const fr = friendById(v.id);
    const k = await choose([{ label: "はなす" }, { label: "フレンド申請", disabled: !!fr, hint: fr ? "もう フレンド" : "" }, { label: "くわしく" }, { label: "もどる" }], { x: 16, y: 150, w: 330, title: `${ROLES[v.role].emoji}${v.name}` });
    if (k < 0 || k === 3) return;
    if (k === 0) await say(`${v.name}\n「${v.quip}」`);
    else if (k === 1) {
      if (save.friends.length >= FRIEND_MAX) { await say(`フレンドが いっぱいだ。\n${FRIEND_MAX}人までしか なれない。`); continue; }
      await say(`${v.name}に フレンド申請を した。\n「よろしく！」`);
      save.friends.push(friendFrom(v, dayNum()));
      sfx("win");
      await say(`${v.name}が フレンドに なった！`);
    } else await say(`${ROLES[v.role].emoji}${v.name}　${ROLES[v.role].name}　Lv.${v.lv}\n「${v.quip}」\n友だちが カードを 作ったときの 姿で、いま 遊んでいるわけではない。`);
  }
}
async function friendsMenu() {
  for (;;) {
    if (!save.friends.length) { await say("まだ フレンドは いない。\n酒場で 友だちの 分身に 申請してみよう。"); return; }
    const items = save.friends.map((f) => {
      const lv = companionLv(f, save.lv);
      return { label: `${ROLES[f.role].emoji}${f.name}`, hint: `Lv.${lv}${save.party.includes(f.id) ? "　同行中" : ""}`, desc: `${ROLES[f.role].name}　${f.persona}　きずな ${stageOf(f.bond)}/3`, look: lookOf(f), role: f.role, caption: f.name, caption2: `${ROLES[f.role].name}　Lv.${lv}` };
    });
    items.push({ label: "もどる" });
    const i = await choose(items, { x: 16, y: 16, w: 520, title: `フレンド　同行 ${save.party.length}/${MAX_PARTY - 1}` });
    if (i < 0 || i === items.length - 1) return;
    const f = save.friends[i], inParty = save.party.includes(f.id);
    const k = await choose([{ label: inParty ? "ここで 別れる" : "同行を おねがい" }, { label: "くわしく" }, { label: "フレンドを やめる" }, { label: "もどる" }], { x: 16, y: 150, w: 330, title: `${ROLES[f.role].emoji}${f.name}` });
    if (k < 0 || k === 3) continue;
    if (k === 0) {
      if (inParty) { save.party = save.party.filter((id) => id !== f.id); await say(`${f.name}は 「また 呼んでくれ」と 言って 別れた。`); }
      else if (save.party.length >= MAX_PARTY - 1) await say(`同行できるのは ${MAX_PARTY - 1}人まで。\n先に だれかと 別れよう。`);
      else { save.party.push(f.id); sfx("win"); await say(`${f.name}が 旅に くわわった！`); }
    } else if (k === 1) {
      const lv = companionLv(f, save.lv), st = memberStats(f.role, lv), stage = friendStage(f, lv);
      await say(`${ROLES[f.role].emoji}${f.name}　${ROLES[f.role].name}　Lv.${lv}\nHP ${U(st.maxHp)}　MP ${U(st.maxMp)}　こうげき ${U(st.atk)}　まもり ${U(st.def)}\nとくぎ： ${skillsFor(f.role, stage).map((id) => SKILL_DEFS[id].name).join("、") || "まだ ない"}`);
    } else if (k === 2) {
      if (f.kind === "story") { await say(`${f.name}は 旅の 仲間だ。\nフレンドは やめられない。同行を はずすだけに しよう。`); continue; }
      if (!(await ep.ui.confirm(`${f.name}との フレンドを やめます。`, { okLabel: "やめる" }))) continue;
      save.friends = save.friends.filter((x) => x.id !== f.id);
      save.party = save.party.filter((id) => id !== f.id);
      await say(`${f.name}との フレンドを やめた。`);
    }
  }
}

// ---- 回収待ち・守られたファイルを、1つずつ確かめる ---------------------------------------------------------
// 回収待ちのファイルを、1つずつ確かめる。ひらく・場所をひらく・助ける（回収待ちから外す）ができる
async function pagedPick(list, { title, toItem, per = 6 }) {
  let page = 0;
  for (;;) {
    if (!list.length) return null;
    const pages = Math.ceil(list.length / per);
    page = clamp(page, 0, pages - 1);
    const part = list.slice(page * per, page * per + per);
    const items = part.map(toItem);
    if (page > 0) items.push({ label: `◀ まえの ${per}件` });
    if (page < pages - 1) items.push({ label: `▶ つぎの ${per}件` });
    items.push({ label: "もどる" });
    const i = await choose(items, { x: 16, y: 16, w: 640, title: `${title}　${page + 1}/${pages}` });
    if (i < 0 || i === items.length - 1) return null;
    if (i >= part.length) { page += items[i].label.startsWith("◀") ? -1 : 1; continue; }
    return part[i];
  }
}
async function openFile(p) { try { await ep.open({ id: p.id, path: p.path }); } catch (err) { await say(`ひらけなかった…\n${err.message}`); } }
async function openFolder(p) { try { await ep.tabs.open("builtin.win11", { path: dirOf(p.path) }); } catch (err) { await say(`場所を ひらけなかった…\n${err.message}`); } }
async function reviewPending() {
  for (;;) {
    if (!pending.length) { await say("回収待ちは もう ない。"); return; }
    const p = await pagedPick(pending.slice().reverse(), { title: `回収待ち ${pending.length}体`, toItem: (p) => ({ label: fit(p.name, 400, 22), hint: fmtSize(p.size), desc: p.path }) });
    if (!p) return;
    await inspectPending(p);
  }
}
async function inspectPending(p) {
  for (;;) {
    const k = await choose([
      { label: "くわしく みる", desc: "名前・場所・大きさを みる" },
      { label: "ひらいて たしかめる", desc: "ふだん使うアプリで ひらきます" },
      { label: "場所を ひらく", desc: "入っているフォルダを 新しいタブで ひらきます" },
      { label: "たすける", desc: "回収待ちから はずして のこします。もう 敵としては 出ません" },
      { label: "もどる" },
    ], { x: 16, y: 150, w: 330, title: fit(p.name, 280, 20) });
    if (k < 0 || k === 4) return;
    if (k === 0) {
      const sp = SPECIES[catOf(p.name.split(".").pop().toLowerCase())];
      await say(`${p.name}\n${p.path}\n${fmtSize(p.size)}　${sp.emoji}${sp.name}`);
    } else if (k === 1) await openFile(p);
    else if (k === 2) await openFolder(p);
    else if (k === 3) {
      pending = pending.filter((x) => keyOf(x) !== keyOf(p));
      save.spared = [...(save.spared || []), keyOf(p)].slice(-1000);
      persistPending();
      persist();
      if (colId) ep.collections.remove(colId, [{ id: p.id, path: p.path }]).catch(() => {});
      sfx("heal");
      await say(`「${p.name}」を たすけた。\nごみ箱には おくらないし、もう 敵としても 出ない。`);
      return;
    }
  }
}
// 鑑定士が守ったファイル。理由を見て、ひらける
async function reviewGuarded() {
  for (;;) {
    if (!guarded.length) { await say("鑑定士が 守っている ファイルは ない。"); return; }
    const p = await pagedPick(guarded, { title: `守られたファイル ${guarded.length}件`, toItem: (p) => ({ label: fit(p.name, 400, 22), hint: `${p.tag || "大事"} ${p.imp}`, desc: `${p.why || "大事そうだ"}　${p.path}` }) });
    if (!p) return;
    for (;;) {
      const k = await choose([
        { label: "くわしく みる", desc: "鑑定士の 理由を みる" },
        { label: "ひらいて たしかめる", desc: "ふだん使うアプリで ひらきます" },
        { label: "場所を ひらく", desc: "入っているフォルダを 新しいタブで ひらきます" },
        { label: "もどる" },
      ], { x: 16, y: 150, w: 330, title: fit(p.name, 280, 20) });
      if (k < 0 || k === 3) break;
      if (k === 0) await say(`${p.name}\n鑑定士： ${p.why || "大事そうだ"}　${p.tag || "大事"}\n${p.path}\n${fmtSize(p.size)}`);
      else if (k === 1) await openFile(p);
      else await openFolder(p);
    }
  }
}

// 回収所：倒したファイルを、まとめてごみ箱へ送る。本体の確認が出るのは、ここだけ
async function depot() {
  if (!pending.length) { await say("ここは 回収所。\nいまは 回収するものが ないな。"); return; }
  const sum = () => pending.reduce((t, p) => t + p.size, 0);
  await say(`ここは 回収所。\nたおした ごみが ${pending.length}体ぶん、${fmtSize(sum())} たまっているぞ。`);
  for (;;) {
    const k = await choose([{ label: "回収車を よぶ", desc: "ごみ箱へ送ります。このとき アプリが 確認を出します" }, { label: "たまっている ものを みる" }, { label: "やめる" }], { x: 16, y: 150, w: 280 });
    if (k < 0 || k === 2) break;
    if (k === 1) {
      await reviewPending();
      if (!pending.length) break;
      continue;
    }
    // 回収する前に、まだ そこにあるかを確かめる
    const refs = pending.map((p) => ({ id: p.id, path: p.path }));
    const now = await ep.resolve(refs).catch(() => refs.map(() => null));
    const alive = [], gone = [];
    pending.forEach((p, i) => (now[i] ? alive : gone).push(now[i] ? { ...p, id: now[i].id, path: now[i].path } : p));
    if (!alive.length) { pending = []; persistPending(); await say("ぜんぶ もう なくなっていた。"); break; }
    const total = alive.reduce((t, p) => t + p.size, 0);
    await say(`${alive.length}体ぶん、${fmtSize(total)} を 回収車に のせる。\nアプリの かくにんが 出るので「ごみ箱へ」を えらんでくれ。`);
    let trashed = 0;
    try {
      for (let i = 0; i < alive.length; i += 300) {
        const r = await ep.trash(alive.slice(i, i + 300).map((p) => ({ id: p.id, path: p.path })));
        trashed += r.trashed;
      }
    } catch (err) {
      if (err.code !== "denied" && trashed === 0) toast(`ごみ箱へ送れませんでした：${err.message}`);
    }
    // 実際に消えたものだけを回収済みにする
    const after = await ep.resolve(alive.map((p) => ({ id: p.id, path: p.path }))).catch(() => alive.map(() => null));
    const done = alive.filter((_, i) => !after[i]);
    const doneKeys = new Set([...done, ...gone].map(keyOf));
    pending = pending.filter((p) => !doneKeys.has(keyOf(p)));
    persistPending();
    if (colId && done.length) ep.collections.remove(colId, done.map((p) => ({ id: p.id, path: p.path }))).catch(() => {});
    if (!done.length) { await say("回収車は ひきかえしていった…\nごみは そのまま のこっている。"); continue; }
    const freed = done.reduce((t, p) => t + p.size, 0), reward = Math.round((done.length * 2 + Math.floor(freed / (1024 * 1024)) * 3) * (1 + accEffect("gold")));
    save.freed += freed;
    save.gold += reward;
    sfx("coin");
    await say(`${done.length}体ぶん、${fmtSize(freed)} を かいしゅう した！\nほうしゅうとして ${reward} ゴールドを うけとった。`);
    if (!pending.length) break;
  }
}

// ---- 冒険者カード ----------------------------------------------------------------------------
async function importCard() {
  const t = await ep.ui.ask({ label: "友だちから もらった カードの コード", placeholder: "FQ1-…", okLabel: "取りこむ" });
  if (t === null) return;
  const r = decodeCard(t);
  if (!r.ok) { await say(`カードを 取りこめなかった。\n${r.error}`); return; }
  const dup = save.cards.find((c) => c.id === r.card.id);
  if (dup) {                                                 // 同じ人の新しいカード：すがた・ひとこと・レベルを新しくする
    Object.assign(dup, { lv: r.card.lv, quip: r.card.quip, look: r.card.look });
    const fr = friendById(dup.id);
    if (fr) Object.assign(fr, { lv0: r.card.lv, quip: r.card.quip, look: r.card.look });
    sfx("win");
    await say(`${r.card.name}の カードを 新しくした。\nすがたや ひとことが かわっていれば、そのとおりに なる。`);
    return;
  }
  if (save.cards.length >= 20) { await say("カードは 20枚までだ。\n古いカードを 消してから 取りこもう。"); return; }
  save.cards.push(r.card);
  sfx("win");
  await say(`${ROLES[r.card.role].emoji}${r.card.name}の 分身が、酒場に 来てくれるようになった！\n友だちが 今 遊んでいるのではなく、カードを 作ったときの 姿が 来る。`);
}
// ---- 勇者の見た目 ----------------------------------------------------------------------------
// 5つの項目を、選ぶたびに次の候補へ。右の絵が、その場で変わる。「これで けってい」か Esc で決まる。決めた姿が、カードに載る
async function lookMenu(title = "すがたを えらぼう") {
  const look = save.look.slice();
  let at = 0;
  for (;;) {
    const view = { look: look.slice(), role: "hero", caption: save.heroName };
    const items = [
      ...LOOK_ROWS.map((r, i) => ({ label: r.name, hint: r.opts[look[i]], desc: `${r.name}を 変える。いまは 「${r.opts[look[i]]}」`, ...view })),
      { label: "おまかせ", desc: "ぜんぶ ランダムに きめる", ...view },
      { label: "これで けってい", desc: "この すがたで 旅をする。友だちに 渡すカードにも、この すがたが 載る", ...view },
    ];
    const k = await choose(items, { x: 16, y: 40, w: 400, title, start: at });
    if (k < 0 || k === items.length - 1) break;
    at = k;
    if (k === LOOK_ROWS.length) look.splice(0, look.length, ...randomLook());
    else look[k] = (look[k] + 1) % LOOK_N[k];
    sfx("move");
  }
  save.look = look;
  persist();
}
// はじめに、名前と すがたを きめる
async function createHero() {
  const n = await ep.ui.ask({ label: "ゆうしゃの 名前　12字まで", value: save.heroName, okLabel: "決める" });
  const name = n === null ? "" : sanitizeText(n, 12);
  if (name) save.heroName = name;
  await lookMenu("すがたを えらぼう");
  await say(`${save.heroName}！ いい すがただ。\nさあ、冒険に でかけよう。`, { auto: 700 });
}
async function cardMenu() {
  for (;;) {
    const k = await choose([
      { label: "自分の カードを 出す", desc: "友だちに 送る 1行の コードを 作ります。いまの すがたが 載ります", look: save.look, role: "hero", caption: save.heroName },
      { label: "友だちの カードを 取りこむ", desc: "もらった コードを 貼ると、友だちの 分身が 酒場に 来ます。同じ人の 新しいカードなら、すがたが 新しくなります" },
      { label: "取りこんだ カード", hint: `${save.cards.length}枚` },
      { label: "すがたを かえる", desc: "かみがた・色・かぶりもの を えらびなおす", look: save.look, role: "hero", caption: save.heroName },
      { label: "名前を かえる", hint: save.heroName },
      { label: "もどる" },
    ], { x: 16, y: 120, w: 400, title: "冒険者カード" });
    if (k < 0 || k === 5) return;
    if (k === 0) {
      const r = await choose(ROLE_IDS.map((id) => ({ label: `${ROLES[id].emoji}${ROLES[id].name}`, look: save.look, role: id, caption: save.heroName, caption2: ROLES[id].name })), { x: 16, y: 150, w: 260, title: "どの役割で 出す？" });
      if (r < 0) continue;
      const quip = await ep.ui.ask({ label: "ひとこと", value: "よろしくな！", okLabel: "つぎへ" });
      if (quip === null) continue;
      const code = encodeCard({ name: save.heroName, role: ROLE_IDS[r], lv: save.lv, quip, seed: hashStr(`${save.heroName}|${save.seed}`) & 0x7fffffff, look: save.look });
      try { await navigator.clipboard.writeText(code); toast("コードを コピーしました"); } catch { /* コピーできなくても、窓から写せる */ }
      await ep.ui.ask({ label: "あなたの 冒険者カード。このコードを 友だちに 送ってください", value: code, okLabel: "とじる" });
    } else if (k === 1) {
      await importCard();
    } else if (k === 2) {
      if (!save.cards.length) { await say("取りこんだ カードは ない。"); continue; }
      const i = await choose([...save.cards.map((c) => ({ label: `${ROLES[c.role].emoji}${c.name}`, hint: `Lv.${c.lv}`, desc: `「${c.quip}」`, look: lookOf(c), role: c.role, caption: c.name, caption2: ROLES[c.role].name })), { label: "もどる" }], { x: 16, y: 60, w: 460, title: "取りこんだ カード" });
      if (i < 0 || i >= save.cards.length) continue;
      const c = save.cards[i];
      const m = await choose([{ label: "この カードを 消す" }, { label: "もどる" }], { x: 16, y: 150, w: 300, title: c.name });
      if (m !== 0) continue;
      save.cards = save.cards.filter((x) => x.id !== c.id);
      save.friends = save.friends.filter((f) => f.id !== c.id);
      save.party = save.party.filter((id) => id !== c.id);
      await say(`${c.name}の カードを 消した。`);
    } else if (k === 3) {
      await lookMenu();
    } else if (k === 4) {
      const n = await ep.ui.ask({ label: "ゆうしゃの 名前　12字まで", value: save.heroName, okLabel: "決める" });
      const name = n === null ? "" : sanitizeText(n, 12);
      if (name) { save.heroName = name; await say(`これからは 「${name}」と 名のろう。`); }
    }
  }
}

// ---- 地図のメニュー ---------------------------------------------------------------------------
async function showStatus() {
  const w = gear();
  const names = (g) => (g ? gearName(g) : "なし");
  await say(`${save.heroName} Lv.${save.lv}　HP ${U(save.hp)}/${U(hpMax())}　MP ${U(save.mp)}/${U(mpMax())}\nこうげき ${U(heroAtk())}　まもり ${U(heroDef())}　すばやさ ${Math.round(heroSpd())}\n次のレベルまで ${expNeed(save.lv) - save.exp}`);
  await say(`武器： ${names(w.weapon)}\n防具： ${names(w.armor)}\nアクセサリ： ${names(w.acc)}${w.acc ? `　${ACC_DEFS[w.acc.affinity].desc}` : ""}`);
  await say(`たおした かず ${save.kills}体　かいほうした ようりょう ${fmtSize(save.freed)}\nしょじきん ${save.gold}G　回収待ち ${pending.length}体`);
  await sayLong(aiStatusText());
}
// 持ち物：道具を つかう・装備を かえる・素材を みる
async function inventoryMenu() {
  for (;;) {
    const k = await choose([{ label: "どうぐを つかう" }, { label: "そうび" }, { label: "素材を みる" }, { label: "もどる" }], { x: 16, y: 120, w: 300, title: "持ち物" });
    if (k < 0 || k === 3) return;
    if (k === 0) await useItemsOutside();
    else if (k === 1) await equipMenu();
    else {
      const ids = Object.keys(save.inv.mat).sort();
      await say(ids.length ? ids.map((id) => `${matInfo(id).name}×${save.inv.mat[id]}`).join("　") : "素材は まだ ない。");
    }
  }
}
async function useItemsOutside() {
  for (;;) {
    const keys = Object.keys(ITEMS).filter((x) => (save.inv.item[x] || 0) > 0 && ["herb", "herb2", "ether"].includes(x));
    if (!keys.length) { await say("つかえる どうぐを もっていない。"); return; }
    const j = await choose([...keys.map((x) => ({ label: ITEMS[x].name, hint: `×${save.inv.item[x]}`, desc: ITEMS[x].desc })), { label: "やめる" }], { x: 16, y: 100, w: 340, title: "どうぐ" });
    if (j < 0 || j >= keys.length) return;
    const id = keys[j];
    const units = partyUnits();
    let t = units[0];
    if (units.length > 1) {
      const m = await choose(units.map((u) => ({ label: `${u.emoji}${u.name}`, hint: `HP ${U(u.hp)}` })), { x: 16, y: 150, w: 300, title: "だれに？" });
      if (m < 0) continue;
      t = units[m];
    }
    save.inv.item[id]--;
    if (id === "ether") t.mp = Math.min(t.maxMp, t.mp + 25);
    else t.hp = Math.min(t.maxHp, t.hp + Math.round((id === "herb" ? 50 + save.lv * 2 : 120 + save.lv * 4) * (1 + accEffect("heal"))));
    sfx("heal");
    await say(`${ITEMS[id].name}を つかった！ ${t.name}の ${id === "ether" ? "MP" : "HP"}が かいふくした！`, { auto: 800 });
  }
}
async function equipMenu() {
  for (;;) {
    const w = gear();
    const k = await choose(["weapon", "armor", "acc"].map((slot) => ({ label: SLOT_NAMES[slot], hint: w[slot] ? gearName(w[slot]) : "なし" })).concat({ label: "もどる" }), { x: 16, y: 100, w: 520, title: "そうび" });
    if (k < 0 || k === 3) return;
    const slot = ["weapon", "armor", "acc"][k];
    const owned = ownedGear(save, slot);
    if (!owned.length) { await say(`${SLOT_NAMES[slot]}は もっていない。`); continue; }
    const j = await choose([...owned.map((g) => ({
      label: `${save.equip[slot] === g.id ? "＊" : "　"}${gearName(g)}`,
      desc: g.slot === "acc" ? ACC_DEFS[g.affinity].desc : `${g.slot === "weapon" ? "こうげき" : "まもり"} +${U(g.slot === "weapon" ? gearAtk(g) : gearDef(g))}${g.affinity ? `　${SPECIES[g.affinity].name}に 1.15倍` : ""}`,
    })), ...(slot === "acc" ? [{ label: "はずす" }] : []), { label: "もどる" }], { x: 16, y: 60, w: 520, title: SLOT_NAMES[slot] });
    if (j < 0) continue;
    if (j < owned.length) { equipGear(save, owned[j].id); sfx("ok"); await say(`${gearName(owned[j])}を そうびした。`, { auto: 600 }); }
    else if (slot === "acc" && j === owned.length) { save.equip.acc = null; await say("アクセサリを はずした。", { auto: 600 }); }
  }
}
async function fieldMenu() {
  for (;;) {
    const k = await choose([{ label: "つよさ" }, { label: "持ち物" }, { label: "仲間", hint: `${save.party.length}/${MAX_PARTY - 1}` }, { label: "依頼" }, { label: "物語" }, { label: "ファイル" }, { label: "冒険者カード" }, { label: "とじる" }], { x: 16, y: 100, w: 330 });
    if (k < 0 || k === 7) break;
    if (k === 0) await showStatus();
    else if (k === 1) await inventoryMenu();
    else if (k === 2) await friendsMenu();
    else if (k === 3) await say(save.active.length ? save.active.map((q) => `・${q.title}　${qProgress(q)}`).join("\n") : "うけている 依頼は ない。\n町の 依頼所で うけられるぞ。");
    else if (k === 4) await storyMenu();
    else if (k === 5) await filesMenu();
    else await cardMenu();
  }
  clearMsg();
}
async function filesMenu() {
  for (;;) {
    const k = await choose([{ label: "回収待ちを みる", hint: `${pending.length}体` }, { label: "守られたファイル", hint: `${guarded.length}件` }, { label: "地図を ひろげなおす" }, { label: "冒険の地を えらびなおす" }, { label: "もどる" }], { x: 16, y: 120, w: 400, title: "ファイル" });
    if (k < 0 || k === 4) return;
    if (k === 0) await reviewPending();
    else if (k === 1) await reviewGuarded();
    else {
      if (await scanFlow({ pick: k === 3, confirm: "冒険の地を調べなおして、敵を集めなおします。時間がかかることがあります。" })) await say(scanReport());
    }
  }
}

// ---- コマンド（Ctrl+Shift+P）-------------------------------------------------------------------
function registerCommands() {
  return ep.commands.set([
    { id: "save", label: "ファイル・クエスト：セーブする", hint: "自動でもセーブされます" },
    { id: "aiCheck", label: "ファイル・クエスト：AIの接続を確かめる", hint: "キー・モデル・返事の形を調べて、うまくいかない理由を出す" },
    { id: "reset", label: "ファイル・クエスト：最初からやりなおす", hint: "レベルや記録、冒険の地を消す。ファイルには影響しません" },
    ...(s.debug ? [
      { id: "debugProgress", label: "ファイル・クエスト デバッグ：進行度をリセット", hint: "レベル・持ち物・依頼・位置を最初に戻す。調べた結果と回収待ちは残す" },
      { id: "debugRescan", label: "ファイル・クエスト デバッグ：進行度をリセットして調べなおす", hint: "回収待ちも空にして、敵を集めなおす。ファイルには影響しません" },
    ] : []),
  ]).catch(() => {});
}
await registerCommands();

// ---- リセット ------------------------------------------------------------------------------
// 動いているゲームの中身そのものを入れかえて、保存する（保存だけ消しても、次の自動セーブで元に戻ってしまうため）。
// ファイルにも、ごみ箱にも触らない
function applyFreshSave(next) {
  clearDungeon();
  clearTown();
  save = next;
  world = makeWorld();                                          // 部が あれば その島、なければ いまの島
  drawMini();
  save.x = world.start.x;
  save.y = world.start.y;
  save.hp = hpMax();
  save.mp = mpMax();
  placeWalker(hero, save.x, save.y);
  stepsSince = 0;
}
async function resetAll() {
  if (!(await ep.ui.confirm("ゆうしゃのレベル・記録・冒険の地・フレンド・カード・回収待ちの一覧を消して、最初から始めます。ファイルは消えません。", { okLabel: "消す" }))) return false;
  const seed = save.seed, islandSeed = save.islandSeed;          // 島は、冒険の地を選びなおすまで今のまま
  for (const k of Object.keys(appraisal)) delete appraisal[k];
  for (const k of Object.keys(loreStore)) delete loreStore[k];
  pending = [];
  guarded = [];
  pool = { at: 0, days: 0, list: [], truncated: false };
  applyFreshSave(Object.assign(migrateSave(newSave()), { seed, islandSeed }));
  for (const k of ["appraisal", "lore"]) await ep.storage.delete(k);
  persist(); persistPending(); persistPool(); persistGuarded();
  await boot();
  return true;
}
async function resetProgress(rescan) {
  const msg = rescan
    ? "進行度を最初に戻し、回収待ちも空にして、敵を調べなおします。時間がかかることがあります。ファイルは消えません。"
    : "進行度を最初に戻します。レベル・持ち物・依頼・位置・フレンドの絆が戻り、調べた結果と回収待ちは残ります。ファイルは消えません。";
  if (!(await ep.ui.confirm(msg, { okLabel: "戻す" }))) return;
  applyFreshSave(resetSave(save, migrateSave(newSave())));
  if (rescan) {
    pending = [];
    guarded = [];
    save.spared = [];
    persistPending(); persistGuarded();
    await scanFlow();                                           // 敵を集めなおす。依頼も作りなおされる。大きさの検査に通らなければ、前の敵のまま
  } else makeOffers();
  persist();
  await say(rescan ? `進行度を 最初に もどした。\n${pool.list.length}体の モンスターが うろついている。` : "進行度を 最初に もどした。");
}

// AIの接続を確かめる：キー・モデル・返事の形を試して、うまくいかない理由を出す
async function aiCheck() {
  llmDownUntil = 0;                                              // 休み中でも、確かめる
  llmFails = 0;
  s = await ep.settings.get().catch(() => s);
  if (!s.llm) { await say("AIは オフになっている。\n設定の『AIでセリフ・鑑定・依頼を作る』を オンにしよう。"); return; }
  if (!s.apiKey) { await say("APIキーが 入っていない。\n設定の『Anthropic の API キー』に 入れよう。"); return; }
  await say(`AIに つないでみる… モデル ${s.model}`, { auto: 500 });
  const t0 = Date.now();
  try {
    const r = await ai.ping();
    llmOk();
    await sayLong(`つながった！ ${((Date.now() - t0) / 1000).toFixed(1)}秒\nAIの ひとこと「${r.say}」\n終わり方 ${r.meta.stop || "なし"}　出力 ${r.meta.out}トークン`);
  } catch (err) {
    llmFailed(err);
    await sayLong(`うまく つながらなかった。\n${aiReason(err)}`);
  }
}

ep.onCommand(async (id) => {
  if (id === "save") { persist(); toast("セーブしました"); return; }
  if (busy) { toast("いまは 使えません。地図の上で 立ち止まってから 選んでください"); return; }      // 会話・戦闘・メニューの最中は、中身を入れかえない
  if (id === "aiCheck") await runEvent(aiCheck);
  else if (id === "reset") await runEvent(resetAll);
  else if (s.debug && id === "debugProgress") await runEvent(() => resetProgress(false));
  else if (s.debug && id === "debugRescan") await runEvent(() => resetProgress(true));
});

// ---- はじまり -----------------------------------------------------------------------------------
if (window.__FQ_TEST) window.__FQ_TEST({ get save() { return save; }, get pool() { return pool; }, get pending() { return pending; }, get guarded() { return guarded; }, ui, press, hero, get world() { return world; }, get bs() { return bs; }, get dg() { return dg; }, get tn() { return tn; }, get part() { const r = partRec(); return r && { def: r.def, prog: r.progress, story: r.story }; }, get dodge() { return dodge; }, get busy() { return busy; }, get scene() { return scene; } });
requestAnimationFrame(frame);

// 起動のたびに出す入口。ここから、冒険の地を選びなおす・最初からやりなおす、ができる
async function titleMenu() {
  const k = await choose([
    { label: "つづきから", hint: `Lv.${save.lv}　冒険の地 ${save.roots.length}か所`, desc: "前回の 続きを あそぶ" },
    { label: "冒険の地を えらびなおす", desc: "モンスターが すむ フォルダを えらんで、敵を集めなおす" },
    { label: "最初から やりなおす", desc: "レベルや記録を 消して、はじめから" },
  ], { x: 280, y: 190, w: 400, title: "ファイル・クエスト" });
  return k === 1 ? "pick" : k === 2 ? "reset" : "continue";
}

async function boot() {
  try {
    let scanned = false;
    if (save.roots.length) {
      const act = await titleMenu();
      if (act === "reset" && (await resetAll())) return;                    // はじめからの流れは、resetAll の中の boot がやる
      if (act === "pick") scanned = await scanFlow({ pick: true });          // 大きさの検査に通らなければ、前の冒険の地のまま
    }
    if (!save.roots.length) {
      scene = "map";
      await say("ここは ファイルの せかい。\n長いあいだ だれにも つかわれなかった ファイルたちが、モンスターとなって さまよっている。");
      await say("たおした ファイルは すぐには きえない。『回収待ち』に なり、町の 回収所で まとめて ごみ箱へ おくられる。\nそのとき アプリの かくにんが 1回だけ 出る。");
      await say("まず、きみの 名前と すがたを えらぼう。");
      await createHero();
      await say("まず、モンスターが すむ 『冒険の地』を えらぼう。\nえらんだ フォルダの中の 古いファイルが あいてになる。");
      scanned = await scanFlow({ pick: true, first: true });                // 大きさの検査に通る場所を えらぶまで
      if (!s.apiKey) toast("設定で API キーを入れると、AIがセリフと日誌を作ります");
    }
    if (!scanned && !pool.at) scanned = await scanFlow();                    // 前回の続きで、まだ調べていない
    if (!partRec() && pool.list.length) await ensurePart();                  // 前の版の保存：部が まだ無い
    if (scanned) {
      if (!pool.list.length) await say("この あたりには たたかう あいてが いないようだ…\nメニューの『ファイル』から 冒険の地を えらびなおすか、設定の『未使用の日数』を 短くしてみよう。");
      else await say(`${pool.list.length}体の モンスターが うろついている！${scanNote()}\n矢印キーか WASDで あるいて、ぼうけんに でかけよう！`);
    }
    if (!save.offers.length && !save.active.length) makeOffers();
  } catch (err) { console.error("[boot]", err); toast(`エラー：${err.message}`); }
  clearMsg();
}
resumeDungeon();                                                        // 前回、ダンジョンの中で終えたなら、そこから
boot().then(() => { busy = false; });
