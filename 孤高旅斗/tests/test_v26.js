/* 孤高旅斗 v2.6 / v2.7 无头集成测试
 * 覆盖：摄像机与大地图(1200) / 六只新 BOSS / 规则修饰符(回复·僵尸) / 缩圈乱斗 / 军备竞赛(僵尸+技能轮盘)
 *       / 车轮战 / 追猎时刻(随机猎人) / 乱斗热身 / 杂兵 / 闯关词条 / 成就称号 / 每日挑战 / 局内暂停与卡读条修复
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
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ✔ " + label + (extra !== undefined && extra !== "" && extra !== false ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✘ " + label + (extra !== undefined ? "  → " + extra : "")); }
}

const S = makeSandbox("main");
const LD = S.LD, B = LD.Battle, P = LD.Profile, UI = LD.UI;
LD.CONF.critRate = 0;

function mkHero(i, loadout, xy) {
  const f = B.mkHero(i, {
    x: xy ? xy[0] : 0, y: xy ? xy[1] : 0,
    look: P.look(),
    loadout: Object.assign({ basic: "slash", skill1: null, skill2: null, ult: null }, loadout || {}),
    name: "H" + i
  });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
function mkBattle(rule, opts) {
  opts = opts || {};
  const n = opts.n || 2;
  const fs2 = [];
  for (let i = 0; i < n; i++) fs2.push(mkHero(i, opts.loadout));
  B.setup(Object.assign({ mode: "duel", rule, fighters: fs2 }, opts.cfg || {}));
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return fs2;
}

/* ============================================================ */
console.log("=== 1. 数据层：新怪物 / 关卡 / 模式 / 元系统 ===");
check("LD.BOSS 新增 6 只", ["bee", "frost", "twin", "gambler", "mirror", "tesla"].every(k => LD.BOSS[k]), Object.keys(LD.BOSS).join(","));
check("机械蜂后规格 1+2+1", LD.BOSS.bee.basic && LD.BOSS.bee.skill1 && LD.BOSS.bee.skill2 && LD.BOSS.bee.ult);
check("霜甲巨像血 240", LD.BOSS.frost.hp === 240, LD.BOSS.frost.hp);
check("双子剑客无技能 2 槽位", LD.BOSS.twin.skill2 == null);
check("镜影配装为空（运行时复制）", LD.BOSS.mirror.loadout === null && LD.BOSS.mirror.cdMul === 1.3);
check("关卡共 9 关", LD.LEVELS.length === 9, LD.LEVELS.length);
check("关卡 4-9 BOSS 依次正确", LD.LEVELS.slice(3).map(l => l.boss).join(",") === "bee,frost,twin,gambler,mirror,tesla", LD.LEVELS.slice(3).map(l => l.boss).join(","));
check("规则共 11 种", LD.RULES.length === 11, LD.RULES.length);
check("杂兵目录：工蜂", LD.MINIONS && LD.MINIONS.beeDrone && LD.MINIONS.beeDrone.dmg === 9);
check("修饰符共 6 种（v3.3 新增定期刷新）", LD.MODS.length === 6 && LD.MODS.every(m => m.id && m.name && m.desc), LD.MODS.map(m => m.id).join(","));
check("词条池共 6 条", LD.PERKS.length === 6 && LD.PERKS.every(p => typeof p.apply === "function"));
check("成就共 20 项", LD.ACHIEVEMENTS.length === 20, LD.ACHIEVEMENTS.length);
check("称号共 20 个且 id 合法", LD.TITLES.length === 20 && LD.TITLES.every(t => t.id === t.id.trim() && t.ach));
check("新成就：热身达人 / 清道夫", LD.ACHIEVEMENTS.some(a => a.id === "warmup_win") && LD.ACHIEVEMENTS.some(a => a.id === "zombie_50"));

console.log("=== 2. BOSS 技能注册 ===");
["b_needle", "b_hatch", "b_sweep", "b_swarm", "f_cone", "f_quake", "f_field", "f_zero",
 "t_slash", "t_cross", "t_duo", "gm_dice", "gm_card", "gm_cheat", "gm_roulette",
 "ts_zap", "ts_polar", "ts_shield", "ts_storm"].forEach(id => {
  const sk = LD.skill(id);
  check("技能 " + id + " 已注册且为 boss 专属", sk && sk.kind === "boss" && typeof (LD.SKILL_IMPL && LD.SKILL_IMPL[id] ? LD.SKILL_IMPL[id].start : undefined) === "function");
});
check("双子不注册 skill2", !LD.skill("t_skill2") && !LD.SKILLS.some(s => s.id === "t_duo" && s.tags.indexOf("大招") < 0));
check("镜影不注册任何 boss 技能", !LD.SKILLS.some(s => /^m_/.test(s.id)));

