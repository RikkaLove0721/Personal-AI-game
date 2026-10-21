/* 孤高旅斗 v3.9.1 测试
 * 覆盖：停电夜战（blackout）
 *   1. 模式与数值配置（地图 1.5 倍 / 光锥 80% / 公共光直径两格）
 *   2. 开局：撒充电站 + 只换两个技能槽（普攻保留、禁用大招）
 *   3. 手电筒：开关、耗电、没电自动关
 *   4. 受光判定：自己开灯 / 充电站 / 别人的光锥（本模式没有能量包）
 *   5. 黑暗条：摸黑每秒 +1、满 15 后每秒 20 血（不顿帧不打断）、受光每秒 -3
 *   6. 充电站交互：靠近起手、蓄力 1.6 秒充满、走远识别不到
 *   7. 交互键接管：没有可交互目标时 P = 手电筒开关
 *   8. 手里剑（装在 L 槽）：蓄力 0.7 秒定身、26 伤害 + 0.6 秒失明、命中即消失
 *   9. 摸黑隐匿：进公共光解除
 *  10. 本模式不产能量包
 *  11. 渲染层不崩（黑幕离屏挖洞 / 充电站绘制 / HUD 两条）
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
      if (k === "createPattern") return () => ({});
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
    placeholder: "", width: 0, height: 0, disabled: false, onclick: null, onchange: null, oninput: null, title: "",
    classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); } },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
    appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, remove() {},
    querySelector: () => makeEl("canvas"), querySelectorAll: () => [],
    getContext: () => makeCtx(), setAttribute() {}, getAttribute: () => "",
    parentNode: { lastChild: { textContent: "" } }
  };
}
function makeSandbox() {
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
    addEventListener: on, innerWidth: 1400, innerHeight: 900
  };
  sb.window = sb; sb.globalThis = sb; sb.__L = L;
  vm.createContext(sb);
  const balPath = path.join(__dirname, "..", "dist", "balance.js");
  if (fs.existsSync(balPath)) vm.runInContext(fs.readFileSync(balPath, "utf8"), sb, { filename: "balance.js" });
  vm.runInContext(code, sb);
  return sb;
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ✔ " + label + (extra !== undefined && extra !== "" && extra !== false ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✘ " + label + (extra !== undefined ? "  → " + extra : "")); }
}

const sb = makeSandbox();
const LD = sb.LD, B = LD.Battle, T = LD.Terrain, UI = LD.UI;
const N = LD.NIGHT;
LD.CONF.critRate = 0;
const BASE = { basic: "slash", skill1: "dashSlash", skill2: "chain", ult: "bloodRage" };

function mkHero(side, lo) {
  const f = B.mkHero(side, { x: 0, y: 0, look: LD.Profile.look(), loadout: lo || BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
/* 夜战地图：不放车/柜子/补给，避免交互目标扫描时被别的道具抢走 */
function field(rule, n) {
  const fs2 = [];
  for (let i = 0; i < (n || 2); i++) fs2.push(mkHero(i));
  const opt = { mode: "duel", rule: rule || "blackout", fighters: fs2, isHost: true, mySide: 0 };
  opt.mapCfg = { preset: "desert", seed: 40001, counts: { solid: 1, breakable: 0, pushable: 0, fence: 0, car: 0, supply: 0 } };
  B.setup(opt);
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  fs2.forEach(f => { f.invuln = 0; });
  return fs2;
}
const step = dt => B.update(dt || 1 / 60);
/* 只推进夜战子系统，避免完整战斗循环里的移动/AI 干扰数值断言 */
const night = (sec, n) => { const k = n || 60, d = sec / k; for (let i = 0; i < k; i++) B.updateNight(d); };

