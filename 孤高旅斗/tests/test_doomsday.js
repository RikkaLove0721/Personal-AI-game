/* 孤高旅斗 v4.0 世界末日测试
 * 覆盖：模式注册 / 悬崖地图三块陆地（左岛 + 独木桥 + 右大陆）/ 出生在庇护所 /
 *       崖外夹取（位移与击退都出不去）/ 僵尸只刷大陆 / 僵尸过桥减速 /
 *       庇护所回血 / 全员同队 / 伤害与击杀计分 / 僵尸掉金币 / 渲染不崩
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
  sb.window = sb; sb.globalThis = sb;
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
function setupDoom(n, lo) {
  const fs2 = [];
  for (let i = 0; i < n; i++) fs2.push(mkHero(i, lo));
  B.setup({ mode: "duel", rule: "doomsday", fighters: fs2, isHost: true, mySide: 0 });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0; B.doomTick = null;
  return fs2;
}

console.log("=== 1. 模式与参数 ===");
{
  const ri = LD.ruleInfo("doomsday");
  check("「世界末日」已注册", ri.id === "doomsday" && ri.name === "世界末日", ri.icon + " " + ri.name);
  const D = LD.DOOMSDAY;
  check("地图放大到 2600x1180（横向长图）", D.world.w === 2600 && D.world.h === 1180,
    D.world.w + "x" + D.world.h);
  check("独木桥 10 格长 x 2 格宽", D.bridge.len === 10 && D.bridge.wide === 2);
  check("僵尸过桥减速 70%", Math.abs(D.bridgeSlow - 0.3) < 1e-6 && Math.abs(D.gateSlow - 0.3) < 1e-6);
  check("右大陆是危险区（有掉血参数）", !!D.danger && D.danger.dmg > 0 && D.danger.tick > 0,
    D.danger.dmg + " / " + D.danger.tick + "s");
  check("庇护所改为回血（不再出圈掉血）", D.shelterHeal > 0 && D.outDmg == null);
  check("胜场可进 modeWins（有专属称号）", !!LD.ACHIEVEMENTS.find(a => a.id === "doomsday_win") &&
    !!LD.TITLES.find(t => t.ach === "doomsday_win"));
}

console.log("\n=== 2. 悬崖地图：三块陆地 ===");
const hs = setupDoom(3);
const L = T.doomLand;
{
  check("世界尺寸已切到末日长图", B.world.w === 2600 && B.world.h === 1180, B.world.w + "x" + B.world.h);
  check("已构建陆地", !!L);
  check("庇护所 = 左边小岛", !!B.shelter && B.shelter.x === L.island.x && B.shelter.r === L.island.r,
    "(" + L.island.x + "," + L.island.y + ") r=" + L.island.r);
  const b = L.bridge;
  check("桥可见长度 = 10 格 400px", Math.round(b.vx1 - b.vx0) === 400, Math.round(b.vx1 - b.vx0) + "px");
  check("桥宽 = 2 格 80px", Math.round(b.y1 - b.y0) === 80, Math.round(b.y1 - b.y0) + "px");
  check("岛在左、大陆在右、桥居中", L.island.x < b.x0 && b.x1 < L.main.x1 && L.main.x0 >= b.vx1);
  check("庇护所不再有门洞（墙就是地图边界）", !(B.shelter.gaps));
}

console.log("\n=== 3. 悬崖判定 landAt / landFit ===");
{
  const isl = L.island, b = L.bridge, m = L.main;
  check("岛心是陆地", T.landAt(isl.x, isl.y));
  check("桥面是陆地", T.landAt((b.vx0 + b.vx1) / 2, isl.y));
  check("大陆是陆地", T.landAt(1800, 600));
  check("岛上方是悬崖", !T.landAt(isl.x, isl.y - L.island.r - 40));
  check("桥北侧是悬崖", !T.landAt((b.vx0 + b.vx1) / 2, isl.y - 90));
  check("岛与大陆之间是悬崖", !T.landAt(900, 200));
  const p = T.landFit(900, 200);
  check("崖外点会被夹回陆地", !!p && T.landAt(p.x, p.y),
    p ? "(" + Math.round(p.x) + "," + Math.round(p.y) + ")" : "没夹回来");
  check("已在陆地上时不产生夹取", T.landFit(isl.x, isl.y) === null);
}

console.log("\n=== 4. 出生与分队 ===");
{
  check("玩家出生在庇护所内", hs.every(f => Math.hypot(f.x - B.shelter.x, f.y - B.shelter.y) <= B.shelter.r - 40));
  check("全员同队（互不伤害）", hs.every(f => f.team === 0));
}

console.log("\n=== 5. 位移 / 击退出不去陆地 ===");
{
  const f = hs[0];
  f.x = 900; f.y = 200;               // 手动丢到悬崖里（等价于一次越界的位移）
  B.clampDoomLand();
  check("越界位移被夹回陆地", T.landAt(f.x, f.y), "(" + Math.round(f.x) + "," + Math.round(f.y) + ")");
  f.x = 1800; f.y = 400;              // 大陆上正常站着
  B.clampDoomLand();
  check("陆地上的正常位置不被挪动", f.x === 1800 && f.y === 400);
  f.x = 1800; f.y = 1179;             // 贴着世界下边界
  B.clampDoomLand();
  check("贴边也被拉回留白之内", T.landAt(f.x, f.y), "y=" + Math.round(f.y));
}

console.log("\n=== 6. 僵尸只从大陆来 ===");
{
  const isl = L.island, m = L.main;
  let ok = true, worst = "";
  for (let i = 0; i < 12; i++) {
    B.zombieT = 0;
    B.updateZombies(0.001);
    const z = B.fighters.filter(f => f.isZombie).pop();
    if (!z) { ok = false; worst = "没刷出来"; break; }
    const onMain = z.x >= m.x0 && z.x <= m.x1 && z.y >= m.y0 && z.y <= m.y1;
    const offIsland = Math.hypot(z.x - isl.x, z.y - isl.y) > isl.r;
    if (!onMain || !offIsland) { ok = false; worst = "(" + Math.round(z.x) + "," + Math.round(z.y) + ")"; break; }
  }
  check("连续 12 只僵尸都刷在大陆且不刷在岛上", ok, ok ? "全部命中大陆" : worst);
}

console.log("\n=== 7. 僵尸过桥减速 ===");
{
  const b = L.bridge;
  const z = B.mkZombie((b.vx0 + b.vx1) / 2, (b.y0 + b.y1) / 2);
  B.fighters.push(z);
  B.updateGateSlow(1 / 60);
  check("踩上桥面 → 减速生效", z.gateSlowT > 0, "gateSlowT=" + z.gateSlowT.toFixed(2));
  const z2 = B.mkZombie(2000, 600);
  B.fighters.push(z2);
  B.updateGateSlow(1 / 60);
  check("在大陆上不减速", !z2.gateSlowT);
  check("减速倍率是 0.3（即 -70%）", Math.abs((LD.DOOMSDAY.gateSlow || 1) - 0.3) < 1e-6);
}

console.log("\n=== 8. 桥上寻路（僵尸摸向庇护所） ===");
{
  const b = L.bridge, m = L.main;
  const z = B.mkZombie(m.x0 + 300, 900);
  const aim = B.doomAim(z);
  check("在大陆 → 先走向桥东头", !!aim && aim.x >= b.vx0 && aim.x <= b.x1, aim ? "x=" + Math.round(aim.x) : "无目标");
  const z2 = B.mkZombie((b.vx0 + b.vx1) / 2, (b.y0 + b.y1) / 2);
  const aim2 = B.doomAim(z2);
  check("在桥上 → 继续往西穿过桥面", !!aim2 && aim2.x < z2.x, aim2 ? "x=" + Math.round(aim2.x) : "无目标");
  const z3 = B.mkZombie(L.island.x, L.island.y);
  check("已上岛 → 交回正常战斗移动", B.doomAim(z3) === null);
}

console.log("\n=== 9. 庇护所回血 ===");
{
  const f = hs[0];
  f.x = B.shelter.x; f.y = B.shelter.y;
  f.hp = 60; f.maxHp = 200;
  B.doomTick = null;
  B.updateDoomsday(1);
  check("站在庇护所里会回血", f.hp > 60, "hp=" + Math.round(f.hp));
  const before = f.hp;
  f.hp = f.maxHp;
  B.doomTick = null;
  B.updateDoomsday(1);
  check("满血不会溢出", f.hp === f.maxHp, "hp=" + Math.round(f.hp) + " / " + f.maxHp);
  B.updateDoomsday(1);
  check("回血不影响上一句断言", before <= f.maxHp);
  const g = hs[1];
  const bb = L.bridge;
  g.x = (bb.vx0 + bb.vx1) / 2; g.y = (bb.y0 + bb.y1) / 2; g.hp = 50; g.maxHp = 200;
  B.doomTick = null;
  B.updateDoomsday(1);
  check("离开庇护所（站在桥上）既不回血也不掉血", g.hp === 50, "hp=" + g.hp);
}

console.log("\n=== 10. 伤害与击杀计分 ===");
{
  const f = hs[0];
  const z = B.mkZombie(2000, 600);
  B.fighters.push(z);
  const s0 = B.wScore[f.side] || 0;
  B.damage(f, z, 30, { type: "skill" });
  check("对僵尸造成伤害即得分", (B.wScore[f.side] || 0) > s0, "+" + Math.round(B.wScore[f.side] - s0));
  const s1 = B.wScore[f.side] || 0;
  const z2 = B.mkZombie(2100, 640);
  B.fighters.push(z2);
  z2.hp = 10;
  B.damage(f, z2, 99, { type: "skill" });
  check("击杀僵尸额外加分", (B.wScore[f.side] || 0) > s1 + 5, "+" + Math.round(B.wScore[f.side] - s1));
  check("僵尸掉金币", (B.coins || []).length > 0);
}

console.log("\n=== 11. 渲染层不崩 ===");
{
  const ctx = makeCtx();
  let err = null;
  try { B.draw(ctx); } catch (e) { err = e; }
  check("末日长图可以正常绘制", !err, err ? err.message : "ok");
}

console.log("\n=== 12. v4.1 商店防御建筑（栅栏 / 枪台 / 炮台） ===");
{
  const D = LD.DOOMSDAY.build;
  check("build 数值齐全", D.fence.price === 6 && D.turret.price === 14 && D.cannon.price === 22);
  check("类型表已注册三种建筑", !!LD.TERRAIN.types.barrier && !!LD.TERRAIN.types.turret && !!LD.TERRAIN.types.cannon);
  check("栅栏挡人不挡弹", LD.TERRAIN.types.barrier.blockMove && !LD.TERRAIN.types.barrier.blockProj);
  check("枪台/炮台挡人挡弹可破坏",
    LD.TERRAIN.types.turret.blockMove && LD.TERRAIN.types.turret.blockProj && LD.TERRAIN.types.turret.damageable &&
    LD.TERRAIN.types.cannon.blockMove && LD.TERRAIN.types.cannon.blockProj && LD.TERRAIN.types.cannon.damageable);

  /* 商店条目：末日专属 */
  const shop = B.armyShop();
  check("末日商店出现三件建筑", !!shop.find(i => i.id === "b_fence") && !!shop.find(i => i.id === "b_turret") && !!shop.find(i => i.id === "b_cannon"),
    shop.length + " 件");
  /* 非末日模式不出现：切个规则再查 */
  const savedRule = B.rule;
  B.rule = "zombie";
  check("非末日商店没有建筑", !B.armyShop().find(i => i.id === "b_fence"));
  B.rule = savedRule;

  /* 购买放置：栅栏 */
  const f = hs[0];
  f.x = 2000; f.y = 600; f.facing = { x: 1, y: 0 };
  f.bcoins = 100;
  B.terrain.props = B.terrain.props.filter(p => p.kind !== "barrier" && p.kind !== "turret" && p.kind !== "cannon");
  const n0 = B.terrain.props.length;
  check("买栅栏成功", B.armyBuy(f, "b_fence"), "币 " + f.bcoins);
  const bar = B.terrain.props.find(p => p.kind === "barrier");
  check("栅栏已立在面朝方向", !!bar && Math.abs(bar.x - (2000 + 52)) < 2 && Math.abs(bar.y - 600) < 2,
    bar ? "(" + Math.round(bar.x) + "," + Math.round(bar.y) + ")" : "没有");
  check("栅栏扣了 6 币", f.bcoins === 94, f.bcoins);
  check("栅栏有血量可破坏", bar.maxHp === 80 && bar.hp === 80);
  check("放置不覆盖既有 props", B.terrain.props.length === n0 + 1);

  /* 放不下的位置：悬崖 */
  f.facing = { x: 0, y: -1 };
  f.y = 220; f.x = 2000;   // 大陆北缘附近，正北是悬崖
  f.y = T.landFit(2000, 220) ? 220 : 260;
  f.y = 260; f.x = 2000;
  const edgeY = (() => {   // 找大陆上缘：从北往南第一个陆地 y
    for (let y = 90; y < 400; y += 4) if (T.landAt(2000, y)) return y;
    return 120;
  })();
  f.y = edgeY + 6;
  const c1 = f.bcoins;
  const ok1 = B.armyBuy(f, "b_turret");
  check("面朝悬崖时枪台会夹回陆地放置（或失败不扣钱）",
    ok1 ? T.landAt(B.terrain.props[B.terrain.props.length - 1].x, B.terrain.props[B.terrain.props.length - 1].y) && f.bcoins === c1 - 14
        : f.bcoins === c1,
    ok1 ? "已放置" : "未放置");

  /* 清场后测枪台射击 */
  B.terrain.props = B.terrain.props.filter(p => p.kind !== "barrier" && p.kind !== "turret" && p.kind !== "cannon");
  B.fighters = B.fighters.filter(x => !x.isZombie);
  f.x = 2000; f.y = 600; f.facing = { x: 0, y: 1 };
  f.bcoins = 100;
  B.armyBuy(f, "b_turret");
  const tur = B.terrain.props.find(p => p.kind === "turret");
  check("枪台已放置", !!tur && tur.owner === f, tur ? "hp=" + tur.hp : "无");
  const z = B.mkZombie(2150, 600);
  B.fighters.push(z);
  B.updateGuardPosts(0.1);
  check("枪台锁定了射程内僵尸", tur._target === z);
  check("枪台开火产出弹道", B.projs.length > 0 && B.projs[B.projs.length - 1].type === "turretshot",
    B.projs.map(p => p.type).join(","));
  B.updateGuardPosts(0.1);
  check("射击间隔内不开第二炮", B.projs.filter(p => p.type === "turretshot").length === 1);
  /* 弹道飞一会儿命中僵尸 */
  for (let i = 0; i < 40 && !z.dead; i++) B.update(1 / 60);
  check("枪台弹道能打掉僵尸血", z.hp < z.maxHp || z.dead, "hp=" + Math.round(z.hp));
  /* 炮台：落点延迟爆炸（换到空地，别和刚放的枪台同位） */
  f.x = 1900; f.y = 700; f.facing = { x: 0, y: 1 };
  f.bcoins = 100;
  B.armyBuy(f, "b_cannon");
  const can = B.terrain.props.find(p => p.kind === "cannon");
  check("炮台已放置", !!can);
  B.projs.length = 0;
  can.shotT = 0;
  const zb = B.mkZombie(2200, 700);
  zb.hp = 60; zb.maxHp = 100;
  B.fighters.push(zb);
  B.updateGuardPosts(0.1);
  check("炮台产出延迟落弹", (B.bombs || []).some(b => b.cannon), (B.bombs || []).length);
  for (let i = 0; i < 50; i++) B.update(1 / 60);
  check("炮弹爆炸削了僵尸血", zb.hp < 60 || zb.dead, "hp=" + Math.round(zb.hp));
  /* 僵尸啃枪台 + 仇恨 */
  const tur2 = B.terrain.props.find(p => p.kind === "turret");
  tur2.hp = 100;
  const z2 = B.mkZombie(tur2.x + 40, tur2.y);
  B.fighters = B.fighters.filter(x => x !== z && x !== zb && !x.dead);
  B.fighters.push(z2);
  B.updateGuardPosts(0.1);
  check("贴身僵尸啃咬枪台", tur2.hp < 100, "hp=" + Math.round(tur2.hp));
  check("啃咬有间隔（0.8s 一口）", z2.biteT > 0.5, z2.biteT.toFixed(2));
  const post = B.guardPostNear(z2, 340);
  check("guardPostNear 找到枪台", post === tur2);
  /* 僵尸 AI 仇恨转向：僵尸靠近枪台时移动向量指向建筑 */
  const bot = z2.bot;
  const dx0 = tur2.x - z2.x, dy0 = tur2.y - z2.y;
  B.update(1 / 60);
  LD.AI.tickHero(z2, 1 / 60);
  const mv = Math.hypot(z2.ctrl.mx, z2.ctrl.my);
  const dot = mv > 0.05 ? (z2.ctrl.mx * dx0 + z2.ctrl.my * dy0) / (mv * Math.hypot(dx0, dy0)) : -1;
  check("僵尸移动朝向枪台（仇恨被吸引）", dot > 0.5, "dot=" + dot.toFixed(2));
  /* 建筑被拆 */
  LD.Terrain.hitProp(B.terrain, tur2, 999, { src: z2 });
  check("枪台血量归零即碎", tur2.dead);
}