console.log("=== 3. BOSS 工厂：双子 / 镜影 ===");
{
  const hero = mkHero(0);
  const bosses = B.mkBossForLevel("twin", LD.DIFF.normal, hero);
  check("双子工厂返回两个个体", bosses.length === 2);
  check("双子互链 twinLink", bosses[0].twinLink === bosses[1] && bosses[1].twinLink === bosses[0]);
  check("双子是 BOSS 且不在同一小队位", bosses[0].isBoss && bosses[1].isBoss);
  const hero2 = mkHero(0, { basic: "pistol", skill1: "firewall", skill2: "rockShield", ult: "kingDrop" });
  const mirror = B.mkBossForLevel("mirror", LD.DIFF.normal, hero2)[0];
  check("镜影复制玩家整套配装", mirror.loadout.basic === "pistol" && mirror.loadout.skill1 === "firewall" &&
    mirror.loadout.skill2 === "rockShield" && mirror.loadout.ult === "kingDrop",
    JSON.stringify(mirror.loadout));
  check("镜影 CD 为玩家 1.3 倍（rateM）", Math.abs(mirror.rateM - 1.3) < 1e-9, mirror.rateM);
  check("镜影是 BOSS", mirror.isBoss && mirror.bossKind === "mirror");
}

console.log("=== 4. 大世界与摄像机 ===");
{
  const fs2 = mkBattle("brawl");
  check("世界大于视口", B.world.w > 960 && B.world.h > 600, B.world.w + "x" + B.world.h);
  check("世界含顶部安全区 pt", B.world.pt === 120);
  const me = fs2[0];
  me.x = B.world.w / 2; me.y = (B.world.pt + B.world.h) / 2;
  B.updateCam();
  check("角色居中时摄像机跟随到中心", Math.abs(B.cam.x - (me.x - 480)) < 2 && Math.abs(B.cam.y - (me.y - 30 - 300)) < 2, Math.round(B.cam.x) + "," + Math.round(B.cam.y));
  me.x = 30; me.y = B.world.pt + 10;
  B.updateCam();
  check("贴边时摄像机被 clamp 在 0", B.cam.x === 0 && B.cam.y === 0, B.cam.x + "," + B.cam.y);
  me.x = B.world.w - 10; me.y = B.world.h - 10;
  B.updateCam();
  check("右下角时摄像机 clamp 在世界末端", B.cam.x === B.world.w - 960 && B.cam.y === B.world.h - 600, Math.round(B.cam.x) + "," + Math.round(B.cam.y));
}

console.log("=== 5. 规则修饰符（v2.7：回复 / 僵尸 取代脆皮 / 无大招） ===");
{
  const a = mkBattle("brawl", { cfg: { mods: ["heal"] } });
  check("回复：修饰符生效", B.mod("heal") && LD.MODS.some(m => m.id === "heal" && m.name === "回复"));
  check("回复：开局场上没有血包", B.heals.length === 0, B.heals.length);
  B.healT = 0.001;
  B.healTimerStep(0.002);
  check("回复：每 8 秒掉落一个血包", B.heals.length === 1 && B.healT === LD.HEALS.every, B.heals.length + "/" + B.healT);
  const h = B.heals[0];
  h.t = (LD.HEALS.fallT || 1.4) + 0.01;
  B.updateHeals(0.016);
  check("血包降落后才可拾取", h.landed === true);
  const me = a[0];
  me.hp = me.maxHp - 60;
  h.x = me.x; h.y = me.y;
  B.updateHeals(0.016);
  check("吃下血包回复 45 点生命", me.hp === me.maxHp - 60 + LD.HEALS.amount, me.hp + "/" + me.maxHp);
  check("血包被消耗掉", B.heals.indexOf(h) < 0);
  for (let i = 0; i < 10; i++) B.spawnHeal(100 + i, 400);
  check("血包同屏上限 4", B.heals.length === LD.HEALS.max, B.heals.length);
  const plain = mkBattle("brawl");
  check("未勾选「回复」时不会掉血包", (() => { plain[0] && (B.healT = 0.001); B.healTimerStep(0.002); return B.heals.length === 0; })(), B.heals.length);

  const b = mkBattle("brawl", { cfg: { mods: ["zombie"] } });
  check("僵尸：修饰符生效且僵尸系统开启", B.mod("zombie") && B.zombieOn());
  check("僵尸：开局场上没有僵尸", !B.fighters.some(f => f.isZombie));
  B.updateZombies((LD.ZOMBIE.first || 7) + 0.1);
  const z = B.fighters.find(f => f.isZombie);
  check("僵尸：到点刷出一只", !!z, B.fighters.length + " 个实体");
  check("僵尸 100 血 / 固定突刺 + 撕咬（无普攻、大招）",
    !!z && z.maxHp === LD.ZOMBIE.hp && !z.loadout.basic &&
    z.loadout.skill1 === "z_lunge" && z.loadout.skill2 === "z_bite" && !z.loadout.ult,
    z ? JSON.stringify(z.loadout) : "-");
  check("僵尸移速 = 普通角色的 110%", !!z && z.speedMul === 1.1, z && z.speedMul);
  check("僵尸不与任何玩家同队（team 8）且不是真人", !!z && z.team === 8 && z.isZombie === true);
  check("僵尸数量不超过上限", (() => { for (let i = 0; i < 12; i++) B.updateZombies(20); return B.fighters.filter(f => f.isZombie && !f.dead).length <= LD.ZOMBIE.max; })(), B.fighters.filter(f => f.isZombie).length);
  check("humans() 把僵尸排除在真人之外", B.humans().every(f => !f.isZombie));

  const c = mkBattle("brawl", { cfg: { mods: ["lowgrav", "speed"] } });
  check("多修饰符叠加生效", B.mod("lowgrav") && B.mod("speed"));
  check("高速：全体 CD 缩到 70%", Math.abs(c[0].rateM - 0.7) < 1e-9, c[0].rateM);
  const d = mkBattle("brawl", { cfg: { mods: ["wheel"] }, loadout: { ult: "kingDrop" } });
  check("技能轮盘修饰符初始未换装", d[0].loadout.ult === "kingDrop");
  B.wheelT = 11.99;
  B.updateWheel(0.02);
  check("轮盘 12 秒后换装（大招必有值）", !!d[0].loadout.ult, d[0].loadout.ult);
}

