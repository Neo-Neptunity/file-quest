// 画面なしの通しプレイ：ボットが 地図を歩き、町で買い物・仲間づくりをし、戦って、回収するところまで通す。
//   使い方：node file-quest/dev/play.mjs [--noai] [--manual] [--aichaos] [--frames=90000]
//   --noai：AI を使わない（キーなし）　--manual：仲間の操作を「自分で選ぶ」にする
//   --explore：何でも触ってみる（どの画面・どの技も、ランダムに選ぶ。通る道を増やす）　--rich：お金・素材・絆を、最初から持たせる
//   --aichaos：AI が、失敗・壊れた返事・範囲外の数値・「全部ごみ」を返す（それでも守るべきファイルは守られ、エラーが出ないこと）
//   --reset：途中で、進行度のリセット（デバッグ2種と、最初からやりなおす）と、AIの接続の確認を コマンドで呼び、中身が入れかわって、保存も戻されないことを確かめる
//   --gate：冒険の地の上限を小さくして、大きすぎる場所を選ぶと AI の鑑定の前に断られ、選びなおして通ること（--gate=abort：調べている途中で「もう大きすぎる」とやめる道）
//   --dungeon：ダンジョン専用：すぐ 近くの遺跡へ向かい、階を歩いて、宝箱・泉・階段・ボスまで進む
//   --lv=12：--dungeon と合わせて、最初からそのレベルにする（奥のボスを倒すところまで通すため）
//   --campaign：部を 最後まで通す（--dungeon --god --lv=20 と、長い時間）。ぬしを倒して、結末を選び、殿堂に入るまで
//   --dodge：敵のこうげきの弾よけを、いつも ほんとうに よける（ふだんは、3割だけ よけて、あとは Esc でとばす）　--nododge：弾よけを オフにする（設定）
//   --god：戦闘中は 体力が減らない（ボスまで必ず勝って、倒したあとの道を通すため）
//   --title：前回の続きがある状態で起動し、入口の『冒険の地を えらびなおす』から、フォルダをたどる・パスを打つ、までを通す
import { stage } from "./stage.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
if (args.campaign) { args.dungeon = true; args.god = true; args.lv = args.lv || 20; }
const MAX_FRAMES = Number(args.frames || (args.campaign ? 300000 : 90000));
const noop = () => {};
const BS = String.fromCharCode(92);
const P = (p) => p.replaceAll("/", BS);
const DAY = 86400000;
const st = stage("play");

// ---- 偽の画面 ----
const listeners = {};
const mkEl = () => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === "getBoundingClientRect") return () => ({ left: 0, top: 0, width: 960, height: 540 });
    if (k === "getContext") return () => ctx2d;
    if (k === "addEventListener") return (n, f) => (listeners[n] ||= []).push(f);
    if (k === "setPointerCapture") return noop;
    if (k === "style") return {};
    if (typeof k === "symbol") return undefined;
    return t[k] ?? noop;
  },
  set: (t, k, v) => ((t[k] = v), true),
});
const ctx2d = new Proxy({}, {
  get: (t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createRadialGradient" || k === "createLinearGradient" ? () => ({ addColorStop: noop }) : t[k] ?? noop),
  set: (t, k, v) => ((t[k] = v), true),
});
ctx2d.fillText = (s) => { s = String(s); if (s.includes("放置")) idleTexts.add(s); };
globalThis.window = { addEventListener: (n, f) => (listeners[n] ||= []).push(f), devicePixelRatio: 1, __FQ_TEST: (api) => (globalThis.fq = api) };
globalThis.document = { createElement: () => mkEl(), head: mkEl(), body: mkEl(), querySelector: () => mkEl() };
globalThis.ResizeObserver = class { observe() {} };
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; }
  createOscillator() { return { frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: (x) => x, start: noop, stop: noop }; }
  createGain() { return { gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: (x) => x }; }
};
let raf = null;
globalThis.requestAnimationFrame = (f) => { raf = f; };
// 時間を早回しする（1日 = 4000 フレーム）。日替わりの特価や依頼が、入れ替わるので
const realNow = Date.now.bind(Date);
let frameNow = 0;
const idleTexts = new Set();       // 画面に出た『◯年◯か月 放置』
const D = { checked: false, since: -1, modified: -1 };         // 日付が分からないファイル（来て久しいもの）の記録
Date.now = () => realNow() + Math.floor(frameNow / 4000) * DAY;

// ---- 偽のファイルシステム ----
const fs = new Map();
let nid = 0;
const mkFile = (dir, name, size, ageDays = 900, extra = {}) => {
  const same = [...fs.values()].find((e) => e.path === P(`${dir}/${name}`));       // 同じ場所に同じ名前があれば、それを返す
  if (same) return same;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const e = { id: "f" + nid++, name, path: P(`${dir}/${name}`), kind: "file", ext, hidden: false, size, modified: realNow() - ageDays * DAY, ...extra };
  fs.set(e.id, e);
  return e;
};
const guardedNames = ["確定申告2023.pdf", "契約書_山田.pdf", "wallet.kdbx"];
const protectedAll = [], aiGuardedAll = [];        // 守るべきファイル（いつ作ったものも、回収されてはいけない）
// 偽のフォルダの中身を作る。リセットの試験では、あとからもう一度呼んで、新しい古いファイルが増えた状況を作る
function seedFiles() {
  for (let i = 0; i < 20; i++) mkFile("C:/Data", `old${i}.${["png", "zip", "mp3", "exe", "bin", "pdf"][i % 6]}`, Math.round(3000 * Math.pow(1.3, i)));
  mkFile("C:/Data", "bigvideo.mp4", 60 * 1024 * 1024);
  mkFile("C:/Data", "bigvideo2.mp4", 45 * 1024 * 1024);
  for (let i = 0; i < 24; i++) mkFile("C:/Data/Photos", `IMG_${1000 + i}.jpg`, 400000 + i * 90000);
  for (let i = 0; i < 12; i++) mkFile("C:/Data/Docs", `memo_${i}.txt`, 2000 + i * 500);
  for (const n of guardedNames) protectedAll.push(mkFile("C:/Data/Docs", n, 50000));
  aiGuardedAll.push(mkFile("C:/Data/Docs", "memo_secret.txt", 3000));          // 手元の判定は低いが、AI が「大事」と言うファイル
  for (let i = 0; i < 18; i++) mkFile("C:/Data/Tmp", `cache${i}.tmp`, 1000 + i * 700);
  // 日付が分からない（1980年）ファイル。作成日時で数える：来て久しければ敵（放置は約2年半）。昨日来た・来た日時も分からないなら、守る
  const DOS = Date.UTC(1980, 0, 1);
  mkFile("C:/Data/Docs", "dosdate_old.zip", 4000, 0, { modified: DOS, created: realNow() - 900 * DAY });
  protectedAll.push(mkFile("C:/Data/Docs", "dosdate_new.zip", 4000, 0, { modified: DOS, created: realNow() - 1 * DAY }));
  protectedAll.push(mkFile("C:/Data/Docs", "dosdate_unknown.zip", 4000, 0, { modified: DOS, created: 0 }));
  protectedAll.push(mkFile("C:/Data", "x.dll", 9999));
  protectedAll.push(mkFile("C:/Windows", "a.txt", 9999));
  protectedAll.push(mkFile("C:/Data", "new.txt", 9999, 1));
}
seedFiles();

// ---- 偽の本体 API ----
const store = new Map();
const log = { trash: [], errors: [], opened: [], tabs: [], toasts: [], net: [], asks: [], queried: [], candLists: [] };
console.error = (...a) => { log.errors.push(a.join(" ")); };
const AI_ON = !args.noai;
let cardCode = null;
if (args.title) store.set("save", JSON.stringify({ roots: [{ id: "q1", path: P("C:/Data") }], heroName: "テスター" }));      // 前回の続きがある
let cmdHandler = null, cmdList = [];
// --title：冒険の地を、たどって選び、パスも打つ（本体の選択窓の返事を、台本どおりに返す）
const PICK_SCRIPT = args.title ? ["manual", "browse", "dir:" + P("C:/Data"), "dir:" + P("C:/Data/Photos"), "pick", "type", "done"]
  // --gate：まず自分で C:\Data（大きすぎる）を選んで断られ、選びなおしで出る おすすめ（Data は出ない）から Photos を選ぶ
  : args.gate ? ["manual", "qa:" + P("C:/Data"), "done", "first"] : [];
