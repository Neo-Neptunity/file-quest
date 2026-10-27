// ファイル・クエスト — 冒険の地の大きさの検査（画面を持たない）
// 小さすぎると冒険にならず、大きすぎると、調べるのも AI の鑑定（ファイル名を送って、トークンを使う）も重くなる。
// 数えるのは、敵になれる候補（古いファイル。システムの場所や最近使ったものは除いたもの）の数と合計サイズだけ。
// 検査は、AI を呼ぶ前にする（断るときに、トークンを使わないため）。

const MB = 1024 * 1024;
export const VOLUME_DEFAULT = { minCount: 30, minMB: 200, maxCount: 600 };
export const APPRAISE_BATCH = 40;          // 鑑定は 40件ずつ、1回の調査で最大 25回（appraise.js と同じ）
export const APPRAISE_MAX_CALLS = 25;

const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

// 設定の値から、下限・上限を作る（壊れた値・古い設定は既定に。下限が上限をこえないように）
export function limitsFrom(s = {}) {
  const maxCount = num(s.maxCount, VOLUME_DEFAULT.maxCount, 1, 100000);
  return {
    minCount: Math.min(num(s.minCount, VOLUME_DEFAULT.minCount, 1, 100000), maxCount),
    minMB: num(s.minMB, VOLUME_DEFAULT.minMB, 0, 10000000),
    maxCount,
  };
}

// 候補の数 count・合計サイズ bytes（バイト）。over は、調べている途中で「上限をはるかにこえた」とやめたとき
export function checkVolume({ count = 0, bytes = 0, over = false }, lim) {
  if (over || count > lim.maxCount) return { ok: false, reason: "too-many", count, bytes, over: !!over };
  if (count < lim.minCount) return { ok: false, reason: "too-few", count, bytes, over: false };
  if (bytes < lim.minMB * MB) return { ok: false, reason: "too-small", count, bytes, over: false };
  return { ok: true, count, bytes, over: false };
}

// 調べているのを途中でやめる目安（候補がこれだけ見つかったら、もう上限をこえている）
export const abortAt = (lim) => lim.maxCount * 3;

// AI の鑑定が、何回になるか
export const aiCalls = (count) => Math.min(APPRAISE_MAX_CALLS, Math.ceil(Math.max(0, count) / APPRAISE_BATCH));

// 断るときの文（画面にそのまま出す。括弧の注釈は使わない）
export function volumeMessage(r, lim, fmtSize) {
  if (r.reason === "too-many") {
    return `古いファイルが ${r.over ? `${r.count}個 以上` : `${r.count}個`} ある。\nここは 大きすぎる。調べるのも AIの鑑定も 重くなるので、${lim.maxCount}個 までの 場所を えらぼう。\nもっと 小さい フォルダを たどって えらぶか、設定の『冒険の地の上限』を かえよう。`;
  }
  if (r.reason === "too-few") {
    return `古いファイルが ${r.count}個 しか ない。\n冒険には ${lim.minCount}個 以上 ほしい。\nほかの 場所を えらぶか、設定の『冒険の地の下限』を かえよう。`;
  }
  return `古いファイルは ${r.count}個 あるが、合わせて ${fmtSize(r.bytes)} しかない。\n冒険には ${lim.minMB}MB 以上 ほしい。\nほかの 場所を えらぶか、設定の『冒険の地の下限』を かえよう。`;
}
