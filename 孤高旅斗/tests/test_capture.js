/* 孤高旅斗 v4.7 占点争夺测试
 * 覆盖：模式升级（2400 地图 / 随机 3~5 点 / 大点居中 / 抢点 ×2 / 复活递增 / 基地回血）
 *       占领读条与僵持 / 产分 / 胜负 / 据点炮塔（生成、射程、换边保血、被拆消失）/
 *       AI 选点与残血回家 / 渲染不崩
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
    /* 无头环境没有真实图片解码：Image 永远「未加载」，绘制层走程序化兜底 */
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
function mkHero(side, team) {
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(), loadout: BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  f.team = team == null ? -1 : team;
  return f;
}
function setupCapture(n, teams) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(mkHero(i, teams ? teams[i] : -1));
  B.setup({
    mode: "duel", rule: "capture", fighters: list, isHost: true, mySide: 0, matchT: 300,
    /* 带地形：据点炮塔是地形 prop，没有地形就立不起来 */
    mapCfg: LD.mapCfg({ preset: "arena", seed: 20261021, ground: "grass" })
  });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  B.roundT = 999;
  return list;
}
/** 让某个点圈内只有指定角色（其余人挪到地图左下角基地外） */
function isolate(hs, keep, pt) {
  hs.forEach(f => {
    if (keep.indexOf(f) >= 0) { f.x = pt.x; f.y = pt.y; }
    else { f.x = 90; f.y = B.world.h - 90; }
  });
}
const playMidY = () => B.world.pt + (B.world.h - B.world.pt) / 2;

console.log("=== 1. 模式与参数 ===");
{
  const ri = LD.ruleInfo("capture");
  check("「占点争夺」已注册", ri.id === "capture" && ri.name === "占点争夺", ri.icon + " " + ri.name);
  const C = LD.CAPTURE;
  check("地图 1920×1920（v4.10 缩到 80%）", C.world.w === 1920 && C.world.h === 1920,
    C.world.w + "×" + C.world.h);
  check("据点圈内每秒回 5 血", C.pointHeal === 5, C.pointHeal);
  check("每局随机 3~5 座据点", C.count[0] === 3 && C.count[1] === 5, C.count.join("~"));
  check("空点单人 0.20/s（5 秒）", Math.abs(C.capRate - 0.20) < 1e-6, C.capRate);
  check("抢敌方据点耗时 ×2", C.contestMul === 2.0, C.contestMul);
  check("阵亡 3 秒复活、每次 +3 秒", C.respawn === 3.0 && C.respawnStep === 3.0,
    C.respawn + " / +" + C.respawnStep);
  const TT = LD.TOWER.tower, CT = C.turret;
  check("炮塔血量 / 伤害 / 攻速 / 弹速 / 追踪与塔防防御塔一致",
    CT.hp === TT.hp && CT.dmg === TT.dmg && CT.atk === TT.atk &&
    CT.projSpeed === TT.projSpeed && CT.homing === TT.homing,
    CT.hp + "血 " + CT.dmg + "伤 " + CT.atk + "s");
}