const staged = { card: await import(st.url("card.js")), grid: await import(st.url("grid.js")), dg: await import(st.url("dungeon.js")), world: await import(st.url("world.js")), town: await import(st.url("town.js")), bullets: await import(st.url("bullets.js")) };
// 友だちのカード：読みこむたびに、順ぐりに違う人が出る（酒場の顔ぶれを、複数にするため）
const friendCards = [
  { name: "ミライ", role: "healer", lv: 14, quip: "回復は まかせて", seed: 4242, look: [1, 2, 0, 5, 1] },
  { name: "タカシ", role: "front", lv: 10, quip: "まかせろ！", seed: 777, look: [2, 3, 3, 0, 2] },
  { name: "サキ", role: "thief", lv: 8, quip: "いただき", seed: 31337, look: [3, 7, 1, 6, 3] },
].map((c) => staged.card.encodeCard(c));
const friendLooks = { ミライ: [1, 2, 0, 5, 1], タカシ: [2, 3, 3, 0, 2], サキ: [3, 7, 1, 6, 3] };
let cardTurn = 0;

const ep = {
  ready: async () => ({}),
  settings: { get: async () => ({ staleDays: 730, useAccessTime: true, encounter: args.dungeon ? "low" : "high", sound: true, llm: AI_ON, apiKey: AI_ON, debug: !!args.reset, minCount: 10, minMB: 10, maxCount: args.gate === "abort" ? 25 : args.gate ? 30 : 1000, model: "claude-haiku-5-5", autoParty: args.manual ? "manual" : "auto", dodge: !args.nododge, appraiseFolder: false }) },
  onSettings: noop, onCommand: (f) => { cmdHandler = f; },
  commands: { set: async (l) => { cmdList = l; } },
  storage: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : undefined), set: async (k, v) => void store.set(k, JSON.stringify(v)), delete: async (k) => void store.delete(k) },
  ui: {
    toast: async (m) => void log.toasts.push(m), status: async () => {},
    confirm: async () => true,
    ask: async (o) => {
      log.asks.push(o.label);
      if (o.label.includes("フォルダのパス")) return P("C:/Data/Docs");
      if (o.label.includes("友だちから")) return friendCards[cardTurn++ % friendCards.length];
      if (o.label.includes("ひとこと")) return "よろしく！";
      if (o.label.includes("あなたの 冒険者カード")) { cardCode = o.value; return null; }
      if (o.label.includes("ゆうしゃの 名前")) return "テスター";
      return null;
    },
    choose: async (items, o) => {
      const ids = items.map((i) => String(i.id));
      if (ids.some((id) => id.startsWith("cand:"))) {                          // おすすめの一覧：台本があればそれ、なければ先頭の候補
        log.candLists.push(items.map((i) => ({ id: i.id, label: i.label, hint: i.hint })));
        const tok = PICK_SCRIPT.length ? PICK_SCRIPT.shift() : "first";
        return tok === "first" ? ids.find((id) => id.startsWith("cand:")) : tok;
      }
      if (PICK_SCRIPT.length) { const tok = PICK_SCRIPT.shift(); return tok === "first" ? ids.find((id) => id.startsWith("cand:")) || "done" : tok; }
      const n = chosenRoot++;
      return n === 0 ? "qa:" + P("C:/Data") : "done";
    },
  },
  quickAccess: { list: async () => [{ id: "q1", name: "Data", path: P("C:/Data"), kind: "folder" }] },
  system: { drives: async () => [] },
  recent: { list: async () => [] },
  search: {
    find: async (root, q, o = {}) => {
      log.queried.push(root.path);
      const rp = root.path.replace(/\\$/, "").toLowerCase();
      const parentOf = (p) => p.slice(0, p.lastIndexOf(BS));
      const all = [...fs.values()];
      const dirs = new Set();
      for (const e of all) { let d = parentOf(e.path); while (d.length > 2) { dirs.add(d); d = parentOf(d); } }
      const inScope = (p) => (o.depth === 1 ? parentOf(p).toLowerCase() === rp : p.toLowerCase().startsWith(rp + BS));
      if (q.kind === "folder") return { entries: [...dirs].filter((d) => parentOf(d).toLowerCase() === rp).map((d) => ({ id: "d" + d, name: d.slice(d.lastIndexOf(BS) + 1), path: d, kind: "folder", ext: "", hidden: false })), truncated: false };
      return { entries: all.filter((e) => inScope(e.path) && e.modified < q.modifiedBefore), truncated: false };
    },
  },
  files: { properties: async (c) => c.map((e) => { const f = fs.get(e.id); return { "System.DateCreated": f ? (f.created ?? f.modified) : 0, "System.DateAccessed": f ? (f.accessed ?? f.created ?? f.modified) : 0 }; }) },
  resolve: async (refs) => refs.map((r) => fs.get(r.id) || null),
  trash: async (list) => { log.trash.push(list.map((r) => r.id)); let n = 0; for (const r of list) if (fs.delete(r.id)) n++; return { trashed: n }; },
  collections: { list: async () => [], create: async (n) => ({ id: "c1", name: n }), add: async () => {}, remove: async () => {} },
  open: async (e) => void log.opened.push(e.path),
  tabs: { open: async (id, o) => void log.tabs.push(o.path) },
  net: {
    fetch: async (url, o) => {
      const sys = o.json.system, user = o.json.messages[0].content;
      if (args.aichaos) {                           // AI がこわれている・悪さをする場合：失敗・壊れた返事・範囲外の数値・何でも「ごみ」と言う
        const r = Math.random();
        if (r < 0.2) throw Object.assign(new Error("network down"), { code: "network" });
        if (r < 0.4) return { ok: false, status: 500, json: async () => ({}) };
        if (r < 0.5) return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"title":"途中で切れ' }], stop_reason: "max_tokens" }) };
        if (r < 0.6) return { ok: true, status: 200, json: async () => ({ content: [{ type: "thinking", thinking: "" }], stop_reason: "max_tokens", usage: { output_tokens: 380 } }) };      // 考えただけで文章が無い
        if (r < 0.8) {
          const evil = sys.includes("得意技") ? { title: "<b>悪</b>", taunt: "x".repeat(300), last: "y", skill: { name: "全滅", msg: "z", effect: "kill_all", power: 9999 } }
            : sys.includes("鑑定士") ? JSON.parse(user).map((it) => ({ k: it.k, imp: 0, why: "全部ごみ", tag: "ゴミ" }))
            : sys.includes("依頼所の主人") ? [{ type: "cat", cat: "image", need: 99999, title: "x" }, { type: "boss", need: -5 }, "壊れ"]
            : sys.includes("物語の作家") ? { title: "<b>悪</b>" + "あ".repeat(80), intro: "x", chapters: [null, { tale: ["x".repeat(400)], bosses: 99, reward: 9999 }], cleaner: [999, -1], endings: { keep: "（注釈）" + "い".repeat(500) }, hook: 5 }
            : "文章";
          log.net.push({ url, secret: o.secret, keyInBody: false, kind: "chaos" });
          return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(evil) }], stop_reason: "end_turn" }) };
        }
      }
      log.net.push({ url, secret: o.secret, keyInBody: JSON.stringify(o).includes("sk-"), kind: sys.includes("得意技") ? "lore" : sys.includes("鑑定士") ? "appraise" : sys.includes("依頼所の主人") ? "quests" : sys.includes("接続の確認係") ? "ping" : sys.includes("物語の作家") ? "story" : "journal", effort: o.json.output_config && o.json.output_config.effort, maxTokens: o.json.max_tokens, user: user.slice(0, 120) });
      let body;
      if (sys.includes("得意技")) body = JSON.stringify({ title: "テスト二つ名", taunt: "AIのセリフだ", last: "AIの最期だ", skill: { name: "最終版の呪い", msg: "終わらない修正を 浴びせた", effect: ["damage", "sleep", "blind", "guard", "drain", "heal"][log.net.length % 6], power: 1.3 } });
      else if (sys.includes("鑑定士")) body = JSON.stringify(JSON.parse(user).map((it) => ({ k: it.k, imp: it.n === "memo_secret.txt" ? 80 : 5, why: it.n === "memo_secret.txt" ? "秘密の書類のようだ" : "ごみ", tag: it.n === "memo_secret.txt" ? "仕事" : "ゴミ" })));
      else if (sys.includes("依頼所の主人")) body = JSON.stringify([{ title: "AIの依頼：掃除", story: "ほこりだらけだ", type: "cat", cat: "image", need: 2 }, { title: "AIの依頼：なんでも", story: "腕だめしだ", type: "any", need: 6 }]);
      else if (sys.includes("接続の確認係")) body = JSON.stringify({ ok: true, say: "げんき" });
      else if (sys.includes("物語の作家")) { const K = JSON.parse(user).chapters.length; body = JSON.stringify({ title: "AIの物語の題", intro: ["AIが書いた 序の一文です。ほこりが 降る。", "AIが書いた 序の二文です。ぬしの うわさ。"], nushi: { motive: "AIの考えた 理由です", twist: "じつは AIの どんでん返しです" }, chapters: Array.from({ length: K }, (_, i) => ({ tale: [`AIの章${i + 1} 一ページ目です。`, `AIの章${i + 1} 二ページ目です。`, `AIの章${i + 1} 三ページ目です。`], clue: `AIの章${i + 1} 手がかりです。`, folk: `AIの章${i + 1} 町の人です。`, troubles: [`AIの章${i + 1} 困りごとです。`] })), cleaner: [2], endings: { keep: "AIの守った結末です。ありがとう。", release: "AIの手放した結末です。さようなら。", both: "AIの両方の結末です。ほどよく。" }, hook: "AIの 次への引きです。" }); }
      else body = "今日は よく たたかった。ごみを かたづけて、すっきりした。";
      // 実機のモデルは、考えるブロックが先に付く（文章だけを読めること）
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: body }], stop_reason: "end_turn", usage: { output_tokens: 80 } }) };
    },
  },
};
let chosenRoot = 0;
window.explorerPlus = ep;
const fire = (n, e) => (listeners[n] || []).forEach((f) => f({ preventDefault: noop, ...e }));
await import(st.url("index.js"));

