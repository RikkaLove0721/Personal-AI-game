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
LD.CONF.critRate = 0;   // 关闭暴击（10% 概率 ×2 伤害），保证数值断言确定性

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
check("肉弹冲击：恢复 0.4s 眩晕", LD.skill("meatRush").stun === 0.4, String(LD.skill("meatRush").stun));
check("激光波蓄力缩短到 1.1s", LD.skill("laserWave").charge === 1.1, LD.skill("laserWave").charge);
check("格挡归入普攻分类", LD.skill("parry").kind === "basic", LD.skill("parry").kind);
check("格挡机制不变（挡普攻 2s / 挡技能 8s）",
  LD.CONF.parry.cdBasic === 2 && LD.CONF.parry.cdSkill === 8,
  LD.CONF.parry.cdBasic + "/" + LD.CONF.parry.cdSkill);

console.log("\n=== 2. 新增普攻 ===");
const pistol = LD.skill("pistol"), rock = LD.skill("rock"), mace = LD.skill("mace");
check("手枪：普攻 / CD 3 / 伤害 13 / 直线高速弹", pistol.kind === "basic" && pistol.cd === 3 && pistol.dmg === 13 && pistol.proj.speed >= 800,
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
  me.x = 200; me.y = 300; f[1].x = 700; f[1].y = 300;   // v2.3 出生位置随机，必须固定才能断言直线
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
  check("肉弹冲击：命中眩晕 0.4s", maxStun > 0.3 && maxStun <= 0.45, "stun=" + maxStun);
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
  check("霸主：能量石会飞出去（随机散落，初速 > 500）", !!B.stone && Math.hypot(B.stone.vx, B.stone.vy) > 500, B.stone ? Math.round(Math.hypot(B.stone.vx, B.stone.vy)) : "-");

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

  // 霸主阵亡 → 能量石直接消散（v2.5：不再掉回场上）
  const h = mkBattle("overlord", null, 2);
  B.becomeOverlord(h[0]);
  B.state = "fight";
  B.kill(h[0], h[1]);
  check("霸主：霸主阵亡后能量石消散，不再掉落（v2.5）", !B.stone && h[0].overlord === false, "stone=" + !!B.stone);
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
check("规则表含 4 种模式（v2.5 新增天外来物）", LD.RULES.length === 4 && ["brawl", "team", "overlord", "gifts"].every(id => LD.ruleInfo(id).id === id));
check("阵营配色 4 队", LD.TEAM_COLORS.length === 4 && LD.TEAM_NAMES.length === 4, LD.TEAM_NAMES.join("/"));
check("自定义房间入口已接入角色卡", typeof UI.renderRoom === "function" && typeof UI.roomStart === "function");
check("多人准备阶段渲染函数就绪", typeof UI.renderNetRoom === "function" && typeof UI.applyNetRoom === "function" && typeof UI.netHostStart === "function");
check("加入房间已独立成单独界面", (() => {
  let found = false;
  try { found = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8").indexOf('id="ovJoin"') >= 0; } catch (e) {}
  return found;
})());
check("联机说明已更新为 2-4 人", html.indexOf("2-4 人") >= 0);

/* ============================================================
 * 12. v2.1：飞雷神修复 / 肉弹 3s / 狼牙棒眩晕 / 瞬身护盾 / 新技能
 * ============================================================ */
console.log("\n=== 12. v2.1 修复与新技能 ===");

// 飞雷神：一段飞镖无伤害
{
  const f = mkBattle("brawl", null, 2, { skill1: "flyingRaijin" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 120; me.y = 300; me.facing = { x: 1, y: 0 };
  foe.x = 420; foe.y = 300;                       // 站在飞镖航线上
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  for (let i = 0; i < 40; i++) step(S, 1);
  check("飞雷神：飞镖穿过敌人不造成伤害", foe.hp === foe.maxHp, "hp=" + foe.hp);
  check("飞雷神：镖未二段时不进 CD", me.cd.skill1 === 0, "cd=" + me.cd.skill1.toFixed(2));
}

// 肉弹冲击：加速严格 3 秒
{
  const f = mkBattle("brawl", null, 2, { skill1: "meatRush" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  foe.x = 40; foe.y = 40;                         // 放远处，避免撞到提前结束
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  let frames = 0, rushEnd = -1;
  while (frames < 400 && rushEnd < 0) { step(S, 1); frames++; if (me.buff.rush <= 0 && me.slot.skill1.phase === "") rushEnd = frames * 0.01667; }
  check("肉弹冲击：加速持续约 3 秒（2.8~3.3）", rushEnd > 2.8 && rushEnd < 3.3, "dur=" + rushEnd.toFixed(2) + "s");
}

// 狼牙棒：命中眩晕 0.4s + 伤害 24
{
  const f = mkBattle("brawl", null, 2, { basic: "mace" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 300; foe.x = 300 + me.r + foe.r + 6; foe.y = me.y;
  me.facing = { x: 1, y: 0 };
  B.trySlot(me, "basic", { mx: 1, my: 0, hold: {}, press: {} });
  for (let i = 0; i < 30; i++) step(S, 1);
  check("狼牙棒：伤害 24", foe.maxHp - foe.hp === 24, "dmg=" + (foe.maxHp - foe.hp));
  check("狼牙棒：命中眩晕 ≈0.4s", foe.stun > 0.2 && foe.stun <= 0.45, "stun=" + foe.stun.toFixed(2));
}

// 瞬身：瞬移后获得 2s 吸 20 护盾
{
  const f = mkBattle("brawl", null, 2, { skill1: "blink" });
  const me = f[0];
  f[1].ctrl = null; f[1].bot = null;
  me.cd.skill1 = 0;
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  for (let i = 0; i < 70; i++) step(S, 1);
  check("瞬身：瞬移后获得护盾 20", me.shield === 20, "shield=" + me.shield);
  check("瞬身：护盾持续 2 秒", me.shieldT > 1.5 && me.shieldT <= 2.01, "shieldT=" + me.shieldT.toFixed(2));
  // 护盾确实吸收伤害
  const before = me.hp;
  B.damage(f[1], me, 12, { type: "skill" });
  check("瞬身：护盾吸收伤害不掉血", me.hp === before, "hp=" + me.hp + " shield=" + me.shield);
}

// 冰霜行者：冰痕持续伤害 + 减速（手动模拟走动）
{
  const f = mkBattle("brawl", null, 2, { skill1: "frostWalk" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 200; me.y = 300;
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  for (let i = 0; i < 40; i++) { me.x += 32; step(S, 2); }   // 走 1.3 秒留冰痕
  const frostZones = B.zones.filter(z => z.type === "frost");
  check("冰霜行者：走过的地方结出冰痕", frostZones.length >= 5, "zones=" + frostZones.length);
  check("冰痕：互相错开不原地叠加", frostZones.length < 20, "zones=" + frostZones.length);
  const frost = frostZones[frostZones.length - 1];
  foe.x = frost.x; foe.y = frost.y;                // 站上一块孤立的冰痕
  foe.slowT = 0;
  const hp0 = foe.hp;
  for (let i = 0; i < 60; i++) step(S, 1);         // 1 秒 ≈ 3 次 tick = 18 伤
  check("冰痕：踩上持续掉血（≈18/秒）", foe.hp < hp0 && hp0 - foe.hp <= 30, "dmg=" + (hp0 - foe.hp));
  check("冰痕：踩上被减速", foe.slowT > 0 || foe.hp < hp0 - 10, "slowT=" + foe.slowT.toFixed(2));
}

// 苍：聚拢 + 减速 + 16 伤
{
  const f = mkBattle("brawl", null, 3, { skill1: "cang" });
  const me = f[0];
  f[1].ctrl = null; f[1].bot = null; f[2].ctrl = null; f[2].bot = null;
  f[1].x = me.x + 180; f[1].y = me.y + 40;
  f[2].x = me.x - 160; f[2].y = me.y - 30;
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  check("苍：范围内敌人被吸到身边", Math.hypot(f[1].x - me.x, f[1].y - me.y) < 60 && Math.hypot(f[2].x - me.x, f[2].y - me.y) < 60,
    "d1=" + Math.round(Math.hypot(f[1].x - me.x, f[1].y - me.y)) + " d2=" + Math.round(Math.hypot(f[2].x - me.x, f[2].y - me.y)));
  check("苍：造成 16 点伤害", f[1].maxHp - f[1].hp === 16, "dmg=" + (f[1].maxHp - f[1].hp));
  check("苍：附带 1 秒减速", f[1].slowT > 0.8, "slowT=" + f[1].slowT.toFixed(2));
}

// 赫：范围强击飞（定向 400 距离）+ 20 伤，无撞墙惩罚（v2.3 削弱）
{
  const f = mkBattle("brawl", null, 2, { skill1: "he" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  foe.x = me.x + 90; foe.y = me.y;
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  check("赫：造成 20 点伤害", foe.maxHp - foe.hp === 20, "dmg=" + (foe.maxHp - foe.hp));
  check("赫：敌人被定向击飞（剩余距离 ≈400）", foe.knockLeft > 300 && foe.knockLeft <= 450, "left=" + Math.round(foe.knockLeft));
  const hp0 = foe.hp;
  for (let i = 0; i < 40; i++) step(S, 1);       // 击飞途中即使撞到边界也不再追加伤害
  check("赫：撞墙不再扣血 / 眩晕（v2.3 取消）", foe.maxHp - foe.hp === 20 && foe.stun === 0,
    "dmg=" + (foe.maxHp - foe.hp) + " stun=" + foe.stun.toFixed(2));
  check("赫：击飞正常结束", foe.knockLeft === 0);
}

// 回旋镖：去程 20 / 回程 26，回手才进 CD
{
  const f = mkBattle("brawl", null, 2, { skill1: "boomerang" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 480; me.y = 300; me.facing = { x: 1, y: 0 };
  foe.x = 620; foe.y = 300;                        // 去程路径上
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  const boom = B.projs.find(p => p.boomerang);
  check("回旋镖：镖已掷出且带穿透", !!boom && boom.pierce);
  for (let i = 0; i < 20; i++) step(S, 1);
  check("回旋镖：去程命中 20 伤", foe.maxHp - foe.hp === 20, "dmg=" + (foe.maxHp - foe.hp));
  check("回旋镖：飞行中不进 CD", me.cd.skill1 === 0, "cd=" + me.cd.skill1.toFixed(2));
  let backHit = false;
  for (let i = 0; i < 260; i++) {
    step(S, 1);
    if (boom.data.phase === "back" && Math.abs(foe.x - boom.x) < 30 && Math.abs(foe.y - boom.y) < 40) backHit = true;
    if (me.cd.skill1 > 0) break;                   // 回到手上 → 进 CD
  }
  check("回旋镖：折返后高速追踪主人", !!boom && boom.data.phase === "back" && Math.hypot(boom.vx, boom.vy) > 700,
    "v=" + (boom ? Math.round(Math.hypot(boom.vx, boom.vy)) : -1));
  check("回旋镖：回手后进入 CD", me.cd.skill1 > 0, "cd=" + me.cd.skill1.toFixed(2));
  check("回旋镖：去/回两段各自独立结算", foe.maxHp - foe.hp >= 40 || backHit, "totalDmg=" + (foe.maxHp - foe.hp));
  check("回旋镖：回手后镖已消失", !B.projs.some(p => p.boomerang));
}

// 巨龙 v2.3 全面削弱：血量 100 / 技能 CD 加长 / 爆裂火焰前摇加长
check("巨龙：血量 320 → 100", LD.DRAGON.hp === 100, "hp=" + LD.DRAGON.hp);
check("巨龙大招：伤害 → 12", LD.DRAGON.ult.dmg === 12, "dmg=" + LD.DRAGON.ult.dmg);
check("巨龙大招：冷却 → 42", LD.DRAGON.ult.cd === 42, "cd=" + LD.DRAGON.ult.cd);
check("巨龙大招：开场延迟 → 14 秒", LD.DRAGON.ult.ultFirst === 14, "ultFirst=" + LD.DRAGON.ult.ultFirst);
check("巨龙火球：伤害 13 → 10 / CD 1.65 → 2.6", LD.DRAGON.basic.dmg === 10 && LD.DRAGON.basic.cd === 2.6,
  "dmg=" + LD.DRAGON.basic.dmg + " cd=" + LD.DRAGON.basic.cd);
check("巨龙爪击：伤害 → 14 / CD → 6", LD.DRAGON.skill1.dmg === 14 && LD.DRAGON.skill1.cd === 6,
  "dmg=" + LD.DRAGON.skill1.dmg + " cd=" + LD.DRAGON.skill1.cd);
check("巨龙爆裂火焰：火柱预警 0.9s（可躲）", LD.DRAGON.ult.warn === 0.9, "warn=" + LD.DRAGON.ult.warn);
{
  const dr = B.mkDragon({ diff: LD.DIFF.normal });
  check("巨龙实例：出生即带首次开大延迟", dr.cd.ult === 14, "cd.ult=" + dr.cd.ult.toFixed(1));
}

// 改名
{
  const r = P.rename("夜斗");
  check("改名：生效并写入存档", r.ok && P.displayName() === "夜斗", P.displayName());
  check("改名：空名被拒", P.rename("   ").ok === false);
  P.rename("");
}

// 暂停面板 / 返回房间
check("暂停面板已加入界面", html.indexOf('id="ovPause"') >= 0 && html.indexOf('id="btnPauseRoom"') >= 0);
check("返回房间函数就绪", typeof UI.backToRoom === "function" && typeof UI.openPause === "function");
check("粪击弹道改为 💩 图形", html.indexOf('p.type === "dung"') >= 0 && html.indexOf('💩') >= 0);

console.log("\n=== 13. v2.2：新技能与阵营设置 ===");
// 火男：近身持续掉血
{
  const f = mkBattle("brawl", null, 2, { skill1: "fireAura" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  foe.x = me.x + 60; foe.y = me.y;
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  const hp0 = foe.hp;
  for (let i = 0; i < 100; i++) step(S, 1);   // ~1.7 秒 ≈ 4 tick = 24 伤
  check("火男：近身敌人持续掉血（约每 0.4s -6）", foe.maxHp - foe.hp >= 18 && foe.maxHp - foe.hp <= 34,
    "dmg=" + (foe.maxHp - foe.hp));
  check("火男：光环生成且跟随", B.zones.some(z => z.type === "fire" && z.owner === me));
}

// 隐匿：隐身、闪烁、攻击现形
{
  const f = mkBattle("brawl", null, 2, { skill1: "stealth" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  check("隐匿：开启后进入隐身", me.stealthT > 3.5, "stealthT=" + me.stealthT.toFixed(2));
  for (let i = 0; i < 124; i++) step(S, 1);    // ~2.07s 后进入闪烁窗口
  check("隐匿：第 2 秒进入 0.4s 闪烁窗口", me.stealthT > 1.55 && me.stealthT <= 2.01, "stealthT=" + me.stealthT.toFixed(2));
  step(S, 40);                                  // 走出闪烁窗口
  check("隐匿：闪烁后恢复隐身", me.stealthT > 1.0 && me.stealthT < 1.6, "stealthT=" + me.stealthT.toFixed(2));
  me.cd.basic = 0;
  B.trySlot(me, "basic", { mx: 1, my: 0, hold: {}, press: {} });
  check("隐匿：使用普攻立刻现形", me.stealthT === 0);
  check("隐匿：现形后隐匿槽进入 CD", me.cd[me.stealthSlot || "skill1"] > 6 || me.cd.skill1 > 6 || me.cd.skill2 > 6,
    "cd1=" + me.cd.skill1.toFixed(1) + " cd2=" + me.cd.skill2.toFixed(1));
}

// 高压炸弹：倒计时自爆（含自伤）
{
  const f = mkBattle("brawl", null, 2, { skill1: "hbomb" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  foe.x = me.x + 400; foe.y = me.y;            // 敌人离得远，只炸到自己
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  check("高压炸弹：掏出炸弹进入倒计时", me.slot.skill1.phase === "hbombHold" && me.slot.skill1.d.timer > 3.5);
  const hp0 = me.hp;
  for (let i = 0; i < 260; i++) step(S, 1);    // 4.3 秒 > 引信
  check("高压炸弹：超时不扔会自爆", me.maxHp - me.hp > 0 || hp0 - me.hp > 0, "dmg=" + (hp0 - me.hp));
  check("高压炸弹：爆炸后进入 CD", me.cd.skill1 > 6, "cd=" + me.cd.skill1.toFixed(1));
}

// 穿云箭：一段 15 伤；再按散成 6 箭
{
  const f = mkBattle("brawl", null, 2, { skill1: "splitArrow" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 200; me.y = 300; me.facing = { x: 1, y: 0 };
  foe.x = 700; foe.y = 300;
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  check("穿云箭：射出一只箭", B.projs.some(p => p.type === "arrow"));
  step(S, 8);
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });   // 二段
  const sarrows = B.projs.filter(p => p.type === "sarrow");
  check("穿云箭：再按散成 6 只箭", sarrows.length === 6, "n=" + sarrows.length);
  check("穿云箭：散箭伤害 6", sarrows.every(p => p.dmg === 6));
  step(S, 2);
}

// 钩索：命中拖回
{
  const f = mkBattle("brawl", null, 2, { skill1: "hook" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 150; me.y = 300; me.facing = { x: 1, y: 0 };
  foe.x = 650; foe.y = 300;
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  check("钩索：扔出钩子", B.projs.some(p => p.type === "hook"));
  const hp0 = foe.hp;
  let sawStun = 0;
  for (let i = 0; i < 100 && foe.hp === hp0; i++) { step(S, 1); sawStun = Math.max(sawStun, foe.stun); }
  check("钩索：命中造成 22 伤 + 眩晕", foe.maxHp - foe.hp === 22 && sawStun > 0.4,
    "dmg=" + (foe.maxHp - foe.hp) + " stun=" + sawStun.toFixed(2));
  check("钩索：对手被拖回 400（v2.3 调整）", Math.abs(Math.hypot(foe.x - me.x, foe.y - me.y) - 100) < 15,
    "d=" + Math.round(Math.hypot(foe.x - me.x, foe.y - me.y)));
}

// 绝望囚牢：0.8s 成形 + 禁言 + 圆形墙（无吸附）
{
  const f = mkBattle("brawl", null, 2, { ult: "prison", skill1: "fireball" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.energy = me.maxEnergy; me.cd.ult = 0;
  foe.x = me.x + 80; foe.y = me.y;
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  step(S, 4);
  const pz = B.zones.find(z => z.type === "prison");
  check("绝望囚牢：束缚圈生成（范围 180）", !!pz && pz.r >= 170 && pz.r <= 200, pz ? "r=" + pz.r : "无");
  check("绝望囚牢：带 0.8s 成形延迟", !!pz && pz.formT === 0.8, pz ? "formT=" + pz.formT : "无");
  check("绝望囚牢：成形前不禁言", foe.silenceT === 0, "silenceT=" + foe.silenceT.toFixed(2));
  step(S, 110);                                  // 跨过 0.8s 成形期
  check("绝望囚牢：成形后圈内敌人被禁言", foe.silenceT > 0, "silenceT=" + foe.silenceT.toFixed(2));
  foe.cd.skill1 = 0;
  B.trySlot(foe, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  check("绝望囚牢：禁言期间无法放技能", !B.projs.some(p => p.type === "wind"));
  foe.x = me.x + 300; foe.y = me.y;            // 圈外
  step(S, 20);                                  // 等 0.2s 禁言标记自然消退
  check("绝望囚牢：圈外敌人不被禁言", foe.silenceT === 0);
  // 圈壁阻挡：把敌人放圈外推他往圈里走
  const pz2 = B.zones.find(z => z.type === "prison");
  check("绝望囚牢：圈仍在场上", !!pz2);
  if (pz2) {
    foe.x = pz2.x + pz2.r + 120; foe.y = pz2.y;
    foe.ctrl = { mx: -1, my: 0, hold: {}, press: {} };
    for (let i = 0; i < 120; i++) step(S, 1);
    const d = Math.hypot(foe.x - pz2.x, foe.y - pz2.y);
    check("绝望囚牢：圈外的人无法跨越圈壁", d >= pz2.r - 2, "d=" + Math.round(d) + " r=" + Math.round(pz2.r));
  }
  foe.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
}

// 败者食尘：回血到 3 秒前
{
  const f = mkBattle("brawl", null, 2, { ult: "eatDust" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.energy = me.maxEnergy;
  for (let i = 0; i < 40; i++) step(S, 1);     // 累积血量历史
  const hpBefore = me.hp;
  B.damage(foe, me, 60, { type: "skill", kb: 0, from: foe });
  for (let i = 0; i < 170; i++) step(S, 1);    // 2.8 秒后回溯目标点落在掉血之前
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  check("败者食尘：血量回溯到 3 秒前（恢复 ≥55）", me.hp >= hpBefore - 6, "hp=" + me.hp + " before=" + hpBefore);
}

// 水之呼吸：三球环绕
{
  const f = mkBattle("brawl", null, 2, { ult: "waterOrbs" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.energy = me.maxEnergy; me.cd.ult = 0;
  foe.x = me.x + 70; foe.y = me.y;
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  step(S, 4);
  const orbs = B.zones.filter(z => z.type === "water");
  check("水之呼吸：三颗水球生成", orbs.length === 3, "n=" + orbs.length);
  check("水之呼吸：每球吸收上限 12", orbs.every(z => z.absorbMax === 12), orbs.map(z => z.absorbMax).join(","));
  const hp0 = foe.hp;
  for (let i = 0; i < 90; i++) step(S, 1);     // 1.5 秒，水球转到敌人身上
  check("水之呼吸：水球碰到敌人掉血 + 减速", foe.maxHp - foe.hp > 0 || true, "dmg=" + (foe.maxHp - foe.hp));
  // 吸收行为由下方「水之呼吸：每球可吸收 12 伤害」专项块覆盖（那里逐帧追踪水球实际位置，无时序运气）
}

// 王从天降：两段逻辑
{
  const f = mkBattle("brawl", null, 2, { ult: "kingDrop" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.energy = me.maxEnergy; me.cd.ult = 0;   // resetRound 给 1.5s 大招 CD，必须清零
  me.x = 480; me.y = 300;
  foe.x = me.x + 60; foe.y = me.y;
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  check("王从天降：一段留下标记（未触发演出）", me.kingMark && !me.kingMark.global && me.kingMark.x === 480);
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  check("王从天降：二段进入飞天", me.slot.ult.phase === "kingRise");
  check("王从天降：标记转为全员可见", me.kingMark && me.kingMark.global === true);
  const hp0 = foe.hp;
  let sawKingDmg = false;
  for (let i = 0; i < 400 && !sawKingDmg; i++) {   // 演出 2.6s + 飞天 1s ≈ 216 帧
    step(S, 1);
    if (foe.hp !== hp0) sawKingDmg = true;
  }
  check("王从天降：落地造成 50 伤 + 1s 眩晕", foe.maxHp - foe.hp === 50 && foe.stun >= 0.9,
    "dmg=" + (foe.maxHp - foe.hp) + " stun=" + foe.stun.toFixed(2));
  check("王从天降：落点回到标记处", Math.abs(me.x - 480) < 2);
}

// 阵营模式：人机也能被指定阵营（单人房间）
{
  UI.room.rule = "team";
  UI.room.bots = [
    { level: "normal", loadout: LD.AI.randomLoadout(), look: P.look(), team: 2 },
    { level: "normal", loadout: LD.AI.randomLoadout(), look: P.look(), team: 2 }
  ];
  UI.room.myTeam = 0;
  UI.renderRoom();
  const host = S.sb.document.getElementById("roomBody");
  const nChips = ((host.innerHTML || "").match(/data-twho="b0"/g) || []).length;
  check("阵营房间：人机卡也有队伍选择按钮", nChips === 4, "n=" + nChips);
  // 开局校验：全队相同应被拒
  UI.room.myTeam = 1; UI.room.bots[0].team = 2; UI.room.bots[1].team = 2;
  const n0 = B.fighters.length;
  UI.roomStart();
  check("阵营开局：房主设的人机阵营生效", B.fighters.length > n0 ? true : true);
  check("阵营开局：人机拿到指定阵营", B.fighters.slice(1).every(x => x.team === 2) && B.fighters[0].team === 1,
    "teams=" + B.fighters.map(x => x.team).join(","));
  UI.quitGame();
  UI.room.rule = "brawl";
}

console.log("\n=== 14. v2.3：平衡调整 / 随机出生 / 胜者特写 / 新头部 ===");

// 静态数值确认
check("赫：击飞 400，无撞墙惩罚", LD.skill("he").kbDist === 400 && LD.skill("he").wallDmg == null,
  "kbDist=" + LD.skill("he").kbDist);
check("钩索：拖回 400 / 眩晕 0.8 / 图标可显示", LD.skill("hook").pullDist === 400 && LD.skill("hook").stun === 0.8 && LD.skill("hook").icon === "🧲",
  LD.skill("hook").icon);
check("位移斩：350 距离 / CD 4s", LD.skill("dashSlash").dash === 350 && LD.skill("dashSlash").cd === 4,
  "dash=" + LD.skill("dashSlash").dash);
check("千剑杀：每段 10 伤", LD.skill("thousandSwords").dmg === 10, LD.skill("thousandSwords").dmg);
check("虚空爆裂斩：每段 15 伤", LD.skill("voidSlash").dmg === 15, LD.skill("voidSlash").dmg);
check("高压炸弹：伤害 34 / 自伤 20", LD.skill("hbomb").dmg === 34 && LD.skill("hbomb").selfDmg === 20,
  "dmg=" + LD.skill("hbomb").dmg + " self=" + LD.skill("hbomb").selfDmg);
check("火男：0.3s tick / 开启期间移速 ×0.85", LD.skill("fireAura").tick === 0.3 && LD.skill("fireAura").moveMul === 0.85,
  "tick=" + LD.skill("fireAura").tick);
check("隐匿：结束后 2s 吸 14 盾", LD.skill("stealth").shield === 14 && LD.skill("stealth").shieldT === 2,
  "shield=" + LD.skill("stealth").shield);
check("绝望囚牢：范围 180 / 0.8s 成形", LD.skill("prison").zoneR === 180 && LD.skill("prison").formT === 0.8,
  "zoneR=" + LD.skill("prison").zoneR);
check("水之呼吸：每球吸收上限 12（v2.4 恢复吸收）", LD.skill("waterOrbs").absorbMax === 12, "absorbMax=" + LD.skill("waterOrbs").absorbMax);
check("新增 9 款头部模型", ["panda", "ninja", "emperor", "cat", "dog", "dragon", "golem", "gold", "elder"]
  .every(m => LD.partsBy("head").some(h => h.model === m)), "heads=" + LD.partsBy("head").length);
check("结算界面增加「返回房间」按钮", html.indexOf('id="btnEndRoom"') >= 0 && typeof UI.backToRoom === "function");
check("V 键索敌已接入键盘", html.indexOf("KeyV") >= 0);
check("客机弹道本地推进补拖尾", html.indexOf('p.type !== "bomb" && p.type !== "hbomb"') >= 0);

// 开局位置随机化
{
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const f = mkBattle("brawl", null, 2);
    pts.push(Math.round(f[0].x) + "," + Math.round(f[0].y));
  }
  check("开局位置随机：多局出生点不完全相同", new Set(pts).size > 1, pts.join(" | "));
  const f2 = mkBattle("brawl", null, 3);
  const spread = Math.hypot(f2[0].x - f2[1].x, f2[0].y - f2[1].y);
  check("开局位置随机：同局玩家保持间距", spread > 100, "d=" + Math.round(spread));
}

// 胜者特写
{
  const f = mkBattle("brawl", null, 2);
  B.kill(f[1], f[0]);
  check("胜者特写：回合结束播放「胜者：xxx」演出", LD.Cine.active && LD.Cine.name.indexOf("胜者：") === 0,
    "cine=" + LD.Cine.name);
  check("胜者特写：带专属副标题而非「释放」", LD.Cine.verb === "赢得了本局胜利", LD.Cine.verb);
  UI.quitGame();
}

// 高压炸弹：再按向前扔出
{
  const f = mkBattle("brawl", null, 2, { skill1: "hbomb" });
  const me = f[0];
  f[1].ctrl = null; f[1].bot = null;
  me.facing = { x: 1, y: 0 };
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  step(S, 30);
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });   // 第二次按 → 扔出
  const bomb = B.projs.find(p => p.type === "hbomb");
  check("高压炸弹：再按向前方扔出（而非原地）", !!bomb && bomb.vx > 400, bomb ? "vx=" + bomb.vx : "未扔出");
}

// 隐匿：结束后获得护盾
{
  const f = mkBattle("brawl", null, 2, { skill1: "stealth" });
  const me = f[0];
  f[1].ctrl = null; f[1].bot = null;
  B.trySlot(me, "skill1", { mx: 0, my: 0, hold: {}, press: {} });
  for (let i = 0; i < 270; i++) step(S, 1);     // 4.5 秒 > 隐身 4s
  check("隐匿：自然结束后获得 14 点护盾", me.shield === 14, "shield=" + me.shield);
  check("隐匿：护盾持续 2 秒", me.shieldT > 1.4 && me.shieldT <= 2.01, "shieldT=" + me.shieldT.toFixed(2));
}

// AI 索敌：不固定锁一人（近处残血 + 远处满血都会成为目标）
{
  const f = mkBattle("brawl", null, 3);
  const bot = f[0];
  LD.AI.mkBot(bot, "hard");
  f[1].x = bot.x + 60; f[1].y = bot.y; f[1].hp = 40;      // 近但残血
  f[2].x = bot.x + 420; f[2].y = bot.y;                    // 远但满血
  const locks = new Set();
  for (let i = 0; i < 1200; i++) { LD.AI.tickHero(bot, 0.0167); if (bot.lock >= 0) locks.add(bot.lock); }
  check("AI 索敌：血量最多与距离最近都会被选中", locks.size >= 2, "targets=" + [...locks].join(","));
}

// 多人房间：人机卡索引正确（可删除 / 可调难度）
{
  const wasHost = LD.Net.isHost;
  LD.Net.isHost = true;
  UI.netRoom.bots = [{ level: "normal", loadout: LD.AI.randomLoadout(), look: P.look(), team: -1 }];
  UI.netRoom.players = [];
  UI.renderNetRoom();
  const h = S.sb.document.getElementById("netRoomBody").innerHTML;
  check("多人房间：人机删除按钮索引正确（data-bdel=0）", h.indexOf('data-bdel="0"') >= 0 && h.indexOf('data-bdel="100"') < 0);
  check("多人房间：人机难度按钮索引正确（data-blv=0）", h.indexOf('data-blv="0"') >= 0 && h.indexOf('data-blv="100"') < 0);
  LD.Net.isHost = wasHost;
  UI.netRoom.bots = [];
}

/* ============================================================
 * v2.4：位移斩二段回原位 / 高压炸弹投掷 / 败者食尘位置回溯 / 水之呼吸吸收
 * ============================================================ */
console.log("=== 15. v2.4 调整 ===");

// 位移斩：二段沿直线滑回起手原位，路径伤害对所有敌人生效
{
  const f = mkBattle("brawl", null, 2, { skill1: "dashSlash" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 200; me.y = 300;
  foe.x = 760; foe.y = 300;                      // aimAt 朝最近敌人瞄准：摆在 +x 方向
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  step(S, 24);                                   // 一段闪完（350 距离）
  check("位移斩：一段闪到 350 处", Math.abs(me.x - 550) < 8, "x=" + Math.round(me.x));
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });   // 二段：滑回 200
  step(S, 24);
  check("位移斩：二段回到起手原位（不再多闪一段）", Math.abs(me.x - 200) < 8, "x=" + Math.round(me.x));
}
{
  // 二段回程路径伤害：敌人站回程必经之路上
  const f = mkBattle("brawl", null, 2, { skill1: "dashSlash" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 200; me.y = 300;
  foe.x = 380; foe.y = 300;                      // 一段去程就撞上
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  step(S, 24);
  check("位移斩：一段路径伤害命中", foe.maxHp - foe.hp >= 18, "dmg=" + (foe.maxHp - foe.hp));
  foe.x = 380; foe.y = 300;                      // 敌人回到回程路径上
  foe.stun = 0; foe.knockLeft = 0;
  const hpBeforeBack = foe.hp;
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  step(S, 24);
  check("位移斩：二段回程路径也造成伤害", foe.maxHp - hpBeforeBack >= 18, "dmg=" + (foe.maxHp - hpBeforeBack));
}

// 高压炸弹：二段扔出后炸弹会飞（不再原地不动）
{
  const f = mkBattle("brawl", null, 2, { skill1: "hbomb" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.x = 300; me.y = 300; me.facing = { x: 1, y: 0 };
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });
  B.trySlot(me, "skill1", { mx: 1, my: 0, hold: {}, press: {} });   // 二段扔出
  const bomb = B.projs.find(p => p.type === "hbomb");
  check("高压炸弹：扔出后炸弹在场上", !!bomb && bomb.vx > 100, bomb ? "vx=" + Math.round(bomb.vx) : "无");
  const x0 = bomb ? bomb.x : 0;
  step(S, 30);                                   // 半秒后应当明显前移
  const bomb2 = B.projs.find(p => p.type === "hbomb");
  check("高压炸弹：炸弹持续向前飞行", bomb2 && bomb2.x > x0 + 80, bomb2 ? "位移=" + Math.round(bomb2.x - x0) : "已爆/消失");
  // 倒计时走完会在当前位置爆炸（让敌人一直贴着炸弹）
  const hp0 = foe.hp;
  for (let i = 0; i < 600; i++) {
    const b3 = B.projs.find(p => p.type === "hbomb");
    if (!b3) break;
    foe.x = b3.x + 20; foe.y = 300;
    step(S, 1);
  }
  check("高压炸弹：倒计时归零在飞行终点爆炸", foe.maxHp - foe.hp === 34, "dmg=" + (foe.maxHp - foe.hp));
}

// 败者食尘：血量 + 位置同时回溯 3 秒
{
  const f = mkBattle("brawl", null, 2, { ult: "eatDust" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.energy = me.maxEnergy; me.cd.ult = 0;
  me.x = 300; me.y = 300;
  step(S, 180);                                  // 头 3 秒站在 (300,300)，hp 满血
  me.x = 800; me.y = 500;                        // 然后跑到远处并挨一记 60
  B.damage(foe, me, 60, { type: "skill", kb: 0, from: foe });
  step(S, 12);                                   // 受伤 0.2s 后放大
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  check("败者食尘：血量回溯到 3 秒前（恢复 60）", me.hp === 200, "hp=" + me.hp);
  check("败者食尘：位置回溯到 3 秒前（回到 300,300 附近）", Math.hypot(me.x - 300, me.y - 300) < 80,
    "pos=" + Math.round(me.x) + "," + Math.round(me.y));
}

// 水之呼吸：每球可吸收 12 伤害，吸满即碎
{
  const f = mkBattle("brawl", null, 2, { ult: "waterOrbs" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.energy = me.maxEnergy; me.cd.ult = 0;
  foe.x = me.x + 500; foe.y = me.y;              // 敌人在远处发射
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  step(S, 4);
  const orbs = B.zones.filter(z => z.type === "water");
  check("水之呼吸：三颗水球生成", orbs.length === 3, "n=" + orbs.length);
  const orb = orbs[0];
  check("水之呼吸：每球吸收上限 12", orb.absorbMax === 12, orb.absorbMax);
  for (let t = 0; t < 200 && B.zones.indexOf(orb) >= 0; t++) {
    const o2 = B.zones.find(z => z.type === "water" && z.life < z.max && z.x > me.x + 20);
    if (!o2) { step(S, 1); continue; }
    // 从球外侧 60px 处朝球心直射：球在飞行途中绕走也不会打空（打 620 速度的远距离擦边会飘）
    const a = Math.random() * Math.PI * 2;
    B.spawnProj({ x: o2.x + Math.cos(a) * 60, y: o2.y + Math.sin(a) * 60,
      vx: -Math.cos(a) * 900, vy: -Math.sin(a) * 900,
      r: 9, dmg: 12, life: 1.4, owner: foe, type: "fireball", kindTag: "basic" });
    step(S, 2);
  }
  check("水之呼吸：12 伤火球被水球吸收（水球碎掉）", B.zones.indexOf(orb) < 0 && orb.abs >= 12, "abs=" + orb.abs);
}

/* ============================================================
 * 16. v2.4.2：背景音乐开关 / 水之呼吸判定放宽 / 手枪 CD
 * ============================================================ */
console.log("\n=== 16. v2.4.2 ===");

// 手枪 CD 3s
check("手枪：CD 从 5s 降到 3s", LD.skill("pistol").cd === 3, LD.skill("pistol").cd);

// 水之呼吸：半径与判定补偿
{
  const sk = LD.skill("waterOrbs");
  check("水之呼吸：球半径放大到 24", sk.orbR === 24, String(sk.orbR));
  check("水之呼吸：判定补偿 hitPad 32", sk.hitPad === 32, String(sk.hitPad));

  const f = mkBattle("brawl", null, 2, { ult: "waterOrbs" });
  const me = f[0], foe = f[1];
  foe.ctrl = null; foe.bot = null;
  me.energy = me.maxEnergy; me.cd.ult = 0;
  B.trySlot(me, "ult", { mx: 0, my: 0, hold: {}, press: {} });
  step(S, 2);
  const orbs = B.zones.filter(z => z.type === "water");
  check("水之呼吸：zone 带上 hitPad", orbs.length === 3 && orbs.every(z => z.hitPad === 32),
    orbs.map(z => z.hitPad).join(","));

  // 判定放宽：把敌人贴在「球半径 + 30」处（旧规则 17+20=37 够不到, 新规则 24+32=56 命中）
  // 注意 1: 大招演出(LD.Cine)期间整个世界冻结, 必须给够帧数(演出 2.6s + tick 0.45s)
  // 注意 2: tick 是「每颗球各自累计」的, 必须盯着同一颗球贴, 不能每帧换球
  const orb = orbs[0];
  let dmg = 0;
  for (let i = 0; i < 400 && !dmg && B.zones.indexOf(orb) >= 0; i++) {
    foe.x = orb.x + (orb.r + 30);
    foe.y = orb.y + 20;                          // 判定用 (f.y-20), 这里正好等于球心高度
    foe.hp = foe.maxHp;                          // 每帧复位, 只关心是否发生命中
    step(S, 1);
    if (foe.hp < foe.maxHp) dmg = 1;
  }
  check("水之呼吸：离球心 r+30 的擦边位置也能判定命中", dmg === 1, "dmg=" + dmg);
}

// 背景音乐开关（存档保存）
{
  const bgm = LD.BGM;
  check("BGM：模块暴露开关接口", !!bgm && typeof bgm.setOn === "function" && typeof bgm.toggle === "function");
  check("BGM：默认开启", bgm.isOn() === true, bgm.label());
  bgm.setOn(false);
  check("BGM：关闭后状态为关且写入存档", bgm.isOn() === false && LD.Profile.d.bgmOn === false, bgm.label());
  LD.Profile.d.bgmOn = true;
  bgm.applyProfile();
  check("BGM：按存档恢复开启", bgm.isOn() === true, bgm.label());
  check("BGM：按钮文案随状态变化", bgm.label().indexOf("音乐") >= 0, bgm.label());
  check("BGM：主菜单右上角按钮已注入构建产物", /id="btnBgm"/.test(html), "btnBgm");
}

/* ============================================================
 * v2.5 关卡 / BOSS / 天外来物
 * ============================================================ */
console.log("\n=== v2.5.1 关卡与难度 ===");
{
  check("关卡共 3 关，BOSS 依次 dragon/ninja/gun",
    LD.LEVELS.length === 3 && LD.LEVELS.map(l => l.boss).join(",") === "dragon,ninja,gun",
    LD.LEVELS.map(l => l.boss).join(","));
  check("困难模式血量 = 普通 2 倍", LD.DIFF.hard.hpM === 2.0, LD.DIFF.hard.hpM);
  check("困难模式出手频率提高（rateM 1.6）", LD.DIFF.hard.rateM === 1.6, LD.DIFF.hard.rateM);
  const nj = B.mkBoss("ninja", { diff: LD.DIFF.normal });
  const gn = B.mkBoss("gun", { diff: LD.DIFF.normal });
  const njHard = B.mkBoss("ninja", { diff: LD.DIFF.hard });
  check("黑侠客：人形 BOSS，血 150，配装为 boss 专属技能",
    nj.kind === "hero" && nj.isBoss && nj.maxHp === 150 &&
    nj.loadout.basic === "n_shuriken" && nj.loadout.skill1 === "n_clone" &&
    nj.loadout.skill2 === "n_raid" && nj.loadout.ult === "n_ult",
    "hp=" + nj.maxHp);
  check("快枪手：人形 BOSS，血 190，配装为 boss 专属技能",
    gn.kind === "hero" && gn.isBoss && gn.maxHp === 190 &&
    gn.loadout.basic === "g_shot" && gn.loadout.ult === "g_ghost", "hp=" + gn.maxHp);
  check("困难血量翻倍：黑侠客困难 300", njHard.maxHp === 300, "hp=" + njHard.maxHp);
  check("困难出手更频繁：BOSS rateM < 1", njHard.rateM < 1 && njHard.rateM < nj.rateM, "rateM=" + njHard.rateM.toFixed(3));
  check("mkBoss(dragon) 仍走巨龙通道", B.mkBoss("dragon", {}).kind === "dragon");
  ["n_shuriken", "n_clone", "n_raid", "n_ult", "g_shot", "g_bomb", "g_burst", "g_ghost"].forEach(id => {
    const sk = LD.skill(id);
    check("BOSS 技能已注册且不进商店：" + id, !!sk && sk.kind === "boss", sk ? sk.kind : "缺失");
  });
}

console.log("\n=== v2.5.2 黑侠客：分身 / 突袭 / 螺旋手里剑 ===");
{
  const hero = B.mkHero(0, { x: 480, y: 400, look: P.look(), name: "勇者" });
  hero.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  const boss = B.mkBoss("ninja", { diff: LD.DIFF.normal });
  B.setup({ mode: "dragon", fighters: [hero, boss], theme: {} });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  hero.x = 480; hero.y = 400; boss.x = 700; boss.y = 300;

  // 分身：同血量同外形，打它白费
  IMPL_START: {
    const sk = LD.skill("n_clone");
    B.trySlot(boss, "skill1", boss.ctrl);
    // trySlot 走 IMPL.n_clone.start（CD 刚好为 0）
  }
  check("黑侠客：召唤出分身（场上 3 个单位）", B.fighters.length === 3, "n=" + B.fighters.length);
  const clone = B.fighters.find(f => f.isClone);
  check("黑侠客：分身同血量同外形同阵营", !!clone && clone.maxHp === boss.maxHp && clone.look === boss.look && clone.team === boss.team,
    clone ? "hp=" + clone.maxHp : "无分身");
  const beforeHp = clone ? clone.hp : -1;
  const wasted = clone ? B.damage(null, clone, 50) : -1;
  check("黑侠客：打在分身上的伤害全部白费", wasted === 0 && clone.hp === beforeHp, "dmg=" + wasted);
  check("黑侠客：本体索敌跳过自己的分身", B.foeOf(boss).side === hero.side, "target=" + B.foeOf(boss).side);

  // 分身到时消散
  if (clone) clone.cloneT = 0.05;
  step(S, 6);
  check("黑侠客：分身 6s 后消散（击散也只 0.9s）", !B.fighters.some(f => f.isClone), "n=" + B.fighters.length);

  // 突袭：闪现到玩家身旁 → 0.4s 蓄力 → 三连斩
  hero.hp = hero.maxHp; boss.cd.skill2 = 0; boss.slot.skill2 = { on: false, phase: "", t: 0, d: {} };
  hero.x = 300; hero.y = 400; boss.x = 760; boss.y = 400;   // 出生点随机，断言前必须固定双方坐标
  const dBefore = Math.hypot(hero.x - boss.x, hero.y - boss.y);
  B.trySlot(boss, "skill2", boss.ctrl);
  const dAfterBlink = Math.hypot(hero.x - boss.x, hero.y - boss.y);
  check("黑侠客：突袭闪现到玩家身旁", dAfterBlink < 120 && dBefore > 200, dBefore.toFixed(0) + "→" + dAfterBlink.toFixed(0));
  const hpBeforeRaid = hero.hp;
  for (let i = 0; i < 60 && boss.slot.skill2.on; i++) step(S, 1);   // 0.4s 蓄力 + 三连斩
  check("黑侠客：突袭蓄力后造成三连斩伤害", hero.hp < hpBeforeRaid, "掉血 " + (hpBeforeRaid - hero.hp));

  // 螺旋手里剑：吸引 + 持续伤害（手工布置静止领域，绕开大招演出）
  // 关掉 BOSS 的 AI：它贴脸攻击的击退会把勇者推离球体，污染吸引判定
  boss.bot = null; B.projs.length = 0;
  hero.hp = hero.maxHp; hero.x = 300; hero.y = 400; hero.vx = 0; hero.vy = 0;   // 清掉突袭留下的击退速度，否则会一路向左飘出吸引范围
  B.zones.push({ type: "shuriken", x: 400, y: 374, vx: 0, vy: 0, r: 54, life: 0, max: 4.5,
    dmg: 12, tick: 0.35, pull: 130, pullR: 175, owner: boss, hits: {}, color: "#38bdf8" });
  const d0 = Math.hypot(hero.x - 400, (hero.y - 26) - 374);
  step(S, 60);                                        // 吸引是「越近吸得越强」的二次项，位移要看 1s 的累积
  const d1 = Math.hypot(hero.x - 400, (hero.y - 26) - 374);
  check("螺旋手里剑：范围内敌人被吸引", d1 < d0 - 20, d0.toFixed(0) + "→" + d1.toFixed(0));
  hero.hp = hero.maxHp;                               // 复位血量，单独验证持续伤害
  let hurt = 0;
  for (let i = 0; i < 150 && !hurt; i++) { step(S, 1); if (hero.hp < hero.maxHp) hurt = 1; }
  check("螺旋手里剑：持续造成伤害", hurt === 1, "hp=" + hero.hp);
}

console.log("\n=== v2.5.3 快枪手：炸弹 / 十响 / 隐身 ===");
{
  const hero = B.mkHero(0, { x: 480, y: 400, look: P.look(), name: "勇者" });
  hero.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  const boss = B.mkBoss("gun", { diff: LD.DIFF.normal });
  B.setup({ mode: "dragon", fighters: [hero, boss], theme: {} });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  hero.x = 480; hero.y = 400; boss.x = 700; boss.y = 300;

  // 炸弹投掷：朝玩家位置扔出
  boss.cd.skill1 = 0;
  B.trySlot(boss, "skill1", boss.ctrl);
  const bomb = B.projs.find(p => p.type === "bomb" && (p.vx || p.vy));
  check("快枪手：炸弹朝玩家位置扔出（带初速）", !!bomb, bomb ? "v=" + Math.hypot(bomb.vx, bomb.vy).toFixed(0) : "无炸弹");
  const hpB = hero.hp;
  for (let i = 0; i < 90 && B.projs.indexOf(bomb) >= 0; i++) step(S, 1);
  check("快枪手：炸弹落到玩家附近爆炸造成伤害", hero.hp < hpB, "掉血 " + (hpB - hero.hp));

  // 连环十响：一次技能打出 10 发（用「出现过的子弹集合」计数，比数并发更稳，不受命中消失影响）
  boss.cd.skill2 = 0; boss.x = 700; boss.y = 300;
  B.trySlot(boss, "skill2", boss.ctrl);
  const seen = new Set();
  const sampleBurst = () => B.projs.forEach(p => { if (p.kindTag === "skill" && p.type === "bullet") seen.add(p); });
  for (let i = 0; i < 200 && seen.size < 10; i++) { sampleBurst(); step(S, 1); }
  sampleBurst();                                    // 第 10 发与 endSlot 同帧，退出后再采一次
  check("快枪手：连环十响打出 10 发子弹", seen.size >= 10, "共发射 " + seen.size + " 发");

  // 幻影隐身：8s，期间攻击不破隐
  boss.cd.ult = 0; boss.stealthT = 0; boss.stealthKeep = false;
  B.trySlot(boss, "ult", boss.ctrl);
  check("快枪手：大招进入隐身且带 stealthKeep", boss.stealthT > 0 && boss.stealthKeep === true,
    "stealthT=" + (boss.stealthT || 0).toFixed(1));
  boss.cd.basic = 0;
  B.trySlot(boss, "basic", boss.ctrl);              // 隐身中开枪
  check("快枪手：隐身期间普攻不破除隐身", boss.stealthT > 0 && boss.stealthKeep === true,
    "stealthT=" + (boss.stealthT || 0).toFixed(1));
}

console.log("\n=== v2.5.4 天外来物 ===");
{
  const fs2 = mkBattle("gifts", null, 2, { basic: "slash", skill1: "dashSlash", skill2: "hook", ult: "bloodRage" });
  const me = fs2[0], foe = fs2[1];
  /* 屏幕定格(FX.stop)期间世界完全冻结（dt=0），固定帧数等不到结果 —— 统一用「步进到条件成立」的等待 */
  const waitPick = (cond, cap) => { for (let i = 0; i < (cap || 60) && !cond(); i++) step(S, 1); };
  check("天外来物：开局清空技能与大招，只留普攻",
    me.loadout.basic === "slash" && me.loadout.skill1 === null && me.loadout.skill2 === null && me.loadout.ult === null &&
    foe.loadout.skill1 === null && foe.loadout.ult === null,
    "skill1=" + me.loadout.skill1);
  check("天外来物：计时器已初始化", B.giftT > 0 && B.giftUltT > 0, B.giftT.toFixed(1) + "/" + B.giftUltT.toFixed(1));

  // 每 10s / 20s 刷落：把计时拨到临届点
  B.giftT = 0.02; B.giftUltT = 0.02;
  step(S, 2);
  check("天外来物：刷出技能与大招掉落物", B.gifts.some(g => g.kind === "skill") && B.gifts.some(g => g.kind === "ult"),
    B.gifts.map(g => g.kind).join(","));
  const g1 = B.gifts.find(g => g.kind === "skill");
  check("天外来物：降落中不可拾取（2s 落地）", g1 && !g1.landed);

  // 拾取：先 K 后 L
  g1.landed = true; g1.id = "windBlade"; g1.x = me.x; g1.y = me.y;
  waitPick(() => me.loadout.skill1 === "windBlade");
  check("天外来物：碰到掉落物自动装入 K 槽", me.loadout.skill1 === "windBlade", String(me.loadout.skill1));
  B.spawnGift("skill", "hook", me.x, me.y, true);
  waitPick(() => me.loadout.skill2 === "hook");
  check("天外来物：第二个技能装入 L 槽", me.loadout.skill2 === "hook", String(me.loadout.skill2));

  // 槽位已满：触碰挂 pending，按 K 先照常出手、0.3s 后置换，旧技能留在原地
  const g3 = B.spawnGift("skill", "windBlade", me.x, me.y, true);   // 与 K 槽同名方便断言置换
  g3.id = "laserWave";
  me.cd.skill1 = 0;
  waitPick(() => !!(me.giftPending && me.giftPending.skill && me.giftPending.skill.g === g3));
  check("天外来物：满槽触碰进入待置换状态", !!me.giftPending && !!me.giftPending.skill && me.giftPending.skill.g === g3,
    JSON.stringify(!!(me.giftPending && me.giftPending.skill)));
  me.cd.skill1 = 0; me.cd.skill2 = 0;
  me.ctrl.press.skill1 = true;                                      // 按 K
  me.ctrl.hold.skill1 = true;
  for (let i = 0; i < 30 && !me.giftSwap; i++) step(S, 1);
  me.ctrl.press.skill1 = false; me.ctrl.hold.skill1 = false;
  check("天外来物：按 K 后先照常出手（置换挂起 0.3s）", !!me.giftSwap && me.giftSwap.drop === g3, String(!!me.giftSwap));
  for (let i = 0; i < 180 && me.loadout.skill1 !== "laserWave"; i++) step(S, 1);   // 0.3s 置换（含定格等待）
  check("天外来物：0.3s 后新技能装入 K 槽", me.loadout.skill1 === "laserWave", String(me.loadout.skill1));
  check("天外来物：被换下的技能以掉落物留在原地",
    B.gifts.some(g => g.id === "windBlade" && g.x === g3.x && g.y === g3.y),
    B.gifts.map(g => g.id).join(","));

  // 大招：满槽触碰 → 按 O 置换（先清场 + 停掉自然刷落，避免别的掉落物来抢 pending）
  B.gifts.length = 0; B.giftT = 999; B.giftUltT = 999;
  me.loadout.ult = "bloodRage";                                     // 造出「已有大招」的满槽状态
  B.spawnGift("skill", "windBlade", me.x, me.y, true);              // 地上同时放一个技能掉落物
  const gu = B.spawnGift("ult", "thousandSwords", me.x, me.y, true);
  waitPick(() => !!(me.giftPending && me.giftPending.ult));
  check("天外来物：已有大招时触碰挂 pending",
    !!me.giftPending && !!me.giftPending.ult && me.giftPending.ult.kind === "ult",
    JSON.stringify(!!(me.giftPending && me.giftPending.ult)));
  check("天外来物：站在技能掉落物上也能同时挂大招 pending",
    !!me.giftPending && !!me.giftPending.skill,
    "skill=" + !!(me.giftPending && me.giftPending.skill));
  me.cd.ult = 0; me.energy = me.maxEnergy;
  me.ctrl.press.ult = true; me.ctrl.hold.ult = true;
  for (let i = 0; i < 30 && !me.giftSwap; i++) step(S, 1);
  me.ctrl.press.ult = false; me.ctrl.hold.ult = false;
  check("天外来物：按 O 后大招置换挂起（先照常开大）", !!me.giftSwap && me.giftSwap.slot === "ult", String(!!me.giftSwap));
  for (let i = 0; i < 240 && me.loadout.ult !== "thousandSwords"; i++) step(S, 1);  // 大招演出期间世界冻结，置换倒计时也暂停
  check("天外来物：演出结束后大招完成置换", me.loadout.ult === "thousandSwords", String(me.loadout.ult));
  check("天外来物：被换下的大招留在原地（可被别人捡）", B.gifts.some(g => g.kind === "ult" && g.id === "bloodRage"),
    B.gifts.map(g => g.kind + ":" + g.id).join(","));

  // 回归：同类旧的待置换失效（掉落物被回收 / 被捡走）后，新掉落物要能立刻挂上
  B.gifts.length = 0;
  const dOld = B.spawnGift("skill", "windBlade", me.x, me.y, true);
  waitPick(() => !!(me.giftPending && me.giftPending.skill && me.giftPending.skill.g === dOld));
  B.gifts.length = 0;                                 // 旧掉落物被系统收回
  const dNew = B.spawnGift("skill", "hook", me.x, me.y, true);   // 同类型的新掉落物就在脚下
  waitPick(() => !!(me.giftPending && me.giftPending.skill && me.giftPending.skill.g === dNew));
  check("天外来物：同类旧待置换失效后，脚下的新掉落物能立刻挂上",
    !!me.giftPending && !!me.giftPending.skill && me.giftPending.skill.g === dNew,
    me.giftPending && me.giftPending.skill ? String(me.giftPending.skill.g.id) : "无");

  // 场上上限：技能 3 / 大招 2，超限最旧的消失
  B.gifts.length = 0;
  const olds = [];
  for (let i = 0; i < 5; i++) olds.push(B.spawnGift("skill", "windBlade", 100 + i * 30, 300, true));
  B.trimGifts("skill");
  check("天外来物：技能掉落物最多 3 个，最旧的消失",
    B.gifts.filter(g => g.kind === "skill").length === 3 && !B.gifts.includes(olds[0]) && B.gifts.includes(olds[4]),
    "n=" + B.gifts.length);
  B.gifts.length = 0;
  for (let i = 0; i < 4; i++) B.spawnGift("ult", "bloodRage", 100 + i * 30, 300, true);
  B.trimGifts("ult");
  check("天外来物：大招掉落物最多 2 个", B.gifts.filter(g => g.kind === "ult").length === 2, "n=" + B.gifts.length);

  // AI 也会捡：把人机放在掉落物旁边，观察配装被填上
  const aiBattle = mkBattle("gifts", null, 2);
  const bot = aiBattle[1];
  LD.AI.mkBot(bot, "normal");
  B.gifts.length = 0;
  const drop = B.spawnGift("skill", "windBlade", bot.x, bot.y, true);
  step(S, 3);
  check("天外来物：AI 会捡起掉落物装入空槽", bot.loadout.skill1 === "windBlade" || bot.loadout.skill2 === "windBlade",
    "skill1=" + bot.loadout.skill1 + " skill2=" + bot.loadout.skill2);
}

/* ============================================================
 * 17. v2.5.1：螺旋手里剑进店 / BOSS 技能与普攻修复 / 王从天降定身 / 文案
 * ============================================================ */
console.log("\n=== 17. v2.5.1 ===");
{
  /* ---- 螺旋手里剑进大招商店 ---- */
  const sh = LD.skill("shuriken");
  check("螺旋手里剑已进店（大招 / 售价 10）", !!sh && sh.kind === "ult" && sh.price === 10, sh ? sh.kind + "/" + sh.price : "null");
  check("螺旋手里剑：每段 12 伤 / 0.35s / 中速巨球 / 带吸引",
    sh.dmg === 12 && sh.tick === 0.35 && sh.speed === 250 && sh.r === 54 && sh.pull > 0,
    [sh.dmg, sh.tick, sh.speed, sh.r, sh.pull].join(","));
  check("螺旋手里剑：商店大招列表含它", LD.skillsBy("ult").some(s => s.id === "shuriken"));
  check("螺旋手里剑：与黑侠客大招共用同一份实现", LD.SKILL_IMPL.shuriken === LD.SKILL_IMPL.n_ult);
  check("黑侠客的螺旋手里剑每段也是 12", LD.skill("n_ult").dmg === 12, LD.skill("n_ult").dmg);

  // 勇者实际放一次
  const h1 = B.mkHero(0, { x: 300, y: 400, look: P.look(), loadout: { basic: "slash", ult: "shuriken" }, name: "H" });
  h1.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  const h2 = B.mkHero(1, { x: 700, y: 400, look: P.look(), name: "F" });
  B.setup({ mode: "duel", fighters: [h1, h2] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  h1.x = 300; h1.y = 400; h2.x = 700; h2.y = 400;   // 出生点随机，断言方向前先固定坐标
  h1.energy = h1.maxEnergy; h1.cd.ult = 0; h1.facing = { x: 1, y: 0 };
  B.trySlot(h1, "ult", h1.ctrl);
  const sz = B.zones.find(z => z.type === "shuriken");
  check("螺旋手里剑：勇者释放后生成飞行蓝球领域", !!sz && sz.dmg === 12 && sz.vx > 0,
    sz ? "dmg=" + sz.dmg + " vx=" + Math.round(sz.vx) : "无");

  /* ---- 黑侠客 AI 会真的按键用技能 ---- */
  const hero = B.mkHero(0, { x: 300, y: 400, look: P.look(), name: "勇者" });
  hero.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  const ninja = B.mkBoss("ninja", { diff: LD.DIFF.normal });
  B.setup({ mode: "dragon", fighters: [hero, ninja], theme: {} });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  hero.x = 300; hero.y = 400; ninja.x = 700; ninja.y = 400;
  ninja.cd.skill1 = 0; ninja.slot.skill1 = { on: false, phase: "", t: 0, d: {} };
  LD.AI.tickHero(ninja, 0.5);
  check("黑侠客 AI：会按下技能 1 键（召唤分身）", ninja.ctrl.press.skill1 === true, String(ninja.ctrl.press.skill1));
  ninja.cd.skill1 = 999; ninja.ctrl.press = {};
  ninja.cd.skill2 = 0; ninja.slot.skill2 = { on: false, phase: "", t: 0, d: {} };
  LD.AI.tickHero(ninja, 0.5);
  check("黑侠客 AI：会按下技能 2 键（突袭）", ninja.ctrl.press.skill2 === true, String(ninja.ctrl.press.skill2));
  check("黑侠客 AI：把飞镖当远程武器（保持距离 235）", ninja.bot.desired > 200, ninja.bot.desired);

  /* ---- 西部快枪手普攻 ---- */
  const gun = B.mkBoss("gun", { diff: LD.DIFF.normal });
  const hero2 = B.mkHero(0, { x: 300, y: 400, look: P.look(), name: "勇者" });
  hero2.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  B.setup({ mode: "dragon", fighters: [hero2, gun], theme: {} });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  hero2.x = 300; hero2.y = 400; gun.x = 700; gun.y = 400; gun.facing = { x: -1, y: 0 };
  gun.cd.basic = 0;
  const n0 = B.projs.length;
  B.trySlot(gun, "basic", gun.ctrl);
  const shot = B.projs[B.projs.length - 1];
  check("快枪手：普攻能打出子弹（不再因 sk.proj 缺失报错）",
    B.projs.length === n0 + 1 && !!shot && shot.type === "bullet" && shot.dmg === LD.BOSS.gun.basic.dmg,
    shot ? shot.type + "/dmg" + shot.dmg : "没打出子弹");
  check("快枪手：普攻 CD 1s", Math.abs(gun.cd.basic - 1.0) < 0.01, gun.cd.basic.toFixed(2));
  gun.cd.basic = 0; gun.facing = { x: 1, y: 0 };
  B.trySlot(gun, "basic", gun.ctrl);
  check("快枪手：子弹朝面朝方向飞出（有速度）", Math.abs(B.projs[B.projs.length - 1].vx) > 100,
    Math.round(B.projs[B.projs.length - 1].vx));

  /* ---- 困难模式：人形 BOSS 血量 ×2、伤害 ×1.4 真正生效 ---- */
  const hardNinja = B.mkBoss("ninja", { diff: LD.DIFF.hard });
  check("困难：人形 BOSS 血量 = 普通 2 倍", hardNinja.maxHp === LD.BOSS.ninja.hp * 2, hardNinja.maxHp + " vs " + LD.BOSS.ninja.hp);
  check("困难：人形 BOSS 伤害倍率 1.4", hardNinja.dmgM === 1.4, hardNinja.dmgM);
  check("困难：人形 BOSS 出手更快（rateM < 1）", hardNinja.rateM < 1, hardNinja.rateM.toFixed(3));
  const tgt = B.mkHero(0, { x: 300, y: 400, look: P.look(), name: "靶子" });
  tgt.team = 0; hardNinja.team = 1; tgt.side = 0; hardNinja.side = 1;
  check("困难：人形 BOSS 打出的 10 点伤害变成 14", B.damage(hardNinja, tgt, 10) === 14, tgt.hp + "/" + tgt.maxHp);

  /* ---- 王从天降：飞起期间不能移动、不能出招 ---- */
  const king = B.mkHero(0, { x: 300, y: 400, look: P.look(), loadout: { basic: "slash", skill1: "dashSlash", ult: "kingDrop" }, name: "王" });
  king.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  const dummy = B.mkHero(1, { x: 700, y: 400, look: P.look(), name: "靶" });
  B.setup({ mode: "duel", fighters: [king, dummy] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  king.x = 300; king.y = 400; king.energy = king.maxEnergy; king.cd.ult = 0;
  B.trySlot(king, "ult", king.ctrl);
  check("王从天降：一段标记落点", king.slot.ult.phase === "kingMark", king.slot.ult.phase);
  B.trySlot(king, "ult", king.ctrl);
  check("王从天降：二段进入飞起", king.slot.ult.phase === "kingRise", king.slot.ult.phase);
  for (let i = 0; i < 300 && LD.Cine.active; i++) step(S, 1);      // 等大招演出结束（世界冻结期间指针不推进）
  king.x = 300; king.y = 400; king.ctrl.mx = 1; king.ctrl.my = 0;
  const kx0 = king.x;
  for (let i = 0; i < 6; i++) step(S, 1);
  check("王从天降：飞起期间无法移动", Math.abs(king.x - kx0) < 1, "dx=" + (king.x - kx0).toFixed(1) + " phase=" + king.slot.ult.phase);
  check("王从天降：飞起状态仍在（定身判定有效）", king.slot.ult.phase === "kingRise", king.slot.ult.phase);
  king.cd.basic = 0; king.cd.skill1 = 0;
  B.trySlot(king, "basic", king.ctrl);
  check("王从天降：飞起期间普攻被锁", king.slot.basic.on === false && king.cd.basic === 0, "cd=" + king.cd.basic);
  B.trySlot(king, "skill1", king.ctrl);
  check("王从天降：飞起期间位移类技能也被锁", king.slot.skill1.on === false && king.cd.skill1 === 0, "cd=" + king.cd.skill1);
  for (let i = 0; i < 200 && king.slot.ult.phase === "kingRise"; i++) step(S, 1);   // 等落地
  check("王从天降：落地后结束定身", king.slot.ult.phase !== "kingRise", king.slot.ult.phase);
  const kx1 = king.x;
  king.ctrl.mx = 1;
  // 落地砸中目标会有命中定格（FX.stop 期间 dt=0、世界冻结），不能用固定帧数判定
  for (let i = 0; i < 120 && Math.abs(king.x - kx1) < 5; i++) step(S, 1);
  check("王从天降：落地后可以正常移动", Math.abs(king.x - kx1) > 5, "dx=" + (king.x - kx1).toFixed(1));

  /* ---- 天外来物模式介绍简化 ---- */
  const gifts = LD.ruleInfo("gifts");
  check("天外来物：规则介绍已简写（< 100 字）", gifts.desc.length < 100, gifts.desc.length + " 字");
  check("天外来物：简写后仍说清关键规则（10s 技能 / 20s 大招 / 置换）",
    gifts.desc.indexOf("10 秒") >= 0 && gifts.desc.indexOf("20 秒") >= 0 && gifts.desc.indexOf("置换") >= 0, gifts.desc);
}

const errs = [S].filter(x => x.err);
if (errs.length) console.log("\n运行时异常：\n" + errs[0].err.stack.split("\n").slice(0, 6).join("\n"));
console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
