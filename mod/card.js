// ファイル・クエスト — 冒険者カード：友だちに渡す1行のコード。サーバーも権限も要らない
// コードは信用しない：形・文字数・数値の範囲を検査し、能力は、役割とレベルから計算する（カードの数値は使わない）
import { hashStr } from "./pixel.js";
import { ROLE_IDS } from "./party.js";
import { cleanLook } from "./hero.js";

export const CARD_PREFIX = "FQ1-";
export const CARD_MAX_CHARS = 1500;

export const sanitizeText = (str, max) => String(str ?? "").replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, "").trim().slice(0, max);

const toB64Url = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
const fromB64Url = (str) => {
  const s = str.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const checksum = (body) => (hashStr(body) & 0xffff).toString(16).padStart(4, "0");

export function encodeCard({ name, role, lv, quip, seed, look }) {
  const s = seed >>> 0 & 0x7fffffff;
  const o = { v: 1, n: sanitizeText(name, 12), r: role, l: Math.max(1, Math.min(50, lv | 0)), q: sanitizeText(quip, 30), s, lk: cleanLook(look, s) };       // lk：見た目の番号（カードを出した時点のもの）
  const body = toB64Url(new TextEncoder().encode(JSON.stringify(o)));
  return `${CARD_PREFIX}${body}-${checksum(body)}`;
}

const fail = (error) => ({ ok: false, error });
export function decodeCard(text) {
  const t = String(text ?? "").replace(/\s+/g, "");
  if (!t) return fail("コードが ない");
  if (t.length > CARD_MAX_CHARS) return fail("コードが 長すぎる");
  if (!t.startsWith(CARD_PREFIX)) return fail("冒険者カードの コードではない");
  const rest = t.slice(CARD_PREFIX.length), i = rest.lastIndexOf("-");
  if (i < 1) return fail("コードの 形が ちがう");
  const body = rest.slice(0, i), sum = rest.slice(i + 1).toLowerCase();
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return fail("コードに 使えない 文字が ある");
  if (checksum(body) !== sum) return fail("コードが 途中で 切れているか、まちがっている");
  let o;
  try { o = JSON.parse(new TextDecoder().decode(fromB64Url(body))); } catch { return fail("コードを 読めなかった"); }
  if (!o || typeof o !== "object" || o.v !== 1) return fail("対応していない 版の カード");
  const name = sanitizeText(o.n, 12);
  if (!name) return fail("名前が ない");
  if (!ROLE_IDS.includes(o.r)) return fail("役割が わからない");
  if (!Number.isInteger(o.l) || o.l < 1 || o.l > 50) return fail("レベルが おかしい");
  if (!Number.isInteger(o.s) || o.s < 0 || o.s > 2147483647) return fail("カードの 中身が おかしい");
  const card = { id: "c" + hashStr(`${name}|${o.r}|${o.s}`).toString(36), name, role: o.r, lv: o.l, quip: sanitizeText(o.q, 30) || "よろしく！", seed: o.s, look: cleanLook(o.lk, o.s) };      // 見た目の番号は検査する（古いカード・おかしな値は、種から決めた姿）
  return { ok: true, card };
}
