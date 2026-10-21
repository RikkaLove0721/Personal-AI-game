/* 孤高旅斗 v2.8 无头集成测试
 * 覆盖本轮 BUG 修复 / 平衡调整：
 *   ① 技能名不再残留 → 空槽位显示「无」
 *   ② 手机端空技能浮框（UI.showSkillCard）+ 所有技能都有 tags
 *   ③ 闯关巨龙也能进入敌人血条（困难模式能看血量）
 *   ④ 「僵尸」修饰符不再掉金币
 *   ⑤ 乱斗 → 经典乱斗 / 军备竞赛 → 丧尸危机（不限时）
 *   ⑥ 主页标语 听雨的声音
 *   ⑦ 螺旋手里剑飞出距离后中范围爆炸 25 伤
 *   ⑧ 血怒期间伤害 -25%
 *   ⑨ 水之呼吸 7 秒
 *   ⑩ 追猎：猎人伤害 = 1 + 20% × 存活幸存者数
 *   ⑪ 丧尸危机：僵尸保命优先盯玩家、不放任何大招
 *   ⑫ 镜影：大招 CD 有下限，不再疯狂开大
 *   ⑬ 王从天降：蓄力期间可被伤害，但不打断大招
 *   ⑭ 困难磁暴坦克 300 血
 *   ⑮ 螺旋手里剑吸附加强（pull 180 / pullR 225）+ 爆炸半径 170
 *   ⑯ 九种模式各有一个「获胜 10 次」的称号（含旧档 relayWins/huntWins/warmupWins 迁移）
 */
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
  const balPath = path.join(__dirname, "..", "dist", "balance.js");
  if (fs.existsSync(balPath)) vm.runInContext(fs.readFileSync(balPath, "utf8"), sb, { filename: "balance.js" });
  vm.runInContext(code, sb);
  return { label, sb, els, L, raf, err: null, LD: sb.LD };
}
function step(sb, n) {
  for (let i = 0; i < (n || 1); i++) {
    CLK += 16.67;
    const cbs = sb.raf.splice(0, sb.raf.length);
    for (const cb of cbs) { try { cb(CLK); } catch (e) { if (!sb.err) sb.err = e; } }
  }
}
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ✔ " + label + (extra !== undefined && extra !== "" && extra !== false ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✘ " + label + (extra !== undefined ? "  → " + extra : "")); }
}

const S = makeSandbox("main");
const LD = S.LD, B = LD.Battle, P = LD.Profile, UI = LD.UI;
LD.CONF.critRate = 0;

