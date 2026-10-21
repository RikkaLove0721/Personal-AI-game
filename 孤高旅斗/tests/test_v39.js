/* 孤高旅斗 v3.9 测试
 * 覆盖：被远程震下车后的 5 秒上车禁令 /
 *       能量包改为「按交互键原地蓄力开包」（受击中断、蓄力期间锁移动锁技能）/
 *       玩家 HUD 顺序统一为 血条 → 能量条 → 击杀死亡（塔防也要有能量条）
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
LD.CONF.critRate = 0;
const CFG = LD.INTERACT, CHG = LD.CHARGE;
const BASE = { basic: "slash", skill1: "dashSlash", skill2: "chain", ult: "bloodRage" };

function mkHero(side, lo) {
  const f = B.mkHero(side, { x: 0, y: 0, look: LD.Profile.look(), loadout: lo || BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
/* rule=tower 走专用地图；其余模式带一份含车辆的 mapCfg（不传时不生成地形） */
function field(rule, n) {
  const fs2 = [];
  for (let i = 0; i < (n || 2); i++) fs2.push(mkHero(i));
  const opt = { mode: "duel", rule: rule || "brawl", fighters: fs2, isHost: true, mySide: 0 };
  if (rule !== "tower") {
    opt.mapCfg = { preset: "desert", seed: 39001, counts: { solid: 1, breakable: 0, pushable: 0, fence: 0, car: 2, supply: 0 } };
  }
  B.setup(opt);
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  fs2.forEach(f => { f.invuln = 0; });
  return fs2;
}
const step = dt => B.update(dt || 1 / 60);
const stepN = n => { for (let i = 0; i < n; i++) step(); };
/* 造一辆空车并原地摆好 */
function putCar(x, y) {
  const o = B.terrain.props.find(p => p.kind === "car" && !p.driver && !p.dead);
  if (!o) return null;
  o.x = x; o.y = y; o.fuel = o.fuelMax;
  return o;
}

console.log("=== 1. 被震下车后的 5 秒上车禁令 ===");
{
  field("brawl", 2);
  const me = B.fighters[0], foe = B.fighters[1];
  const car = putCar(400, 400);
  check("场上能找到车", !!car);

  me.x = car.x; me.y = car.y;
  check("平时可以上车", B.enterCar(me, car) === true && me.rideCar === car);

  /* 敌方远程命中车体 → 震出 */
  me.x = car.x; me.y = car.y;
  T.hitProp(B.terrain, car, 20, { src: foe });
  check("挨打后被震出车外", me.rideCar === null, "rideCar=" + me.rideCar);
  check("震出同时被眩晕", me.stun > 0, "stun=" + (me.stun || 0).toFixed(2));
  check("震出后立刻挂上 5 秒禁令", Math.abs((me.noCarT || 0) - CFG.noCarT) < 0.01, me.noCarT);

  const path0 = { x: me.x, y: me.y };
  me.x = car.x; me.y = car.y;
  check("禁令期间上车被拒", B.enterCar(me, car) === false && me.rideCar === null);
  const tgt = B.interactTarget(me);
  check("禁令期间车不出现在交互目标里", !tgt || tgt.type !== "car", tgt && tgt.type);
  check("禁令期间交互文案不含「上车」", B.interactLabel(me) !== "上车", B.interactLabel(me));
  me.x = path0.x; me.y = path0.y;

  /* AI 也不该在这段时间里盯车 */
  const bot = B.fighters[1];
  bot.noCarT = 3;
  bot.hp = bot.maxHp * 0.4;
  LD.AI.mkBot(bot, "normal");
  bot.x = 300; bot.y = 300;
  LD.AI.tickHero(bot, 1 / 60);
  const aiCar = bot.useTarget && bot.useTarget.type === "car";
  check("AI 在禁令期间不把车设为目标", !aiCar, bot.useTarget && bot.useTarget.type);
  bot.noCarT = 0;

  /* 倒计时走完恢复 */
  stepN(60 * 3);
  check("3 秒后仍在禁令中", me.noCarT > 0, me.noCarT.toFixed(2));
  stepN(60 * 3);
  check("6 秒后禁令解除", (me.noCarT || 0) === 0, me.noCarT);
  me.x = car.x; me.y = car.y;
  check("禁令解除后可以重新上车", B.enterCar(me, car) === true && me.rideCar === car);

  /* 主动下车不吃禁令 */
  B.exitCar(me, false);
  check("主动下车不受禁令影响", (me.noCarT || 0) === 0, me.noCarT);
}

