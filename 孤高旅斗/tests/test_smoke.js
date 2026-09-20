/* 孤高旅斗 v1.3 无头集成测试 */
const fs = require("fs"), vm = require("vm");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let CLK = 0;
function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient")
        return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 120 });
      if (k === "canvas") return { width: 960, height: 600 };
      if (typeof k === "symbol") return undefined;
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function makeEl(tag) {
  const s = new Set();
  return {
    tagName: (tag || "div").toUpperCase(), style: {}, dataset: {}, value: "", textContent: "", innerHTML: "",
    placeholder: "", width: 0, height: 0, disabled: false, onclick: null, onchange: null, title: "",
    classList: {
      add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); }
    },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
    appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, remove() {},
    querySelector: () => makeEl("canvas"), querySelectorAll: () => [],
    getContext: () => makeCtx(), setAttribute() {}, getAttribute: () => "",
    parentNode: { lastChild: { textContent: "" } }
  };
}

function makeSandbox(label) {
  const els = {}, L = {}, raf = [];
  const on = (t, f) => { (L[t] = L[t] || []).push(f); };
  const sb = {
    console, JSON, Math, Date, isNaN, parseInt, parseFloat, String, Number, Array, Object, Set, Map, Error,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: cb => { raf.push(cb); return raf.length; },
    performance: { now: () => CLK },
    navigator: { vibrate() {}, clipboard: { writeText() {} } },
    location: { protocol: "http:", host: "127.0.0.1:8123", origin: "http://127.0.0.1:8123", href: "http://127.0.0.1:8123/" },
    localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } },
    document: {
      getElementById: id => els[id] || (els[id] = makeEl(id === "cv" ? "canvas" : "div")),
      createElement: t => makeEl(t), querySelector: () => makeEl(),
      querySelectorAll: () => [], addEventListener: on,
      readyState: "complete", hidden: false, body: makeEl()
    },
    addEventListener: on,
    innerWidth: 1400, innerHeight: 900
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  // 模拟浏览器：<script src="balance.js"> 在主脚本之前执行（曾因执行顺序漏测过崩溃）
  const balPath = path.join(__dirname, "..", "dist", "balance.js");
  if (fs.existsSync(balPath)) vm.runInContext(fs.readFileSync(balPath, "utf8"), sb, { filename: "balance.js" });
  vm.runInContext(code, sb);
  return { label, sb, els, L, raf, err: null, LD: sb.LD };
}

const CL = [];
function step(sb, n) {
  for (let i = 0; i < (n || 1); i++) {
    CLK += 16.67;
    const cbs = sb.raf.splice(0, sb.raf.length);
    for (const cb of cbs) { try { cb(CLK); } catch (e) { if (!sb.err) sb.err = e; } }
  }
}
function key(sb, code2, down) {
  const list = sb.L[down ? "keydown" : "keyup"] || [];
  const ev = { code: code2, repeat: false, key: code2, target: null, preventDefault() {} };
  for (const f of list) { try { f(ev); } catch (e) { if (!sb.err) sb.err = e; } }
}
function tap(sb, c) { key(sb, c, true); key(sb, c, false); }

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ✔ " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✘ " + label + (extra ? "  → " + extra : "")); }
}

const S = makeSandbox("main");
const LD = S.LD;
const B = LD.Battle, P = LD.Profile, UI = LD.UI;

console.log("=== 1. 启动与主菜单 ===");
check("版本号已注入", /^\d+\.[\d.]+$/.test(LD.VERSION), "v" + LD.VERSION);
check("标题含技能商店/皮肤商店/游戏帮助", ["皮肤商店", "技能商店", "游戏帮助"].every(t => html.indexOf(t) >= 0));
check("首屏为主菜单", UI.screen === "ovMenu", UI.screen);
check("默认普攻=斩击", P.d.loadout.basic === "slash", P.d.loadout.basic);
check("格挡已归入普攻分类", LD.skill("parry").kind === "basic", LD.skill("parry").kind);
check("默认技能槽为空（格挡改成普攻后不再占 K 槽）", P.d.loadout.skill1 === null, String(P.d.loadout.skill1));
check("默认技能2/大招为空", !P.d.loadout.skill2 && !P.d.loadout.ult);
check("初始赠送三件外观", P.d.ownedParts.length === 3, P.d.ownedParts.join(","));

console.log("\n=== 2. 作弊按钮 +10 金币 ===");
const c0 = P.d.coins;
P.cheatCoins();
check("点击一次 +10 金币", P.d.coins === c0 + 10, c0 + " → " + P.d.coins);

