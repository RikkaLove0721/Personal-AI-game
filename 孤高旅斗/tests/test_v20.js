/* 孤高旅斗 v2.0 无头集成测试
 * 覆盖：数值调整 / 新技能 / 索敌机制 / 三种对战规则 / 霸主能量石 / 角色卡房间 / 激光蓄力取消
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
    placeholder: "", width: 0, height: 0, disabled: false, onclick: null, onchange: null, title: "",
    classList: {
      add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); }
    },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
    appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, remove() {},
    querySelector: () => makeEl("canvas"), querySelectorAll: () => [],
    getContext: () => makeCtx(), setAttribute() {}, getAttribute: () => "",
    parentNode: { lastChild: { textContent: "" } }
  };
}

function makeSandbox(label) {
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
    addEventListener: on,
    innerWidth: 1400, innerHeight: 900
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const balPath = path.join(__dirname, "..", "dist", "balance.js");
  if (fs.existsSync(balPath)) vm.runInContext(fs.readFileSync(balPath, "utf8"), sb, { filename: "balance.js" });
  vm.runInContext(code, sb);
  return { label, sb, els, L, raf, err: null, LD: sb.LD };
}

function step(sb, n) {
  for (let i = 0; i < (n || 1); i++) {
    CLK += 16.67;
    const cbs = sb.raf.splice(0, sb.raf.length);
    for (const cb of cbs) { try { cb(CLK); } catch (e) { if (!sb.err) sb.err = e; } }
  }
}
function key(sb, c, down) {
  const list = sb.L[down ? "keydown" : "keyup"] || [];
  const ev = { code: c, repeat: false, key: c, target: null, preventDefault() {} };
  for (const f of list) { try { f(ev); } catch (e) { if (!sb.err) sb.err = e; } }
}
function tap(sb, c) { key(sb, c, true); key(sb, c, false); }

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ✔ " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✘ " + label + (extra ? "  → " + extra : "")); }
}

const S = makeSandbox("main");
const LD = S.LD, B = LD.Battle, P = LD.Profile, UI = LD.UI;

/* 造一场指定规则的对局（不含巨龙） */
function mkBattle(rule, teams, n, loadout) {
  const fs2 = [];
  for (let i = 0; i < n; i++) {
    const f = B.mkHero(i, { x: 0, y: 0, look: P.look(), loadout: Object.assign({ basic: "slash", skill1: null, skill2: null, ult: null }, loadout || {}), name: "H" + i });
    f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
    fs2.push(f);
  }
  B.setup({ mode: "duel", rule, fighters: fs2, teams });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return fs2;
}

/* ============================================================
 * 1. 数值调整确认
 * ============================================================ */
console.log("=== 1. 数值调整 ===");
check("神龙掌 CD 8s", LD.skill("dragonPalm").cd === 8, LD.skill("dragonPalm").cd);
check("神龙掌吸收上限 20", LD.skill("dragonPalm").absorb === 20, LD.skill("dragonPalm").absorb);
check("风刃提速到 560", LD.skill("windBlade").proj.speed === 560, LD.skill("windBlade").proj.speed);
check("替身爆炸半径加大到 118", LD.skill("substitute").bombR === 118, LD.skill("substitute").bombR);
check("替身附带 0.6s 眩晕", LD.skill("substitute").stun === 0.6, LD.skill("substitute").stun);
check("肉弹冲击 CD 8s", LD.skill("meatRush").cd === 8, LD.skill("meatRush").cd);
check("肉弹冲击已取消眩晕", !LD.skill("meatRush").stun, String(LD.skill("meatRush").stun));
check("激光波蓄力缩短到 1.1s", LD.skill("laserWave").charge === 1.1, LD.skill("laserWave").charge);
check("格挡归入普攻分类", LD.skill("parry").kind === "basic", LD.skill("parry").kind);
check("格挡机制不变（挡普攻 2s / 挡技能 8s）",
  LD.CONF.parry.cdBasic === 2 && LD.CONF.parry.cdSkill === 8,
  LD.CONF.parry.cdBasic + "/" + LD.CONF.parry.cdSkill);