console.log("\n=== 2. 能量包：交互蓄力开包 ===");
{
  field("brawl", 2);
  const me = B.fighters[0], foe = B.fighters[1];
  check("能量包蓄力时长 5 秒", CHG.pack.need === 5, CHG.pack.need);
  LD.CONF.energy.regen = 0;      // 关掉自然回能，方便精确断言「+60」

  me.x = 600; me.y = 400; me.energy = 0;
  B.dropPickup(600, 400, "energy");
  const pk = B.pickups[0];
  check("能量包已生成", !!pk && pk.kind === "energy");

  /* 站着不动：不会自动吃掉 */
  stepN(30);
  check("走上去不再自动拾取", me.energy === 0 && B.pickups.indexOf(pk) >= 0, "energy=" + me.energy);

  me.interactCd = 0;
  check("按交互键开始蓄力", B.doInteract(me) === true && !!me.chg && me.chg.kind === "pack");
  check("交互提示为「开启能量包」", B.interactLabel(me) === "开启能量包", B.interactLabel(me));

  /* v3.9 修：交互半径按「两个身位」算，站在包旁边（不是贴脸）也要能开 */
  {
    const pkR = B.pickups[0];
    const near = [40, 60, 80, 90].map(d => {
      me.x = pkR.x - d; me.y = pkR.y; me.chg = null; me.interactCd = 0;
      const t = B.interactTarget(me);
      return t && t.type === "chg" && t.kind === "pack";
    });
    check("站在 40 / 60 / 80 / 90px 处都能识别到能量包", near.every(Boolean), near.join(","));
    me.x = pkR.x - 200; me.y = pkR.y; me.interactCd = 0;
    check("离得远（200px）不会误触", !B.interactTarget(me));
    /* 复位到包上，后面的「蓄力期间不移动 / 进度推进」还要用 */
    me.x = pkR.x; me.y = pkR.y; me.chg = null; me.interactCd = 0;
    B.doInteract(me);
    check("复位后重新起手", !!me.chg);
  }

  /* 蓄力期间移动被锁 */
  me.ctrl.mx = 1; me.ctrl.my = 0;
  const bx = me.x, by = me.y;
  stepN(30);
  check("蓄力期间角色不移动", Math.hypot(me.x - bx, me.y - by) < 1, Math.hypot(me.x - bx, me.y - by).toFixed(2));
  check("蓄力进度在推进", me.chg && me.chg.t > 0.3, me.chg ? me.chg.t.toFixed(2) : "null");
  me.ctrl.mx = 0; me.ctrl.my = 0;

  /* 挨打 → 中断，进度清零 */
  B.damage(foe, me, 10, { type: "basic", basic: true });
  check("受击后蓄力被中断", !me.chg);
  check("中断后没有拿到能量", me.energy < LD.CONF.energy.packGain, "energy=" + me.energy);

  /* 不受干扰地开满 5 秒 */
  me.x = pk.x; me.y = pk.y; me.interactCd = 0; me.invuln = 999;
  me.energy = 0;
  B.doInteract(me);
  for (let i = 0; i < 60 * 6 && B.pickups.indexOf(pk) >= 0; i++) step();
  check("开包完成后能量包消失", B.pickups.indexOf(pk) < 0);
  check("拿到 60 点大招能量", me.energy === LD.CONF.energy.packGain, "energy=" + me.energy);

  /* 离得太远也会中断 */
  B.dropPickup(600, 400, "energy");
  const pk2 = B.pickups[0];
  me.x = pk2.x; me.y = pk2.y; me.interactCd = 0;
  B.doInteract(me);
  check("第二次起手成功", !!me.chg);
  me.x = pk2.x + 400;
  step();
  check("走远后蓄力中断", !me.chg);

  /* v3.9 修：交互半径内（80~96px）起手不能被「离得太远」误判打断。
   * 旧版只放 f.r + keep（≈80），站在 90px 按 P 起手、下一帧就被判中断。 */
  B.dropPickup(600, 400, "energy");
  const pk3 = B.pickups[0];
  me.x = pk3.x - 90; me.y = pk3.y; me.interactCd = 0; me.energy = 0;
  B.doInteract(me);
  const okStart = !!me.chg;
  stepN(30);
  check("站在 90px 处起手后蓄力不会被误判中断", okStart && !!me.chg,
    "起手=" + okStart + " 一帧后=" + !!me.chg);

  /* v3.9 修：蓄力中途再按 P = 提前开启，按已蓄比例折算，不再白费 */
  B.cancelCharge(me, null);
  me.x = pk3.x; me.y = pk3.y; me.interactCd = 0; me.energy = 0;
  B.doInteract(me);
  stepN(60 * 2.5);                       // 蓄到 2.5 秒（一半）
  const halfT = me.chg ? me.chg.t : 0;
  me.interactCd = 0;
  B.doInteract(me);                      // 第二下 P
  check("中途按 P 会提前开包", B.pickups.indexOf(pk3) < 0, "半程 t=" + halfT.toFixed(2));
  check("提前开包按比例折算（约 +30）", me.energy >= 25 && me.energy <= 35, "energy=" + me.energy);

  /* 蓄力刚开始（<40%）再按 P 才是取消，不消耗背包 */
  B.dropPickup(600, 400, "energy");
  const pk4 = B.pickups[0];
  me.x = pk4.x; me.y = pk4.y; me.interactCd = 0; me.energy = 0;
  B.doInteract(me);
  stepN(18);                             // 0.3 秒
  me.interactCd = 0;
  B.doInteract(me);
  check("刚起手就按第二下 = 取消，背包还在", !me.chg && B.pickups.indexOf(pk4) >= 0 && me.energy === 0);

  /* v3.9 修：车里的玩家不该看到「开启能量包」（车身半径和补给箱常重叠） */
  {
    me.chg = null; me.interactCd = 0;
    me.rideCar = { kind: "car", x: me.x, y: me.y, driver: me };
    const tInCar = B.interactTarget(me);
    const lblInCar = B.interactLabel(me);
    check("车里的玩家不会把能量包当交互目标", !(tInCar && tInCar.kind === "pack"), tInCar ? tInCar.type : "null");
    check("车里的 P 框只提示「下车」", lblInCar === "下车", lblInCar);
    me.rideCar = null;
    check("下车后能量包重新可交互", (B.interactTarget(me) || {}).kind === "pack");
  }

  /* 血包与移速包仍是接触即生效 */
  me.x = 600; me.y = 400; me.hp = me.maxHp - 50;
  B.dropPickup(600, 400, "heal");
  stepN(2);
  check("血包仍是走上去就回血", me.hp > me.maxHp - 50, "hp=" + me.hp);
  B.dropPickup(600, 400, "speed");
  stepN(2);
  check("移速包仍是接触即生效", (me.speedBoostT || 0) > 0, "boost=" + (me.speedBoostT || 0).toFixed(1));
}

