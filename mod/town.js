// ファイル・クエスト — 町の地図を、型とシードから機械的につくる（画面を持たない）
// 型は手で決めた4つ（広場の町・川の町・まるい村・みなとの町）。島の種と町の番号から、型・色・建物の並び・人の名前と姿・木や花が決まる（同じ島の同じ町は、いつも同じ）。
// どの町も、建物は6つ（宿屋・道具屋・鍛冶屋・依頼所・回収所・酒場）。ドアに立つと店が開く。出口は南のはし。
// 町の人は、この町に住む人。旅人ではない。話は、ゲームの本当の状態（回収待ち・敵の数・遺跡）から作る。
import { hashStr, rng } from "./pixel.js";
import { reach } from "./grid.js";
import { defaultLook } from "./hero.js";

export const TT = { GRASS: 0, PATH: 1, TREE: 2, WATER: 3, ROOF: 4, WALL: 5, DOOR: 6, EXIT: 7, WELL: 8, FLOWER: 9 };
const BLOCKED = new Set([TT.TREE, TT.WATER, TT.ROOF, TT.WALL, TT.WELL]);
export const townPassable = (t) => !BLOCKED.has(t);

export const BUILDINGS = [
  { kind: "inn", label: "宿屋", icon: "🛏️" },
  { kind: "item", label: "道具屋", icon: "🧪" },
  { kind: "forge", label: "鍛冶屋", icon: "⚒️" },
  { kind: "guild", label: "依頼所", icon: "📜" },
  { kind: "depot", label: "回収所", icon: "📦" },
  { kind: "tavern", label: "酒場", icon: "🍺" },
];

// 色の組み合わせ
export const TOWN_PALS = [
  { grass: "#4e8b46", grass2: "#468040", path: "#cdb88a", water: "#3b73c4", wall: "#e7dcc4", roofs: ["#c0503f", "#3f78c0", "#d6a23a", "#7a52b8", "#3f9a58", "#c07a3f"] },
  { grass: "#6f8f40", grass2: "#668538", path: "#d8b080", water: "#4a6fb0", wall: "#f0d8b8", roofs: ["#b8483a", "#4a6a9a", "#c8943a", "#8a5a9a", "#4a8a4a", "#a8663a"] },
  { grass: "#8c8a40", grass2: "#838038", path: "#c9a974", water: "#4378b8", wall: "#e8d2a8", roofs: ["#a8402f", "#35688f", "#c98a2e", "#6e4a8f", "#3a7a45", "#b5702f"] },
  { grass: "#9db8a8", grass2: "#92ad9d", path: "#d8dce4", water: "#5a8ec8", wall: "#f4f4f8", roofs: ["#a85a68", "#5a7ab0", "#c4a050", "#8a70b0", "#5a9a78", "#b88a60"] },
];

// 型：paths・water・lots は [x, y, 幅, 高さ] や [x, y]。lots は建物の左上（3×3。下の真ん中がドア）。exit は [x, y, 幅]（いちばん下の行）。folk は人が立つ場所
export const TYPES = [
  {
    id: "plaza", name: "広場の町", w: 28, h: 20,
    paths: [[2, 5, 24, 2], [2, 12, 24, 2], [13, 5, 2, 15], [12, 8, 6, 3]],
    water: [[22, 15, 5, 3]], wells: [[16, 9]],
    lots: [[3, 2], [12, 2], [22, 2], [4, 9], [9, 9], [19, 9]],
    exit: [13, 19, 2], start: [13, 18], folk: [[8, 6], [19, 6], [14, 16]],
  },
  {
    id: "river", name: "川の町", w: 28, h: 20,
    paths: [[1, 5, 26, 2], [1, 12, 26, 2], [20, 14, 2, 6]],
    water: [[9, 1, 2, 18]], wells: [],
    lots: [[2, 2], [14, 2], [21, 2], [2, 9], [6, 9], [14, 9]],
    exit: [20, 19, 2], start: [20, 18], folk: [[6, 6], [18, 6], [12, 13]],
  },
  {
    id: "ring", name: "まるい村", w: 28, h: 20,
    paths: [[3, 5, 22, 2], [3, 5, 2, 10], [23, 5, 2, 10], [3, 13, 22, 2], [5, 11, 18, 1], [13, 13, 2, 7]],
    water: [[18, 16, 7, 3]], wells: [[9, 16]],
    lots: [[4, 2], [12, 2], [20, 2], [6, 8], [12, 8], [18, 8]],
    exit: [13, 19, 2], start: [13, 18], folk: [[8, 6], [17, 6], [14, 16]],
  },
  {
    id: "harbor", name: "みなとの町", w: 28, h: 20,
    paths: [[12, 1, 3, 6], [1, 7, 26, 2], [13, 7, 2, 13], [1, 13, 26, 2]],
    water: [[1, 1, 26, 3]], wells: [],
    lots: [[2, 4], [7, 4], [17, 4], [22, 4], [5, 10], [17, 10]],
    exit: [13, 19, 2], start: [13, 18], folk: [[6, 8], [21, 8], [14, 16]],
  },
];