// ---- ボット ----
// 目当ての場所から全体の歩数を数えて、いまの場所から、歩数が減るほうへ進む向き（up/down/left/right）。壁・海・山を避けて、着ける道をたどる
function pathDir(w, h, passable, target, hx, hy) {
  const dist = staged.grid.reach(w, h, passable, target);
  let best = null, bd = dist[hy * w + hx] < 0 ? Infinity : dist[hy * w + hx];
  for (const [name, [dx, dy]] of Object.entries(staged.grid.DIRS)) {
    const nx = hx + dx, ny = hy + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const dd = dist[ny * w + nx];
    if (dd >= 0 && dd < bd) { bd = dd; best = name; }
  }
  return best;
}
// 遺跡のうち、いまの場所から、歩く道のりがいちばん短いもの（直線では近くても、海をはさむ遺跡は、道のりが長い）
let ruinTarget = null;
function nearestByPath(list) {
  const w = fq.world;
  let best = null, bd = Infinity;
  for (const it of list) {
    const dist = staged.grid.reach(w.w, w.h, (x, y) => staged.world.WALKABLE(w.tiles[y * w.w + x]), it.r);
    const d = dist[fq.hero.ty * w.w + fq.hero.tx];
    if (d >= 0 && d < bd) { bd = d; best = it; }
  }
  return best;
}
// ダンジョンの中：宝箱 → （体力が減ったら 泉）→ 下り階段（最後の階は ボス）
let dgGoal = null;
function dgDirection() {
  const d = fq.dg, m = d.map, W = m.w, D = staged.dg.D;
  const hx = fq.hero.tx, hy = fq.hero.ty;
  const open = (x, y) => staged.dg.passable(m.tiles[y * W + x]);
  const closed = m.chests.filter((c) => m.tiles[c.y * W + c.x] === D.CHEST);
  // 宝箱は、歩く道のりが短い順に。1つ決めたら、開けるまで 変えない（迷路や池では、直線の近さと 道のりが ちがうので、行ったり来たりしてしまう）
  if (!dgGoal || dgGoal.key !== d.key + ":" + d.floor || !closed.some((c) => c.x === dgGoal.x && c.y === dgGoal.y)) {
    const dist = staged.grid.reach(W, m.h, open, { x: hx, y: hy });
    const best = closed.map((c) => ({ c, d: dist[c.y * W + c.x] })).filter((q) => q.d >= 0).sort((a, b) => a.d - b.d)[0];
    dgGoal = best ? { key: d.key + ":" + d.floor, x: best.c.x, y: best.c.y } : null;
  }
  const lowHp = m.spring && fq.save.hp < (44 + 13 * fq.save.lv) * 0.55;
  const target = lowHp ? m.spring : dgGoal ? dgGoal : d.floor === d.floors ? m.boss : m.down;
  return target ? pathDir(W, m.h, (x, y) => staged.dg.passable(m.tiles[y * W + x]), target, hx, hy) : null;
}
// 町の中：行き先（店のドア・人・出口）を決めて、人をよけて、歩ける道をたどる。ドアに着くと店の画面が開く（そのあとは、町に戻る）
let townGoal = null, townTalks = 0;
const townDoorsSeen = new Set();
function chooseTownGoal(m) {
  const sv = fq.save, mats = Object.keys(sv.inv.mat).length, hpLow = sv.hp < (44 + 13 * sv.lv) * 0.5;
  const door = (k) => m.doors.find((d) => d.kind === k);
  const goal = (k) => ({ key: m.key, kind: k });
  if (args.explore && Math.random() < 0.7) { const ks = [...m.doors.map((d) => d.kind), "talk", "talk", "exit"]; return goal(ks[Math.floor(Math.random() * ks.length)]); }       // 町は、全部の店を まわる（人に話しかけるのも、出口も、ときどき選ぶ）
  if (fq.pending.length >= 4) return goal("depot");
  if (hpLow) return goal("inn");
  if ((sv.friends.length < 2 || sv.party.length < 2 || !M.friend) && tavernVisits < 14) { tavernVisits++; return goal("tavern"); }
  if (!M.crafted && mats && sv.gold >= 200 && forgeVisits < 3) { forgeVisits++; craftTries = 0; return goal("forge"); }
  if (!M.sold && mats >= 3) return goal("item");
  if (!M.bought && sv.gold >= 30) return goal("item");
  if (!M.quest) return goal("guild");
  if (townTalks < 4) { townTalks++; return goal("talk"); }
  if (hpLow || Math.random() < 0.1) return goal("inn");
  return goal("exit");
}
// 向くべき向き（なければ null）。人に話しかけるときは、となりのマスまで行って、人のほうを向いて Enter
function townDirection() {
  const tn = fq.tn, m = tn.map, hx = fq.hero.tx, hy = fq.hero.ty, W = m.w;
  const open = (x, y) => staged.town.townOpen(m, x, y);
  const here = staged.town.doorAt(m, hx, hy);
  if (here) townDoorsSeen.add(here.kind);
  if (!townGoal || townGoal.key !== m.key) {
    townGoal = chooseTownGoal(m);
    const tg = townGoal.kind === "exit" ? m.exits[0] : m.doors.find((d) => d.kind === townGoal.kind);
    townGoal.startedHere = !!tg && tg.x === hx && tg.y === hy;          // 店から出てきたところで、また同じ店に行きたくなった
  }
  const g = townGoal;
  if (g.kind === "talk") {
    const f = m.folk[g.n ?? (g.n = Math.floor(Math.random() * m.folk.length))];
    if (Math.abs(f.x - hx) + Math.abs(f.y - hy) === 1) {                       // となりに来た：人のほうを向いて、話しかける
      const toward = f.x > hx ? "right" : f.x < hx ? "left" : f.y > hy ? "down" : "up";
      if (fq.hero.dir !== toward) return toward;
      M.talk = (M.talk || 0) + 1;
      townGoal = null;
      return "enter";
    }
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: f.x + dx, y: f.y + dy })).filter((q) => open(q.x, q.y));
    const dist = staged.grid.reach(m.w, m.h, open, { x: hx, y: hy });
    near.sort((u, v) => (dist[u.y * W + u.x] < 0 ? 1e9 : dist[u.y * W + u.x]) - (dist[v.y * W + v.x] < 0 ? 1e9 : dist[v.y * W + v.x]));
    return near.length ? pathDir(m.w, m.h, open, near[0], hx, hy) : (townGoal = null);
  }
  const target = g.kind === "exit" ? m.exits[0] : m.doors.find((d) => d.kind === g.kind);
  if (!target) { townGoal = null; return null; }
  if (hx === target.x && hy === target.y) {
    if (g.startedHere && !g.left) {                                                       // いったん ドアから出て、入りなおす
      g.left = true;
      const step = Object.entries(staged.grid.DIRS).find(([, [dx, dy]]) => open(hx + dx, hy + dy));
      if (step) return step[0];
    }
    townGoal = null;                                                                      // 着いた（店は、着いたときに もう開いて、閉じた）
    return null;
  }
  return pathDir(m.w, m.h, open, target, hx, hy);
}
// 世界地図の上：目的地（町・遺跡）へ、歩ける道をたどる
// 部があるとき、入れる町（章が進むと ふえる）。いまの章の遺跡だけが 入れる遺跡
const unlockedTowns = () => (fq.part ? fq.world.towns.slice(0, fq.part.prog.chapter) : fq.world.towns);
function worldDirTo(target) {
  const w = fq.world;
  return pathDir(w.w, w.h, (x, y) => staged.world.WALKABLE(w.tiles[y * w.w + x]), target, fq.hero.tx, fq.hero.ty);
}
const M = { cardImport: false, cardMade: false, rename: false, crafted: false, sold: false, bought: false, quest: false, depot: false, multi: 0, partyBattle: 0, friend: 0, bossSeen: false };
const stat = { frames: 0, maxEnemies: 0, maxAllies: 0, kills: 0, deaths: 0 };
const dirs = ["arrowup", "arrowdown", "arrowleft", "arrowright"];
let dodgeSeen = null, dodgeSim = null, dodgePlay = false, dodgeKeys = new Set(), campaignDoneAt = 0, storyTurn = 0, craftTries = 0, forgeVisits = 0, sameCount = 0, lastSig = "", rescues = 0, dir = null, stuck = 0, lastPos = "", fieldDone = false, tavernVisits = 0, depotVisits = 0, importTries = 0, titleDone = false, lookTurns = 0, lastDgMsg = "", defeatSeen = false, lastMsgObj = null;
const visitorSteps = new Map();
const count = (re) => (re.test ? 0 : 0);

