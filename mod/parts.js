// ファイル・クエスト — 部（1つの冒険の地が、1つの部になる）を、古いファイルの一覧から機械的につくる（画面を持たない）
// 群れ（置いてあるフォルダごと）→ 章（3〜7）→ ボス（1章に最大3体）・ぬし（最終ボス）・ダンジョンの型と階数・町と遺跡の名前。
// 同じ入力なら、いつも同じ部ができる。つくった部は、保存して凍結する（フォルダの中身が変わっても、筋は変わらない）。
// 部になる条件の検査（30体以上・200MB以上・600体まで）は、volume.js。ここは、検査に通った一覧が来る前提
import { hashStr, rng } from "./pixel.js";
import { catOf, BOSS_BYTES } from "./data.js";
import { dirOf } from "./encounter.js";

export const CHAPTERS_MIN = 3;
export const CHAPTERS_MAX = 7;
export const BOSS_MAX = 3;                 // 1章のボスの数
export const MINUTES_PER_CHAPTER = 20;     // 1章あそぶ時間の目安

export const CAT_LABEL = { image: "画像", video: "動画", audio: "音楽", archive: "圧縮", doc: "書類", code: "コード", exe: "実行", other: "その他" };
export const STYLE_SUFFIX = { cave: "洞窟", tower: "塔", castle: "城", swamp: "沼" };
const STYLES = ["cave", "tower", "castle", "swamp"];
// ダンジョンの型：画像・動画は洞窟、書類・圧縮は塔、コード・実行は城、音楽は沼。決まらないときは、場所の名前から
const STYLE_BY_CAT = { image: "cave", video: "cave", doc: "tower", archive: "tower", code: "castle", exe: "castle", audio: "swamp" };

export const TOWN_NAME_TABLE = [
  "はじまりの町", "ホコリ港", "わすれられの村", "ささやきの丘", "つむぎ町", "しずく橋", "ひなた市", "たそがれ通り",
  "かぜの里", "ひだまり村", "こだまの宿場", "ゆうやけ港", "あおぞら町", "ほたるの里", "おぼろ町", "ねむりの谷",
];

const lower = (p) => String(p || "").replaceAll("/", "\\").toLowerCase();
const dirKey = (f) => lower(dirOf(f.path));
const fileKey = (f) => lower(f.path) || String(f.id || "");

// 画面に出す名前：記号・かっこ・長すぎる名前を除く。ほとんど記号なら、空にする（呼ぶ側が、種類の名前で補う）
export function cleanName(s, max = 12) {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f<>&"'`\\（）()［］\[\]｛｝{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  const letters = (t.match(/[A-Za-z0-9぀-ヿ㐀-鿿]/g) || []).length;
  return t && letters / t.length >= 0.5 ? t : "";
}
const lastSeg = (dir) => { const p = String(dir || "").replaceAll("/", "\\").replace(/\\+$/, ""); return p.slice(p.lastIndexOf("\\") + 1); };

// ファイルの参照：今の候補（pool）と同じ形。保存する分だけ
export const refOf = (f) => ({ id: f.id || "", path: f.path, name: f.name, ext: f.ext || "", size: f.size || 0, modified: f.modified || 0, ...(f.since ? { since: f.since } : {}) });

// ---- 群れ・章 ---------------------------------------------------------------------------------
// 群れ：{ dir, count, bytes, boss, rules }。rules は、ファイルが どの群れに入るかの決まり（どれか1つに当てはまれば入る）
//   { dir }（その置き場所）に、cats（種類）・min / max（大きさ）・hs：[[割る数, あまり], …]（ファイル名のハッシュが、全部そうなるもの）・hns（どれにもならないもの）を足して、群れを分けられる
export function matchRule(rule, f) {
  if (rule.dir && lower(rule.dir) !== dirKey(f)) return false;
  if (rule.cats && !rule.cats.includes(catOf(f.ext))) return false;
  if (rule.min != null && (f.size || 0) < rule.min) return false;
  if (rule.max != null && (f.size || 0) > rule.max) return false;
  if (rule.hs || rule.hns) {
    const h = hashStr(fileKey(f));
    if (rule.hs && !rule.hs.every(([m, r]) => h % m === r)) return false;
    if (rule.hns && rule.hns.some(([m, r]) => h % m === r)) return false;
  }
  return true;
}
const inGroup = (g, f) => g.rules.some((r) => matchRule(r, f));