console.log("=== 1. 模式与数值配置 ===");
{
  const r = LD.RULES.find(x => x.id === "blackout");
  check("规则表里有停电夜战", !!r, r && r.name);
  check("显示名正确", r && r.name === "停电夜战", r && r.name);
  check("规则共 16 种（v4.9 新增僵尸守房）", LD.RULES.length === 16, LD.RULES.length);
  check("黑暗条上限 15", N.darkMax === 15, N.darkMax);
  check("摸黑每秒 +1", N.darkUp === 1, N.darkUp);
  check("受光每秒 -3", N.darkDown === 3, N.darkDown);
  check("条满每秒 20 血", N.darkDps === 20, N.darkDps);
  check("电量上限 100", N.batMax === 100, N.batMax);
  check("充电站公共光半径 40（直径两格）", N.pubR === 40, N.pubR);
  check("手电筒射程减为 80%（416）", N.coneLen === 416, N.coneLen);
  check("手电筒根部光斑同步减 80%（62）", N.coneR === 62, N.coneR);
  check("私人视野横向 50", N.selfR === 50, N.selfR);
  check("私人视野纵向 90（向上扩一格）", N.selfRy === 90, N.selfRy);
  check("私人视野圆心上移到胸口", N.selfDY === 42, N.selfDY);
  check("地图长宽各放大 1.5 倍（1200 → 1800）", N.world.w === 1800 && N.world.h === 1800,
    N.world.w + "x" + N.world.h);
  check("充电站 4 座", N.stations === 4, N.stations);
  check("充电蓄力 1.6 秒", N.charge && N.charge.need === 1.6, N.charge && N.charge.need);
  check("LD.CHARGE.station 已登记", !!LD.CHARGE.station && LD.CHARGE.station.need === 1.6, LD.CHARGE.station && LD.CHARGE.station.need);
  check("只换两个技能槽，不动普攻", N.skill.basic == null && N.skill.skill1 === "dashSlash" && N.skill.skill2 === "shurikenToss",
    String(N.skill.basic) + " / " + N.skill.skill1 + " / " + N.skill.skill2);

  /* K 技能叫 shurikenToss，不能叫 shuriken——后者是大招商店里的「螺旋手里剑」 */
  const sk = LD.skill("shurikenToss");
  check("K 技能不与大招螺旋手里剑撞 id", LD.skill("shuriken").kind === "ult" && sk.kind === "skill",
    LD.skill("shuriken").kind + " / " + sk.kind);
  check("大招螺旋手里剑未被顶掉", LD.skill("shuriken").name === "螺旋手里剑", LD.skill("shuriken").name);
  check("手里剑技能已登记", !!sk, sk && sk.name);
  check("手里剑 26 伤害", sk.dmg === 26, sk.dmg);
  check("手里剑 0.6 秒失明", sk.blind === 0.6, sk.blind);
  check("手里剑蓄力 0.7 秒", sk.windup === 0.7, sk.windup);
  check("手里剑中 CD（7.0）", sk.cd === 7.0, sk.cd);
  check("CD 档位与标签一致（中CD = 6~10s）", sk.tags[0] === "中CD" && sk.cd >= 6 && sk.cd < 10, sk.tags[0] + " / " + sk.cd);
}

console.log("=== 2. 开局：充电站与固定配装 ===");
let ME, FOE;
{
  const fs2 = field("blackout", 2);
  ME = fs2[0]; FOE = fs2[1];
  check("撒下 4 座充电站", (B.stations || []).length === 4, (B.stations || []).length);
  let minD = 1e9;
  for (let i = 0; i < B.stations.length; i++)
    for (let j = i + 1; j < B.stations.length; j++)
      minD = Math.min(minD, Math.hypot(B.stations[i].x - B.stations[j].x, B.stations[i].y - B.stations[j].y));
  check("充电站两两间距 > 300", minD > 300, Math.round(minD));
  const inMap = B.stations.every(s => s.x > 0 && s.x < B.world.w && s.y > 0 && s.y < B.world.h);
  check("充电站都落在地图内", inMap);

  check("配装：普攻保留玩家自选的那个（slash）", ME.loadout.basic === "slash", ME.loadout.basic);
  check("配装：K 换成位移斩", ME.loadout.skill1 === "dashSlash", ME.loadout.skill1);
  check("配装：L 换成手里剑", ME.loadout.skill2 === "shurikenToss", ME.loadout.skill2);
  check("配装：大招被禁用", ME.loadout.ult == null, String(ME.loadout.ult));
  check("人机同样是这套配装", FOE.loadout.basic === "slash" && FOE.loadout.skill1 === "dashSlash" &&
    FOE.loadout.skill2 === "shurikenToss" && FOE.loadout.ult == null);
  check("电量从满格开始", ME.battery === 100, ME.battery);
  check("黑暗条从 0 开始", ME.dark === 0, ME.dark);
  check("开局手电筒是关的", ME.flash === false, ME.flash);
  check("开局就在隐匿状态", ME.stealthT > 0, ME.stealthT);

  /* 大招被禁用：按 O 不会起手 */
  ME.energy = 999;
  B.trySlot(ME, "ult", ME.ctrl);
  check("禁用大招：按 O 不出招", !ME.slot.ult.on, ME.slot.ult.phase);
}

