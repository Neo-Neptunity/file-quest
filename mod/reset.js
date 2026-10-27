// ファイル・クエスト — 進行度のリセット（デバッグ用。画面を持たない）
// 進行度（レベル・持ち物・依頼・位置・部の進み）を新しくして、世界の種・冒険の地・名前・カード・フレンド・部の本体・殿堂は残す。
// フレンドは、絆とHP・MPだけ戻して、同行は外す。助けたファイルの一覧は残す（調べなおしたときに、敵に戻らないように）。ファイルには触らない。
import { newProgress } from "./campaign.js";

// 部は、本体（章・ボス・物語）をそのまま残して、進み（章・倒したボス・かけら）だけ最初に戻す。殿堂（終えた部・加わった仲間）も残す
const resetParts = (parts) => Object.fromEntries(Object.entries(parts || {}).map(([id, r]) => [id, { ...r, loc: null, progress: newProgress() }]));
export function resetSave(old, fresh) {
  return Object.assign(fresh, {
    seed: old.seed,
    roots: (old.roots || []).slice(),
    spared: (old.spared || []).slice(),
    heroName: old.heroName || fresh.heroName,
    look: Array.isArray(old.look) ? old.look.slice() : fresh.look,
    islandSeed: Number.isInteger(old.islandSeed) ? old.islandSeed : fresh.islandSeed,
    cards: (old.cards || []).slice(),
    parts: resetParts(old.parts),
    activePart: old.activePart ?? null,
    series: old.series ? JSON.parse(JSON.stringify(old.series)) : fresh.series,
    friends: (old.friends || []).map((f) => ({ ...f, bond: 0, hp: null, mp: null })),
    party: [],
  });
}