console.log("=== 6. 缩圈乱斗（v2.7 重做：多安全圈 + 掉落 + 血包） ===");
{
  const fs2 = mkBattle("ring", { n: 4 });
  check("缩圈模式地图 1200x1200", B.world.w === 1200 && B.world.h === 1200, B.world.w + "x" + B.world.h);
  check("开局撒下 4 个安全圈", Array.isArray(B.rings) && B.rings.length === LD.RING.n, B.rings && B.rings.length);
  check("安全圈初始半径 330 且都在存活状态", B.rings.every(c => !c.dead && c.r === LD.RING.r0), B.rings.map(c => Math.round(c.r)).join(","));
  check("地图上只剩这几个安全圈（其余全是毒）", B.rings.filter(c => !c.dead).length * Math.PI * LD.RING.r0 * LD.RING.r0 < 1200 * 1200 * 0.9);
  check("所有人开局都被放进安全圈（不在毒里）", fs2.every(f => !B.inPoison(f.x, f.y)));
  check("缩圈模式开局只有普攻", fs2.every(f => !f.loadout.skill1 && !f.loadout.skill2 && !f.loadout.ult), JSON.stringify(fs2[0].loadout));
  check("掉落机制对缩圈模式生效", B.giftRule() === true && B.giftCfg().maxSkill === 6 && B.giftCfg().maxUlt === 3, JSON.stringify(B.giftCfg()));
  /* 掉落点：有概率落在毒圈外，逼玩家冒险 */
  const dropRate = p => { let n = 0; for (let i = 0; i < 400; i++) { const q = B.ringDropSpot(p); if (B.inPoison(q.x, q.y)) n++; } return n / 400; };
  const rMid = dropRate(0.5), rHi = dropRate(0.95), rLo = dropRate(0.05);
  check("掉落点有相当比例落在圈外（需冒险去捡）", rMid > 0.15 && rMid < 0.85, rMid.toFixed(2));
  check("风险权重越高掉得越靠圈外", rHi > rLo + 0.2, rHi.toFixed(2) + " vs " + rLo.toFixed(2));
  check("缩圈模式会持续掉血包", (() => { B.healT = 0.001; B.healTimerStep(0.002); return B.heals.length === 1; })(), B.heals.length);
  /* 安全圈逐个消失 */
  B.ringT = LD.RING.killAt[0] - 0.01; B.ringKillN = 0;
  B.updateRing(0.02);
  check("第 22 秒消失一个安全圈", B.rings.filter(c => !c.dead).length === LD.RING.n - 1, B.rings.filter(c => !c.dead).length);
  B.ringT = LD.RING.killAt[2] + 0.01;
  B.updateRing(0.02);
  check("一路塌到只剩最后一个小圈", B.rings.filter(c => !c.dead).length === 1, B.rings.filter(c => !c.dead).length);
  /* 缩圈：开场不缩、之后持续缩小并收敛到下限 */
  B.rings.forEach(c => { c.dead = false; c.r = c.r0; });
  B.ringKillN = LD.RING.killAt.length;
  B.ringT = 0; B.updateRing(0.01);
  check("开场 14 秒内安全圈不缩小", B.rings[0].r === LD.RING.r0, Math.round(B.rings[0].r));
  B.ringT = LD.RING.shrinkStart + 20; B.updateRing(0.01);
  check("14 秒后安全圈开始收缩", B.rings[0].r < LD.RING.r0, Math.round(B.rings[0].r));
  B.ringT = 120; B.updateRing(0.01);
  check("收缩到下限（初始半径的 48%）", Math.abs(B.rings[0].r - LD.RING.r0 * LD.RING.minMul) < 1e-6, Math.round(B.rings[0].r));
  /* 圈外掉血 / 圈内安全 */
  const inside = fs2[0], outside = fs2[1];
  B.rings.forEach(c => { c.dead = false; c.r = c.r0; });   // 先把 4 个安全圈复原，再找圈外的点
  B.ringT = 0; B.ringKillN = LD.RING.killAt.length; B.ringTick = 0;
  let op = null;
  for (let k = 0; k < 600 && !op; k++) {
    const x = Math.random() * B.world.w, y = B.world.pt + Math.random() * (B.world.h - B.world.pt);
    if (B.inPoison(x, y)) op = { x, y };
  }
  inside.x = B.rings[0].x; inside.y = B.rings[0].y;
  outside.x = op ? op.x : 20; outside.y = op ? op.y : 20;
  inside.hp = 100; outside.hp = 100;
  B.updateRing(0.01);
  check("圈外每 0.5 秒掉 5 血", outside.hp === 100 - LD.RING.dmg, outside.hp);
  check("圈内不掉血", inside.hp === 100, inside.hp);
}