console.log("\n=== 3. 玩家 HUD：血条 → 能量条 → 击杀死亡 ===");
{
  const ptaint = () => {
    UI.updateHud();
    return (sb.document.getElementById("pBars") || {}).innerHTML || "";
  };
  const hss = field("tower", 6);
  let htmlDoc = ptaint();
  check("塔防 HUD 里有能量条", /能量/.test(htmlDoc), htmlDoc.indexOf("能量") < 0 ? "缺失" : "有");
  const iHp = htmlDoc.indexOf(">HP<"), iEn = htmlDoc.indexOf(">能量<"), iKd = htmlDoc.indexOf("class=\"kd\"");
  check("塔防：顺序为 血条 → 能量条 → K/D", iHp >= 0 && iHp < iEn && iEn < iKd,
    "hp=" + iHp + " en=" + iEn + " kd=" + iKd);
  check("塔防 K/D 里带击杀与死亡数", /击杀[\s\S]*死亡/.test(htmlDoc));

  const h2 = field("brawl", 2);
  htmlDoc = ptaint();
  const iHp2 = htmlDoc.indexOf(">HP<"), iEn2 = htmlDoc.indexOf(">能量<"), iKd2 = htmlDoc.indexOf("class=\"kd\"");
  check("经典模式同样保持该顺序", iHp2 < iEn2 && iEn2 < iKd2, "hp=" + iHp2 + " en=" + iEn2 + " kd=" + iKd2);

  /* 能量满标时应带上 full 样式，和其它模式一致 */
  const me = h2[0];
  me.energy = me.maxEnergy;
  htmlDoc = ptaint();
  check("能量满时带 full 高亮", /class="bartrack en full"/.test(htmlDoc));
}

