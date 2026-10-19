/* 孤高旅斗 v3.2 世界末日测试
 * 覆盖：模式注册 / 庇护所地形（墙 + 双门洞）/ 全员同队 / 出生在庇护所 /
 *       刷怪速率随存活人数提升 / 僵尸刷在墙外 / 墙外红圈掉血 /
 *       伤害与击杀计分 / 僵尸掉金币 / 最后幸存者与时间到按分数判胜 /
 *       局内商店能量球
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
  B.state = "fight"; B.countdown = 0;
  return fs2;
}

console.log("=== 1. 模式与参数 ===");
{
  const ri = LD.ruleInfo("doomsday");
  check("「世界末日」已注册", ri.id === "doomsday" && ri.name === "世界末日", ri.icon + " " + ri.name);
  check("参数：半径 280 / 门洞 2 格", LD.DOOMSDAY.r === 280 && LD.DOOMSDAY.gap === 2);
  check("胜场可进 modeWins（有专属称号）", !!LD.ACHIEVEMENTS.find(a => a.id === "doomsday_win") &&
    !!LD.TITLES.find(t => t.ach === "doomsday_win"));
}

console.log("\n=== 2. 庇护所地形 ===");
{
  const hs = setupDoom(2);
  const sh = B.shelter;
  check("生成庇护所", !!sh && sh.r === 280 && sh.gaps.length === 2,
    sh ? "r=" + sh.r + " gaps=" + sh.gaps.length : "无");
  const walls = B.terrain.props.filter(p => p.kind === "solid" && p.mat === "wall_stone");
  check("石墙环成圈（>=40 块）", walls.length >= 40, walls.length + " 块");
  check("两个门洞可通行", sh.gaps.every(g => T.clearAt(B.terrain, g.x, g.y, 10)));
  let closed = 0;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 + 0.26;
    const x = sh.x + Math.cos(a) * sh.r, y = sh.y + Math.sin(a) * sh.r;
    if (!T.clearAt(B.terrain, x, y, 6)) closed++;
  }
  check("除门洞外墙体封闭", closed >= 10, closed + "/12");
  check("玩家出生在庇护所内", hs.every(f => Math.hypot(f.x - sh.x, f.y - sh.y) <= sh.r - 40),
    hs.map(f => Math.round(Math.hypot(f.x - sh.x, f.y - sh.y))).join(","));
  const gap = B.doomGap({ x: sh.x + 600, y: sh.y });
  check("doomGap 取最近门洞", gap === sh.gaps[0]);
  const n0 = B.terrain.props.length;
  B.resetRound(false);
  check("重开一局庇护所不丢", B.terrain.props.filter(p => p.mat === "wall_stone").length === walls.length,
    n0 + " → " + B.terrain.props.length);
}

console.log("\n=== 3. 全员同队 ===");
{
  const hs = setupDoom(3);
  check("所有玩家 team=0", hs.every(f => f.team === 0));
  const hp0 = hs[1].hp;
  check("玩家互相打不出伤害", B.damage(hs[0], hs[1], 60, { type: "skill" }) === 0 && hs[1].hp === hp0);
  check("普攻索敌不会指向队友", !B.sameTeam(hs[0], hs[1]) === false);
}

console.log("\n=== 4. 刷怪：存活越多越快、只刷墙外 ===");
{
  setupDoom(1);
  const t1 = B.zombieT;
  setupDoom(3);
  const t3 = B.zombieT;
  check("三人局刷怪快于单人局", t3 < t1, t1.toFixed(2) + "s / " + t3.toFixed(2) + "s");
  check("间隔不低于下限", t3 >= LD.DOOMSDAY.sprayMin, t3.toFixed(2));
  const sh = B.shelter;
  B.zombieT = 0;
  B.update(1 / 60);
  const z = B.fighters.find(f => f.isZombie && !f.dead);
  check("刷出僵尸", !!z);
  check("僵尸刷在庇护所外", !!z && Math.hypot(z.x - sh.x, z.y - sh.y) > sh.r + 60,
    z ? Math.round(Math.hypot(z.x - sh.x, z.y - sh.y)) : "-");
  const cap = LD.DOOMSDAY.maxBase + 3 * LD.DOOMSDAY.maxPer;
  check("在场上限随人数放宽", cap > LD.DOOMSDAY.maxBase, cap.toFixed(1));
}

console.log("\n=== 5. 墙外红圈掉血 ===");
{
  const hs = setupDoom(2);
  const sh = B.shelter;
  const out = hs[0], inn = hs[1];
  out.x = sh.x + sh.r + 90; out.y = sh.y; out.hp = out.maxHp = 200;
  inn.x = sh.x; inn.y = sh.y; inn.hp = inn.maxHp = 200;
  B.updateDoomsday(1);
  check("墙外每次掉 4 血", out.hp === 196, out.hp);
  check("庇护所内不掉血", inn.hp === 200, inn.hp);
  B.updateDoomsday(1);
  check("持续掉血", out.hp === 192, out.hp);
  check("僵尸不吃红圈（只算玩家）", B.fighters.every(f => !f.isZombie || f.hp === f.maxHp));
}

console.log("\n=== 6. 计分与金币 ===");
{
  const hs = setupDoom(1);
  const a = hs[0], sh = B.shelter;
  const z = B.mkZombie(sh.x + sh.r + 100, sh.y);
  B.fighters.push(z);
  z.hp = z.maxHp = 100;
  const i = B.fighters.indexOf(a);
  B.wScore[i] = 0;
  B.damage(a, z, 30, { type: "skill" });
  check("造成伤害 1 伤 = 1 分", B.wScore[i] === 30, B.wScore[i]);
  B.damage(a, z, 999, { type: "skill" });
  check("溢出伤害不计分 + 击杀 10 分", B.wScore[i] === 30 + 70 + 10, B.wScore[i]);
  check("击杀僵尸掉局内金币", (B.coins || []).length >= 1, (B.coins || []).length);
  check("僵尸死亡不触发玩家淘汰", B.state === "fight");
}

console.log("\n=== 7. 胜负判定 ===");
{
  const hs = setupDoom(2);
  B.damage(null, hs[1], 9999, { type: "dot" });
  check("只剩一名玩家 → 立即结算", B.state === "over" && B.matchWinner === hs[0].side,
    B.state + " / winner=" + B.matchWinner);
}
{
  const hs = setupDoom(2);
  B.wScore[B.fighters.indexOf(hs[0])] = 40;
  B.wScore[B.fighters.indexOf(hs[1])] = 150;
  hs[0].hp = 200; hs[1].hp = 10;             // 血量低的那位分数更高
  B.roundT = 0.01;
  B.update(0.05);
  check("时间到按分数判胜（不看血量）", B.matchWinner === hs[1].side, "winner=" + B.matchWinner);
  check("时间到正常结束", B.state === "over");
}
{
  const hs = setupDoom(1);
  B.roundT = 0.01;
  B.update(0.05);
  check("单人局不会因「最后存活」提前结束", B.state === "over" && B.matchWinner === hs[0].side);
}

console.log("\n=== 8. 局内商店能量球 ===");
{
  const items = B.armyShop();
  const it = items.find(i => i.id === "energy");
  check("商店新增能量球", !!it, it ? it.name + " " + it.price + " 币" : "无");
  const hs = setupDoom(1);
  const a = hs[0];
  a.bcoins = 10; a.energy = 0;
  check("购买能量球补 60 能量", B.armyBuy(a, "energy") === true &&
    a.energy === LD.ASHOP.energyGain && a.bcoins === 10 - LD.ASHOP.energyPrice,
    a.energy + " 能量 / " + a.bcoins + " 币");
  a.energy = a.maxEnergy;
  check("能量已满买不了", B.armyBuy(a, "energy") === false);
}

console.log("\n=== 9. 门洞寻路（AI 勇士也要进得来） ===");
{
  const hs = setupDoom(2);
  const sh = B.shelter, h = hs[0];
  LD.AI.mkBot(h, "normal");
  h.x = sh.x + sh.r + 100; h.y = sh.y + 40;
  const z = B.mkZombie(sh.x + 120, sh.y); B.fighters.push(z);
  let inAt = -1;
  for (let i = 0; i < 600; i++) {
    B.fighters.forEach(f => { if (f.bot && !f.dead) LD.AI.tickHero(f, 1 / 60); });
    B.update(1 / 60);
    if (inAt < 0 && Math.hypot(h.x - sh.x, h.y - sh.y) < sh.r - 60) inAt = i;
  }
  check("被击飞出墙的 AI 勇士能走回庇护所", inAt > 0, inAt > 0 ? (inAt / 60).toFixed(1) + "s" : "10 秒内没进来");
}
{
  const hs = setupDoom(1);
  const sh = B.shelter, h = hs[0];
  LD.AI.mkBot(h, "normal");
  h.x = sh.x + 40; h.y = sh.y - sh.r - 200;      // 正上方，要绕半圈
  const z = B.mkZombie(sh.x + 100, sh.y - 40); B.fighters.push(z);
  let inAt = -1;
  for (let i = 0; i < 900; i++) {
    B.fighters.forEach(f => { if (f.bot && !f.dead) LD.AI.tickHero(f, 1 / 60); });
    B.update(1 / 60);
    if (inAt < 0 && Math.hypot(h.x - sh.x, h.y - sh.y) < sh.r - 60) inAt = i;
  }
  check("从斜上方绕半圈也能找到门洞", inAt > 0, inAt > 0 ? (inAt / 60).toFixed(1) + "s" : "15 秒内没进来");
}
{
  const hs = setupDoom(1);
  const sh = B.shelter;
  const z = B.mkZombie(sh.x + sh.r + 120, sh.y + 60);
  B.fighters.push(z);
  let inAt = -1;
  for (let i = 0; i < 900; i++) {
    B.fighters.forEach(f => { if (f.bot && !f.dead) LD.AI.tickHero(f, 1 / 60); });
    B.update(1 / 60);
    if (inAt < 0 && Math.hypot(z.x - sh.x, z.y - sh.y) < sh.r - 40) inAt = i;
  }
  check("僵尸依然能从门洞闯入", inAt > 0, inAt > 0 ? (inAt / 60).toFixed(1) + "s" : "15 秒内没进来");
}

console.log("\n=== 10. 门洞减速圈 ===");
{
  setupDoom(1);
  const sh = B.shelter, g = sh.gaps[0], h = B.fighters[0];
  const z = B.mkZombie(g.x + 30, g.y + 10); B.fighters.push(z);
  z.gateSlowT = 0;
  B.updateGateSlow(1 / 60);
  check("僵尸在减速圈内被标记", z.gateSlowT > 0, z.gateSlowT.toFixed(2));
  check("玩家不受减速圈影响", !(h.gateSlowT > 0));
  z.x = sh.x + 60; z.y = sh.y - 120; z.gateSlowT = 0;
  B.updateGateSlow(1 / 60);
  check("离开减速圈后不再减速", !(z.gateSlowT > 0));
  check("减速倍率小于 1", LD.DOOMSDAY.gateSlow < 1, LD.DOOMSDAY.gateSlow);
  /* 同一帧的实际位移对比 */
  const z2 = B.mkZombie(sh.x, sh.y - 150); B.fighters.push(z2);
  z2.ctrl = { mx: 1, my: 0, hold: {}, press: {} };
  z2.stun = 0; z2.root = 0; z2.gateSlowT = 0;
  const x0 = z2.x;
  B.updateHero(z2, 0.1); const d1 = z2.x - x0;
  z2.x = x0; z2.gateSlowT = 5;
  B.updateHero(z2, 0.1); const d2 = z2.x - x0;
  check("减速圈内移速明显下降", d2 < d1 * 0.7, d1.toFixed(1) + " → " + d2.toFixed(1) + " px");
}