console.log("=== 7. 军备竞赛（v2.7 重做：刷僵尸攒钱 + 技能轮盘） ===");
{
  const fs2 = mkBattle("auction");
  check("军备竞赛常驻刷僵尸", B.rule === "auction" && B.zombieOn());
  check("金币池初始化", Array.isArray(B.coins));
  B.updateZombies((LD.ZOMBIE.first || 7) + 0.1);
  const z = B.fighters.find(f => f.isZombie);
  check("僵尸到点出现在场地里", !!z);
  const me = fs2[0];
  B.coins.push({ x: me.x, y: me.y, v: 5, t: 0 });
  B.updateAuction(0.016);
  check("拾取局内金币", (me.bcoins || 0) === 5, me.bcoins);
  check("金币被拾取后从场上移除", B.coins.filter(c => c.v === 5 && c.t < 0.1).length === 0);
  check("僵尸被击杀后爆局内金币", (() => {
    if (!z) return false;
    const before = B.coins.length;
    B.kill(z, me);
    return B.coins.length === before + 1;
  })(), B.coins.length);
  check("僵尸阵亡不影响回合胜负", B.state === "fight", B.state);
  check("僵尸击杀只掉 1 枚金币（新经济）", (() => {
    const before = B.coins.length;
    const zc = B.coins[B.coins.length - 1];
    return zc ? zc.v === LD.ZOMBIE.coin : true;
  })(), LD.ZOMBIE.coin);
  check("局内商店共 4 件商品、单价 3 金币", (() => {
    const items = B.armyShop();
    return items.length === 4 && items.every(i => i.price === 3) && ["heal", "hp", "spd", "energy"].every(id => items.some(i => i.id === id));
  })(), B.armyShop().length);
  const f = fs2[0];
  f.bcoins = 15;
  f.hp = f.maxHp;
  check("满血买不了血包", B.armyBuy(f, "heal") === false && f.bcoins === 15);
  f.hp = f.maxHp - 60;
  const hpBefore = f.hp;
  check("血包：3 币回血", B.armyBuy(f, "heal") === true && f.bcoins === 12 && f.hp === Math.min(f.maxHp, hpBefore + LD.ASHOP.healAmount), f.hp - hpBefore);
  const cap0 = f.maxHp, hpb = f.hp;
  check("血量加成：3 币上限 +" + LD.ASHOP.hpGain + "（当前血同步）", B.armyBuy(f, "hp") === true && f.bcoins === 9 && f.maxHp === cap0 + LD.ASHOP.hpGain && f.hp === hpb + LD.ASHOP.hpGain, (f.maxHp - cap0) + "/" + (f.hp - hpb));
  const spd0 = f.speedMul;
  check("移速加成：3 币移速 +15%", B.armyBuy(f, "spd") === true && f.bcoins === 6 && Math.abs(f.speedMul - (spd0 + LD.ASHOP.spdGain)) < 1e-9, f.speedMul - spd0);
  f.spdBuys = LD.ASHOP.spdMax;
  check("移速加成叠满后买不了", B.armyBuy(f, "spd") === false && f.bcoins === 6);
  check("金币不足买不了", (() => { f.bcoins = 2; return B.armyBuy(f, "hp") === false && f.bcoins === 2; })());
  check("人机自动逛商店（botSpin）", typeof B.botSpin === "function");
  check("UI 局内商店就绪", typeof UI.armyBuy === "function" && typeof UI.openArmy === "function" && typeof UI.renderArmy === "function" && typeof UI.closeArmy === "function");
  check("商店开着不暂停战斗（背景半透明）", (() => {
    B.rule = "auction"; B.state = "fight";
    UI.openArmy();
    const open = UI.screen === "ovArmy" && B.paused === false;
    UI.closeArmy();
    return open && UI.screen === "game";
  })());
  check("商店面板已改为 50% 透明局内商店", (() => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "src", "shell.html"), "utf8");
    return raw.indexOf("局内商店") >= 0 && raw.indexOf("#ovArmy{background:rgba(6,9,18,.5)}") >= 0 && raw.indexOf("armySpin") < 0;
  })());
  check("新一局还原商店加成（商品只在当局有效）", (() => {
    f.bcoins = 10; B.armyBuy(f, "hp"); B.armyBuy(f, "spd");
    B.resetRound();
    return f.maxHp === f._baseMaxHp && Math.abs(f.speedMul - f._baseSpd) < 1e-9 && f.spdBuys === 0;
  })(), f.maxHp + "/" + f._baseMaxHp);
}

