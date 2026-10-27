// ファイル・クエスト — ボスのドット絵（32×32）。ふつうのモンスターとは別に、種族ごとの専用の姿を描く
import { C, rng, makeGrid, finish } from "./pixel.js";

export const BOSS_N = 32;

export function genBossGrid(seed, cat, { lv = 10, ghost = false } = {}) {
  const r = rng(seed ^ 0x2545f491);
  const h = makeGrid(BOSS_N, r);
  const { g, set, setM, get, rf, ri, topAt, botAt, leftAt, ellipse, rect } = h;

  // 大きな目（左側の x,y に w×h。右側は鏡）。angry なら、まゆを下げる
  const bigEye = (x, y, w, hh, angry = false) => {
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) setM(x + i, y + j, C.EYEW);
    for (let j = hh - Math.max(2, hh - 1); j < hh; j++) for (let i = w - Math.max(2, w - 2); i < w; i++) setM(x + i, y + j, C.PUPIL);
    if (angry) for (let i = 0; i < w; i++) setM(x + i, y - 2 + (i >= w / 2 ? 1 : 0), C.DARK);
  };
  // 牙：y の行に口、上から下へ長さ len の牙と、下から上への牙を交互に
  const fangs = (y, x0, x1, len, rows = 3) => {
    for (let j = 0; j < rows; j++) for (let x = x0; x <= x1; x++) set(x, y + j, C.MOUTH);
    for (let x = x0 + 1; x <= x1 - 1; x += 3) for (let j = 0; j < len; j++) set(x, y + j, C.WHITE);
    for (let x = x0 + 2; x <= x1 - 1; x += 3) for (let j = 0; j < len - 1; j++) set(x, y + rows - 1 - j, C.WHITE);
  };
  const sparkle = (n) => { for (let k = 0; k < n; k++) { const x = ri(0, 31), y = ri(0, 31); if (!get(x, y) && !get(x - 1, y) && !get(x + 1, y) && !get(x, y - 1) && !get(x, y + 1)) set(x, y, r() < 0.5 ? C.ACC : C.WHITE); } };
  let texture = "none";

  if (cat === "video") {                             // ドラゴン：翼を広げた竜
    texture = "scales";
    ellipse(24, rf(9, 11), rf(6, 7), rf(0, 0.2), 0.3);
    ellipse(12, rf(7, 8.5), rf(6, 7), rf(-0.2, 0.1), 0.3);
    rect(12, 17, 19, 20, C.BODY);
    const wl = ri(7, 9), edge = leftAt(19);
    for (let y = 7; y <= 27; y++) {
      const len = Math.max(0, Math.round(wl - Math.abs(y - 16) * 0.75));
      for (let k = 1; k <= len; k++) setM(edge - k, y, k === len ? C.ACC : (k === 1 && y % 4 === 0 ? C.LIGHT : C.ACCD));
    }
    const hl = ri(5, 8), top = topAt(12);
    for (let k = 0; k < hl; k++) for (const dx of [0, 1]) setM(11 - (k >> 1) + dx, top - k + 1, C.ACC);
    for (let x = 12; x <= 15; x++) setM(x, topAt(x) - 1, C.ACCD);
    bigEye(10, 11, 4, 3, true);
    for (let y = 14; y <= 18; y++) for (let x = 10; x <= 21; x++) if (get(x, y) === C.BODY && ((x - 15.5) / 5) ** 2 + ((y - 16) / 3) ** 2 <= 1) set(x, y, C.LIGHT);
    setM(14, 15, C.DARK);
    fangs(18, 11, 20, ri(2, 3));
    for (let y = 20; y <= 30; y += 2) for (let x = 12; x <= 19; x++) if (get(x, y) === C.BODY) set(x, y, C.LIGHT);
    setM(9, botAt(9) + 1, C.WHITE); setM(11, botAt(11) + 1, C.WHITE);
  } else if (cat === "image") {                      // 大妖精：4枚の羽と王冠と光の輪
    texture = "none";
    ellipse(22, rf(4, 5), rf(5.5, 6.5), rf(-0.1, 0.3), 0.25);
    ellipse(14, rf(4.5, 5.5), rf(4.5, 5.2), 0, 0.2);
    const edge = leftAt(18), wl = ri(10, 12);
    for (let y = 4; y <= 19; y++) { const len = Math.max(1, Math.round(wl - Math.abs(y - 10) * 1.15)); for (let k = 1; k <= len; k++) setM(edge - k, y, k === len ? C.ACC : (k % 3 === 0 && y % 2 ? C.ACCD : C.LIGHT)); }
    for (let y = 19; y <= 28; y++) { const len = Math.max(1, Math.round(8 - Math.abs(y - 22) * 1.1)); for (let k = 1; k <= len; k++) setM(edge - k + 1, y, k === len ? C.ACC : C.LIGHT); }
    const top = topAt(15);
    for (let x = 12; x <= 19; x++) set(x, top - 1, C.ACC);
    for (let x = 12; x <= 19; x += 2) { set(x, top - 2, C.ACC); set(x, top - 3, C.ACC); }
    set(15, top - 2, C.WHITE); set(16, top - 2, C.WHITE);
    const hy = Math.max(1, top - 6);
    for (let x = 9; x <= 22; x++) { const dy = Math.round(Math.sqrt(Math.max(0, 1 - ((x - 15.5) / 7) ** 2)) * 1.6); set(x, hy + 1 - dy, C.ACC); set(x, hy + 1 + dy, C.ACC); }
    bigEye(12, 13, 3, 3);
    setM(14, 18, C.MOUTH); setM(15, 19, C.MOUTH);
    setM(13, 12, C.ACCD); setM(12, 11, C.ACCD);
    sparkle(10);
  } else if (cat === "audio") {                      // セイレーンの女王：なびく髪と音符
    ellipse(11, rf(5, 6), rf(5, 6), 0, 0.2);
    ellipse(25, rf(7, 9), rf(5, 6), 0.1, 0.25);
    rect(13, 16, 18, 20, C.BODY);
    const top = topAt(15);
    for (let x = 9; x <= 22; x++) if (get(x, top + 1)) set(x, top, C.ACC);
    for (let side = 0; side < 2; side++) for (let k = 0; k < 3; k++) {
      for (let y = 7; y <= 30; y++) {
        const x = (get(11, y) ? leftAt(y) : 9) - 1 - k + Math.round(Math.sin((y + k * 2) * 0.55) * 1.6);
        if (!get(x, y)) { if (side === 0) set(x, y, C.ACC); else set(31 - x, y, C.ACC); }
      }
    }
    bigEye(11, 10, 3, 3);
    setM(14, 15, C.MOUTH); setM(15, 16, C.MOUTH); set(15, 16, C.TONGUE); set(16, 16, C.TONGUE);
    for (let x = 12; x <= 19; x += 2) if (get(x, 18) === C.BODY) set(x, 18, C.WHITE);
    for (const nx of [3, 26]) { const ny = ri(3, 9); for (let j = 0; j < 5; j++) set(nx + 2, ny + j, C.ACC); set(nx, ny + 4, C.ACC); set(nx + 1, ny + 4, C.ACC); set(nx + 1, ny + 5, C.ACC); set(nx, ny + 5, C.ACC); set(nx + 3, ny, C.ACC); set(nx + 3, ny + 1, C.ACC); }
    setM(13, top - 1, C.WHITE);
  } else if (cat === "archive") {                    // 巨大ミミック
    texture = "plate";
    const x0 = ri(2, 3), x1 = 31 - x0, yt = ri(6, 7), yb = ri(28, 29), lid = 8;
    for (let y = yt; y < yt + lid; y++) for (let x = x0; x <= x1; x++) { const cut = Math.max(0, 3 - (y - yt)); if (x - x0 >= cut && x1 - x >= cut) set(x, y, C.BODY); }
    for (let y = yt + lid + 3; y <= yb; y++) for (let x = x0; x <= x1; x++) set(x, y, C.DARK);
    rect(x0 + 1, yt + lid, x1 - 1, yt + lid + 2, C.MOUTH);
    for (let x = x0 + 1; x <= x1 - 1; x++) { if (x % 3 === 0) { set(x, yt + lid, C.WHITE); set(x, yt + lid + 1, C.WHITE); } if (x % 3 === 1) { set(x, yt + lid + 2, C.WHITE); set(x, yt + lid + 1, C.WHITE); } }
    for (let y = yt + lid + 2; y <= yt + lid + 8; y++) for (let x = 13; x <= 18; x++) set(x, y, C.TONGUE);
    for (const bx of [7, 8, 23, 24]) for (let y = yt; y <= yb; y++) if (![C.MOUTH, C.WHITE, C.TONGUE].includes(get(bx, y))) set(bx, y, y < yt + lid ? C.ACC : C.ACCD);
    for (let x = x0; x <= x1; x++) if (get(x, yt + 4) === C.BODY) set(x, yt + 4, C.ACCD);
    rect(14, yb - 6, 17, yb - 2, C.ACC); setM(15, yb - 4, C.DARK); set(15, yb - 3, C.DARK);
    bigEye(10, yt + 1, 4, 3, true);
    for (let k = 0; k < 8; k++) { const x = ri(x0 + 2, x1 - 2), y = yt + lid + 1; if (get(x, y) === C.MOUTH) set(x, y, C.ACC); }
    setM(x0 + 2, yb + 1, C.DARK); setM(x0 + 3, yb + 1, C.DARK); setM(x0 + 2, yb + 2, C.WHITE);
    setM(x0, yt + 5, C.LIGHT); setM(x0, yb, C.LIGHT);
    for (let j = 0; j < 4; j++) { setM(x0 - 1, yt + lid + 3 + j, C.ACCD); }
  } else if (cat === "doc") {                        // 大賢者：帽子・長いひげ・杖
    texture = "feather";
    ellipse(15, rf(5, 6), rf(4.8, 5.4), 0, 0.2);
    ellipse(26, rf(8, 10), rf(5, 6), 0.2, 0.2);
    rect(13, 19, 18, 22, C.BODY);
    const edge = leftAt(26);
    for (let y = 21; y <= 28; y++) for (let k = 1; k <= 4 - (y > 25 ? 1 : 0); k++) setM(edge - k + 1, y, k === 4 ? C.LIGHT : C.ACCD);
    const top = topAt(15);
    for (let x = 7; x <= 24; x++) set(x, top, C.ACCD);
    for (let i = 0; i < 9; i++) { const w = Math.max(2, 14 - i * 2); for (let k = 0; k < w; k++) set(15.5 - w / 2 + k + (i > 5 ? i - 5 : 0), top - 1 - i, C.ACC); }
    set(13, top - 3, C.WHITE); set(17, top - 5, C.WHITE); set(15, top - 7, C.WHITE);
    bigEye(11, 13, 4, 4);
    for (let i = -1; i <= 4; i++) { setM(11 + i, 12, C.ACCD); setM(11 + i, 17, C.ACCD); }
    for (let j = 12; j <= 17; j++) { setM(10, j, C.ACCD); }
    for (let i = 0; i < 11; i++) { const w = Math.max(2, 12 - i); for (let k = 0; k < w; k++) set(15.5 - w / 2 + k, 20 + i, i % 3 === 2 ? C.LIGHT : C.WHITE); }
    for (let y = 8; y <= 31; y++) set(29, y, C.ACCD);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 10) set(29 + dx, 6 + dy, C.ACC);
    set(28, 5, C.WHITE); set(27, 5, C.WHITE);
    rect(1, 24, 7, 29, C.WHITE); for (let y = 24; y <= 29; y++) set(4, y, C.ACCD); for (let y = 25; y <= 28; y += 2) { setM(2, y, C.DARK); }
    for (let y = 25; y <= 28; y += 2) { set(2, y, C.DARK); set(3, y, C.DARK); set(5, y, C.DARK); set(6, y, C.DARK); }
  } else if (cat === "code") {                       // ゴブリンキング：大きな耳・角つき兜・牙
    texture = "scales";
    ellipse(14, rf(8.5, 10), rf(6.5, 7.5), 0, 0.3);
    ellipse(26, rf(9, 11), rf(4.5, 5.5), 0.1, 0.25);
    rect(12, 20, 19, 22, C.BODY);
    const le = leftAt(13);
    for (let y = 8; y <= 17; y++) { const len = Math.max(0, Math.round(9 - Math.abs(y - 11) * 2.2)); for (let k = 1; k <= len; k++) setM(le - k, y, k >= len - 1 && len > 2 ? C.BODY : C.BODY); }
    for (let y = 10; y <= 13; y++) for (let k = 1; k <= 3; k++) setM(le - k - 1, y, C.TONGUE);
    const top = topAt(15);
    for (let x = 10; x <= 21; x++) { set(x, top + 1, C.ACC); set(x, top + 2, C.ACCD); }
    setM(15, top + 1, C.WHITE);
    for (let k = 0; k < 6; k++) for (const dx of [0, 1]) setM(10 - (k >> 1) + dx, top - k + 1, C.ACC);
    bigEye(10, 12, 4, 3, true);
    for (let y = 12; y <= 14; y++) setM(13, y, C.ACC);
    fangs(18, 10, 21, 3);
    setM(11, 21, C.WHITE); setM(11, 22, C.WHITE); setM(12, 22, C.WHITE);
    const sh = leftAt(26);
    for (let y = 22; y <= 27; y++) for (let k = 0; k < 5; k++) setM(sh + k - 2, y, k === 0 ? C.LIGHT : C.ACCD);
    for (let k = 0; k < 3; k++) setM(sh + k - 1, 21 - k, C.ACC);
    for (let y = 24; y <= 30; y++) for (let x = 12; x <= 19; x++) if (get(x, y) === C.BODY && (x + y) % 3 === 0) set(x, y, C.ACCD);
  } else if (cat === "exe") {                        // コロッサス：巨大ロボット
    texture = "plate";
    rect(7, 12, 24, 26, C.BODY);
    rect(11, 4, 20, 11, C.BODY);
    rect(13, 11, 18, 12, C.DARK);
    rect(12, 6, 19, 8, C.DARK);
    const v = ri(0, 2);
    if (v === 0) { setM(13, 7, C.ACC); setM(14, 7, C.ACC); setM(13, 8, C.ACC); setM(14, 8, C.ACC); } else if (v === 1) { for (let x = 13; x <= 18; x++) { set(x, 7, C.ACC); set(x, 8, C.ACC); } } else { setM(12, 7, C.ACC); set(15, 7, C.ACC); set(16, 7, C.ACC); setM(14, 8, C.ACC); }
    for (let k = 0; k < 3; k++) setM(12 - k * 2, 3 - (k % 2), C.ACCD);
    setM(12, 1, C.ACC); setM(12, 2, C.ACCD);
    for (let x = 14; x <= 17; x++) set(x, 2, C.ACCD);
    rect(14, 16, 17, 19, C.ACC); for (let x = 13; x <= 18; x++) { set(x, 15, C.LIGHT); set(x, 20, C.LIGHT); } for (let y = 15; y <= 20; y++) { set(13, y, C.LIGHT); set(18, y, C.LIGHT); }
    set(15, 17, C.WHITE);
    for (let y = 22; y <= 25; y++) for (let x = 11; x <= 20; x++) set(x, y, (y + x) % 2 ? C.DARK : C.MOUTH);
    rect(1, 9, 6, 14, C.ACCD); rect(0, 11, 1, 12, C.DARK); rect(25, 9, 30, 14, C.ACCD); rect(30, 11, 31, 12, C.DARK);
    for (let y = 15; y <= 27; y++) { setM(3, y, C.BODY); setM(4, y, C.BODY); setM(5, y, C.BODY); }
    rect(2, 28, 6, 31, C.ACCD); rect(25, 28, 29, 31, C.ACCD);
    rect(9, 27, 13, 30, C.BODY); rect(18, 27, 22, 30, C.BODY); rect(8, 30, 14, 31, C.ACCD); rect(17, 30, 23, 31, C.ACCD);
    setM(7, 12, C.LIGHT); setM(7, 26, C.LIGHT); setM(11, 4, C.LIGHT);
  } else {                                           // 影の王：たくさんの目と触手
    texture = "speckle";
    ellipse(19, rf(10, 12), rf(8, 9.5), rf(0.2, 0.5), 0.5);
    for (let t = 0; t < 7; t++) {
      const x = 4 + t * 4 + ri(-1, 1), len = ri(3, 6);
      for (let j = 0; j < len; j++) set(x + Math.round(Math.sin(j * 1.1 + t) * 1.5), botAt(Math.min(31, Math.max(0, x))) + 1, C.BODY);
    }
    for (let k = 0; k < 4; k++) { const sx = ri(2, 4), sy = ri(14, 20); for (let j = 0; j < 8; j++) setM(sx - (j > 5 ? 1 : 0) + Math.round(Math.sin(j * 0.8 + k) * 1), sy - j, C.BODY); }
    const top = topAt(15);
    for (let k = 0; k < 5; k++) { const x = ri(8, 23); for (let j = 1; j <= ri(2, 4); j++) set(x, topAt(x) - j, C.ACCD); }
    for (let y = 12; y <= 17; y++) for (let x = 12; x <= 19; x++) if (((x - 15.5) / 3.8) ** 2 + ((y - 14.5) / 2.8) ** 2 <= 1) set(x, y, C.EYEW);
    for (let y = 14; y <= 16; y++) for (let x = 14; x <= 17; x++) set(x, y, C.PUPIL);
    set(15, 13, C.WHITE);
    const n = ri(5, 8);
    for (let k = 0; k < n; k++) { const x = ri(6, 24), y = ri(8, 22); if (Math.abs(x - 15.5) < 6 && y < 19 && y > 10) continue; if (get(x, y) === C.BODY && get(x + 1, y + 1) === C.BODY) { set(x, y, C.EYEW); set(x + 1, y, C.EYEW); set(x, y + 1, C.EYEW); set(x + 1, y + 1, C.PUPIL); } }
    const my = 22;
    for (let y = my; y <= my + 4; y++) for (let x = 9; x <= 22; x++) if (get(x, y) === C.BODY && ((x - 15.5) / 7) ** 2 + ((y - my - 2) / 2.6) ** 2 <= 1) set(x, y, C.MOUTH);
    for (let x = 9; x <= 22; x += 2) { if (get(x, my + 1) === C.MOUTH) set(x, my + 1, C.WHITE); if (get(x + 1, my + 3) === C.MOUTH) set(x + 1, my + 3, C.WHITE); }
    for (let x = 14; x <= 17; x++) if (get(x, my + 3) === C.MOUTH) set(x, my + 3, C.TONGUE);
  }

  // ぼうれいは、ゆらゆらした下のふち／強いボスは、目が光る
  if (lv >= 12) for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (g[y][x] === C.PUPIL) g[y][x] = C.ACC;
  finish(h, { texture, ghost });
  return g;
}
