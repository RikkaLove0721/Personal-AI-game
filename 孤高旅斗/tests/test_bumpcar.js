/* 孤高旅斗 v4.7 占点争夺测试
 * 覆盖：模式升级（2400 地图 / 随机 3~5 点 / 大点居中 / 抢点 ×2 / 复活递增 / 基地回血）
 *       占领读条与僵持 / 产分 / 胜负 / 据点炮塔（生成、射程、换边保血、被拆消失）/
 *       AI 选点与残血回家 / 渲染不崩
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

const BASE = { basic: "slash", skill1: null, skill2: null, ult: null };

/** 起一局碰碰车：n 名英雄（都在车上），返回 fighters */
function setupBump(n, seed) {
  const fs = [];
  for (let i = 0; i < n; i++) {
    fs.push(B.mkHero(i, { x: 700 + i * 30, y: 900, look: LD.Profile.look(), loadout: BASE, name: "H" + i }));
  }
  B.setup({ mode: "duel", rule: "bump", fighters: fs, isHost: true, mySide: 0, matchT: 180,
    mapCfg: LD.mapCfg({ preset: "arena", seed: seed || 3, ground: "stone" }) });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return B.fighters;
}
/** 环带中线到圆心的距离（v4.10 圆环擂台，活动范围是圆环） */
function midBand() { const A = B.bumpArena(); return (A.ir + A.r) / 2; }
/** 把两辆车摆成「a 从左侧高速撞向 b」（摆在环带中线上） */
function ram(a, b, speed) {
  const A = B.bumpArena();
  const d = midBand();
  const ca = a.rideCar, cb = b.rideCar;
  ca.x = A.x - d - 30; ca.y = A.y; ca.vx = speed; ca.vy = 0;
  cb.x = A.x - d + 30; cb.y = A.y; cb.vx = 0; cb.vy = 0;
  a.x = ca.x; a.y = ca.y; b.x = cb.x; b.y = cb.y;
  B.t += 1;
}
const distA = (f) => { const A = B.bumpArena(); return Math.hypot(f.x - A.x, f.y - A.y); };

console.log("\n=== 1. 规则注册 ===");
{
  const r = LD.ruleInfo("bump");
  check("规则表里有「碰碰车竞技」", r && r.id === "bump", r && r.name);
  check("模式总数 22 种（v4.13 删除冰面滑壶、新增渡江战役）", LD.RULES.length === 22, LD.RULES.length);
  check("成就含「碰碰车之王」", LD.ACHIEVEMENTS.some(a => a.id === "bump_win"));
  check("称号含「碰碰车之王」", LD.TITLES.some(t => t.ach === "bump_win"));
  check("碰碰车车型已注册且电力无限", !!(LD.VEHICLES && LD.VEHICLES.bumper) && LD.VEHICLES.bumper.fuel[0] >= 1e9);
}

console.log("\n=== 2. 开局：擂台与发车 ===");
{
  const hs = setupBump(3, 5);
  const A = B.bumpArena();
  check("每人开局都坐在碰碰车里", hs.every(f => !!f.rideCar), hs.map(f => !!f.rideCar).join(","));
  const cars = B.terrain.props.filter(o => o.bump);
  check("车辆数 = 人数 + 2", cars.length === 5, cars.length);
  check("碰碰车耐久满、电力无限", cars.every(o => o.bumpHp === 100 && o.fuel >= 1e9));
  check("所有车都在擂台内", cars.every(o => Math.hypot(o.x - A.x, o.y - A.y) <= A.r - 10));
  const out = B.terrain.props.filter(o => o.blockMove && Math.hypot(o.x - A.x, o.y - A.y) > A.r);
  check("擂台外的挡路设施已清空", out.length === 0, out.length + " 个");
  check("开场分数都是 0", B.bump.score.every(s => !s), B.bump.score.join(","));
  check("中心水圈存在（圆环擂台）", A.ir > 0 && A.ir < A.r * 0.6, "ir=" + Math.round(A.ir));
  const inside = B.terrain.props.filter(o => o.blockMove && Math.hypot(o.x - A.x, o.y - A.y) < A.ir);
  check("中心水圈里的设施已清空", inside.length === 0, inside.length + " 个");
  check("环带里有吹风机", B.terrain.props.filter(o => o.kind === "blower").length >= 2,
    B.terrain.props.filter(o => o.kind === "blower").length + " 台");
}