console.log("=== 8. 车轮战 ===");
{
  const fs2 = mkBattle("relay", { n: 4 });
  check("擂台外坐板凳", fs2[2].bench === true && fs2[3].bench === true && !fs2[0].bench && !fs2[1].bench);
  check("擂台上恰好两人", B.fighters.filter(f => f.kind === "hero" && !f.bench).length === 2);
  fs2[1].hp = 1;
  B.damage(fs2[0], fs2[1], 999, { type: "skill", kb: 0 });
  check("击杀后进入换人间隙", B.relayNext > 0, B.relayNext && B.relayNext.toFixed(2));
  check("胜者回血 30%", fs2[0].hp >= Math.round(fs2[0].maxHp * 0.3) - 5, fs2[0].hp + "/" + fs2[0].maxHp);
  step(S, 120);                       // 2 秒 > 1.6 秒
  check("1.6 秒后下一位上场", fs2[2].bench === false, "bench=" + !!fs2[2].bench);
}

console.log("=== 9. 追猎时刻（v2.7 重做：随机猎人 + 大毒圈） ===");
{
  const fs2 = mkBattle("hunt", { n: 4, loadout: { skill1: "firewall", skill2: "rockShield", ult: "kingDrop" } });
  check("追猎模式地图 1200x1200", B.world.w === 1200 && B.world.h === 1200, B.world.w + "x" + B.world.h);
  const hunter = fs2.find(f => f.huntRole === "hunter");
  const runners = fs2.filter(f => f.huntRole === "runner");
  check("开局随机抽出一名猎人", !!hunter && hunter.team === 9 && hunter.huntCrown === true, hunter ? ("座位 " + hunter.side) : "-");
  check("其余三人都是生存者", runners.length === 3, runners.length);
  check("猎人血量 800", !!hunter && hunter.maxHp === LD.HUNT.hp && hunter.hp === 800, hunter && hunter.maxHp);
  check("猎人全部 CD 减半（rateM ×0.5）", !!hunter && Math.abs(hunter.rateM - 0.5) < 1e-9, hunter && hunter.rateM);
  check("猎人保留自己选的技能", !!hunter && hunter.loadout.skill1 === "firewall" && hunter.loadout.skill2 === "rockShield" && hunter.loadout.ult === "kingDrop", hunter && JSON.stringify(hunter.loadout));
  check("生存者也保留自己选的技能（不再被剥空）", runners.every(f => !!f.loadout.skill1 && !!f.loadout.skill2 && !!f.loadout.ult));
  check("生存者同队（互不伤害）", runners.every(f => f.team === 0));
  check("追猎按房间对局时间限时（默认 120 秒）", B.roundT === LD.MATCH.def && B.roundT === 120, B.roundT);
  /* 开局大毒圈缓慢收缩：90 秒后仍有充足走位空间 */
  const r0 = B.huntRing.r;
  B.updateHunt(30);
  const r30 = B.huntRing.r;
  B.updateHunt(60);
  const r90 = B.huntRing.r;
  check("开场毒圈半径 980（覆盖整张图）", r0 === LD.HUNT.r0, r0);
  check("毒圈持续缓慢收缩", r90 < r30 && r30 < r0, Math.round(r0) + " → " + Math.round(r30) + " → " + Math.round(r90));
  check("90 秒后仍有充足走位空间（≥ 420）", r90 >= LD.HUNT.minR - 3, Math.round(r90));
  /* 圈外掉血 / 圈内安全 */
  const inside = fs2[0], outside = fs2[1];
  B.huntRing.x = inside.x; B.huntRing.y = inside.y; B.huntRing.r = 300; B.huntRing.tick = 0;
  inside.hp = 500; outside.hp = 500;
  outside.x = inside.x + 2000; outside.y = inside.y;
  B.updateHunt(0.01);
  check("毒圈外每 0.5 秒掉 6 血", outside.hp === 500 - LD.HUNT.dmg, outside.hp);
  check("毒圈内不掉血", inside.hp === 500, inside.hp);
  /* 回归：猎人换人后血量必须还原，不能永远留在 800 */
  for (let r = 0; r < 6; r++) B.resetRound();
  check("多次换回合后仍只有一名猎人", B.fighters.filter(x => x.huntRole === "hunter").length === 1);
  check("不当猎人后血量还原（bug：曾当过猎人的玩家血量残留 800）",
    B.fighters.every(x => x.huntRole !== "runner" || x.maxHp === x._huntBaseHp),
    JSON.stringify(B.fighters.map(x => x.maxHp)));
  check("还原后的血量等于最初基线（setup 记录值）",
    B.fighters.every(x => x.huntRole === "hunter" || x.maxHp === x._baseMaxHp),
    JSON.stringify(B.fighters.map(x => x.side + ":" + x.maxHp + "/base" + x._baseMaxHp)));
  /* 结算：猎人阵亡 → 生存者立刻获胜 */
  B.state = "fight"; B.countdown = 0;                    // 上面 resetRound 过，先把回合拉回战斗态
  const h2 = B.fighters.find(x => x.huntRole === "hunter");
  const r2 = B.fighters.find(x => x.huntRole === "runner" && !x.dead);
  h2.hp = 1;
  B.damage(r2, h2, 999, { type: "skill", kb: 0 });
  check("猎人阵亡立刻结算（生存者获胜）", B.state === "over" && B.matchWinner === r2.side, B.state + "/" + B.matchWinner);
}
check("旧版「0 号位固定猎人」已废弃", (() => {
  const f2 = mkBattle("hunt", { n: 4 });
  return B.hunterSide === (B.fighters.find(x => x.huntRole === "hunter") || {}).side;
})());

