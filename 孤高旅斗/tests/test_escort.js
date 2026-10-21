/* 孤高旅斗 v4.5 护送情报箱测试
 * 覆盖：模式注册 / 参数 / 开局（两队归并 + 交付点 + 中央箱子）/
 *       自动拾取 / 抱箱减速 / 交付得分 / 先到 3 分结束 /
 *       阵亡掉落与保护期 / 限时按分数判胜 / AI 目标 / 渲染不崩
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

const BASE = { basic: "slash", skill1: null, skill2: null, ult: null };
function mkHero(side, team) {
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(), loadout: BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  f.team = team == null ? -1 : team;
  return f;
}
function setupEscort(n, teams) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(mkHero(i, teams ? teams[i] : -1));
  B.setup({ mode: "duel", rule: "escort", fighters: list, isHost: true, mySide: 0, matchT: 120 });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return list;
}

console.log("=== 1. 模式与参数 ===");
{
  const ri = LD.ruleInfo("escort");
  check("「护送情报箱」已注册", ri.id === "escort" && ri.name === "护送情报箱", ri.icon + " " + ri.name);
  const E = LD.ESCORT;
  check("先到 3 分获胜", E.need === 3);
  check("抱箱移速 -8%", Math.abs(E.speedMul - 0.92) < 1e-6, E.speedMul);
  check("交付点半径 110 / 拾取 58", E.goalR === 110 && E.boxR === 58);
  check("箱子重生 2.2s / 落地保护 0.8s", E.respawn === 2.2 && E.protect === 0.8);
}

console.log("\n=== 2. 开局布置 ===");
{
  const hs = setupEscort(2);
  const st = B.escort;
  check("比分 0:0", st.score[0] === 0 && st.score[1] === 0, st.score.join(":"));
  check("箱子在地图正中", Math.abs(st.box.x - B.world.w / 2) < 1 && st.box.alive === true,
    st.box.x + "," + st.box.y);
  const g0 = B.escortGoalOf(0), g1 = B.escortGoalOf(1);
  check("红队交付点在左侧", Math.abs(g0.x - LD.ESCORT.goalInset) < 1 && g0.team === 0, g0.x);
  check("蓝队交付点在右侧", Math.abs(g1.x - (B.world.w - LD.ESCORT.goalInset)) < 1 && g1.team === 1, g1.x);
  check("没分队时按座位奇偶补齐（0→红 / 1→蓝）", hs[0].team === 0 && hs[1].team === 1,
    hs[0].team + "/" + hs[1].team);
  check("开局所有人手上没箱子", !hs[0].intel && !hs[1].intel);
}

console.log("\n=== 3. 自动拾取 ===");
{
  const hs = setupEscort(2);
  const me = hs[0], st = B.escort;
  me.x = st.box.x; me.y = st.box.y;
  B.updateEscort(1 / 60);
  check("走到箱子上自动抱起", me.intel === true && st.box.alive === false);
  /* 离远一点也不行 */
  const hs2 = setupEscort(2);
  hs2[0].x = B.escort.box.x + 200; hs2[0].y = B.escort.box.y;
  B.updateEscort(1 / 60);
  check("离得远不会隔空拾取", hs2[0].intel === false);
}

console.log("\n=== 4. 抱箱减速 ===");
{
  const hs = setupEscort(1);
  const me = hs[0];
  me.x = 800; me.y = 1200; me.ctrl.mx = 1; me.ctrl.my = 0;
  const x0 = me.x;
  for (let i = 0; i < 30; i++) B.update(1 / 60);
  const dxNormal = me.x - x0;
  /* 抱起箱子再走同样的帧数 */
  const hs2 = setupEscort(1);
  const me2 = hs2[0];
  me2.intel = true;
  me2.x = 800; me2.y = 1200; me2.ctrl.mx = 1; me2.ctrl.my = 0;
  const x1 = me2.x;
  for (let i = 0; i < 30; i++) B.update(1 / 60);
  const dxLoaded = me2.x - x1;
  check("抱箱移动比空手慢", dxLoaded > 0 && dxLoaded < dxNormal * 0.98,
    "空手 " + dxNormal.toFixed(1) + " / 抱箱 " + dxLoaded.toFixed(1));
}

console.log("\n=== 5. 交付得分 ===");
{
  const hs = setupEscort(2);
  const me = hs[0], st = B.escort;
  me.intel = true;
  const goal = B.escortGoalOf(1);          // 红队要送进蓝队圈
  me.x = goal.x; me.y = goal.y;
  B.updateEscort(1 / 60);
  check("红队送进蓝队交付点得 1 分", st.score[0] === 1 && st.score[1] === 0, st.score.join(":"));
  check("交付后手上不再有箱子", me.intel === false);
  check("箱子进入重生倒计时", st.box.alive === false && st.respawnT > 0);

  /* 站自己圈里不算 */
  const hs2 = setupEscort(2);
  const me2 = hs2[0];
  me2.intel = true;
  const own = B.escortGoalOf(0);
  me2.x = own.x; me2.y = own.y;
  B.updateEscort(1 / 60);
  check("站进自己的交付点不得分", B.escort.score[0] === 0, B.escort.score.join(":"));

  /* 重生回中央 */
  const st3 = B.escort;
  for (let i = 0; i < 160; i++) B.updateEscort(1 / 60);
  check("箱子 2.2 秒后在中央重新投放", st3.box.alive && Math.abs(st3.box.x - B.world.w / 2) < 1,
    st3.box.x + "," + st3.box.y);
}