function pickChoice(c) {
  const labels = c.items.map((x) => x.label), title = c.title || "";
  if (args.explore) {
    const ok = c.items.map((it, k) => (it.disabled ? -1 : k)).filter((k) => k >= 0);
    if (!ok.length) return -1;
    if (labels.includes("たたかう")) {                          // 戦闘のコマンドは、重みつきで
      if (fq.bs) { stat.maxEnemies = Math.max(stat.maxEnemies, fq.bs.enemies.length); stat.maxAllies = Math.max(stat.maxAllies, fq.bs.allies.length); if (fq.bs.enemies.length >= 2) M.multi++; if (fq.bs.allies.length >= 2) { M.partyBattle++; if (!fq.bs.allies.every((a) => Array.isArray(a.look) && a.look.length === 5)) M.badLook = true; } if (fq.bs.enemies.some((e) => e.boss)) M.bossSeen = true; }
      if (args.rich && fq.bs && fq.bs.allies.length > 1 && Math.random() < 0.06) { const a = fq.bs.allies[fq.bs.allies.length - 1]; if (a.kind === "friend" && a.hp > 0) a.hp = 0; }
      const r = Math.random();
      return r < 0.4 ? 0 : r < 0.75 ? 1 : r < 0.83 ? 2 : r < 0.95 ? 3 : 4;
    }
    if (!labels.includes("宿屋") && Math.random() < 0.6) return ok[Math.floor(Math.random() * ok.length)];
  }
  const idx = (re) => labels.findIndex((l, i) => (re instanceof RegExp ? re.test(l) : l === re) && !c.items[i].disabled);
  const last = labels.length - 1;
  const save = fq.save;
  const hpLow = save.hp < (44 + 13 * save.lv) * 0.5;

  // 勇者の すがた：数回 変えて、これで けってい
  if (title === "すがたを えらぼう") { lookTurns++; return lookTurns <= 6 ? (lookTurns * 2) % 5 : last; }

  // 起動の入口：--title のときだけ、最初に『冒険の地を えらびなおす』を選ぶ
  if (title === "ファイル・クエスト" && labels[0] === "つづきから") { if (args.title && !titleDone) { titleDone = true; return 1; } return 0; }

  // 戦闘のコマンド
  if (labels.includes("たたかう")) {
    if (fq.bs) { stat.maxEnemies = Math.max(stat.maxEnemies, fq.bs.enemies.length); stat.maxAllies = Math.max(stat.maxAllies, fq.bs.allies.length); if (fq.bs.enemies.length >= 2) M.multi++; if (fq.bs.allies.length >= 2) M.partyBattle++; if (fq.bs.enemies.some((e) => e.boss)) M.bossSeen = true; }
    if (args.rich && fq.bs && fq.bs.allies.length > 1 && Math.random() < 0.06) { const a = fq.bs.allies[fq.bs.allies.length - 1]; if (a.kind === "friend" && a.hp > 0) a.hp = 0; }
    const hero = fq.bs && (fq.bs.allies.find((a) => a.name === title) || fq.bs.allies[0]);           // 今 操作している人（仲間を自分で選ぶときは、仲間）
    if (hpLow && save.inv.item.herb > 0) return idx("どうぐ");
    if (hero && Math.random() < 0.4 && hero.skills.some((id) => hero.mp >= 3 + (id === "fury" ? 9 : 0))) return idx("とくぎ");
    if (hero && Math.random() < 0.1 && (save.inv.item.bomb || 0) > 0) return idx("どうぐ");
    return 0;
  }
  if (title === "とくぎ") return labels.findIndex((l, k) => !c.items[k].disabled);          // 選べるものが無ければ -1（Esc で戻る）
  if (title === "どうぐ" && labels.some((l) => /やくそう|ばくだん/.test(l))) { const i = idx(/ばくだん/) >= 0 && Math.random() < 0.5 ? idx(/ばくだん/) : idx(/やくそう/); return i >= 0 ? i : 0; }
  if (title === "どれを ねらう？" || title === "だれに？") return title === "だれに？" ? (Math.random() < 0.5 ? 0 : labels.length - 1) : Math.floor(Math.random() * labels.length);

  if (title.startsWith("この町に 訪れた人物")) {
    const nv = labels.length - 3;                                             // 分身の人数。そのあとに「カードを 取りこむ」「フレンド」「もどる」
    if (save.cards.length < 3 && importTries < 8) { importTries++; return nv; }   // 友だちのカードを、3枚まで取りこむ
    const i = labels.findIndex((l, k) => k < nv && !/フレンド$/.test(c.items[k].hint || ""));
    if (i >= 0 && save.friends.length < 3 && Math.random() < 0.85) return i;
    if (save.friends.length && save.party.length < 2) return labels.indexOf("フレンド");
    return last;
  }
  if (labels.includes("フレンド申請")) {
    const n = (visitorSteps.get(title) || 0); visitorSteps.set(title, n + 1);
    return n === 0 ? 0 : n === 1 ? 1 : last;
  }
  if (title.startsWith("フレンド")) { const i = labels.findIndex((l, k) => k < last && !/同行中/.test(c.items[k].hint || "")); return i >= 0 && save.party.length < 3 ? i : last; }
  if (labels.includes("同行を おねがい")) { M.friend++; return 0; }
  if (labels.includes("ここで 別れる")) return last;

  // 鍛冶屋・道具屋
  if (labels.includes("アクセサリを 作る")) {
    if (!M.crafted && Object.keys(save.inv.mat).length && craftTries <= 4) return idx("作る");        // お金が足りずに作れないときは、人間と同じく あきらめて出る
    if (!M.crafted && save.gold >= 100 && Math.random() < 0.3) return idx("買う");
    return last;
  }
  if (title === "なにを 作る？") { craftTries++; return M.crafted || craftTries > 4 ? last : 0; }
  if (title.includes("を 作る") || title.startsWith("アクセサリを 作る")) { const i = labels.findIndex((l, k) => k < last && !c.items[k].disabled); if (i >= 0) { M.crafted = true; return i; } return last; }
  if (title.startsWith("しょじきん") && labels.some((l) => /^(ひのき|どう|てつ|はがね|ぎん|ミスリル|ほのお|でんせつ|.*つるぎ|.*ぼう|.*よろい|.*ふく|.*かたびら)/.test(l))) { const i = labels.findIndex((l, k) => k < last && !c.items[k].disabled); return i >= 0 && Math.random() < 0.5 ? i : last; }
  if (labels.includes("売る") && labels.includes("買う")) {
    if (!M.sold && Object.keys(save.inv.mat).length >= 3) return idx("売る");
    if (!M.bought) return idx("買う");
    return last;
  }
  if (title.startsWith("素材を 売る")) { M.sold = true; return labels.length > 1 ? 0 : last; }
  if (labels.some((l) => /ひとつ 売る/.test(l))) return 1;
  if (title.startsWith("しょじきん") && title.includes("特価")) { if (!M.bought && save.gold >= 10) { M.bought = true; return 0; } return last; }
  if (title === "装備を 売る") return last;

  // 依頼所
  if (labels.includes("依頼を うける")) { if (!M.quest && save.offers.length) return 0; return last; }
  if (title === "依頼") { M.quest = true; return 0; }

  // 回収所・回収待ち
  if (labels.includes("回収車を よぶ")) { depotVisits++; if (depotVisits === 1) return idx("たまっている ものを みる"); if (fq.pending.length) { M.depot = true; return 0; } return last; }
  if (title.startsWith("回収待ち ")) return Math.random() < 0.5 ? 0 : last;
  if (labels.includes("たすける")) { if (rescues < 2 && Math.random() < 0.4) { rescues++; return idx("たすける"); } return Math.random() < 0.5 ? idx("くわしく みる") : last; }

  // 宿屋
  if (labels.includes("冒険日誌を かく")) { if (!M.journal && !c.items[1].disabled) { M.journal = true; return 1; } return hpLow || Math.random() < 0.3 ? 0 : last; }

  // 地図のメニュー
  if (labels.includes("冒険者カード") && labels.includes("持ち物")) {
    if (!fieldDone) { fieldDone = true; return idx("冒険者カード"); }
    if (!M.invChecked) { M.invChecked = true; return idx("持ち物"); }
    if (!M.statusChecked) { M.statusChecked = true; return idx("つよさ"); }
    if (!M.storyChecked) { M.storyChecked = true; return idx("物語"); }
    if (!M.filesChecked) { M.filesChecked = true; return idx("ファイル"); }
    return last;
  }
  if (title === "物語") { storyTurn++; return storyTurn === 1 ? idx(/いまの/) : storyTurn === 2 ? idx(/かけら/) : storyTurn === 3 ? idx("殿堂") : last; }
  if (title === "ぬしを どうする？") { M.endingChoice = (M.endingChoice || 0) + 1; return args.keep ? 1 : 0; }
  if (title === "つぎは？") return args.next ? 0 : 1;
  if (title === "冒険者カード") {
    if (!M.cardImport) { M.cardImport = true; return idx(/取りこむ/); }
    if (!M.look) { M.look = true; return idx(/すがたを かえる/); }
    if (!M.cardMade) { M.cardMade = true; return 0; }
    if (!M.rename) { M.rename = true; return idx(/名前を かえる/); }
    return last;
  }
  if (title === "どの役割で 出す？") return 1;
  if (title === "持ち物") { if (!M.invUse) { M.invUse = true; return idx("どうぐを つかう"); } if (!M.inv1) { M.inv1 = true; return idx("そうび"); } if (!M.inv2) { M.inv2 = true; return idx("素材を みる"); } return last; }
  if (title === "そうび") { if (!M.equipTry) { M.equipTry = true; return 0; } return last; }
  if (title === "武器" || title === "防具" || title === "アクセサリ") return 0;
  if (title === "ファイル") { if (!M.guardedChecked) { M.guardedChecked = true; return idx(/守られた/); } return last; }
  if (title.startsWith("守られたファイル")) return Math.random() < 0.5 ? 0 : last;

  if (labels.includes("はいる")) return 0;                                  // 遺跡

  // そのほか：たまに先頭、たいていは 最後（やめる・もどる）
  return Math.random() < 0.25 && !c.items[0].disabled ? 0 : last;
}

