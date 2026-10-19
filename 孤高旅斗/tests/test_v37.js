/* 孤高旅斗 v3.7 塔防对战测试
 * 覆盖：P 键交互 / 天外来物按 P 拾取与替换 / 柜子躲藏（被打出来 + AI 2 秒察觉）/
 *       汽车驾驶（油量·速度·撞人·下车眩晕·技能禁用·喇叭·坦克炮）/
 *       泥土拾取投掷 / 物资刷新修饰符 / AI 交互欲望 / 交互提示文案
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
const LD = sb.LD, B = LD.Battle, T = LD.Terrain;
LD.CONF.critRate = 0;
const C = LD.TOWER;
const BASE = { basic: "slash", skill1: "dashSlash", skill2: "chain", ult: "bloodRage" };

function mkHero(side, lo) {
  const f = B.mkHero(side, { x: 0, y: 0, look: LD.Profile.look(), loadout: lo || BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
function field(n, bots, teams) {
  const fs2 = [];
  for (let i = 0; i < (n || 6); i++) {
    const f = mkHero(i);
    if (bots && i > 0) LD.AI.mkBot(f, "normal");
    fs2.push(f);
  }
  B.setup({ mode: "duel", rule: "tower", fighters: fs2, isHost: true, mySide: 0, matchT: 600, teams: teams });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0; B.roundT = 0;
  fs2.forEach(f => { f.invuln = 0; });
  return fs2;
}
const propsOf = kind => B.terrain.props.filter(o => o.kind === kind && !o.dead);
const step = dt => B.update(dt || 1 / 60);
const stepN = n => { for (let i = 0; i < n; i++) step(); };

console.log("=== 1. 配置 / 地图 / 分队 ===");
{
  check("规则表里有塔防对战", LD.RULES.some(r => r.id === "tower"));
  check("地图 2800 x 600", C.world.w === 2800 && C.world.h === 600, C.world.w + "x" + C.world.h);
  check("兵线 400 / 建筑抬高 110", C.laneY === 400 && C.structDy === 110);
  const hs = field(6, false);
  check("双方各一座水晶", propsOf("crystal").length === 2);
  check("双方各两座防御塔", propsOf("tower").length === 4);
  const cr = propsOf("crystal").sort((a, b) => a.side - b.side);
  check("水晶左右镜像", Math.abs((cr[0].x + cr[1].x) - B.world.w) < 2, cr[0].x + "/" + cr[1].x);
  const ts = propsOf("tower").sort((a, b) => a.side - b.side || a.x - b.x);
  check("一塔之间留出中心战斗区（≥500px）", Math.abs(ts[1].x - ts[2].x) >= 500, ts.map(o => o.x).join(","));
  check("3v3 分队：前三红队 / 后三蓝队", hs.every((f, i) => f.team === (i < 3 ? 0 : 1)), hs.map(f => f.team).join(","));
  check("开局金币 200 / 等级 1 / 死亡 0", hs.every(f => f.bcoins === 200 && f.level === 1 && f.deaths === 0));
  check("塔防保留大招", hs.every(f => !!f.loadout.ult));
  check("英雄出生在自家基地附近", hs[0].x < 260 && hs[5].x > B.world.w - 260,
    Math.round(hs[0].x) + " / " + Math.round(hs[5].x));
  check("中心没有猴子了", propsOf("monkey").length === 0);
  check("塔 1500 血 / 水晶 3000 血", C.tower.hp === 1500 && C.crystal.hp === 3000);
  check("塔/水晶射程 300 / 340", C.tower.range === 300 && C.crystal.range === 340);
  check("建筑弹道高速且带追踪", C.tower.projSpeed >= 1000 && C.tower.homing > 0 && C.crystal.homing > 0);
  check("地图会生成随机设施（含车辆/坦克的可能）",
    B.terrain.props.some(o => ["solid", "breakable", "bush", "barrel", "car", "barricade", "pushable", "tire"].indexOf(o.kind) >= 0));
}

console.log("\n=== 2. 建筑：可破坏 / 水晶保护 ===");
{
  field(2, false);
  const cry = propsOf("crystal").find(o => o.side === 1);
  const towers = propsOf("tower").filter(o => o.side === 1);
  const hp0 = cry.hp;
  T.hitProp(B.terrain, cry, 200, { dir: 0 });
  check("防御塔还在时水晶免疫伤害", cry.hp === hp0, cry.hp + "/" + hp0);
  towers.forEach(o => { T.hitProp(B.terrain, o, 99999, { dir: 0 }); });
  check("防御塔可以被破坏", towers.every(o => o.dead));
  T.hitProp(B.terrain, cry, 200, { dir: 0 });
  check("塔倒后水晶可以被打", cry.hp === hp0 - 200, cry.hp);
  T.hitProp(B.terrain, cry, 99999, { dir: 0 });
  check("水晶被拆 → 对局结束", cry.dead && B.state === "over");
  check("胜利方是进攻方", B.matchWinner === 0, B.matchWinner);
}

console.log("\n=== 3. 防御塔 / 水晶开火 ===");
{
  const hs = field(2, false);
  const foe = hs[1];
  const tower = propsOf("tower").find(o => o.side === 0);
  B.projs.length = 0; tower.shotT = 0;
  foe.x = tower.x + tower.w / 2 + 120; foe.y = tower.y;
  foe.invuln = 0;
  stepN(2);
  check("进入圆圈范围的敌人被锁定", tower._target === foe, tower._target && tower._target.name);
  const bolt = B.projs.find(p => p.type === "towerbolt");
  check("射出追踪炮弹", !!bolt && bolt.homing > 0 && bolt.data.tgt === foe,
    bolt ? "speed=" + Math.round(Math.hypot(bolt.vx, bolt.vy)) + " homing=" + bolt.homing : "没出弹");
  check("炮弹速度 ≥1000", bolt && Math.hypot(bolt.vx, bolt.vy) >= 1000);
  const hpA = foe.hp;
  B.damage(tower.src || B.towerSrc(tower), foe, 26, { type: "skill", proj: true });
  check("炮弹按配置伤害结算", foe.hp === hpA - 26, hpA + " → " + foe.hp);
  foe.x = tower.x + 900; foe.y = tower.y;
  stepN(16);
  check("离开范围后不再锁定", !tower._target);
}

console.log("\n=== 4. 兵线 ===");
{
  const hs = field(6, false);
  check("开局 9 秒内没有小兵", B.fighters.every(f => f.kind !== "laneMinion"));
  for (let i = 0; i < 9 * 60; i++) step();
  check("9 秒还没刷", B.fighters.every(f => f.kind !== "laneMinion"));
  stepN(70);
  const ms = B.fighters.filter(f => f.kind === "laneMinion");
  check("10 秒刷第一波：双方各 6 只", ms.filter(m => m.team === 0).length === 6 && ms.filter(m => m.team === 1).length === 6, ms.length);
  check("小兵血量改成原来的 70%（67）", ms[0].maxHp === 67, ms[0].maxHp);
  const x0 = ms[0].x;
  stepN(60);
  check("小兵沿兵线推进", Math.abs(ms[0].x - x0) > 20, Math.round(ms[0].x - x0) + "px");
}

console.log("\n=== 5. 金币 / 经验 / 等级 ===");
{
  const hs = field(2, false);
  const me = hs[0];
  me.bcoins = 200; me.xp = 0; me.level = 1;
  B.spawnTowerWave(0);
  const mm = B.fighters.filter(f => f.kind === "laneMinion" && f.team === 0)[0];
  B.kill(mm, me);
  check("击杀小兵 +32 金币", me.bcoins === 232, me.bcoins);
  check("击杀小兵 +20 经验", me.xp === 20, me.xp);
  B.towerXp(me, 80);
  check("满 100 经验升到 2 级", me.level === 2 && me.maxHp === LD.CONF.hero.hp + C.levelHp);
  const hs3 = field(3, false);
  const A = hs3[0], mate = hs3[1], foe = hs3[2];
  B.damage(mate, foe, 10, { type: "skill" });
  B.damage(A, foe, 9999, { type: "skill" });
  check("击杀英雄 +240", A.bcoins >= 440, A.bcoins);
  check("助攻 +120", mate.bcoins >= 320, mate.bcoins);
  check("队伍击杀计分", B.tScore[0] === 1, B.tScore.join(":"));
  check("击杀者 K / 阵亡者 D 有记录", A.kills === 1 && foe.deaths === 1, A.kills + "/" + foe.deaths);
}

console.log("\n=== 6. 局内装备 ===");
{
  const hs = field(2, false);
  const me = hs[0];
  me.bcoins = 9999; me.items = {}; me.activeItem = null; me.dmgBonus = 0; me.dr = 0;
  const hp0 = me.maxHp;
  check("生命宝石 +160", B.towerBuy(me, "hp") && me.maxHp === hp0 + 160);
  check("不能重复购买被动", B.towerBuy(me, "hp") === false);
  check("力量护腕 +18% 伤害", B.towerBuy(me, "atk") && Math.abs(me.dmgBonus - 0.18) < 1e-6);
  check("能量水晶：能量获取 +15%", B.towerBuy(me, "energy") && Math.abs(me.energyMul - 1.15) < 1e-6, me.energyMul);
  check("钢甲：飞行物减伤 20%", B.towerBuy(me, "steel") && Math.abs(me.projDR - 0.20) < 1e-6);
  check("魔法斗篷：12% 闪避", B.towerBuy(me, "cloak") && Math.abs(me.dodgeChance - 0.12) < 1e-6);
  check("续航宝石 / 还魂曲 / 敢死队已上架",
    ["regen", "requiem", "brave"].every(id => !!LD.towerItem(id)));
  check("主动装备只能带一件", B.towerBuy(me, "heal") && B.towerBuy(me, "bomb") === false);
  me.hp = 10;
  check("按 P 释放治疗", B.useTowerActive(me) && me.hp > 10 && me.activeCd > 0);
  /* 高压弹 */
  const hs2 = field(2, false);
  const m2 = hs2[0];
  m2.items = {}; m2.activeItem = "bomb"; m2.bcoins = 999;
  m2.x = 700; m2.y = C.laneY;
  B.dropBomb(m2);
  const foe2 = hs2[1];
  foe2.team = 1; foe2.x = 730; foe2.y = C.laneY; foe2.hp = 200; foe2.invuln = 0;
  const hpB = foe2.hp;
  for (let i = 0; i < 200; i++) step();
  check("高压弹 3 秒后爆炸并造成 100 伤害", foe2.hp <= hpB - 100, hpB + " → " + foe2.hp);
  /* 刺甲 */
  const f3 = field(2, false)[0];
  f3.reflectT = 4; f3.hp = 200;
  const e3 = B.fighters[1]; e3.team = 1; e3.hp = 200; e3.invuln = 0;
  const hpE = e3.hp;
  B.damage(e3, f3, 40, { type: "skill" });
  check("刺甲反弹 50% 伤害", e3.hp === hpE - 20 && f3.hp === 200 - 40, "对方 " + e3.hp + " 自己 " + f3.hp);
  /* 寒霜 */
  const f4 = field(2, false)[0];
  f4.activeItem = "frost"; f4.activeCd = 0;
  const e4 = B.fighters[1]; e4.team = 1; e4.x = f4.x + 40; e4.y = f4.y;
  B.useTowerActive(f4);
  check("寒霜冻结身边敌人 2.5 秒", e4.stun >= 2.4, e4.stun.toFixed(1));
  /* 团队强化 */
  const f5 = field(6, false)[0];
  f5.bcoins = 9999;
  for (let i = 0; i < 5; i++) B.towerBuy(f5, "minionHp");
  check("强化小兵血量可叠 5 层", B.towerStack(f5, "minionHp") === 5, B.towerStack(f5, "minionHp"));
  check("叠满后不能再买", B.towerBuy(f5, "minionHp") === false);
  B.towerBuy(f5, "minionAtk");
  check("强化小兵攻击单独计层", B.towerStack(f5, "minionAtk") === 1);
  B.spawnTowerWave(0);
  const up = B.fighters.filter(f => f.kind === "laneMinion" && f.team === 0).pop();
  check("强化后小兵更肉更疼", up.maxHp > 67 && up.dmg > 9, up.maxHp + "hp / " + up.dmg + "atk");
  /* v3.9 汽油桶：只有车上能买，80 金 +2000 油，无限买 */
  const fuel = LD.towerItem("fuel");
  check("汽油桶已上架（团队道具，80 金）", !!fuel && fuel.price === 80 && LD.TOWER.fuel.add === 2000);
  const f6 = field(2, false)[0];
  f6.bcoins = 9999; f6.items = {}; f6.activeItem = null;
  check("没上车买不了汽油桶", B.towerBuy(f6, "fuel") === false);
  const car = B.terrain.props.find(o => o.kind === "car");
  check("地图上至少有一辆车", !!car, car && car.vtype);
  if (car) {
    f6.rideCar = car;
    const gold0 = f6.bcoins;
    car.fuelMax = 3000; car.fuel = 1000;
    check("车上买汽油桶 +2000 油", B.towerBuy(f6, "fuel") && car.fuel === 3000, car.fuel);
    check("汽油桶扣 80 金", f6.bcoins === gold0 - 80, f6.bcoins);
    check("油箱已满时不能再买", B.towerBuy(f6, "fuel") === false);
    car.fuel = 0;
    for (let i = 0; i < 3; i++) B.towerBuy(f6, "fuel");
    check("汽油桶可以无限买（不占装备格）", car.fuel === 3000 && !(f6.items || {}).fuel, car.fuel);
    f6.rideCar = null;
  }
}