const commonPrefix = (a, b) => {
  const x = lower(a).split("\\"), y = lower(b).split("\\");
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
};
const weight = (g) => g.count + g.bytes / (1 << 20) * 0.02;      // 数が主。大きさは、少し

// 置き場所ごとの群れを、章の数（3〜7）に合わせてまとめる。小さい群れは、いちばん近い（置き場所の近い）群れに合わせる。
// groups：{ dir, count, bytes, boss } の一覧。戻り値：まとめたあとの群れ（rules つき）。7を こえたら、大きい順に7つ採り、残りは近いところへ
export function mergeGroups(groups, total) {
  const all = groups.filter((g) => g.count > 0).map((g) => ({ dir: g.dir, count: g.count, bytes: g.bytes || 0, boss: g.boss || 0, rules: [{ dir: g.dir }] }));
  if (!all.length) return [];
  all.sort((a, b) => weight(b) - weight(a) || lower(a.dir).localeCompare(lower(b.dir)));
  const minGroup = Math.max(4, Math.ceil((total ?? all.reduce((s, g) => s + g.count, 0)) * 0.06));
  let keep = all.filter((g) => g.count >= minGroup).slice(0, CHAPTERS_MAX);
  if (!keep.length) keep = [all[0]];
  const rest = all.filter((g) => !keep.includes(g));
  for (const g of rest) {
    let best = keep[0], bp = -1;
    for (const k of keep) { const p = commonPrefix(k.dir, g.dir); if (p > bp) { bp = p; best = k; } }
    best.count += g.count;
    best.bytes += g.bytes;
    best.boss += g.boss;
    best.rules.push(...g.rules);
  }
  return keep;
}

// ファイルを、置き場所ごとの群れにする
function groupsOf(files) {
  const m = new Map();
  for (const f of files) {
    const k = dirKey(f);
    let g = m.get(k);
    if (!g) { g = { dir: dirOf(f.path), count: 0, bytes: 0, boss: 0 }; m.set(k, g); }
    g.count++;
    g.bytes += f.size || 0;
    if ((f.size || 0) >= BOSS_BYTES) g.boss++;
  }
  return [...m.values()];
}