console.log("\n=== 13. 右大陆危险区 ===");
{
  const D = LD.DOOMSDAY, m = L.main, b = L.bridge;
  const cy = (b.y0 + b.y1) / 2;
  check("大陆中心算危险区", B.inDoomDanger((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2));
  check("桥上不算危险区", !B.inDoomDanger((b.vx0 + b.vx1) / 2, cy));
  check("岛上不算危险区", !B.inDoomDanger(L.island.x, L.island.y));

  /* 英雄站大陆：持续掉血（每 0.5s 5 点） */
  const hs3 = setupDoom(1);
  const me = hs3[0];
  B.fighters = [me];
  me.hp = 200; me.maxHp = 200;
  me.x = m.x0 + 220; me.y = cy;
  const hp0 = me.hp;
  for (let i = 0; i < 60; i++) B.updateDoomsday(1 / 60);
  check("站在大陆上持续掉血（1 秒两跳）", Math.abs((hp0 - me.hp) - D.danger.dmg * 2) <= 6,
    hp0 + " → " + me.hp.toFixed(0));

  /* 僵尸免疫 */
  const z = B.mkZombie(m.x0 + 260, cy);
  B.fighters.push(z);
  const zhp = z.hp;
  for (let i = 0; i < 60; i++) B.updateDoomsday(1 / 60);
  check("僵尸不受危险区伤害", Math.abs(z.hp - zhp) < 1e-6, zhp + " → " + z.hp);

  /* 岛上回血 */
  me.x = L.island.x; me.y = L.island.y; me.hp = 100;
  B.fighters = [me];
  for (let i = 0; i < 60; i++) B.updateDoomsday(1 / 60);
  check("回到岛上回血", me.hp > 100 && me.hp <= 100 + D.shelterHeal + 1, me.hp.toFixed(1));

  /* AI 踩进危险区：立刻往西撤 */
  const hs4 = setupDoom(1);
  const ai = hs4[0];
  const z4 = B.mkZombie(m.x0 + 500, cy);
  B.fighters = [ai, z4];
  ai.x = m.x0 + 200; ai.y = cy;
  LD.AI.mkBot(ai, "normal"); ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  check("AI 踩进危险区后朝西撤", ai.ctrl.mx < -0.3, "mx=" + ai.ctrl.mx.toFixed(2));

  /* AI 守安全区：敌人在对岸时守在桥西头，不追过桥 */
  const hs5 = setupDoom(1);
  const guard = hs5[0];
  guard.x = (b.x0 + b.x1) / 2 + 100; guard.y = cy;      // 站在桥的东半段
  const z5 = B.mkZombie(m.x0 + 200, cy);
  B.fighters = [guard, z5];
  LD.AI.mkBot(guard, "normal"); guard.bot.think = 0;
  LD.AI.tickHero(guard, 1 / 60);
  check("敌人在对岸时 AI 退守桥西头（不东进）", guard.ctrl.mx < -0.3 && guard.x < m.x0,
    "mx=" + guard.ctrl.mx.toFixed(2));
}

console.log("\n=== 14. 大陆随机设施（v4.4）===");
{
  const hs = setupDoom(1);
  const L = B.shelter.land;
  const isl = L.island, b = L.bridge, m = L.main;
  const props = (B.terrain && B.terrain.props) || [];
  const inMain = p => p.x >= m.x0 && p.x <= m.x1 && p.y >= m.y0 && p.y <= m.y1;
  const land = props.filter(inMain);
  const kinds = {};
  land.forEach(p => { kinds[p.kind] = (kinds[p.kind] || 0) + 1; });
  check("右大陆上生成了随机设施", land.length >= 12, land.length + " 件 / " + JSON.stringify(kinds));
  check("设施种类不只一种", Object.keys(kinds).length >= 4, Object.keys(kinds).join(","));

  /* 悬崖上不许有东西浮空 */
  const floaters = props.filter(p => {
    const onIsl = Math.hypot(p.x - isl.x, p.y - isl.y) <= isl.r + 4;
    const onBridge = p.x >= b.x0 - 4 && p.x <= b.x1 + 4 && Math.abs(p.y - (b.y0 + b.y1) / 2) <= (b.y1 - b.y0) / 2 + 4;
    return !onIsl && !onBridge && !inMain(p);
  });
  check("没有设施浮在悬崖上", floaters.length === 0, floaters.map(p => p.kind + "@" + Math.round(p.x) + "," + Math.round(p.y)).join(" "));

  /* 桥面与两个桥头必须干净 */
  const cy2 = (b.y0 + b.y1) / 2;
  const onBridge = props.filter(p => Math.abs(p.y - cy2) <= (b.y1 - b.y0) / 2 + 26 &&
    p.x >= b.x0 - 26 && p.x <= b.x1 + 26);
  check("桥面与桥头没有障碍", onBridge.length === 0, onBridge.map(p => p.kind).join(","));

  /* 岛内只留不挡路的装饰（爆桶 / 轮胎本来就在白名单里） */
  const islProps = props.filter(p => Math.hypot(p.x - isl.x, p.y - isl.y) < isl.r - 4);
  const blockers = islProps.filter(p => p.blockMove && p.kind !== "barrel" && p.kind !== "tire");
  check("岛内没有挡路的大件", blockers.length === 0, blockers.map(p => p.kind).join(","));
  check("岛内装饰不超过 5 件", islProps.length <= 5, islProps.length + " 件");

  /* occ 与清理后的 props 同步：随便挑一件大陆障碍，它所在的格子必须被标占用 */
  const solidOne = land.find(p => p.blockMove && p.kind !== "barrel");
  if (solidOne && B.terrain.occ) {
    const tl = B.terrain.tile || 40;
    const col = Math.floor(solidOne.x / tl), row = Math.floor((solidOne.y - B.terrain.top) / tl);
    const occVal = B.terrain.occ[row] ? B.terrain.occ[row][col] : 0;
    check("occ 与清理后的设施同步（大陆障碍格被标记）", occVal === 1, "occ=" + occVal);
  } else check("occ 与清理后的设施同步（大陆障碍格被标记）", false, "没找到可检查的障碍");
  void hs;
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
