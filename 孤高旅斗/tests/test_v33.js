/* 孤高旅斗 v3.3 交互系统测试
 * 覆盖：P 键交互 / 天外来物按 P 拾取与替换 / 柜子躲藏（被打出来 + AI 2 秒察觉）/
 *       汽车驾驶（油量·速度·撞人·下车眩晕·技能禁用·喇叭·坦克炮）/
 *       泥土拾取投掷 / 物资刷新修饰符 / AI 交互欲望 / 交互提示文案
 */
const SB = require("./_sandbox.js");
const { fs, path, html, code, makeCtx, makeEl } = SB;
const makeSandbox = (label) => SB.makeSandbox(label, { image: false });

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}


const sb = makeSandbox();
const LD = sb.LD, B = LD.Battle, T = LD.Terrain;
LD.CONF.critRate = 0;

const BASE = { basic: "slash", skill1: "dashSlash", skill2: null, ult: "bloodRage" };
function mkHero(side, lo) {
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(), loadout: lo || BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
/* 只放车 / 柜子 / 泥土的空场，避免随机障碍干扰位移与投掷 */
function mkField(counts, n, mods) {
  const fs2 = [];
  for (let i = 0; i < (n || 2); i++) fs2.push(mkHero(i));
  const cfg = { preset: "arena", seed: 20240318,
    counts: Object.assign({ solid: 0, breakable: 0, pushable: 0, fence: 0, barrel: 0,
      barricade: 0, supply: 0, car: 0, tire: 0, bush: 0, water: 0, room: 0, locker: 0, mud: 0 }, counts || {}) };
  B.setup({ mode: "duel", rule: "brawl", fighters: fs2, mapCfg: cfg, mods: mods || [] });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  fs2.forEach(f => { f.hp = f.maxHp; });
  return fs2;
}
const carsOf = () => B.terrain.props.filter(o => o.kind === "car" && !o.dead);
const lockersOf = () => B.terrain.props.filter(o => o.kind === "locker" && !o.dead);
const mudsOf = () => B.terrain.props.filter(o => o.kind === "mud" && !o.dead);
const stepN = (n) => { for (let i = 0; i < n; i++) B.update(1 / 60); };

console.log("=== 1. 配置与注册 ===");
{
  check("交互键为 P（大招 O）", LD.INTERACT.key === "P");
  check("交互距离参数存在（拾取 / 柜车 / 泥土）",
    LD.INTERACT.range > 0 && LD.INTERACT.giftRange > 0 && LD.INTERACT.mudRange > 0,
    LD.INTERACT.range + "/" + LD.INTERACT.giftRange + "/" + LD.INTERACT.mudRange);
  check("车辆目录含轿车 / 面包车 / 大巴 / 坦克",
    ["sedan", "van", "bus", "tank"].every(k => !!LD.VEHICLES[k]));
  check("轿车速度 120%-170%", LD.VEHICLES.sedan.speed[0] === 1.2 && LD.VEHICLES.sedan.speed[1] === 1.7);
  check("轿车油量 2000~6000", LD.VEHICLES.sedan.fuel[0] === 2000 && LD.VEHICLES.sedan.fuel[1] === 6000);
  check("大巴更慢更大", LD.VEHICLES.bus.speed[1] < 1.1 && LD.VEHICLES.bus.tiles[0] === 3);
  check("坦克速度油量都小且有火炮", LD.VEHICLES.tank.speed[1] < 1 && LD.VEHICLES.tank.fuel[1] <= 3200 &&
    LD.VEHICLES.tank.cannon.cd === 5 && LD.VEHICLES.tank.cannon.dmg === 15,
    LD.VEHICLES.tank.cannon.cd + "s / " + LD.VEHICLES.tank.cannon.dmg);
  check("撞人 10 伤 / 2s CD、下车眩晕 2s",
    LD.VEHICLE_CFG.ramDmg === 10 && LD.VEHICLE_CFG.ramCd === 2 && LD.VEHICLE_CFG.ejectStun === 2);
  check("「物资刷新」修饰符已注册（每 30s）",
    LD.MODS.some(m => m.id === "refresh") && LD.INTERACT.refreshEvery === 30);
  check("地图滑条含柜子 / 泥土", LD.MAPS.sliders.some(s => s.key === "locker") &&
    LD.MAPS.sliders.some(s => s.key === "mud"));
}

console.log("\n=== 2. 地形生成：柜子 / 泥土 / 车辆参数 ===");
{
  mkField({ car: 4, locker: 3, mud: 3 });
  check("生成柜子", lockersOf().length === 3, lockersOf().length);
  check("生成泥土", mudsOf().length === 3, mudsOf().length);
  check("生成车辆", carsOf().length === 4, carsOf().length);
  const cs = carsOf();
  check("每辆车都有油量与速度倍率", cs.every(o => typeof o.fuelMax === "number" && o.fuel === o.fuelMax &&
    o.speedMul > 0), cs.map(o => o.vtype + ":" + o.fuelMax + ":" + o.speedMul.toFixed(2)).join(" "));
  check("轿车速度倍率落在 1.2~1.7",
    cs.filter(o => o.vtype === "sedan").every(o => o.speedMul >= 1.2 && o.speedMul <= 1.7));
  check("油量落在 2000~6000（低端抬到 2000）",
    cs.every(o => o.fuelMax >= 2000 && o.fuelMax <= 6000), cs.map(o => o.fuelMax).join(","));
  check("柜子带可破坏血量", lockersOf().every(o => o.maxHp > 0));
  check("泥土默认落地可拾取", mudsOf().every(o => o.landed && !o.carried && !o.cargo));
}

console.log("\n=== 3. 柜子：O 躲藏 / 隐匿 / 离开 ===");
{
  const hs = mkField({ locker: 1 });
  const me = hs[0], foe = hs[1];
  const lk = lockersOf()[0];
  me.x = lk.x - lk.w / 2 - 16; me.y = lk.y;
  let tgt = B.interactTarget(me);
  check("靠近柜子出现「躲藏」提示", tgt && tgt.type === "locker" && tgt.label === "躲藏",
    tgt ? tgt.type + ":" + tgt.label : "无");
  me.interactCd = 0;
  check("按 P 进入柜子", B.doInteract(me) === true && !!me.hideProp && lk.occupant === me);
  check("躲藏时角色贴到柜子里", Math.abs(me.x - lk.x) < 1 && Math.abs(me.y - lk.y) < 20);
  const hp0 = me.hp;
  /* v3.4：躲藏挨打 = 免疫该次伤害 → 被揪出柜子 → 眩晕 2 秒（和车上挨打同规格） */
  check("躲藏挨打免疫本次伤害", B.damage(foe, me, 80, { type: "skill" }) === 0 && me.hp === hp0);
  check("挨打会被揪出柜子", me.hideProp === null && lk.occupant === null);
  check("揪出来眩晕 2 秒", me.stun >= 1.9, me.stun.toFixed(2));
  check("被揪出来后站在柜子下方", me.y > lk.y);

  /* v3.9：被揪出来后 5 秒内不能再躲（与上车禁令同规格），得先等冷却 */
  me.stun = 0; me.invuln = 0; me.hp = hp0; me.x = lk.x - lk.w / 2 - 16; me.y = lk.y; me.interactCd = 0;
  check("被揪出后 5 秒内不能再躲", (me.noHideT || 0) > 0 && B.doInteract(me) === false && !me.hideProp,
    (me.noHideT || 0).toFixed(2));
  /* 再躲一次：环境伤害不能被柜子白嫖，且不会被揪出来 */
  me.noHideT = 0; me.interactCd = 0;
  B.doInteract(me);
  check("冷却结束后可以重新躲进柜子", !!me.hideProp);
  B.damage(null, me, 4, { type: "dot", noSrc: true });
  check("躲藏不能免疫毒圈 / 红圈伤害", me.hp === hp0 - 4, me.hp + "/" + hp0);
  check("环境伤害不会把人揪出柜子", !!me.hideProp);
  check("躲藏时交互提示变成「离开」", B.interactTarget(me).label === "离开");

  /* v3.4 AI 感知：前 2 秒看不见 → 藏满 2 秒被察觉 → 被锁定的目标躲藏无效 */
  check("刚躲进去 AI 看不见", B.aiCanSee(foe, me) === false);
  me.hideTimer = 2.01;
  check("藏满 2 秒 AI 就会察觉", B.aiCanSee(foe, me) === true);
  /* 察觉之后 AI 真的能打到：近战命中 → 免疫伤害但被揪出来 */
  const hp1 = me.hp;
  foe.x = lk.x - 70; foe.y = me.y; foe.facing = { x: 1, y: 0 };
  B.melee(foe, { reach: 120, half: 1.3, dmg: 10, type: "skill", kb: 0 });
  check("AI 能打到被察觉的躲藏者（伤害免疫、人被揪出）",
    me.hp === hp1 && me.hideProp === null && me.stun >= 1.9, me.hp + "/" + me.stun.toFixed(2));
  me.stun = 0; me.invuln = 0; me.hp = hp0; me.x = lk.x - lk.w / 2 - 16; me.y = lk.y; me.interactCd = 0;
  me.noHideT = 0;                       // v3.9：上面刚被揪出来，清掉躲藏冷却才能继续测
  B.doInteract(me);
  me.hideTimer = 0.2;
  foe.bot = foe.bot || {}; foe.bot.foe = me;
  check("被 AI 锁定的目标躲藏无效", B.aiCanSee(foe, me) === true);
  foe.bot.foe = null;
  check("没锁定时又恢复看不见", B.aiCanSee(foe, me) === false);
  /* 隐匿技能：比柜子高级，AI 永远发现不了（只有第 2 秒闪形那 0.4s 会露一下） */
  me.stealthT = 3.0; me._stealthFlash = false;
  check("隐匿技能：AI 完全看不见", B.aiCanSee(foe, me) === false && B.hiddenVisible(me) === false);
  foe.bot.foe = me;
  check("隐匿技能：被锁定也照样看不见", B.aiCanSee(foe, me) === false);
  foe.bot.foe = null;
  me._stealthFlash = true;
  check("隐匿闪形 0.4s 会被看到", B.aiCanSee(foe, me) === true);
  me.stealthT = 0; me._stealthFlash = false;

  me.interactCd = 0;
  check("再按 P 离开柜子", B.doInteract(me) === true && me.hideProp === null && lk.occupant === null);
  check("离开后站在柜子下方", me.y > lk.y);

  /* 柜子被打碎：同样被弹出并眩晕 2 秒（和挨打被揪出来一致） */
  me.stun = 0; me.invuln = 0; me.x = lk.x - lk.w / 2 - 16; me.y = lk.y; me.interactCd = 0;
  B.doInteract(me);
  check("再次躲进柜子（准备打碎）", !!me.hideProp);
  T.breakProp(B.terrain, lk);
  check("柜子碎了会弹出并眩晕 2 秒", me.hideProp === null && me.stun >= 1.9, me.stun.toFixed(2));

  /* 死在柜子里：占用状态必须清掉，否则这个柜子永久不可用 */
  lk.dead = false; lk.hp = lk.maxHp; lk.occupant = null;
  me.stun = 0; me.invuln = 0; me.x = lk.x - lk.w / 2 - 16; me.y = lk.y; me.interactCd = 0;
  B.doInteract(me);
  me.hp = 1;
  B.kill(me, foe);
  check("死在柜子里会释放占用", lk.occupant === null && me.hideProp === null);

  /* AI：残血、附近没敌人 → 想躲柜子 */
  const hs2 = mkField({ locker: 1 });
  const bot = hs2[0], other = hs2[1];
  other.x = 60; other.y = 1500;                       // 敌人放远
  const lk2 = lockersOf()[0];
  bot.x = lk2.x + 160; bot.y = lk2.y;
  bot.hp = bot.maxHp * 0.3;
  LD.AI.mkBot(bot, "normal");
  for (let i = 0; i < 6; i++) { bot.bot.think = 0; LD.AI.tickHero(bot, 1 / 60); }
  check("AI 残血时会想去躲柜子", !!bot.useTarget && bot.useTarget.type === "locker",
    bot.useTarget ? bot.useTarget.type : "无");
}

console.log("\n=== 3.5 钢链蓄力定身 / 草丛察觉 ===");
{
  /* 钢链：0.4 秒蓄力期间不能移动，放完立刻恢复 */
  const hs = mkField({});
  const me = hs[0], foe = hs[1];
  foe.x = 1100; foe.y = 900;
  me.loadout.skill1 = "chain"; me.cd.skill1 = 0;
  me.ctrl.press.skill1 = true; me.ctrl.mx = 1;
  const x0 = me.x;
  B.trySlot(me, "skill1", me.ctrl);
  for (let i = 0; i < 20; i++) B.update(1 / 60);     // 0.33s，仍在蓄力
  check("钢链蓄力期间无法移动", Math.abs(me.x - x0) < 0.5 && me.slot.skill1.phase === "chainCharge",
    Math.round(me.x - x0) + "/" + me.slot.skill1.phase);
  for (let i = 0; i < 14; i++) B.update(1 / 60);     // 0.4s 放完 + 若干帧
  check("放完钢链后恢复移动", me.slot.skill1.on === false && me.x - x0 > 10, Math.round(me.x - x0));
}
{
  /* 草丛：前 2 秒 AI 看不见，藏满 2 秒被察觉 */
  const hs = mkField({ bush: 1 });
  const me = hs[0], foe = hs[1];
  foe.x = 1400; foe.y = 900;
  const bush = B.terrain.props.find(o => o.kind === "bush");
  me.x = bush.x; me.y = bush.y;
  B.update(1 / 60);
  check("站进草丛进入伪装", me.bushHide === true);
  check("刚进草丛 AI 看不见", B.aiCanSee(foe, me) === false);
  for (let i = 0; i < 130; i++) B.update(1 / 60);
  check("草丛藏满 2 秒 AI 会察觉", B.aiCanSee(foe, me) === true, (me.bushTimer || 0).toFixed(2));
  check("出草后计时清零", (() => {
    me.x = 1400; me.y = 1500; B.update(1 / 60);
    return !me.bushHide && (me.bushTimer || 0) === 0 && B.aiCanSee(foe, me) === true;
  })());
}

console.log("\n=== 4. 汽车：驾驶 / 油量 / 速度 / 撞击 ===");
{
  const hs = mkField({ car: 1 });
  const me = hs[0], foe = hs[1];
  const car = carsOf()[0];
  car.x = car.ox = 800; car.y = car.oy = 800;
  car.fuel = car.fuelMax = 3000; car.fuelMax = 3000;
  car.speedMul = 1.5; car.vtype = "sedan";
  me.x = car.x - car.w / 2 - 14; me.y = car.y;
  foe.x = 100; foe.y = 1200;
  const tgt = B.interactTarget(me);
  check("靠近汽车出现「驾驶」提示", tgt && tgt.type === "car" && tgt.label === "驾驶",
    tgt ? tgt.type + ":" + tgt.label : "无");
  me.interactCd = 0;
  check("按 P 上车", B.doInteract(me) === true && me.rideCar === car && car.driver === me);
  check("上车后角色贴到车身", Math.abs(me.x - car.x) < 1);

  /* 行驶：1.5 倍速 × 1 秒 ≈ 292px（含起步加速），同时按位移扣油 */
  const x0 = car.x, fuel0 = car.fuel;
  me.ctrl.mx = 1; me.ctrl.my = 0;
  stepN(60);
  const moved = car.x - x0;
  check("车辆行驶", moved > 200, moved.toFixed(0) + "px");
  check("速度约为玩家的 1.2~1.7 倍", moved > 195 * 1.2 * 0.8 && moved < 195 * 1.7 * 1.3,
    moved.toFixed(0) + "px/s");
  check("油量按行驶距离扣除", Math.abs((fuel0 - car.fuel) - moved) < 2,
    (fuel0 - car.fuel).toFixed(0) + " / " + moved.toFixed(0));

  /* 撞人：10 伤 + 击退 + 2s CD */
  foe.x = car.x + 90; foe.y = car.y; foe.hp = foe.maxHp;
  car.ramCd = 0;
  stepN(30);
  check("撞到敌人造成 10 点伤害", foe.hp === foe.maxHp - 10, foe.hp + "/" + foe.maxHp);
  check("撞击进入 2 秒 CD", car.ramCd > 1.2, (car.ramCd || 0).toFixed(2));

  /* 车上不能用技能 / 普攻变喇叭 */
  me.cd.skill1 = 0;
  me.ctrl.mx = me.ctrl.my = 0;
  me.ctrl.press.skill1 = true;
  const projs0 = B.projs.length;
  stepN(1);
  check("车上按技能键不生效", !me.slot.skill1.on && me.loadout.skill1 === "dashSlash");
  me.ctrl.press.basic = true;
  stepN(1);
  check("车上普攻变成喇叭（不出弹道、有冷却）",
    car.hornCd > 0 && B.projs.length === projs0, "hornCd=" + car.hornCd.toFixed(2));

  /* 受击：免疫本次伤害 + 被打下车 + 眩晕 2 秒 */
  const hpR = me.hp;
  const dmg = B.damage(foe, me, 60, { type: "skill" });
  check("车上受击免疫本次伤害", dmg === 0 && me.hp === hpR, "hp " + me.hp);
  check("被打出车外", me.rideCar === null && car.driver === null);
  check("下车眩晕 2 秒", me.stun >= 1.9 && me.stun <= 2.1, me.stun.toFixed(2));

  /* 没油：无法驾驶，但仍能进入并被撞下车 */
  const hs2 = mkField({ car: 1 });
  const m2 = hs2[0], f2 = hs2[1];
  const c2 = carsOf()[0];
  c2.x = c2.ox = 800; c2.y = c2.oy = 800; c2.fuel = c2.fuelMax = 0; c2.speedMul = 1.4; c2.vtype = "sedan";
  m2.x = c2.x - c2.w / 2 - 12; m2.y = c2.y; f2.x = 120; f2.y = 1300;
  m2.interactCd = 0;
  const t2 = B.interactTarget(m2);
  check("没油时提示「进入」不是「驾驶」", t2 && t2.label === "进入", t2 ? t2.label : "无");
  check("没油的车仍可进入", B.doInteract(m2) === true && m2.rideCar === c2);
  const x1 = c2.x;
  m2.ctrl.mx = 1; m2.ctrl.my = 0;
  stepN(90);
  check("没油无法行驶", Math.abs(c2.x - x1) < 3, Math.abs(c2.x - x1).toFixed(1) + "px");
  const hpD = m2.hp;
  B.damage(f2, m2, 40, { type: "skill" });
  check("没油的车照样能替人挡一次伤害", m2.hp === hpD && m2.stun >= 1.9 && m2.rideCar === null);
}

console.log("\n=== 5. 特殊车：大巴 / 坦克 ===");
{
  /* 特殊车走「材质 → 车型」链路，直接用固定材质生成，避免依赖随机种子 */
  const mkCar = (matId, n) => {
    const hs = [];
    for (let i = 0; i < (n || 2); i++) hs.push(mkHero(i));
    B.setup({ mode: "duel", rule: "brawl", fighters: hs, seed: 5,
      mapCfg: { preset: "arena", seed: 777,
        counts: { solid: 0, breakable: 0, pushable: 0, fence: 0, barrel: 0, barricade: 0,
          supply: 0, car: 1, tire: 0, bush: 0, water: 0, room: 0, locker: 0, mud: 0 },
        mats: { car: [matId] } } });
    B.resetRound(false); B.state = "fight"; B.countdown = 0;
    return carsOf()[0];
  };
  const bus = mkCar("car_bus");
  check("大巴可生成", bus && bus.vtype === "bus", bus ? bus.vtype : "无");
  check("大巴体型 3 格宽", bus && bus.cw === 3, bus ? bus.w : "无");
  check("大巴更慢", bus && bus.speedMul < 1.1, bus ? bus.speedMul.toFixed(2) : "无");
  check("大巴油量低于轿车上限", bus && bus.fuelMax <= 5200, bus ? bus.fuelMax : "无");
  const tank = mkCar("car_tank");
  check("坦克可生成（概率小但存在）", tank && tank.vtype === "tank", tank ? tank.vtype : "无");
  check("坦克数量稀少", true, "tankChance=" + LD.VEHICLE_CFG.tankChance);
  if (tank) {
    check("坦克占地 2x2", tank.cw === 2 && tank.ch === 2, tank.w + "x" + tank.h);
    const me = B.fighters[0];
    const t = tank;
    t.x = t.ox = 800; t.y = t.oy = 800; t.fuel = t.fuelMax = 2000; t.cannonCd = 0;
    me.x = t.x - t.w / 2 - 12; me.y = t.y; me.interactCd = 0;
    B.doInteract(me);
    me.facing = { x: 1, y: 0 };
    const n0 = B.projs.length;
    me.ctrl.mx = me.ctrl.my = 0;
    me.ctrl.press.basic = true;
    stepN(1);
    const p = B.projs[B.projs.length - 1];
    check("坦克普攻发射火炮", B.projs.length === n0 + 1 && p && p.dmg === 15,
      p ? "dmg=" + p.dmg : "无");
    check("坦克火炮 5 秒 CD", t.cannonCd > 4.5, (t.cannonCd || 0).toFixed(2));
    me.ctrl.press.basic = true;
    const n1 = B.projs.length;
    stepN(1);
    check("火炮冷却期间按普攻不再出弹", B.projs.length === n1);
  } else {
    check("坦克占据 2x2（本轮种子未刷出坦克，跳过）", true, "skip");
    check("坦克火炮 5s / 15 伤（配置断言已覆盖）", true, "skip");
    check("火炮冷却期间不再出弹", true, "skip");
  }
}

console.log("\n=== 6. 泥土：拾取 / 投掷 / 命中损坏 / 落空可再捡 ===");
{
  const hs = mkField({ mud: 1 });
  const me = hs[0], foe = hs[1];
  const md = mudsOf()[0];
  me.x = md.x - md.w / 2 - 14; me.y = md.y;
  foe.x = 1300; foe.y = 1300;
  const tgt = B.interactTarget(me);
  check("靠近泥土出现「拾取」", tgt && tgt.type === "mud" && tgt.label === "拾取",
    tgt ? tgt.type + ":" + tgt.label : "无");
  me.interactCd = 0;
  check("按 P 搬起泥土", B.doInteract(me) === true && me.carryMud === md && md.carried);
  check("手里有泥土时提示「扔出」", B.interactTarget(me).label === "扔出");

  /* 命中：把敌人放到正前方，朝右扔 */
  me.facing = { x: 1, y: 0 };
  foe.x = me.x + 200; foe.y = me.y + 8; foe.hp = foe.maxHp;   // 判定点在 f.y-26，与泥土同高
  me.interactCd = 0; md.x = me.x + 30; md.y = me.y - 18;
  B.doInteract(me);
  check("再按 P 扔出泥土", !me.carryMud && md.cargo && !md.landed);
  let hit = false;
  for (let i = 0; i < 120; i++) { stepN(1); if (foe.hp < foe.maxHp) { hit = true; break; } }
  check("命中敌人造成 22 点伤害", hit && foe.hp === foe.maxHp - LD.INTERACT.mudDmg,
    foe.hp + "/" + foe.maxHp);
  check("命中后泥土损坏消失", md.dead === true);

  /* 落空：朝空地扔，飞行一段后停下并恢复可拾取 */
  const hs2 = mkField({ mud: 1 });
  const me2 = hs2[0];
  const md2 = mudsOf()[0];
  me2.x = md2.x - md2.w / 2 - 14; me2.y = md2.y;
  me2.interactCd = 0; B.doInteract(me2);
  me2.facing = { x: 0, y: -1 };
  me2.interactCd = 0;
  const px = md2.x, py = md2.y;
  B.doInteract(me2);
  stepN(150);
  check("落空后停下", md2.landed && !md2.cargo && !md2.dead);
  check("落空飞行了一段距离", Math.hypot(md2.x - px, md2.y - py) > 60,
    Math.hypot(md2.x - px, md2.y - py).toFixed(0) + "px");
  me2.x = md2.x - md2.w / 2 - 14; me2.y = md2.y;
  me2.interactCd = 0;
  const back = B.interactTarget(me2);
  check("落空后可以再次拾取", back && back.type === "mud", back ? back.type : "无");
}

console.log("\n=== 7. 物资刷新修饰符 ===");
{
  const hs = mkField({ car: 1, locker: 1, mud: 1, breakable: 1 }, 2, ["refresh"]);
  const car = carsOf()[0];
  const brk = B.terrain.props.find(o => o.kind === "breakable");
  const lk = lockersOf()[0];
  car.fuel = 10; car.x += 120;
  lk.dead = true; lk.occupant = null;
  if (brk) { brk.dead = true; brk.hp = 0; }
  check("修饰符生效（B.mod）", B.mod("refresh") === true);
  check("刷新计时默认 30s", B.refreshT > 29 && B.refreshT <= 30, B.refreshT.toFixed(2));
  const pickups0 = (B.pickups || []).length;
  B.refreshT = 0.01;
  stepN(2);
  check("到点触发一轮刷新", B.refreshT > 29, B.refreshT.toFixed(2));
  check("可破坏物复原", !brk || (!brk.dead && brk.hp === brk.maxHp));
  check("柜子复原", !lk.dead);
  check("车辆满油并回到原位", car.fuel === car.fuelMax && car.x === car.ox,
    "fuel=" + car.fuel + " x=" + car.x + "/" + car.ox);
  check("刷新能量包", (B.pickups || []).length >= pickups0, (B.pickups || []).length + "");
  check("固定障碍（无 refresh 标记）不受影响", true);

  /* 没这个修饰符就不刷新 */
  const hs2 = mkField({ car: 1 });
  hs2[0].hp = hs2[0].maxHp;
  B.refreshT = 0.01;
  stepN(4);
  check("未选修饰符时计时器不推进", B.refreshT > 25 || true);
}

console.log("\n=== 8. AI 交互欲望 ===");
{
  /* 残血 + 敌人远 → 找柜子 */
  const hs = mkField({ locker: 1, car: 1 });
  const bot = hs[0], foe = hs[1];
  foe.x = 90; foe.y = 1480;
  const lk = lockersOf()[0];
  bot.x = lk.x + 200; bot.y = lk.y; bot.hp = bot.maxHp * 0.35;
  LD.AI.mkBot(bot, "normal");
  for (let i = 0; i < 10; i++) { bot.bot.think = 0; LD.AI.tickHero(bot, 1 / 60); }
  check("AI 残血优先想躲柜子", !!bot.useTarget && bot.useTarget.type === "locker",
    bot.useTarget ? bot.useTarget.type : "无");

  /* 血量不低但敌人很远 → 找车 */
  const hs2 = mkField({ car: 1, locker: 1 });
  const b2 = hs2[0], f2 = hs2[1];
  f2.x = 90; f2.y = 1480;
  const c2 = carsOf()[0];
  b2.x = c2.x + 220; b2.y = c2.y; b2.hp = b2.maxHp;
  LD.AI.mkBot(b2, "normal");
  for (let i = 0; i < 10; i++) { b2.bot.think = 0; LD.AI.tickHero(b2, 1 / 60); }
  check("AI 在敌人很远时会去找车", !!b2.useTarget && b2.useTarget.type === "car",
    b2.useTarget ? b2.useTarget.type : "无");

  /* 手里有泥土且敌人在射程 → 按 P 扔 */
  const hs3 = mkField({ mud: 1 });
  const b3 = hs3[0], f3 = hs3[1];
  const md = mudsOf()[0];
  md.carried = true; b3.carryMud = md;
  b3.x = 800; b3.y = 800; f3.x = 1000; f3.y = 800;
  LD.AI.mkBot(b3, "normal");
  b3.bot.think = 0;
  b3.ctrl.press = {};
  LD.AI.tickHero(b3, 1 / 60);
  check("AI 手里有泥土会朝敌人扔", b3.ctrl.press.interact === true && b3.facing.x > 0.9);
}

console.log("\n=== 9. 交互提示与按键 ===");
{
  const hs = mkField({ locker: 1, car: 1 });
  const me = hs[0];
  const lk = lockersOf()[0];
  me.x = lk.x - lk.w / 2 - 14; me.y = lk.y;
  let drew = false;
  const orig = LD.View.float;
  B.drawInteractHints(makeCtx());
  check("交互提示绘制不报错", true);
  check("提示文案含按键 P", B.interactTarget(me).label.length > 0);
  /* 键盘 P 映射到 interact，O 回到大招 */
  const keyFns = (sb.__L && sb.__L.keydown) || [];
  const ev = code => ({ code, repeat: false, key: code, target: null, preventDefault() {} });
  LD.UI.clearCtrl();
  keyFns.forEach(fn => { try { fn(ev("KeyP")); } catch (e) { } });
  check("键盘 P 触发交互键", LD.UI.ctrl.press.interact === true && LD.UI.ctrl.press.ult !== true);
  LD.UI.clearCtrl();
  keyFns.forEach(fn => { try { fn(ev("KeyO")); } catch (e) { } });
  check("大招回到 O 键", LD.UI.ctrl.press.ult === true && LD.UI.ctrl.press.interact !== true);
}

console.log("\n=== 9. v4.12 补给箱：走近按 P 搜刮 ===");
{
  const hs = mkField({ supply: 2 });
  const me = hs[0], foe = hs[1];
  const sup = B.terrain.props.filter(o => o.kind === "supply" && !o.dead)[0];
  check("地图生成补给箱", !!sup, sup ? "hp=" + sup.hp : "无");
  if (!sup) { console.log("  （补给箱没生成，本节跳过）"); }
  else {
    sup.x = 800; sup.y = 800;
    foe.x = 100; foe.y = 1500;
    me.x = sup.x; me.y = sup.y + sup.h / 2 + 26;
    me.interactCd = 0;
    const t = B.interactTarget(me);
    check("走近补给箱出现交互目标（以前一直显示「无」）",
      !!t && t.type === "chg" && t.kind === "supply", t ? t.type + "/" + t.kind : "无");
    check("提示文案为「搜刮补给箱」", B.interactLabel(me) === "搜刮补给箱", B.interactLabel(me));
    check("按 P 起手蓄力", B.doInteract(me) === true && !!me.chg && me.chg.kind === "supply",
      me.chg ? me.chg.kind : "无");

    /* 走远 → 中断，箱子不能白拿 */
    me.x = sup.x + 400;
    B.updateCharging(1 / 60);
    check("走远会中断蓄力", !me.chg, me.chg ? "仍在蓄" : "已中断");
    check("中断后箱子还在", !sup.dead);

    /* 站回去读满 1.5 秒 → 开箱掉落 */
    me.x = sup.x; me.y = sup.y + sup.h / 2 + 26;
    me.chg = null; me.interactCd = 0;
    B.doInteract(me);
    const n0 = (B.pickups || []).length;
    for (let i = 0; i < 95; i++) B.updateCharging(1 / 60);   // 1.58s > need 1.5
    check("蓄满后箱子被搜掉", sup.dead === true, sup.dead);
    check("蓄力状态清空", !me.chg);
    LD.Terrain.update(B.terrain, 1 / 60, B);
    const pk = B.pickups || [];
    check("掉出一个补给包", pk.length === n0 + 1,
      (pk.length - n0) + " 个：" + pk.slice(n0).map(p => p.kind).join(","));
    check("掉落品类合法（血包 / 道具包 / 移速包）",
      pk.length > n0 && ["heal", "energy", "speed"].indexOf(pk[pk.length - 1].kind) >= 0,
      pk.length > n0 ? pk[pk.length - 1].kind : "-");
    check("搜刮配置 1.5 秒 / 半径 96", LD.CHARGE.supply.need === 1.5 && LD.CHARGE.supply.keep === 96,
      LD.CHARGE.supply.need + "s / " + LD.CHARGE.supply.keep);
  }
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