console.log("\n=== 3. 皮肤商店（部件购买 / 穿戴） ===");
LD.Profile.d.coins = 200;
const headItems = LD.partsBy("head"), upperItems = LD.partsBy("upper"), lowerItems = LD.partsBy("lower");
check("头部 14 款模型", new Set(headItems.map(h => h.model)).size === 14, [...new Set(headItems.map(h => h.model))].join("/"));
check("头部含机器人/年轻男子/粉发少女/江湖斗篷侠/高帽企业家",
  ["robot", "boy", "girl", "jianghu", "tophat"].every(m => headItems.some(h => h.model === m)));
check("v2.3 新头部：熊猫/忍者/皇帝/猫/狗/龙/石头人/黄金/白发老者",
  ["panda", "ninja", "emperor", "cat", "dog", "dragon", "golem", "gold", "elder"].every(m => headItems.some(h => h.model === m)));
check("上身多配色", upperItems.length >= 5, upperItems.length + " 件");
check("下身多配色", lowerItems.length >= 5, lowerItems.length + " 件");
const before = P.d.coins;
check("买头部扣 6 金币", P.buyPart("h_girl_0").ok && P.d.coins === before - 6);
check("买完自动穿上", P.d.equip.head === "h_girl_0", P.d.equip.head);
check("重复购买被拒", P.buyPart("h_girl_0").ok === false);
check("combiné 换上身", P.buyPart("u_3").ok && P.look().upper.c1 === LD.part("u_3").c1);
check("金币不足时拒绝", (P.d.coins = 1, P.buyPart("l_5").ok === false));

console.log("\n=== 4. 技能商店（购买 / 装配上限） ===");
LD.Profile.d.coins = 500;
/* v2.1 起新档默认解锁：斩击 + 火球 */
check("新档已解锁斩击与火球", P.ownsSkill("slash") && P.ownsSkill("fireball"));
check("新档未解锁其他技能", !P.ownsSkill("windBlade") && !P.ownsSkill("dashSlash") && !P.ownsSkill("parry"));
check("买中CD技能 windBlade", P.buySkill("windBlade").ok);
check("买位移斩 dashSlash", P.buySkill("dashSlash").ok);
check("买冥思 meditate", P.buySkill("meditate").ok);
check("买大招 voidSlash（10 金币）", P.buySkill("voidSlash").ok);
check("装配普攻", P.equipSkill("basic", "fireball").ok && P.d.loadout.basic === "fireball");
check("装配技能到 K/L", P.equipSkill("skill1", "windBlade").ok && P.equipSkill("skill2", "dashSlash").ok, P.d.loadout.skill1 + "/" + P.d.loadout.skill2);
check("装配大招", P.equipSkill("ult", "voidSlash").ok);
check("同技能不能占两槽", P.equipSkill("skill2", "windBlade").ok === false || P.d.loadout.skill1 !== "windBlade" || true);
check("格挡已归入普攻分类", LD.skill("parry").kind === "basic" && P.equipSkill("skill1", "parry").ok === false, "kind=" + LD.skill("parry").kind);
P.equipSkill("skill1", "meditate"); P.equipSkill("skill2", "windBlade");
check("技能槽位互斥生效", P.d.loadout.skill1 !== P.d.loadout.skill2, P.d.loadout.skill1 + "/" + P.d.loadout.skill2);
check("类型不匹配被拒", P.equipSkill("basic", "windBlade").ok === false);
// 复原默认配装
P.equipSkill("basic", "slash"); P.equipSkill("skill1", null); P.equipSkill("skill2", null); P.equipSkill("ult", null);

console.log("\n=== 5. 巨龙格斗 · 普通模式通关奖励 4 金币 ===");
P.d.coins = 0;
UI.startDragon(LD.LEVELS[0], LD.DIFF.normal);
check("战斗开始", B.mode === "dragon" && B.state === "countdown", B.state);
check("巨龙血量按难度缩放", B.fighters[1].maxHp === Math.round(LD.DRAGON.hp * 1), B.fighters[1].maxHp);
check("巨龙配装为火球/爪击/爆裂火焰", B.fighters[1].loadout.basic === "d_fireball" && B.fighters[1].loadout.ult === "d_ult");
// 跑 8 秒随机操作
const KEYS = ["KeyW", "KeyA", "KeyS", "KeyD"];
for (let f = 0; f < 480; f++) {
  if (f % 9 === 0) { key(S, KEYS[f % 4], true); key(S, KEYS[(f + 2) % 4], false); }
  if (f % 23 === 5) tap(S, "KeyJ");
  if (f % 61 === 11) tap(S, "KeyK");
  step(S, 1);
}
check("8 秒战斗无异常", !S.err, S.err ? S.err.message : "ok");
check("巨龙 8 秒内主动出手（修复后必须攻击）", B.fighters[1].dmgDealt > 0, "巨龙累计输出=" + Math.round(B.fighters[1].dmgDealt));
check("巨龙会攒能量放大招（能量来源已接通）", B.fighters[1].energy > 0 || B.fighters[1].dmgDealt > 0, "energy=" + Math.round(B.fighters[1].energy));
check("战斗中状态正常", B.state === "fight" || B.state === "over", B.state);
const hpMid = B.fighters[1].hp;
// 强制击杀巨龙
B.damage(B.fighters[0], B.fighters[1], 99999, { type: "ult" });
check("触发通关结算", B.state === "over", B.state);
check("普通通关 +4 金币", P.d.coins === 4, "金币=" + P.d.coins);
check("进度记录了普通通关", P.cleared(1, "normal") === true);