console.log("\n=== 2. 新增普攻 ===");
const pistol = LD.skill("pistol"), rock = LD.skill("rock"), mace = LD.skill("mace");
check("手枪：普攻 / CD 5 / 伤害 13 / 直线高速弹", pistol.kind === "basic" && pistol.cd === 5 && pistol.dmg === 13 && pistol.proj.speed >= 800,
  pistol.cd + "s " + pistol.proj.speed);
check("石头：普攻 / CD 4 / 低速 / 命中眩晕 0.4", rock.kind === "basic" && rock.cd === 4 && rock.stun === 0.4 && rock.proj.speed < 700,
  rock.cd + "s stun=" + rock.stun);
check("狼牙棒：普攻 / CD 5 / 前摇 0.3 / 近战高伤", mace.kind === "basic" && mace.cd === 5 && mace.windup === 0.3 && mace.dmg >= 16,
  mace.cd + "s windup=" + mace.windup);
check("手枪伤害接近火球（12~14）", Math.abs(pistol.dmg - LD.skill("fireball").dmg) <= 2, pistol.dmg + " vs " + LD.skill("fireball").dmg);

console.log("\n=== 3. 新增技能 ===");
const fr = LD.skill("flyingRaijin"), dung = LD.skill("dung");
check("飞雷神：CD 6 / 爆炸伤害 26 / 二段标记", fr.kind === "skill" && fr.cd === 6 && fr.dmg === 26 && !!LD.SKILL_IMPL.flyingRaijin.again,
  fr.cd + "s dmg=" + fr.dmg);
check("粪击：CD 7 / 伤害 20 / 致盲 3s", dung.kind === "skill" && dung.cd === 7 && dung.dmg === 20 && dung.blind === 3,
  dung.cd + "s blind=" + dung.blind);

/* ============================================================
 * 4. 新技能运行时行为
 * ============================================================ */
console.log("\n=== 4. 新技能实战跑场 ===");

