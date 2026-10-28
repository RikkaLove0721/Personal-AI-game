/* 孤高旅斗 v4.11 烫手山芋测试
 * 覆盖：模式注册 / 参数 / 开局抽人与预警 / 山芋天降锁定 /
 *       接手 2 秒减速且无法传递 / 2 秒后提速 / 接触传递 /
 *       30 秒引信爆炸（持有者 75 / 范围 50）/ 爆炸后重新抽人 /
 *       禁用普攻技能大招 / 无道具包 / 阵亡复活 / AI 行为 / 渲染不崩
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
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(), loadout: BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  f.team = team == null ? -1 : team;
  return f;
}
function setupHot(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(mkHero(i, -1));
  B.setup({ mode: "duel", rule: "hotpotato", fighters: list, isHost: true, mySide: 0, matchT: 180,
    mapCfg: LD.mapCfg({ preset: "arena", seed: 7, ground: "stone" }) });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  /* 开局位置拉开，免得一开始就触发传递 */
  const w = B.world.w, top = B.world.pt || 0, cy = top + (B.world.h - top) / 2;
  list.forEach((f, i) => { f.x = 180 + i * (w - 360) / Math.max(1, list.length - 1 || 1); f.y = cy + (i % 2 ? 120 : -120); });
  /* 山芋的落点是在 resetRound 之后、这里把人拉开**之前**算的（potatoPickTarget
   * 里 st.y = 目标当时的 y - 300）。人一挪，山芋还停在旧坐标上，于是
   * 「还在高空」这条断言拿新 tgt.y 去比旧 st.y —— 两者本来就不在同一处，
   * 命中率只有五成左右（实测连跑 10 次挂 4 次）。
   * dt = 0 跑一帧只是让 warn 分支把坐标重新对齐到 tgt.y - 300，不推进倒计时。 */
  B.updateHotPotato(0);
  return list;
}
/** 把山芋直接塞到某人头上（跳过预警与天降） */
function giveTo(f) {
  const st = B.potato;
  st.phase = "held"; st.holder = f; st.holdT = 0; st.fuse = LD.HOTPOTATO.fuse; st.passLockT = 0;
  st.x = f.x; st.y = f.y - 62;
  return st;
}
const step = (n) => { for (let i = 0; i < n; i++) B.updateHotPotato(1 / 60); };

console.log("=== 1. 模式与参数 ===");
{
  const ri = LD.ruleInfo("hotpotato");
  check("「烫手山芋」已注册", ri.id === "hotpotato" && ri.name === "烫手山芋", ri.icon + " " + ri.name);
  const C = LD.HOTPOTATO;
  check("预警 3 秒", C.warn === 3.0, C.warn);
  check("接手减速 2 秒、降到 50%", C.slowT === 2.0 && C.slowMul === 0.5, C.slowT + "s / " + C.slowMul);
  check("减速后提速到 120%", C.boostMul === 1.2, C.boostMul);
  check("引信 30 秒", C.fuse === 30, C.fuse);
  check("持有者伤害 = 25 + 存活数 × 25", C.holderBase === 25 && C.holderPerAlive === 25,
    C.holderBase + " + n×" + C.holderPerAlive);
  check("余波伤害固定 50（不随人数变化）", C.splashDmg === 50, C.splashDmg);
  check("成就含「甩锅高手」", LD.ACHIEVEMENTS.some(a => a.id === "hotpotato_win"));
  check("称号含「甩锅高手」", LD.TITLES.some(t => t.ach === "hotpotato_win"));
}

console.log("\n=== 2. 开局：全员同队 + 抽人 + 预警 ===");
{
  const hs = setupHot(4);
  check("全员脱队（互不伤害）", hs.every(f => f.team === -1), hs.map(f => f.team).join(","));
  const st = B.potato;
  check("开局进入预警", st.phase === "warn", st.phase);
  check("已锁定第一个倒霉蛋", !!st.tgt && hs.indexOf(st.tgt) >= 0, st.tgt && st.tgt.name);
  check("预警倒计时 3 秒", Math.abs(st.t - 3.0) < 1e-6, st.t);
  /* 山芋从天上落下，开局应当在目标头顶上方至少 100px。
     注意用 <= ：目标要是恰好站在 y=1050 这种位置，950 正好等于 1050-100，
     原来的严格小于会随机挂（同一个随机种子 3 次里挂 1 次）。 */
  check("山芋此刻还在高空", st.y <= st.tgt.y - 100, Math.round(st.y));
  step(60);
  check("预警期不落芋", st.phase === "warn" && !st.holder, st.phase);
}