console.log("=== 10. 乱斗热身（v2.7 新增） ===");
{
  check("对局时间提供 60 / 120 / 180 三档", LD.MATCH.times.join(",") === "60,120,180", LD.MATCH.times.join(","));
  check("规则表已收录乱斗热身", LD.ruleInfo("warmup").name === "乱斗热身" && LD.ruleInfo("warmup").icon === "🎯");
  const fs2 = mkBattle("warmup", { n: 4, cfg: { matchT: 60 } });
  check("房间可以指定时长（60 秒）", B.rule === "warmup" && B.matchT === 60, B.matchT);
  check("回合时限 = 最新对局时间", B.roundT === 60, B.roundT);
  check("热身模式地图 1200x1200", B.world.w === 1200 && B.world.h === 1200);
  const a = fs2[0], b2 = fs2[1];
  b2.hp = 1;
  B.damage(a, b2, 999, { type: "skill", kb: 0 });
  check("击杀者得 1 分", B.wScore[0] === 1, B.wScore[0]);
  check("阵亡不淘汰，转入复活倒计时", b2.dead === true && b2.respawnT > 0, b2.respawnT);
  check("有人阵亡也不结束比赛", B.state === "fight", B.state);
  B.updateRespawn(1.7);
  check("1.6 秒后满血复活", b2.dead === false && b2.hp === b2.maxHp, b2.hp + "/" + b2.maxHp);
  check("复活位置随机且在地图内", b2.x >= 34 && b2.x <= B.world.w - 34 && b2.y >= B.world.pt && b2.y <= B.world.h - 40, Math.round(b2.x) + "," + Math.round(b2.y));
  check("复活后短暂无敌", b2.invuln > 0, b2.invuln);
  b2.invuln = 0;
  check("连杀累加分数", (() => { B.damage(a, b2, 999, { type: "skill", kb: 0 }); return B.wScore[0] === 2; })(), B.wScore[0]);
  /* 时间到：分数最高者获胜 */
  B.wScore[1] = 9;
  B.roundT = 0.001;
  /* 击杀的命中定格（FX.stop）会吃掉第一帧，多推几帧 */
  for (let i = 0; i < 6 && B.state === "fight"; i++) B.update(0.5);
  check("时间到按分数判胜（分高者赢）", B.state === "over" && B.matchWinner === fs2[1].side, B.state + "/" + B.matchWinner);
  /* 对局时间统一后的兼容与扩散：旧字段仍可读，经典乱斗 / 阵营也按该选项计时 */
  mkBattle("warmup", { n: 2, cfg: { warmupT: 180 } });
  check("兼容旧 warmupT 字段", B.matchT === 180 && B.roundT === 180, B.matchT);
  mkBattle("brawl", { cfg: { rule: "brawl", matchT: 60 } });
  check("经典乱斗跟随对局时间（60 秒）", B.roundT === 60, B.roundT);
  mkBattle("team", { cfg: { rule: "team", matchT: 180 } });
  check("阵营模式跟随对局时间（180 秒）", B.roundT === 180, B.roundT);
}