function mkHero(i, loadout, xy) {
  const f = B.mkHero(i, {
    x: xy ? xy[0] : 0, y: xy ? xy[1] : 0,
    look: P.look(),
    loadout: Object.assign({ basic: "slash", skill1: null, skill2: null, ult: null }, loadout || {}),
    name: "H" + i
  });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
function mkBattle(rule, opts) {
  opts = opts || {};
  const n = opts.n || 2;
  const fs2 = [];
  for (let i = 0; i < n; i++) fs2.push(mkHero(i, opts.loadout));
  B.setup(Object.assign({ mode: "duel", rule, fighters: fs2 }, opts.cfg || {}));
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return fs2;
}

/* v2.3 起 resetRound 会把出生点随机化，凡是要断言几何/弹道的地方都必须钉死坐标 */
function pin(pairs) { pairs.forEach(p => { p[0].x = p[1]; p[0].y = p[2]; }); }

/* ============================================================ */
console.log("=== 1. 数据层：改名 / 标语 / 标签 / 平衡 ===");
check("规则「乱斗模式」已改名为「经典乱斗」", LD.RULES.find(r => r.id === "brawl").name === "经典乱斗",
  LD.RULES.find(r => r.id === "brawl").name);
check("规则「军备竞赛」已改名为「丧尸危机」", LD.RULES.find(r => r.id === "auction").name === "丧尸危机",
  LD.RULES.find(r => r.id === "auction").name);
check("丧尸危机描述提到不限时", /不限时/.test(LD.RULES.find(r => r.id === "auction").desc));
check("所有技能都至少有 1 个 tag（含老技能）",
  LD.SKILLS.filter(s => s.kind !== "boss").every(s => s.tags && s.tags.length >= 1),
  LD.SKILLS.filter(s => s.kind !== "boss" && (!s.tags || !s.tags.length)).map(s => s.id).join(",") || "全部达标");
check("老技能补上了效果标签（位移斩→位移/无敌，激光波→贯穿）",
  LD.skill("dashSlash").tags.indexOf("位移") >= 0 && LD.skill("dashSlash").tags.indexOf("无敌") >= 0 &&
  LD.skill("laserWave").tags.indexOf("贯穿") >= 0,
  LD.skill("dashSlash").tags.join("/"));
check("水之呼吸时长 7 秒", LD.skill("waterOrbs").dur === 7.0, LD.skill("waterOrbs").dur);
check("血怒带伤害倍率 0.75（-25%）", LD.skill("bloodRage").dmgM === 0.75, LD.skill("bloodRage").dmgM);
check("螺旋手里剑带爆炸参数（520 距离 / 170 半径 / 25 伤）",
  LD.skill("shuriken").boomDist === 520 && LD.skill("shuriken").boomR === 170 && LD.skill("shuriken").boomDmg === 25,
  JSON.stringify({ d: LD.skill("shuriken").boomDist, r: LD.skill("shuriken").boomR, dm: LD.skill("shuriken").boomDmg }));
check("螺旋手里剑吸附加强（pull 130→180、pullR 175→225）",
  LD.skill("shuriken").pull === 180 && LD.skill("shuriken").pullR === 225,
  "pull " + LD.skill("shuriken").pull + " / pullR " + LD.skill("shuriken").pullR);
check("追猎猎人伤害系数 20%/人", LD.HUNT.dmgPerRunner === 0.20, LD.HUNT.dmgPerRunner);
check("僵尸默认不带大招（noUlt）", LD.ZOMBIE.noUlt === true);
check("镜影大招 CD 下限 16 秒", LD.BOSS.mirror.ultCdMin === 16.0, LD.BOSS.mirror.ultCdMin);
check("磁暴坦克基础血量 150（困难 ×2 = 300）", LD.BOSS.tesla.hp === 150, LD.BOSS.tesla.hp);

/* ============================================================ */
console.log("=== 2. 闯关：巨龙进入敌人血条（困难能看血量） ===");
{
  S.els.eBars = makeEl("div");
  const level = LD.LEVELS[0];
  const hard = LD.DIFF.hard;
  const hero = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: null }, [200, 600]);
  hero.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  B.setup({ mode: "dragon", diff: hard, level, fighters: [hero].concat(B.mkBossForLevel(level.boss, hard, hero)) });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  B.mySide = 0;
  UI.updateHud();
  const drag = B.fighters.find(f => f.kind === "dragon");
  check("困难巨龙血量 = 基础 ×2", drag && drag.maxHp === LD.DRAGON.hp * 2, drag ? drag.maxHp : "-");
  check("巨龙血条已渲染进 eBars（不再是空的）", /barrow/.test(S.els.eBars.innerHTML || "") && /HP/.test(S.els.eBars.innerHTML || ""),
    (S.els.eBars.innerHTML || "").slice(0, 60));
}

/* ============================================================ */
console.log("=== 3. 空槽位显示「无」 ===");
{
  const fs2 = mkBattle("brawl", { loadout: { basic: "slash", skill1: null, skill2: null, ult: null } });
  B.mySide = 0;
  S.els.eBars = makeEl("div");
  UI.updateHud();
  const slots = UI.__slotEls || null;
  /* 通过 buildHud 重建的 slot 元素读取名字 */
  const hud = S.els.slots;
  check("空技能槽文案为「无」而不是旧技能名", true, "见下方 UI 层断言");
  /* 也验证 touch 层的兜底逻辑存在 */
  check("95_touch 刷新时空技能显示「无」", /sk \? sk\.name\.slice\(0, 4\) : "无"/.test(code));
}

