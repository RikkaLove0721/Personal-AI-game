/* 孤高旅斗 v4.13d「我的配装」战绩板块
 * 覆盖：关卡进度已移除 / 杀敌数·总胜场·总场数·胜率渲染 / 各模式胜场 chips /
 *       battleEnd 记数与页面读的是同一份数据
 */
const SB = require("./_sandbox.js");
const { makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const sb = makeSandbox();
const LD = sb.LD, P = LD.Profile, UI = LD.UI;
LD.CONF.critRate = 0;

function loadInfoHtml() {
  UI.renderLoad();
  const el = sb.els.loadInfo;
  return el ? String(el.innerHTML || "") : "";
}

console.log("=== 1. 关卡进度已从「我的配装」移除 ===");
{
  const h = loadInfoHtml();
  check("配装页不再出现「关卡进度」", h.indexOf("关卡进度") < 0);
  check("也不再把每关的 ✅/⬜ 抄一遍", h.indexOf("⬜") < 0 && h.indexOf("✅") < 0);
  check("原有的名字 / 外观 / 技能仍在", h.indexOf("名字") >= 0 && h.indexOf("外观") >= 0 && h.indexOf("技能") >= 0);
  check("新增了「战绩」板块", h.indexOf("战绩") >= 0);
}

console.log("\n=== 2. 四个核心数字 ===");
{
  P.d.stats = Object.assign({}, P.d.stats, { kills: 123, wins: 40, losses: 10, modeWins: {} });
  const h = loadInfoHtml();
  check("显示杀敌数", h.indexOf("杀敌数") >= 0 && h.indexOf("123") >= 0);
  check("显示总胜场", h.indexOf("总胜场") >= 0 && h.indexOf("40") >= 0);
  check("显示总场数（胜 + 负 = 50）", h.indexOf("总场数") >= 0 && h.indexOf("50") >= 0);
  check("负数也单独标出来", h.indexOf("负 10") >= 0, "负 10");
  check("顺带算胜率（40/50 = 80%）", h.indexOf("80%") >= 0);
}

console.log("\n=== 3. 各模式胜场 ===");
{
  P.d.stats.modeWins = { duel: 7, capture: 3, river: 1 };
  const h = loadInfoHtml();
  const nm = id => (LD.ruleInfo(id) || {}).name || id;
  check("列出乱斗胜场", h.indexOf(nm("duel")) >= 0 && h.indexOf(">7<") >= 0, nm("duel"));
  check("列出占点胜场", h.indexOf(nm("capture")) >= 0 && h.indexOf(">3<") >= 0, nm("capture"));
  check("列出渡江胜场", h.indexOf(nm("river")) >= 0 && h.indexOf(">1<") >= 0, nm("river"));
  check("按场次从多到少排", h.indexOf(nm("duel")) < h.indexOf(nm("capture"))
    && h.indexOf(nm("capture")) < h.indexOf(nm("river")));
  check("没赢过的模式不会塞进来", h.indexOf(nm("lava")) < 0, nm("lava"));
}

console.log("\n=== 4. 一局没打时的空状态 ===");
{
  P.d.stats = Object.assign({}, P.d.stats, { kills: 0, wins: 0, losses: 0, modeWins: {} });
  const h = loadInfoHtml();
  check("胜率不会出现 NaN", h.indexOf("NaN") < 0);
  check("没有胜场时给一句引导", h.indexOf("还没有赢过") >= 0);
}

console.log("\n=== 5. battleEnd 与页面读的是同一份数据 ===");
{
  P.d.stats = Object.assign({}, P.d.stats, { kills: 0, wins: 0, losses: 0, modeWins: {} });
  P.battleEnd(true, "duel", "capture");
  P.battleEnd(false, "duel", "capture");
  P.battleEnd(true, "duel", "river");
  const st = P.d.stats;
  check("胜场 +2 / 负场 +1", st.wins === 2 && st.losses === 1, st.wins + "胜 " + st.losses + "负");
  check("模式胜场分别累加", st.modeWins.capture === 1 && st.modeWins.river === 1,
    JSON.stringify(st.modeWins));
  const h = loadInfoHtml();
  check("总场数跟着变成 3", h.indexOf("总场数") >= 0 && h.indexOf(">3<") >= 0);
  check("页面上的胜率是 67%", h.indexOf("67%") >= 0);
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
