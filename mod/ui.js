// ファイル・クエスト — 画面の部品（canvas・文字と窓・会話と選択・入力・効果音）。ゲームの中身は知らない
// ゲーム側が決めることは、config に入れてもらう：sound（効果音を鳴らすか）・field（地図の上で Enter・Esc が押されたとき）
import { clamp } from "./data.js";
import { getHeroSprite } from "./hero.js";

export const VW = 960, VH = 540, TS = 48;
export const FONT = '"MS Gothic","Yu Gothic UI","Meiryo",monospace';
export const config = { sound: () => true, field: () => {} };

// ---- 画面 --------------------------------------------------------------------------
const style = document.createElement("style");
style.textContent = "html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%}";
document.head.append(style);
document.body.innerHTML = "<canvas></canvas>";
export const canvas = document.querySelector("canvas");
export const ctx = canvas.getContext("2d");
export const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };         // いまの拡大と位置（画面の大きさで変わる）
function resize() {
  const r = canvas.getBoundingClientRect();
  view.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * view.dpr));
  canvas.height = Math.max(1, Math.round(r.height * view.dpr));
  view.scale = Math.min(r.width / VW, r.height / VH);
  view.ox = (r.width - VW * view.scale) / 2;
  view.oy = (r.height - VH * view.scale) / 2;
}
new ResizeObserver(resize).observe(canvas);
resize();
export const toLogical = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.ox) / view.scale, y: (e.clientY - r.top - view.oy) / view.scale };
};

// ---- 会話・選択の状態 -------------------------------------------------------------------------
export const ui = { msg: null, choice: null, pops: [], shake: 0, flash: 0 };

// ---- 効果音（外部ファイルなし）----------------------------------------------------------
let actx = null;
export function sfx(kind) {
  if (!config.sound()) return;
  try {
    actx ||= new AudioContext();
    if (actx.state === "suspended") actx.resume();
    const t0 = actx.currentTime;
    const tone = (type, f0, f1, dur, vol = 0.06, delay = 0) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0 + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + delay + dur);
      g.gain.setValueAtTime(vol, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      o.connect(g).connect(actx.destination);
      o.start(t0 + delay);
      o.stop(t0 + delay + dur + 0.02);
    };
    const seq = (notes, type = "square", step = 0.1) => notes.forEach((f, i) => tone(type, f, f * 1.01, step * 1.4, 0.05, i * step));
    if (kind === "ok") tone("square", 700, 900, 0.05, 0.03);
    else if (kind === "move") tone("square", 400, 300, 0.04, 0.02);
    else if (kind === "hit") tone("sawtooth", 300, 80, 0.12, 0.07);
    else if (kind === "crit") { tone("sawtooth", 420, 70, 0.16, 0.08); tone("square", 900, 1500, 0.14, 0.05); }
    else if (kind === "hurt") tone("square", 180, 50, 0.22, 0.08);
    else if (kind === "heal") seq([523, 659, 784], "triangle", 0.08);
    else if (kind === "magic") tone("sine", 300, 1200, 0.3, 0.06);
    else if (kind === "encounter") { tone("square", 200, 800, 0.15, 0.06); tone("square", 800, 150, 0.25, 0.06, 0.15); }
    else if (kind === "win") seq([523, 523, 523, 659, 784, 1047], "square", 0.12);
    else if (kind === "level") seq([523, 659, 784, 1047, 1319], "triangle", 0.09);
    else if (kind === "lose") seq([392, 330, 262, 196], "sawtooth", 0.2);
    else if (kind === "coin") seq([988, 1319], "square", 0.06);
  } catch { /* 音が鳴らなくても遊べる */ }
}