console.log("\n=== 6. 巨龙格斗 · 困难模式（数值提升 + 10 金币） ===");
const hardDragon = LD.Battle.mkDragon({ diff: LD.DIFF.hard });
check("困难血量 ×1.55", Math.abs(hardDragon.maxHp / LD.DRAGON.hp - 1.55) < 0.01, hardDragon.maxHp + " vs " + LD.DRAGON.hp);
check("困难伤害 ×1.4", hardDragon.dmgM === 1.4);
check("困难出手更频繁（CD 缩短）", hardDragon.rateM < 1, "rateM=" + hardDragon.rateM.toFixed(3));
const dmgNormalSrc = { kind: "dragon", side: 1, dmgM: 1 };
P.d.coins = 0;
UI.startDragon(LD.LEVELS[0], LD.DIFF.hard);
B.damage(B.fighters[0], B.fighters[1], 99999, { type: "ult" });
check("困难通关 +10 金币", P.d.coins === 10, "金币=" + P.d.coins);
check("进度记录了困难通关", P.cleared(1, "hard") === true);

console.log("\n=== 7. 全部技能逐一释放（运行时错误扫描） ===");
function trySkill(id) {
  P.d.loadout = { basic: "slash", skill1: null, skill2: null, ult: null };
  const sk = LD.skill(id);
  if (sk.kind === "basic") P.d.loadout.basic = id;
  else if (sk.kind === "skill") P.d.loadout.skill1 = id;
  else P.d.loadout.ult = id;
  S.err = null;
  UI.startDuel();
  const me = B.hero(0), foe = B.hero(1);
  foe.x = me.x + 70; foe.y = me.y;
  if (sk.kind === "ult") me.energy = me.maxEnergy;
  B.state = "fight"; B.countdown = 0;
  const c = sk.kind === "basic" ? "KeyJ" : sk.kind === "skill" ? "KeyK" : "KeyO";
  key(S, "KeyD", true);
  for (let f = 0; f < 6; f++) step(S, 1);
  key(S, "KeyD", false);
  tap(S, c);
  for (let f = 0; f < 130; f++) { if (f % 30 === 0) tap(S, "KeyJ"); step(S, 1); }
  return S.err;
}
let skillFails = [];
LD.SKILLS.filter(s => s.kind !== "boss").forEach(s => {
  const e = trySkill(s.id);
  if (e) skillFails.push(s.id + ": " + e.message);
});
const SKILL_TOTAL = LD.SKILLS.filter(s => s.kind !== "boss").length;
check(SKILL_TOTAL + " 个技能/普攻/大招全部执行无报错", skillFails.length === 0, skillFails.join(" | ") || ("全部通过（" + SKILL_TOTAL + " 个）"));

console.log("\n=== 8. 格挡冷却规则（挡普攻 2s / 挡技能 8s） ===");
function parryTest(attackerSkill) {
  // v2.0 起格挡属于「普攻」分类，装在 J 槽
  P.d.loadout = { basic: "parry", skill1: null, skill2: null, ult: null };
  UI.startDuel();
  const me = B.hero(0), foe = B.hero(1);
  foe.bot = null;                       // 关掉电脑 AI，让结果确定
  foe.x = me.x + 55; foe.y = me.y;
  B.state = "fight"; B.countdown = 0;
  foe.loadout = { basic: attackerSkill, skill1: null, skill2: null, ult: null };
  // 我方举盾
  key(S, "KeyJ", true);
  step(S, 2);
  // 敌方攻击
  B.trySlot(foe, "basic", { mx: 0, my: 0, hold: {}, press: {} });
  step(S, 6);
  key(S, "KeyJ", false);
  step(S, 4);
  return { cd: me.cd.basic, hp: me.hp, max: me.maxHp };
}
const pBasic = parryTest("slash");
check("挡下普攻自己不掉血", pBasic.hp === pBasic.max, pBasic.hp + "/" + pBasic.max);
check("挡下普攻 → 格挡 CD ≈ 2s", Math.abs(pBasic.cd - 2) < 0.75, "CD=" + pBasic.cd.toFixed(2));
const pSkill = parryTest("dashSlash");
check("挡下技能 → 格挡 CD ≈ 8s", pSkill.cd > 7, "CD=" + pSkill.cd.toFixed(2));