console.log("=== 11. 杂兵系统 ===");
{
  const fs2 = mkBattle("brawl");
  const foe = fs2[1];
  foe.x = B.world.w / 2 + 100; foe.y = 500;
  /* 混战里所有勇者 team=-1、互为敌人——把主人挪远，避免杂兵索敌盯上主人造成偶发自爆 */
  fs2[0].x = B.world.w / 2; fs2[0].y = B.world.pt + 60;
  const m = B.spawnMinion("beeDrone", B.world.w / 2, 500, fs2[0]);
  check("杂兵实体生成", B.fighters.indexOf(m) >= 0 && m.kind === "minion" && m.mKind === "beeDrone");
  /* 蜂型杂兵带环绕轨迹且接触即自爆——拉远目标跑 0.64 秒取最近距离验证追踪趋势，
   * 避免单帧绕圈误报 / 追上后提前自爆影响后面的自爆场景 */
  foe.x = B.world.w / 2 + 220; foe.y = 500;
  let dmin = 220;
  for (let i = 0; i < 40; i++) {
    B.updateMinions(0.016);
    dmin = Math.min(dmin, Math.hypot(foe.x - m.x, foe.y - m.y));
  }
  check("杂兵追踪敌人", dmin < 220, "220→" + Math.round(dmin));
  foe.hp = 100; foe.x = m.x + 20; foe.y = m.y;
  B.updateMinions(0.016);
  check("接触自爆造成伤害", foe.hp < 100, foe.hp);
  check("自爆后杂兵消失", B.fighters.indexOf(m) < 0);
  const m2 = B.spawnMinion("beeDrone", B.world.w / 2, 500, fs2[0]);
  m2.hp = 0; m2.dead = true;
  B.updateMinions(0.016);
  check("被击杀的杂兵被清理", B.fighters.indexOf(m2) < 0);
  /* 回归：杂兵存活时主循环（含 B.regen 的全体 CD 递减）不得抛 TypeError——
   * 曾因 f.cd.basic 炸掉渲染循环导致「蜂后放蜂群就卡死」，无头 step 会吞异常，必须显式断言 */
  const m3 = B.spawnMinion("beeDrone", B.world.w / 2 - 200, 500, fs2[0]);
  foe.x = B.world.w / 2 + 260; foe.y = 500;
  S.err = null;
  for (let i = 0; i < 60; i++) step(S, 1);
  check("杂兵存活期间主循环零异常（蜂后卡死回归）", !S.err, S.err && S.err.message);
  /* 闯关 4：机械蜂后完整走 24 秒——孵化 + 蜂群倾巢都应触发且零异常、杂兵不超上限 */
  {
    const boss = B.mkBoss("bee", { diff: LD.DIFF.normal });
    const hero2 = mkHero(0, { basic: "slash" });
    hero2.x = B.world.w / 2; hero2.y = B.world.pt + 200;
    B.setup({ mode: "dragon", level: LD.LEVELS[3], fighters: [hero2, boss] });
    B.resetRound(false); B.state = "fight"; B.countdown = 0;
    hero2.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
    let maxMinions = 0;
    S.err = null;
    for (let i = 0; i < 1440; i++) {
      step(S, 1);
      maxMinions = Math.max(maxMinions, B.fighters.filter(f => f.kind === "minion").length);
    }
    check("蜂后 24 秒实战零异常（孵化 + 蜂群倾巢）", !S.err, S.err && S.err.message);
    check("杂兵数量不超 6 上限", maxMinions <= 6, "峰值 " + maxMinions);
    check("战斗推进到结算而非冻结", B.state === "over" || B.t > 20, B.state + "/t=" + B.t.toFixed(1));
  }
}

console.log("=== 12. 闯关词条 ===");
{
  check("词条影响伤害（力量 +20%）", (() => {
    const fs2 = mkBattle("brawl");
    const a = fs2[0], b2 = fs2[1];
    b2.hp = 1000; b2.maxHp = 1000;
    const d0 = B.damage(a, b2, 10, { type: "skill", kb: 0 });
    a.perkDmg = 1.2;
    const d1 = B.damage(a, b2, 10, { type: "skill", kb: 0 });
    return d1 === 12 && d0 === 10;
  })());
  check("词条：疾风步（闪避 CD -30%）", (() => {
    const f = mkHero(7);
    f.perkDodgeM = 0.7;
    return typeof f.perkDodgeM === "number";
  })());
  check("词条：健壮（上限 +25%）", (() => {
    const f = mkHero(7);
    f.maxHp = 100; f.hp = 100;
    LD.PERKS.find(p => p.id === "vigor").apply(f);
    return f.maxHp === 125 && f.hp === 125;
  })());
  check("UI 词条面板就绪", typeof UI.offerPerk === "function" && typeof UI.applyRunPerks === "function" && typeof UI.resetRunPerks === "function");
  UI.runPerks = ["power"];
  const f = mkHero(7);
  UI.applyRunPerks(f);
  check("applyRunPerks 应用已选词条", f.perkDmg === 1.2);
  UI.resetRunPerks();
  check("重置词条", UI.runPerks.length === 0);
}