console.log("=== 3. 手电筒：开关与耗电 ===");
{
  field("blackout", 2);
  const me = B.fighters[0], foe = B.fighters[1];
  me.x = 300; me.y = 300; foe.x = 1300; foe.y = 1300;

  check("初始是关灯状态", me.flash === false);
  check("开灯成功", B.toggleFlash(me) === true && me.flash === true);
  check("再按一次关灯", B.toggleFlash(me) === true && me.flash === false);

  me.flash = true; me.battery = 100;
  night(1);
  check("开灯 1 秒耗 6.5 电", Math.abs(me.battery - 93.5) < 0.2, me.battery.toFixed(2));
  night(1);
  check("再过 1 秒继续耗电", Math.abs(me.battery - 87) < 0.3, me.battery.toFixed(2));

  me.battery = 1;
  night(1);
  check("电耗尽自动关灯", me.flash === false && me.battery === 0, me.battery);
  check("没电时按 P 开不了灯", B.toggleFlash(me) === false && me.flash === false);

  /* 关灯时不耗电 */
  me.flash = false; me.battery = 50;
  night(2);
  check("关灯不耗电", me.battery === 50, me.battery);

  /* 非夜战模式下开关手电无效 */
  const g = field("brawl", 2);
  check("非夜战模式不能开手电", B.toggleFlash(g[0]) === false);
}

console.log("=== 4. 受光判定 ===");
{
  field("blackout", 2);
  const me = B.fighters[0], foe = B.fighters[1];
  const st = B.stations[0];
  me.flash = false; foe.flash = false;
  me.x = 60; me.y = 60; foe.x = 1500; foe.y = 1500;
  check("无光源时是摸黑状态", B.nightLit(me) === false);

  me.flash = true;
  check("自己开手电 = 受光", B.nightLit(me) === true);
  me.flash = false;

  me.x = st.x; me.y = st.y;
  check("站在充电站上 = 受光", B.nightLit(me) === true);
  me.x = st.x + N.pubR - 5; me.y = st.y;
  check("两格光圈边缘内仍算受光", B.nightLit(me) === true);
  me.x = st.x + N.pubR + 20; me.y = st.y;
  check("走出两格光圈 = 摸黑", B.nightLit(me) === false);
  /* 充电站是随机撒的，可能正好落在下面几组测试的坐标附近，先把它们挪到角落里，
   * 否则「只有光锥这一个光源」的前提不成立。 */
  B.stations.forEach(s => { s.x = 1500; s.y = 100; });
  me.x = 60; me.y = 60;

  /* 能量包已从本模式移除，就算场上真掉了一个也不该再算光源 */
  B.pickups = B.pickups || [];
  const pk = { kind: "energy", x: 800, y: 800 };
  B.pickups.push(pk);
  me.x = 800; me.y = 800;
  check("能量包不再算公共光源（本模式已移除）", B.nightLit(me) === false);
  B.pickups.splice(B.pickups.indexOf(pk), 1);
  me.x = 400; me.y = 400;

  /* 别人的光锥：站正前方被照到，绕到背后就照不到。
   * 朝向要写清楚：下面 foe 朝 -x（向左看），me 站在他左边才是「正前方」。 */
  me.x = 400; me.y = 400;
  foe.x = 600; foe.y = 400; foe.facing = { x: -1, y: 0 }; foe.flash = true;
  check("站在别人光锥正前方 = 受光（会被看见）", B.nightLit(me) === true);
  me.x = 800; me.y = 400;
  check("绕到开灯的人背后 = 摸黑", B.nightLit(me) === false);
  me.x = 600 - N.coneLen - 60; me.y = 400;
  check("超出光锥射程 = 摸黑", B.nightLit(me) === false);
  me.x = 400; me.y = 400;
  check("光锥边缘外侧（斜后方）= 摸黑", (() => {
    me.x = 600 - 200 * Math.cos(N.coneHalf + 0.25); me.y = 400 + 200 * Math.sin(N.coneHalf + 0.25);
    return B.nightLit(me) === false;
  })());
  foe.flash = false;
  me.x = 400; me.y = 400;
  check("对方关灯后立刻回到摸黑", B.nightLit(me) === false);
}