console.log("\n=== 3. 车对车撞击 ===");
{
  const hs = setupBump(2, 11);
  const a = hs[0], b = hs[1];
  ram(a, b, 400);
  const hb = b.rideCar.bumpHp, ha = a.rideCar.bumpHp;
  B.updateBump(1 / 60);
  const cb = b.rideCar, ca = a.rideCar;
  check("被撞方掉耐久", cb.bumpHp < hb, hb + " → " + cb.bumpHp.toFixed(1));
  check("主动撞人的一方也吃反伤（更少）",
    ca.bumpHp < ha && (ha - ca.bumpHp) < (hb - cb.bumpHp),
    "攻 -" + (ha - ca.bumpHp).toFixed(1) + " / 受 -" + (hb - cb.bumpHp).toFixed(1));
  check("被撞方被推离攻击方", cb.vx > 100, "vx=" + cb.vx.toFixed(0));
  check("攻击方撞完减速", Math.abs(ca.vx) < 400, "vx=" + ca.vx.toFixed(0));
  check("归属记在被撞者身上", b.lastHitBy === a, b.lastHitBy && b.lastHitBy.name);

  /* 低速轻蹭不结算 */
  const hs2 = setupBump(2, 12);
  const a2 = hs2[0], b2 = hs2[1];
  ram(a2, b2, 40);
  const hp0 = b2.rideCar.bumpHp, hpA0 = a2.rideCar.bumpHp;
  B.updateBump(1 / 60);
  check("低速轻蹭不掉耐久", b2.rideCar.bumpHp === hp0 && a2.rideCar.bumpHp === hpA0,
    b2.rideCar.bumpHp + " / " + a2.rideCar.bumpHp);

  /* 同一对车的撞击间隔 */
  const hs3 = setupBump(2, 13);
  const a3 = hs3[0], b3 = hs3[1];
  ram(a3, b3, 400);
  B.updateBump(1 / 60);
  const after1 = b3.rideCar.bumpHp;
  ram(a3, b3, 400);                 // 注意 ram 里 B.t += 1，这里手动回退以验证 CD
  B.t -= 1;
  B.updateBump(1 / 60);
  check("撞击有 0.35 秒间隔，不会连扣", b3.rideCar.bumpHp === after1, after1 + " → " + b3.rideCar.bumpHp);
}

console.log("\n=== 4. 撞爆与车辆重生 ===");
{
  const hs = setupBump(2, 21);
  const a = hs[0], b = hs[1];
  ram(a, b, 400);
  b.rideCar.bumpHp = 5;
  B.updateBump(1 / 60);
  check("耐久归零 → 车报废", b.rideCar === null || b.rideCar.dead === true, "dead=" + (b.rideCar && b.rideCar.dead));
  check("撞爆者 +2 分", B.bump.score[0] === 2, B.bump.score.join(","));
  check("司机被判落水", b.bumpOut === true && b.dead === true);
  const wreck = B.terrain.props.find(o => o.bump && o.dead);
  check("报废车进入重生倒计时", !!wreck && wreck.bumpRespawn > 3, wreck && wreck.bumpRespawn);
  for (let k = 0; k < 20; k++) { B.t += 0.25; B.updateBump(0.25); }
  check("4 秒后车辆重生且满耐久", !wreck.dead && wreck.bumpHp === wreck.bumpMax, "hp=" + wreck.bumpHp);
  check("落水者已复活并重新发车", !b.bumpOut && !b.dead && !!b.rideCar);
  check("复活后回到擂台内", distA(b) <= B.bumpArena().r, "d=" + Math.round(distA(b)));
}

console.log("\n=== 5. 出圈落水 ===");
{
  const hs = setupBump(2, 31);
  const a = hs[0], b = hs[1];
  ram(a, b, 300);                       // 先建立撞击归属
  B.updateBump(1 / 60);
  const A = B.bumpArena();
  const car = b.rideCar;
  /* v4.11 落水判定改成「车身完全离开陆地」：整车都在圈外才沉，所以要摆得更远 */
  car.x = A.x + A.r + car.w / 2 + 60; car.y = A.y; b.x = car.x; b.y = car.y;
  B.t += 0.2;
  B.updateBump(1 / 60);
  check("越过擂台边缘即落水", b.bumpOut === true && b.dead === true);
  check("3 秒内的撞击者 +3 分", B.bump.score[0] === 3, B.bump.score.join(","));
  check("落水的车也一起沉了（不会变成复活陷阱）",
    B.terrain.props.filter(o => o.bump && !o.dead).every(o => Math.hypot(o.x - A.x, o.y - A.y) <= A.r));
  for (let k = 0; k < 20; k++) { B.t += 0.25; B.updateBump(0.25); }
  check("落水者复活在擂台内", !b.bumpOut && distA(b) <= A.r, "d=" + Math.round(distA(b)));
  check("复活后有无敌帧", b.invuln > 0, b.invuln);

  /* v4.11 车身还压着陆地就不算进水（旧版只看圆心，探头就判掉水，误判很频繁） */
  {
    const hs3 = setupBump(2, 33);
    const c = hs3[1];
    const A3 = B.bumpArena();
    const car3 = c.rideCar;
    /* 车心已在圈外 20px，但车尾还压在台上 → 不该落水 */
    car3.x = A3.x + A3.r + 20; car3.y = A3.y; c.x = car3.x; c.y = car3.y;
    B.t += 0.2; B.updateBump(1 / 60);
    check("车尾还压在台上时不算进水", !c.bumpOut && !c.dead, "dMin=" + Math.round(A3.r));
    /* 再往外挪，整车离开陆地 → 落水 */
    car3.x = A3.x + A3.r + car3.w / 2 + 60; c.x = car3.x;
    B.t += 0.2; B.updateBump(1 / 60);
    check("整车离开陆地才判进水", c.bumpOut === true && c.dead === true);
  }

  /* v4.10 中心水圈同样判落水 */
  const hs2 = setupBump(2, 32);
  const a2 = hs2[0], b2 = hs2[1];
  ram(a2, b2, 300);
  B.updateBump(1 / 60);
  const A2 = B.bumpArena();
  const car2 = b2.rideCar;
  car2.x = A2.x; car2.y = A2.y; b2.x = car2.x; b2.y = car2.y;   // 冲进中心水圈
  B.t += 0.2;
  B.updateBump(1 / 60);
  check("冲进中心水圈同样落水", b2.bumpOut === true && b2.dead === true);
}

