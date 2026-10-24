/* 孤高旅斗 v4.12 娱乐模式批次测试
 * 覆盖：模式注册与分类 / 通用禁用（招式 + 道具包）/
 *       一二三木头人（小地图 / 回头信号 / 锁定伤害与击退 / 不退回起点 / 冲线）/
 *       抢椅子（椅子从多到少 / 没抢到只扣血 / 抢先规则）/
 *       躲猫猫（鬼与躲藏者 / 抓到变鬼 / 藏身点补足）/
 *       地板是岩浆（安全台 / 红格掉血 / 安全台会消失）/
 *       弹幕生存（炮台 / 命中掉血 / 换模式安全间隙）/
 *       冰面滑壶（得分区加分 / 冰面惯性 / 互撞击退）/ 渲染不崩
 */
const SB = require("./_sandbox.js");
const { fs, path, html, code, makeCtx, makeEl, makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const sb = makeSandbox();
const LD = sb.LD, B = LD.Battle;
LD.CONF.critRate = 0;

const BASE = { basic: "slash", skill1: "dashSlash", skill2: "blink", ult: "n_ult" };
function mkHero(side, team) {
  const f = B.mkHero(side, { x: 400, y: 400, look: LD.Profile.look(), loadout: BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  f.team = team == null ? -1 : team;
  return f;
}
function setupRule(rule, n, preset) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(mkHero(i, -1));
  B.setup({ mode: "duel", rule: rule, fighters: list, isHost: true, mySide: 0, matchT: 180,
    mapCfg: LD.mapCfg({ preset: preset || "arena", seed: 7, ground: "stone" }) });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return list;
}

console.log("=== 1. 模式注册与分类 ===");
{
  const ids = ["statue", "chair", "hide", "lava", "barrage", "slide"];
  check("六个娱乐模式全部注册", ids.every(id => LD.ruleInfo(id).id === id), ids.join("/"));
  check("全部归入 casual", ids.every(id => LD.ruleInfo(id).cat === "casual"));
  check("碰碰车 / 山芋也在 casual 组", LD.isEntertain("bump") && LD.isEntertain("hotpotato"));
  check("战斗 14 种 / 娱乐 8 种", LD.rulesBy("combat").length === 14 && LD.rulesBy("casual").length === 8,
    LD.rulesBy("combat").length + " / " + LD.rulesBy("casual").length);
  check("旧模式默认算战斗模式", LD.rulesBy("combat").some(r => r.id === "brawl"));
  check("房间界面按分类分组渲染", /战斗模式/.test(code) && /娱乐模式/.test(code));
  check("六个模式各有专属称号", ids.every(id => LD.TITLES.some(t => t.ach === id + "_win")));
}

console.log("\n=== 2. 通用：禁用招式与道具包 ===");
{
  const list = setupRule("statue", 3);
  const f = list[0];
  check("全员脱队（team = -1）", list.every(x => x.team === -1));
  ["basic", "skill1", "skill2", "ult"].forEach(slot => {
    f.ctrl.press[slot] = true;
    B.trySlot(f, slot, f.ctrl);
    f.ctrl.press[slot] = false;
  });
  check("四个槽位全部点不动（木头人）", ["basic", "skill1", "skill2", "ult"].every(s => !f.slot[s].on));
  check("娱乐模式不掉道具包", B.packAllowed() === false);
  check("掉落池不含 energy", (function () {
    B.pickups = [];
    for (let i = 0; i < 60; i++) B.dropPickup(500, 500);
    const kinds = {};
    B.pickups.forEach(p => kinds[p.kind] = 1);
    B.pickups = [];
    return !kinds.energy;
  })());
}

console.log("\n=== 3. 一二三木头人 ===");
{
  const list = setupRule("statue", 4);
  const C = LD.STATUE;
  check("小地图一屏（960 × 600 = 视口尺寸）", B.world.w === 960 && B.world.h === 600, B.world.w + "×" + B.world.h);
  check("全员排在起跑线上", list.every(f => Math.abs(f.x - C.startX) < 2), list.map(f => Math.round(f.x)).join(","));
  check("开局是背对阶段", B.statue.phase === "back", B.statue.phase);

  /* back → tell（回头前一定有信号） */
  B.statue.t = 0; B.updateStatue(1 / 60);
  check("背对结束进入预警（这就是「回头前的信号」）", B.statue.phase === "tell", B.statue.phase);
  B.statue.t = 0; B.updateStatue(1 / 60);
  check("预警结束才真的回头", B.statue.phase === "look", B.statue.phase);

  /* 站在视野里不动 → 不会被锁定 */
  const f0 = list[0];
  f0.x = 600; f0.y = 300; f0.moving = false; f0.vx = 0; f0.vy = 0;
  check("中场在监视者视野内", B.statueInFov(f0.x, f0.y));
  B.statue.locks.length = 0; B.statue.lockedSet = {};
  B.updateStatue(1 / 60);
  check("不动就不会被锁定", B.statue.locks.length === 0, B.statue.locks.length);

  /* 动一下 → 被锁定 → 落点结算掉血 + 击退 */
  f0.moving = true;
  B.updateStatue(1 / 60);
  check("在视野里移动会被锁定", B.statue.locks.length === 1, B.statue.locks.length);
  const hp0 = f0.hp;
  for (let i = 0; i < 40; i++) B.updateStatue(1 / 60);
  check("锁定落点结算掉 " + C.lockDmg + " 血", Math.abs((hp0 - f0.hp) - C.lockDmg) < 1, hp0 + " → " + f0.hp);
  check("被击退（knockLeft > 0）", f0.knockLeft > 0, Math.round(f0.knockLeft));
  check("进度保留：不退回起点", f0.x >= 600 - (C.lockKb || 300), Math.round(f0.x));

  /* 冲线获胜 */
  const f1 = list[1];
  f1.x = C.finishX + 1;
  B.state = "fight";
  B.updateStatue(1 / 60);
  check("冲过终点线即赢下本局", B.state === "roundEnd" && B.roundWinner === f1.side, B.state + "/" + B.roundWinner);

  /* 复活保留 x 进度 */
  const p = B.statueSpot(f0);
  check("复活点保留 x 进度（不回起点）", p.x > C.startX + 100, Math.round(p.x));
}

console.log("\n=== 4. 抢椅子 ===");
{
  const list = setupRule("chair", 4);
  const C = LD.CHAIR;
  check("开局座位数 = 人数 + 2", B.chair.n === 4 + C.extra, B.chair.n);
  check("开局音乐响着", B.chair.phase === "music", B.chair.phase);

  /* 音乐停 → 抢位窗口 */
  B.chair.t = 0; B.updateChair(1 / 60);
  check("音乐停进入抢位阶段", B.chair.phase === "stop" || B.chair.phase === "fake", B.chair.phase);
  if (B.chair.phase === "fake") { B.chair.t = 0; B.updateChair(1 / 60); B.chair.t = 0; B.updateChair(1 / 60); }
  check("假停后回到音乐（或直接进抢位）", B.chair.phase === "stop", B.chair.phase);

  /* 抢先规则：同一个位子，先踏入的人赢 */
  const s0 = B.chair.seats[0];
  const a = list[0], b = list[1];
  a.x = s0.x; a.y = s0.y; a.chairSeat = 0; a.chairT = 1;
  b.x = s0.x + 4; b.y = s0.y; b.chairSeat = 0; b.chairT = 5;
  list[2].x = 60; list[2].y = 60;
  list[3].x = 60; list[3].y = B.world.h - 60;
  const hpA = a.hp, hpB = b.hp;
  B.updateChair(0);
  B.chairResolve();
  check("先踏入的人抢到位子（不掉血）", a.hp === hpA, a.hp);
  check("晚到的人没抢到，扣 " + C.missDmg + " 血但不出局",
    Math.abs((hpB - b.hp) - C.missDmg) < 1 && !b.dead, hpB + " → " + b.hp);
  check("没抢到不是出局", !b.dead);

  /* 每轮座位 -1 */
  const n0 = B.chair.n;
  B.chair.t = 0; B.updateChair(1 / 60);
  check("每轮过后座位数 -1", B.chair.n === Math.max(C.minSeats, n0 - 1), n0 + " → " + B.chair.n);
}

console.log("\n=== 5. 躲猫猫 ===");
{
  const list = setupRule("hide", 4);
  const seekers = list.filter(f => f.hideRole === "seeker");
  const hiders = list.filter(f => f.hideRole === "hider");
  check("开局一人当鬼", seekers.length === 1 && hiders.length === 3, seekers.length + " 鬼 / " + hiders.length + " 躲");
  check("鬼血更厚", seekers[0].maxHp === LD.HIDE.seekerHp, seekers[0].maxHp);
  check("藏身点补足到 ≥ 人数 + 2", B.hideSpots().length >= 6, B.hideSpots().length);

  /* 鬼贴身抓人 → 被抓的人变成鬼 */
  const sk = seekers[0], h = hiders[0];
  h.x = sk.x + 10; h.y = sk.y;
  B.updateHide(1 / 60);
  check("贴身抓到 → 躲藏者变成鬼", h.hideRole === "seeker", h.hideRole);
  check("场上鬼变多、躲藏者变少",
    B.casualAlive().filter(f => f.hideRole === "seeker").length === 2 &&
    B.casualAlive().filter(f => f.hideRole === "hider").length === 2);

  /* 躲在柜子里不会被直接抓到 */
  const h2 = B.casualAlive().filter(f => f.hideRole === "hider")[0];
  h2.hideProp = { dead: false };
  const before = h2.hideRole;
  h2.x = sk.x + 8; h2.y = sk.y;
  B.updateHide(1 / 60);
  check("躲在柜子里不会被贴身抓到", h2.hideRole === before, h2.hideRole);
  h2.hideProp = null;

  /* 时间到还有人没被抓 → 躲藏者赢 */
  B.state = "fight";
  B.hideTimeUp();
  check("时间到仍有躲藏者 → 躲藏者获胜",
    B.state === "roundEnd" && B.casualAlive().filter(f => f.hideRole === "hider").indexOf(list[B.roundWinner]) >= 0,
    B.state);
}

console.log("\n=== 6. 地板是岩浆 ===");
{
  const list = setupRule("lava", 4);
  const C = LD.LAVA;
  check("安全台已摆好", B.lava.pads.length === C.pads, B.lava.pads.length);
  check("开局平静期", B.lava.phase === "calm", B.lava.phase);

  /* 造一轮岩浆，把某人脚下的格子点亮（且他不在安全台上） */
  const f = list[0];
  f.x = 90; f.y = (B.world.pt || 110) + 60;
  const bad = B.lava.pads.find(p => !p.dead);
  if (bad && Math.abs(f.x - bad.x) < bad.w) f.x = 60;
  B.lava.phase = "hot"; B.lava.t = 5; B.lava.hot = {};
  B.lava.hot[B.lavaCell(f.x, f.y)] = 1;
  check("测试对象脚下是红格且不在安全台上", !B.lavaSafeAt(f.x, f.y, B.lava.hot));
  const hp0 = f.hp;
  /* 32 帧 ≈ 0.53 秒：跨过 0.5 秒的结算门槛（浮点累加会差一点点，30 帧刚好不够） */
  for (let i = 0; i < 32; i++) B.updateLava(1 / 60);
  check("站在红格上按 dps 持续掉血",
    hp0 - f.hp > 20 && hp0 - f.hp < C.dps, Math.round(hp0 - f.hp) + " 血");

  /* 站到安全台上就没事 */
  const pad = B.lava.pads.find(p => !p.dead);
  f.x = pad.x; f.y = pad.y;
  check("安全台上算安全", B.lavaSafeAt(f.x, f.y, B.lava.hot));
  const hp1 = f.hp;
  for (let i = 0; i < 30; i++) B.updateLava(1 / 60);
  check("站在安全台上不再掉血", f.hp === hp1, f.hp);

  /* 间歇期消失一个安全台 */
  B.lava.phase = "hot"; B.lava.t = 0; B.updateLava(1 / 60);
  check("进入间歇期", B.lava.phase === "gap", B.lava.phase);
  check("随机消失一个安全台", B.lava.pads.filter(p => p.dead).length === 1, B.lava.pads.filter(p => p.dead).length);
}

console.log("\n=== 7. 弹幕生存 ===");
{
  const list = setupRule("barrage", 4);
  const C = LD.BARRAGE;
  check("炮台已架好", B.barrage.turrets.length === C.turrets, B.barrage.turrets.length);
  check("开局没有子弹", B.barrage.bullets.length === 0);

  /* 手动打一发瞄准弹 */
  const t = B.barrage.turrets[0];
  const f = list[0];
  f.x = B.world.w / 2; f.y = (B.world.pt || 110) + (B.world.h - (B.world.pt || 110)) / 2;
  B.barrageFire(t, "aim");
  check("开火后子弹入列", B.barrage.bullets.length >= 2, B.barrage.bullets.length);

  /* 把一颗子弹直接塞到人身上 → 命中掉血 */
  const hp0 = f.hp;
  B.barrage.bullets.length = 0;
  B.barrage.bullets.push({ x: f.x - 4, y: f.y, vx: -200, vy: 0, ax: -1, ay: 0, life: 5, r: 9, hit: {} });
  B.updateBarrage(1 / 60);
  check("被弹幕命中掉 " + C.bulletDmg + " 血", Math.abs((hp0 - f.hp) - C.bulletDmg) < 1, hp0 + " → " + f.hp);
  check("命中后子弹消失", B.barrage.bullets.length === 0);

  /* 换模式 → 安全间隙 */
  B.barrage.modeT = 0; B.updateBarrage(1 / 60);
  check("换弹幕模式时有安全间隙", B.barrage.gap > 0, B.barrage.gap.toFixed(1) + "s");
  const n0 = B.barrage.bullets.length;
  for (let i = 0; i < 60; i++) B.updateBarrage(1 / 60);
  check("安全间隙内不开火", B.barrage.bullets.length <= n0, B.barrage.bullets.length);
}

console.log("\n=== 8. 冰面滑壶 ===");
{
  const list = setupRule("slide", 4);
  const C = LD.SLIDE;
  const f = list[0];
  check("得分区在场地中心", Math.abs(B.slide.zone.x - B.world.w / 2) < 1 && B.slide.zone.r === C.zoneR);
  check("冰面阻尼已放宽到 " + C.damp, code.indexOf("LD.SLIDE.damp || -0.55") >= 0);
  check("滑壶用加速度而不是直接位移", /this\.rule === "slide"[\s\S]{0,400}f\.vx \+= \(mx \/ n\) \* acc \* dt/.test(code));

  /* 站在得分区里加分 */
  f.x = B.slide.zone.x; f.y = B.slide.zone.y;
  const s0 = f.slideScore || 0;
  B.updateSlide(0.5);
  check("滑进得分区每秒加 " + C.scorePerSec + " 分", f.slideScore > s0 + C.scorePerSec * 0.4, f.slideScore.toFixed(1));

  /* 冰面惯性：给一个初速后不按键，人还会继续滑 */
  f.x = 300; f.y = B.world.h / 2; f.vx = 300; f.vy = 0;
  const x0 = f.x;
  B.updateHero(f, 1 / 60);
  check("松手后仍在滑行（惯性）", f.x - x0 > 4, (f.x - x0).toFixed(2) + "px");
  check("速度衰减很慢（冰面）", f.vx > 290, Math.round(f.vx));

  /* 互撞击退 */
  const g = list[1];
  f.x = 400; f.y = 400; f.vx = 320; f.vy = 0; f.knockLeft = 0;
  g.x = 400 + f.r + g.r; g.y = 400; g.vx = 0; g.vy = 0; g.knockLeft = 0;
  B.updateSlide(1 / 60);
  check("高速撞上对手会把对方撞飞", g.knockLeft > 0, Math.round(g.knockLeft));
}

console.log("\n=== 9. 渲染与人机不崩 ===");
{
  const rules = ["statue", "chair", "hide", "lava", "barrage", "slide"];
  let drawOk = true, aiOk = true;
  for (const r of rules) {
    const list = setupRule(r, 3);
    try {
      const ctx = makeCtx();
      B.draw(ctx);
      B.drawCasual(ctx);
    } catch (e) { drawOk = false; console.log("    绘制异常 " + r + "：" + e.message); }
    try {
      const f = list[0];
      f.bot = { conf: {}, foe: null, retargetT: 0 };
      for (let i = 0; i < 30; i++) if (LD.casualAI[r]) LD.casualAI[r](f, 1 / 60, f.ctrl);
    } catch (e) { aiOk = false; console.log("    人机异常 " + r + "：" + e.message); }
  }
  check("六个模式渲染都不崩", drawOk);
  check("六套人机逻辑都不崩", aiOk);
  check("六套人机都已注册", ["statue", "chair", "hide", "lava", "barrage", "slide"].every(r => typeof LD.casualAI[r] === "function"));
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