console.log("\n=== 7. 复活 / 墓碑 ===");
{
  const hs = field(2, false);
  const me = hs[0], foe = hs[1];
  me.team = 0; foe.team = 1;
  me.hp = 1; me.x = 800; me.y = C.laneY;
  B.damage(foe, me, 999, { type: "skill" });
  check("阵亡进入复活倒计时（8 + 等级×2.2）", me.dead && me.respawnT >= 9.9, me.respawnT.toFixed(1) + "s");
  check("原地留下墓碑", (B.graves || []).some(g => g.hero === me && Math.abs(g.x - 800) < 1));
  const waitFrames = Math.ceil(me.respawnT * 60) + 12;   // 先算好帧数，别在循环条件里读会变化的 respawnT
  for (let i = 0; i < waitFrames; i++) step();
  check("倒计时结束在基地复活", !me.dead && me.hp === me.maxHp && me.x < 260);
  check("墓碑消失", !(B.graves || []).some(g => g.hero === me));
  check("复活后短暂无敌", me.invuln > 0, me.invuln.toFixed(1));
  /* v3.9 基地回血大幅提高：12% 最大生命 / 秒 */
  const me2 = field(2, false)[0];
  const base = B.towerBase(me2.team === 1 ? 1 : 0);
  me2.x = base.x; me2.y = base.y; me2.hp = 60;
  const before = me2.hp;
  stepN(60);
  check("基地回血 12% / 秒", me2.hp - before >= me2.maxHp * 0.11, Math.round(me2.hp - before) + " / " + Math.round(me2.maxHp));
}

console.log("\n=== 8. 无时限 ===");
{
  const hs = field(2, false);
  check("塔防没有时间限制", C.matchT === 0 && (B.towerT || 0) === 0);
  B.tScore = [3, 1];
  stepN(60 * 5);
  check("打了 5 分钟仍不结算（只有水晶能结束）", B.state === "fight" && B.matchWinner === -1);
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