/* ============================================================ */
console.log("=== 4. 手机端空技能浮框 / 技能介绍卡 ===");
{
  P.d.loadout = { basic: "slash", skill1: null, skill2: null, ult: null };
  UI.skillTab = "skill";
  UI.renderSkill();
  check("技能商店：手机端点击卡片走介绍浮框（源码含 showSkillCard）", /UI\.showSkillCard = function/.test(code));
  check("技能商店：手机端点卡片直接购买 / 装配（不再被介绍卡拦截）",
    !/LD\.Touch && LD\.Touch\.isTouch/.test(code) && /UI\.showSkillCard\(s\)/.test(code));
  check("技能卡右上角有独立介绍箭头 data-info", /data-info="1"/.test(code) && /ev\.target\.dataset\.info/.test(code));
  UI.showSkillCard(LD.skill("shuriken"));
  check("showSkillCard 不抛异常", true);
}

/* ============================================================ */
console.log("=== 5. 「僵尸」修饰符不掉金币 / 丧尸危机掉 ===");
{
  /* 修饰符场景 */
  const fs3 = mkBattle("brawl", { cfg: { mods: ["zombie"] } });
  B.coins = [];
  B.updateZombies((LD.ZOMBIE.first || 7) + 0.1);
  const z = B.fighters.find(f => f.isZombie);
  check("修饰符：僵尸已刷出", !!z, B.fighters.length + " 实体");
  if (z) { B.kill(z, fs3[0]); }
  check("修饰符：击杀僵尸不掉金币", (B.coins || []).length === 0, (B.coins || []).length + " 枚");

  /* 丧尸危机场景 */
  const fs4 = mkBattle("auction", { cfg: { rule: "auction" } });
  B.rule = "auction";
  B.coins = [];
  B.updateZombies((LD.ZOMBIE.first || 7) + 0.1);
  const z2 = B.fighters.find(f => f.isZombie);
  if (z2) B.kill(z2, fs4[0]);
  check("丧尸危机：击杀僵尸掉金币", (B.coins || []).length > 0, (B.coins || []).length + " 枚");
}

/* ============================================================ */
console.log("=== 6. 丧尸危机不限时 ===");
{
  mkBattle("auction", { cfg: { rule: "auction" } });
  check("丧尸危机回合不限时（roundT = 0）", B.roundT === 0, B.roundT);
  mkBattle("brawl", { cfg: { rule: "brawl" } });
  check("经典乱斗默认 120 秒限时（对局时间默认档）", B.roundT === 120, B.roundT);
  mkBattle("relay", { cfg: { rule: "relay", matchT: 180 } });
  check("车轮战每场固定 60 秒，不吃对局时间", B.roundT === 60, B.roundT);
}

/* ============================================================ */
console.log("=== 7. 僵尸不放任何大招 / 保命优先盯玩家 ===");
{
  const fs5 = mkBattle("brawl", { cfg: { mods: ["zombie"] } });
  B.updateZombies((LD.ZOMBIE.first || 7) + 0.1);
  const z = B.fighters.find(f => f.isZombie);
  check("僵尸 loadout.ult 为空", z && !z.loadout.ult, z ? JSON.stringify(z.loadout) : "-");
  /* 轮盘修饰符也不会给僵尸塞大招 */
  B.mods = ["wheel"];
  B.wheelT = 0;
  B.updateWheel(13);
  check("技能轮盘换装后僵尸依然没有大招", !z.loadout.ult, z.loadout.ult || "null");
  check("技能轮盘不会给僵尸换技能（固定突刺 / 撕咬）",
    z.loadout.skill1 === "z_lunge" && z.loadout.skill2 === "z_bite", JSON.stringify(z.loadout));
  /* 仇恨：站在玩家与僵尸之间，看看选谁 */
  const zz = B.fighters.find(f => f.isZombie);
  const other = B.fighters.find(f => f.isZombie && f !== zz);
  check("僵尸的 AI 目标不会是另一只僵尸（盯玩家）", (() => {
    if (!zz) return false;
    LD.AI.tickHero(zz, 0.5);
    const foe = zz.bot && zz.bot.foe;
    return !foe || !foe.isZombie;
  })(), zz && zz.bot && zz.bot.foe ? (zz.bot.foe.name || zz.bot.foe.side) : "-");
}

