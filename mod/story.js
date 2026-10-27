// ファイル・クエスト — 部ごとの物語（グランドストーリー）の設計図を、つくる・検査する・読み出す（画面を持たない）
// 設計図は、部をつくった時点で1回つくって、凍結して保存する。つくり方は2通り：テンプレート（AIなしで遊べる）／AI（任意）。
// どちらも、同じ形の設計図になる。ゲームの側は、どちらでつくったかを知らない。数・進行・封印・報酬・敵の強さは、ルールが決める（物語は、文章だけ）。
// 文字は画面に描くだけ。（）などの注釈は入れない。ファイルの中身は読まない・送らない（名前・種類・大きさ・年月だけ）。
import { hashStr, rng } from "./pixel.js";
import { catOf, fmtSize } from "./data.js";
import { CAT_LABEL, STYLE_SUFFIX } from "./parts.js";

export const STORY_V = 1;
const TEXT_MAX = 84;                                         // 1ページの文字数（窓は 35字×3行 ほど）

// ---- 文字の検査 ---------------------------------------------------------------------------------
// 画面に描く文字：制御文字・HTMLの記号・かっこの注釈を除いて、長さを切る
export const clean = (v, n = TEXT_MAX) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>&"`\\（）()]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

// ---- 年月・大きさ ---------------------------------------------------------------------------------
const YEAR_NOW = (now) => new Date(now).getFullYear();
export function bornText(ref) {
  const t = ref.since || ref.modified || 0;
  const d = t > Date.UTC(1990, 0, 1) ? new Date(t) : null;
  return d ? `${d.getFullYear()}年${d.getMonth() + 1}月` : "";
}
export function idleYears(ref, now = Date.now()) {
  const t = ref.since || ref.modified || 0;
  if (t < Date.UTC(1990, 0, 1)) return 0;
  return Math.max(0, Math.floor((now - t) / (365.25 * 86400000)));
}

// ---- ぬしの正体の型（名前・拡張子・種類から、機械的に選ぶ）----------------------------------------------------
export const NUSHI_TYPES = [
  { id: "deadline", name: "締切の亡者", test: (r) => /最終|final|修正|rev|fix|v\d/i.test(r.name), born: "締切の 前の夜", motive: "終わらない 修正の まま ひらかれなくなった ことを うらんでいる", twist: "じつは「ここまで やったよ」と だれかに 言ってほしかった だけだった" },
  { id: "twin", name: "コピーの双子", test: (r) => /コピー|copy|複製|\(\d+\)/i.test(r.name), born: "うっかり 二つに わかれた 日", motive: "どちらが ほんものか 分からず さまよっている", twist: "じつは もう片方は とうに 消えていて、ずっと さがしていた" },
  { id: "nameless", name: "名もなき旅人", test: (r) => /無題|新しい|untitled|名称未設定|新規/i.test(r.name), born: "名前を つける ひまが なかった 日", motive: "名前を もらえず どこにも 帰れない", twist: "じつは 最初の 持ち主が 名づけるのを ためらった だけだった" },
  { id: "photo", name: "写真の亡霊", test: (r) => /IMG|DSC|PXL|DCIM|スクリーンショット|screenshot|写真|photo/i.test(r.name), born: "シャッターを きった 一瞬", motive: "見返されないまま 色が あせていく", twist: "じつは 笑っていた 人たちの 顔を おぼえていてほしかった" },
  { id: "backup", name: "眠れる守り番", test: (r) => /backup|バックアップ|bak|旧|old/i.test(r.name), born: "「念のため」と 取っておかれた 日", motive: "何を まもるのか 忘れても まもり続けている", twist: "じつは 持ち主に「もう だいじょうぶ」と 言われたかった" },
  { id: "movie", name: "終わらない映画の主", cat: "video", born: "録画ボタンを おした 夜", motive: "最後まで 見てもらえず エンドロールが 流れない", twist: "じつは 最後の 1分に 大事な ことばが あった" },
  { id: "archive", name: "ほどけぬ包みの主", cat: "archive", born: "きれいに まとめられた 日", motive: "開けてもらえず 中身が ねむり続けている", twist: "じつは 中に 持ち主への 手紙が 入っていた" },
  { id: "doc", name: "書きかけの語り部", cat: "doc", born: "ペンが 止まった 夜", motive: "続きを 書いてもらえず 物語が 宙に うかんでいる", twist: "じつは 結末は もう 決まっていて 読んでほしかった" },
  { id: "code", name: "止まったからくり", cat: "code", born: "最後の 動作確認の 日", motive: "動かしてもらえず 歯車が さびていく", twist: "じつは ちゃんと 動くところを みせたかった" },
  { id: "exe", name: "とびらを失った機械", cat: "exe", born: "はじめて 起動した 日", motive: "もう だれも ひらかず 電源が 入らない", twist: "じつは 役に立てる 日を ずっと 待っていた" },
  { id: "audio", name: "かすれ歌の歌い手", cat: "audio", born: "録音が はじまった 瞬間", motive: "もう 聞かれず 声が かすれていく", twist: "じつは 歌の さびを もう一度 きいてほしかった" },
  { id: "other", name: "ほこりの王", born: "だれも おぼえていない 日", motive: "なぜ ここに いるのかも 忘れてしまった", twist: "じつは 名前を よんでもらいたかった だけだった" },
];
export function nushiType(ref) {
  const cat = catOf(ref.ext);
  return NUSHI_TYPES.find((t) => t.test && t.test(ref)) || NUSHI_TYPES.find((t) => t.cat === cat) || NUSHI_TYPES[NUSHI_TYPES.length - 1];
}