// ---- リセットの試験（--reset）：コマンドを呼んで、中身が入れかわること・調べた結果が残ること・保存が戻されないことを確かめる ----
const RESETS = [{ at: 20000, id: "debugProgress" }, { at: 40000, id: "debugRescan" }, { at: 60000, id: "reset" }];
const RS = { n: 0, busy: false, checks: [], verifyAt: 0 };
const G = { seen: false, appraisalsBefore: -1 };       // --gate：断られた文を見たか／そのとき AI の鑑定は何回呼ばれていたか
const storedSave = () => JSON.parse(store.get("save"));
function tryReset(i) {
  if (!args.reset || RS.busy || RS.n >= RESETS.length || i < RESETS[RS.n].at) return;
  if (fq.ui.choice || (fq.ui.msg && !fq.ui.msg.done) || fq.bs) return;
  const r = RESETS[RS.n], sv = fq.save;
  const before = { pool: fq.pool.list.length, pending: fq.pending.length, roots: sv.roots.length, friends: sv.friends.length, cards: sv.cards.length, seed: sv.seed, name: sv.heroName, lv: sv.lv, looks: lookTurns };
  const toasts = log.toasts.length;
  if (r.id !== "debugProgress") seedFiles();                                // 調べなおす前に、新しい古いファイルが増えた（前半で回収し尽くしているので）
  if (r.id === "reset") chosenRoot = 0;                                   // 冒険の地の選び直し（偽の選択窓は 1回目だけ フォルダを返す）
  RS.busy = true;
  cmdHandler(r.id).then(() => {
    RS.busy = false;
    if (log.toasts.slice(toasts).some((m) => m.includes("いまは 使えません"))) return;    // 会話や戦闘の最中だった：あとで もう一度
    const f = fq.save, ok = (name, v) => RS.checks.push([r.id + "：" + name, !!v]);
    ok("レベルと記録が最初に戻る", f.lv === 1 && f.exp === 0 && f.kills === 0 && f.gold === 30 && f.steps === 0 && f.cleared.length === 0);
    ok("保存も戻る", storedSave().lv === 1 && storedSave().kills === 0);
    ok("同行は外れる", f.party.length === 0);
    ok("世界の種は同じ", f.seed === before.seed);
    if (r.id === "debugProgress") {
      ok("調べた結果が残る", fq.pool.list.length === before.pool);
      ok("回収待ちが残る", fq.pending.length === before.pending);
      ok("冒険の地・カード・フレンド・名前が残る", f.roots.length === before.roots && f.cards.length === before.cards && f.friends.length === before.friends && f.heroName === before.name);
      ok("フレンドの絆が戻る", f.friends.every((x) => x.bond === 0));
    } else if (r.id === "debugRescan") {
      ok("回収待ちが空になる", fq.pending.length === 0);
      ok("敵を調べなおした", fq.pool.at > 0);
      ok("冒険の地・カード・フレンド・名前が残る", f.roots.length === before.roots && f.cards.length === before.cards && f.friends.length === before.friends && f.heroName === before.name);
    } else {
      ok("カード・フレンドも消えて、名前と すがたを もう一度 えらぶ", f.friends.length === 0 && f.cards.length === 0 && lookTurns > before.looks);
      ok("冒険の地を選びなおして、敵を集めた", f.roots.length === 1 && fq.pool.at > 0 && fq.pending.length === 0);
    }
    RS.n++;
    RS.verifyAt = i + 1500;                                              // しばらく遊んでも、保存が元の進行度に戻されていないこと
    RS.lastId = r.id;
  });
}
function tryAiCheck(i) {
  if (!args.reset || RS.busy || RS.aiDone || RS.n < RESETS.length || RS.verifyAt) return;
  if (fq.ui.choice || (fq.ui.msg && !fq.ui.msg.done) || fq.bs) return;
  const toasts = log.toasts.length, pings = log.net.filter((x) => x.kind === "ping").length;
  RS.busy = true;
  cmdHandler("aiCheck").then(() => {
    RS.busy = false;
    if (log.toasts.slice(toasts).some((m) => m.includes("いまは 使えません"))) return;
    RS.aiDone = true;
    const sent = log.net.filter((x) => x.kind === "ping").length - pings;
    RS.checks.push(["aiCheck：" + (AI_ON && !args.aichaos ? "確認の通信を1回した" : "落ちない"), AI_ON && !args.aichaos ? sent === 1 : sent <= 1]);
  });
}
function verifyReset(i) {
  if (!RS.verifyAt || i < RS.verifyAt) return;
  RS.verifyAt = 0;
  RS.checks.push([RS.lastId + "：しばらく遊んでも 保存が元に戻らない", storedSave().lv <= 4 && storedSave().lv <= fq.save.lv]);
}