export const FOLK_ROLES = ["guide", "collector", "rumor"];
const FOLK_NAMES = ["ミレ", "トト", "ハンナ", "ゴロー", "サキ", "ドン", "ミツ", "リタ", "ヨシ", "ポポ", "ノエ", "カイ"];

const rect = (a, w, f) => { const [x, y, rw, rh] = a; for (let j = y; j < y + (rh || 1); j++) for (let i = x; i < x + rw; i++) if (i >= 0 && j >= 0 && i < w) f(i, j); };

// 島の種と町の番号から、町をつくる。同じ入力なら、いつも同じ
export function buildTown({ seed, index }) {
  const key = `${seed}:t${index}`;
  const h = hashStr(`${key}|town`);
  const r = rng(h);
  const type = TYPES[(hashStr(`${seed}|town-type`) + index) % TYPES.length];     // 同じ島の町は、型が重ならない（4つまで）
  const pal = h % TOWN_PALS.length;
  const { w, h: H } = type;
  const tiles = new Uint8Array(w * H).fill(TT.GRASS);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < w && y < H) tiles[y * w + x] = t; };
  for (const a of type.water) rect(a, w, (x, y) => set(x, y, TT.WATER));
  for (const a of type.paths) rect(a, w, (x, y) => set(x, y, TT.PATH));                // 水の上の道は、橋
  for (const [x, y] of type.wells) set(x, y, TT.WELL);
  for (const [x, y] of type.lots) {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) set(x + i, y + j, TT.ROOF);
    for (let i = 0; i < 3; i++) set(x + i, y + 2, TT.WALL);
    set(x + 1, y + 2, TT.DOOR);
  }
  for (let x = 0; x < w; x++) { set(x, 0, TT.TREE); set(x, H - 1, TT.TREE); }
  for (let y = 0; y < H; y++) { set(0, y, TT.TREE); set(w - 1, y, TT.TREE); }
  const [ex, ey, ew] = type.exit;
  const exits = [];
  for (let i = 0; i < ew; i++) { set(ex + i, ey, TT.EXIT); exits.push({ x: ex + i, y: ey }); }
  // 木と花：草の上だけ。道・建物・人の場所には置かない
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (tiles[y * w + x] !== TT.GRASS) continue;
    const v = r();
    if (v < 0.075) tiles[y * w + x] = TT.TREE;
    else if (v < 0.125) tiles[y * w + x] = TT.FLOWER;
  }
  // 建物の中身（どの建物がどの区画か）は、シードで入れかえる
  const order = BUILDINGS.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const roofs = TOWN_PALS[pal].roofs;
  const doors = type.lots.map(([x, y], i) => ({ x: x + 1, y: y + 2, kind: order[i].kind, label: order[i].label, icon: order[i].icon, roof: roofs[(i + h) % roofs.length], lot: [x, y] }));
  // 町の人：名前と姿は、機械的に決める
  const names = FOLK_NAMES.slice();
  const folk = type.folk.map(([x, y], i) => {
    const nm = names.splice(Math.floor(r() * names.length), 1)[0];
    return { x, y, role: FOLK_ROLES[i % FOLK_ROLES.length], name: nm, look: defaultLook(hashStr(`${key}|folk${i}`)), talks: 0 };
  });
  return { key, w, h: H, tiles, type: type.id, typeName: type.name, pal, doors, exits, start: { x: type.start[0], y: type.start[1] }, folk };
}

