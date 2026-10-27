// ファイル・クエスト — 冒険の地の候補を、機械的に見つける（画面を持たない）
// 古いファイルの一覧（場所とサイズ）から、フォルダごとに「数・合計サイズ・大物の数」を集計して、
// 大きさの検査（volume.js）に通る場所を選ぶ。ユーザーは、見せられた候補から選ぶだけ。AI は使わない。
import { checkVolume, aiCalls } from "./volume.js";
import { outlookText } from "./parts.js";

export const BOSS_SIZE = 20 * 1024 * 1024;       // 大物（ボスになる）の大きさ。data.js の BOSS_BYTES と同じ
const key = (p) => String(p || "").replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
const clean = (p) => String(p || "").replaceAll("/", "\\").replace(/\\+$/, "");
export function parentOf(path) {
  const p = clean(path);
  const i = p.lastIndexOf("\\");
  return i > 2 ? p.slice(0, i) : "";             // ドライブの直下（C:）より上には行かない
}
const inside = (path, root) => key(path) === key(root) || key(path).startsWith(key(root) + "\\");

// files：古いファイル { path, size }。rootPath：調べた出発点。
// 出発点から、ファイルのある場所までの すべてのフォルダについて、{ path, count, bytes, boss } を返す（そのフォルダの下ぜんぶ）
export function aggregate(files, rootPath) {
  const map = new Map();
  const stop = key(rootPath);
  for (const f of files) {
    if (!inside(f.path, rootPath)) continue;
    let dir = parentOf(f.path);
    while (dir && key(dir).length >= stop.length && inside(dir, rootPath)) {
      const k = key(dir);
      let c = map.get(k);
      if (!c) { c = { path: dir, count: 0, bytes: 0, boss: 0 }; map.set(k, c); }
      c.count++;
      c.bytes += f.size || 0;
      if ((f.size || 0) >= BOSS_SIZE) c.boss++;
      if (k === stop) break;
      dir = parentOf(dir);
    }
  }
  return map;
}

// 大きさの検査に通る場所のうち、いちばん上のものだけを選ぶ（通った場所の中の、小さなフォルダは出さない）
export function pickFitting(agg, lim) {
  const all = [...agg.values()].sort((a, b) => key(a.path).length - key(b.path).length);
  const out = [];
  for (const c of all) {
    if (out.some((o) => inside(c.path, o.path))) continue;
    if (checkVolume({ count: c.count, bytes: c.bytes }, lim).ok) out.push(c);
  }
  return out;
}

// 複数の出発点の候補を、ひとまとめにする：ほかの候補の中にあるものは外し、大きい順に max 個まで
export function mergeCandidates(lists, max = 12) {
  const all = lists.flat();
  const uniq = [];
  for (const c of all.sort((a, b) => key(a.path).length - key(b.path).length)) {
    if (uniq.some((u) => inside(c.path, u.path))) continue;
    uniq.push(c);
  }
  return uniq.sort((a, b) => b.bytes - a.bytes).slice(0, max);
}

// 遊びごたえ：モンスターの数で、短め・ふつう・長め
export const feel = (count) => (count < 100 ? "短め" : count < 300 ? "ふつう" : "長め");

// 候補に添える、大きさの説明（そのまま画面に出す。括弧の注釈は使わない）
// 見込み（章の数・ボスの数・長さ）があれば、それを出す（parts.js の outlookFromAgg）。なければ、大物の数と遊びごたえ
export function describe(c, fmtSize) {
  const tail = c.chapters ? outlookText({ chapters: c.chapters, bosses: c.bosses, minutes: c.minutes }) : `${c.boss ? `大物${c.boss}体　` : ""}長さ ${feel(c.count)}`;
  return `約${c.count}体　${fmtSize(c.bytes)}　${tail}　AIの鑑定 ${aiCalls(c.count)}回`;
}

export const lastName = (path) => clean(path).slice(clean(path).lastIndexOf("\\") + 1) || clean(path);