// ---- 文字と窓 ----------------------------------------------------------------------------
export function text(str, x, y, o = {}) {
  const { size = 22, color = "#fff", align = "left", base = "top" } = o;
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
export function fit(str, maxW, size) {
  ctx.font = `${size}px ${FONT}`;
  if (ctx.measureText(str).width <= maxW) return str;
  while (str.length > 1 && ctx.measureText(str + "…").width > maxW) str = str.slice(0, -1);
  return str + "…";
}
export function wrap(str, maxW, size) {
  ctx.font = `${size}px ${FONT}`;
  const lines = [];
  for (const para of str.split("\n")) {
    let cur = "";
    for (const ch of para) {
      if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else cur += ch;
    }
    lines.push(cur);
  }
  return lines;
}
export function win(x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "rgba(6,8,40,0.94)";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 5, y + 5, w - 10, h - 10, 5);
  ctx.stroke();
  ctx.restore();
}
export function bar(x, y, w, h, frac, color) {
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * clamp(frac, 0, 1)), h - 2);
}

// ---- 会話・選択（async で書けるようにする）--------------------------------------------------
export function say(str, { auto = 0 } = {}) {
  return new Promise((res) => { ui.msg = { text: str, shown: 0, auto, wait: 0, done: false, full: false, res }; });
}
export function finishMsg() {
  const m = ui.msg;
  if (!m || m.done) return;
  m.done = true;
  m.res();
}
// target: true なら、戦闘で狙う相手を選ぶ窓（選んでいる敵が、画面で強調される）
export function choose(items, { x = 20, y = 236, w = 220, title = "", cancel = true, start = 0, target = false } = {}) {
  return new Promise((res) => { ui.choice = { items, idx: clamp(start, 0, items.length - 1), x, y, w, title, cancel, res, rects: [], target }; });
}
export function endChoice(v) {
  const c = ui.choice;
  if (!c) return;
  ui.choice = null;
  sfx(v < 0 ? "move" : "ok");
  c.res(v);
}
export function pop(x, y, str, color = "#fff") { ui.pops.push({ x, y, text: str, color, t: 0 }); }
export const clearMsg = () => { ui.msg = null; };

// ---- 入力 --------------------------------------------------------------------------
export const held = [];
const NAV = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  const nav = NAV[k];
  const act = k === "enter" || k === " " || k === "z" ? "ok" : k === "escape" || k === "x" || k === "backspace" || k === "m" ? "cancel" : null;
  if (nav) {
    e.preventDefault();
    if (!held.includes(nav)) held.push(nav);
    if (!e.repeat || ui.choice) press(nav);
  } else if (act) {
    e.preventDefault();
    if (!e.repeat) press(act);
  }
});
window.addEventListener("keyup", (e) => {
  const nav = NAV[e.key.toLowerCase()];
  if (nav) { const i = held.indexOf(nav); if (i >= 0) held.splice(i, 1); }
});
window.addEventListener("blur", () => (held.length = 0));

export function press(a) {
  const c = ui.choice;
  if (c) {
    if (a === "up" || (a === "left" && c.target)) { c.idx = (c.idx + c.items.length - 1) % c.items.length; sfx("move"); }
    else if (a === "down" || (a === "right" && c.target)) { c.idx = (c.idx + 1) % c.items.length; sfx("move"); }
    else if (a === "ok") { if (!c.items[c.idx].disabled) endChoice(c.idx); }
    else if (a === "cancel" && c.cancel) endChoice(-1);
    return;
  }
  const m = ui.msg;
  if (m && !m.done) {
    if (a === "ok" || a === "cancel") { if (!m.full) { m.shown = m.text.length; m.full = true; } else finishMsg(); }
    return;
  }
  config.field(a);                                              // 会話も選択も出ていないとき：地図の上の操作（ゲーム側が決める）
}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointermove", (e) => {
  const c = ui.choice;
  if (!c) return;
  const p = toLogical(e), r = c.rects.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  if (r) c.idx = r.i;
});
canvas.addEventListener("wheel", (e) => {                       // ホイールで、カーソルを上下に動かす
  const c = ui.choice;
  if (!c) return;
  e.preventDefault?.();
  c.idx = clamp(c.idx + (e.deltaY > 0 ? 1 : -1), 0, c.items.length - 1);
});
canvas.addEventListener("pointerdown", (e) => {
  const p = toLogical(e), c = ui.choice;
  if (e.button === 2) return press("cancel");
  if (c) {
    const r = c.rects.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    if (r) { c.idx = r.i; press("ok"); }
    return;
  }
  press("ok");
});