export const folkAt = (map, x, y) => map.folk.find((f) => f.x === x && f.y === y) || null;
export const doorAt = (map, x, y) => map.doors.find((d) => d.x === x && d.y === y) || null;
export const isExit = (map, x, y) => map.exits.some((e) => e.x === x && e.y === y);
// 歩いて入れるか（人は、よけて通る）
export const townOpen = (map, x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h && townPassable(map.tiles[y * map.w + x]) && !folkAt(map, x, y);
// 町の中で、歩いて着けるマスの歩数（start から）
export const townReach = (map) => reach(map.w, map.h, (x, y) => townOpen(map, x, y), map.start);

// ---- 町の人の話 -----------------------------------------------------------------------------------
// ctx：{ town, root, pending, pool, ruins, cleared, story? }。nth 回目に話しかけたときの、ひとこと（ページの配列）
// story（部の物語があるとき）：{ tale: 小さな物語のページ, clue: 手がかり, folk: 町の人のひとこと, goal: いまの目的地, nushi: ぬしの名前（伏せ字つき） }
export function folkLines(role, ctx, nth = 0) {
  const t = ctx.town || "この町", root = ctx.root || "冒険の地";
  const pend = ctx.pending | 0, pool = ctx.pool | 0, ruins = ctx.ruins | 0, cleared = ctx.cleared | 0;
  const sg = ctx.story;
  if (sg && role === "rumor" && Array.isArray(sg.tale) && sg.tale.length) {
    const k = nth % 4;
    if (k === 0) return sg.tale.slice(0, 4);
    if (k === 1 && sg.clue) return [sg.clue];
    if (k === 2 && sg.folk && sg.folk[0]) return [sg.folk[0]];
  }
  if (sg && role === "guide") {
    const k = nth % 3;
    if (k === 0 && sg.goal) return [sg.goal];
    if (k === 1 && sg.nushi) return [sg.nushi];
  }
  const list = {
    guide: [
      [`${t}へ ようこそ。矢印キーか WASDで あるけるよ。`],
      ["建物の ドアの 上に たつと、中へ はいれる。宿屋・道具屋・鍛冶屋・依頼所・回収所・酒場が そろっているぞ。"],
      ["Escキーで メニューが ひらく。そうびや どうぐは そこから かえられる。"],
      ["人の 前で Enterを おすと、話しかけられる。町を出るときは、南の 出口へ。"],
    ],
    collector: [
      [pend > 0 ? `回収待ちが ${pend}体 たまっているな。回収所の ドアに たてば、まとめて ごみ箱へ おくれるぞ。` : "回収待ちは 今は ゼロだ。いいことだ。"],
      ["ごみ箱へ おくるのは、回収所の ときだけ。ほかでは ファイルには 指一本 ふれないよ。"],
      ["たおした ファイルは すぐには きえない。『回収待ち』から、たすけることも できるんだ。"],
    ],
    rumor: [
      [pool > 0 ? `${root}の あたりには、${pool}体の モンスターが うろついているそうだ。` : "この あたりの モンスターは、だいぶ へったらしい。"],
      [ruins > 0 ? `遺跡は ぜんぶで ${ruins}か所。しずまったのは ${cleared}か所だそうだ。` : "この島に 遺跡は ないらしい。"],
      ["ダンジョンの おくには ボスが いる。階段、宝箱、泉を さがすと いい。"],
      ["レベルが 上がるほど、敵も 手ごわく なる。むりは しないことだ。"],
    ],
  }[role] || [["…"]];
  return list[nth % list.length];
}
