// ファイル・クエスト — 冒険の地の指し方（画面を持たない）
// 本体は、フォルダを「ファイルID＋パス」で受け取り、IDが合わないものは断る（denied: id does not match）。
// IDが分かるのは、クイックアクセスの項目と、検索で見つかった項目だけ。ドライブの直下や、打ち込んだパスは、IDが分からない。
// なので、IDの分かるフォルダから、中へたどって（検索で1段ずつ）IDを手に入れる。

import { hashStr } from "./pixel.js";

const norm = (p) => String(p || "").replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();

// path を含む（または同じ）フォルダのうち、いちばん深いもの。無ければ null
export function baseFor(path, bases) {
  const t = norm(path);
  let best = null;
  for (const b of bases) {
    const n = norm(b.path);
    if (!n || !(t === n || t.startsWith(n + "\\"))) continue;
    if (!best || n.length > norm(best.path).length) best = b;
  }
  return best;
}

// path の { id, path } を返す。IDの分かる出発点が無い・途中で見つからなければ null
//   listFolders(ref) は、ref の直下のフォルダ（id と path を持つ）の配列を返す関数
export async function refByDescent(path, bases, listFolders) {
  const base = baseFor(path, bases.filter((b) => b && b.id));
  if (!base) return null;
  let cur = { id: base.id, path: base.path };
  const rest = String(path).replaceAll("/", "\\").slice(String(base.path).replace(/[\\/]+$/, "").length).split("\\").filter(Boolean);
  for (const seg of rest) {
    const subs = await listFolders(cur);
    const hit = subs.find((e) => e.name.toLowerCase() === seg.toLowerCase());
    if (!hit || !hit.id) return null;
    cur = { id: hit.id, path: hit.path };
  }
  return cur;
}

export const sameFolder = (a, b) => norm(a) === norm(b);

// 島の形の種：冒険の地（フォルダ）のパスから決める。同じ場所の組みなら、いつも同じ島。場所がちがえば、ちがう島
export const islandSeedFor = (roots) => (hashStr(roots.map((r) => norm(r.path)).sort().join("|")) & 0x7fffffff);
