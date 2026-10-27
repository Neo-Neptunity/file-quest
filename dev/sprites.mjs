// ドット絵の見本画像を作る（画面を見られないテストの代わりに、目で確かめる）
//   使い方：node file-quest/dev/sprites.mjs   →  file-quest/docs/ に file-quest-monsters-preview.png などを作る
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { stage } from "./stage.mjs";

const st = stage("sprites");
const { genGrid, makePalette, hashStr } = await import(st.url("sprite.js"));
const { genBossGrid } = await import(st.url("boss.js"));
const { genHeroGrid } = await import(st.url("hero.js"));
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
const CATS = ["image", "video", "audio", "archive", "doc", "code", "exe", "other"];

function hsl(str) {
  if (str.startsWith("#")) return [parseInt(str.slice(1, 3), 16), parseInt(str.slice(3, 5), 16), parseInt(str.slice(5, 7), 16)];
  const m = str.match(/hsl\((\d+) (\d+)% (\d+)%\)/);
  if (!m) return null;
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };

function sheet(file, { n, scale, cols, make }) {
  const PAD = 8, cw = n * scale + PAD, ch = n * scale + PAD, rows = CATS.length;
  const W = cw * cols + PAD, H = ch * rows + PAD;
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i * 3] = 30; px[i * 3 + 1] = 28; px[i * 3 + 2] = 44; }
  CATS.forEach((cat, row) => {
    for (let col = 0; col < cols; col++) {
      const { grid, pal } = make(cat, row, col);
      const ox = PAD + col * cw + PAD / 2, oy = PAD + row * ch + PAD / 2;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const c = pal[grid[y][x]];
        if (!c) continue;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = ((oy + y * scale + dy) * W + ox + x * scale + dx) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
      }
    }
  });
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path.join(out, file), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log("書き出した：", file, `${W}×${H}`);
}

sheet("file-quest-monsters-preview.png", {
  n: 16, scale: 7, cols: 8,
  make: (cat, row, col) => {
    const seed = hashStr(`file_${row}_${col}.dat|${cat}`), ghost = col === 7;
    return { grid: genGrid(seed, cat, { lv: col === 6 ? 14 : 3, ghost }), pal: makePalette(seed, cat, ghost).map(hsl) };
  },
});
sheet("file-quest-bosses-preview.png", {
  n: 32, scale: 5, cols: 4,
  make: (cat, row, col) => {
    const seed = hashStr(`boss_${row}_${col}.dat|${cat}`), ghost = col === 3;
    return { grid: genBossGrid(seed, cat, { lv: col === 2 ? 14 : 8, ghost }), pal: makePalette(seed, cat, ghost).map(hsl) };
  },
});

// 勇者・仲間の見た目：色つきの格子（文字の色）をそのまま描く。上から 勇者・前衛・回復・鑑定士・盗賊。かみがた・かぶりもの・色を、いろいろ変えて並べる
function heroSheet(file, { scale, cols, roles }) {
  const n = 16, PAD = 8, cw = n * scale + PAD, ch = n * scale + PAD, rows = roles.length;
  const W = cw * cols + PAD, H = ch * rows + PAD;
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i * 3] = 70; px[i * 3 + 1] = 120; px[i * 3 + 2] = 70; }
  roles.forEach((role, row) => {
    for (let col = 0; col < cols; col++) {
      const look = [col % 6, (col * 3 + row) % 8, (col + row) % 5, (col * 5 + row * 2) % 8, col % 4];
      const grid = genHeroGrid(look, role);
      const ox = PAD + col * cw + PAD / 2, oy = PAD + row * ch + PAD / 2;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const c = grid[y][x] && hsl(grid[y][x]);
        if (!c) continue;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = ((oy + y * scale + dy) * W + ox + x * scale + dx) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
      }
    }
  });
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path.join(out, file), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log("書き出した：", file, `${W}×${H}`);
}
heroSheet("file-quest-heroes-preview.png", { scale: 8, cols: 12, roles: ["hero", "front", "healer", "appraiser", "thief"] });

// 町の見本：4つの型を、1マス 14px の色つきで。屋根の色は建物ごと、ドアは茶、出口は黄、人は白い点
function townSheet(file, { seed, scale }) {
  const tw = townMod;
  const maps = [0, 1, 2, 3].map((i) => tw.buildTown({ seed, index: i }));
  const PAD = 10, mw = maps[0].w * scale, mh = maps[0].h * scale;
  const W = mw * 2 + PAD * 3, H = mh * 2 + PAD * 3;
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i * 3] = 30; px[i * 3 + 1] = 28; px[i * 3 + 2] = 44; }
  const fill = (ox, oy, x, y, c, k = 1) => { for (let dy = 0; dy < scale * k; dy++) for (let dx = 0; dx < scale * k; dx++) { const i = ((oy + y * scale + dy) * W + ox + x * scale + dx) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } };
  maps.forEach((m, n) => {
    const ox = PAD + (n % 2) * (mw + PAD), oy = PAD + Math.floor(n / 2) * (mh + PAD), pal = tw.TOWN_PALS[m.pal];
    const roofAt = new Map();
    for (const d of m.doors) for (let j = 0; j < 2; j++) for (let i = -1; i <= 1; i++) roofAt.set(`${d.x + i},${d.y - 2 + j}`, d.roof);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const t = m.tiles[y * m.w + x];
      const c = t === tw.TT.GRASS ? hsl(pal.grass) : t === tw.TT.PATH ? hsl(pal.path) : t === tw.TT.TREE ? [30, 90, 40] : t === tw.TT.WATER ? hsl(pal.water) : t === tw.TT.ROOF ? hsl(roofAt.get(`${x},${y}`) || "#aa4444") : t === tw.TT.WALL ? hsl(pal.wall) : t === tw.TT.DOOR ? [110, 70, 30] : t === tw.TT.EXIT ? [250, 220, 60] : t === tw.TT.WELL ? [150, 150, 160] : [240, 150, 190];
      fill(ox, oy, x, y, c);
    }
    for (const f of m.folk) fill(ox, oy, f.x, f.y, [255, 255, 255]);
  });
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path.join(out, file), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log("書き出した：", file, `${W}×${H}`);
}
const townMod = await import(st.url("town.js"));
townSheet("file-quest-towns-preview.png", { seed: 4242, scale: 14 });