// ---- 描画：共通 ----------------------------------------------------------------------------
export function drawMsg(t) {
  const m = ui.msg, c = ui.choice;
  const desc = c && c.items[c.idx] && c.items[c.idx].desc;
  if (!m && !desc) return;
  win(20, 396, 920, 124);
  const str = desc || m.text.slice(0, Math.floor(m.shown));
  wrap(str, 860, 24).slice(0, 3).forEach((ln, i) => text(ln, 44, 414 + i * 32, { size: 24 }));
  if (!desc && m && !m.done && m.full && !m.auto && Math.floor(t * 2) % 2 === 0) text("▼", 920, 496, { size: 20, align: "right" });
}
// 選択の窓。項目が多いときは、窓に入る数だけ出して、カーソルに合わせてスクロールする
const CHOICE_ROW_H = 34;
// 勇者・仲間の絵（16×16のドット絵を、くっきり拡大して描く）
export function drawPortrait(look, role, x, y, size) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(getHeroSprite(look, role), x, y, size, size);
}
export function drawChoice() {
  const c = ui.choice;
  if (!c) return;
  const rowH = CHOICE_ROW_H, th = c.title ? 34 : 0;
  const maxRows = Math.max(3, Math.floor((382 - 8 - th - 20) / rowH));
  const vis = Math.min(c.items.length, maxRows);
  c.top = c.top || 0;
  if (c.idx < c.top) c.top = c.idx;
  if (c.idx >= c.top + vis) c.top = c.idx - vis + 1;
  const h = vis * rowH + 20 + th;
  const y = Math.max(8, Math.min(c.y, 390 - h));
  win(c.x, y, c.w, h);
  if (c.title) text(fit(c.title, c.w - 30, 20), c.x + 18, y + 12, { size: 20, color: "#ffd866" });
  c.rects = [];
  for (let n = 0; n < vis; n++) {
    const i = c.top + n, it = c.items[i], ry = y + 12 + th + n * rowH;
    c.rects.push({ x: c.x + 6, y: ry - 2, w: c.w - 12, h: rowH, i });
    const col = it.disabled ? "#777" : "#fff";
    if (i === c.idx) text("▶", c.x + 14, ry, { size: 22, color: "#ffd866" });
    const hintW = it.hint ? Math.min(c.w * 0.45, 200) : 0;
    text(fit(it.label, c.w - 56 - hintW, 22), c.x + 40, ry, { size: 22, color: col });
    if (it.hint) text(it.hint, c.x + c.w - 16, ry + 2, { size: 18, color: it.disabled ? "#666" : "#9ad1ff", align: "right" });
  }
  const cur = c.items[c.idx];
  if (cur && cur.look) {                                      // 見た目つきの項目：右に、大きな絵を出す
    const pw = 176, px = c.x + c.w + 14;
    if (px + pw <= VW - 8) {
      win(px, y, pw, 196);
      drawPortrait(cur.look, cur.role || "hero", px + 24, y + 14, 128);
      if (cur.caption) text(fit(cur.caption, pw - 24, 17), px + pw / 2, y + 156, { size: 17, align: "center" });
      if (cur.caption2) text(fit(cur.caption2, pw - 24, 14), px + pw / 2, y + 174, { size: 14, align: "center", color: "#9ad1ff" });
    }
  }
  if (c.top > 0) text("▲", c.x + c.w - 22, y + 4, { size: 14, color: "#ffd866" });
  if (c.top + vis < c.items.length) text("▼", c.x + c.w - 22, y + h - 20, { size: 14, color: "#ffd866" });
}
export function drawPops() {
  for (const p of ui.pops) {
    ctx.globalAlpha = clamp(1.4 - p.t, 0, 1);
    ctx.font = `bold 34px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#000";
    ctx.strokeText(p.text, p.x, p.y - p.t * 40);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y - p.t * 40);
  }
  ctx.globalAlpha = 1;
}