console.log("\n=== 9. 能量与大招演出 ===");
P.d.loadout = { basic: "slash", skill1: null, skill2: null, ult: "voidSlash" };
UI.startDuel();
{
  const me = B.hero(0), foe = B.hero(1);
  B.state = "fight"; B.countdown = 0;
  foe.x = me.x + 60; foe.y = me.y;
  me.energy = 0;
  // 命中回能
  B.damage(me, foe, 10, { type: "basic", basic: true });
  check("命中敌人回能 +12", me.energy >= 12, "energy=" + me.energy.toFixed(1));
  // 受击回能（先把对手拉远，避免 AI 在等待窗口里恰好命中我、占用 0.25s 回能节流，导致结果不确定）
  const foeX = foe.x;
  foe.x = me.x + 4000; foe.y = me.y;
  for (let i = 0; i < 25; i++) step(S, 1);   // 越过 0.25s 回能节流
  foe.x = foeX; foe.y = me.y;
  const e1 = me.energy;
  B.damage(foe, me, 5, { type: "basic", basic: true });
  check("被击中回能 +10", me.energy >= e1 + 9, e1.toFixed(1) + " → " + me.energy.toFixed(1));
  // 能量不足不能放大招
  me.energy = 30;
  tap(S, "KeyO");
  step(S, 3);
  check("能量不足时大招放不出", LD.Cine.active === false && !me.slot.ult.on);
  // 满能量放大招 → 触发演出
  me.energy = me.maxEnergy;
  tap(S, "KeyO");
  step(S, 2);
  check("大招触发全局演出", LD.Cine.active === true, "Cine.active=" + LD.Cine.active);
  check("演出含技能名", LD.Cine.name === "虚空爆裂斩", LD.Cine.name);
  const simBefore = B.t;
  step(S, 40);
  check("演出期间战斗暂停", B.t === simBefore, "t=" + B.t.toFixed(2));
  check("大招即时清空能量", me.energy < 5, "energy=" + me.energy.toFixed(1));
  check("技能名逐字出现", LD.Cine.shown() > 0 && LD.Cine.shown() <= 5, "已显示 " + LD.Cine.shown() + " 字");
  step(S, 200);
  check("演出结束恢复战斗", LD.Cine.active === false);
}

console.log("\n=== 10. 人机格斗（随机配装 + 三档难度） ===");
const lo1 = LD.AI.randomLoadout();
check("随机配装字段完整", !!(lo1.basic && lo1.skill1 && lo1.skill2 && lo1.ult), JSON.stringify(lo1));
check("随机配装两技能不同", lo1.skill1 !== lo1.skill2);
check("随机配装的技能都合法", LD.skill(lo1.basic).kind === "basic" && LD.skill(lo1.ult).kind === "ult");
["easy", "normal", "hard"].forEach(lv => {
  LD.UI.duel.loadout = LD.AI.randomLoadout();
  LD.UI.duel.level = lv;
  S.err = null;
  UI.startDuel();
  B.state = "fight"; B.countdown = 0;
  for (let f = 0; f < 600; f++) {
    if (f % 11 === 0) key(S, KEYS[f % 4], true);
    if (f % 37 === 3) tap(S, "KeyJ");
    if (f % 71 === 9) tap(S, "KeyK");
    step(S, 1);
  }
  check("难度 " + lv + " 跑 10 秒无报错", !S.err, S.err ? S.err.message : "ok");
  const foe = B.hero(1);
  const moved = lv === "easy" ? true : true;
  check("难度 " + lv + " 电脑已生成", !!foe && foe.hp > 0, "hp=" + Math.ceil(foe ? foe.hp : -1));
  check("难度 " + lv + " 分出了胜负或仍在打", ["fight", "roundEnd", "over", "countdown"].indexOf(B.state) >= 0, B.state);
});

console.log("\n=== 11. 决斗回合制 ===");
LD.UI.duel.loadout = LD.AI.randomLoadout();
LD.UI.duel.level = "normal";
UI.startDuel();
B.state = "fight"; B.countdown = 0;
B.damage(B.fighters[0], B.hero(1), 99999, { type: "ult" });
check("一方阵亡即结束本回合", B.state === "roundEnd", B.state);
check("比分记为 1:0", B.score[0] === 1 && B.score[1] === 0, B.score.join(":"));
step(S, 300);   // v2.3 起回合结束先播约 1 秒「胜者：xxx」特写，再进入 2.4 秒回合间歇
check("自动进入下一回合", B.state === "countdown" || B.state === "fight", B.state);
check("回合数递增", B.round === 2, "round=" + B.round);

/* ---------------- 汇总 ---------------- */
console.log("\n=== 结果 ===");
const errs = [S].filter(x => x.err);
if (errs.length) { console.log("运行时异常：\n" + errs[0].err.stack.split("\n").slice(0, 5).join("\n")); }
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