// ダンジョンの見本：7つの形を、2つずつ（形ごとに、その形になる 階を探して 並べる）。壁は暗く、水は青、上り階段は水色、下り階段はだいだい、宝箱は黄、泉は空色、ボスは赤
function dungeonSheet(file, { scale }) {
  const dg = dgMod;
  const shapes = ["cave", "lake", "maze", "tower", "ring", "castle", "hall"], per = 2;
  const STYLE_OF = { cave: "cave", lake: "swamp", maze: "cave", tower: "tower", ring: "tower", castle: "castle", hall: "castle" };
  const cells = [];
  for (const s of shapes) {
    let got = 0;
    for (let n = 1; n < 400 && got < per; n++) { const key = n * 97 + ":" + (n % 5); for (const floor of [2, 3, 4]) if (got < per && dg.shapeFor(STYLE_OF[s], floor, key) === s) { cells.push({ style: STYLE_OF[s], key, floor, shape: s }); got++; break; } }
  }
  const cw = 44 * scale, ch = 32 * scale, PAD = 8, cols = shapes.length;
  const W = cols * (cw + PAD) + PAD, H = per * (ch + PAD) + PAD;
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i * 3] = 20; px[i * 3 + 1] = 18; px[i * 3 + 2] = 30; }
  const col = (tl, style) => (tl === dg.D.WALL ? [26, 24, 34] : tl === dg.D.WATER ? [48, 100, 170] : tl === dg.D.UP ? [106, 176, 255] : tl === dg.D.DOWN ? [255, 176, 74] : tl === dg.D.BOSS ? [255, 80, 80] : tl === dg.D.CHEST ? [255, 216, 102] : tl === dg.D.SPRING ? [123, 224, 255] : style === "swamp" ? [90, 130, 100] : style === "tower" ? [140, 144, 170] : style === "castle" ? [150, 110, 130] : [130, 112, 88]);
  const seenShapes = {};
  cells.forEach((cell) => {
    const c = shapes.indexOf(cell.shape), row = (seenShapes[cell.shape] = (seenShapes[cell.shape] ?? -1) + 1);
    const f = dg.buildFloor({ key: cell.key, style: cell.style, floor: cell.floor, floors: 5 });
    const ox = PAD + c * (cw + PAD), oy = PAD + row * (ch + PAD);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const k = col(f.tiles[y * f.w + x], cell.style);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = ((oy + y * scale + dy) * W + ox + x * scale + dx) * 3; px[i] = k[0]; px[i + 1] = k[1]; px[i + 2] = k[2]; }
    }
  });
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path.join(out, file), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log("書き出した：", file, `${W}×${H}`);
}
const dgMod = await import(st.url("dungeon.js"));
dungeonSheet("file-quest-dungeons-preview.png", { scale: 4 });

// 弾よけの見本：5つの弾の出かたの、2.2秒後と 3.4秒後（自動でよけている）。弾は白、ハートは赤
function bulletSheet(file) {
  const bl = bulletMod, ids = bl.PATTERN_IDS, W0 = bl.ARENA.w, H0 = bl.ARENA.h, PAD = 8, shots = [2.2, 3.4];
  const W = ids.length * (W0 + PAD) + PAD, H = shots.length * (H0 + PAD) + PAD;
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i * 3] = 30; px[i * 3 + 1] = 28; px[i * 3 + 2] = 44; }
  const dot = (ox, oy, x, y, r, c) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r + 1) continue; const X = Math.round(x + dx), Y = Math.round(y + dy); if (X < 0 || Y < 0 || X >= W0 || Y >= H0) continue; const i = ((oy + Y) * W + ox + X) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } };
  ids.forEach((id, c) => shots.forEach((at, row) => {
    const sim = bl.newDodge({ seed: 77, cat: "other", intensity: 1.7, boss: false });
    sim.patterns = [{ id, next: 0.3, n: 0, gap: W0 / 2, ang: 0.5 }];
    const ox = PAD + c * (W0 + PAD), oy = PAD + row * (H0 + PAD);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) { const i = ((oy + y) * W + ox + x) * 3; px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; }
    while (sim.t < at) bl.stepDodge(sim, 1 / 60, bl.autoDodge(sim));
    for (const b of sim.bullets) dot(ox, oy, b.x, b.y, Math.round(b.r), [255, 255, 255]);
    dot(ox, oy, sim.hx, sim.hy, 5, [255, 51, 85]);
  }));
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path.join(out, file), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  console.log("書き出した：", file, `${W}×${H}`);
}
const bulletMod = await import(st.url("bullets.js"));
bulletSheet("file-quest-bullets-preview.png");