console.log("\n=== 4. 被揪出柜子后的 5 秒躲藏禁令（与上车禁令同规格） ===");
{
  /* 需要柜子：单独起一局带 locker 的地图 */
  const fs2 = [mkHero(0), mkHero(1)];
  B.setup({ mode: "duel", rule: "brawl", fighters: fs2, isHost: true, mySide: 0,
    mapCfg: { preset: "desert", seed: 39111, counts: { solid: 0, breakable: 0, car: 0, locker: 3, supply: 0 } } });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  fs2.forEach(f => { f.invuln = 0; });
  const me = fs2[0], foe = fs2[1];
  const lks = B.terrain.props.filter(p => p.kind === "locker" && !p.dead);
  const lk = lks[0], lk2 = lks[1];
  check("场上能找到柜子", lks.length >= 2, lks.length + " 个");

  lk.occupant = null;
  check("平时可以躲进柜子", B.enterLocker(me, lk) === true && me.hideProp === lk);

  /* 柜子挨打 → 被揪出来（免疫本次伤害）+ 眩晕 + 挂上躲藏禁令 */
  const hpBefore = me.hp;
  T.hitProp(B.terrain, lk, 20, { src: foe });
  check("柜子挨打后被揪出来", me.hideProp === null, "hideProp=" + me.hideProp);
  check("被揪出来会眩晕 2 秒", Math.abs((me.stun || 0) - 2) < 0.01, (me.stun || 0).toFixed(2));
  check("这一下伤害被免疫", me.hp === hpBefore, me.hp);
  check("被揪出后挂上 5 秒躲藏禁令", Math.abs((me.noHideT || 0) - CFG.noHideT) < 0.01, (me.noHideT || 0).toFixed(2));

  /* 禁令期间：原柜子 / 别的柜子都进不去，交互目标里也没有柜子 */
  me.stun = 0;
  check("禁令期间躲回原柜子被拒", B.enterLocker(me, lk) === false && me.hideProp === null);
  lk2.occupant = null;
  me.x = lk2.x; me.y = lk2.y;
  check("禁令期间躲别的柜子同样被拒", B.enterLocker(me, lk2) === false);
  const t2 = B.interactTarget(me);
  check("禁令期间柜子不出现在交互目标里", !t2 || t2.type !== "locker", t2 && t2.type);
  check("禁令期间交互文案不含「躲藏」", B.interactLabel(me) !== "躲藏", B.interactLabel(me));

  /* 直接挨打（B.damage 通道）也要挂禁令 */
  me.noHideT = 0;
  lk.occupant = null;
  me.x = lk.x; me.y = lk.y;
  B.enterLocker(me, lk);
  B.damage(foe, me, 20, { type: "skill" });
  check("直接挨打也会被揪出并挂禁令", me.hideProp === null && (me.noHideT || 0) > 0, (me.noHideT || 0).toFixed(2));

  /* AI 在禁令期间不把柜子设为目标 */
  const bot = fs2[1];
  bot.noHideT = 3;
  bot.hp = bot.maxHp * 0.3;
  bot.x = lk.x + 150; bot.y = lk.y;
  LD.AI.mkBot(bot, "normal");
  for (let i = 0; i < 6; i++) { bot.bot.think = 0; LD.AI.tickHero(bot, 1 / 60); }
  check("AI 在禁令期间不把柜子设为目标", !(bot.useTarget && bot.useTarget.type === "locker"),
    bot.useTarget && bot.useTarget.type);
  bot.noHideT = 0;

  /* 倒计时走完恢复 */
  me.noHideT = 5;
  stepN(60 * 3);
  check("3 秒后仍在躲藏禁令中", (me.noHideT || 0) > 0, (me.noHideT || 0).toFixed(2));
  stepN(60 * 3);
  check("6 秒后躲藏禁令解除", (me.noHideT || 0) === 0, me.noHideT);
  lk.occupant = null;
  me.x = lk.x; me.y = lk.y;
  check("禁令解除后可以重新躲藏", B.enterLocker(me, lk) === true && me.hideProp === lk);

  /* 自己主动出来不吃禁令 */
  B.leaveLocker(me, false);
  check("主动离开柜子不受禁令影响", (me.noHideT || 0) === 0, me.noHideT);
}