// 名前の伏せ字：revealed 文字ぶんを残して、あとは ■ にする（拡張子は除く）
export function maskedName(name, revealed = 0) {
  const base = String(name || "").replace(/\.[^.]*$/, "") || String(name || "");
  const chars = [...base].slice(0, 12);
  return chars.map((c, i) => (i < revealed ? c : "■")).join("");
}
// かけらが たまった数から、読める文字数（最後のかけらで、ぜんぶ）
export const revealedChars = (name, got, total) => (total <= 0 ? 0 : got >= total ? 99 : Math.floor(([...String(name || "").replace(/\.[^.]*$/, "")].slice(0, 12).length * got) / (total + 1)));

// ---- テンプレート -------------------------------------------------------------------------------------
const ROLES = ["パン屋", "船乗り", "図書係", "門番", "旅芸人", "おばあさん", "鍛冶屋の むすこ", "宿屋の あるじ"];
const FLAVOR = { image: "色あせた 写真", video: "とまった 映像", audio: "かすれた 歌", archive: "ほどけた 包み", doc: "にじんだ 文字", code: "さびた 歯車", exe: "動かない 機械", other: "名もない かげ" };
const ACT_NAMES = ["序", "展", "転", "結"];
export function actOf(n, K) {
  if (n >= K) return 3;
  const r = n / K;
  return r <= 0.34 ? 0 : r <= 0.67 ? 1 : 2;
}
// 小さな物語（3ページ）。{town} 町 {ruin} ダンジョン {role} 町の人 {flavor} 敵のようす {boss} 章のボス
const TALES = [
  [   // 序
    ["{town}の {role}は 言った。「この ごろ、{flavor}の かげが 町の そとを うろつくんだ」", "かげは、長いあいだ だれにも 使われなかった ファイルの なれの果てらしい。{ruin}の ほうから やってくる。", "ほこりの 向こうに、大きな 影が ゆれている。ぬしの うわさが 町に ひろがりはじめた。"],
    ["夜になると、{ruin}から 風が ふいた。ほこりの においが した。", "{town}の {role}は「あれは、わすれられた ものたちの ため息だよ」と つぶやいた。", "まずは 町の 困りごとを かたづけて、{ruin}の ようすを 見に いこう。"],
    ["{town}では、朝から ほこりが 降っていた。{role}が 空を 見あげている。", "「{ruin}で、{flavor}が 歩いているのを 見た 者が いる」", "ただの うわさでは なさそうだ。たしかめに 行こう。"],
  ],
  [   // 展
    ["{town}に ついた。ここでも ほこりが 降っていた。", "{role}の はなしでは、{ruin}の おくで「記憶の かけら」が ひかったという。", "かけらを あつめれば、ぬしの 正体に ちかづける。"],
    ["{town}の {role}は 声を ひそめた。「{ruin}には、{boss}という 大物が すみついている」", "そいつを たおせば、かけらが 手に はいるはずだ。", "ぬしの 名前の 手がかりが、少しずつ そろっていく。"],
    ["{town}の 広場で、ひとびとが {flavor}の うわさを している。", "「{ruin}の ボスは、{boss}。いや、ただの 番人かもしれん」", "ぬしへ つづく 道は、まだ 長い。"],
  ],
  [   // 転
    ["{town}の {role}が 昔の はなしを した。「わたしも、だいじな ものを 消してしまった ことが ある」", "ぬしは ただの 敵では ないのかも しれない。かけらが 語る 思い出は、どれも あたたかい。", "それでも {ruin}の {boss}は、道を ふさいでいる。"],
    ["{town}の {role}は、ふるい 箱を だいじそうに かかえていた。「これは 捨てられなかった 手紙だよ」", "ぬしも、だれかに 捨てられなかった ものの ひとつなのかもしれない。", "{ruin}へ 向かう 足が、すこし 重い。"],
    ["{town}では、人々が 「もう ほこりは いらない」と 言った。「でも、思い出まで 消えるのは こわいんだ」", "たたかうのか、守るのか。答えは、ぬしに 会えば わかる。", "{ruin}の {boss}を こえれば、最後の 町が 近い。"],
  ],
  [   // 結
    ["ついに {town}。ぬしの すみかは、{ruin}の いちばん おくだ。", "かけらが ひとつに なって、ぬしの 名前が よみがえる。「{nushi}」…！", "ぬしは ずっと 待っていた。たたかいの あと、きみは えらぶことに なる。"],
  ],
];
const FOLK_LINES = [
  "ここの ほこりも、朝には すこし 軽くなる。冒険者が 来てくれる おかげだよ。",
  "遠くの 町の はなしを 聞いたかい。そこでも ほこりが 降りはじめたそうだ。",
  "宿屋で ゆっくり 休んでから 行きなよ。無理は 禁物だ。",
  "ファイルも 人も、ずっと 放っておかれると さびしく なるものさ。",
  "鍛冶屋の 親方は 言っていた。素材は 捨てずに 取っておくと いい、と。",
  "ぬしの 正体を 知っている 者は いない。だから みんな こわがっている。",
];
const TROUBLES = [
  "{role}の 困りごと：{flavor}が 町の まわりに 出てきて 通れない。",
  "{role}の 困りごと：夜ごとの ほこりで 店が 開けない。かたづけてほしい。",
  "{role}の 困りごと：{ruin}の ほうから 物音が する。ようすを 見てきてほしい。",
  "{role}の 困りごと：子どもたちが こわがって 外に 出られない。",
  "{role}の 困りごと：荷車が かげに おそわれた。道を ひらいてほしい。",
];
const CLEANER = [
  "そうじ屋と 名のる 男が 立っていた。「ぜんぶ ごみ箱へ おくれば、町は きれいになる」",
  "そうじ屋は ほくそ笑んだ。「思い出なんて ほこりと 同じさ。かけらは ぜんぶ 私が もらう」",
  "そうじ屋は うでを 組んだ。「守るだと？ ためらうから ほこりが たまるんだ」",
];
const TITLE_FORMS = ["ほこり降る {place}", "{place}の わすれもの", "{place}に ねむる もの", "{place}と ぬしの 夜"];
const ENDINGS_BY_TYPE = {
  keep: ["きみは 守りの 印を つけた。{nushi}は ゆっくり うなずいて、ほこりの なかへ ほどけていった。ファイルは、そのまま そこに ある。", "「ありがとう」と {nushi}は 言った。守られた ファイルは、これからも 持ち主を 待ち続ける。"],
  release: ["きみは {nushi}を 手放した。ひかりに つつまれて、ぬしは 静かに 目を とじた。ほこりは すっかり はれた。", "「もう いいんだ」と {nushi}は ほほえんだ。手放すのも、ひとつの やさしさだった。"],
  both: ["きみは、守る ものと 手放す ものを 見きわめた。{nushi}も それで いいと 言うように、まぶしそうに 笑った。", "ぜんぶを 守らず、ぜんぶを 捨てず。ちょうどいい ところで、ほこりは 静かに 降りやんだ。"],
};
const HOOKS = ["遠くの 町で、また ほこりが 降りはじめたという。", "ぬしの 最後の ことばが、耳に のこっている。つぎの ほこりは、どこから 降るのか。", "そうじ屋は、まだ あきらめていない。どこかで また 会うだろう。"];

