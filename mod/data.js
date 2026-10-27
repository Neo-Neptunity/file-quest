// ファイル・クエスト — 定数とデータ表
export const DAY = 86400000;
export const BOSS_BYTES = 20 * 1024 * 1024;

// ---- 安全のための除外 ------------------------------------------------------------
// システムの場所・アプリの部品・開発用のフォルダは、討伐対象にしない
export const EXCLUDE_PATH = new RegExp(
  "^[a-z]:\\\\(windows|program files( \\(x86\\))?|programdata)(\\\\|$)" +
  "|\\\\(node_modules|\\.git|appdata|\\$recycle\\.bin|system volume information|\\.explorer_plus)(\\\\|$)",
  "i",
);
export const PROTECTED_EXT = new Set(["dll", "sys", "lib", "so", "dylib", "ini", "inf", "cat", "drv", "lnk"]);
export const PROTECTED_NAME = new Set(["desktop.ini", "thumbs.db"]);

// ---- モンスター --------------------------------------------------------------------
export const SPECIES = {
  image: { emoji: "🧚", name: "妖精" },
  video: { emoji: "🐉", name: "ドラゴン" },
  audio: { emoji: "🧜", name: "セイレーン" },
  archive: { emoji: "📦", name: "ミミック" },
  doc: { emoji: "🦉", name: "賢者" },
  code: { emoji: "👺", name: "ゴブリン" },
  exe: { emoji: "🤖", name: "ガーディアン" },
  other: { emoji: "👾", name: "かげ" },
};
const EXT = {};
const reg = (cat, list) => list.split(" ").forEach((x) => (EXT[x] = cat));
reg("image", "jpg jpeg png gif webp bmp svg heic heif ico tif tiff avif raw psd");
reg("video", "mp4 mkv mov avi webm wmv flv m4v mpg mpeg");
reg("audio", "mp3 wav flac m4a ogg aac wma opus mid");
reg("archive", "zip rar 7z tar gz bz2 xz iso cab");
reg("doc", "doc docx pdf txt md rtf ppt pptx xls xlsx csv odt epub log");
reg("code", "js mjs ts tsx jsx py java c cpp h cs go rs rb php html css json xml yml yaml sh bat ps1 sql lua");
reg("exe", "exe msi apk app");
export const catOf = (ext) => EXT[ext] || "other";

export const LORE = {
  image: { titles: ["思い出の守り手", "色褪せの妖精"], taunt: ["見つけてくれたの？", "また会えたね"], last: ["あの日の景色が…", "まだ綺麗なのに…"] },
  video: { titles: ["眠れる巨竜", "容量喰らい"], taunt: ["我が腹は広いぞ", "グオオ…"], last: ["ディスクが…軽くなる…", "また撮ってくれ…"] },
  audio: { titles: ["古い歌姫", "忘れられた旋律"], taunt: ["聴いてくれる？", "ラ〜ラ〜♪"], last: ["最後の一曲を…", "歌が…消える…"] },
  archive: { titles: ["開かずの箱", "中身不明の宝箱"], taunt: ["開けないでね？", "ガタガタ…"], last: ["中身は…何だっけ…", "解凍されたかった…"] },
  doc: { titles: ["書庫の賢者", "締切の亡者"], taunt: ["最終版は私だ", "ほう、来たか"], last: ["v2も…あるのに…", "保存…したのに…"] },
  code: { titles: ["バグの巣窟", "未完の呪文"], taunt: ["動くはずだった", "コンパイルしてみろ"], last: ["コミットしておけば…", "TODOが…残って…"] },
  exe: { titles: ["古の守護者", "インストーラの番人"], taunt: ["起動するか？", "管理者権限を…"], last: ["もう更新は来ない…", "アンインストール…か"] },
  other: { titles: ["正体不明の影", "拡張子なき者"], taunt: ["…何者だ？", "ヒヒヒ…"], last: ["なんだったのか…", "影に還る…"] },
};

export const lvOf = (size) => Math.min(20, Math.floor(Math.log2((size || 0) / 1024 + 1) / 1.5) + 1);