console.log("\n=== 3. 天降：3 秒后锁定飞到头上 ===");
{
  const hs = setupHot(3);
  const st = B.potato;
  step(180);                                  // warn 3 秒
  check("预警结束开始天降", st.phase === "fly" || st.phase === "held", st.phase);
  const tgt = st.tgt;
  step(60);                                   // fly 0.85 秒
  check("山芋落到锁定目标头上", st.phase === "held" && st.holder === tgt, st.phase);
  check("山芋挂在头顶", Math.abs(st.x - tgt.x) < 2 && Math.abs(st.y - (tgt.y - 62)) < 2,
    Math.round(st.x) + "," + Math.round(st.y));
  check("引信从 30 秒开始烧", Math.abs(st.fuse - 30) < 0.2, st.fuse.toFixed(2));
}

console.log("\n=== 4. 接手：2 秒减速 + 期间无法传递 ===");
{
  const hs = setupHot(3);
  const st = giveTo(hs[0]);
  const h = st.holder;
  step(1);
  check("接手即减速到 50%", Math.abs(h.hotMul - 0.5) < 1e-6, h.hotMul);
  /* 减速期里贴着别人也传不出去 */
  const o = hs[1];
  o.x = h.x + 30; o.y = h.y;
  step(30);
  check("减速期内传不出去", st.holder === h, st.holder && st.holder.name);
  check("减速期仍是 50% 移速", Math.abs(h.hotMul - 0.5) < 1e-6, h.hotMul);
}

console.log("\n=== 5. 减速结束后提速 120% ===");
{
  const hs = setupHot(3);
  const st = giveTo(hs[0]);
  const h = st.holder;
  /* 把别人挪远，避免提速前就被传走 */
  hs[1].x = 60; hs[1].y = B.world.h - 60;
  hs[2].x = B.world.w - 60; hs[2].y = B.world.h - 60;
  step(130);                                  // 2.17 秒 > slowT
  check("熬过 2 秒后提速到 120%", Math.abs(h.hotMul - 1.2) < 1e-6, h.hotMul);
  check("减速倍率不落在别人身上",
    hs[1].hotMul === 0 && hs[2].hotMul === 0, hs[1].hotMul + "/" + hs[2].hotMul);
}

console.log("\n=== 6. 传递：碰到就把山芋甩给他 ===");
{
  const hs = setupHot(3);
  const st = giveTo(hs[0]);
  const h = hs[0], o = hs[1];
  o.x = 60; o.y = 60;
  step(130);                                  // 先熬过减速期
  o.x = h.x + (h.r + o.r) + 20; o.y = h.y;    // 贴上来
  step(1);
  check("碰到就把山芋甩给他", st.holder === o, st.holder && st.holder.name);
  check("新持有者重新计时", st.holdT < 0.05, st.holdT.toFixed(3));
  step(1);
  check("新持有者同样吃减速", Math.abs(o.hotMul - 0.5) < 1e-6, o.hotMul);
  check("原持有者速度倍率已清空", h.hotMul === 0, h.hotMul);
  /* 传递冷却：刚传完不会立刻弹回去 */
  st.passLockT = 0.4;
  step(1);
  check("传递后有短暂冷却，不会来回弹", st.holder === o, st.holder && st.holder.name);
}