console.log("=== 5. 黑暗条 ===");
{
  field("blackout", 2);
  const me = B.fighters[0], st = B.stations[0];
  me.flash = false;
  me.x = 60; me.y = 60;
  me.dark = 0;
  night(15, 150);
  check("摸黑 15 秒黑暗条攒满", Math.abs(me.dark - N.darkMax) < 0.01, me.dark.toFixed(2));

  /* 条满后按每秒 20 掉血。黑暗侵蚀每 0.25 秒结算一节，所以给一个节拍（5 点）的容差 */
  me.dark = N.darkMax; me.hp = me.maxHp; me.regenAcc = 0; me._darkAcc = 0;
  const hp0 = me.hp;
  night(2);
  const lost = hp0 - me.hp;
  check("黑暗条满：按每秒 20 掉血", Math.abs(lost - 40) <= 5, lost.toFixed(1));
  check("掉血后黑暗条仍维持满格", Math.abs(me.dark - N.darkMax) < 0.01, me.dark.toFixed(2));
  check("黑暗掉血不给受击表现（hitFlash 不置位）", me.hitFlash === 0, me.hitFlash);
  check("黑暗掉血不刷新「刚挨过打」时间戳", me.lastHurtAt == null || me.lastHurtAt === 0, me.lastHurtAt);

  /* 黑暗侵蚀不该打断手上的蓄力。
   * 站到充电站旁就受光了（不会挨侵蚀），所以这里直接在蓄力中打一发跟侵蚀同规格的 soft 伤害。 */
  me.hp = me.maxHp;
  const st0 = B.stations[1] || B.stations[0];
  me.x = st0.x; me.y = st0.y;
  B.startCharge(me, "station", st0);
  B.damage(null, me, 5, { type: "dot", kb: 0, noSrc: true, soft: true });
  check("黑暗侵蚀不会打断蓄力", !!me.chg && me.chg.kind === "station", me.chg && me.chg.kind);
  B.cancelCharge(me);
  /* 普通受击照样打断（别把保护写过头了） */
  B.startCharge(me, "station", st0);
  B.damage(null, me, 5, { type: "dot", kb: 0, noSrc: true });
  check("普通受击仍会打断蓄力", !me.chg);

  /* 回到公共光：每秒 -3 */
  me.x = st.x; me.y = st.y;
  night(1);
  check("受公共光：每秒 -3", Math.abs(me.dark - (N.darkMax - N.darkDown)) < 0.2, me.dark.toFixed(2));
  check("受光后 f.lit 置位", me.lit === true);
  night(5);
  check("持续受光黑暗条清零", me.dark === 0, me.dark.toFixed(2));
  const hp1 = me.hp;
  night(1);
  check("黑暗条清后不再掉血", me.hp === hp1, me.hp);

  /* 开灯也算受光，可以自己压住黑暗条 */
  me.x = 60; me.y = 60; me.flash = true; me.dark = 10;
  night(1);
  check("自己开灯也能压黑暗条", Math.abs(me.dark - 7) < 0.2, me.dark.toFixed(2));
}

