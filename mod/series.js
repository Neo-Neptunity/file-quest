// ファイル・クエスト — シリーズ（終えた部の記録・解決していない伏線・加わった仲間）と、部ごとの記録の検査（画面を持たない）
// セーブは信用して読まない：形・文字数・個数を検査して、おかしいものは捨てる。
// 部をまたいで続くもの（レベル・持ち物・仲間など）は、いまの save のまま。ここは、部の記録だけ（10.9）

export const DONE_MAX = 50;         // 終えた部の記録（殿堂）の数
export const SUMMARIES_FOR_AI = 3;  // 次の部の物語の材料に使う、あらすじの数
export const THREADS_MAX = 5;       // 解決していない伏線の数
export const PARTS_MAX = 12;        // 保存しておく部の数（進行中・中断・終えたもの）

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, "").trim().slice(0, n);
const ID_RE = /^[A-Za-z0-9_.:-]{1,60}$/;

export const emptySeries = () => ({ done: [], threads: [], joined: {} });

function cleanDone(d) {
  if (!isObj(d) || !ID_RE.test(String(d.id ?? ""))) return null;
  return { id: String(d.id), title: str(d.title, 24), summary: str(d.summary, 100), ending: str(d.ending, 12), day: Number.isInteger(d.day) ? d.day : 0 };
}

export function cleanSeries(s) {
  const o = emptySeries();
  if (!isObj(s)) return o;
  if (Array.isArray(s.done)) o.done = s.done.map(cleanDone).filter(Boolean).slice(-DONE_MAX);
  if (Array.isArray(s.threads)) o.threads = s.threads.map((t) => str(t, 60)).filter(Boolean).slice(-THREADS_MAX);
  if (isObj(s.joined)) for (const k of Object.keys(s.joined).slice(0, 12)) if (/^[a-z0-9_-]{1,24}$/.test(k) && s.joined[k] === true) o.joined[k] = true;
  return o;
}

// 部ごとの記録：{ def, loc, progress, story } の入れ物。中身の形は、部を作る側（parts.js・story.js）が決める。ここでは、入れ物の形と個数だけ見る
export function cleanParts(p) {
  const o = {};
  if (!isObj(p)) return o;
  for (const id of Object.keys(p)) {
    if (!ID_RE.test(id) || !isObj(p[id])) continue;
    o[id] = { def: isObj(p[id].def) ? p[id].def : null, loc: isObj(p[id].loc) ? p[id].loc : null, progress: isObj(p[id].progress) ? p[id].progress : {}, story: isObj(p[id].story) ? p[id].story : null };
    if (Object.keys(o).length >= PARTS_MAX) break;
  }
  return o;
}

// 次の部の物語の材料にする、これまでのあらすじ（新しい順に、SUMMARIES_FOR_AI 件まで）
export const recentSummaries = (series) => series.done.filter((d) => d.summary).slice(-SUMMARIES_FOR_AI).map((d) => ({ title: d.title, summary: d.summary, ending: d.ending }));

// 部を終えたとき：記録を足し、伏線を入れかえる（古い記録は捨てる）
export function finishPart(series, rec, threads = []) {
  const s = cleanSeries(series);
  const d = cleanDone(rec);
  if (d) s.done = [...s.done.filter((x) => x.id !== d.id), d].slice(-DONE_MAX);
  s.threads = (Array.isArray(threads) ? threads : []).map((t) => str(t, 60)).filter(Boolean).slice(0, THREADS_MAX);
  return s;
}