console.log("\n=== 7. 爆炸：持有者 75 / 范围 50 / 重新抽人 ===");
{
  const hs = setupHot(4);
  const st = giveTo(hs[0]);
  const h = hs[0], near = hs[1], far = hs[2];
  /* 一人贴着（在波及范围）、一人离得远 */
  near.x = h.x + 40; near.y = h.y;
  far.x = 80; far.y = B.world.h - 80;
  const h0 = h.hp, n0 = near.hp, f0 = far.hp;
  st.fuse = 0.005;
  step(1);
  check("引信烧完即爆炸（4 人存活 → 持有者 -125）", h.hp === Math.max(0, h0 - 125), h0 + " → " + h.hp);
  check("范围内其他人 -50", near.hp === Math.max(0, n0 - 50), n0 + " → " + near.hp);
  check("范围外的人不受影响", far.hp === f0, f0 + " → " + far.hp);
  check("爆炸后重新抽人", st.phase === "warn" && !!st.tgt, st.phase);
  check("爆炸后进入新一轮", st.round >= 2, st.round);
}

console.log("\n=== 7b. v4.12 引信逐轮递减（30 → 25 → 20 → 15 固定）===");
{
  const C = LD.HOTPOTATO;
  check("配置：每轮 −5 秒、下限 15 秒", C.fuseStep === 5 && C.fuseMin === 15,
    C.fuseStep + " / " + C.fuseMin);

  const hs = setupHot(4);
  const st = B.potato;
  check("第 1 轮引信 30 秒", st.round === 1 && st.fuse === 30, st.round + " → " + st.fuse);

  /* 每轮直接把引信烧到爆炸，看下一轮抽到的引信值 */
  const seq = [];
  for (let r = 0; r < 4; r++) {
    giveTo(hs[0]);
    st.holder.maxHp = 99999; st.holder.hp = 99999;   // 别炸死，保证能继续抽人
    st.fuse = 0.005;
    step(1);
    seq.push(st.fuse);
  }
  check("第 2 轮 25 秒", seq[0] === 25, seq[0]);
  check("第 3 轮 20 秒", seq[1] === 20, seq[1]);
  check("第 4 轮 15 秒", seq[2] === 15, seq[2]);
  check("第 5 轮仍 15 秒（触底固定）", seq[3] === 15, seq[3]);
}

console.log("\n=== 7c. v4.12 持有者伤害随存活人数（25 + n×25）===");
{
  /** 让 n 人局炸一次，返回持有者实际掉的血 */
  const dmgOf = (n) => {
    const hs = setupHot(n);
    const st = giveTo(hs[0]);
    const h = hs[0];
    h.maxHp = 99999; h.hp = 99999;
    st.fuse = 0.005;
    step(1);
    return 99999 - h.hp;
  };
  const d2 = dmgOf(2), d4 = dmgOf(4), d6 = dmgOf(6);
  check("2 人存活 → -75", d2 === 75, d2);
  check("4 人存活 → -125", d4 === 125, d4);
  check("6 人存活 → -175", d6 === 175, d6);

  /* 余波固定：5 人局里贴着的人仍然只吃 50 */
  const hs = setupHot(5);
  const st = giveTo(hs[0]);
  const h = hs[0], near = hs[1];
  h.maxHp = 99999; h.hp = 99999;
  near.maxHp = 99999; near.hp = 99999;
  near.x = h.x + 40; near.y = h.y;
  st.fuse = 0.005;
  step(1);
  check("余波不随人数变化（5 人局仍是 -50）", 99999 - near.hp === 50, 99999 - near.hp);
}

console.log("\n=== 8. 禁用普攻 / 技能 / 大招 ===");
{
  const hs = setupHot(3);
  const st = giveTo(hs[0]);
  const h = hs[0];
  const ctrl = h.ctrl;
  ["basic", "skill1", "skill2", "ult"].forEach(slot => {
    ctrl.press = {}; ctrl.press[slot] = true;
    B.trySlot(h, slot, ctrl);
  });
  check("普攻被禁用", !h.slot.basic.on);
  check("K 技能被禁用", !h.slot.skill1.on);
  check("L 技能被禁用", !h.slot.skill2.on);
  check("大招被禁用", !h.slot.ult.on);
  /* 换到别的模式仍可用，确认拦截没有误伤全局 */
  const hs2 = setupHot(3);
  B.rule = "brawl";
  const f2 = hs2[1];
  f2.ctrl.press = { basic: true };
  const cd0 = f2.cd.basic || 0;
  B.trySlot(f2, "basic", f2.ctrl);
  check("其它模式不受影响（普攻照常生效）", (f2.cd.basic || 0) > cd0, (f2.cd.basic || 0).toFixed(2));
  B.rule = "hotpotato";
}

