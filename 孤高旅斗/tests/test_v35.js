/* 孤高旅斗 v3.5 测试
 * 覆盖：人机随机外观（图片皮肤带 img / 头部模型兜底）/
 *       吹风机（生成·朝向·气流·吹开·打坏停风）/
 *       车辆受击漏油（1 伤 = 20 油）/ 命中藏人柜子会把人揪出来 /
 *       丧尸尸体上限 10 具
 */
const fs = require("fs"), vm = require("vm");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let CLK = 0;
function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
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

const BASE = { basic: "slash", skill1: null, skill2: null, ult: null };
function mkHero(side, lo) {
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(), loadout: lo || BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
const ALL_ZERO = { solid: 0, breakable: 0, pushable: 0, fence: 0, barrel: 0, barricade: 0,
  supply: 0, car: 0, tire: 0, bush: 0, water: 0, room: 0, locker: 0, mud: 0, blower: 0 };
function setup(counts, bots) {
  const fs2 = [mkHero(0), mkHero(1)];
  B.setup({ mode: "duel", rule: "brawl", fighters: fs2,
    mapCfg: { preset: "arena", seed: 20240318, counts: Object.assign({}, ALL_ZERO, counts || {}) } });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  fs2.forEach(f => { f.hp = f.maxHp; f.invuln = 0; });
  if (bots) fs2[1].bot = null;
  return fs2;
}
const propsOf = kind => B.terrain.props.filter(o => o.kind === kind && !o.dead);
const stepN = n => { for (let i = 0; i < n; i++) B.update(1 / 60); };

console.log("=== 1. 人机随机外观 ===");
{
  check("随机外观接口存在", typeof LD.randomLook === "function");
  const headSkin = LD.partsBy("head").find(p => p.img);
  const lowerSkin = LD.partsBy("lower").find(p => p.img);
  check("部件目录里确实有图片皮肤（缺头 / 缺裤子的来源）", !!headSkin && !!lowerSkin,
    (headSkin && headSkin.id) + "/" + (lowerSkin && lowerSkin.id));
  let missingHead = 0, imgSeen = 0, brokenImg = 0;
  for (let i = 0; i < 400; i++) {
    const l = LD.randomLook();
    if (!l.head || !l.head.model) missingHead++;
    if (l.head.img || l.upper.img || l.lower.img) imgSeen++;
    ["head", "upper", "lower"].forEach(k => {
      if (l[k].img && typeof l[k].img !== "string") brokenImg++;
    });
  }
  check("随机外观 400 次都有头部模型（不再缺头）", missingHead === 0, missingHead);
  check("随机外观会抽到图片皮肤并保留 img", imgSeen > 0 && brokenImg === 0, "img=" + imgSeen);
  const l2 = LD.randomLook();
  check("上衣 / 裤子都带绘制所需字段",
    l2.upper && l2.lower && typeof l2.upper.c1 === "string" && typeof l2.lower.c1 === "string");
}

console.log("\n=== 2. 吹风机：生成 / 气流 / 吹开 ===");
{
  check("地图滑条含吹风机", LD.MAPS.sliders.some(s => s.key === "blower"));
  check("吹风机血量 110 / 风力 420", LD.BLOWER.hp === 110 && LD.BLOWER.force === 420, LD.BLOWER.force);
  const hs = setup({ blower: 3 });
  const bs = propsOf("blower");
  check("生成 3 台吹风机", bs.length === 3, bs.length);
  check("每台都有朝向与 2~6 格气流",
    bs.every(o => o.dir >= 0 && o.dir <= 3 && o.len >= 2 && o.len <= 6),
    bs.map(o => o.dir + "/" + o.len).join(" "));
  check("机身可破坏、挡人不挡气流", bs.every(o => o.maxHp === 110 && o.blockMove && o.damageable !== false));

  const o = bs[0];
  const d = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }][o.dir];
  const ax = o.x + d.x * (o.len * 40 * 0.5), ay = o.y + d.y * (o.len * 40 * 0.5);
  const w = T.windAt(B.terrain, ax, ay);
  check("气流里能读到风力", !!w && (w.x !== 0 || w.y !== 0), JSON.stringify(w));
  check("风向与机身朝向一致",
    !!w && Math.sign(w.x) === d.x && Math.sign(w.y) === d.y, JSON.stringify(d) + " → " + JSON.stringify(w));
  check("机身背后没有风", T.windAt(B.terrain, o.x - d.x * 100, o.y - d.y * 100) === null);

  const me = hs[0];
  me.x = ax; me.y = ay; me.ctrl.mx = me.ctrl.my = 0;
  const x0 = me.x, y0 = me.y;
  for (let i = 0; i < 45; i++) B.update(1 / 60);
  const moved = (me.x - x0) * d.x + (me.y - y0) * d.y;
  check("站在气流里会被顺着风向吹开", moved > 40, Math.round(moved) + "px");

  T.hitProp(B.terrain, o, 999, { dir: 0 });
  check("打坏吹风机后停风", o.dead && T.windAt(B.terrain, ax, ay) === null,
    "打坏前有风 → " + (T.windAt(B.terrain, ax, ay) ? "有风" : "无风"));
}