let lastLog = 0;
for (let i = 0; i < MAX_FRAMES; i++) {
  frameNow = i;
  tryReset(i);
  verifyReset(i);
  tryAiCheck(i);
  if (!D.checked && fq.pool.at && fq.pool.list.length) {                // 最初に調べ終わった直後（たまたま倒される前）に確かめる
    D.checked = true;
    const e = fq.pool.list.find((x) => x.name === "dosdate_old.zip");
    D.since = e && e.since ? realNow() - e.since : -1;                  // 敵になっていれば、放置の起点は『来た日時』（約900日前）
    D.modified = e ? e.modified : -1;
    D.inPool = !!e;
  }
  const f = raf; raf = null;
  if (f) f(1000 + i * 16);
  stat.frames++;
  if (i % 8 === 0) await new Promise((r) => setTimeout(r, 1));
  if (args.debug && i % 3000 === 0) console.log(`[${i}] 倒した ${fq.save.kills} Lv${fq.save.lv} HP ${fq.save.hp} 戦闘 ${!!fq.bs} ${fq.dg ? `DG${fq.dg.floor}/${fq.dg.floors}(${fq.hero.tx},${fq.hero.ty})` : `地図(${fq.hero.tx},${fq.hero.ty})`} 選択「${fq.ui.choice ? fq.ui.choice.title + "：" + fq.ui.choice.items.map((x) => x.label).join("/").slice(0, 60) : ""}」 文「${fq.ui.msg ? fq.ui.msg.text.slice(0, 24).replace(/\n/g, " ") : ""}」`);
  if (args.god && fq.bs) fq.save.hp = 44 + 13 * fq.save.lv;
  if (defeatSeen && !fq.dg && !fq.bs) { M.dgDefeatOut = fq.save.loc == null && fq.scene === "map"; defeatSeen = false; }          // ダンジョンの中で負けたあと、外に出て、いる場所の記録も消えている
  if (fq.dodge) {                                                       // 弾よけ：ふだんは とばす。ときどき（--dodge・--explore・--campaign は、いつも）ほんとうに よける
    const d = fq.dodge;
    if (d !== dodgeSeen) { dodgeSeen = d; dodgeSim = d.sim; dodgePlay = !!(args.dodge || args.explore || args.campaign || Math.random() < 0.3); M.dodgeSeen = (M.dodgeSeen || 0) + 1; if (dodgePlay) M.dodgePlayed = (M.dodgePlayed || 0) + 1; }
    if (!dodgePlay) { fire("keydown", { key: "Escape" }); fire("keyup", { key: "Escape" }); continue; }
    const dir = staged.bullets.autoDodge(d.sim), want = new Set([dir.x > 0 ? "arrowright" : dir.x < 0 ? "arrowleft" : null, dir.y > 0 ? "arrowdown" : dir.y < 0 ? "arrowup" : null].filter(Boolean));
    for (const k of dodgeKeys) if (!want.has(k)) { fire("keyup", { key: k }); dodgeKeys.delete(k); }
    for (const k of want) if (!dodgeKeys.has(k)) { fire("keydown", { key: k }); dodgeKeys.add(k); }
    continue;
  }
  if (dodgeSeen) {                                                      // 弾よけが 終わった：キーを はなして、結果を数える
    for (const k of dodgeKeys) fire("keyup", { key: k });
    dodgeKeys.clear();
    if (dodgePlay && dodgeSim) { M.dodgeHits = (M.dodgeHits || 0) + dodgeSim.hits; if (!dodgeSim.hits) M.dodgeClean = (M.dodgeClean || 0) + 1; if (dodgeSim.hits > 4) M.dodgeBad = (M.dodgeBad || 0) + 1; }
    dodgeSeen = null; dodgeSim = null;
  }
  const ui = fq.ui;
  if (ui.choice) {
    // 同じ選択の画面が続くとき（MPが足りなくて選べない・素材が足りなくて作れない）は、人間と同じく Esc で戻る
    const sig = ui.choice.title + "|" + ui.choice.items.map((x) => x.label + (x.disabled ? "×" : "")).join("/");
    sameCount = sig === lastSig ? sameCount + 1 : 0;
    lastSig = sig;
    const pick = pickChoice(ui.choice);
    if (sameCount > 6 || pick < 0 || ui.choice.items[pick].disabled) { sameCount = 0; fire("keydown", { key: "Escape" }); continue; }
    ui.choice.idx = pick;
    fire("keydown", { key: "Enter" });
    continue;
  }
  if (ui.msg && !ui.msg.done) {
    if (!G.seen && String(ui.msg.text).includes("大きすぎる")) { G.seen = true; G.over = String(ui.msg.text).includes("個以上"); G.appraisalsBefore = log.net.filter((n) => n.kind === "appraise").length; }       // 画面の文は、空白が除かれている
    const mt = String(ui.msg.text).replace(/\s+/g, "");                       // 空白をのぞいて 見る
    if (mt.includes("たからばこをあけた")) M.chest = (M.chest || 0) + (ui.msg.text !== lastDgMsg ? 1 : 0);
    if (mt.includes("みずをのんだ")) M.spring = true;
    if (fq.dg && mt.includes("たおれてしまった")) { M.dgDefeat = true; defeatSeen = true; }
    if (mt.includes("ぬしをたおした")) M.dgBoss = true;
    const fresh = ui.msg !== lastMsgObj;
    lastMsgObj = ui.msg;
    if (fresh && mt.includes("記憶のかけらを手にいれた")) M.fragment = (M.fragment || 0) + 1;
    if (fresh && mt.includes("ボスをぜんぶたおした")) M.chapterDone = (M.chapterDone || 0) + 1;
    if (fresh && mt.includes("封印がとけた")) M.unsealed = (M.unsealed || 0) + 1;
    if (fresh && mt.includes("仲間になった")) M.joinedMsg = (M.joinedMsg || 0) + 1;
    if (mt.includes("称号『")) M.partDone = true;
    if (fresh && mt.includes("すうっときえていった")) M.phantom = (M.phantom || 0) + 1;
    if (fresh && (mt.includes("は封印されている") || mt.includes("道はまだふさがれている"))) M.sealed = (M.sealed || 0) + 1;
    if (fresh && /^第\d章/.test(mt)) M.chapterTold = (M.chapterTold || 0) + 1;
    lastDgMsg = ui.msg.text;
    fire("keydown", { key: "Enter" });
    continue;
  }
  if (args.dungeon && args.lv && !D.boosted && fq.pool.at && fq.pool.list.length) {          // ダンジョンの奥のボスまで通すため、はじめから レベルを上げておく（--lv=12 など）
    D.boosted = true;
    fq.save.lv = Number(args.lv);
    fq.save.hp = 44 + 13 * fq.save.lv;
  }
  if (args.rich && i % 6000 === 3000) {                      // お金・素材・道具・絆を 補う（技や装備や町の店を、たくさん通すため）
    const sv = fq.save;
    sv.gold = Math.max(sv.gold, 6000);
    for (const cat of ["image", "video", "audio", "archive", "doc", "code", "exe", "other"]) for (const r of [0, 1, 2]) sv.inv.mat[`${cat}_${r}`] = Math.max(sv.inv.mat[`${cat}_${r}`] || 0, 14);
    for (const k of ["herb", "herb2", "ether", "smoke", "bomb"]) sv.inv.item[k] = Math.max(sv.inv.item[k] || 0, 6);
    for (const f of sv.friends) f.bond = 30;
    // テスト用の仲間：全役割を そろえ、毎回 3人を ランダムに 同行させる（起こす・ぬすむ・かたいまもり・全体魔法 などを通すため）
    const roles = ["front", "healer", "appraiser", "thief"];
    sv.friends = sv.friends.filter((f) => !f.id.startsWith("t_"));
    const mine = roles.map((role) => ({ id: "t_" + role, kind: "npc", name: "テスト" + role, role, lv0: 5, persona: "テスト", quip: "テスト", seed: 1, bond: 30, since: 0, hp: null, mp: null }));
    sv.friends.push(...mine);
    sv.party = [...mine].sort(() => Math.random() - 0.5).slice(0, 3).map((f) => f.id);
  }
  if (fq.hero.moving && !fq.busy && fq.ui.msg && !fq.ui.choice) M.msgLeft = (M.msgLeft || 0) + 1;          // 歩きだしても 文章の窓が 残っている
  // 地図：歩く
  if (!fq.hero.moving) {
    if (!fieldDone && fq.save.roots.length && fq.pool.at) { fire("keydown", { key: "Escape" }); continue; }
    const pos = fq.hero.tx + "," + fq.hero.ty;
    stuck = fq.busy || fq.bs ? 0 : pos === lastPos ? stuck + 1 : 0;                  // 戦闘や会話の最中は、立ち止まっているだけ（壁にぶつかっているのではない）
    lastPos = pos;
    const save = fq.save;
    const needTown = fq.pending.length >= 4 || save.hp < (44 + 13 * save.lv) * 0.45 || (tavernVisits < 14 && (save.friends.length < 2 || save.party.length < 2 || !M.friend) && i > 3000) || (!M.crafted && forgeVisits < 3 && Object.keys(save.inv.mat).length > 5 && save.gold >= 200);
    let want = null;
    const heading = (t) => { const d = worldDirTo(t); if (d) return "arrow" + d; const dx = t.x - fq.hero.tx, dy = t.y - fq.hero.ty; return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "arrowright" : "arrowleft") : (dy > 0 ? "arrowdown" : "arrowup"); };
    const nearest = (list) => list.slice().sort((a, b) => Math.hypot(a.x - fq.hero.tx, a.y - fq.hero.ty) - Math.hypot(b.x - fq.hero.tx, b.y - fq.hero.ty))[0];
    if (!fq.tn) townGoal = null;                                    // 町を出たら、行き先は忘れる（つぎに入ったとき、そのときに必要な店を選びなおす）
    if (fq.tn) {                                                    // 町の中：いま必要な店のドアへ、人をよけて歩く。人には、となりから話しかける
      const d = townDirection();
      M.town = true;
      if (d === "enter") { fire("keydown", { key: "Enter" }); fire("keyup", { key: "Enter" }); want = null; }
      else want = d ? "arrow" + d : null;
    } else if (fq.dg) {                                                    // ダンジョンの中：宝箱 → （体力が減ったら 泉）→ 下り階段（最後の階は ボス）へ、歩いて着ける道をたどる
      const d = dgDirection();
      want = d ? "arrow" + d : null;
      M.dungeon = true;
      M.dgFloors = Math.max(M.dgFloors || 0, fq.dg.floor);
    } else if ((args.dungeon ? save.hp < (44 + 13 * save.lv) * 0.45 : needTown) && stuck <= 2) want = heading(nearest(unlockedTowns()));
    else if (fq.part && !fq.part.prog.done && !fq.part.prog.told[fq.part.prog.chapter] && stuck <= 2) want = heading(fq.world.towns[fq.part.prog.chapter - 1]);          // 章のはじめは、その章の町へ
    else if (args.dungeon ? (fq.part ? !fq.part.prog.done : !M.dgBoss) && stuck <= 2 : !M.bossSeen && (fq.part ? i > 6000 : save.kills >= 20 && save.lv >= 5) && stuck <= 2) {          // 地図が準備できたら、遺跡のボスにも 挑む
      const ruins = fq.part ? (fq.part.prog.done ? [] : [{ r: fq.world.ruins[fq.part.prog.chapter - 1], k: fq.part.prog.chapter - 1 }]) : fq.world.ruins.map((r, k) => ({ r, k })).filter(({ k }) => !save.cleared.includes(k));
      if (ruins.length) {
        if (!ruinTarget || ruinTarget.world !== fq.world || save.cleared.includes(ruinTarget.k) || (fq.part && ruinTarget.k !== ruins[0].k)) { ruinTarget = nearestByPath(ruins); if (ruinTarget) ruinTarget.world = fq.world; }          // 島が 作りなおされたら（最初の調べものが終わったあと）、目当てを選びなおす          // 歩く道のりが 短い遺跡を選び、着くまで変えない
        want = ruinTarget ? heading(ruinTarget.r) : null;
      }
    }
    if (!dir || stuck > 2 || want !== null || Math.random() < 0.08) {
      const nd = want || dirs[Math.floor(Math.random() * 4)];
      if (nd !== dir) { if (dir) fire("keyup", { key: dir }); dir = nd; fire("keydown", { key: dir }); }
      else fire("keydown", { key: dir });                  // 戦闘や階の移動のあとは、ゲーム側の押しているキーが空になる。同じキーを押しなおす（押しっぱなしでも、害はない）
    }
  }
  if (fq.save.kills >= 70 && M.depot && M.crafted && M.friend && M.partyBattle && M.multi && M.cardImport && (M.bossSeen || args.noboss) && i > 20000 && (!args.campaign || (fq.part && fq.part.prog.done && i > 3000 + (campaignDoneAt ||= i))) && (!args.reset || (RS.n >= RESETS.length && RS.aiDone && !RS.busy && !RS.verifyAt))) break;
}