console.log("\n=== 9. 道具包：本模式不掉 ===");
{
  const hs = setupHot(3);
  check("packAllowed 对本模式为 false", B.packAllowed() === false);
  B.pickups = [];
  B.dropPickup(400, 400, "energy");
  check("强制掉 energy 也被拦下", B.pickups.length === 0, B.pickups.length);
}

console.log("\n=== 10. 阵亡复活 ===");
{
  const hs = setupHot(3);
  const st = giveTo(hs[0]);
  const h = hs[0];
  B.kill(h, null, { type: "env" });
  check("阵亡后不立即结算", B.state !== "over", B.state);
  check("复活计时 3 秒", Math.abs(h.respawnT - 3.0) < 1e-6, h.respawnT);
  check("持有者阵亡后重新抽人", st.holder !== h, st.phase);
  for (let i = 0; i < 200; i++) B.updateRespawn(1 / 60);
  check("3 秒后复活", h.dead === false && h.hp === h.maxHp, "hp=" + h.hp);
}

console.log("\n=== 11. AI：远离山芋 / 持有者追人 ===");
{
  /* 只让一个人当 AI，其余原地不动，方便观察位移方向。
   * 注意顺序：AI 由 90_boot 主循环驱动——先 tickHero 写 ctrl，再 B.update 应用移动，
   * B.update 自己不跑 AI，所以测试里必须手搓这个顺序。 */
  const stepAI = (f, n) => { for (let i = 0; i < n; i++) { LD.AI.tickHero(f, 1 / 60); B.update(1 / 60); } };
  const hs = setupHot(4);
  const h = hs[0];
  giveTo(h);
  const bot = hs[2];
  LD.AI.mkBot(bot, "normal");
  const d0 = Math.hypot(bot.x - h.x, bot.y - h.y);
  LD.AI.tickHero(bot, 1 / 60);
  check("AI 这一帧确实输出了方向", Math.hypot(bot.ctrl.mx, bot.ctrl.my) > 0.5,
    Math.round(bot.ctrl.mx * 100) / 100 + "," + Math.round(bot.ctrl.my * 100) / 100);
  stepAI(bot, 60);
  const d1 = Math.hypot(bot.x - h.x, bot.y - h.y);
  check("没拿芋头的人往远处跑", d1 > d0, Math.round(d0) + " → " + Math.round(d1));

  /* 换 AI 来持有：朝最近的人扑过去 */
  const hs2 = setupHot(4);
  const bot2 = hs2[1];
  const st2 = giveTo(bot2);
  LD.AI.mkBot(bot2, "normal");
  const tgt = hs2[3];
  tgt.x = bot2.x + 400; tgt.y = bot2.y;
  hs2[0].x = 60; hs2[0].y = 60;
  hs2[2].x = B.world.w - 60; hs2[2].y = B.world.h - 60;
  st2.holdT = 5;                              // 已熬过减速期，可以传
  const e0 = Math.hypot(bot2.x - tgt.x, bot2.y - tgt.y);
  stepAI(bot2, 60);                           // 1 秒：够靠近但还不够贴上（passR 44）
  const e1 = Math.hypot(bot2.x - tgt.x, bot2.y - tgt.y);
  check("拿着芋头的人去追人甩锅", e1 < e0 - 100, Math.round(e0) + " → " + Math.round(e1));
  check("追的过程中锅还在自己手上", B.potato.holder === bot2, B.potato.holder && B.potato.holder.name);
}

console.log("\n=== 12. 渲染层不崩 ===");
{
  const hs = setupHot(4);
  const ctx = makeCtx();
  let err = null;
  try {
    B.potato.phase = "warn"; B.draw(ctx);
    B.potato.phase = "fly"; B.draw(ctx);
    giveTo(hs[0]); B.draw(ctx);
    B.potato.fuse = 3; B.draw(ctx);
  } catch (e) { err = e; }
  check("预警 / 天降 / 持有 / 临爆四个阶段都能画", !err, err ? err.message : "ok");
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