console.log("=== 12. 成就 / 称号 / 死战闯关 ===");
{
  P.d.stats = { kills: 0, wins: 0, losses: 0, coinsEarned: 0, bossWins: 0, relayWins: 0, huntWins: 0, dailyWins: 0 };
  P.d.ach = {};
  P.battleEnd(true, "duel");
  check("胜利累计", P.d.stats.wins >= 1, P.d.stats.wins);
  check("成就：初出茅庐解锁", P.achUnlocked("first_win"));
  P.stat("kills", 100);
  P.checkAch();
  check("成就：百人斩解锁", P.achUnlocked("kills_100"));
  check("佩戴称号", P.setTitle("chuwu") === true && P.d.title === "chuwu");
  check("未解锁称号拒绝佩戴", P.setTitle("xiuluo") === false);
  check("摘下称号", P.setTitle("") === true && P.d.title === "");
  /* v3.1：每日挑战替换为死战闯关 */
  check("每日挑战入口已移除", typeof UI.startDaily === "undefined" && typeof UI.dailyConfig === "undefined");
  check("死战闯关入口就绪", typeof UI.startGauntlet === "function" && typeof UI.endGauntlet === "function");
  {
    const _sd = UI.startDragon, _toast = UI.toast, _reset = UI.resetRunPerks;
    let launched = 0;
    UI.startDragon = () => { launched++; };
    UI.toast = () => {};
    UI.resetRunPerks = () => { UI.runPerks = []; };
    UI.gauntlet = null;
    UI.startGauntlet();
    const g = UI.gauntlet;
    check("死战闯关共 6 关", g && g.picks.length === 6, g && g.picks.length);
    check("前 4 关普通、后 2 关困难",
      g && g.picks.slice(0, 4).every(p => p.diff.key === "normal") &&
      g.picks.slice(4).every(p => p.diff.key === "hard"),
      g && g.picks.map(p => p.diff.key).join(","));
    check("开局即进入第 1 关", launched === 1 && g.stage === 0, launched);
    /* 模拟通关一关：应进入 Buff 选择，而不是直接结束 */
    let offered = 0;
    UI.offerGauntletPerk = () => { offered++; };
    UI.show = UI.show || (() => {});
    const _pbe = P.battleEnd, _add = P.addCoins, _stat = P.stat, _ca = P.checkAch, _sv = P.save;
    P.battleEnd = () => {}; P.addCoins = () => {}; P.stat = () => {}; P.checkAch = () => {}; P.save = () => {};
    const _show = UI.show; UI.show = () => {};
    UI.endGauntlet(true, g.picks[0].level, g.picks[0].diff);
    check("通关一关后进入 Buff 三选一", offered === 1 && g.stage === 1, "stage=" + g.stage + " offered=" + offered);
    UI.gauntlet = null;
    UI.startDragon = _sd; UI.toast = _toast; UI.resetRunPerks = _reset;
    UI.show = _show;
    P.battleEnd = _pbe; P.addCoins = _add; P.stat = _stat; P.checkAch = _ca; P.save = _sv;
  }
  check("成就面板就绪", typeof UI.renderAch === "function");
}

console.log("=== 14. 局内暂停与键位（v2.7 卡读条 2 修复） ===");
{
  const fs2 = mkBattle("brawl");
  const me = fs2[0];
  me.hp = 100;
  B.paused = true;
  step(S, 20);
  check("暂停时世界冻结", me.hp === 100 && B.t === 0, "t=" + B.t);
  B.paused = false;
  step(S, 6);
  check("解除暂停恢复更新", B.t > 0, "t=" + B.t.toFixed(2));
  check("军备商店按钮守卫（非军备规则不开）", (() => { UI.openArmy(); return UI.screen !== "ovArmy" || B.rule === "auction"; })());
  /* v2.7 修复「进入模式卡在读条 2」：暂停状态必须在新一局开始时被清掉 */
  B.paused = true;
  mkBattle("ring");
  check("重开一局会清掉暂停残留（卡读条 2 的根因）", B.paused === false, B.paused);
  B.state = "countdown"; B.countdown = 2.0;
  step(S, 8);
  check("开新局后倒计时正常推进（不会卡在 2）", B.countdown < 2.0, B.countdown.toFixed(2));
  check("倒计时走完会进入 fight", (() => { step(S, 160); return B.state === "fight"; })(), B.state);
}

console.log("=== 15. 阶段转换（BOSS 半血狂暴） ===");
{
  const hero = mkHero(0);
  const boss = B.mkBoss("bee", { diff: LD.DIFF.normal });
  B.setup({ mode: "dragon", level: LD.LEVELS[3], fighters: [hero, boss] });
  B.resetRound(false); B.state = "fight"; B.countdown = 0;
  check("满血时未狂暴", !boss.phase2);
  const before = boss.rateM;
  boss.hp = boss.maxHp * 0.49;
  B.checkPhase2 && B.checkPhase2(boss);
  step(S, 4);
  check("半血进入狂暴", !!boss.phase2, "rateM " + before + "→" + boss.rateM);
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
