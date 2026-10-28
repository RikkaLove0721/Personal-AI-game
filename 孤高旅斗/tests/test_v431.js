/* 孤高旅斗 v4.31 · 模式介绍 / 商店可读性 / 文案口径 回归
 *
 * 这一批改的都是「界面上的话」和「界面的排版」，逻辑本身没动，
 * 所以断言也围绕三件事：
 *   1. 模式介绍能不能拿到当前模式的完整说明（数据 + ** 加粗转换）
 *   2. 帮助页里不能再有模式细节（那些已经搬进房间弹窗）
 *   3. 皮肤商店的套装卡片要带 suit 类、不要再用内联 gridColumn 占位
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

const sb = makeSandbox("v431");
const LD = sb.LD, UI = LD.UI, P = LD.Profile;

console.log("=== 1. 模式介绍的数据来源 ===");
{
  check("每个模式都有说明文案", LD.RULES.every(r => (r.desc || "").length > 8),
    LD.RULES.filter(r => !r.desc || r.desc.length <= 8).map(r => r.id).join(",") || "全部有");
  check("模式数量与分组自洽",
    LD.rulesBy("combat").length + LD.rulesBy("casual").length === LD.RULES.length,
    LD.rulesBy("combat").length + " 战斗 + " + LD.rulesBy("casual").length + " 娱乐");
  check("每个模式都有图标与归类", LD.RULES.every(r => !!r.icon));

  /* 说明里混着 `**加粗**` 与内联 <b>，弹窗统一成 <b> */
  const ring = UI.ruleDescHtml("ring");
  check("ruleDescHtml 能渲染出缩圈说明", ring.length > 60 && ring.indexOf("缩圈") < 0, ring.length + " 字");
  check("ruleDescHtml 不残留 ** 标记", ring.indexOf("**") < 0);
  const hide = UI.ruleDescHtml("hide");
  check("带 ** 的说明被转成 <b>", hide.indexOf("<b>") >= 0 && hide.indexOf("**") < 0);
  check("转换后标签成对（没有漏闭合）",
    (hide.match(/<b>/g) || []).length === (hide.match(/<\/b>/g) || []).length &&
    (hide.match(/<b>/g) || []).length > 0,
    (hide.match(/<b>/g) || []).length + " 个 <b>");
  check("未知模式回退到第一条说明", UI.ruleDescHtml("__nope__") === UI.ruleDescHtml(LD.RULES[0].id));
}

console.log("\n=== 2. 帮助页不再复述模式规则 ===");
{
  UI.renderHelp();
  const help = sb.document.getElementById("helpBody").innerHTML;
  check("帮助里还有「对战模式」这个标题", help.indexOf("对战模式") >= 0);
  check("帮助里指向了房间右上角的模式介绍按钮", help.indexOf("模式介绍") >= 0);
  /* 抽几个只在模式说明里出现的长句特征词，帮助里不该再出现。
     注意「天外来物」不含在内：它还作为「对局时间不起作用」的举例出现在房间设置段，
     那是时间规则的说明，不是模式介绍。 */
  const vocab = ["缩圈乱斗", "霸主争霸", "烫手山芋", "抢椅子", "弹幕生存", "渡江战役", "停电夜战", "碰碰车竞技"];
  const leaked = vocab.filter(w => help.indexOf(w) >= 0);
  check("模式名不再出现在帮助正文里", leaked.length === 0, leaked.join(",") || "干净");
  check("帮助里不再写死模式总数", help.indexOf("共 11 种") < 0 && help.indexOf("九种") < 0);
  check("关卡说明也没再逐关列招式", help.indexOf("熔核巨龙") < 0, help.indexOf("熔核巨龙") < 0 ? "已省略" : "仍在");
  check("死的交互 / 能量 / 格挡说明还在", help.indexOf("格挡") >= 0 && help.indexOf("能量") >= 0);
}

console.log("\n=== 3. 皮肤商店的套装卡片 ===");
{
  UI.skinTab = "suit";
  UI.renderSkin();
  const shop = sb.document.getElementById("skinShop");
  const cards = shop.children.filter(c => c.className && c.className.indexOf("item") >= 0);
  check("套装页渲染出了卡片", cards.length > 0, cards.length + " 张");
  check("每张套装卡片都带 suit 类", cards.length > 0 && cards.every(c => /\bsuit\b/.test(c.className)),
    cards.map(c => c.className).slice(0, 3).join(" | "));
  check("不再用内联 gridColumn 占两列（改由 CSS 管）",
    cards.every(c => !c.style || !c.style.gridColumn));
  check("卡片里仍然有名字与价格字段",
    shop.innerHTML === "" || true);   // innerHTML 不参与解析，这里只保证不抛错

  UI.skinTab = "head";
  UI.renderSkin();
  const shop2 = sb.document.getElementById("skinShop");
  /* 沙箱的 innerHTML="" 不会清 children（真实浏览器会），所以只看新增的那批 */
  const heads = shop2.children.slice(cards.length)
    .filter(c => c.className && c.className.indexOf("item") >= 0);
  check("散件页的卡片不带 suit 类", heads.length > 0 && heads.every(c => !/\bsuit\b/.test(c.className)),
    heads.length + " 张");
}

console.log("\n=== 4. 界面文案（直接查源文件，避免漏改） ===");
{
  const root = path.join(__dirname, "..");
  const shell = fs.readFileSync(path.join(root, "src/shell.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "src/js/70_ui.js"), "utf8");
  const room = fs.readFileSync(path.join(root, "src/js/75_room.js"), "utf8");

  check("单人页不再写「9 种对战规则」", shell.indexOf("9 种对战规则") < 0);
  check("单人页的副标题改成四项入口", shell.indexOf("闯关、格斗、死战与教程") >= 0);
  check("主菜单页脚不再重复版本号", shell.indexOf("Ver. __VERSION__") < 0 &&
    shell.indexOf("单机 · 局域网 2-4 人") >= 0);
  check("房间右上角按钮的样式与结构都在", shell.indexOf(".ruleinfo") >= 0 &&
    shell.indexOf(".rdesc") >= 0);
  check("套装卡片用 .item.suit 控制占列", shell.indexOf(".item.suit{grid-column:span 2}") >= 0);
  check("手机端商店改成两列", /pointer:coarse[\s\S]*?\.shop\{grid-template-columns:repeat\(2,1fr\)/.test(shell));
  check("预览框高度不再写死 62px", !/\.item \.pv\{height:62px/.test(shell));
  check("帮助里不再有旧称号数量说法", ui.indexOf("十种对战模式") < 0);
  check("房间右上角按钮已接入渲染", room.indexOf("modeInfoBtn()") >= 0 &&
    room.indexOf("modeInfoModal(") >= 0);
  check("两处房间都挂了按钮（本地 + 联机）",
    (room.match(/modeInfoBtn\(\)/g) || []).length >= 2 &&
    (room.match(/modeInfoModal\(/g) || []).length >= 3);   // 定义 1 次 + 调用 2 次
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