console.log("\n=== 3. 车辆受击漏油 ===");
{
  check("车辆配置：1 伤害 = 20 油", LD.VEHICLE_CFG.fuelPerDmg === 20);
  setup({ car: 1 });
  const car = propsOf("car")[0];
  const f0 = car.fuel;
  T.hitProp(B.terrain, car, 10, { dir: 0 });
  check("车体吃 10 点伤害 → 油量 -200", f0 - car.fuel === 200, f0 + " → " + car.fuel);
  T.hitProp(B.terrain, car, 5, { dir: 0 });
  check("再吃 5 点 → 再 -100", f0 - car.fuel === 300, car.fuel);
  T.hitProp(B.terrain, car, 9999, { dir: 0 });
  check("油量不会变成负数", car.fuel === 0);
  B.refreshField();
  check("物资刷新后满油复活", car.fuel === car.fuelMax, car.fuel);

  /* v3.6：车体吃弹 → 驾驶员被震出车外（免疫这一下 + 眩晕 2 秒） */
  const hs = setup({ car: 1 });
  const me = hs[0], foe = hs[1];
  const c2 = propsOf("car")[0];
  c2.x = c2.ox = 800; c2.y = c2.oy = 1400; c2.fuel = c2.fuelMax = 5000;
  me.x = c2.x - c2.w / 2 - 14; me.y = c2.y; me.interactCd = 0; me.invuln = 0;
  B.doInteract(me);
  const hpC = me.hp, fC = c2.fuel;
  T.hitProp(B.terrain, c2, 10, { dir: 0, src: foe });
  check("打中载人的车 → 驾驶员被震下车", me.rideCar === null && c2.driver === null);
  check("震下车免疫这次伤害（血量不变）", me.hp === hpC, me.hp + "/" + hpC);
  check("震下车眩晕 2 秒", me.stun >= 1.9 && me.stun <= 2.1, me.stun.toFixed(2));
  check("车体本身照常漏油", fC - c2.fuel === 200, c2.fuel);

  /* 同队打自己的车不该把人震下来 */
  const hs2 = setup({ car: 1 });
  const me2 = hs2[0], mate = hs2[1];
  const c3 = propsOf("car")[0];
  c3.x = c3.ox = 800; c3.y = c3.oy = 1400; c3.fuel = c3.fuelMax = 5000;
  me2.x = c3.x - c3.w / 2 - 14; me2.y = c3.y; me2.interactCd = 0; me2.invuln = 0;
  B.doInteract(me2);
  me2.side = mate.side = 0; me2.team = mate.team = 0;   // 同队
  T.hitProp(B.terrain, c3, 10, { dir: 0, src: mate });
  check("同队攻击自己的车不会把人震下来", me2.rideCar === c3 && c3.driver === me2);
}