console.log("\n=== 5. 千剑杀：剑气穿透 ===");
{
  const SK = LD.skill("thousandSwords");
  const TS = { basic: "slash", skill1: "dashSlash", skill2: "chain", ult: "thousandSwords" };
  const fs2 = [];
  for (let i = 0; i < 4; i++) { const f = mkHero(i, TS); fs2.push(f); }
  B.setup({ mode: "duel", rule: "brawl", fighters: fs2, isHost: true, mySide: 0, matchT: 600 });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  fs2.forEach(f => { f.invuln = 0; f.hp = f.maxHp = 400; });
  const me = fs2[0], e1 = fs2[1], e2 = fs2[2], e3 = fs2[3];
  /* 一条直线站好：剑气从左边飞过来，依次穿过三个人 */
  me.x = 200; me.y = 300; me.facing = { x: 1, y: 0 };
  e1.x = 400; e1.y = 300; e2.x = 600; e2.y = 300; e3.x = 800; e3.y = 300;

  check("千剑杀在技能表上标记了穿透", SK.pierce === true);
  check("描述里写明了穿透", SK.desc.indexOf("穿透") >= 0);

  /* 单把剑：造一把和千剑杀同参数的剑气，看它是不是一路穿过去 */
  const fly = pierce => {
    [e1, e2, e3].forEach(f => { f.hp = f.maxHp; });
    B.projs.length = 0;
    const p = B.spawnProj({
      x: 220, y: 274, vx: SK.proj.speed, vy: 0, r: SK.proj.r, dmg: SK.dmg, life: SK.proj.life,
      owner: me, color: "#a5f3fc", core: "#f0feff", type: "sword", kindTag: "ult", trail: true,
      pierce: !!pierce, data: { pierceOnce: !!pierce }
    });
    const got = [0, 0, 0];
    for (let i = 0; i < 60 * 2; i++) {
      const before = [e1.hp, e2.hp, e3.hp];
      step();
      [e1, e2, e3].forEach((f, k) => { got[k] += before[k] - f.hp; });
      if (B.projs.indexOf(p) < 0) break;
    }
    return got;
  };
  const got = fly(true);
  check("一把剑气能贯穿三个人", got[0] > 0 && got[1] > 0 && got[2] > 0, got.join("/"));
  check("同一个人只吃一把剑的一次伤害", got[0] === SK.dmg && got[1] === SK.dmg && got[2] === SK.dmg, got.join("/"));
  const old = fly(false);
  check("旧行为对照：不穿透的剑只打到第一个", old[0] > 0 && old[1] === 0 && old[2] === 0, old.join("/"));

  /* 真放一次大招：剑气自带穿透，一条线上三个人都会掉血 */
  [me, e1, e2, e3].forEach(f => { f.hp = f.maxHp; });
  e1.x = 450; e2.x = 700; e3.x = 950;
  me.energy = me.maxEnergy; me.cd.ult = 0;
  B.trySlot(me, "ult", me.ctrl);
  stepN(6);                                        // 跳过开场演出
  let first = null;
  for (let i = 0; i < 60 * 5; i++) {
    step();
    if (!first) first = B.projs.find(p => p.type === "sword") || null;
  }
  check("大招射出的剑气带穿透", first && first.pierce === true && first.data.pierceOnce === true);
  check("一整条线上的三个人都吃到了剑气",
    e1.hp < e1.maxHp && e2.hp < e2.maxHp && e3.hp < e3.maxHp,
    [e1, e2, e3].map(f => Math.round(f.maxHp - f.hp)).join("/"));
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
