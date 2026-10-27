// ファイル・クエスト — 部の進み方のルール（画面を持たない）
// 章の封印・ボスの置き場所・かけら・ぬし・結末の数え方を、ルールで決める。物語（story.js）の文章は、ここに影響しない。
// 部ごとの記録（progress）は、セーブから読むときに検査する（信用して読まない）。
import { keyOfRef } from "./parts.js";

export const newProgress = () => ({ chapter: 1, beaten: {}, frags: [], told: {}, done: false, choice: null, ending: "" });

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// セーブから読んだ記録を、部の形に合わせて 直す（章の数・ボスの数を こえたものは捨てる）
export function cleanProgress(p, def) {
  const o = newProgress();
  if (!isObj(p) || !def || !Array.isArray(def.chapters)) return o;
  const K = def.chapters.length;
  o.chapter = Number.isInteger(p.chapter) ? Math.max(1, Math.min(K, p.chapter)) : 1;
  if (isObj(p.beaten)) {
    for (const c of def.chapters) {
      const row = p.beaten[c.n];
      if (Array.isArray(row)) o.beaten[c.n] = c.bosses.map((_, i) => row[i] === true);
    }
  }
  if (Array.isArray(p.frags)) o.frags = p.frags.filter((f) => isObj(f) && Number.isInteger(f.n) && f.n >= 1 && f.n <= K).slice(0, 40).map((f) => ({ n: f.n, i: Number.isInteger(f.i) ? f.i : 0, text: String(f.text ?? "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 100) }));
  if (isObj(p.told)) for (const c of def.chapters) if (p.told[c.n] === true) o.told[c.n] = true;
  o.done = p.done === true;
  o.choice = p.choice === "keep" || p.choice === "release" ? p.choice : null;
  o.ending = String(p.ending ?? "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 12);
  // 終えた部は、章の最後まで進んだことにする。進んでいない章のボスが 倒されたことには ならない
  if (o.done) o.chapter = K;
  return o;
}

export const chapterOpen = (pr, n) => n >= 1 && n <= pr.chapter;
export const bossBeaten = (pr, n, i) => !!(pr.beaten[n] && pr.beaten[n][i]);
export const chapterCleared = (def, pr, n) => { const c = def.chapters[n - 1]; return !!c && c.bosses.every((_, i) => bossBeaten(pr, n, i)); };
export const bossTotal = (def) => def.chapters.reduce((s, c) => s + c.bosses.length, 0);

// ダンジョンの floor 階に いるボスの番号（なければ -1）。ボスは、いちばん深い階から 順に置く（小さいボスが浅い階・最後の階が、いちばん大きいボス）
export function bossIndexAt(def, n, floor) {
  const c = def.chapters[n - 1];
  if (!c) return -1;
  const idx = floor - (c.floors - c.bosses.length + 1);
  return idx >= 0 && idx < c.bosses.length ? idx : -1;
}
// 階段をボスが守っているか（最後の階以外で、まだ倒していないボスがいる階）
export function guardedFloor(def, pr, n, floor) {
  const c = def.chapters[n - 1];
  if (!c || floor >= c.floors) return false;
  const i = bossIndexAt(def, n, floor);
  return i >= 0 && !bossBeaten(pr, n, i);
}
// 最後の階のボスが、まだ残っているか（最後の階では、そのボスを倒すと、章が終わる）
export const finalBossIndex = (def, n) => def.chapters[n - 1].bosses.length - 1;

// ぬし：最終章の最後のボス
export const isNushi = (def, n, i) => n === def.chapters.length && i === def.chapters[n - 1].bosses.length - 1;

// ボスを倒した。記録して、かけら（ぬし以外）・章の完了・部の完了を返す。同じボスを2回は数えない
export function beatBoss(def, pr, n, i, fragText = "") {
  const c = def.chapters[n - 1];
  if (!c || i < 0 || i >= c.bosses.length) return { ok: false };
  const row = pr.beaten[n] || (pr.beaten[n] = c.bosses.map(() => false));
  if (row[i]) return { ok: false, again: true };
  row[i] = true;
  const nushi = isNushi(def, n, i);
  let frag = null;
  if (!nushi && fragText) { frag = { n, i, text: String(fragText).slice(0, 100) }; pr.frags.push(frag); }
  const chapterDone = chapterCleared(def, pr, n);
  let partDone = false, opened = 0;
  if (chapterDone) {
    if (n >= def.chapters.length) partDone = true;
    else if (pr.chapter <= n) { pr.chapter = n + 1; opened = n + 1; }
  }
  return { ok: true, nushi, frag, chapterDone, partDone, opened };
}

// かけらの数（ぬしを のぞく ボスの数が 全部）
export const fragTotal = (def) => Math.max(0, bossTotal(def) - 1);
export const fragCount = (pr) => pr.frags.length;

// 部の終わり：ぬしを どうしたか。ぬしの印（守る）は、呼ぶ側が ファイルの扱いに 反映する
export function finish(pr, choice, endingTitle) {
  pr.done = true;
  pr.choice = choice === "keep" ? "keep" : "release";
  pr.ending = String(endingTitle || "").slice(0, 12);
}

// ボスの参照が、保存した ボスと同じファイルか（id か、パスの小文字）
export { keyOfRef };