console.log("=== 6. 充电站交互 ===");
{
  field("blackout", 2);
  const me = B.fighters[0], st = B.stations[0];
  me.flash = false; me.battery = 20;

  me.x = st.x; me.y = st.y + 60;
  const tgt = B.interactTarget(me);
  check("靠近充电站能识别到充电目标", !!tgt && tgt.kind === "station", tgt && tgt.kind);
  check("交互文案是「充电」", B.interactLabel(me) === "充电", B.interactLabel(me));

  check("起手蓄力", B.startCharge(me, "station", st) === true && me.chg && me.chg.kind === "station");
  B.updateCharging(0.8);
  check("半途还没完成", !!me.chg && me.chg.t < 1.6 && me.battery === 20, me.battery);
  B.updateCharging(0.9);
  check("蓄满 1.6 秒后完成充电", !me.chg, me.chg && me.chg.t);
  check("电量补满", Math.abs(me.battery - 100) < 0.01, me.battery.toFixed(1));

  /* 走到远处：既识别不到目标，蓄力也会中断 */
  me.battery = 10;
  me.x = st.x; me.y = st.y + 40;
  B.startCharge(me, "station", st);
  me.x = st.x + 400;
  B.updateCharging(0.1);
  check("走远后蓄力被中断", !me.chg, me.chg && me.chg.kind);
  /* 走远后不该再识别到「这一座」充电站（其它三座是随机位置，可能正好在旁边） */
  check("走远后识别不到充电站", (() => {
    const t2 = B.interactTarget(me);
    return !t2 || t2.prop !== st;
  })());

  /* 蓄力途中被打断 */
  me.x = st.x; me.y = st.y + 40; me.battery = 30;
  B.startCharge(me, "station", st);
  me.root = 0.5;
  B.updateCharging(0.1);
  check("被打断后蓄力取消", !me.chg);
  me.root = 0;
}

console.log("=== 7. 交互键接管（P = 手电筒）===");
{
  field("blackout", 2);
  const me = B.fighters[0];
  me.flash = false; me.battery = 100;
  /* 远离所有充电站与补给 */
  me.x = 60; me.y = 60;
  B.pickups = [];
  B.stations.forEach(s => { s.x = 1400; s.y = 1400; });

  check("空手时交互文案是「开手电」", B.interactLabel(me) === "开手电", B.interactLabel(me));
  check("按下 P 打开手电筒", B.doInteract(me) === true && me.flash === true);
  check("开灯后文案变成「关手电」", B.interactLabel(me) === "关手电", B.interactLabel(me));
  check("再按 P 关闭手电筒", B.doInteract(me) === true && me.flash === false);

  /* 有充电站可交互时，P 优先充电，不被手电筒抢走 */
  const st = B.stations[0];
  st.x = me.x; st.y = me.y + 50;
  check("有充电目标时文案回到「充电」", B.interactLabel(me) === "充电", B.interactLabel(me));
  B.doInteract(me);
  check("此时 P 走充电而不是开关灯", me.flash === false && !!me.chg && me.chg.kind === "station", me.chg && me.chg.kind);
  B.cancelCharge(me);

  /* 非夜战模式：空手按 P 不会误开手电筒 */
  const g = field("brawl", 2);
  check("非夜战模式空手 P 无手电文案", B.interactLabel(g[0]) !== "开手电", B.interactLabel(g[0]));
}

