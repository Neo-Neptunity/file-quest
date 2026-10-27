// ファイル・クエスト — 酒場に来る友だち（冒険者カードの分身）とフレンド申請（画面を持たない）
// ランダムに作った旅人（ダミー）はいない。来るのは、取りこんだ冒険者カードの人だけ。
export const FRIEND_MAX = 12;

export function cardVisitor(card) {
  return { id: card.id, kind: "card", name: card.name, role: card.role, lv: card.lv, seed: card.seed, look: card.look, persona: "友だちの分身", quip: card.quip };
}

// 酒場にいる人：取りこんだカードの人ぜんいん。いつでも会える（カードは、友だちが自分で渡したものなので）
export const visitorsFor = ({ cards = [], limit = 20 }) => cards.slice(0, limit).map(cardVisitor);

// カードの人への申請は、必ず受け入れられる（カードを渡した時点で、承認したとみなす）
export function friendFrom(vis, day) {
  return { id: vis.id, kind: vis.kind, name: vis.name, role: vis.role, lv0: vis.lv, persona: vis.persona, quip: vis.quip, seed: vis.seed, look: vis.look, bond: 0, since: day, hp: null, mp: null };
}
