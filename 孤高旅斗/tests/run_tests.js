/* 孤高旅斗 · 统一测试入口
 *
 *   node tests/run_tests.js              跑全部
 *   node tests/run_tests.js capture      只跑文件名含 capture 的
 *   node tests/run_tests.js v3 hot       跑含 v3 或 hot 的（多关键字）
 *   node tests/run_tests.js --list       只列出待跑文件
 *   node tests/run_tests.js --verbose    失败时把该文件的完整输出打出来
 *   node tests/run_tests.js --fast       跳过 test_net（最慢的那个）
 *
 * 统计口径：直接数子进程 stdout 里的 ✔ / ✘，不依赖各文件末尾格式不统一的汇总行。
 */
const fs = require("fs"), path = require("path");
const { spawnSync } = require("child_process");

const dir = __dirname;
const args = process.argv.slice(2);
const flags = args.filter(a => a.indexOf("--") === 0);
const keywords = args.filter(a => a.indexOf("--") !== 0);

let files = fs.readdirSync(dir)
  .filter(f => /^test_.*\.js$/.test(f))
  .sort();

if (keywords.length) files = files.filter(f => keywords.some(k => f.indexOf(k) >= 0));
if (flags.indexOf("--fast") >= 0) files = files.filter(f => f !== "test_net.js");

if (flags.indexOf("--list") >= 0) {
  files.forEach((f, i) => console.log("  " + (i + 1) + ". " + f));
  console.log("共 " + files.length + " 个");
  process.exit(0);
}

if (!files.length) { console.error("!! 没有匹配到测试文件"); process.exit(2); }

const distHtml = path.join(dir, "..", "dist", "孤高旅斗.html");
if (!fs.existsSync(distHtml)) {
  console.error("!! 找不到 dist/孤高旅斗.html，请先运行：python scripts/build.py --keep");
  process.exit(2);
}

const count = (s, ch) => (s.match(new RegExp(ch, "g")) || []).length;
const verbose = flags.indexOf("--verbose") >= 0;

console.log("== 孤高旅斗 无头测试 ==");
console.log("产物：dist/孤高旅斗.html（" +
  (fs.statSync(distHtml).size / 1048576).toFixed(2) + " MB）  文件数：" + files.length + "\n");

let TP = 0, TF = 0, bad = [];
const t0 = Date.now();

for (const f of files) {
  const s0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    cwd: path.join(dir, ".."), encoding: "utf8", timeout: 180000
  });
  const out = (r.stdout || "") + (r.error ? "\n[spawn error] " + r.error.message : "");
  const p = count(out, "✔"), fl = count(out, "✘");
  const ms = Date.now() - s0;
  TP += p; TF += fl;

  const tag = fl === 0 ? "OK  " : "FAIL";
  console.log("  [" + tag + "] " + f.padEnd(22) + " ✔ " + String(p).padStart(4) +
    "   ✘ " + String(fl).padStart(3) + "   " + (ms / 1000).toFixed(1) + "s" +
    (r.status && !r.error && fl === 0 ? "   (退出码 " + r.status + "，无断言失败但进程非零)" : ""));

  if (fl > 0 || r.status) {
    bad.push(f);
    if (verbose) {
      console.log("\n---- " + f + " 完整输出 ----");
      console.log(out.trimEnd());
      console.log("---- end ----\n");
    } else if (fl > 0) {
      out.split("\n").filter(l => l.indexOf("✘") >= 0).slice(0, 8)
        .forEach(l => console.log("        " + l.trim()));
    }
  }
}

const sec = ((Date.now() - t0) / 1000).toFixed(1);
console.log("\n== 合计 ==");
console.log("  ✔ " + TP + " 通过   ✘ " + TF + " 失败   " + files.length + " 个文件   耗时 " + sec + "s");
if (bad.length) console.log("  失败文件：" + bad.join(", "));

process.exit(TF === 0 ? 0 : 1);
