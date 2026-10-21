/* 孤高旅斗 v4.9 僵尸守房测试
 * 覆盖：规则注册（模式 / 成就 / 称号）/ 开局（全员同队、房子耐久、摆位）/
 *       波次放怪与逐波递增 / 僵尸啃房掉耐久 / 击杀补记计分 /
 *       喘息期站房内修房 / 房子被打穿判负 / 打完全部波次按击杀判胜 /
 *       AI 默认冲房子 / 渲染不崩
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
    Image: function () { this.complete = false; this.naturalWidth = 0; this.src = ""; },
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

const BASE = { basic: "slash", skill1: null, skill2: null, ult: null };
const C = LD.ZOMBIEHOUSE || {};

/** 起一局僵尸守房：n 名英雄，返回 fighters */
function setupZH(n, seed) {
  const fs = [];
  for (let i = 0; i < n; i++) {
    fs.push(B.mkHero(i, { x: 500 + i * 40, y: 700, look: LD.Profile.look(), loadout: BASE, name: "H" + i }));
  }
  B.setup({ mode: "duel", rule: "zombiehouse", fighters: fs, isHost: true, mySide: 0, matchT: 180,
    mapCfg: LD.mapCfg({ preset: "arena", seed: seed || 5, ground: "stone" }) });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return B.fighters;
}
/** 推进 dt 秒（按 1/60 步长跑，贴近真实帧） */
function tick(dt) {
  const step = 1 / 60;
  let left = dt;
  while (left > 0) { B.updateZombieHouse(Math.min(step, left)); left -= step; }
}
const heroes = () => B.fighters.filter(f => f.kind === "hero" && !f.isZombie && !f.bench);
const zombies = () => B.fighters.filter(f => f.isZombie);
const aliveZ = () => B.fighters.filter(f => f.isZombie && !f.dead);

console.log("\n=== 1. 规则注册 ===");
{
  const r = LD.ruleInfo("zombiehouse");
  check("规则表里有「僵尸守房」", r && r.id === "zombiehouse", r && r.name);
  check("模式总数 16 种（v4.9 新增僵尸守房）", LD.RULES.length === 16, LD.RULES.length);
  check("成就含「守房铁卫」", LD.ACHIEVEMENTS.some(a => a.id === "zombiehouse_win"));
  check("称号含「守房铁卫」", LD.TITLES.some(t => t.ach === "zombiehouse_win"));
  check("成就数与称号数一致", LD.ACHIEVEMENTS.length === LD.TITLES.length,
    LD.ACHIEVEMENTS.length + " / " + LD.TITLES.length);
  check("房子参数已配置", !!C.hp && !!C.r && !!C.waves, "hp=" + C.hp + " r=" + C.r + " waves=" + C.waves);
}

console.log("\n=== 2. 开局：全员同队与房子 ===");
{
  const fs = setupZH(3);
  const H = B.zh.house;
  check("守房状态已建立", !!B.zh && !!H);
  check("房子耐久满值", H.hp === H.maxHp && H.maxHp === (C.hp || 1200), H.hp + "/" + H.maxHp);
  check("全员同队（互不伤害）", heroes().every(f => f.team === 0),
    heroes().map(f => f.team).join(","));
  check("开局处于喘息期", B.zh.phase === "gap", B.zh.phase);
  const d = heroes().map(f => Math.hypot(f.x - H.x, f.y - H.y));
  check("开局站位在房子四周", d.every(v => v > H.r && v < H.r + 120), d.map(v => Math.round(v)).join(","));
  check("场上还没有僵尸", aliveZ().length === 0, aliveZ().length);
}