console.log("=== 8. 手里剑 ===");
{
  field("blackout", 2);
  const me = B.fighters[0], foe = B.fighters[1];
  ME = me; FOE = foe;
  /* 摆好：我在左，敌人在正右方 260 处，方向与键盘都松开 */
  me.x = 400; me.y = 400; me.vx = 0; me.vy = 0;
  foe.x = 660; foe.y = 400; foe.vx = 0; foe.vy = 0; foe.invuln = 0;
  me.ctrl.mx = 0; me.ctrl.my = 0;
  me.facing = { x: 1, y: 0 };
  me.slot.skill2 = { on: false, phase: "", t: 0, d: {} };
  me.cd = me.cd || {}; me.cd.skill2 = 0;

  B.trySlot(me, "skill2", me.ctrl);
  check("按下 L 进入蓄力", me.slot.skill2.on === true && me.slot.skill2.phase === "shuWind", me.slot.skill2.phase);
  check("蓄力期间定身 0.7 秒", me.root >= 0.7 - 1e-6, (me.root || 0).toFixed(2));
  check("蓄力期间不破除隐匿", me.stealthT > 0, me.stealthT);

  B.projs = B.projs || [];
  B.projs.length = 0;
  /* 走到 0.7 秒：出手 */
  for (let i = 0; i < 43; i++) { step(); me.facing = { x: 1, y: 0 }; }
  check("蓄力结束槽位释放", me.slot.skill2.on === false, me.slot.skill2.phase);
  check("掷出 1 枚飞镖", B.projs.length === 1, B.projs.length);
  const p = B.projs[0];
  check("弹道类型是 shuriken", p && p.type === "shuriken", p && p.type);
  check("飞镖向右飞", p && p.vx > 500 && Math.abs(p.vy) < 60, p && (p.vx.toFixed(0) + "," + p.vy.toFixed(0)));
  check("飞镖 26 伤害 / 0.6 秒失明", p && p.dmg === 26 && p.blind === 0.6, p && (p.dmg + "/" + p.blind));
  check("飞镖不穿透（命中即消失）", p && p.pierce === false, p && p.pierce);
  check("进入 7 秒 CD", (me.cd.skill2 || 0) > 6.5, (me.cd.skill2 || 0).toFixed(2));

  /* 让它飞到敌人身上 */
  foe.invuln = 0; foe.hp = foe.maxHp; foe.blind = 0;
  const hp0 = foe.hp;
  for (let i = 0; i < 30 && B.projs.length; i++) step();
  check("命中后飞镖消失", B.projs.length === 0, B.projs.length);
  check("命中造成 26 点伤害", Math.abs((hp0 - foe.hp) - 26) < 1.5, (hp0 - foe.hp).toFixed(1));
  /* 命中的那一帧之后 blind 已经开始按帧递减，所以给一帧的容差 */
  check("命中标上 0.6 秒失明", foe.blind > 0.6 - 1 / 30 && foe.blind <= 0.6, foe.blind.toFixed(3));

  /* 失明会随时间自然消退 */
  for (let i = 0; i < 40; i++) step();
  check("失明会自然消退", foe.blind < 0.6, foe.blind.toFixed(2));

  /* CD 期间不能连发 */
  me.slot.skill2 = { on: false, phase: "", t: 0, d: {} };
  B.projs.length = 0;
  B.trySlot(me, "skill2", me.ctrl);
  check("CD 期间再按 L 不出招", me.slot.skill2.on === false && B.projs.length === 0);
}

console.log("=== 9. 摸黑隐匿：进公共光解除 ===");
{
  field("blackout", 2);
  const me = B.fighters[0], foe = B.fighters[1], st = B.stations[0];
  B.stations.forEach(s => { s.x = 1500; s.y = 1500; });
  me.x = 200; me.y = 200; me.flash = false;
  foe.x = 1200; foe.y = 200; foe.flash = false;

  night(0.2, 12);
  check("摸黑时处于隐匿状态", me.stealthT > 0, me.stealthT);
  check("隐匿期间攻击不破除隐身", (() => {
    me.cd.skill2 = 0; me.slot.skill2 = { on: false, phase: "", t: 0, d: {} };
    B.trySlot(me, "skill2", me.ctrl);
    return me.stealthT > 0;
  })(), me.stealthT);
  check("隐匿时 AI 看不见自己", B.aiCanSee(foe, me) === false);

  /* 走进充电站光圈 → 现形 */
  me.x = st.x; me.y = st.y;
  night(0.2, 12);
  check("站进充电站光圈后现形", me.stealthT === 0, me.stealthT);
  check("现形后 AI 能看见自己", B.aiCanSee(foe, me) === true);

  /* 走出光圈 → 重新隐身 */
  me.x = 200; me.y = 200;
  night(0.2, 12);
  check("离开光圈重新进入隐匿", me.stealthT > 0, me.stealthT);

  /* 自己开手电筒也等于把自己照亮 → 现形 */
  me.flash = true;
  night(0.2, 12);
  check("自己开灯会现形（灯是举在身上的）", me.stealthT === 0, me.stealthT);

  /* 被别人的光锥照到 → 现形 */
  me.flash = false;
  me.x = 200; me.y = 200;
  night(0.2, 12);
  check("关灯后又隐身了", me.stealthT > 0, me.stealthT);
  foe.x = 400; foe.y = 200; foe.facing = { x: -1, y: 0 }; foe.flash = true;
  night(0.2, 12);
  check("被别人的手电筒照到会现形", me.stealthT === 0, me.stealthT);
  foe.flash = false;
  night(0.2, 12);
  check("对方关灯后自己重新隐身", me.stealthT > 0, me.stealthT);
}