console.log("\n=== 2. 开局布置（随机据点）===");
{
  const hs = setupCapture(4);
  const st = B.capture, C = LD.CAPTURE;
  check("地图实际尺寸 1920×1920", B.world.w === 1920 && B.world.h === 1920,
    B.world.w + "×" + B.world.h);
  check("据点数量在 3~5 之间", st.pts.length >= 3 && st.pts.length <= 5, st.pts.length);
  check("大点固定在场地中心并权重 ×2",
    st.big && st.big.x === B.world.w / 2 && st.big.y === playMidY() &&
    st.big.w === 2 && st.big.r === C.big.r,
    Math.round(st.big.x) + "," + Math.round(st.big.y));
  check("只有一个大点", st.pts.filter(p => p.w === 2).length === 1);
  check("小点都是权重 1、半径 150",
    st.pts.filter(p => p !== st.big).every(p => p.w === 1 && p.r === C.small.r));
  check("所有据点都在地图内", st.pts.every(p =>
    p.x >= C.edge - 1 && p.x <= B.world.w - C.edge + 1 &&
    p.y >= B.world.pt + C.edge - 1 && p.y <= B.world.h - C.edge + 1));
  let minD = Infinity;
  for (let i = 0; i < st.pts.length; i++)
    for (let j = i + 1; j < st.pts.length; j++)
      minD = Math.min(minD, Math.hypot(st.pts[i].x - st.pts[j].x, st.pts[i].y - st.pts[j].y));
  check("据点之间留出最小间距", minD >= C.minGap * 0.9, Math.round(minD));
  const b0 = B.captureBase(0), b1 = B.captureBase(1);
  check("据点不会压在双方基地上", st.pts.every(p =>
    Math.hypot(p.x - b0.x, p.y - b0.y) > C.baseGap && Math.hypot(p.x - b1.x, p.y - b1.y) > C.baseGap));
  check("据点都中立", st.pts.every(p => p.owner === -1 && p.prog === 0));
  check("比分 0:0", st.score[0] === 0 && st.score[1] === 0, st.score.join(":"));
  check("没分队时按座位奇偶补齐",
    hs[0].team === 0 && hs[1].team === 1 && hs[2].team === 0 && hs[3].team === 1,
    hs.map(f => f.team).join(","));
  check("红队站左半场", hs.filter(f => f.team === 0).every(f => f.x < B.world.w * 0.5),
    hs.filter(f => f.team === 0).map(f => Math.round(f.x)).join(","));
  check("蓝队站右半场", hs.filter(f => f.team === 1).every(f => f.x > B.world.w * 0.5),
    hs.filter(f => f.team === 1).map(f => Math.round(f.x)).join(","));
  const layoutA = st.pts.map(p => Math.round(p.x) + ":" + Math.round(p.y)).join("|");
  setupCapture(4);
  const layoutB = B.capture.pts.map(p => Math.round(p.x) + ":" + Math.round(p.y)).join("|");
  check("每局据点布局随机", layoutA !== layoutB, layoutA + " ≠ " + layoutB);
}

console.log("\n=== 3. 单人占领 / 多人加速 ===");
{
  /* 单人站小点：1 秒后进度约 0.20 */
  const hs = setupCapture(2);
  const pt = B.capture.pts.find(p => p !== B.capture.big);
  isolate(hs, [hs[0]], pt);
  for (let i = 0; i < 60; i++) B.updateCapture(1 / 60);
  check("单人 1 秒占 20%（空点共 5 秒）", Math.abs(pt.prog - 0.20) < 0.03, pt.prog.toFixed(3));
  check("读条期间归属仍是中立", pt.owner === -1 && pt.by === 0, "by=" + pt.by);

  /* 继续读满 → 归属红队 */
  for (let i = 0; i < 300; i++) B.updateCapture(1 / 60);
  check("读满后归红队", pt.owner === 0 && pt.prog === 0, "owner=" + pt.owner);

  /* 双人：同样 1 秒进度更快 */
  const hs2 = setupCapture(4);
  const pt2 = B.capture.pts.find(p => p !== B.capture.big);
  isolate(hs2, [hs2[0], hs2[2]], pt2);       // 两个红队
  for (let i = 0; i < 60; i++) B.updateCapture(1 / 60);
  check("两人占领比单人快（+45%）", pt2.prog > 0.26 && pt2.prog < 0.32, pt2.prog.toFixed(3));
}

console.log("\n=== 4. 抢点耗时 ×2 / 僵持 / 回落 ===");
{
  /* 空点速度 0.20/s，抢敌方点减半 → 1 秒 0.10 */
  const hs = setupCapture(2);
  const pt = B.capture.pts.find(p => p !== B.capture.big);
  pt.owner = 0; pt.prog = 0; pt.by = -1;
  isolate(hs, [hs[1]], pt);                  // 蓝队一个人抢红点
  for (let i = 0; i < 60; i++) B.updateCapture(1 / 60);
  check("抢敌方据点 1 秒只推进 10%（耗时 ×2）", Math.abs(pt.prog - 0.10) < 0.025, pt.prog.toFixed(3));

  const hs2 = setupCapture(2);
  const pt2 = B.capture.pts[0];
  pt2.prog = 0.4; pt2.by = 0;
  isolate(hs2, [hs2[0], hs2[1]], pt2);       // 红蓝各一人
  for (let i = 0; i < 60; i++) B.updateCapture(1 / 60);
  check("双方都在圈里时进度冻结", Math.abs(pt2.prog - 0.4) < 1e-6, pt2.prog.toFixed(3));

  isolate(hs2, [], pt2);
  for (let i = 0; i < 60; i++) B.updateCapture(1 / 60);
  check("圈里没人时进度回落（约 0.16/s）", pt2.prog > 0.22 && pt2.prog < 0.26, pt2.prog.toFixed(3));

  const hs3 = setupCapture(2);
  const pt3 = B.capture.pts[0];
  pt3.owner = 0; pt3.prog = 0.5; pt3.by = 1;
  isolate(hs3, [hs3[0]], pt3);               // 只有红队（占领方）在圈里
  const before = pt3.prog;
  for (let i = 0; i < 30; i++) B.updateCapture(1 / 60);
  check("己方站在自家点上会把敌方进度退回", pt3.prog < before - 0.05,
    before.toFixed(2) + " → " + pt3.prog.toFixed(2));
}