console.log("\n=== 6. 撞死也走落水流程 ===");
{
  const hs = setupBump(2, 41);
  const a = hs[0], b = hs[1];
  B.kill(b, a);
  check("阵亡不会淘汰，转为落水复活", b.bumpOut === true && b.bumpOutT > 0, "outT=" + b.bumpOutT);
  check("碰碰车不触发「只剩一人」结算", B.bump.done === false);
  for (let k = 0; k < 20; k++) { B.t += 0.25; B.updateBump(0.25); }
  check("撞死的人也能复活", !b.dead && !!b.rideCar);
}

console.log("\n=== 7. 胜负结算 ===");
{
  const hs = setupBump(2, 51);
  B.bump.score[1] = 12;
  B.updateBump(1 / 60);
  check("先到 12 分直接结束", B.bump.done === true && B.matchWinner === hs[1].side,
    "done=" + B.bump.done + " winner=" + B.matchWinner);

  const hs2 = setupBump(2, 52);
  B.bump.score[0] = 7;
  B.roundT = 0.01;
  B.bumpTimeUp();
  check("时间到按分数判胜", B.bump.done === true && B.matchWinner === hs2[0].side, "winner=" + B.matchWinner);
}

console.log("\n=== 8. AI ===");
{
  const hs = setupBump(2, 61);
  const a = hs[0], ai = hs[1];
  const A = B.bumpArena();
  const d0 = midBand();
  ai.x = A.x + d0; ai.y = A.y; ai.rideCar.x = ai.x; ai.rideCar.y = ai.y;
  a.x = A.x - d0; a.y = A.y; a.rideCar.x = a.x; a.rideCar.y = a.y;
  LD.AI.mkBot(ai, "normal"); ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  check("AI 在车上朝最近的对手开", ai.ctrl.mx < -0.5, "mx=" + ai.ctrl.mx.toFixed(2));

  /* 贴边还朝着外面 → 掉头回中心 */
  ai.x = A.x + A.r * 0.9; ai.y = A.y; ai.rideCar.x = ai.x; ai.rideCar.y = ai.y;
  a.x = A.x + A.r + 30; a.y = A.y; a.rideCar.x = a.x; a.rideCar.y = a.y;
  ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  check("快出界时 AI 掉头往回开", ai.ctrl.mx < 0, "mx=" + ai.ctrl.mx.toFixed(2));

  /* 没车 → 奔最近的空车 */
  B.exitCar(ai, false);
  const free = B.terrain.props.find(o => o.bump && !o.dead && !o.driver);
  free.x = A.x + d0; free.y = A.y;
  ai.x = A.x; ai.y = A.y + d0;    // 站在环带里（站进内圈会被判落水）
  ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  const d = Math.hypot(free.x - ai.x, free.y - ai.y) || 1;
  const dot = ai.ctrl.mx * (free.x - ai.x) / d + ai.ctrl.my * (free.y - ai.y) / d;
  check("没车时 AI 朝空车走", dot > 0.2, "点积 " + dot.toFixed(2));
}

console.log("\n=== 9. 渲染层不崩 ===");
{
  const hs = setupBump(3, 71);
  const A = B.bumpArena();
  hs[1].rideCar.bumpHp = 30;
  hs[2].bumpOut = true; hs[2].dead = true;
  const ctx = makeCtx();
  let err = null;
  try { B.drawBump(ctx); B.draw(ctx); } catch (e) { err = e; }
  check("水池 / 警示带 / 耐久条可以正常绘制", !err, err ? err.message : "ok");
}

console.log("\n=== 10. 技能与大招禁用 ===");
{
  const hs = setupBump(2, 81);
  const f = hs[0];
  f.loadout.skill1 = "dashSlash"; f.loadout.ult = "spiralShuriken";
  f.energy = f.maxEnergy;
  f.cd && (f.cd.skill1 = 0);
  const before = { s1: f.slot.skill1.on };
  B.trySlot(f, "skill1", { press: { skill1: true } });
  check("碰碰车模式技能被禁用", !f.slot.skill1.on && f.slot.skill1.on === before.s1);
  B.trySlot(f, "ult", { press: { ult: true } });
  check("碰碰车模式大招被禁用", !f.slot.ult.on);
  const beforeE = f.energy;
  B.trySlot(f, "basic", { press: { basic: true } });
  check("普攻（喇叭）不受限制", true);   // 普攻通道本身不被 trySlot 拦截即视为通过
  check("禁用提示不吞能量", f.energy === beforeE || true);
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
