/* 孤高旅斗 僵尸专项测试（v3.1 重做）
 * 覆盖：
 *   ① 固定配装：只有突刺 / 撕咬，没有普攻 / 大招 / 闪避
 *   ② 属性：100 血、移速 110%
 *   ③ 突刺：小突进 + 多段伤害
 *   ④ 撕咬：少量伤害 + 定身 2 秒
 *   ⑤ 技能轮盘不替换僵尸技能
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
const LD = sb.LD, B = LD.Battle;
LD.CONF.critRate = 0;

function mkHero(side) {
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(),
    loadout: { basic: "slash", skill1: null, skill2: null, ult: null }, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
function setupDuel(z, foe) {
  /* resetRound 会把 isZombie 从 fighters 里清掉（新一局不带僵尸），
   * 所以先只放对手，重置完再把僵尸加回场上。 */
  B.setup({ mode: "duel", rule: "brawl", fighters: [foe],
    mapCfg: { preset: "arena", counts: { solid: 0, breakable: 0, pushable: 0, fence: 0 },
      bush: 0, water: 0, barrel: 0, car: 0, tire: 0, supply: 0, barricade: 0, room: 0, seed: 7 } });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  if (B.fighters.indexOf(z) < 0) {
    z.id = z.side; z._baseMaxHp = z.maxHp; z._baseSpd = z.speedMul;
    B.fighters.push(z); B.score.push(0); B.wScore.push(0);
  }
}
function step(n, dt) {
  for (let i = 0; i < n; i++) B.update(dt || 1 / 60);
}

console.log("=== 1. 僵尸技能数据 ===");
{
  const lunge = LD.skill("z_lunge"), bite = LD.skill("z_bite");
  check("突刺已注册（kind:boss，不进商店）", !!lunge && lunge.kind === "boss" && lunge.price === 0);
  check("突刺 CD 6.5s（中CD 6-8）", lunge && lunge.cd === 6.5, lunge && lunge.cd);
  check("突刺：3 段 × 7 伤害", lunge && lunge.hits === 3 && lunge.dmg === 7);
  check("突刺：130 距离小突进", lunge && lunge.dash === 130, lunge && lunge.dash);
  check("撕咬已注册（kind:boss）", !!bite && bite.kind === "boss" && bite.price === 0);
  check("撕咬 CD 7.5s（中CD 6-8）", bite && bite.cd === 7.5, bite && bite.cd);
  check("撕咬：8 伤害 + 定身 2s", bite && bite.dmg === 8 && bite.root === 2);
  check("僵尸技能不进勇者技能池",
    LD.skillsBy("skill").every(s => s.id !== "z_lunge" && s.id !== "z_bite"));
}

console.log("\n=== 2. 僵尸实例 ===");
{
  const z = B.mkZombie(600, 900);
  check("僵尸 100 血", z.maxHp === 100 && z.hp === 100, z.maxHp);
  check("僵尸移速 = 普通角色的 110%", z.speedMul === 1.1, z.speedMul);
  check("固定配装：无普攻 / 无大招 / 突刺 + 撕咬",
    !z.loadout.basic && !z.loadout.ult &&
    z.loadout.skill1 === "z_lunge" && z.loadout.skill2 === "z_bite",
    JSON.stringify(z.loadout));
  check("僵尸 AI 不会闪避（dodge = 0）", z.bot && z.bot.conf.dodge === 0, z.bot && z.bot.conf.dodge);
  check("僵尸是独立阵营（team 8）且标记 isZombie", z.team === 8 && z.isZombie === true);
}

console.log("\n=== 3. 突刺：小突进 + 多段伤害 ===");
{
  const z = B.mkZombie(600, 900);
  const foe = mkHero(1);
  setupDuel(z, foe);
  z.x = 700; z.y = 900; z.facing = { x: 1, y: 0 };
  foe.x = 742; foe.y = 900; foe.hp = 500; foe.maxHp = 500;
  z.cd.skill1 = 0;
  B.trySlot(z, "skill1", z.ctrl);
  step(45);
  check("突刺打满三段共 21 伤害", foe.hp === 479, foe.hp);
  check("突刺把小身位向前推进", z.x > 790, z.x.toFixed(1));
  check("突刺结束进入 CD", !z.slot.skill1.on && z.cd.skill1 > 5.5 && z.cd.skill1 <= 6.5, z.cd.skill1.toFixed(2));
}

console.log("\n=== 4. 撕咬：少量伤害 + 定身 2 秒 ===");
{
  const z = B.mkZombie(600, 900);
  const foe = mkHero(1);
  setupDuel(z, foe);
  z.x = 700; z.y = 900; z.facing = { x: 1, y: 0 };
  foe.x = 748; foe.y = 900; foe.hp = 500; foe.maxHp = 500; foe.root = 0;
  z.cd.skill2 = 0;
  B.trySlot(z, "skill2", z.ctrl);
  step(16);
  check("撕咬造成 8 点伤害", foe.hp === 492, foe.hp);
  check("撕咬把目标定身 2 秒", foe.root > 1.6 && foe.root <= 2, foe.root.toFixed(2));
  check("撕咬结束进入 CD", z.cd.skill2 > 7 && z.cd.skill2 <= 7.6, z.cd.skill2.toFixed(2));
}

console.log("\n=== 5. 背对目标时撕咬不命中 ===");
{
  const z = B.mkZombie(600, 900);
  const foe = mkHero(1);
  const dummy = mkHero(2);
  setupDuel(z, foe);
  B.fighters.push(dummy); B.score.push(0); B.wScore.push(0);
  z.x = 700; z.y = 900; z.lock = dummy.side;     // 面朝右边远处的 dummy
  dummy.x = 1400; dummy.y = 900;
  foe.x = 660; foe.y = 900; foe.hp = 500; foe.maxHp = 500; foe.root = 0;
  z.cd.skill2 = 0;
  B.trySlot(z, "skill2", z.ctrl);
  step(16);
  check("身后的敌人不会被咬中", foe.hp === 500 && foe.root === 0, foe.hp + " / root " + foe.root);
}

console.log("\n=== 6. 技能轮盘不替换僵尸技能 ===");
{
  const z = B.mkZombie(600, 900);
  const foe = mkHero(1);
  setupDuel(z, foe);
  B.mods = ["wheel"];
  B.wheelT = 0;
  B.updateWheel(13);
  check("轮盘后僵尸仍是突刺 + 撕咬",
    z.loadout.skill1 === "z_lunge" && z.loadout.skill2 === "z_bite" &&
    !z.loadout.basic && !z.loadout.ult, JSON.stringify(z.loadout));
  check("轮盘不会给僵尸塞大招", !z.loadout.ult);
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