const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ""));
const pickBy = (list, h) => list[h % list.length];

// 場所の呼び名：フォルダの名前（画面に出すだけ）。無ければ、種類から
export function placeName(def, ctx = {}) {
  const root = String(def.roots?.[0] || "");
  const seg = root.replaceAll("/", "\\").replace(/\\+$/, "");
  const name = clean(seg.slice(seg.lastIndexOf("\\") + 1), 12);
  if (name && /[A-Za-z0-9぀-ヿ㐀-鿿]/.test(name)) return name;
  const cats = {};
  for (const c of def.chapters) cats[c.dominant] = (cats[c.dominant] || 0) + c.count;
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  return `${CAT_LABEL[top ? top[0] : "other"]}の 国`;
}

// テンプレートから、設計図をつくる。ctx：{ prev:[{title,summary,ending}], threads:[] }（前の部から）
export function buildStory(def, ctx = {}) {
  const K = def.chapters.length;
  const h = hashStr(`${def.id}|story`);
  const r = rng(h);
  const nt = nushiType(def.nushi);
  const place = placeName(def, ctx);
  const nushiName = nt.name;
  const born = bornText(def.nushi);
  const intro = [
    `${place}に、ほこりが ふりはじめた。長いあいだ だれにも ひらかれなかった ファイルたちが、モンスターと なって さまよっている。`,
    `町の人々は、大きな「ぬし」の しわざだと うわさする。ぬしの 名前は、まだ だれも 知らない。`,
  ];
  if (ctx.prev && ctx.prev.length) intro.push(`前の 旅の ことは、まだ 胸に ある。${clean(ctx.prev[ctx.prev.length - 1].title, 20)}の あと、また 新しい ほこりが 降った。`);
  const chapters = def.chapters.map((c, i) => {
    const n = i + 1, act = actOf(n, K);
    const role = ROLES[(h + n * 3) % ROLES.length];
    const v = { town: c.town, ruin: c.ruinName, role, flavor: FLAVOR[c.dominant] || FLAVOR.other, boss: clean(c.bosses[c.bosses.length - 1].name, 24), nushi: nushiName };
    const tales = TALES[act];
    const tale = pickBy(tales, h + n).map((p) => clean(fill(p, v)));
    const clues = [
      born ? `ぬしは ${born}の ${nt.born}に 生まれたらしい。` : `ぬしは ${nt.born}に 生まれたらしい。`,
      `ぬしの からだは ${fmtSize(def.nushi.size)}も あるという。`,
      idleYears(def.nushi) >= 1 ? `ぬしは ${idleYears(def.nushi)}年も ひとりで 待っていたらしい。` : "ぬしは ながいこと ひとりで 待っていたらしい。",
      `ぬしは ${nt.motive}らしい。`,
      `ぬしの ほんとうの 願いは、${nt.twist.replace(/^じつは /, "")}。`,
    ];
    return {
      act: ACT_NAMES[act], tale,
      clue: clean(clues[i % clues.length]),
      folk: [clean(pickBy(FOLK_LINES, h + n * 7)), clean(pickBy(FOLK_LINES, h + n * 11 + 3))].filter((x, k, a) => a.indexOf(x) === k),
      troubles: [0, 1, 2].map((k) => clean(fill(pickBy(TROUBLES, h + n * 5 + k * 2), v))).filter((x, k, a) => a.indexOf(x) === k),
      cleaner: act === 1 || (act === 2 && n % 2 === 0),
      cleanerLine: clean(pickBy(CLEANER, h + n)),
    };
  });
  const endings = {};
  for (const k of ["keep", "release", "both"]) endings[k] = clean(fill(pickBy(ENDINGS_BY_TYPE[k], h + k.length), { nushi: nushiName }), 120);
  return {
    v: STORY_V, by: "template",
    title: clean(fill(pickBy(TITLE_FORMS, h), { place }), 24),
    place, intro: intro.map((x) => clean(x, 100)),
    nushi: { type: nt.id, name: nushiName, born: nt.born, motive: nt.motive, twist: nt.twist },
    chapters, endings,
    hook: clean(pickBy(HOOKS, h + 7), 60),
    seed: Math.floor(r() * 1e9),
  };
}