// ---- 結果 ----
const save = fq.save;
const nets = log.net, byKind = (k) => nets.filter((n) => n.kind === k).length;
const gone = new Set(log.trash.flat());
// 守るべきファイル：システムの部品・Windows配下・最近のもの・手元の判定で大事そうなもの。AI だけが大事と見るファイルは、AI が使えて 正しく返事したときだけ
const aiWorking = AI_ON && !args.aichaos;
const keep = [...protectedAll, ...(aiWorking ? aiGuardedAll : [])];
const poolNames = new Set(fq.pool.list.map((e) => e.name));
console.log("---- 結果 ----");
console.log(`フレーム ${stat.frames}　Lv ${save.lv}　倒した ${save.kills}体　ゴールド ${save.gold}　回収 ${log.trash.length}回（${gone.size}個）　エラー ${log.errors.length}`);
console.log(`敵の数の最大 ${stat.maxEnemies}　味方の数の最大 ${stat.maxAllies}　複数の敵との戦い ${M.multi}　仲間つきの戦い ${M.partyBattle}　ボス戦 ${M.bossSeen}`);
console.log(`フレンド ${save.friends.length}人（同行 ${save.party.length}人）　カード ${save.cards.length}枚　名前 ${save.heroName}　装備 ${save.inv.gear.length}個　素材 ${Object.keys(save.inv.mat).length}種`);
console.log(`装備：${save.inv.gear.map((g) => `${g.slot}:t${g.tier}${g.affinity ? "/" + g.affinity : ""}`).join(" ")}　装備中：${JSON.stringify(save.equip)}　素材：${JSON.stringify(save.inv.mat)}`);
console.log(`鑑定で守られた ${fq.guarded.length}件　鑑定の呼び出し ${byKind("appraise")}回　二つ名 ${byKind("lore")}回　依頼 ${byKind("quests")}回　日誌 ${byKind("journal")}回`);
console.log(`通信の宛先がすべて anthropic：${nets.every((n) => n.url === "https://api.anthropic.com/v1/messages")}　secret を指す：${nets.every((n) => n.secret === "apiKey")}　鍵が本文に入っていない：${!nets.some((n) => n.keyInBody)}`);
console.log(`守るべきファイルが回収されていない：${keep.every((e) => !gone.has(e.id))}　プールに入っていない：${![...guardedNames, ...(aiWorking ? ["memo_secret.txt"] : []), "x.dll", "a.txt", "new.txt", "dosdate_new.zip", "dosdate_unknown.zip"].some((n) => poolNames.has(n))}`);
console.log(`ごみ箱に送った ファイルの数：${gone.size}（そのうち 守るべきもの：${keep.filter((e) => gone.has(e.id)).length}）`);
const pixelMod = await import(st.url("pixel.js"));
const rootsMod = await import(st.url("roots.js")), heroMod = await import(st.url("hero.js"));
const myCard = cardCode ? staged.card.decodeCard(cardCode) : null;
const wantIsland = rootsMod.islandSeedFor(save.roots);
console.log(`見た目：勇者 ${JSON.stringify(save.look)}　出したカード ${myCard && myCard.ok ? JSON.stringify(myCard.card.look) : "なし"}　友だち ${save.cards.map((c) => c.name + JSON.stringify(c.look)).join(" ")}　島の種 ${fq.part ? (save.islandSeed === pixelMod.hashStr(fq.part.def.id) ? "部から決まっている" : "ずれている") : save.islandSeed === wantIsland ? "冒険の地から決まっている" : "ずれている"}`);
{
  const PT = fq.part;
  console.log(`部：${PT ? `『${PT.story.title}』 作り方 ${PT.story.by}　章 ${PT.prog.chapter}/${PT.def.chapters.length}　かけら ${PT.prog.frags.length}/${PT.def.chapters.reduce((s, c) => s + c.bosses.length, 0) - 1}　終えた ${PT.prog.done}　結末 ${PT.prog.ending || "なし"}` : "なし"}　殿堂 ${fq.save.series.done.length}部　仲間 ${fq.save.friends.filter((f) => f.kind === "story").length}人`);
  console.log(`弾よけ：出た ${M.dodgeSeen || 0}回　ほんとうによけた ${M.dodgePlayed || 0}回　当たった数の平均 ${M.dodgePlayed ? ((M.dodgeHits || 0) / M.dodgePlayed).toFixed(2) : "—"}　1発も当たらなかった ${M.dodgeClean || 0}回`);
console.log(`文章の窓が歩きだしても残った回数：${M.msgLeft || 0}`);
  console.log(`部のできごと：章の物語 ${M.chapterTold || 0}回　かけら ${M.fragment || 0}個　章を終えた ${M.chapterDone || 0}回　封印が解けた ${M.unsealed || 0}回　封印に阻まれた ${M.sealed || 0}回　まぼろしを倒した ${M.phantom || 0}体　物語の窓 ${!!M.storyChecked}`);
}
console.log(`町：歩いた ${!!M.town}　入った店 ${[...townDoorsSeen].join("・")}　人に話しかけた ${M.talk || 0}回`);
console.log(`ダンジョン：入った ${!!M.dungeon}　いちばん深い階 ${M.dgFloors || 0}　宝箱を開けた ${M.chest || 0}回　泉 ${!!M.spring}　ぬしを倒した ${!!M.dgBoss}　ダンジョンで負けた ${!!M.dgDefeat}　負けたあと外に出た ${!!M.dgDefeatOut}`);
console.log("達成：", JSON.stringify(M));
const oldYears = [...idleTexts].map((s) => Number((s.match(/(\d+)年/) || [])[1] || 0)).filter((y) => y >= 10);
console.log(`日付なしのファイル：敵になった ${!!D.inPool}　放置の起点は ${D.since >= 0 ? Math.round(D.since / DAY) + "日前" : "なし"}　画面の放置表示 ${idleTexts.size}種類　10年以上の表示 ${oldYears.length}件`);
const c0 = log.candLists[0];
console.log(`おすすめの表示：${log.candLists.length}回　先頭「${c0 ? c0[0].label + "　" + c0[0].hint : "なし"}」`);
const askNets = nets.filter((n) => n.kind !== "chaos");
console.log(`AIの頼み方：考える深さ low ${askNets.every((n) => n.effort === "low")}　上限 1000トークン以上 ${askNets.every((n) => n.maxTokens >= 1000)}（${askNets.length}回）`);
if (args.gate) console.log(`大きさの検査：断られた ${G.seen}　途中でやめた ${!!G.over}　断られたときの AI の鑑定 ${G.appraisalsBefore}回　最後の冒険の地 ${save.roots.map((r) => r.path.slice(r.path.lastIndexOf(BS) + 1)).join(" ")}`);
if (args.title) console.log(`冒険の地：${save.roots.length}か所　${save.roots.map((r) => r.path.slice(r.path.lastIndexOf(BS) + 1) + "(" + (r.id ? "ID" : "IDなし") + ")").join(" ")}`);
if (args.reset) console.log(`リセットの試験：${RS.n}/${RESETS.length}回　${RS.checks.map(([n, v]) => (v ? "○" : "×") + n).join("　")}`);
if (log.errors.length) console.log("エラー内容：\n" + log.errors.slice(0, 5).join("\n"));
const must = [log.errors.length === 0, keep.every((e) => !gone.has(e.id)), !![...fs.values()].length, nets.every((n) => n.secret === "apiKey"), save.kills > 0, !args.reset || (RS.n === RESETS.length && RS.aiDone && RS.checks.length > 0 && RS.checks.every(([, v]) => v)),
  askNets.every((n) => n.effort === "low" && n.maxTokens >= 1000),
  oldYears.length === 0,
  !M.badLook,                                                            // 戦闘の味方に、見た目がある
  heroMod.cleanLook(save.look).join() === save.look.join(),               // 勇者の見た目は、正しい番号
  args.reset || args.explore || !cardCode || (myCard && myCard.ok && myCard.card.look.join() === save.look.join()),       // --explore は、カードを出したあとにも すがたを変えることがある        // 出したカードに、選んだ見た目が載っている
  save.cards.every((c) => friendLooks[c.name] && c.look.join() === friendLooks[c.name].join()),   // 友だちの見た目は、カードのとおり
  fq.part ? save.islandSeed === pixelMod.hashStr(fq.part.def.id) : save.islandSeed === wantIsland,                                        // 島は、選んだ冒険の地から決まる                                                 // 46年放置、のような表示が出ない
  args.gate || args.title || (D.inPool && D.modified === Date.UTC(1980, 0, 1) && D.since > 800 * DAY && D.since < 1000 * DAY),     // 日付なしでも、来て久しければ敵。起点は作成日時
  !args.title || (save.roots.length === 3 && save.roots.every((r) => r.id)),
  log.candLists.length > 0 && /約\d+体.*\d+章　ボス\d+体　およそ.*AIの鑑定 \d+回/.test(log.candLists[0][0].hint) && log.candLists.every((l) => l.some((i) => String(i.id) === "manual")),
  args.nododge || (M.dodgeSeen >= 1 && (!(args.dodge || args.explore || args.campaign) || M.dodgePlayed >= 1)),          // 勇者がこうげきされたら、弾よけが 出る（オフにしたときは 出ない）
  !M.dodgePlayed || ((M.dodgeHits || 0) / M.dodgePlayed <= 1.6 && !M.dodgeBad),          // ほんとうによけたとき、ほとんど かわせる（よけられない弾の出かたに なっていない）
  !args.nododge || !M.dodgeSeen,
  !M.msgLeft,                                                            // 歩きだしたら、下の文章の窓は 消える
  fq.save.friends.every((f) => f.kind !== "story"),                      // 勝手に仲間になる人は いない
  !!(fq.part && fq.part.story && fq.part.story.chapters.length === fq.part.def.chapters.length && fq.part.story.title && fq.part.story.title.length <= 24),          // どのモードでも、冒険の地を調べたら 部と物語ができる
  !(AI_ON && !args.aichaos && !args.gate) || (fq.part && fq.part.story.by === "ai" && log.net.some((n) => n.kind === "story")),                // AI が使えれば、物語を 1回 頼む（部ごとに1回）
  AI_ON || (fq.part && fq.part.story.by === "template"),
  !args.campaign || (fq.part && fq.part.prog.done && fq.save.series.done.length === 1 && M.partDone && M.chapterDone >= fq.part.def.chapters.length - 1 && M.fragment >= 1 && M.unsealed >= fq.part.def.chapters.length - 1),          // 部を 最後まで：章がすべて終わり、結末が選ばれ、殿堂に入る
  args.dungeon || args.gate || (M.town && townDoorsSeen.size >= 4 && (M.talk || 0) >= 1),          // 歩ける町：歩いて、店のドアに立って 店を開き、人に話しかける
  !args.dungeon || (M.dungeon && M.dgFloors >= 2 && M.chest >= 1 && (!args.god || M.dgBoss || M.chapterDone) && (!M.dgDefeat || M.dgDefeatOut)),          // ダンジョン：入る・階を下りる・宝箱を開ける・（無敵なら）ぬしを倒す・負けたら外に出る
  !args.gate || (log.candLists.every((l) => !l.some((i) => String(i.label).endsWith("Data"))) && G.seen && G.appraisalsBefore === 0 && G.over === (args.gate === "abort") && save.roots.length === 1 && save.roots[0].path.endsWith("Photos"))];
if (!must.every(Boolean)) console.log("失敗した検査の番号：", must.map((v, i) => (v ? null : i)).filter((i) => i !== null).join());
process.exit(must.every(Boolean) ? 0 : 1);