console.log("=== 10. 本模式不产能量包 ===");
{
  field("blackout", 2);
  B.pickups = [];
  B.dropPickup(800, 800, "energy");
  check("强制掉能量包也不生成", B.pickups.length === 0, B.pickups.length);
  for (let i = 0; i < 30; i++) B.dropPickup(800 + i, 800);
  check("随机掉落只出 heal / speed", B.pickups.length > 0 &&
    B.pickups.every(p => p.kind === "heal" || p.kind === "speed"),
    B.pickups.map(p => p.kind).join(","));

  /* 别的模式照常有能量包 */
  field("brawl", 2);
  B.pickups = [];
  B.dropPickup(800, 800, "energy");
  check("其它模式能量包照常掉落", B.pickups.length === 1 && B.pickups[0].kind === "energy", B.pickups[0] && B.pickups[0].kind);
}

console.log("=== 11. 渲染层不崩 ===");
{
  field("blackout", 2);
  const me = B.fighters[0];
  me.flash = true; me.dark = 15;
  let err = null;
  try {
    const ctx = makeCtx();
    B.drawStations(ctx);
    B.drawNight(ctx, 960, 600);
    B.draw(ctx);
  } catch (e) { err = e; }
  check("充电站 / 黑幕 / 整帧绘制不抛异常", err === null, err && err.message);

  /* HUD：夜战要同时给出电量与黑暗两条 */
  UI.updateHud();
  const hud = sb.document.getElementById("pBars").innerHTML;
  check("HUD 含电量条", hud.indexOf("电量") >= 0 && hud.indexOf("bat") >= 0);
  check("HUD 含黑暗条", hud.indexOf("黑暗") >= 0 && hud.indexOf("drk") >= 0);
  check("黑暗条满时带 full 告警", hud.indexOf("drk full") >= 0);
  check("HUD 顺序：血条 → 能量 → 电量 → 黑暗", hud.indexOf("HP") < hud.indexOf("能量") &&
    hud.indexOf("能量") < hud.indexOf("电量") && hud.indexOf("电量") < hud.indexOf("黑暗"));

  me.battery = 10; me.flash = false; me.dark = 0;
  UI.updateHud();
  check("低电量时电量条带 low 告警", sb.document.getElementById("pBars").innerHTML.indexOf("bat low") >= 0);

  UI.updateModeHud();
  const mh = sb.document.getElementById("modeHud").innerHTML;
  check("模式条给出充电站数量与提示", mh.indexOf("充电站") >= 0 && mh.indexOf("充电") >= 0, mh.replace(/<[^>]+>/g, "").slice(0, 60));

  /* 完整跑 3 秒：确认每帧没有把夜战逻辑跑崩 */
  let err2 = null;
  try { for (let i = 0; i < 180; i++) step(); } catch (e) { err2 = e; }
  check("连续 3 秒完整战斗循环不抛异常", err2 === null, err2 && err2.message);
  check("3 秒后所有人的黑暗条都在合法区间",
    B.fighters.every(f => f.dark >= 0 && f.dark <= N.darkMax), B.fighters.map(f => (f.dark || 0).toFixed(1)).join("/"));
  check("3 秒后所有人的电量都在合法区间",
    B.fighters.every(f => f.battery >= 0 && f.battery <= N.batMax), B.fighters.map(f => (f.battery || 0).toFixed(1)).join("/"));
}

console.log("");
console.log("=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
