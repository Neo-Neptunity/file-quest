// 通しプレイが「通らなかった」コードを洗い出す（通っていない道に、書き間違いが残っていないかを見るため）。
//   使い方：node file-quest/dev/coverage.mjs [フレーム数=30000]
//   play.mjs を、モードを変えて何回か動かし、V8 のカバレッジを 和集合で測る。通っていない行を、ファイルごとに出す
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MOD_DIR } from "./stage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const frames = process.argv[2] || "30000";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fq-cov-"));
const MODES = [["--explore", "--rich"], ["--explore", "--rich", "--manual"], ["--explore", "--rich", "--aichaos"], ["--explore", "--noai"], [], ["--campaign", "--frames=200000"], ["--campaign", "--noai", "--keep", "--frames=200000"], ["--campaign", "--aichaos", "--next", "--frames=200000"], ["--dungeon", "--lv=25", "--frames=60000"], ["--title"], ["--reset", "--debug"], ["--gate"]];
for (const m of MODES) {
  console.log("実行：", m.join(" ") || "（ふつう）");
  const r = spawnSync(process.execPath, [path.join(here, "play.mjs"), `--frames=${frames}`, ...m], { env: { ...process.env, NODE_V8_COVERAGE: dir }, encoding: "utf8", timeout: 580000 });
  const last = (r.stdout || "").split("\n").find((l) => l.startsWith("フレーム")) || "";
  console.log("  ", last, r.status === 0 ? "" : `（終了コード ${r.status}）`);
}

const covered = new Map();      // ファイル名 → 1文字ごとの「通った」
const texts = new Map();
for (const f of fs.readdirSync(MOD_DIR).filter((x) => x.endsWith(".js"))) {
  const t = fs.readFileSync(path.join(MOD_DIR, f), "utf8");
  texts.set(f, t);
  covered.set(f, new Uint8Array(t.length));
}
for (const file of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  for (const r of j.result) {
    if (!r.url.includes("fq-stage")) continue;
    const name = r.url.split("/").pop();
    if (!covered.has(name)) continue;
    const t = texts.get(name), run = new Uint8Array(t.length).fill(1);
    const rs = r.functions.flatMap((fn) => fn.ranges).sort((a, b) => (a.startOffset - b.startOffset) || (b.endOffset - a.endOffset));
    for (const rg of rs) run.fill(rg.count > 0 ? 1 : 0, rg.startOffset, Math.min(rg.endOffset, t.length));
    const all = covered.get(name);
    for (let i = 0; i < t.length; i++) if (run[i]) all[i] = 1;
  }
}
let total = 0, miss = 0;
for (const [name, t] of texts) {
  const cov = covered.get(name), lines = t.split("\n");
  let off = 0; const unc = [];
  for (let n = 0; n < lines.length; n++) {
    const a = off, b = off + lines[n].length;
    off = b + 1;
    const code = lines[n].trim();
    if (!code || code.startsWith("//") || /^[})\]],?;?$/.test(code)) continue;
    total++;
    let hit = 0, no = 0;
    for (let i = a; i < b; i++) { if (/\s/.test(t[i])) continue; cov[i] ? hit++ : no++; }
    if (no > 0 && no >= hit) { unc.push(n + 1); miss++; }
  }
  if (!unc.length) continue;
  const ranges = [];
  for (const n of unc) { const l = ranges[ranges.length - 1]; if (l && n - l[1] <= 1) l[1] = n; else ranges.push([n, n]); }
  console.log(`\n${name}：通っていない ${unc.length}行`);
  for (const [a, b] of ranges) console.log(`  ${a}${b > a ? "-" + b : ""}： ${lines[a - 1].trim().slice(0, 100)}`);
}
console.log(`\n全体：${total}行のうち、通っていない ${miss}行（${((miss / total) * 100).toFixed(1)}%）`);
fs.rmSync(dir, { recursive: true, force: true });
