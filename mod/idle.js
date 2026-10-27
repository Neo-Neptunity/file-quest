// ファイル・クエスト — 「どれだけ放置されたか」の計算（画面を持たない）
// 更新日時が 1980-01-01（zip や古い形式の「日付なし」）や 1970-01-01 のファイルは、日付が分からないだけ。
// そのまま使うと「46年放置」になるうえ、zip から展開したばかりのファイルまで「古い」ことになる。
// そこで、日付が分からないファイルは、このPCに来た日時（作成日時）から数える。それも新しい・分からないなら、古いとは言えないので守る。

export const BOGUS_BEFORE = Date.UTC(1990, 0, 1);

// 日付が分からない（0・1970・1980 など、ありえないほど古い値）
export const isBogusTime = (t) => !(Number.isFinite(t) && t >= BOGUS_BEFORE);

// 本体のプロパティの時刻（ミリ秒の数字か、日付の文字）をミリ秒にする。ありえない値は 0
export function parseTime(v) {
  const t = typeof v === "number" ? v : Date.parse(v);
  return t > 6e11 && t < 4.1e12 ? t : 0;
}

// 放置の起点：更新日時が信用できるならそれ。信用できないなら、このPCに来た日時（作成日時）。どちらも分からなければ 0
export function sinceOf({ modified, created }) {
  if (!isBogusTime(modified)) return modified;
  return created > 0 ? created : 0;
}

// 記録されたファイルから、放置の起点を取り出す（調べたときに決めた since があれば、それ）
export const touched = (e) => e.since || e.modified;

// 放置されたミリ秒（起点が未来なら 0）
export const idleMs = (e, now = Date.now()) => Math.max(0, now - touched(e));