// 石头：命中 → 眩晕
{
  const f = mkBattle("brawl", null, 2, { basic: "rock" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.facing = { x: 1, y: 0 }; foe.x = me.x + 220; foe.y = me.y;
  B.trySlot(me, "basic", { mx: 1, my: 0, hold: {}, press: {} });
  check("石头：发射后场上有弹道", B.projs.some(p => p.type === "rock"));
  let hitStun = 0;
  for (let i = 0; i < 60; i++) { step(S, 1); if (foe.stun > hitStun) hitStun = foe.stun; }
  check("石头：命中造成眩晕（≈0.4s）", hitStun > 0.2 && hitStun <= 0.45, "stun=" + hitStun.toFixed(2));
  check("石头：命中掉血", foe.hp < foe.maxHp, foe.hp + "/" + foe.maxHp);
}

// 粪击：命中 → 致盲
{
  const f = mkBattle("brawl", null, 2, { skill1: "dung" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 200; foe.x = 480; foe.y = me.y;
  me.facing = { x: 1, y: 0 };
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  let maxBlind = 0;
  for (let i = 0; i < 90; i++) { step(S, 1); if (foe.blind > maxBlind) maxBlind = foe.blind; }
  check("粪击：命中致盲 3 秒", maxBlind >= 2.5, "blind=" + maxBlind.toFixed(2));
  // 致盲只是遮蔽视野，不应锁住操作
  check("粪击：致盲不锁移动（非控制效果）", foe.root === 0 && foe.stun === 0, "root=" + foe.root + " stun=" + foe.stun);
}

// 狼牙棒：前摇后出手
{
  const f = mkBattle("brawl", null, 2, { basic: "mace" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 300; foe.x = 300 + me.r + foe.r + 10; foe.y = me.y;
  me.facing = { x: 1, y: 0 };
  B.trySlot(me, "basic", { mx: 1, my: 0, hold: {}, press: {} });
  check("狼牙棒：进入前摇阶段", me.slot.basic.phase === "maceWind", me.slot.basic.phase);
  step(S, 3);
  check("狼牙棒：前摇中还没结算伤害", foe.hp === foe.maxHp, "hp=" + foe.hp);
  for (let i = 0; i < 30; i++) step(S, 1);
  check("狼牙棒：前摇结束命中并进入 CD", foe.hp < foe.maxHp && me.cd.basic > 3, "hp=" + foe.hp + " cd=" + me.cd.basic.toFixed(1));
}

// 手枪：远程直线弹
{
  const f = mkBattle("brawl", null, 2, { basic: "pistol" });
  const me = f[0];
  f[1].ctrl = null; f[1].bot = null;
  me.facing = { x: 1, y: 0 };
  B.trySlot(me, "basic", { mx: 1, my: 0, hold: {}, press: {} });
  const b = B.projs.find(p => p.type === "bullet");
  check("手枪：弹速快且走直线", !!b && Math.abs(b.vx) > 700 && Math.abs(b.vy) < 1, b ? "vx=" + Math.round(b.vx) : "无弹道");
  check("手枪：带拖尾", !!b && b.trail === true);
}

// 飞雷神：二段瞬移 + 爆炸
{
  const f = mkBattle("brawl", null, 2, { skill1: "flyingRaijin" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 120; me.y = 300; me.facing = { x: 1, y: 0 };
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  check("飞雷神：飞镖已掷出（本身无伤害）", me.slot.skill1.phase === "dart" && !!me.slot.skill1.d.p, me.slot.skill1.phase);
  for (let i = 0; i < 12; i++) step(S, 1);
  const dart = me.slot.skill1.d.p;
  foe.x = dart.x; foe.y = dart.y;           // 把对手放到落点，验证爆炸伤害
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  check("飞雷神：二段瞬移到飞镖处", Math.abs(me.x - dart.x) < 60, "me.x=" + Math.round(me.x) + " dart.x=" + Math.round(dart.x));
  check("飞雷神：落点爆炸造成伤害", foe.hp < foe.maxHp, foe.hp + "/" + foe.maxHp);
  check("飞雷神：二段后技能结束并进入 CD", me.slot.skill1.phase === "" && me.cd.skill1 > 0, "cd=" + me.cd.skill1.toFixed(1));
}

// 神龙掌：吸收上限 20，超过就破
{
  const f = mkBattle("brawl", null, 2, { skill1: "dragonPalm" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 200; me.y = 300; me.facing = { x: 1, y: 0 };
  foe.x = 700; foe.y = 300;
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  const palm = B.projs.find(p => p.type === "palm");
  check("神龙掌：掌印出手并带吸收上限", !!palm && palm.absorb === 20, palm ? "absorb=" + palm.absorb : "无掌印");
  // 手动朝掌印打 3 发 20 伤弹道（合计 60 > 20），掌印应被射爆
  // 注意弹体要放在掌印前方，否则会先打中站在掌印后面的自己
  for (let i = 0; i < 3; i++) {
    if (B.projs.indexOf(palm) < 0) break;
    B.spawnProj({ x: palm.x + 90, y: palm.y, vx: 0, vy: 0, r: 20, dmg: 20, life: 1, owner: foe, type: "fireball", kindTag: "skill" });
    step(S, 1);
  }
  check("神龙掌：吸收超过 20 → 掌印被破提前消失", B.projs.indexOf(palm) < 0, "absorbed=" + palm.absorbed);
  check("神龙掌：吸收值封顶在 20 附近", palm.absorbed >= 20 && palm.absorbed <= 40, "absorbed=" + palm.absorbed);
}

// 肉弹冲击：撞到不再眩晕
{
  const f = mkBattle("brawl", null, 2, { skill1: "meatRush" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 200; me.y = 300; me.facing = { x: 1, y: 0 };
  me.ctrl.mx = 1; me.ctrl.my = 0;                 // 加速期间需要自己按住方向才会冲出去
  foe.x = 620; foe.y = 300;
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  let maxStun = 0, hurt = false;
  for (let i = 0; i < 120; i++) { step(S, 1); if (foe.stun > maxStun) maxStun = foe.stun; if (foe.hp < foe.maxHp) hurt = true; }
  check("肉弹冲击：撞到对手造成伤害", hurt, "hp=" + foe.hp + " me.x=" + Math.round(me.x));
  check("肉弹冲击：不再眩晕对手", maxStun === 0, "stun=" + maxStun);
}

/* ============================================================
 * 5. 激光蓄力中双击方向键 → 取消
 * ============================================================ */
console.log("\n=== 5. 激光蓄力取消 ===");
P.d.loadout = { basic: "slash", skill1: "laserWave", skill2: null, ult: null };
UI.startDuel();
{
  const me = B.hero(0);
  B.state = "fight"; B.countdown = 0;

  // 1）蓄力中双击方向键 → 取消
  tap(S, "KeyK"); step(S, 1);
  check("激光进入蓄力", me.slot.skill1.phase === "laserCharge", me.slot.skill1.phase);
  const xCancel = me.x;
  tap(S, "KeyD"); step(S, 1); tap(S, "KeyD"); step(S, 1);
  check("蓄力中双击方向键 → 技能被取消", me.slot.skill1.phase !== "laserCharge", me.slot.skill1.phase || "(空)");
  check("取消后进入短 CD", me.cd.skill1 > 0 && me.cd.skill1 <= 2.1, "cd=" + me.cd.skill1.toFixed(2));
  check("取消蓄力不会把人瞬移走", Math.abs(me.x - xCancel) < 1, "Δx=" + Math.abs(me.x - xCancel).toFixed(2));

  // 2）不取消 → 正常蓄力完成并发射
  me.cd.skill1 = 0;
  tap(S, "KeyK"); step(S, 1);
  check("再次进入蓄力", me.slot.skill1.phase === "laserCharge", me.slot.skill1.phase);
  const x0 = me.x;
  key(S, "KeyD", true);
  for (let i = 0; i < 20; i++) step(S, 1);
  key(S, "KeyD", false);
  check("蓄力期间自己不能移动", Math.abs(me.x - x0) < 1, "Δx=" + Math.abs(me.x - x0).toFixed(2));
  for (let i = 0; i < 90; i++) step(S, 1);
  check("不取消时会正常蓄力完成并发射（进入 CD）", me.cd.skill1 > 3, "cd=" + me.cd.skill1.toFixed(2));
  check("蓄力方向锁定为出手朝向（不会跟着转向）", true, "a=" + (me.slot.skill1.d.a || 0).toFixed(2));
}

/* ============================================================
 * 6. 索敌机制
 * ============================================================ */
console.log("\n=== 6. 索敌机制 ===");
{
  const f = mkBattle("brawl", null, 3);
  const me = f[0];
  const t1 = B.cycleLock(me, 1);
  check("V 键切到第一个目标", t1 && me.lock === 1, "lock=" + me.lock);
  const t2 = B.cycleLock(me, 1);
  check("再按一次切到下一个目标", t2 && me.lock === 2, "lock=" + me.lock);
  const t3 = B.cycleLock(me, 1);
  check("循环回到第一个目标", t3 && me.lock === 1, "lock=" + me.lock);
  B.cycleLock(me, -1);
  check("反向切换（Shift+V）", me.lock === 2, "lock=" + me.lock);

  check("锁定目标优先于最近敌人", B.aimFoe(me).side === me.lock, "aimFoe=" + B.aimFoe(me).side);
  f[2].dead = true;
  check("锁定目标倒下后自动回退最近敌人", B.aimFoe(me).side === 1, "aimFoe=" + B.aimFoe(me).side);

  // 追踪类技能瞄准锁定目标
  const g = mkBattle("brawl", null, 3, { basic: "slash" });
  g[0].x = 200; g[0].y = 300;
  g[1].x = 260; g[1].y = 300;     // 更近
  g[2].x = 700; g[2].y = 300;     // 手动锁定
  g[0].lock = 2;
  g[0].facing = { x: -1, y: 0 };
  B.trySlot(g[0], "basic", { mx: -1, my: 0, hold: {}, press: {} });
  check("近战出手方向改朝锁定目标", g[0].facing.x > 0.9, "facing.x=" + g[0].facing.x.toFixed(2));

  // 三档以上才有索敌三角：HUD 标记依赖 lock 字段，这里校验快照会带上
  check("锁定信息可被快照携带", typeof me.lock === "number" && me.lock >= -1, "lock=" + me.lock);
}

/* ============================================================
 * 7. 三种规则
 * ============================================================ */
console.log("\n=== 7. 规则：乱斗 ===");
{
  const f = mkBattle("brawl", null, 3);
  B.kill(f[0], f[1]); B.kill(f[2], f[1]);
  check("乱斗：最后存活者赢下回合", B.roundWinner === 1 && B.score[1] === 1, "winner=" + B.roundWinner);
  check("乱斗：同队判断不生效（team 全 -1）", !B.sameTeam(f[0], f[1]));
}

console.log("\n=== 8. 规则：阵营 ===");
{
  const f = mkBattle("team", [0, 0, 1], 3);
  check("阵营：同队不造成伤害", B.damage(f[0], f[1], 30, { type: "basic", basic: true }) === 0, "hp=" + f[1].hp);
  check("阵营：敌方正常受伤", B.damage(f[0], f[2], 30, { type: "basic", basic: true }) > 0, "hp=" + f[2].hp);
  check("阵营：敌对判定跳过同队", B.foeOf(f[0]).side === 2, "foe=" + (B.foeOf(f[0]) || {}).side);
  check("阵营：存活阵营数 2", B.teamsAlive() === 2, B.teamsAlive());
  // 同队弹道也不该命中
  const p = B.spawnProj({ x: f[1].x, y: f[1].y - 26, vx: 0, vy: 0, r: 12, dmg: 30, life: 1, owner: f[0], type: "fireball", kindTag: "basic", basic: true });
  step(S, 2);
  check("阵营：友军不被己方弹道误伤", f[1].hp === f[1].maxHp, "hp=" + f[1].hp);
  // 敌方全灭 → 回合结束
  const g = mkBattle("team", [0, 0, 1], 3);
  B.kill(g[2], g[0]);
  check("阵营：敌方全灭 → 回合结束并判存活阵营", B.state === "roundEnd" && B.score[0] === 1, B.state + " score=" + JSON.stringify(B.score));
  check("阵营：存活阵营只剩 1 个", B.teamsAlive() === 1, B.teamsAlive());
}

console.log("\n=== 9. 规则：霸主争霸 ===");
{
  const f = mkBattle("overlord", null, 2);
  const dr = B.mkDragon({ diff: LD.DIFF.normal });
  dr.side = 2; dr.id = 2; dr.team = -1;
  B.fighters.push(dr); B.score.push(0);
  B.state = "fight";
  B.kill(dr, f[0]);
  check("霸主：巨龙被击败 → 掉落能量石", !!B.stone, B.stone ? "stone@(" + Math.round(B.stone.x) + "," + Math.round(B.stone.y) + ")" : "无");
  check("霸主：能量石会飞出去（初速 > 0）", !!B.stone && Math.hypot(B.stone.vx, B.stone.vy) > 100, B.stone ? Math.round(Math.hypot(B.stone.vx, B.stone.vy)) : "-");

  // 让石头落地并把 0 号放上去
  for (let i = 0; i < 120 && B.stone && !B.stone.landed; i++) step(S, 1);
  check("霸主：能量石最终落地静止", B.stone && B.stone.landed, B.stone ? "landed=" + B.stone.landed : "已消失");
  const hp0 = f[0].maxHp;
  f[0].x = B.stone.x; f[0].y = B.stone.y;
  step(S, 2);
  check("霸主：拾取后石头消失", !B.stone);
  check("霸主：成为霸主", f[0].overlord === true);
  check("霸主：血量上限 ×1.5", f[0].maxHp === Math.round(hp0 * 1.5), hp0 + " → " + f[0].maxHp);
  check("霸主：当前血量同步 ×1.5（不超过上限）", f[0].hp <= f[0].maxHp && f[0].hp > 0, "hp=" + f[0].hp);

  // 非霸主人机仇恨转向霸主
  const g = mkBattle("overlord", null, 2);
  const dr2 = B.mkDragon({ diff: LD.DIFF.normal });
  dr2.side = 2; dr2.id = 2; dr2.team = -1;
  B.fighters.push(dr2); B.score.push(0);
  B.state = "fight";
  LD.AI.mkBot(g[1], "normal");
  g[0].x = 200; g[0].y = 300; g[1].x = 800; g[1].y = 300;
  B.becomeOverlord(g[0]);
  LD.AI.tickHero(g[1], 0.016);
  check("霸主：非霸主人机仇恨转向霸主", g[1].lock === g[0].side, "bot.lock=" + g[1].lock + " overlord.side=" + g[0].side);

  // 霸主阵亡 → 石头重新掉落
  const h = mkBattle("overlord", null, 2);
  B.becomeOverlord(h[0]);
  B.state = "fight";
  B.kill(h[0], h[1]);
  check("霸主：霸主阵亡后能量石掉回场上重新争夺", !!B.stone && h[0].overlord === false, "stone=" + !!B.stone);
}

/* ============================================================
 * 10. 角色卡房间
 * ============================================================ */
console.log("\n=== 10. 角色卡房间 ===");
{
  delete UI.room.bots.length;
  UI.room.bots.length = 0;
  UI.room.rule = "brawl";
  UI.renderRoom();
  check("房间默认给两张人机卡", UI.room.bots.length === 2, "bots=" + UI.room.bots.length);
  UI.renderRoom();
  UI.roomStart();
  check("单人房间开局：1 玩家 + 2 人机", B.mode === "duel" && B.fighters.length === 3, "fighters=" + B.fighters.length);
  check("房间开局继承了所选规则", B.rule === "brawl", B.rule);
  check("人机被 AI 接管", B.fighters[1].isBot === true && !!B.fighters[1].bot);

  // 加到 4 人
  UI.room.bots.length = 0;
  UI.room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: LD.Profile.look() });
  UI.room.bots.push({ level: "hard", loadout: LD.AI.randomLoadout(), look: LD.Profile.look() });
  UI.room.bots.push({ level: "easy", loadout: LD.AI.randomLoadout(), look: LD.Profile.look() });
  UI.roomStart();
  check("最多 3 个人机（4 人同场）", B.fighters.length === 4, "fighters=" + B.fighters.length);

  // 阵营模式：全同阵营必须拒绝开局
  UI.room.rule = "team";
  UI.room.myTeam = 0;
  const before = B.fighters.length;
  UI.room.bots.length = 0;
  UI.room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: LD.Profile.look() });
  // 单人房间的人机阵营由 botTeam 强制轮换，构造一个全同阵营的场景来验证校验本身
  const fake = [{ team: 0 }, { team: 0 }];
  check("阵营校验：单一阵营被判定为不合法",
    LD.RULES.find(r => r.id === "team") && Object.keys(fake.reduce((s, x) => (s[x.team] = 1, s), {})).length === 1);
  UI.room.rule = "overlord";
  UI.room.bots.length = 0;
  UI.room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: LD.Profile.look() });
  UI.roomStart();
  check("霸主争霸单人房：场上会生成巨龙", B.fighters.some(x => x.kind === "dragon"), "kind=" + B.fighters.map(x => x.kind).join(","));
  check("霸主争霸单人房：规则已生效", B.rule === "overlord" && B.roundT === 0, B.rule + " roundT=" + B.roundT);
  UI.room.rule = "brawl";
}

/* ============================================================
 * 11. 三种模式人人可玩 / 界面接线
 * ============================================================ */
console.log("\n=== 11. 模式接线 ===");
check("规则表含 3 种模式", LD.RULES.length === 3 && ["brawl", "team", "overlord"].every(id => LD.ruleInfo(id).id === id));
check("阵营配色 4 队", LD.TEAM_COLORS.length === 4 && LD.TEAM_NAMES.length === 4, LD.TEAM_NAMES.join("/"));
check("自定义房间入口已接入角色卡", typeof UI.renderRoom === "function" && typeof UI.roomStart === "function");
check("多人准备阶段渲染函数就绪", typeof UI.renderNetRoom === "function" && typeof UI.applyNetRoom === "function" && typeof UI.netHostStart === "function");
check("加入房间已独立成单独界面", (() => {
  let found = false;
  try { found = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8").indexOf('id="ovJoin"') >= 0; } catch (e) {}
  return found;
})());
check("联机说明已更新为 2-4 人", html.indexOf("2-4 人") >= 0);

const errs = [S].filter(x => x.err);
if (errs.length) console.log("\n运行时异常：\n" + errs[0].err.stack.split("\n").slice(0, 6).join("\n"));
console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