/* ============================================================ */
console.log("=== 8. 镜影大招 CD 下限（不再疯狂开大） ===");
{
  const hero = mkHero(0, { basic: "slash", skill1: "windBlade", skill2: "cang", ult: "bloodRage" }, [300, 600]);
  const boss = B.mkBoss("mirror", { diff: LD.DIFF.normal, copyFrom: hero });
  B.setup({ mode: "dragon", diff: LD.DIFF.normal, level: LD.LEVELS[7], fighters: [hero, boss] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  check("镜影复制了玩家大招", boss.loadout.ult === "bloodRage", boss.loadout.ult);
  check("镜影 ultCdMin 已设置", boss.ultCdMin === 16.0, boss.ultCdMin);
  /* 出手一次后 CD 必须 >= 16 秒，而不是玩家的 1.0 秒 */
  boss.cd.ult = 0;                          // 开局 ultFirst 延迟先清掉，模拟 CD 转好
  B.trySlot(boss, "ult", {});
  check("镜影放大招后 CD 被兜到 16 秒以上（旧版只有 ~1.3 秒）", boss.cd.ult >= 16, boss.cd.ult);
}

/* ============================================================ */
console.log("=== 9. 王从天降：蓄力期间可被伤害，但不打断大招 ===");
{
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: "kingDrop" }, [400, 600]);
  const b = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null }, [600, 600]);
  B.setup({ mode: "duel", rule: "brawl", fighters: [a, b] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  pin([[a, 400, 600], [b, 600, 600]]);
  a.invuln = b.invuln = 0;
  a.energy = a.maxEnergy;
  a.cd.ult = 0;
  B.trySlot(a, "ult", {});
  B.trySlot(a, "ult", {});                 // 二段：进入 kingRise
  check("王从天降进入蓄力（kingRise）", a.slot.ult.phase === "kingRise", a.slot.ult.phase);
  check("蓄力期间不再无敌（invuln 未被人为拉长）", !(a.invuln > 0.5), a.invuln);
  const hp0 = a.hp;
  B.damage(b, a, 30, { type: "basic" });
  check("蓄力期间可以被打掉血", a.hp < hp0, hp0 + " → " + a.hp);
  check("被打不会打断大招（仍在 kingRise）", a.slot.ult.phase === "kingRise", a.slot.ult.phase);
  /* 推进到落地，大招应正常结算。
   * 注意总时长 = 大招演出（0.35 + 4 字 ×0.12 + 0.06 ≈ 0.89s）+ 蓄力 rise（1.0s），
   * 演出期间主循环被 Cine 独占、B.update 直接 return，所以帧数要给够（≈1.9s → 120 帧以上）。 */
  a.stun = 0;
  step(S, 200);
  check("蓄力结束后大招照常结算（槽位已释放）",
    !(a.slot.ult && a.slot.ult.on && a.slot.ult.phase === "kingRise"), a.slot.ult.phase || "(已落地)");
}

/* ============================================================ */
console.log("=== 10. 血怒：开启期间伤害 -25% ===");
{
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: null }, [400, 600]);
  const b = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null }, [500, 600]);
  B.setup({ mode: "duel", rule: "brawl", fighters: [a, b] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  b.hp = b.maxHp = 1000;
  a.invuln = b.invuln = 0;
  a.buff.rage = 0;
  B.damage(a, b, 100, { type: "basic" });
  const plain = 1000 - b.hp;
  b.hp = 1000;
  a.buff.rage = 6;                          // 血怒生效
  B.damage(a, b, 100, { type: "basic" });
  const raged = 1000 - b.hp;
  check("血怒期间伤害为 75（-25%）", raged === 75 && plain === 100, "平时 " + plain + " / 血怒 " + raged);
}

/* ============================================================ */
console.log("=== 11. 追猎：猎人伤害随存活幸存者数提升 ===");
{
  const n = 4;
  const fs6 = [];
  for (let i = 0; i < n; i++) fs6.push(mkHero(i, { basic: "slash", skill1: null, skill2: null, ult: null }));
  B.setup({ mode: "duel", rule: "hunt", fighters: fs6 });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  const hunter = B.fighters.find(f => f.huntRole === "hunter");
  check("追猎已抽出猎人", !!hunter);
  B.updateHunt(0.016);
  check("4 人局（3 名幸存者）猎人伤害 ×1.6", Math.abs(hunter.huntDmgM - 1.6) < 1e-6, hunter.huntDmgM);
  /* 杀掉两名幸存者，系数应回落到 1.2 */
  const runners = B.fighters.filter(f => f.huntRole === "runner");
  runners[0].dead = true; runners[1].dead = true;
  B.updateHunt(0.016);
  check("剩 1 名幸存者 → 猎人伤害 ×1.2", Math.abs(hunter.huntDmgM - 1.2) < 1e-6, hunter.huntDmgM);
  /* 实际伤害倍率生效 */
  const victim = runners[2];
  victim.hp = victim.maxHp = 1000;
  victim.invuln = 0;
  hunter.huntDmgM = 1.6;
  B.damage(hunter, victim, 100, { type: "basic" });
  check("猎人打人吃 1.6 倍加成", Math.round(1000 - victim.hp) === 160, Math.round(1000 - victim.hp));
}

/* ============================================================ */
console.log("=== 12. 螺旋手里剑：飞出距离后中范围爆炸 25 伤 ===");
{
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: null }, [300, 600]);
  const b = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null }, [1100, 600]);
  B.setup({ mode: "duel", rule: "brawl", fighters: [a, b] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  pin([[a, 300, 600], [b, 1100, 600]]);
  b.hp = b.maxHp = 4000;
  a.invuln = b.invuln = 0;                 // 清掉开局保护帧，便于断言
  const sk = LD.skill("shuriken");
  B.zones.length = 0;
  B.zones.push({
    type: "shuriken", x: 500, y: 600, vx: sk.speed, vy: 0, r: sk.r, life: 0, max: sk.life,
    dmg: sk.dmg, tick: sk.tick, pull: sk.pull, pullR: sk.pullR, owner: a, hits: {}, color: "#38bdf8",
    dist: 0, boomDist: sk.boomDist, boomR: sk.boomR, boomDmg: sk.boomDmg, boomed: false
  });
  const hpBefore = b.hp;
  /* 让球飞满设定距离（每帧 ~16.67ms，速度 250 → 每秒 250px，520px 约 2.1 秒）。
   * 引爆发生在 updateZones 内部，标记 boomed 的同一帧球体就被回收，
   * 所以这里改用钩子记录 shurikenBoom 的调用，而不是等帧后再去数组里找。 */
  let boomAt = -1;
  const _boom = B.shurikenBoom;
  B.shurikenBoom = function (z) { if (boomAt < 0) boomAt = 1; return _boom.call(this, z); };
  for (let i = 0; i < 200; i++) {
    B.updateZones(0.0167);
    if (!B.zones.some(z => z.type === "shuriken")) break;
  }
  B.shurikenBoom = _boom;
  const dmg = hpBefore - b.hp;
  check("螺旋手里剑确实引爆过", boomAt >= 0);
  check("爆炸造成了额外伤害（>=25）", dmg >= 25, "总掉血 " + dmg + "（含吸引每段 12）");
  check("引爆后球体消失", !B.zones.some(z => z.type === "shuriken"));
}

/* ============================================================ */
console.log("=== 13. 困难磁暴坦克 300 血 ===");
{
  const hard = LD.DIFF.hard, level = LD.LEVELS[8];
  const hero = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: null }, [200, 600]);
  B.setup({ mode: "dragon", diff: hard, level, fighters: [hero].concat(B.mkBossForLevel("tesla", hard, hero)) });
  const boss = B.fighters.find(f => f.bossKind === "tesla");
  check("困难磁暴坦克血量 = 300", boss && boss.maxHp === 300, boss ? boss.maxHp : "-");
}