console.log("\n=== 3.5 AI 把车上的人打下来 ===");
{
  /* v3.6：车体挡弹道，原来远程人机的攻击全被车皮吃掉、还会绕着车兜圈。
   * 现在车体吃弹会震人下车，AI 也应该贴上去、CD 好就放。 */
  const hs = setup({ car: 1 });
  const me = hs[0], ai = hs[1];
  const car = propsOf("car")[0];
  car.x = car.ox = 800; car.y = car.oy = 1400; car.fuel = car.fuelMax = 5000;
  me.x = car.x - car.w / 2 - 14; me.y = car.y; me.interactCd = 0; me.invuln = 0;
  B.doInteract(me);
  check("先上车（未被打下来）", !!me.rideCar);
  ai.x = 1100; ai.y = 1400; ai.invuln = 0;
  LD.AI.mkBot(ai, "normal");
  ai.loadout = { basic: "fireball", skill1: "laserWave", skill2: null, ult: null };
  ai.cd.basic = 0; ai.cd.skill1 = 0; ai.energy = 0;
  let ejT = -1, fireDist = -1;
  for (let i = 0; i < 240; i++) {
    ai.ctrl.press = {}; ai.ctrl.hold = {}; ai.ctrl.mx = ai.ctrl.my = 0;
    me.ctrl.mx = me.ctrl.my = 0;
    LD.AI.tickHero(ai, 1 / 60);
    if (fireDist < 0 && (ai.ctrl.press.basic || ai.ctrl.press.skill1 || ai.ctrl.press.skill2)) {
      fireDist = Math.hypot(me.x - ai.x, me.y - ai.y);
    }
    B.update(1 / 60);
    if (!me.rideCar) { ejT = i / 60; break; }
  }
  check("远程 AI 4 秒内把驾驶员打下车", ejT >= 0 && ejT < 4, ejT < 0 ? "没打下来" : ejT.toFixed(2) + "s");
  check("打下车后不再对着空车输出", !me.rideCar && !car.driver);
  /* 旧逻辑里「目标的车」被当成挡视线的障碍，150px 外一律不开远程攻击 */
  check("不会被目标自己的车挡视线（>150px 就敢开火）", fireDist > 150, fireDist < 0 ? "没开过火" : Math.round(fireDist) + "px");
}

console.log("\n=== 4. 攻击命中藏人的柜子 ===");
{
  const hs = setup({ locker: 1 });
  const me = hs[0], foe = hs[1];
  const lk = propsOf("locker")[0];
  me.x = lk.x - lk.w / 2 - 16; me.y = lk.y; me.interactCd = 0; me.invuln = 0;
  B.doInteract(me);
  check("先躲进柜子", !!me.hideProp && lk.occupant === me);
  const hp0 = me.hp;
  T.hitProp(B.terrain, lk, 12, { dir: 0 });
  check("打柜子 = 把里面的人揪出来（免疫这次伤害）",
    me.hideProp === null && lk.occupant === null && me.hp === hp0);
  check("揪出来后眩晕 2 秒", me.stun >= 1.9, me.stun.toFixed(2));
  check("柜子本身照常掉血", lk.hp < lk.maxHp, lk.hp + "/" + lk.maxHp);

  /* AI 实战：远程人机面对躲藏者，不能因为「柜子挡视线」发呆 */
  const hs2 = setup({ locker: 1 });
  const me2 = hs2[0], ai = hs2[1];
  const lk2 = propsOf("locker")[0];
  LD.AI.mkBot(ai, "normal");
  ai.loadout = { basic: "fireball", skill1: null, skill2: null, ult: null };
  ai.cd.basic = 0; ai.energy = 0;
  me2.x = lk2.x - lk2.w / 2 - 16; me2.y = lk2.y; me2.interactCd = 0;
  B.doInteract(me2);
  ai.x = lk2.x + 320; ai.y = lk2.y;
  const lhp0 = lk2.hp;
  for (let i = 0; i < 600; i++) {
    if (!ai.dead) LD.AI.tickHero(ai, 1 / 60);
    B.update(1 / 60);
    if (!me2.hideProp) break;
  }
  check("远程 AI 会朝藏人的柜子开火（不再发呆）",
    lk2.hp < lhp0 || !me2.hideProp, lk2.hp + "/" + lhp0);
  check("被打中后不会一直躲在柜子里", !me2.hideProp, me2.hideProp ? "仍在柜中" : "已出来");
}

console.log("\n=== 5. 丧尸尸体上限 ===");
{
  check("配置上限 10 具", LD.ZOMBIE.maxCorpses === 10);
  setup({});
  const list = [];
  for (let i = 0; i < 14; i++) {
    const z = B.mkZombie(600 + i * 12, 800);
    B.fighters.push(z);
    list.push(z);
  }
  list.forEach((z, i) => { B.t = i * 0.1; B.kill(z, null); });
  const dead = list.filter(z => z.dead);
  const gone = list.filter(z => z.corpseGone);
  const kept = list.filter(z => z.dead && !z.corpseGone);
  check("14 只全部阵亡", dead.length === 14, dead.length);
  check("只保留 10 具尸体", kept.length === 10, kept.length);
  check("消失的是最早的 4 具", gone.length === 4 && list.slice(0, 4).every(z => z.corpseGone),
    gone.map(z => list.indexOf(z)).join(","));
  check("后面的新尸体都还在", list.slice(4).every(z => !z.corpseGone));
}

console.log("\n" + (fail ? "失败 " + fail + " 项" : "全部通过") + "：通过 " + pass + " 项");
process.exit(fail ? 1 : 0);