// ---- 主人公の道具・技 ------------------------------------------------------------------
export const ITEMS = {
  herb: { name: "やくそう", price: 8, desc: "HPを回復する" },
  herb2: { name: "上やくそう", price: 24, desc: "HPを大きく回復する" },
  ether: { name: "せいすい", price: 25, desc: "MPを回復する" },
  smoke: { name: "けむりだま", price: 15, desc: "戦闘から必ず逃げられる" },
  bomb: { name: "ばくだん", price: 30, desc: "敵ぜんたいに ダメージを あたえる" },
};
export const WEAPONS = [
  { name: "ひのきのぼう", atk: 0 }, { name: "どうのつるぎ", atk: 5 }, { name: "てつのつるぎ", atk: 11 },
  { name: "はがねのつるぎ", atk: 19 }, { name: "ぎんのつるぎ", atk: 29 }, { name: "ミスリルのつるぎ", atk: 41 },
  { name: "ほのおのつるぎ", atk: 56 }, { name: "でんせつのつるぎ", atk: 75 },
];
export const ARMORS = [
  { name: "ぬののふく", def: 0 }, { name: "かわのよろい", def: 4 }, { name: "くさりかたびら", def: 9 },
  { name: "てつのよろい", def: 16 }, { name: "ぎんのよろい", def: 25 }, { name: "ミスリルのよろい", def: 36 },
  { name: "ほのおのよろい", def: 50 }, { name: "でんせつのよろい", def: 68 },
];
// とくぎの定義。kind ごとの効果は、戦闘のコードが実行する（dmg：単体／dmgAll：敵ぜんたい／heal1：味方1人／healAll：味方ぜんいん／revive／seal／guardAll）
export const SKILL_DEFS = {
  heal: { name: "ヒール", mp: 3, desc: "HPを回復する", kind: "heal1", base: 40, perLv: 4, rand: 10 },
  slash: { name: "渾身斬り", mp: 4, desc: "強い一撃。当たりにくい", kind: "dmg", mul: 2.2, acc: 0.75 },
  sweep: { name: "ぶんまわし", mp: 5, desc: "敵ぜんたいを 斬る", kind: "dmgAll", mul: 0.7, acc: 0.95 },
  seal: { name: "ふういんの呪文", mp: 6, desc: "敵を2ターン動けなくする", kind: "seal" },
  fury: { name: "必殺・断捨離", mp: 12, desc: "とても強い一撃", kind: "dmg", mul: 3.5, acc: 0.9 },
  // 仲間のとくぎ
  power: { name: "強打", mp: 3, desc: "力を こめた一撃", kind: "dmg", mul: 1.6, acc: 0.9 },
  guardAll: { name: "かたいまもり", mp: 6, desc: "みんなの まもりを 高める", kind: "guardAll" },
  healAll: { name: "みんなヒール", mp: 8, desc: "みんなの HPを回復する", kind: "healAll", base: 25, perLv: 3 },
  revive: { name: "ふっかつ", mp: 12, desc: "倒れた仲間を 起こす", kind: "revive" },
  mega: { name: "メガヒール", mp: 10, desc: "HPを大きく回復する", kind: "heal1", base: 100, perLv: 8, rand: 15 },
  bolt: { name: "まほう", mp: 4, desc: "まもりを 無視する魔法", kind: "dmg", mul: 1.6, acc: 0.95, pierce: true },
  bolt2: { name: "だいまほう", mp: 10, desc: "強い魔法", kind: "dmg", mul: 2.4, acc: 0.95, pierce: true },
  boltAll: { name: "ぜんたいまほう", mp: 14, desc: "敵ぜんたいに 魔法", kind: "dmgAll", mul: 1.0, acc: 0.95, pierce: true },
  double: { name: "二段斬り", mp: 3, desc: "2回 斬る", kind: "dmg", mul: 0.7, acc: 0.95, hits: 2 },
  steal: { name: "ぬすむ", mp: 4, desc: "斬りつけて 素材を ぬすむ", kind: "dmg", mul: 0.8, acc: 0.95, steal: true },
  vital: { name: "急所うち", mp: 5, desc: "必ず 会心になる", kind: "dmg", mul: 1.8, acc: 0.95, crit: true },
};
// ヒーローが おぼえるとくぎ
export const HERO_SKILLS = [{ id: "heal", lv: 1 }, { id: "slash", lv: 2 }, { id: "sweep", lv: 3 }, { id: "seal", lv: 4 }, { id: "fury", lv: 7 }];

export const TOWN_NAMES = ["はじまりの町", "ホコリ港", "わすれられの村"];
export const RUIN_NAMES = ["ダウンロード遺跡", "スクショの洞窟", "動画の巣", "アーカイブの塔", "一時ファイルの沼"];

// ---- 小道具 ----------------------------------------------------------------------------
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function fmtSize(n) {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
export function fmtAge(ms) {
  const d = Math.floor(ms / DAY);
  if (d >= 365) return `${Math.floor(d / 365)}年${Math.floor((d % 365) / 30)}か月`;
  return d >= 30 ? `${Math.floor(d / 30)}か月` : `${d}日`;
}