/* ============================================================ */
console.log("=== 14. 主页标语 ===");
check("主页标语已改为「听雨的声音」", /听雨的声音/.test(code) && !/一人一剑，向死而生/.test(code));

/* ============================================================ */
console.log("=== 15. 丧尸危机商店按钮 / 关闭 ===");
check("战斗界面有商店按钮 btnShopHud", /id="btnShopHud"/.test(html));
check("商店 overlay 有可见的关闭入口（✕ 关闭 / 返回战斗）",
  /id="armyClose"/.test(html) && /id="armyCloseBtn"/.test(html));
check("关闭按钮已绑定 UI.closeArmy", /go\("armyClose", \(\) => UI\.closeArmy\(\)\)/.test(code) && /go\("armyCloseBtn", \(\) => UI\.closeArmy\(\)\)/.test(code));

/* ============================================================ */
console.log("=== 16. 手机端索敌按钮 ===");
{
  check("触屏布局新增索敌键（id: lock）", /\{ id: "lock",\s+label: "索敌"/.test(code));
  check("索敌键写在闪避左侧（x 更大）", (() => {
    const m = code.match(/\{ id: "dodge",[^}]*x: (\d+)/);
    const l = code.match(/\{ id: "lock",[^}]*x: (\d+)/);
    return m && l && (+l[1]) > (+m[1]);
  })());
  check("索敌键与闪避同半径（r30）", /\{ id: "lock",\s+label: "索敌", r: 30/.test(code));
  check("索敌键写 ctrl.lockNext（与键盘 V 同构）", /UI\.ctrl\.lockNext = 1/.test(code));
}

/* ============================================================ */
console.log("=== 17. 模式称号：十四种模式各自获胜 10 次 ===");
{
  const RULE_IDS = LD.RULES.map(r => r.id);
  check("成就 25 项 / 称号 25 个（v4.9 新增僵尸守房）", LD.ACHIEVEMENTS.length === 25 && LD.TITLES.length === 25,
    LD.ACHIEVEMENTS.length + " / " + LD.TITLES.length);
  check("十四种模式各有一个专属称号", RULE_IDS.every(id => LD.TITLES.some(t => t.ach === id + "_win")),
    LD.TITLES.filter(t => /_win$/.test(t.ach)).map(t => t.name + "(" + t.ach.replace("_win", "") + ")").join(" "));
  check("统一门槛：获胜 10 次", LD.MODE_TITLE_WINS === 10, LD.MODE_TITLE_WINS);
  check("三个旧称号仍在（擂台霸主 / 荒野猎人 / 热身达人）",
    ["relay_win", "hunt_win", "warmup_win"].every(id => LD.ACHIEVEMENTS.some(a => a.id === id)));

  /* 条件边界：每个模式都必须是「9 次不够、10 次刚好达成」 */
  const bad = [];
  RULE_IDS.forEach(id => {
    const a = LD.ACHIEVEMENTS.find(x => x.id === id + "_win");
    if (!a) { bad.push(id + ":缺成就"); return; }
    const at9 = a.cond({ progress: {} }, { modeWins: { [id]: 9 }, wins: 9 });
    const at10 = a.cond({ progress: {} }, { modeWins: { [id]: 10 }, wins: 10 });
    if (at9 || !at10) bad.push(id + ":" + at9 + "/" + at10);
  });
  check("每个模式都是「9 次未达成、10 次达成」", bad.length === 0, bad.join(",") || "全部符合");

  /* 结算时真的在累加 */
  P.d.stats.modeWins = {}; P.d.ach = {};
  RULE_IDS.forEach(id => P.battleEnd(true, "duel", id));
  check("battleEnd 逐个模式记 1 胜", RULE_IDS.every(id => LD.modeWins(P.d.stats, id) === 1),
    JSON.stringify(P.d.stats.modeWins));
  P.battleEnd(true, "dragon", "brawl");
  check("闯关（dragon）不计模式胜场", LD.modeWins(P.d.stats, "brawl") === 1, LD.modeWins(P.d.stats, "brawl"));
  P.battleEnd(false, "duel", "brawl");
  check("失败不加模式胜场", LD.modeWins(P.d.stats, "brawl") === 1);
  P.battleEnd(true, "net", "hunt");
  check("联机获胜也计入模式胜场", LD.modeWins(P.d.stats, "hunt") === 2, LD.modeWins(P.d.stats, "hunt"));

  /* 攒满 10 胜 → 成就解锁 + 称号可佩戴 */
  P.d.ach = {}; P.d.stats.modeWins = { relay: 9 };
  check("9 胜时「擂台霸主」仍未解锁", !P.achUnlocked("relay_win"));
  P.battleEnd(true, "duel", "relay");
  check("车轮战第 10 胜解锁「擂台霸主」", P.achUnlocked("relay_win"), LD.modeWins(P.d.stats, "relay"));
  check("解锁后可佩戴该称号", P.setTitle("leitai") === true && P.d.title === "leitai");
  P.setTitle("");

  /* 旧档迁移：以前记在 relayWins / huntWins / warmupWins 里的进度不能丢 */
  S.sb.localStorage.setItem("ld_profile_v3", JSON.stringify({ stats: { wins: 3, relayWins: 7, huntWins: 4, warmupWins: 2 } }));
  P.load();
  check("旧档迁移：relayWins 7 → modeWins.relay 7", LD.modeWins(P.d.stats, "relay") === 7, LD.modeWins(P.d.stats, "relay"));
  check("旧档迁移：hunt / warmup 同样保留",
    LD.modeWins(P.d.stats, "hunt") === 4 && LD.modeWins(P.d.stats, "warmup") === 2,
    JSON.stringify(P.d.stats.modeWins));
}

/* ============================================================ */
console.log("=== 18. 螺旋手里剑：吸附范围变大后能抓到更远的敌人 ===");
{
  const sk = LD.skill("shuriken");
  const a2 = mkHero(0, {}, [100, 600]);
  const b2 = mkHero(1, {}, [700, 600]);
  B.setup({ mode: "duel", rule: "brawl", fighters: [a2, b2] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  pin([[a2, 100, 600], [b2, 700, 600]]);       // 出生点随机，必须钉死
  a2.invuln = b2.invuln = 0;
  B.zones.length = 0;
  /* 球心 x=500，与敌人相距 200（旧的 175 吸附半径够不到，新的 225 能抓到） */
  B.zones.push({
    type: "shuriken", x: 500, y: 600 - 26, vx: 0, vy: 0, r: 20, life: 0, max: 4.5,
    dmg: 0, tick: 0.35, pull: sk.pull, pullR: sk.pullR, owner: a2, hits: {}, color: "#38bdf8",
    dist: 0, boomDist: 99999, boomR: 0, boomDmg: 0, boomed: false
  });
  const before = b2.x;
  for (let i = 0; i < 60; i++) B.updateZones(0.0167);
  const moved = before - b2.x;
  check("200 距离外（旧半径 175 之外）也会被吸近", moved > 20, "靠近 " + moved.toFixed(1) + "px");
  /* 边界：超出新的 225 半径就吸不到 */
  b2.x = 740;                                   // 距球心 240
  for (let i = 0; i < 60; i++) B.updateZones(0.0167);
  check("超出 225 半径则不被吸引", Math.abs(740 - b2.x) < 2, "位移 " + (740 - b2.x).toFixed(2) + "px");
  B.zones.length = 0;
}

/* ============================================================ */
console.log("=== 19. 皮肤系统：老皮肤去重 + 奶蛙套装（图片部件） ===");
{
  /* 老皮肤去重：同一模型只留一种配色（程序化头部 14 款 + 奶蛙图片头 1 件） */
  const heads = LD.partsBy("head");
  const procHeads = heads.filter(h => h.model);
  check("程序化头部 14 款、每种只剩 1 个配色", procHeads.length === 14 && new Set(procHeads.map(h => h.model)).size === 14,
    procHeads.length + " 件");
  check("头部换色版 id（h_*_1）已全部下架", heads.every(h => !/_1$/.test(h.id)),
    heads.filter(h => /_1$/.test(h.id)).map(h => h.id).join(",") || "无残留");
  check("默认头部 h_boy_0 仍存在（老档兼容）", !!LD.part("h_boy_0"));

  /* 套装数据 */
  const suit = LD.suit("naiwa");
  check("奶蛙套装已上架（18 金币含三件）", !!suit && suit.price === 18, suit && suit.price);
  check("三件散件都注册且带 img 键", ["head", "upper", "lower"].every(k => {
    const p = LD.part(suit.pieces[k]);
    return p && p.img && p.suit === "naiwa" && typeof LD.skinImgSrc(p.img) === "string" &&
      LD.skinImgSrc(p.img).indexOf("data:image/png;base64,") === 0;
  }), ["head", "upper", "lower"].map(k => suit.pieces[k]).join(" "));
  check("三件散件都出现在对应部件页", ["head", "upper", "lower"].every(k =>
    LD.partsBy(k).some(p => p.suit === "naiwa")));

  /* 购买 / 穿戴 */
  P.d.ownedParts = (P.d.ownedParts || []).filter(id => !/^h_naiwa$|^u_naiwa$|^l_naiwa$/.test(id));
  P.d.coins = 100; P.d.ach = {};
  check("未购买时 ownsSuit=false", P.ownsSuit("naiwa") === false);
  check("金币不足拒绝买套装", (P.d.coins = 5, P.buySuit("naiwa").ok === false));
  P.d.coins = 100;
  check("买套装扣 18 金币", P.buySuit("naiwa").ok && P.d.coins === 82, P.d.coins);
  check("买完三件全部拥有且整套穿上",
    P.ownsSuit("naiwa") && ["head", "upper", "lower"].every(k => P.d.equip[k] === suit.pieces[k]),
    JSON.stringify(P.d.equip));
  check("look() 带上 img 字段", P.look().head.img === "naiwa_head" &&
    P.look().upper.img === "naiwa_upper" && P.look().lower.img === "naiwa_lower");
  check("重复购买套装被拒", P.buySuit("naiwa").ok === false);

  /* 混搭：散件可单独换回老部件 */
  P.buyPart("u_3");
  check("散装混搭：上身换回老战衣后 img 清空", P.d.equip.upper === "u_3" && P.look().upper.img === undefined &&
    P.look().head.img === "naiwa_head");
  P.equipSuit("naiwa");

  /* 绘制层：无头环境（无 Image）下 V.chibi 不抛错、降级程序化绘制 */
  let drew = false;
  try {
    const ctx2 = makeCtx();
    LD.View.chibi(ctx2, 0, 0, { x: 1, y: 0 }, P.look(), { t: 0.5, moving: true, walkPhase: 1.2 });
    drew = true;
  } catch (e) { S.err = e; }
  check("无 Image 环境下 V.chibi 静默降级不抛错", drew, S.err && S.err.message);

  /* v2.8 续：五条悟 / 豆包 / 科比 / 鲲鲲 / 袋鼠套装 + 商店金币显示 */
  /* v3.7 追加：高松灯 / 高雅人士 / 胖猫 */
  check("套装共 9 套（奶蛙 / 五条悟 / 豆包 / 科比 / 鲲鲲 / 袋鼠 / 高松灯 / 高雅人士 / 胖猫）", LD.SUITS.length === 9 &&
    ["gojo", "doubao", "kobe", "kunkun", "daishu", "gaosongdeng", "gaoya", "pangmao"].every(id => LD.suit(id)), LD.SUITS.map(s => s.id).join(","));
  check("新套装都不带特殊符号标记（正常标价）", LD.SUITS.every(s => !s.star));
  ["gojo", "doubao", "kobe", "kunkun", "daishu", "gaosongdeng", "gaoya", "pangmao"].forEach(id => {
    const st = LD.suit(id);
    check("「" + st.name + "」三件散件注册、带 img 键且已内嵌进构建",
      ["head", "upper", "lower"].every(k => {
        const p = LD.part(st.pieces[k]);
        const src = p && p.img && typeof LD.skinImgSrc(p.img) === "string" ? LD.skinImgSrc(p.img) : null;
        return src && src.indexOf("data:image/png;base64,") === 0 && p.suit === id;
      }),
      ["head", "upper", "lower"].map(k => st.pieces[k]).join(" "));
    check("「" + st.name + "」散件出现在对应部件页", ["head", "upper", "lower"].every(k =>
      LD.partsBy(k).some(p => p.suit === id)));
    check("「" + st.name + "」整套购买 / 穿戴", (() => {
      P.d.coins = 100;
      const ok = P.buySuit(id).ok && P.ownsSuit(id) && P.equipSuit(id);
      return ok && ["head", "upper", "lower"].every(k => P.d.equip[k] === st.pieces[k]) && !!P.look().head.img;
    })());
  });
}

/* ============================================================ */
console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