console.log("\n=== 6. 先到 3 分结束 ===");
{
  const hs = setupEscort(2);
  const st = B.escort;
  st.score[0] = 2;
  const me = hs[0];
  me.intel = true;
  const goal = B.escortGoalOf(1);
  me.x = goal.x; me.y = goal.y;
  B.updateEscort(1 / 60);
  check("第 3 分达成后结束对局", B.state === "over", B.state);
  check("比分 3:0 / 标记 done", st.score[0] === 3 && st.done === true, st.score.join(":"));
  check("matchWinner 指向红队座位", B.matchWinner === 0, B.matchWinner);
}

console.log("\n=== 7. 阵亡掉落与保护期 ===");
{
  const hs = setupEscort(2);
  const me = hs[0], foe = hs[1], st = B.escort;
  me.intel = true;
  st.box.alive = false;
  me.x = 900; me.y = 1000; me.dead = true;
  B.updateEscort(1 / 60);
  check("持箱者阵亡后箱子掉在原地", st.box.alive === true && Math.abs(st.box.x - 900) < 1 && Math.abs(st.box.y - 1000) < 1,
    st.box.x + "," + st.box.y);
  check("掉落保护期 0.8 秒", Math.abs(st.dropT - 0.8) < 0.05, st.dropT.toFixed(2));
  foe.x = st.box.x; foe.y = st.box.y;
  B.updateEscort(1 / 60);
  check("保护期内对手捡不起来", foe.intel === false, "dropT=" + st.dropT.toFixed(2));
  for (let i = 0; i < 60; i++) B.updateEscort(1 / 60);
  foe.x = st.box.x; foe.y = st.box.y;
  B.updateEscort(1 / 60);
  check("保护期结束后对手可以捡", foe.intel === true);
}

console.log("\n=== 8. 限时结算 ===");
{
  /* 分数不同：分高者胜 */
  const hs = setupEscort(2);
  B.escort.score[0] = 1; B.escort.score[1] = 0;
  B.roundT = -0.01;
  B.updateEscort(1 / 60);
  check("时间到比分高者获胜", B.state === "over" && B.matchWinner === 0, "winner=" + B.matchWinner);

  /* 同分：比剩余总血量 */
  const hs2 = setupEscort(2);
  hs2[0].hp = 40; hs2[1].hp = 180;
  B.escort.score[0] = 1; B.escort.score[1] = 1;
  B.roundT = -0.01;
  B.updateEscort(1 / 60);
  check("同分比剩余总血量（蓝队血多则蓝胜）", B.state === "over" && B.matchWinner === 1, "winner=" + B.matchWinner);
}

console.log("\n=== 9. AI 目标 ===");
{
  /* 空手：朝地上的箱子走 */
  const hs = setupEscort(2);
  const ai = hs[0], foe = hs[1];
  ai.x = 400; ai.y = 400;
  foe.x = 1200; foe.y = 1200;
  LD.AI.mkBot(ai, "normal"); ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  const toBox = Math.hypot(B.escort.box.x - ai.x, B.escort.box.y - ai.y);
  const dot = ai.ctrl.mx * (B.escort.box.x - ai.x) / toBox + ai.ctrl.my * (B.escort.box.y - ai.y) / toBox;
  check("空手 AI 朝情报箱移动", dot > 0.6, "朝向点积 " + dot.toFixed(2));

  /* 持箱：朝敌方交付点走 */
  const hs2 = setupEscort(2);
  const ai2 = hs2[0];
  ai2.intel = true;
  ai2.x = 800; ai2.y = 800;
  hs2[1].x = 300; hs2[1].y = 300;
  LD.AI.mkBot(ai2, "normal"); ai2.bot.think = 0;
  LD.AI.tickHero(ai2, 1 / 60);
  const goal = B.escortGoalOf(1);
  const d2 = Math.hypot(goal.x - ai2.x, goal.y - ai2.y);
  const dot2 = ai2.ctrl.mx * (goal.x - ai2.x) / d2 + ai2.ctrl.my * (goal.y - ai2.y) / d2;
  check("持箱 AI 朝敌方交付点移动", dot2 > 0.6, "朝向点积 " + dot2.toFixed(2));
}

console.log("\n=== 10. 渲染层不崩 ===");
{
  const hs = setupEscort(2);
  hs[0].intel = true;
  const ctx = makeCtx();
  let err = null;
  try { B.draw(ctx); } catch (e) { err = e; }
  check("护送模式的交付点 / 箱子 / 引导线可以正常绘制", !err, err ? err.message : "ok");
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