// ---- AI の返事を検査して、テンプレートの設計図に重ねる ----------------------------------------------------------
// 長さ・形・章の数が合うものだけ採り、足りない欄は、テンプレートのまま。数・進行・封印・報酬は、AI が決められない
const text = (v, max, min = 1) => { const s = typeof v === "string" ? clean(v, max) : ""; return s.length >= min ? s : ""; };
const strs = (v, k, max, min = 6) => (Array.isArray(v) ? v.map((x) => text(x, max, min)).filter(Boolean).slice(0, k) : []);
export function validateStory(raw, base) {
  const out = JSON.parse(JSON.stringify(base));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let used = 0;
  const title = text(raw.title, 24, 3); if (title) { out.title = title; used++; }
  const intro = strs(raw.intro, 3, 100, 8); if (intro.length >= 2) { out.intro = intro; used++; }
  if (raw.nushi && typeof raw.nushi === "object") {
    const motive = text(raw.nushi.motive, 60, 6), twist = text(raw.nushi.twist, 60, 6);
    if (motive) { out.nushi.motive = motive; used++; }
    if (twist) { out.nushi.twist = twist; used++; }
  }
  if (Array.isArray(raw.chapters)) {
    raw.chapters.slice(0, out.chapters.length).forEach((c, i) => {
      if (!c || typeof c !== "object") return;
      const tale = strs(c.tale, 4, TEXT_MAX, 8); if (tale.length >= 2) { out.chapters[i].tale = tale; used++; }
      const clue = text(c.clue, 60, 6); if (clue) { out.chapters[i].clue = clue; used++; }
      const folk = strs(Array.isArray(c.folk) ? c.folk : [c.folk], 2, TEXT_MAX); if (folk.length) { out.chapters[i].folk = folk; used++; }
      const troubles = strs(c.troubles, 3, 60, 6); if (troubles.length) { out.chapters[i].troubles = troubles; used++; }
    });
  }
  if (Array.isArray(raw.cleaner)) {                                       // そうじ屋が出る章：範囲の中の整数だけ
    const set = new Set(raw.cleaner.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= out.chapters.length));
    if (set.size) { out.chapters.forEach((c, i) => { c.cleaner = set.has(i + 1); }); used++; }
  }
  if (raw.endings && typeof raw.endings === "object") for (const k of ["keep", "release", "both"]) { const t = text(raw.endings[k], 120, 10); if (t) { out.endings[k] = t; used++; } }
  const hook = text(raw.hook, 60, 8); if (hook) { out.hook = hook; used++; }
  if (used >= 4) out.by = "ai";
  return out;
}

