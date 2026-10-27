// ファイル・クエスト — マス目の場面の共通部品（歩く・カメラ・歩いて着けるか）。世界地図・ダンジョン・町で、同じものを使う（画面を持たない）
import { clamp } from "./data.js";

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const STEP_SECONDS = 0.13;                     // 1マス歩く時間

// 歩く人の状態：tx,ty が行き先、fx,fy が出発点、px,py が いま描く位置（マスの単位。途中の値もある）
export const newWalker = (x = 0, y = 0) => ({ tx: x, ty: y, px: x, py: y, fx: 0, fy: 0, moveT: 1, moving: false, cool: 0, face: 1, dir: "down" });
export function placeWalker(w, x, y) {
  Object.assign(w, { tx: x, ty: y, px: x, py: y, fx: 0, fy: 0, moveT: 1, moving: false, cool: 0 });
  return w;
}

// 1フレーム進める。dirName は、押されている向き（無ければ null。会話中などで歩かせないときも null）。
// canEnter(x, y) は、そのマスに入れるか。戻り値："arrived"（1マス歩き終えた）／"started"（歩きはじめた）／"blocked"（壁）／null
export function stepWalker(w, dt, dirName, canEnter) {
  if (w.moving) {
    w.moveT += dt / STEP_SECONDS;
    const k = Math.min(1, w.moveT);
    w.px = w.fx + (w.tx - w.fx) * k;
    w.py = w.fy + (w.ty - w.fy) * k;
    if (w.moveT >= 1) { w.moving = false; w.px = w.tx; w.py = w.ty; return "arrived"; }
    return null;
  }
  w.cool -= dt;
  if (!dirName || w.cool > 0) return null;
  const [dx, dy] = DIRS[dirName];
  const nx = w.tx + dx, ny = w.ty + dy;
  w.dir = dirName;                                         // 向いている向き（壁にぶつかっても向きは変わる。町で 人に話しかけるときに使う）
  if (dx) w.face = dx;                                     // 左右を向いたら、その向きに（壁や人にぶつかっても）
  if (!canEnter(nx, ny)) { w.cool = 0.12; return "blocked"; }
  Object.assign(w, { fx: w.tx, fy: w.ty, tx: nx, ty: ny, moveT: 0, moving: true });
  return "started";
}

// カメラ：歩く人を画面の真ん中に。地図のはしでは、はみ出さない。見える範囲のマス（x0〜x1・y0〜y1）も返す
export function cameraFor(px, py, mapW, mapH, ts, vw, vh) {
  const cx = px * ts + ts / 2, cy = py * ts + ts / 2;
  const camX = clamp(cx - vw / 2, 0, Math.max(0, mapW * ts - vw)), camY = clamp(cy - vh / 2, 0, Math.max(0, mapH * ts - vh));
  return { cx, cy, camX, camY, x0: Math.floor(camX / ts), x1: Math.ceil((camX + vw) / ts), y0: Math.floor(camY / ts), y1: Math.ceil((camY + vh) / ts) };
}

// 歩いて着けるか：from から 通れるマスをたどって、歩数（着けないマスは -1）を返す。passable(x, y) は、通れるか
export function reach(w, h, passable, from) {
  const dist = new Int32Array(w * h).fill(-1);
  if (!from || from.x < 0 || from.y < 0 || from.x >= w || from.y >= h || !passable(from.x, from.y)) return dist;
  const queue = [from.y * w + from.x];
  dist[queue[0]] = 0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] >= 0 || !passable(nx, ny)) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

// 歩数がいちばん大きい（遠い）マス。同じなら、あとのほう
export function farthest(dist, w) {
  let best = -1, bi = -1;
  for (let i = 0; i < dist.length; i++) if (dist[i] >= best && dist[i] >= 0) { best = dist[i]; bi = i; }
  return bi < 0 ? null : { x: bi % w, y: Math.floor(bi / w), d: best };
}