// 群れを2つに分ける（章が3つに足りないとき）。種類で分けて、片方が小さすぎるときは、大きさの真ん中で分ける。大きさが全部同じなら、ファイル名のハッシュで
function splitGroup(g, files) {
  const mine = files.filter((f) => inGroup(g, f));
  const cats = new Map();
  for (const f of mine) cats.set(catOf(f.ext), (cats.get(catOf(f.ext)) || 0) + 1);
  const order = [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sideA = [], sideB = [];
  let na = 0, nb = 0;
  for (const [c, n] of order) { if (na <= nb) { sideA.push(c); na += n; } else { sideB.push(c); nb += n; } }
  const mk = (rules) => {
    const ms = mine.filter((f) => rules.some((r) => matchRule(r, f)));
    return { dir: g.dir, count: ms.length, bytes: ms.reduce((s, f) => s + (f.size || 0), 0), boss: ms.filter((f) => (f.size || 0) >= BOSS_BYTES).length, rules };
  };
  const withCats = (cs) => g.rules.map((r) => ({ ...r, cats: r.cats ? r.cats.filter((c) => cs.includes(c)) : cs })).filter((r) => r.cats.length);
  if (sideA.length && sideB.length && Math.min(na, nb) / mine.length >= 0.25) return [mk(withCats(sideA)), mk(withCats(sideB))];
  const sizes = mine.map((f) => f.size || 0).sort((a, b) => b - a);
  const mid = sizes[Math.floor(sizes.length / 2)];
  const big = mine.filter((f) => (f.size || 0) >= mid).length;
  if (mid > 0 && big > 0 && big < mine.length) return [mk(g.rules.map((r) => ({ ...r, min: Math.max(r.min ?? 0, mid) }))), mk(g.rules.map((r) => ({ ...r, max: Math.min(r.max ?? Infinity, mid - 1) })))];
  for (const m of [2, 3, 5, 7, 11]) {
    const c = mine.filter((f) => hashStr(fileKey(f)) % m === 0).length;
    if (c > 0 && c < mine.length) return [mk(g.rules.map((r) => ({ ...r, hs: [...(r.hs || []), [m, 0]] }))), mk(g.rules.map((r) => ({ ...r, hns: [...(r.hns || []), [m, 0]] })))];
  }
  return [g];                                                              // 分けられない（ファイルが1つ・2つのときだけ）
}
// 保存できる形に（Infinity は付けない）
const cleanRule = (r) => { const o = { dir: r.dir }; if (r.cats) o.cats = r.cats; if (r.min != null && r.min > 0) o.min = r.min; if (r.max != null && Number.isFinite(r.max)) o.max = r.max; if (r.hs) o.hs = r.hs; if (r.hns) o.hns = r.hns; return o; };

// ---- 部をつくる ---------------------------------------------------------------------------------
// files：検査に通った古いファイル（pool.list と同じ形）。roots：冒険の地（パスの配列）。seed：セーブの種。at：つくった時刻
// 戻り値：部のデータ（凍結して保存する）。ファイルが 3つに満たなければ null
export function buildPart({ files, roots = [], seed = 0, at = 0 }) {
  const list = files.filter((f) => f && f.path);
  if (list.length < CHAPTERS_MIN) return null;
  let groups = mergeGroups(groupsOf(list), list.length);
  let guard = 0;
  while (groups.length < CHAPTERS_MIN && guard++ < 6) {
    groups.sort((a, b) => b.count - a.count || lower(a.dir).localeCompare(lower(b.dir)));
    const [g, ...others] = groups;
    if (g.count < 2) break;
    const parts = splitGroup(g, list);
    if (parts.length < 2) { groups = [g, ...others]; break; }
    groups = [...parts, ...others];
  }
  // 群れごとのファイル（どの群れにも入らないものは、最初の群れへ。ふつうは起きない）
  const owned = groups.map(() => []);
  for (const f of list) { const i = groups.findIndex((g) => inGroup(g, f)); owned[i < 0 ? 0 : i].push(f); }
  const nushi = list.slice().sort((a, b) => (b.size || 0) - (a.size || 0) || fileKey(a).localeCompare(fileKey(b)))[0];
  const rows = groups.map((g, i) => {
    const fs = owned[i].slice().sort((a, b) => (b.size || 0) - (a.size || 0) || fileKey(a).localeCompare(fileKey(b)));
    const cats = new Map();
    for (const f of fs) cats.set(catOf(f.ext), (cats.get(catOf(f.ext)) || 0) + 1);
    const dominant = [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "other";
    return { g, fs, dominant, max: fs.length ? fs[0].size || 0 : 0, hasNushi: fs.includes(nushi) };
  }).filter((r) => r.fs.length);
  rows.sort((a, b) => a.max - b.max || Number(a.hasNushi) - Number(b.hasNushi) || b.fs.length - a.fs.length || lower(a.g.dir).localeCompare(lower(b.g.dir)));
  const id = "p" + hashStr(`${roots.map(lower).join("|")}|${seed}`).toString(36);
  const rnd = rng(hashStr(`${id}|names`));
  const towns = TOWN_NAME_TABLE.slice();
  for (let i = towns.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [towns[i], towns[j]] = [towns[j], towns[i]]; }
  const seen = new Set();
  const chapters = rows.map((r, i) => {
    const big = r.fs.filter((f) => (f.size || 0) >= BOSS_BYTES);
    const bosses = (big.length ? big : [r.fs[0]]).slice(0, BOSS_MAX);
    if (r.hasNushi && !bosses.includes(nushi)) bosses[bosses.length - 1] = nushi;
    bosses.sort((a, b) => (a.size || 0) - (b.size || 0) || fileKey(a).localeCompare(fileKey(b)));       // 深い階ほど、大きいボス
    const style = STYLE_BY_CAT[r.dominant] || STYLES[hashStr(lower(r.g.dir)) % STYLES.length];
    let name = cleanName(lastSeg(r.g.dir)) || CAT_LABEL[r.dominant];
    const base = name;
    if (seen.has(name)) name = `${base}・${CAT_LABEL[r.dominant]}`;
    for (let k = 2; seen.has(name); k++) name = `${base}・${CAT_LABEL[r.dominant]}${k}`;            // 同じ名前が 3つ以上あっても 重ならない
    seen.add(name);
    return {
      n: i + 1, name, dominant: r.dominant, style,
      floors: r.fs.length <= 12 ? 3 : r.fs.length <= 40 ? 4 : 5,
      ruinName: `${name}の${STYLE_SUFFIX[style]}`,
      town: towns[i % towns.length],
      count: r.fs.length, bytes: r.fs.reduce((s, f) => s + (f.size || 0), 0),
      minSize: r.fs[r.fs.length - 1].size || 1, maxSize: r.fs[0].size || 1, lv: levelRange(i + 1, rows.length, list.length),
      rules: r.g.rules.map(cleanRule),
      bosses: bosses.map(refOf),
    };
  });
  return {
    v: 1, id, kind: "folder", roots: roots.slice(0, 5), seed, at,
    total: { count: list.length, bytes: list.reduce((s, f) => s + (f.size || 0), 0) },
    island: { towns: chapters.length, ruins: chapters.length, townNames: chapters.map((c) => c.town), ruinNames: chapters.map((c) => c.ruinName) },
    chapters, nushi: refOf(nushi),
  };
}

// ファイルが、どの章の敵か（1〜）。当てはまる章がなければ 0
export function chapterOf(def, f) {
  for (const c of def.chapters) if (c.rules.some((r) => matchRule(r, f))) return c.n;
  return 0;
}
export const chapterFiles = (def, files, n) => files.filter((f) => chapterOf(def, f) === n);

// ---- 見込み（部になる前に、章の数・ボスの数・長さの目安を見せる）--------------------------------------
// agg：discover.js の aggregate の結果（フォルダごとの、下ぜんぶの { path, count, bytes, boss }）。path：候補の場所
const keyP = (p) => lower(String(p).replace(/\\+$/, ""));
export function outlookFromAgg(agg, path) {
  const root = keyP(path);
  const inside = [...agg.values()].filter((c) => keyP(c.path) === root || keyP(c.path).startsWith(root + "\\"));
  const kids = new Map();
  for (const c of inside) {
    const k = keyP(c.path);
    const i = k.lastIndexOf("\\");
    const parent = k === root ? null : k.slice(0, i);
    if (parent && inside.some((x) => keyP(x.path) === parent)) { const s = kids.get(parent) || { count: 0, boss: 0, bytes: 0 }; s.count += c.count; s.boss += c.boss; s.bytes += c.bytes; kids.set(parent, s); }
  }
  const groups = inside.map((c) => { const s = kids.get(keyP(c.path)) || { count: 0, boss: 0, bytes: 0 }; return { dir: c.path, count: c.count - s.count, bytes: c.bytes - s.bytes, boss: c.boss - s.boss }; }).filter((g) => g.count > 0);
  const total = inside.find((c) => keyP(c.path) === root);
  return outlookOf(mergeGroups(groups, total ? total.count : undefined), total ? total.boss : 0);
}
function outlookOf(merged, bossTotal) {
  const chapters = Math.max(CHAPTERS_MIN, Math.min(CHAPTERS_MAX, merged.length));
  const bosses = merged.length >= CHAPTERS_MIN ? merged.reduce((s, g) => s + Math.max(1, Math.min(BOSS_MAX, g.boss)), 0) : Math.max(chapters, Math.min(chapters * BOSS_MAX, bossTotal));
  return { chapters, bosses, minutes: chapters * MINUTES_PER_CHAPTER };
}
export const outlookOfPart = (def) => ({ chapters: def.chapters.length, bosses: def.chapters.reduce((s, c) => s + c.bosses.length, 0), minutes: def.chapters.length * MINUTES_PER_CHAPTER });
export const fmtMinutes = (m) => (m < 60 ? `${m}分` : m % 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m / 60}時間`);
export const outlookText = (o) => `${o.chapters}章　ボス${o.bosses}体　およそ${fmtMinutes(o.minutes)}`;

// ---- まぼろし（ファイルが尽きたときの敵。ファイルではない）-----------------------------------------------
// 倒しても、回収待ちには入らない。経験値は3割・ゴールドとドロップは無し（呼ぶ側で扱う）
export const PHANTOM_EXP_RATE = 0.3;
const PHANTOM_NAMES = { image: ["色あせた写真", "忘れ写し", "ぼやけた絵"], video: ["止まった動画", "ざらつく映像"], audio: ["かすれた音", "とぎれた歌"], archive: ["ほどけた包み", "からの箱"], doc: ["にじんだ書類", "消えかけの文"], code: ["ほころびた式", "こわれた手順"], exe: ["動かぬ機械", "さびた歯車"], other: ["名もなき影", "ほこりのかたまり"] };
const PHANTOM_EXT = { image: "png", video: "mp4", audio: "mp3", archive: "zip", doc: "docx", code: "js", exe: "exe", other: "tmp" };
export function phantomFor(dominant, size, rand = Math.random) {
  const cat = PHANTOM_NAMES[dominant] ? dominant : "other";
  const names = PHANTOM_NAMES[cat];
  return { phantom: true, id: "", path: "", name: names[Math.floor(rand() * names.length)], ext: PHANTOM_EXT[cat], size: Math.max(1024, Math.round(size)), modified: 0, imp: 0 };
}

// ---- 敵のレベルの計画 ---------------------------------------------------------------------------
// 部ぜんたいで、レベル 1 から Lmax まで。章ごとに その一部（lv = [低, 高]）。敵は、この範囲で 決まる（勇者のレベルでは変わらない）
// Lmax は、敵の数から：敵をぜんぶ倒したときに、勇者が だいたい Lmax になるように
export const levelMax = (total) => Math.max(6, Math.min(24, Math.round(5 + total / 35)));
export function levelRange(n, K, total) {
  const L = levelMax(total);
  return [Math.round(1 + ((L - 1) * (n - 1)) / K), Math.round(1 + ((L - 1) * n) / K)];
}
// 前の版でつくった部には、レベルの計画が無い：保存してある ボスの大きさから 補う
export function ensureLevels(def) {
  const K = def.chapters.length, total = def.total ? def.total.count : 100;
  for (const c of def.chapters) {
    const top = Math.max(...c.bosses.map((b) => b.size || 1));
    if (!(c.maxSize > 0)) c.maxSize = top;
    if (!(c.minSize > 0)) c.minSize = Math.max(1, Math.round(c.maxSize / 200));
    if (!Array.isArray(c.lv) || c.lv.length !== 2 || !c.lv.every((v) => Number.isInteger(v) && v >= 1 && v <= 40)) c.lv = levelRange(c.n, K, total);
  }
  return def;
}

// ---- 保存した部の検査 -------------------------------------------------------------------------------
// セーブは信用して読まない：形が合わない部は捨てる（null）。ここを通った部だけが、遊びに使われる
export { keyOf as keyOfRef } from "./encounter.js";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const okStr = (v, n) => typeof v === "string" && v.length >= 1 && v.length <= n;
const okRef = (r) => isObj(r) && typeof r.path === "string" && r.path.length <= 600 && okStr(r.name, 260) && Number.isFinite(r.size) && r.size >= 0 && typeof (r.ext ?? "") === "string";
export function cleanDef(d) {
  if (!isObj(d) || !Array.isArray(d.chapters) || d.chapters.length < 1 || d.chapters.length > CHAPTERS_MAX) return null;
  if (typeof d.id !== "string" || !/^[A-Za-z0-9_.:-]{1,60}$/.test(d.id)) return null;
  if (!okRef(d.nushi) || !isObj(d.island)) return null;
  const K = d.chapters.length;
  if (d.island.towns !== K || d.island.ruins !== K) return null;
  for (let i = 0; i < K; i++) {
    const c = d.chapters[i];
    if (!isObj(c) || c.n !== i + 1 || !okStr(c.name, 60) || !okStr(c.town, 40) || !okStr(c.ruinName, 80) || !STYLES.includes(c.style)) return null;
    if (!Number.isInteger(c.floors) || c.floors < 3 || c.floors > 5 || !Array.isArray(c.rules) || !Array.isArray(c.bosses) || c.bosses.length < 1 || c.bosses.length > BOSS_MAX || !c.bosses.every(okRef)) return null;
    if (!(c.dominant in CAT_LABEL)) return null;
  }
  if (!Array.isArray(d.island.townNames) || d.island.townNames.length !== K || !d.island.townNames.every((x) => okStr(x, 40))) return null;
  if (!Array.isArray(d.island.ruinNames) || d.island.ruinNames.length !== K || !d.island.ruinNames.every((x) => okStr(x, 80))) return null;
  return ensureLevels(d);
}