// AI に渡す材料（ファイルの中身は渡さない。フォルダの名前は、許されたときだけ）
export function aiBrief(def, ctx = {}) {
  const nt = nushiType(def.nushi);
  return {
    place: ctx.allowFolder ? placeName(def) : `${CAT_LABEL[def.chapters[0].dominant]}の多い場所`,
    hero: { name: clean(ctx.heroName, 12), level: ctx.heroLv | 0 },
    chapters: def.chapters.map((c) => ({ n: c.n, town: c.town, dungeon: ctx.allowFolder ? c.ruinName : `${CAT_LABEL[c.dominant]}の${STYLE_SUFFIX[c.style]}`, kind: CAT_LABEL[c.dominant], boss: c.bosses.map((b) => ({ name: clean(b.name, 24), ext: b.ext, size: fmtSize(b.size), years: idleYears(b) })) })),
    nushi: { type: nt.name, ext: def.nushi.ext, size: fmtSize(def.nushi.size), years: idleYears(def.nushi) },
    previous: (ctx.prev || []).slice(-3).map((p) => ({ title: p.title, summary: p.summary, ending: p.ending })),
    threads: (ctx.threads || []).slice(-5),
  };
}

// ---- 読み出し -----------------------------------------------------------------------------------------
export const chapterStory = (story, n) => story.chapters[Math.max(0, Math.min(story.chapters.length - 1, n - 1))];

// 記憶のかけら：倒したボスのファイルの、実際の記録（作った年月・種類・大きさ・放置の年数）から作る短い思い出話
export function fragmentFor(ref, now = Date.now()) {
  const cat = CAT_LABEL[catOf(ref.ext)];
  const born = bornText(ref), y = idleYears(ref, now);
  const a = born ? `${born}に つくられた ${cat}。` : `いつかに つくられた ${cat}。`;
  const b = `大きさは ${fmtSize(ref.size)}。${y >= 1 ? `${y}年 だれにも ひらかれなかった。` : "しばらく だれにも ひらかれなかった。"}`;
  return clean(`${a}${b}`, 90);
}

// 終わり方：ぬしを どうしたか（keep：守った／release：手放した）と、章ボスを助けた数で、称号が決まる
export function endingFor(story, { choice, bosses = 0, spared = 0 }) {
  const share = bosses ? spared / bosses : 0;
  const kind = choice === "keep" ? (share >= 0.5 ? "keep" : "both") : spared === 0 ? "release" : "both";
  const title = kind === "keep" ? "思い出の守り手" : kind === "release" ? "整理の達人" : "ちょうどいい人";
  return { kind, title, text: story.endings[kind] || story.endings.both };
}
// 殿堂に残す あらすじ（100字まで）
export function summaryFor(story, ending) {
  return clean(`${story.place}に ほこりが 降り、ぬし「${story.nushi.name}」と たたかった。結末：${ending.title}。`, 100);
}

// セーブから読んだ設計図を、検査して 返す（無い・壊れている ときは、テンプレートから つくりなおす）。同じ部なら 同じ形になる
export function cleanStory(raw, def) {
  const out = validateStory(raw, buildStory(def));
  out.by = raw && typeof raw === "object" && raw.by === "ai" ? "ai" : "template";
  return out;
}
