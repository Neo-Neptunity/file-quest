// ファイル・クエスト — 鑑定士：ファイルが「大事そうか」を見て、大事そうなものを敵にしない（守る側にだけ働く）
// 手元のルール判定は、AI が無くても常に動く。AI を使うときは、AI の結果と手元の判定の「高いほう」を採る。
export const IMP_GUARD = 70;           // これ以上は、敵にしない
export const IMP_DOUBT = 40;           // これ以上は、敵として出るが、鑑定士がひとこと言う
export const TAGS = ["税金", "契約", "思い出", "仕事", "身分", "ゴミ"];

const has = (s, words) => words.some((w) => s.includes(w));
const KEYS = {
  tax: ["確定申告", "源泉", "納税", "所得", "年末調整", "tax", "w-2", "1040"],
  contract: ["契約", "請求", "領収", "見積", "納品", "発注", "invoice", "contract", "receipt", "agreement"],
  identity: ["保険", "年金", "パスポート", "免許", "証明", "マイナンバー", "履歴書", "passport", "license", "resume", "cv", "certificate"],
  memory: ["卒業", "アルバム", "結婚", "家族", "旅行", "思い出", "誕生", "wedding", "graduation", "album", "family"],
};
const SECRET_EXT = ["kdbx", "kdb", "pem", "key", "pfx", "p12", "ppk", "wallet", "1pif", "gpg", "asc", "crt", "cer", "ovpn"];
const JUNK_EXT = ["tmp", "log", "bak", "old", "cache", "dmp", "crdownload", "part"];
const OFFICE_EXT = ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "odt", "txt", "md", "csv"];

// 手元の判定。imp は 0〜100（高いほど、大事そう）
export function ruleAppraise(file) {
  const n = String(file.name || "").toLowerCase(), x = String(file.ext || "").toLowerCase();
  if (SECRET_EXT.includes(x)) return { imp: 95, why: "鍵や証明書のようだ", tag: "身分" };
  if (has(n, KEYS.tax)) return { imp: 90, why: "税金の書類のようだ", tag: "税金" };
  if (has(n, KEYS.contract)) return { imp: 90, why: "契約や請求の書類のようだ", tag: "契約" };
  if (has(n, KEYS.identity)) return { imp: 90, why: "身分の書類のようだ", tag: "身分" };
  if (has(n, KEYS.memory)) return { imp: 85, why: "思い出の品のようだ", tag: "思い出" };
  if (JUNK_EXT.includes(x) || /(^|[^a-z])(copy of|temp|tmp|cache)([^a-z]|$)/.test(n) || n.includes("のコピー") || /\(\d+\)\.[a-z0-9]+$/.test(n)) return { imp: 5, why: "ごみのようだ", tag: "ゴミ" };
  if (/screenshot|スクリーンショット|スクショ/.test(n)) return { imp: 10, why: "スクリーンショットのようだ", tag: "ゴミ" };
  if ((n.includes("final") || n.includes("最終")) && OFFICE_EXT.includes(x)) return { imp: 60, why: "最終版の書類のようだ", tag: "仕事" };
  if (/^(img_|dsc|pxl_|dji_|p\d{6,}|\d{8}_\d{6})/.test(n) && ["jpg", "jpeg", "heic", "png", "mp4", "mov"].includes(x)) return { imp: 55, why: "撮った写真のようだ", tag: "思い出" };
  return { imp: 15, why: "", tag: "ゴミ" };
}

export const appraiseKey = (file) => `${file.id || String(file.path).toLowerCase()}|${file.name}`;

// AI の返事を検査する。形に合わない行は捨てる（その1件は、手元の判定になる）
export function validateAiRows(rows, n) {
  const out = new Map();
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const k = Number(r.k), imp = Number(r.imp);
    if (!Number.isInteger(k) || k < 0 || k >= n || !Number.isFinite(imp)) continue;
    const why = String(r.why ?? "").replace(/[\u0000-\u001f<>]/g, "").slice(0, 20);
    const tag = TAGS.includes(r.tag) ? r.tag : "";
    out.set(k, { imp: Math.max(0, Math.min(100, Math.round(imp))), why, tag });
  }
  return out;
}

// 候補ぜんぶを鑑定する。askAi(items) は、AI の返事（配列）を返す関数。使えなければ null を渡す
//   cache：{ key → {imp, why, tag, ai} } 。調べたものは、ここに入る
export async function appraiseAll(files, { askAi = null, cache = {}, batch = 40, maxCalls = 25, folderOf = null, onProgress = null } = {}) {
  const result = new Map();
  const todo = [];
  for (const f of files) {
    const k = appraiseKey(f);
    if (cache[k]) { result.set(k, cache[k]); continue; }
    todo.push(f);
  }
  const rules = new Map(todo.map((f) => [appraiseKey(f), ruleAppraise(f)]));
  const merged = new Map(rules);
  let calls = 0;
  if (askAi) {
    for (let i = 0; i < todo.length && calls < maxCalls; i += batch) {
      const part = todo.slice(i, i + batch);
      calls++;
      if (onProgress) onProgress(Math.min(i + batch, todo.length), todo.length);
      const items = part.map((f, j) => ({ k: j, n: f.name, x: f.ext, s: f.sizeText, i: f.idleText, ...(folderOf ? { d: folderOf(f) } : {}) }));
      let rows = null;
      try { rows = await askAi(items); } catch { rows = null; }
      const ok = validateAiRows(rows, part.length);
      part.forEach((f, j) => {
        const key = appraiseKey(f), rule = rules.get(key), a = ok.get(j);
        if (!a) return;
        // 高いほうを採る。守る側の判定は、AI でも 下げない
        const useAi = a.imp > rule.imp;
        merged.set(key, { imp: Math.max(a.imp, rule.imp), why: (useAi ? a.why : rule.why) || a.why || rule.why, tag: (useAi ? a.tag : rule.tag) || a.tag || rule.tag, ai: true });
      });
    }
  }
  for (const [key, v] of merged) { cache[key] = v; result.set(key, v); }
  return result;
}
