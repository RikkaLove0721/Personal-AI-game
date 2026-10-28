/* 孤高旅斗 v4.32 · 成长任务卡 回归
 *
 * 这一批只加了一块界面 + 一条存档字段，但坑集中在「什么时候算完成」：
 *   1. 新档三项必须都是未完成，教程没通关时整块卡不出现
 *   2. 旧档不能一进来就三条全亮（老玩家早做过），也不能一条都不亮
 *   3. 完成必须由事件推进，且同一项只能发一次奖
 *   4. 点任务行要真的跳对界面
 * 所以断言全部围绕这几件事。
 */
const fs = require("fs");
const path = require("path");
const SB = require("./_sandbox.js");
const { makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const KEY = "ld_profile_v3";

console.log("=== 1. 新档：三项都还没做 ===");
{
  const sb = makeSandbox("grow-new");
  const LD = sb.LD, P = LD.Profile, G = LD.Grow;
  check("LD.Grow 存在", !!G);
  check("三条任务的定义完整", G.DEF.length === 3 &&
    G.DEF.every(x => x.key && x.name && x.sub), G.DEF.map(x => x.key).join(","));
  check("奖励额度是 10 金币", G.REWARD === 10);
  check("新档三项都是 0", !G.done("shop") && !G.done("skill") && !G.done("room"));
  check("新档进度 0/3", G.count() === 0 && !G.allDone());
  check("教程没通关时卡片不出现", G.visible() === false);
  UI_render(sb);
  const card = sb.document.getElementById("growCard");
  check("renderGrow 给卡片加了 hide", card.classList.contains("hide"));
}

console.log("\n=== 2. 通关教程后卡片出现，并画出三行 ===");
{
  const sb = makeSandbox("grow-show");
  const LD = sb.LD, P = LD.Profile, UI = LD.UI;
  P.d.tutDone = true;
  UI.renderGrow();
  const card = sb.document.getElementById("growCard");
  const html = card.innerHTML;
  check("卡片去掉了 hide", !card.classList.contains("hide"));
  check("标题是「成长任务」", html.indexOf("成长任务") >= 0);
  check("进度写着 0 / 3", html.indexOf("0 / 3") >= 0, html.match(/\d+ \/ \d+/));
  check("三条任务名都画出来了",
    html.indexOf("买一套皮肤") >= 0 && html.indexOf("装一个技能") >= 0 && html.indexOf("开一局房间") >= 0);
  check("三条都带 data-g（点击靠它分派）",
    (html.match(/data-g="/g) || []).length === 3);
  check("三条都还是未完成的圆点", (html.match(/○/g) || []).length === 3);
  check("每条右侧标着 +10", (html.match(/\+\d/g) || []).length === 3);
  check("收起按钮也在", html.indexOf("data-gfold") >= 0);
  /* 没有「全部完成」的收尾行：三条做完卡片直接退休，那行永远不会被看到 */
  check("卡片里没有常驻的收尾行", html.indexOf("gfoot") < 0);
}

console.log("\n=== 3. 完成一项：加钱、打勾、不重复 ===");
{
  const sb = makeSandbox("grow-hit");
  const LD = sb.LD, P = LD.Profile, G = LD.Grow, UI = LD.UI;
  P.d.tutDone = true;
  const c0 = P.d.coins;
  const r1 = G.hit("shop");
  check("第一次 hit 返回 true", r1 === true);
  check("金币 +10", P.d.coins === c0 + 10, c0 + " → " + P.d.coins);
  check("存档里 shop 已置 1", P.d.grow.shop === 1);
  check("进度变成 1/3", G.count() === 1);
  const r2 = G.hit("shop");
  check("重复 hit 返回 false", r2 === false);
  check("重复 hit 不再加钱", P.d.coins === c0 + 10, "仍为 " + P.d.coins);
  check("未知任务键被拒绝", G.hit("__nope__") === false && P.d.coins === c0 + 10);

  UI.renderGrow();
  const html = sb.document.getElementById("growCard").innerHTML;
  check("已完成那行带 done 类", html.indexOf('growRow done') >= 0);
  check("已完成那行显示「已领」", html.indexOf("已领") >= 0);
  check("未完成的两行仍是圆点", (html.match(/○/g) || []).length === 2);
  check("进度更新成 1 / 3", html.indexOf("1 / 3") >= 0);
}

console.log("\n=== 4. 三条全做完：发满 30 金币，然后卡片退休 ===");
{
  const sb = makeSandbox("grow-all");
  const LD = sb.LD, P = LD.Profile, G = LD.Grow, UI = LD.UI;
  P.d.tutDone = true;
  const c0 = P.d.coins;
  const card = sb.document.getElementById("growCard");
  const mini = sb.document.getElementById("growMini");

  G.hit("shop"); G.hit("skill");
  UI.renderGrow();
  check("做完两项时卡片还在", G.visible() === true && !card.classList.contains("hide"));

  G.hit("room");
  check("全部完成", G.allDone() && G.count() === 3);
  check("总共发了 30 金币", P.d.coins === c0 + 30, c0 + " → " + P.d.coins);
  check("三条做完后不再可见", G.visible() === false);
  check("大卡隐藏", card.classList.contains("hide"));
  check("收起小条也一起隐藏", mini.classList.contains("hide"));
  check("内容已清空，不留「已领」残影", card.innerHTML === "", card.innerHTML.slice(0, 60));

  /* 收起态做完最后一项：小条也不该冒出来 */
  UI.growFold = true;
  UI.renderGrow();
  check("收起态下做完也不显示小条", mini.classList.contains("hide"));
  UI.growFold = false;

  /* 退出再进主菜单，不会重新长出来 */
  UI.show("ovMenu");
  check("重开主菜单仍不出现", card.classList.contains("hide") && G.visible() === false);
  check("进度仍记在存档里", P.d.grow.shop === 1 && P.d.grow.skill === 1 && P.d.grow.room === 1);
}

console.log("\n=== 5. 装配技能会推进「装一个技能」 ===");
{
  const sb = makeSandbox("grow-skill");
  const LD = sb.LD, P = LD.Profile, G = LD.Grow;
  P.d.tutDone = true;
  /* 新档自带斩击 + 火球（都是普攻），技能槽还是空的 ——
   * 想装 K 得先买一个 skill 类招式，正好是玩家真实要走的那条路 */
  P.d.coins = 20;
  check("初始未完成装技能", G.done("skill") === false);
  check("默认技能槽是空的", !P.d.loadout.skill1 && !P.d.loadout.skill2);
  check("买下激光波", P.buySkill("laserWave").ok === true);
  check("买技能本身不算「装」", G.done("skill") === false, "金币 " + P.d.coins);
  const coins0 = P.d.coins;
  const r = P.equipSkill("skill1", "laserWave");
  check("装备成功", r.ok === true, r.why || "");
  check("「装一个技能」被点亮", G.done("skill") === true);
  check("顺带拿到 10 金币", P.d.coins === coins0 + 10, coins0 + " → " + P.d.coins);
  /* 卸下不算装配成功，也不该重复发奖 */
  P.equipSkill("skill1", null);
  check("卸下不会重复发奖", P.d.coins === coins0 + 10 && G.done("skill") === true);
  const bad = P.equipSkill("skill1", "dragonPalm");     // 没买过的招式
  check("装失败不推进进度", bad.ok === false && P.d.coins === coins0 + 10, bad.why || "");
}

console.log("\n=== 6. 点任务行会跳到对应界面 ===");
{
  const sb = makeSandbox("grow-go");
  const LD = sb.LD, UI = LD.UI, P = LD.Profile;
  P.d.tutDone = true;
  LD.Grow.go("shop");
  check("买皮肤 → 皮肤商店（并停在套装页）", UI.screen === "ovSkin" && UI.skinTab === "suit",
    UI.screen + " / " + UI.skinTab);
  LD.Grow.go("skill");
  check("装技能 → 技能商店", UI.screen === "ovSkill", UI.screen);
  LD.Grow.go("room");
  check("开房间 → 勇者格斗房间", UI.screen === "ovDuelSetup", UI.screen);
  check("未知键不动界面", LD.Grow.go("__nope__") === false && UI.screen === "ovDuelSetup");
}

console.log("\n=== 7. 收起 / 展开 ===");
{
  const sb = makeSandbox("grow-fold");
  const LD = sb.LD, UI = LD.UI, P = LD.Profile;
  P.d.tutDone = true;
  UI.growFold = true;
  UI.renderGrow();
  const card = sb.document.getElementById("growCard");
  const mini = sb.document.getElementById("growMini");
  check("收起后大卡隐藏", card.classList.contains("hide"));
  check("收起后小条出现", !mini.classList.contains("hide"));
  check("小条上写着进度", mini.textContent.indexOf("0 / 3") >= 0, mini.textContent);
  UI.growFold = false;
  UI.renderGrow();
  check("展开后大卡回来、小条收掉",
    !card.classList.contains("hide") && mini.classList.contains("hide"));
}

console.log("\n=== 8. 旧档迁移：按已有资产反推 ===");
{
  /* 老玩家：教程通关、买过皮肤、装着别的技能、打过很多局 */
  const old1 = {
    rev: 9, coins: 320, tutDone: true,
    ownedParts: ["head_base", "upper_base", "lower_base", "head_hero"],
    ownedSkills: ["slash", "fireball", "laserWave"],
    stats: { wins: 12, losses: 3 }
  };
  const sb = makeSandbox("grow-old", { storage: { [KEY]: JSON.stringify(old1) } });
  const G = sb.LD.Grow, P = sb.LD.Profile;
  check("老档没被塞成未完成", G.count() === 3, G.count() + "/3");
  check("也没多发金币", P.d.coins === 320, P.d.coins + "");
  check("grow 字段已写进存档对象", !!P.d.grow && P.d.grow.shop === 1);

  /* 只是通关了教程、什么都没买的新人 */
  const old2 = { rev: 2, tutDone: true, ownedParts: [], ownedSkills: [], stats: {} };
  const sb2 = makeSandbox("grow-old2", { storage: { [KEY]: JSON.stringify(old2) } });
  check("空手通关的老档仍是 0 完成", sb2.LD.Grow.count() === 0, sb2.LD.Grow.count() + "/3");

  /* 还没通关教程的档：就算身上有东西也不反推（那是别人的测试档，不是新玩家的路） */
  const old3 = { rev: 3, tutDone: false, ownedSkills: ["laserWave"], stats: { wins: 5 } };
  const sb3 = makeSandbox("grow-old3", { storage: { [KEY]: JSON.stringify(old3) } });
  check("没通关教程不反推", sb3.LD.Grow.count() === 0, sb3.LD.Grow.count() + "/3");

  /* 已经写了 grow 字段的档：原样保留，不能再被反推覆盖 */
  const old4 = { rev: 5, tutDone: true, grow: { shop: 1, skill: 0, room: 0 },
    ownedSkills: ["slash", "fireball", "laserWave"], stats: { wins: 9 } };
  const sb4 = makeSandbox("grow-old4", { storage: { [KEY]: JSON.stringify(old4) } });
  const g4 = sb4.LD.Profile.d.grow;
  check("已有 grow 字段时原样保留", g4.shop === 1 && g4.skill === 0 && g4.room === 0,
    JSON.stringify(g4));
}

console.log("\n=== 9. 源码 / 结构检查 ===");
{
  const root = path.join(__dirname, "..");
  const shell = fs.readFileSync(path.join(root, "src/shell.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "src/js/70_ui.js"), "utf8");
  const pf = fs.readFileSync(path.join(root, "src/js/20_profile.js"), "utf8");
  const room = fs.readFileSync(path.join(root, "src/js/75_room.js"), "utf8");
  const grow = fs.readFileSync(path.join(root, "src/js/69_grow.js"), "utf8");

  check("主菜单里有卡片与小条两个容器",
    shell.indexOf('id="growCard"') >= 0 && shell.indexOf('id="growMini"') >= 0);
  check("卡片默认隐藏（JS 渲染时才出现）", /class="growCard hide"/.test(shell));
  check("手机端有单独的字号 / 位置", /body\.mobile \.growCard/.test(shell) &&
    /body\.mobile \.growRow/.test(shell));
  check("卡片挂在 #ovMenu 里", /id="ovMenu"[\s\S]*id="growCard"/.test(shell));
  check("主菜单切回来会重画卡片", ui.indexOf('if (id === "ovMenu") { UI.renderMenuEntry(); UI.renderGrow(); }') >= 0);
  check("两处买皮肤都会推进任务", (ui.match(/LD\.Grow\.hit\("shop"\)/g) || []).length === 2);
  check("装配技能在存档层推进（漏不掉别的入口）",
    /LD\.Grow\.hit\("skill"\)/.test(pf));
  check("本地房间开局推进任务", /LD\.Grow\.hit\("room"\)/.test(room));
  check("联机开局也推进任务", (ui.match(/LD\.Grow\.hit\("room"\)/g) || []).length === 1);
  check("整档换掉后卡片也重刷", /UI\.renderGrow/.test(pf));
  check("模块本身不直接摸 DOM（渲染在 70_ui）",
    grow.indexOf("getElementById") < 0 && grow.indexOf("innerHTML") < 0);
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);

function UI_render(sb) { if (sb.LD.UI && sb.LD.UI.renderGrow) sb.LD.UI.renderGrow(); }