console.log("\n=== 11. 末日商店可打开 ===");
{
  setupDoom(1);
  LD.UI.openArmy();
  check("世界末日能打开局内商店", LD.UI.screen === "ovArmy", LD.UI.screen);
  LD.UI.closeArmy();
  check("关闭商店回到战斗界面", LD.UI.screen === "game", LD.UI.screen);
  B.rule = "brawl";
  LD.UI.openArmy();
  check("其它模式打不开商店", LD.UI.screen !== "ovArmy", LD.UI.screen);
  B.rule = "doomsday";
}

console.log("\n=== 12. AI 会用局内商店（捡币 → 购买） ===");
{
  const hs = setupDoom(2);
  const sh = B.shelter, bot = hs[1];
  LD.AI.mkBot(bot, "normal");
  bot.x = sh.x + 30; bot.y = sh.y - 20;
  bot.bcoins = 0; bot.maxHp = 200; bot.hp = 200;
  B.spawnCoin(sh.x + 170, sh.y + 10, 4);
  const before = bot.maxHp;
  let picked = false, bought = false;
  for (let i = 0; i < 900; i++) {
    B.zombieT = 99;                       // 本段只验证捡币，不让刷怪干扰
    B.fighters.forEach(f => { if (f.bot && !f.dead) LD.AI.tickHero(f, 1 / 60); });
    B.update(1 / 60);
    if ((bot.bcoins || 0) > 0 || bot.maxHp > before) picked = true;
    if (bot.maxHp > before || (bot.spdBuys || 0) > 0) { bought = true; break; }
  }
  check("AI 会主动去捡局内金币", picked);
  check("AI 捡到钱后会购买补给", bought, "maxHp " + before + " → " + bot.maxHp);
}
{
  /* 丧尸危机沿用同一套拾取 / 购买逻辑 */
  const hs = [mkHero(0), mkHero(1)];
  B.setup({ mode: "duel", rule: "auction", fighters: hs, isHost: true, mySide: 0 });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  const bot = hs[1];
  LD.AI.mkBot(bot, "normal");
  bot.x = B.world.w / 2; bot.y = B.world.h / 2;
  bot.bcoins = 0; bot.maxHp = 200; bot.hp = 200;
  B.spawnCoin(bot.x + 150, bot.y, 4);
  const before2 = bot.maxHp;
  let bought2 = false;
  for (let i = 0; i < 900; i++) {
    B.fighters.forEach(f => { if (f.bot && !f.dead) LD.AI.tickHero(f, 1 / 60); });
    B.update(1 / 60);
    if (bot.maxHp > before2 || (bot.spdBuys || 0) > 0) { bought2 = true; break; }
  }
  check("丧尸危机 AI 同样会捡币并购买", bought2, "maxHp " + before2 + " → " + bot.maxHp);
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