console.log("\n=== 5. 产分（大点权重 ×2）===");
{
  const hs = setupCapture(2);
  const st = B.capture;
  const small = st.pts.find(p => p !== st.big);
  small.owner = 0;
  isolate(hs, [], small);
  const s0 = st.score[0];
  /* 121 帧 = 2.016 秒，避开 0.5 节拍的浮点临界 */
  for (let i = 0; i < 121; i++) B.updateCapture(1 / 60);
  check("小点 2 秒产 2 分", Math.abs((st.score[0] - s0) - 2) < 0.02, (st.score[0] - s0).toFixed(2));

  const hs2 = setupCapture(2);
  const st2 = B.capture;
  st2.big.owner = 1;
  isolate(hs2, [], st2.big);
  const s1 = st2.score[1];
  for (let i = 0; i < 121; i++) B.updateCapture(1 / 60);
  check("大点 2 秒产 4 分（×2）", Math.abs((st2.score[1] - s1) - 4) < 0.02, (st2.score[1] - s1).toFixed(2));

  const hs3 = setupCapture(2);
  isolate(hs3, [], B.capture.pts[0]);
  for (let i = 0; i < 120; i++) B.updateCapture(1 / 60);
  check("中立点不产分", B.capture.score[0] === 0 && B.capture.score[1] === 0);
}

console.log("\n=== 6. 先到 80 分结束 ===");
{
  const hs = setupCapture(2);
  B.capture.score[0] = 79.6;
  B.capture.pts[0].owner = 0;
  isolate(hs, [], B.capture.pts[0]);
  for (let i = 0; i < 60; i++) B.updateCapture(1 / 60);
  check("达到 80 分即结束", B.state === "over" && B.capture.done === true, B.state);
  check("matchWinner 指向红队", B.matchWinner === 0, B.matchWinner);
  check("比分不小于 80", B.capture.score[0] >= 80, B.capture.score[0].toFixed(1));
}

console.log("\n=== 7. 限时结算 ===");
{
  const hs = setupCapture(2);
  B.capture.score[0] = 12; B.capture.score[1] = 20;
  B.roundT = -0.01;
  B.updateCapture(1 / 60);
  check("时间到比分高者获胜", B.state === "over" && B.matchWinner === 1, "winner=" + B.matchWinner);

  const hs2 = setupCapture(2);
  hs2[0].hp = 60; hs2[1].hp = 190;
  B.capture.score[0] = 10; B.capture.score[1] = 10;
  B.roundT = -0.01;
  B.updateCapture(1 / 60);
  check("同分比剩余总血量（蓝队血多则蓝胜）", B.state === "over" && B.matchWinner === 1, "winner=" + B.matchWinner);
}

console.log("\n=== 8. 复活递增 / 基地回血 ===");
{
  const hs = setupCapture(2);
  const me = hs[0], foe = hs[1];
  B.kill(me, foe);
  check("阵亡后不立即结算", B.state !== "over", B.state);
  check("第一次复活 3 秒", Math.abs(me.respawnT - 3.0) < 1e-6, me.respawnT);
  for (let i = 0; i < 200; i++) B.updateRespawn(1 / 60);
  check("3 秒后复活", me.dead === false && me.hp === me.maxHp, "hp=" + me.hp);
  const b0 = B.captureBase(0);
  check("在自家基地圈里复活", Math.hypot(me.x - b0.x, me.y - b0.y) <= b0.r + 1,
    Math.round(Math.hypot(me.x - b0.x, me.y - b0.y)));
  check("复活带无敌", me.invuln > 0, me.invuln.toFixed(2));

  B.kill(me, foe);
  check("第二次阵亡复活 6 秒", Math.abs(me.respawnT - 6.0) < 1e-6, me.respawnT);
  B.updateRespawn(7);
  B.kill(me, foe);
  check("第三次阵亡复活 9 秒", Math.abs(me.respawnT - 9.0) < 1e-6, me.respawnT);

  /* 基地回血：站在自家圈里 1 秒回 5% 最大生命 */
  const hs2 = setupCapture(2);
  const h = hs2[0], base = B.captureBase(0);
  h.x = base.x; h.y = base.y;
  h.hp = h.maxHp * 0.5;
  const before = h.hp;
  for (let i = 0; i < 61; i++) B.updateCapture(1 / 60);
  const gain = h.hp - before;
  check("自家基地内每秒回 5% 最大生命",
    Math.abs(gain - h.maxHp * 0.05) < h.maxHp * 0.015, gain.toFixed(1));
}