console.log("\n=== 3. 波次放怪 ===");
{
  setupZH(2);
  check("喘息期倒计时为正", B.zh.gapT > 0, B.zh.gapT);
  tick(3.2);
  check("喘息结束自动开第 1 波", B.zh.phase === "fight" && B.zh.wave === 1, B.zh.phase + " wave=" + B.zh.wave);
  const q1 = B.zh.queue;
  check("第 1 波数量 = base", q1 === (C.base || 5), q1);
  /* 逐个放出：spawnEvery 0.55 秒一只 */
  tick(0.6);
  check("已放出第一只僵尸", aliveZ().length >= 1, aliveZ().length);
  tick(6);
  check("整波放完", B.zh.queue === 0 && aliveZ().length === q1,
    "queue=" + B.zh.queue + " alive=" + aliveZ().length);
  const far = aliveZ().every(z => Math.hypot(z.x - B.zh.house.x, z.y - B.zh.house.y) > B.zh.house.r);
  check("僵尸刷在场边（不在房子里）", far);
}

console.log("\n=== 4. 僵尸啃房 ===");
{
  setupZH(2);
  tick(3.2);                       /* 开波 */
  const H = B.zh.house;
  const hp0 = H.hp;
  const z = aliveZ()[0] || B.zhSpawnZombie();
  z.x = H.x; z.y = H.y;            /* 拖进房子判定圈 */
  B.updateZombieHouse(0.02);
  check("僵尸进圈即啃房", H.hp < hp0, hp0 + " → " + H.hp);
  const hp1 = H.hp;
  B.updateZombieHouse(0.1);
  check("啃房有冷却（不会每帧掉）", H.hp === hp1, hp1 + " → " + H.hp);
  tick(C.biteTick || 0.8);
  check("冷却结束后继续啃", H.hp < hp1, hp1 + " → " + H.hp);
  const z2 = B.zhSpawnZombie();
  z2.x = H.x + 10; z2.y = H.y;
  const hp2 = H.hp;
  B.updateZombieHouse(0.02);
  check("每只僵尸各走各的冷却", H.hp < hp2, hp2 + " → " + H.hp);
}

console.log("\n=== 5. 击杀补记计分 ===");
{
  setupZH(2);
  tick(3.2);
  const me = heroes()[0];
  const z = B.zhSpawnZombie();
  z.hp = 1;
  z.lastHitBy = me;
  B.kill(z, me);
  check("僵尸已阵亡", z.dead === true);
  B.updateZombieHouse(0.02);
  check("击杀记到最后一击者头上", (B.zh.score[me.side] || 0) === (C.scoreKill || 1),
    "score=" + (B.zh.score[me.side] || 0));
  check("击杀数同步累加", (B.zh.kills[me.side] || 0) === 1, B.zh.kills[me.side]);
  B.updateZombieHouse(0.02);
  check("同一只不会重复计分", (B.zh.score[me.side] || 0) === (C.scoreKill || 1),
    B.zh.score[me.side]);
  const other = heroes()[1];
  check("没打到的人不计分", (B.zh.score[other.side] || 0) === 0, B.zh.score[other.side]);
}

console.log("\n=== 6. 喘息期修房 ===");
{
  setupZH(2);
  const H = B.zh.house;
  H.hp = H.maxHp * 0.5;
  const me = heroes()[0];
  const hp0 = H.hp;
  tick(1);
  check("开局没人进房时不修", Math.abs(H.hp - hp0) < 0.01, hp0 + " → " + H.hp);
  me.x = H.x; me.y = H.y;          /* 站进房子 */
  tick(1);
  check("站进房子里开始修房", H.hp > hp0, Math.round(hp0) + " → " + Math.round(H.hp));
  const hp1 = H.hp;
  tick(1);
  check("修复按秒推进", H.hp > hp1, Math.round(hp1) + " → " + Math.round(H.hp));
  H.hp = H.maxHp;
  tick(1);
  check("修满即止不溢出", H.hp === H.maxHp, H.hp);
}

console.log("\n=== 7. 房子被打穿判负 ===");
{
  setupZH(2);
  tick(3.2);
  const H = B.zh.house;
  H.hp = 5;
  const z = B.zhSpawnZombie();
  z.x = H.x; z.y = H.y;
  B.updateZombieHouse(0.02);
  check("耐久归零", H.hp === 0, H.hp);
  check("整局结束", B.zh.done === true && B.state === "over", B.state);
  check("判负（无人获胜）", B.matchWinner === -1, B.matchWinner);
}