console.log("\n=== 9. 据点炮塔 ===");
{
  /* 占下一个点 → 中心升起炮塔 */
  const hs = setupCapture(3);
  const pt = B.capture.pts.find(p => p !== B.capture.big);
  isolate(hs, [hs[0]], pt);
  for (let i = 0; i < 330; i++) B.updateCapture(1 / 60);
  const o = pt.turret;
  check("占领后据点中心生成炮塔", !!o && !o.dead && o.capTurret === true);
  check("炮塔在据点中心", !!o && Math.abs(o.x - pt.x) < 1 && Math.abs(o.y - pt.y) < 1);
  check("炮塔初始血 1200、归属红队", !!o && o.hp === 1200 && o.maxHp === 1200 && o.side === 0,
    o ? o.hp + " / side=" + o.side : "无");

  /* 射程 = 据点半径：圈外不射、圈内开火 */
  const enemy = hs[1], ally = hs[2];
  ally.x = pt.x + 20; ally.y = pt.y;
  enemy.x = pt.x + pt.r + 30; enemy.y = pt.y;
  o.shotT = 0; B.projs.length = 0;
  B.updateCaptureTurrets(1 / 60);
  check("敌人在据点圈外时炮塔不开火", B.projs.length === 0, B.projs.length);
  enemy.x = pt.x + pt.r - 30;
  B.updateCaptureTurrets(1 / 60);
  check("敌人进入据点范围即开火", B.projs.length === 1, B.projs.length);
  const pr = B.projs[0];
  check("炮塔弹伤害 26、锁定敌人",
    !!pr && pr.dmg === 26 && pr.data && pr.data.tgt === enemy,
    pr ? pr.dmg + " / " + (pr.data && pr.data.tgt && pr.data.tgt.name) : "无");
  check("炮塔不打自家角色", (pr && pr.data && pr.data.tgt) !== ally);

  /* 易主：只换攻击目标，血量保留 */
  o.hp = 700;
  pt.prog = 0.96; pt.by = 1; pt.owner = 0;
  isolate(hs, [hs[1]], pt);
  for (let i = 0; i < 40; i++) B.updateCapture(1 / 60);
  check("据点易主后炮塔换边", pt.owner === 1 && pt.turret && pt.turret.side === 1,
    "owner=" + pt.owner + " side=" + (pt.turret && pt.turret.side));
  check("易主时炮塔血量不变", pt.turret && pt.turret.hp === 700, pt.turret && pt.turret.hp);

  /* 被拆掉 → 本局永久消失 */
  const t2 = pt.turret;
  t2.hp = 300;
  LD.Terrain.hitProp(B.terrain, t2, 200, { src: hs[0] });   // 英雄 3 倍拆解 = 600
  check("炮塔被打掉后消失", t2.dead === true && pt.turret === null, "dead=" + t2.dead);
  B.projs.length = 0;
  B.updateCaptureTurrets(1 / 60);
  check("炮塔消失后不再开火", B.projs.length === 0, B.projs.length);

  /* 下一次据点易主才重建 */
  pt.prog = 0.96; pt.by = 0; pt.owner = 1;
  isolate(hs, [hs[0]], pt);
  for (let i = 0; i < 40; i++) B.updateCapture(1 / 60);
  check("据点再次易主时重新立塔", pt.owner === 0 && !!pt.turret && pt.turret.hp === 1200,
    pt.turret && pt.turret.hp);
}

console.log("\n=== 10. AI 选点 ===");
{
  const hs = setupCapture(2);
  const ai = hs[0], foe = hs[1];
  const st = B.capture;
  /* 最近的据点 */
  let near = st.pts[0], nd = Infinity;
  st.pts.forEach(p => { const d = Math.hypot(p.x - ai.x, p.y - ai.y); if (d < nd) { nd = d; near = p; } });
  foe.x = B.world.w - 300; foe.y = B.world.h - 300;
  ai.hp = ai.maxHp;
  LD.AI.mkBot(ai, "normal"); ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  const d = Math.hypot(near.x - ai.x, near.y - ai.y) || 1;
  const dot = ai.ctrl.mx * (near.x - ai.x) / d + ai.ctrl.my * (near.y - ai.y) / d;
  check("AI 朝最近的据点移动", dot > 0.6, "朝向点积 " + dot.toFixed(2));

  /* 残血 + 身边没架打 → 回自家基地回血 */
  const hs2 = setupCapture(2);
  const ai2 = hs2[0], foe2 = hs2[1];
  ai2.x = B.world.w * 0.5; ai2.y = playMidY();
  ai2.hp = ai2.maxHp * 0.15;
  foe2.x = B.world.w - 200; foe2.y = B.world.h - 200;
  LD.AI.mkBot(ai2, "normal"); ai2.bot.think = 0;
  LD.AI.tickHero(ai2, 1 / 60);
  const base = B.captureBase(0);
  const d2 = Math.hypot(base.x - ai2.x, base.y - ai2.y) || 1;
  const dot2 = ai2.ctrl.mx * (base.x - ai2.x) / d2 + ai2.ctrl.my * (base.y - ai2.y) / d2;
  check("残血且无交战时回基地", dot2 > 0.5, "朝向点积 " + dot2.toFixed(2));
}

console.log("\n=== 11. 房间分队（占点）===");
{
  const UI = LD.UI, room = UI.room;
  /* 玩家选蓝队，两张人机卡一蓝一红 */
  room.bots.length = 0;
  room.rule = "capture";
  room.myTeam = 1;
  room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: LD.Profile.look(), team: 1 });
  room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: LD.Profile.look(), team: 0 });
  UI.roomStart();
  check("占点开局按卡片选择分队", B.rule === "capture" && B.fighters[0].team === 1 && B.fighters[1].team === 1 && B.fighters[2].team === 0,
    B.fighters.map(f => f.team).join(","));
  check("占点开局仍是两支队伍", new Set(B.fighters.map(f => f.team)).size === 2,
    Array.from(new Set(B.fighters.map(f => f.team))).join("/"));
  const b1 = B.captureBase(1);
  check("蓝队玩家落在蓝队基地", Math.hypot(B.fighters[0].x - b1.x, B.fighters[0].y - b1.y) < b1.r,
    "d=" + Math.round(Math.hypot(B.fighters[0].x - b1.x, B.fighters[0].y - b1.y)));

  /* 没手动选过队伍时：人机与玩家交替分边，保证默认就有对手 */
  room.bots.length = 0;
  room.myTeam = 0;
  room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: LD.Profile.look() });
  room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: LD.Profile.look() });
  UI.roomStart();
  check("占点默认分队：人机与玩家交替", B.fighters[0].team === 0 && B.fighters[1].team === 1 && B.fighters[2].team === 0,
    B.fighters.map(f => f.team).join(","));

  /* 全塞一队必须拒绝开局（否则场上没有对手） */
  room.bots.forEach(b => { b.team = 0; });
  room.myTeam = 0;
  const toast0 = UI.toast;
  let warned = "";
  UI.toast = m => { warned = m; };
  B.state = "idle";
  const before = B.state;
  UI.roomStart();
  UI.toast = toast0;
  check("红蓝全同队时拒绝开局", before === "idle" && !!warned, warned || "没有提示");
}

console.log("\n=== 12. 渲染层不崩 ===");
{
  const hs = setupCapture(4);
  const st = B.capture;
  const small = st.pts.find(p => p !== st.big);
  small.owner = 0;
  small.turret = B.spawnCaptureTurret(small, 0);
  st.big.owner = 1; st.big.prog = 0.5; st.big.by = 0; st.big.flash = 0.4;
  st.big.turret = B.spawnCaptureTurret(st.big, 1);
  isolate(hs, [hs[0], hs[1]], st.big);
  const ctx = makeCtx();
  let err = null;
  try { B.draw(ctx); } catch (e) { err = e; }
  check("基地圈 / 据点 / 炮塔 / 读条可以正常绘制", !err, err ? err.message : "ok");
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