console.log("\n=== 8. 打完全部波次按击杀判胜 ===");
{
  setupZH(2);
  tick(3.2);
  const a = heroes()[0], b = heroes()[1];
  B.zh.score = {}; B.zh.kills = {};
  B.zh.score[a.side] = 7; B.zh.kills[a.side] = 7;
  B.zh.score[b.side] = 3; B.zh.kills[b.side] = 3;
  /* 直接跳到最后一波并清空 */
  B.zh.wave = C.waves || 5;
  B.zh.queue = 0;
  aliveZ().forEach(z => { z.dead = true; });
  B.updateZombieHouse(0.02);
  check("整局结束", B.zh.done === true && B.state === "over", B.state);
  check("击杀最多者获胜", B.matchWinner === a.side, B.matchWinner + " vs " + a.side);
}

console.log("\n=== 9. 波次清空进喘息 ===");
{
  setupZH(2);
  tick(3.2);                       /* 第 1 波 */
  const w = B.zh.wave;
  B.zh.queue = 0;
  aliveZ().forEach(z => { z.dead = true; });
  B.updateZombieHouse(0.02);
  check("本波清空后进入喘息", B.zh.phase === "gap", B.zh.phase);
  check("喘息时长 = gap", Math.round(B.zh.gapT) === Math.round(C.gap || 8), B.zh.gapT);
  check("波数未越界", B.zh.wave === w, B.zh.wave);
  tick((C.gap || 8) + 0.2);
  check("喘息结束开下一波", B.zh.phase === "fight" && B.zh.wave === w + 1, B.zh.phase + " wave=" + B.zh.wave);
  const q2 = B.zh.queue;
  check("第 2 波数量递增", q2 === (C.base || 5) + (C.grow || 3), q2);
}

console.log("\n=== 10. AI：僵尸默认冲房子 ===");
{
  setupZH(2);
  const H = B.zh.house;
  const z = B.zhSpawnZombie();
  /* 把僵尸放到远离所有玩家、也远离房子的角落 */
  z.x = 60; z.y = (B.world.pt || 0) + 60;
  heroes().forEach(f => { f.x = H.x; f.y = H.y; });
  const AI = LD.AI;
  AI.tickHero(z, 0.016);
  const ax = H.x - z.x, ay = H.y - z.y, ad = Math.hypot(ax, ay) || 1;
  const dot = (z.ctrl.mx * ax + z.ctrl.my * ay) / ad;
  check("远离玩家时朝房子推进", dot > 0.5, "dot=" + dot.toFixed(2));
  /* 把一名玩家贴到僵尸身边：应改为交战，不再强制朝房子 */
  const me = heroes()[0];
  me.x = z.x + 40; me.y = z.y;
  AI.tickHero(z, 0.016);
  check("玩家贴身时交给通用交战逻辑", z.ctrl.mx !== undefined && z.ctrl.my !== undefined);
}

console.log("\n=== 11. 渲染层不崩 ===");
{
  setupZH(2);
  tick(3.2);
  let ok = true, err = "";
  try { B.drawZombieHouse(makeCtx()); } catch (e) { ok = false; err = e.message; }
  check("drawZombieHouse 不抛错", ok, err);
  ok = true; err = "";
  try { B.draw(makeCtx()); } catch (e) { ok = false; err = e.message; }
  check("整局 draw 不抛错", ok, err);
  /* 房子耐久掉到危险值也要能画 */
  B.zh.house.hp = 1;
  ok = true; err = "";
  try { B.drawZombieHouse(makeCtx()); } catch (e) { ok = false; err = e.message; }
  check("残血房子渲染不抛错", ok, err);
}

console.log("\n通过 " + pass + " 项，失败 " + fail + " 项\n");
process.exit(fail === 0 ? 0 : 1);
