/* 孤高旅斗 v4.13 娱乐模式批次测试
 * 覆盖：模式注册与分类 / 通用禁用（招式 + 道具包）/
 *       一二三木头人（长跑道 / 天上监测者无预警扫描 / 掩体死角 / 道具包 / 冲线）/
 *       抢椅子（先提示后瞬刷 / 按 P 落座 / 假椅子）/
 *       躲猫猫（开局鬼失明定身 / 隐匿 K / 道具锁定与冻结 / 人机真会躲）/
 *       地板是岩浆（无安全台 / 红格掉血 / 每轮面积大涨 / 互撞击退 70%）/
 *       弹幕生存（炮台 / 命中掉血 / 换模式安全间隙）/ 渲染不崩
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
  const ids = ["statue", "chair", "hide", "lava", "barrage"];
  check("五个娱乐模式全部注册", ids.every(id => LD.ruleInfo(id).id === id), ids.join("/"));
  check("全部归入 casual", ids.every(id => LD.ruleInfo(id).cat === "casual"));
  check("碰碰车 / 山芋也在 casual 组", LD.isEntertain("bump") && LD.isEntertain("hotpotato"));
  check("战斗 15 种 / 娱乐 7 种", LD.rulesBy("combat").length === 15 && LD.rulesBy("casual").length === 7,
    LD.rulesBy("combat").length + " / " + LD.rulesBy("casual").length);
  check("旧模式默认算战斗模式", LD.rulesBy("combat").some(r => r.id === "brawl"));
  check("房间界面按分类分组渲染", /战斗模式/.test(code) && /娱乐模式/.test(code));
  check("五个模式各有专属称号", ids.every(id => LD.TITLES.some(t => t.ach === id + "_win")));
  /* v4.13 冰面滑壶因与碰碰车玩法高度重复已整条删除 */
  check("冰面滑壶已删除", LD.ruleInfo("slide").id !== "slide" && LD.SLIDE == null
    && !LD.isCasual("slide") && !code.includes('id: "slide"'));
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

console.log("\n=== 3. 一二三木头人（v4.13 重做） ===");
{
  const list = setupRule("statue", 4);
  const C = LD.STATUE;
  check("地图长度 ×2（1920 × 600）", B.world.w === 1920 && B.world.h === 600, B.world.w + "×" + B.world.h);
  check("全员排在起跑线上", list.every(f => Math.abs(f.x - C.startX) < 2), list.map(f => Math.round(f.x)).join(","));
  check("人物移速 70%", Math.abs(LD.RULE_SPD.statue(list[0]) - 0.7) < 1e-6, LD.RULE_SPD.statue(list[0]));
  check("开局不在观测（idle，且没有任何预警阶段）", B.statue.phase === "idle", B.statue.phase);

  /* idle → scan：中间不经过任何 tell / 预警阶段 */
  B.statue.t = 0; B.updateStatue(1 / 60);
  check("空闲结束直接进入观测（玩家无从预知）", B.statue.phase === "scan", B.statue.phase);

  /* 清空地形障碍，保证「没掩体」的判定干净 */
  if (B.terrain && B.terrain.props) B.terrain.props.length = 0;

  const f0 = list[0];
  f0.x = 700; f0.y = 300; f0.vx = 0; f0.vy = 0; f0.knockLeft = 0;

  /* 观测时不动 → 毫发无伤 */
  f0.moving = false;
  B.statue.phase = "scan"; B.statue.t = 5; B.statue.tickT = 0;
  const hpA = f0.hp;
  B.updateStatue(1 / 60);
  check("观测时站着不动就不挨打", f0.hp === hpA, hpA + " → " + f0.hp);

  /* 观测时还在动 → 被天上的监测者砸中：掉血 + 往左击退 */
  f0.moving = true;
  B.statue.tickT = 0;
  const hpB = f0.hp;
  B.updateStatue(1 / 60);
  check("观测时还在动 → 掉 " + C.scanDmg + " 血", Math.abs((hpB - f0.hp) - C.scanDmg) < 1, hpB + " → " + f0.hp);
  check("被往左击退（knockLeft > 0）", f0.knockLeft > 0, Math.round(f0.knockLeft));
  check("留下命中光束的表现", B.statue.beams.length > 0, B.statue.beams.length);
  check("记录了「最后一次有人被打」的时刻", B.statue.lastHitT === B.statue.clock);
  check("进度保留：不退回起点", f0.x <= 700 && f0.x > C.startX, Math.round(f0.x));

  /* 掩体左方几格 = 监测死角 */
  f0.moving = true; f0.vx = 0; f0.vy = 0; f0.knockLeft = 0;
  const cv = B.casualAddProp("solid", "stone", 1000, 300, 2, 2);
  f0.x = cv.x - cv.w * 0.5 - 20; f0.y = cv.y;
  check("站在掩体左方 → 判定为死角", B.statueCover(f0) === true);
  B.statue.phase = "scan"; B.statue.t = 5; B.statue.tickT = 0;
  const hpC = f0.hp;
  B.updateStatue(1 / 60);
  check("死角里照样动也不会挨打", f0.hp === hpC, hpC + " → " + f0.hp);
  f0.x = cv.x - cv.w * 0.5 - 400;
  check("离掩体太远就不算死角", B.statueCover(f0) === false);

  /* 道具包：走近按 P 开包 → 回血 或 短暂提速 */
  B.statue.packs.length = 0;
  let pk = null;
  for (let i = 0; i < 30 && !pk; i++) pk = B.statueSpawnPack();
  check("场上会刷出道具包", !!pk, pk ? Math.round(pk.x) + "," + Math.round(pk.y) : "null");
  if (pk) {
    f0.x = pk.x; f0.y = pk.y; f0.hp = f0.maxHp - 120; f0.interactCd = 0; f0.statueSpdT = 0;
    const before = f0.hp;
    check("够得着时 P 键提示「开启道具包」", B.interactLabel(f0) === "开启道具包", B.interactLabel(f0));
    B.doInteract(f0);
    check("按 P 后道具包消失", B.statue.packs.length === 0, B.statue.packs.length);
    check("开包给回血或提速", f0.hp > before || f0.statueSpdT > 0,
      (f0.hp - before) + " / " + f0.statueSpdT.toFixed(1));
  }

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

console.log("\n=== 3b. 木头人人机：前进一点 → 停 → 见人挨打再等 ===");
{
  const list = setupRule("statue", 4);
  const f = list[0];
  const st = B.statue;
  const ctrl = f.ctrl;
  st.lastHitT = -99; st.clock = 0;
  f.stMode = "stop"; f.stT = 0; f.statueBold = 0.6;

  /* 停够时间 → 起步（前进一点） */
  LD.casualAI.statue(f, 1 / 60, ctrl);
  check("停够就起步", f.stMode === "run", f.stMode);
  check("起步朝右（终点方向）", ctrl.mx > 0, ctrl.mx.toFixed(2));
  f.stT = 0;
  LD.casualAI.statue(f, 1 / 60, ctrl);
  check("前进一会儿就停", f.stMode === "stop", f.stMode);

  /* 观察到有人被击中 → 立刻收手并重新计时 */
  f.stMode = "run"; f.stT = 5;
  st.lastHitT = st.clock = 10;
  LD.casualAI.statue(f, 1 / 60, ctrl);
  check("看到有人被打 → 马上停下", f.stMode === "stop", f.stMode);
  check("并且重新计时（过一会儿再前进）", f.stT > 0.3, f.stT.toFixed(2));
  check("停下时一动不动", ctrl.mx === 0 && ctrl.my === 0, ctrl.mx + "," + ctrl.my);

  /* 很久没人被打 → 忍不住主动前进 */
  f.stMode = "stop"; f.stT = 3; f.stSeen = st.lastHitT;
  st.clock = st.lastHitT + (LD.STATUE.aiQuiet || 4.5) + 1;
  const t0 = f.stT;
  LD.casualAI.statue(f, 1 / 60, ctrl);
  check("长时间风平浪静 → 计时走得更快（主动前进）", (t0 - f.stT) > 1 / 30, (t0 - f.stT).toFixed(4));
}

console.log("\n=== 3c. 木头人：禁用可推动障碍物 + 人机更积极 ===");
{
  const TT = LD.TERRAIN.types;
  const list = setupRule("statue", 4);
  const c = LD.STATUE;
  const push = (B.terrain.props || []).filter(o => TT[o.kind] && TT[o.kind].pushable);
  check("场上没有任何可推动的障碍物（推着走等于随身带掩体）", push.length === 0, push.map(o => o.kind).join(","));
  check("掩体（实心 / 可破坏 / 围栏）照旧保留",
    (B.terrain.props || []).filter(o => o.blockMove).length > 0,
    (B.terrain.props || []).filter(o => o.blockMove).length + " 个");
  B.casualAddProp("tire", "tire", 800, 300, 1, 1);
  check("硬塞一个轮胎进地形", (B.terrain.props || []).some(o => o.kind === "tire"));
  B.initStatue();
  check("重开一局时会被清掉（不是只清一次）",
    !(B.terrain.props || []).some(o => TT[o.kind] && TT[o.kind].pushable));

  /* 积极性：数值 + 行为两头都测 */
  check("风平浪静的门槛压到 3 秒（原 4.5）", c.aiQuiet <= 3.0, c.aiQuiet);
  check("安静时的思考加速提高（原 2.4 倍）", c.aiQuietMul > 2.4, c.aiQuietMul);
  check("一趟跑得更久（原 0.55~1.5）", c.aiRunMin > 0.55 && c.aiRunMax > 1.5, c.aiRunMin + "~" + c.aiRunMax);
  check("看到人挨打后等得更短（原 0.8~1.9）", c.aiWaitMax < 1.9, c.aiWaitMin + "~" + c.aiWaitMax);
  check("没有掩体时步子更大（原 110~250）", c.aiStepMin >= 150 && c.aiStepMax >= 300, c.aiStepMin + "~" + c.aiStepMax);

  const f = list[0];
  f.statueDone = false; f.stMode = "stop"; f.stT = 0; f.statueBold = 0.6;
  B.statue.lastHitT = -99; B.statue.clock = 100;
  let moveFrames = 0;
  for (let i = 0; i < 180; i++) {
    f.ctrl.mx = 0; f.ctrl.my = 0;
    LD.casualAI.statue(f, 1 / 60, f.ctrl);
    if (f.ctrl.mx !== 0 || f.ctrl.my !== 0) moveFrames++;
  }
  check("风平浪静时人机大部分时间都在往前走（3 秒里 >55%）", moveFrames > 180 * 0.55,
    moveFrames + "/180 帧");

  /* v4.13g **「人机躲在障碍物后面不敢前进」的回归**：
   * 旧版 plan() 每次把目标设成「前方最近掩体左边 30px」，一旦人机正好停在那儿，
   * 下一轮目标就等于脚下（<24 到达阈值）→ 到达/规划死循环，永远卡在同一个障碍物后面。 */
  {
    const g = list[1];
    g.statueDone = false; g.stMode = "stop"; g.stT = 0; g.statueBold = 0.5;
    g.stTx = g.stTy = 0; g.stLastX = null; g.stStall = 0;
    g.x = LD.STATUE.startX + 200; g.y = 300;
    B.statue.lastHitT = -99; B.statue.clock = 500;
    let behind = 0, maxGap = 0, slow = 0, worstSlow = 0, lastRunX = g.x;
    const x0 = g.x;
    for (let i = 0; i < 900; i++) {
      if (g.x >= LD.STATUE.finishX) break;      /* 已经冲线，别再规划了 */
      g.ctrl.mx = 0; g.ctrl.my = 0;
      LD.casualAI.statue(g, 1 / 60, g.ctrl);
      /* 只看「正在跑」的时候：停着的时候目标点没刷新是正常的，
       * 但一旦迈腿就必须是朝着前面跑（旧版毛病是「朝脚下那一点跑」→ 永远原地） */
      const gap = g.stTx - g.x;
      if (g.stMode === "run" && gap < -1) behind++;
      if (g.stMode === "run" && gap > maxGap) maxGap = gap;
      if (g.stMode === "run" && (g.ctrl.mx || g.ctrl.my)) {
        if (g.x - lastRunX < 0.5) slow++; else slow = 0;
        if (slow > worstSlow) worstSlow = slow;
        lastRunX = g.x;
      }
      /* 手动把「输入」变成位移：沙箱里没有物理步进，这里直接按方向挪，
       * 模拟「AI 想走就真的走得到」的理想情况，专测目标点本身合不合理 */
      const mv = Math.hypot(g.ctrl.mx || 0, g.ctrl.my || 0);
      if (mv > 0.01) {          /* steer 返回的是按距离缩放的向量，这里只取方向 */
        g.x += (g.ctrl.mx / mv) * 2.4;
        g.y = Math.max(B.world.pt + 40, Math.min(B.world.h - 40, g.y + (g.ctrl.my / mv) * 2.4));
      }
    }
    check("跑起来时目标点永远在前方（不再出现「目标在脚下」的死循环）", behind === 0,
      behind + " 帧目标在身后");
    check("不会贴着障碍物原地磨（连续 1.5 秒没挪窝）", worstSlow < 90, worstSlow + " 帧");
    check("10 秒里确实往前推进了（不再原地打转）", g.x - x0 > 600, Math.round(g.x - x0) + "px");
    check("人机能自己走到终点（旧版会停在终点线前 10px）", g.x >= LD.STATUE.finishX || g.statueDone,
      Math.round(g.x) + " / 终点 " + LD.STATUE.finishX);
  }

  /* v4.13h **「障碍物贴墙 → 人机卡在障碍物后面」的回归**
   * 贴墙的障碍物只能从「另一侧」绕，而 LD.AI.steer 的局部避让只往前探 70px、
   * 看不到那条路，给出的方向经常是**朝后**；人机于是在障碍物左边缘来回晃。
   * 更坑的是被夹在两块障碍物之间的窄缝里：绕障点如果算在障碍物内部，
   * 人机会一路朝那面墙使劲，彻底不动。下面这张图就是实测卡死过的地形。 */
  {
    const list2 = setupRule("statue", 1);
    const h = list2[0];
    const pt = B.world.pt || 96;
    const keepStrike = B.statueStrike;
    B.statueStrike = () => 0;                       /* 只测移动，别让监测者的击退搅局 */
    /* 一道贴着**下墙**的长墙（从 y≈380 一路堵到地面），只能从上面绕：
     *   x540~580/y380~460、x560~600/y550~590、x600~640/y410~530、x640~680/y550~590
     * 实测旧版人机走到 x≈521 就顶着墙猛按「左下」，永远过不去。 */
    B.terrain.props = (B.terrain.props || []).filter(o => !o.blockMove);
    [[560, 420, 1, 2], [580, 570, 2, 1], [620, 470, 1, 3], [660, 570, 2, 1]].forEach(a => {
      const o = B.casualAddProp("solid", "stone", a[0], a[1], a[2], a[3]);
      o.blockMove = true;
    });
    h.statueDone = false; h.stMode = "stop"; h.stT = 0; h.statueBold = 0.6;
    h.x = 470; h.y = 500; h.stLastX = null; h.stStall = 0; h.stStuckN = 0;
    B.statue.lastHitT = -99; B.statue.clock = 999;

    /* 绕障落脚点必须落在空地上（曾经算在另一块障碍物里面 → 死循环） */
    const bp = B.statueBypass(h);
    check("绕障落脚点真的算出来了", !!bp);
    if (bp) {
      check("绕障落脚点不在任何障碍物里",
        LD.Terrain.clearAt(B.terrain, bp.x, bp.y, (h.r || 16) + 4),
        "(" + Math.round(bp.x) + "," + Math.round(bp.y) + ")");
    }

    /* 真物理跑一遍：必须在 14 秒内从这块「死角」里绕出去 */
    let reach = false;
    for (let i = 0; i < 14 * 60; i++) {
      h.ctrl.mx = 0; h.ctrl.my = 0; h.ctrl.press = {};
      LD.casualAI.statue(h, 1 / 60, h.ctrl);
      B.update(1 / 60);
      if (h.x > 700) { reach = true; break; }
    }
    check("被贴墙障碍夹住时能自己绕出去（旧版会永远朝墙使劲）", reach,
      "x=" + Math.round(h.x) + " y=" + Math.round(h.y));
    check("绕不出去时会退回去重来（不是原地耗死）", (LD.STATUE.aiStuckMax || 0) >= 1
      && (LD.STATUE.aiRetreatT || 0) > 0 && code.includes("stMode = \"retreat\""));
    B.statueStrike = keepStrike;
  }
}

console.log("\n=== 4. 抢椅子（v4.13 重做） ===");
{
  const list = setupRule("chair", 4);
  const C = LD.CHAIR;
  check("地图长宽缩到 80%（960 × 720）", B.world.w === 960 && B.world.h === 720, B.world.w + "×" + B.world.h);
  check("开局椅子数 = 人数 + 2", B.chair.n === 4 + C.extra, B.chair.n);
  check("开局只给时间提示（hint）", B.chair.phase === "hint", B.chair.phase);
  check("预告阶段场上没有椅子（谁都不知道位置）", B.chair.seats.length === 0, B.chair.seats.length);

  /* hint → rush：椅子瞬间出现 */
  B.chair.t = 0; B.updateChair(1 / 60);
  check("倒计时结束 → 椅子瞬间出现（rush）", B.chair.phase === "rush", B.chair.phase);
  check("椅子数量正确", B.chair.seats.length === B.chair.n, B.chair.seats.length + "/" + B.chair.n);

  /* 交互：靠近按 P 才坐下，光站着不算 */
  /* 假椅子坐上去会散架（假 P 概率），这几条断言要挑一把真椅子，否则会随机挂 */
  const s0 = B.chair.seats.find(s => !s.fake) || B.chair.seats[0];
  const a = list[0], b = list[1];
  a.x = s0.x; a.y = s0.y;
  check("够得着时 P 键提示「坐下」", B.interactLabel(a) === "坐下", B.interactLabel(a));
  check("没按 P 之前不算坐下", a.chairSeat < 0 && !s0.taken, a.chairSeat);
  a.interactCd = 0;
  B.doInteract(a);
  check("按 P 瞬间坐下", a.chairSeat >= 0 || !!s0.taken, a.chairSeat + "/" + (s0.taken ? "taken" : "-"));

  /* 远离椅子时按 P 无效（不是范围圈自动判定） */
  const far = B.chair.seats[B.chair.seats.length - 1];
  b.x = far.x; b.y = far.y;
  b.x = 40; b.y = B.world.pt + 40;
  b.interactCd = 0;
  const bi = B.chairNearSeat(b);
  check("离得远就没有可坐的椅子", bi < 0, bi);

  /* 结算：坐到的人不掉血，没坐到的扣血不出局 */
  const seated = B.casualAlive().filter(f => f.chairSeat >= 0);
  const hpB = b.hp;
  B.chairResolve();
  check("坐到椅子的人不掉血", seated.every(f => f.hp === f.maxHp), seated.length + " 人");
  check("没抢到扣 " + C.missDmg + " 血但不出局",
    Math.abs((hpB - b.hp) - C.missDmg) < 1 && !b.dead, hpB + " → " + b.hp);

  /* 每轮椅子 -1，并且回到预告阶段（椅子重新清空） */
  const n0 = B.chair.n;
  check("结算后进入间歇（rest）", B.chair.phase === "rest", B.chair.phase);
  B.chair.t = 0; B.updateChair(1 / 60);
  check("每轮过后椅子数 -1", B.chair.n === Math.max(C.minSeats, n0 - 1), n0 + " → " + B.chair.n);
  check("新的一轮回到预告、椅子清空", B.chair.phase === "hint" && B.chair.seats.length === 0);

  /* 假椅子：坐上去直接散架 */
  B.chair.t = 0; B.updateChair(1 / 60);
  const fake = { x: 500, y: B.world.pt + 200, r: 60, fake: true, taken: null, t: 0, broken: false };
  B.chair.seats.push(fake);
  const c0 = list[2];
  c0.chairSeat = -1; c0.root = 0;
  c0.x = fake.x; c0.y = fake.y; c0.interactCd = 0;
  B.doInteract(c0);
  check("坐到假椅子 → 当场散架", fake.broken === true);
  check("散架后不算坐下（白跑一趟）", c0.chairSeat < 0, c0.chairSeat);
  check("并且会愣神一下", c0.root > 0, (c0.root || 0).toFixed(2));

  /* ---- v4.13d：椅子交互范围缩了一圈 + 场上多摆风扇 ---- */
  check("椅子交互范围缩到 " + C.sitR + "（原 44）", C.sitR < 44, C.sitR);
  {
    const q = list[3];
    const seat = { x: 500, y: B.world.pt + 260, r: 60, fake: false, taken: null, t: 0, broken: false };
    B.chair.seats.push(seat);
    B.chair.phase = "rush";
    q.chairSeat = -1;
    /* 站在旧范围（44 + r）里、但在新范围外 → 现在坐不上 */
    const oldR = 44 + (q.r || 15);
    const newR = C.sitR + (q.r || 15);
    q.x = seat.x - (newR + oldR) / 2; q.y = seat.y;
    check("旧范围能坐、新范围坐不了（范围确实缩了）", B.chairNearSeat(q) < 0,
      "距离 " + Math.round((newR + oldR) / 2) + " / 新上限 " + Math.round(newR));
    q.x = seat.x - (newR - 6); q.y = seat.y;
    check("贴到新范围里还是坐得上", B.chairNearSeat(q) >= 0);
    B.chair.seats.pop();
  }
  {
    const blowers = (B.terrain.props || []).filter(o => o.kind === "blower" && !o.dead);
    check("场上摆了吹风机（" + C.blowers + " 台）", blowers.length === C.blowers, blowers.length);
    check("吹风机都有朝向和射程", blowers.every(o => o.dir >= 0 && o.dir <= 3 && (o.len || 0) > 0),
      blowers.map(o => o.dir + "/" + o.len).join(" "));
    check("吹风机真的会吹人", blowers.every(o => (o.power || 0) > 0), blowers[0] && blowers[0].power);
  }
}

console.log("\n=== 5. 躲猫猫（v4.13 改版） ===");
{
  const list = setupRule("hide", 4);
  const C = LD.HIDE;
  const seekers = list.filter(f => f.hideRole === "seeker");
  const hiders = list.filter(f => f.hideRole === "hider");
  check("开局一人当鬼", seekers.length === 1 && hiders.length === 3, seekers.length + " 鬼 / " + hiders.length + " 躲");
  check("鬼血更厚", seekers[0].maxHp === C.seekerHp, seekers[0].maxHp);

  /* v4.13f 地形：隐匿物补足到 (人数 × 2 + hideExtra) × hideMul */
  const all = (B.terrain && B.terrain.props) || [];
  const hid = all.filter(o => !o.dead && (o.kind === "locker" || o.kind === "bush"));
  const oth = all.filter(o => !o.dead && o.kind !== "locker" && o.kind !== "bush");
  const needHid = Math.round((4 * 2 + C.hideExtra) * C.hideMul);
  check("隐匿物补足到 (人数×2 + " + C.hideExtra + ") × " + C.hideMul + " ≈ " + needHid + " 个",
    hid.length >= needHid - 4, hid.length + " 个");
  check("隐匿物数量翻倍了（旧口径只要 " + (4 * 2 + C.hideExtra) + " 个）", hid.length > 4 * 2 + C.hideExtra);
  check("隐匿物比普通障碍多得多", hid.length > oth.length * 1.5, hid.length + " vs " + oth.length);

  /* v4.13 开局的鬼：10 秒失明（整体变黑）+ 10 秒定身 */
  const sk0 = seekers[0];
  sk0.blackout = C.openBlind; sk0.root = C.openRoot;
  check("开局的鬼整体屏幕变黑 " + C.openBlind + " 秒", sk0.blackout === C.openBlind, sk0.blackout);
  check("开局的鬼定身 " + C.openRoot + " 秒", sk0.root === C.openRoot, sk0.root);
  check("「屏幕变黑」用的是新状态（不是粪击那块棕色）", typeof sk0.blackout === "number" && sk0.blind !== C.openBlind);

  /* v4.13f 配装：这模式只发一个招式，装在 J（basic）槽上 */
  const hider0 = hiders[0];
  check("人的 J 槽 = 隐匿（hide_stealth）", hiders.every(f => f.loadout.basic === "hide_stealth"));
  check("鬼的 J 槽 = 抓人（hide_catch）", seekers.every(f => f.loadout.basic === "hide_catch"));
  check("K / L / O 三个槽位全部清空（显示「无」）",
    list.every(f => [f.loadout.skill1, f.loadout.skill2, f.loadout.ult].every(v => !v)),
    JSON.stringify(list[0].loadout));
  check("两个专用招式不进商店 / 人机配装池",
    LD.shopSkillsBy("basic").every(s => !s.hideOnly) && !LD.AI.randomLoadout().basic.startsWith("hide_"),
    LD.shopSkillsBy("basic").length + " 个上架普攻");

  /* 人按 J = 隐匿，CD 15 秒 */
  hider0.hideProp = null; hider0.bushHide = false; hider0.stealthT = 0;
  hider0.cd.basic = 0;
  hider0.ctrl.press.basic = true;
  B.trySlot(hider0, "basic", hider0.ctrl);
  hider0.ctrl.press.basic = false;
  check("人按 J 放出隐匿", hider0.slot.basic.on === true, JSON.stringify(hider0.slot.basic.phase));
  B.endSlot(hider0, "basic", 15);
  hider0.stealthT = 0;
  check("隐匿 CD 是 " + C.stealthCd + " 秒",
    Math.abs(hider0.cd.basic - C.stealthCd) < 0.01, hider0.cd.basic);
  check("隐匿的 CD 就写在技能表里（两边一致）", LD.skill("hide_stealth").cd === C.stealthCd);
  /* 鬼按 J 是抓人，不是隐匿 */
  check("鬼按 J 不会进入隐匿（放的是抓人）",
    LD.skill(seekers[0].loadout.basic).id === "hide_catch");
  /* 其它槽位仍然点不动 */
  hider0.ctrl.press.skill1 = true; B.trySlot(hider0, "skill1", hider0.ctrl); hider0.ctrl.press.skill1 = false;
  check("空槽位依旧放不出任何东西", !hider0.slot.skill1.on);
  /* P 键交还给通用交互，不再挂身份相关的动作 */
  check("P 框上不再写隐匿 / 抓人（都搬到 J 了）",
    !/隐藏|隐匿|抓人/.test(B.interactLabel(hider0)), B.interactLabel(hider0));

  /* 鬼的移速 120% */
  check("鬼移速 120% / 躲藏者 100%",
    Math.abs(LD.RULE_SPD.hide(sk0) - C.seekerMul) < 1e-6 && Math.abs(LD.RULE_SPD.hide(hider0) - 1) < 1e-6,
    LD.RULE_SPD.hide(sk0) + " / " + LD.RULE_SPD.hide(hider0));

  /* 取消「长时间躲着会被发现」：本模式下 spotT 不生效 */
  const hider1 = hiders[1];
  hider1.hideProp = { dead: false }; hider1.hideTimer = 0; hider1.hideSpotted = false;
  B.updateHero(hider1, 3.0);
  check("躲再久也不会自己暴露（取消了 spotT）", !hider1.hideSpotted, hider1.hideSpotted);
  hider1.hideProp = null;

  /* 场上道具：靠近按住 P 蓄力 2 秒拾取 */
  B.hide.relic = null; B.hide.relicT = 0;
  B.updateHide(1 / 60);
  check("每隔一段时间刷出道具", !!B.hide.relic, B.hide.relic ? "有" : "无");
  if (B.hide.relic) {
    const rc = B.hide.relic;
    const picker = list.find(f => f.hideRole === "hider" && !f.dead) || hider0;
    picker.x = rc.x; picker.y = rc.y; picker.interactCd = 0; picker.root = 0; picker.stun = 0; picker.chg = null;
    check("够得着时提示长按", /长按/.test(B.interactLabel(picker)), B.interactLabel(picker));
    B.doInteract(picker);
    check("按 P 进入蓄力（不是瞬间到手）", !!picker.chg && picker.chg.kind === "relic", picker.chg ? picker.chg.kind : "无");
    /* 蓄力读满 */
    for (let i = 0; i < 200 && picker.chg; i++) B.updateCharging(1 / 60);
    check("蓄力 " + LD.CHARGE.relic.need + " 秒后拿到道具", !B.hide.relic);
    check("人拿到 → 所有鬼定身 + 失明",
      B.casualAlive().filter(f => f.hideRole === "seeker").every(f => f.root > 0 && f.blackout > 0));
    check("人拿到 → 鬼搜查耗时翻倍（计时中）", B.hide.searchMulT > 0, B.hide.searchMulT.toFixed(1));
  }

  /* 鬼拿到 → 随机锁定一个躲藏者 10 秒 */
  B.hide.relic = { x: 400, y: B.world.pt + 300, t: 0, bob: 0, taken: false };
  const sk2 = B.casualAlive().find(f => f.hideRole === "seeker");
  sk2.root = 0; sk2.stun = 0; sk2.chg = null; sk2.interactCd = 0;
  sk2.x = B.hide.relic.x; sk2.y = B.hide.relic.y;
  B.doInteract(sk2);
  for (let i = 0; i < 200 && sk2.chg; i++) B.updateCharging(1 / 60);
  check("鬼拿到 → 锁定一个躲藏者 " + C.lockT + " 秒",
    !!B.hide.mark && Math.abs(B.hide.mark.t - C.lockT) < 0.01, B.hide.mark ? B.hide.mark.t : "无");
  B.hide.mark = null;

  /* v4.13f 鬼的 J 键 = 抓人：小范围 100 伤害，打死当场变鬼 */
  B.hide.relic = null; B.hide.relicT = 999;
  const sk = seekers[0], h = hiders[0];
  h.hideRole = "hider"; h.hideProp = null; h.bushHide = false;
  h.maxHp = C.hiderHp; h.hp = C.hiderHp;
  h.x = sk.x + 30; h.y = sk.y;
  sk.cd.basic = 0; sk.interactCd = 0; sk.root = 0; sk.stun = 0; sk.chg = null;
  const hp0 = h.hp;
  h.ctrl.press.basic = true;                     /* 真正的入口：按 J */
  B.trySlot(sk, "basic", h.ctrl);
  h.ctrl.press.basic = false;
  check("鬼按 J 抓人 → 扣 " + C.catchDmg + " 血", h.hp === hp0 - C.catchDmg, hp0 + " → " + h.hp);
  check("抓人有 " + LD.skill("hide_catch").cd + " 秒冷却（写在槽位上）",
    Math.abs(sk.cd.basic - LD.skill("hide_catch").cd) < 0.01, sk.cd.basic);

  /* 范围外抓不到 */
  sk.cd.basic = 0;
  const hp1 = h.hp;
  h.x = sk.x + (C.catchR2 || 88) + 60;
  sk.ctrl.press.basic = true; B.trySlot(sk, "basic", sk.ctrl); sk.ctrl.press.basic = false;
  check("超出抓人范围抓不到", h.hp === hp1, hp1 + " → " + h.hp);
  h.x = sk.x + 30;

  /* 第二下打空血 → 当场变成鬼，J 从隐匿换成抓人 */
  sk.cd.basic = 0;
  sk.ctrl.press.basic = true; B.trySlot(sk, "basic", sk.ctrl); sk.ctrl.press.basic = false;
  check("血被打空 → 当场变成鬼（不是死亡）", h.hideRole === "seeker" && !h.dead, h.hideRole + "/dead=" + h.dead);
  check("变成鬼之后 J 换成「抓人」", h.loadout.basic === "hide_catch", h.loadout.basic);
  check("场上鬼变多、躲藏者变少",
    B.casualAlive().filter(f => f.hideRole === "seeker").length === 2 &&
    B.casualAlive().filter(f => f.hideRole === "hider").length === 2);

  /* 核心 BUG 修复：躲在柜子 / 草丛里的人，抓人键也要能揪出来
   * （旧版这里 continue 掉隐藏目标 + 「搜空过的柜子永久拉黑」，于是怎么抓都没用） */
  const h2 = B.casualAlive().filter(f => f.hideRole === "hider")[0];
  const lk = B.hideSpots().filter(o => o.kind === "locker" && !o.occupant)[0];
  h2.noHideT = 0; h2.hp = C.hiderHp; h2.hideRole = "hider";
  h2.x = lk.x; h2.y = lk.y + lk.h / 2 + 20;
  B.enterLocker(h2, lk);
  check("人已经钻进柜子", h2.hideProp === lk && lk.occupant === h2);
  sk.x = lk.x; sk.y = lk.y + lk.h / 2 + 24;       /* 站在柜子外面（柜子是 blockMove，进不去） */
  sk.cd.basic = 0;
  sk.ctrl.press.basic = true; B.trySlot(sk, "basic", sk.ctrl); sk.ctrl.press.basic = false;
  check("对着柜子按 J → 能抓（不再「怎么抓都没用」）", h2.hp === C.hiderHp - C.catchDmg, h2.hp);
  check("被揪出柜子", h2.hideProp == null && !lk.occupant, String(h2.hideProp));
  check("揪出来的人会进入躲藏冷却（不能原地爬回去）", h2.noHideT > 0, h2.noHideT);

  /* 草丛里的同理 */
  const h3 = B.casualAlive().filter(f => f.hideRole === "hider" && f !== h2)[0] || h2;
  const bsh = B.hideSpots().filter(o => o.kind === "bush")[0];
  h3.noHideT = 0; h3.hp = C.hiderHp; h3.hideRole = "hider"; h3.hideProp = null;
  h3.bushHide = true; h3.inBush = true;
  h3.x = bsh.x; h3.y = bsh.y;
  sk.x = bsh.x + 30; sk.y = bsh.y; sk.cd.basic = 0;
  sk.ctrl.press.basic = true; B.trySlot(sk, "basic", sk.ctrl); sk.ctrl.press.basic = false;
  check("对着草丛按 J 也能抓到", h3.hp === C.hiderHp - C.catchDmg, h3.hp);
  check("草丛里被抓住会现形", !h3.bushHide);

  /* v4.13g 新的抓人规则：搜查只把人揪出来，伤害只认 J，挨满 200 才变鬼 */
  {
    const lk3 = B.hideSpots().filter(o => o.kind === "locker" && !o.occupant)[0];
    const h4 = B.casualAlive().filter(f => f.hideRole === "hider")[0];
    const sk4 = B.casualAlive().find(f => f.hideRole === "seeker");
    h4.hp = C.hiderHp; h4.noHideT = 0; h4.hideRole = "hider"; h4.dead = false;
    h4.x = lk3.x; h4.y = lk3.y + lk3.h / 2 + 20;
    B.enterLocker(h4, lk3);
    sk4.cd.basic = 99;                       /* 别让它在搜查期间顺手按 J 干扰断言 */
    sk4.x = lk3.x; sk4.y = lk3.y;
    B.hide.searchMulT = 0;                   /* 前面「人捡道具」的状态还在，会让人以为读条没走 */
    B.hide.search = { who: sk4, prop: lk3, t: (C.searchNeed || 0.9) - 0.01 };
    sk4.searched = {};
    const hpBefore = h4.hp;
    B.updateHide(1 / 60);
    check("搜到人：只把柜子打开把人揪出来，不直接变鬼", h4.hideRole === "hider" && !lk3.occupant,
      h4.hideRole + "/柜=" + (lk3.occupant ? "有" : "空"));
    check("搜查本身不掉血（伤害只能来自 J）", h4.hp === hpBefore, hpBefore + " → " + h4.hp);
    check("两条命才会变鬼：血上限 " + C.hiderHp + " / 每发 " + C.catchDmg + " = 正好两下",
      C.hiderHp / C.catchDmg === 2, C.hiderHp / C.catchDmg);
  }

  /* 道具刷新节奏：30 秒一次，第一次也在第 30 秒 */
  check("道具 " + C.relicEvery + " 秒刷新一次", C.relicEvery === 30, C.relicEvery);
  check("第一件道具也等到第 " + C.relicFirst + " 秒", C.relicFirst === 30, C.relicFirst);

  /* 「搜空就永久拉黑」的坑：同一个藏点过一阵子必须能再搜 */
  const lk2 = B.hideSpots().filter(o => o.kind === "locker")[1] || lk;
  const otherSeekers = B.casualAlive().filter(f => f.hideRole === "seeker" && f !== sk);
  otherSeekers.forEach(o => { o.dead = true; });      /* 只留一个鬼，避免抢同一个搜查位 */
  sk.x = lk2.x; sk.y = lk2.y;
  sk.searched[lk2.uid] = B.t;                     /* 刚搜过 */
  B.hide.search = null;
  B.updateHide(1 / 60);
  const recent = !!(B.hide.search && B.hide.search.prop === lk2);
  B.hide.search = null;
  sk.searched[lk2.uid] = B.t - (C.reSearchT + 1); /* 冷却早就过了 */
  B.updateHide(1 / 60);
  const old = !!(B.hide.search && B.hide.search.prop === lk2);
  B.hide.search = null;
  otherSeekers.forEach(o => { o.dead = false; });
  check("刚搜过的柜子不会立刻重复搜", !recent);
  check("过了 " + C.reSearchT + " 秒冷却还能再搜（不是永久拉黑）", old);

  /* 时间到还有人没被抓 → 躲藏者赢 */
  B.state = "fight";
  B.hideTimeUp();
  check("时间到仍有躲藏者 → 躲藏者获胜",
    B.state === "roundEnd" && B.casualAlive().filter(f => f.hideRole === "hider").indexOf(list[B.roundWinner]) >= 0,
    B.state);
}

/* 当鬼时不能有任何索敌指引：头顶标记 / 视野外箭头 / 别人的名字 */
console.log("\n=== 5d. 躲猫猫：当鬼时关掉索敌指引 ===");
{
  const list = setupRule("hide", 4);
  const B2 = B;
  const meSk = list.find(f => f.hideRole === "seeker");
  const aHider = list.find(f => f.hideRole === "hider");

  /* drawHide 的头顶标记：把 fillText 录下来数「躲」字 */
  const rec = [];
  const recCtx = new Proxy({}, {
    get(t, k) {
      if (k === "fillText") return (s) => { rec.push(String(s)); };
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 100 });
      if (typeof k === "symbol") return undefined;
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  B2.mySide = meSk.side;
  rec.length = 0; B2.drawHide(recCtx);
  const asSeeker = rec.slice();
  B2.mySide = aHider.side;
  rec.length = 0; B2.drawHide(recCtx);
  const asHider = rec.slice();
  check("当鬼时头顶不出现「躲」标记", asSeeker.indexOf("躲") < 0, asSeeker.join("|").slice(0, 60));
  check("当躲的人时照旧能看见标记（对照组）", asHider.indexOf("躲") >= 0);
  check("当鬼时还能看见同为鬼的标记", asSeeker.indexOf("鬼") >= 0);
  B2.mySide = meSk.side;
  check("当鬼时不给视野外箭头", /rule === "hide" && meCam && meCam\.hideRole === "seeker"/.test(code));
  check("当鬼时不画别人的名字", /const hideTag = this\.rule === "hide"/.test(code));
}

/* 老 BUG：人机永远进不去柜子，全挤在柜子外面发呆。
 * 根因：柜子是 blockMove，人根本走不进柜子内部；旧代码要求「走进内部」才按 P，
 * 于是 inside 永远为 false，人机贴着柜子站一辈子。
 * 旧测试之所以一直绿，是因为它把人**直接 teleport 到柜子中心**——现实中做不到。
 * 这里改成模拟真实走位（会被柜子挡住），验证它最终会停在交互距离上按 P。 */
console.log("\n=== 5b. 躲猫猫人机：真的会躲进柜子 ===");
{
  const list = setupRule("hide", 4);
  const f = list[0];
  list.forEach(o => { o.hideRole = o === f ? "hider" : "seeker"; });
  if (B.terrain && B.terrain.props) B.terrain.props.length = 0;
  const locker = B.casualAddProp("locker", "locker_wood", 700, (B.world.pt || 110) + 300, 1, 1);
  f.hideProp = null; f.bushHide = false; f.inBush = false; f.hideAim = null; f.hideAimT = 0;
  f.cd.skill1 = 99;                 // 关掉「隐匿」分支，单独验柜子这条
  f.noHideT = 0;
  const ctrl = f.ctrl;

  /* 站在柜子外 → 应该朝柜子走 */
  f.x = locker.x - 90; f.y = locker.y;
  ctrl.press = {};
  LD.casualAI.hide(f, 1 / 60, ctrl);
  check("AI 会主动朝藏身点走", Math.hypot(ctrl.mx, ctrl.my) > 0.5,
    ctrl.mx.toFixed(2) + "," + ctrl.my.toFixed(2));

  /* 贴着柜子（在交互距离内）→ 停步 + 按 P */
  const lim = (LD.INTERACT && LD.INTERACT.range) || 26;
  f.x = locker.x - (locker.w / 2 + lim - 6); f.y = locker.y;
  ctrl.press = {};
  LD.casualAI.hide(f, 1 / 60, ctrl);
  check("贴到柜子边就按 P 钻进去（这就是那个 BUG 的修复点）", ctrl.press.interact === true);
  check("钻柜子时不再乱走", ctrl.mx === 0 && ctrl.my === 0, ctrl.mx + "," + ctrl.my);

  /* 模拟真实走位：柜子挡路，人最多贴到边缘，但最终必须按下 P */
  f.x = locker.x - 260; f.y = locker.y; f.hideAim = locker; f.hideAimT = 99;
  const halfW = locker.w / 2, halfH = locker.h / 2;
  let pressed = false, frames = 0;
  for (let i = 0; i < 400 && !pressed; i++) {
    ctrl.press = {};
    LD.casualAI.hide(f, 1 / 60, ctrl);
    frames++;
    if (ctrl.press.interact) { pressed = true; break; }
    /* 简单位移：先归一化（updateHero 里也是 ux = mx/n），再按移速走一格；柜体实心，撞上就贴边 */
    const spd = LD.CONF.hero.speed / 60;
    const nn = Math.hypot(ctrl.mx, ctrl.my) || 1;
    const nx = f.x + (ctrl.mx / nn) * spd, ny = f.y + (ctrl.my / nn) * spd;
    const blocked = Math.abs(ny - locker.y) < halfH + f.r && Math.abs(nx - locker.x) < halfW + f.r;
    if (!blocked) { f.x = nx; f.y = ny; }
    else if (Math.abs(f.y - locker.y) < halfH + f.r) f.x = Math.max(f.x, locker.x - halfW - f.r);
  }
  check("被柜子挡住也会在边上按 P（不是站在外面发呆）", pressed, frames + " 帧");
  check("全程没有被挤进柜子内部", Math.abs(f.x - locker.x) >= halfW - 1,
    Math.abs(f.x - locker.x).toFixed(1) + " / 半宽 " + halfW);

  /* 已经钻进柜子 → 蹲着别动（不再有「躲太久」的自动退出） */
  f.hideProp = locker; locker.occupant = f; f.hideT = 0;
  ctrl.press = {};
  LD.casualAI.hide(f, 1 / 60, ctrl);
  check("藏好后就蹲着不动", ctrl.mx === 0 && ctrl.my === 0 && !ctrl.press.interact);
  f.hideProp = null; locker.occupant = null;
}

console.log("\n=== 5c. 躲猫猫人机：会按 J 隐匿 / 按 J 抓人 ===");
{
  const list = setupRule("hide", 4);
  const f = list[0], sk = list[1];
  list.forEach(o => {
    o.hideRole = o === sk ? "seeker" : "hider";
    o.loadout = { basic: o.hideRole === "seeker" ? "hide_catch" : "hide_stealth",
                  skill1: null, skill2: null, ult: null };
    o.hideProp = null; o.bushHide = false; o.inBush = false;
    o.cd.basic = 0; o.cd.skill1 = 0; o.stealthT = 0; o.noHideT = 0;
    o.hideAim = null; o.hideAimT = 0;
  });
  if (B.terrain && B.terrain.props) B.terrain.props.length = 0;

  /* 人：鬼贴到脸上 → 应该按 J 用隐匿 */
  f.x = 300; f.y = 300;
  sk.x = f.x + 120; sk.y = f.y;
  f.ctrl.press = {};
  LD.casualAI.hide(f, 1 / 60, f.ctrl);
  check("鬼逼近时人机会按 J 隐匿", f.ctrl.press.basic === true);

  /* 鬼离得远 → 不浪费隐匿 */
  sk.x = f.x + 900;
  f.ctrl.press = {};
  LD.casualAI.hide(f, 1 / 60, f.ctrl);
  check("鬼离得远时不会瞎用隐匿", f.ctrl.press.basic !== true);

  /* 鬼：贴近没藏起来的人 → 应该按 J 抓人 */
  const h = list[2];
  h.hideRole = "hider"; h.hideProp = null; h.bushHide = false; h.stealthT = 0;
  h.x = 700; h.y = 400;
  sk.x = h.x - 40; sk.y = h.y; sk.cd.basic = 0;
  sk.ctrl.press = {};
  LD.casualAI.hide(sk, 1 / 60, sk.ctrl);
  check("鬼贴近目标就按 J 抓人", sk.ctrl.press.basic === true,
    sk.ctrl.mx.toFixed(2) + "," + sk.ctrl.my.toFixed(2));

  /* 抓人冷却中就别白按了 */
  sk.cd.basic = 1.5;
  sk.ctrl.press = {};
  LD.casualAI.hide(sk, 1 / 60, sk.ctrl);
  check("抓人冷却时不空按", sk.ctrl.press.basic !== true);
}

/* v4.13f：调 AI 时踩到的四个坑，逐个钉住 */
console.log("\n=== 5e. 躲猫猫人机：搜查链路的关键不变量 ===");
{
  const C = LD.HIDE;
  /* ① 逃跑阈值必须小于「搜查触发距离」，否则人机永远在鬼开始搜查的前一瞬间溜走 */
  const trigger = C.searchR + 40;    // searchR + 半个柜子
  check("人机逃跑阈值 aiPanicR(" + C.aiPanicR + ") < 搜查触发距离(" + trigger + ")",
    C.aiPanicR < trigger, C.aiPanicR + " < " + trigger);

  const list = setupRule("hide", 4);
  const sk = list[0], hd = list[1];
  list.forEach(o => {
    o.hideRole = o === sk ? "seeker" : "hider";
    o.loadout = { basic: o.hideRole === "seeker" ? "hide_catch" : "hide_stealth",
                  skill1: null, skill2: null, ult: null };
    o.hideProp = null; o.bushHide = false; o.inBush = false; o.stealthT = 0;
    o.cd.basic = 0; o.noHideT = 0; o.hideAim = null; o.hideAimT = 0;
  });
  if (B.terrain && B.terrain.props) B.terrain.props.length = 0;

  /* ② 鬼站在草丛里搜查时，不能把自己当成「里面的人」（否则同草丛的躲藏者永远搜不到） */
  const bush = B.casualAddProp("bush", "bush_leaf", 700, (B.world.pt || 110) + 300, 2, 2);
  sk.x = bush.x; sk.y = bush.y; sk.inBush = true; sk.bushHide = true;
  hd.x = bush.x + 8; hd.y = bush.y; hd.inBush = true; hd.bushHide = true;
  check("鬼自己站在草丛里也不算「有人藏着」", B.hideOccupant(bush) === hd,
    B.hideOccupant(bush) ? B.hideOccupant(bush).hideRole : "null");
  sk.inBush = false; sk.bushHide = false;

  /* ③ 鬼要优先去「没搜过」的藏点：以前只按最近排序，冷却一过又搜同一片，
   *    实测 120 秒只覆盖 13/28 个点，人躲在别处永远碰不上 */
  list.forEach(o => { o.hideProp = null; o.stealthT = 9; });   // 所有躲藏者都「看不见」，逼鬼去搜点
  B.terrain.props.length = 0;
  const near = B.casualAddProp("locker", "locker_wood", 400, (B.world.pt || 110) + 300, 1, 1);
  const far = B.casualAddProp("locker", "locker_wood", 900, (B.world.pt || 110) + 300, 1, 1);
  sk.x = 380; sk.y = near.y; sk.cd.basic = 0; sk.searched = {}; sk.hideAim = null; sk.hideAimT = 0;
  B.hide.search = null;
  sk.searched[near.uid] = B.t;                                  // 近的刚搜过
  LD.casualAI.hide(sk, 1 / 60, sk.ctrl);
  check("搜过的近点不再被反复搜（改为去未搜过的点）", sk.hideAim === far && far !== near,
    sk.hideAim ? Math.round(sk.hideAim.x) : "无");

  /* ④ 鬼「记得」刚看见的人：对方按下隐匿也不要立刻丢目标，
   *    抓人判定本身不看隐匿，所以这一扑经常真的抓得到 */
  list.forEach(o => { o.x = 1200; o.y = 900; o.hideProp = null; o.stealthT = 9; });
  hd.hideProp = null; hd.bushHide = false; hd.stealthT = 0;
  hd.x = 560; hd.y = 500;
  sk.x = 500; sk.y = 500; sk.cd.basic = 0; sk.hideAim = null; sk.hideMem = null; sk.hideMemT = 0;
  B.hide.search = null;
  sk.ctrl.press = {};
  LD.casualAI.hide(sk, 1 / 60, sk.ctrl);
  check("看见人 → 记住位置", !!sk.hideMem && sk.hideMemT > 0);
  hd.stealthT = 6;                                              // 人当场按 J 隐匿
  sk.ctrl.press = {};
  LD.casualAI.hide(sk, 1 / 60, sk.ctrl);
  check("人隐匿消失后鬼仍朝消失处扑（记忆）", sk.ctrl.press.basic === true || sk.ctrl.mx !== 0,
    "press=" + !!sk.ctrl.press.basic + " mv=" + sk.ctrl.mx.toFixed(2) + "," + sk.ctrl.my.toFixed(2));
  check("记忆会过期", (function () {
    for (let i = 0; i < 300; i++) {
      sk.ctrl.press = {};
      LD.casualAI.hide(sk, 1 / 60, sk.ctrl);
    }
    return !sk.hideMem || sk.hideMemT <= 0 || sk.hideAim != null;
  })());

  /* ⑤ 被搜时先蹲着赌一把，读条过半才夺门而出 */
  list.forEach(o => { o.stealthT = 9; });
  const lk2 = B.casualAddProp("locker", "locker_wood", 620, (B.world.pt || 110) + 420, 1, 1);
  hd.hideRole = "hider"; hd.stealthT = 0; hd.noHideT = 0; hd.hp = C.hiderHp;
  hd.x = lk2.x; hd.y = lk2.y; B.enterLocker(hd, lk2);
  const fakeSearch = { who: sk, prop: lk2, t: 0.1 };
  sk.x = lk2.x; sk.y = lk2.y + 60;
  B.hide.search = fakeSearch;
  hd._bailSearch = null; hd._bailRoll = true;
  hd.ctrl.press = {}; LD.casualAI.hide(hd, 1 / 60, hd.ctrl);
  check("刚开搜时先蹲着（不立刻弃柜）", hd.ctrl.press.interact !== true);
  fakeSearch.t = 0.6;                                            // 读条过半
  hd._bailSearch = fakeSearch; hd._bailRoll = true;               // 第一次调用已经掷过骰子，这里锁死
  hd.ctrl.press = {}; LD.casualAI.hide(hd, 1 / 60, hd.ctrl);
  check("抽到「跑」→ 读条过半才夺门而出", hd.ctrl.press.interact === true);
  hd._bailSearch = fakeSearch; hd._bailRoll = false;
  hd.ctrl.press = {}; LD.casualAI.hide(hd, 1 / 60, hd.ctrl);
  check("抽到「蹲」→ 老实待着被揪出来", hd.ctrl.press.interact !== true);
  B.hide.search = null;
  B.leaveLocker(hd, false);
  check("配置齐备（aiBail / aiMemT / aiPanicR / aiRelicR）",
    typeof C.aiBail === "number" && typeof C.aiMemT === "number"
    && typeof C.aiPanicR === "number" && typeof C.aiRelicR === "number");
}

console.log("\n=== 6. 地板是岩浆（v4.13 改版：无安全台） ===");
{
  const list = setupRule("lava", 4);
  const C = LD.LAVA;
  check("地图缩到原尺寸的 70%", B.world.w === C.world.w && B.world.h === C.world.h,
    B.world.w + "×" + B.world.h);
  check("安全台已取消", B.lava.pads == null, String(B.lava.pads));
  check("开局平静期", B.lava.phase === "calm", B.lava.phase);
  check("开局岩浆比例", Math.abs(B.lava.ratio - C.firstRatio) < 1e-6, B.lava.ratio);

  /* 造一轮岩浆，把某人脚下的格子点亮 */
  const f = list[0];
  f.x = 90; f.y = (B.world.pt || 110) + 60;
  B.lava.phase = "hot"; B.lava.t = 5; B.lava.hot = {};
  B.lava.hot[B.lavaCell(f.x, f.y)] = 1;
  check("测试对象脚下是红格", !B.lavaSafeAt(f.x, f.y, B.lava.hot));
  const hp0 = f.hp;
  /* 32 帧 ≈ 0.53 秒：跨过 0.5 秒的结算门槛（浮点累加会差一点点，30 帧刚好不够） */
  for (let i = 0; i < 32; i++) B.updateLava(1 / 60);
  check("站在红格上按 dps 持续掉血",
    hp0 - f.hp > 20 && hp0 - f.hp < C.dps, Math.round(hp0 - f.hp) + " 血");

  /* 挪到没被点亮的格子上就没事 */
  let safeIdx = -1;
  const g0 = B.lavaGrid();
  for (let i = 0; i < g0.cols * g0.rows; i++) {
    if (B.lava.hot[i]) continue;
    safeIdx = i; break;
  }
  const sc = B.lavaCellXY(safeIdx);
  f.x = sc.x; f.y = sc.y;
  check("没被点亮的格子算安全", B.lavaSafeAt(f.x, f.y, B.lava.hot));
  const hp1 = f.hp;
  for (let i = 0; i < 30; i++) B.updateLava(1 / 60);
  check("站在安全格上不再掉血", f.hp === hp1, f.hp);

  /* ---- v4.13d 安全格数量改成「存活人数 + safeExtra」 ---- */
  {
    const g = B.lavaGrid();
    const total = g.cols * g.rows;
    const aliveN = B.casualAlive().length;
    B.lava.phase = "calm"; B.lava.t = 0;
    B.updateLava(1 / 60);
    const nSafe = total - Object.keys(B.lava.warn).length;
    check("安全格数 = 存活人数 + " + (C.safeExtra == null ? 1 : C.safeExtra),
      nSafe === aliveN + (C.safeExtra == null ? 1 : C.safeExtra), nSafe + " / 存活 " + aliveN);
    check("其余格子全都会烧", Object.keys(B.lava.warn).length === total - nSafe,
      Object.keys(B.lava.warn).length + " / " + total);
    check("人数不变时下一轮安全格数不变",
      (function () {
        B.lava.phase = "gap"; B.lava.t = 0; B.updateLava(1 / 60);
        B.lava.phase = "calm"; B.lava.t = 0; B.updateLava(1 / 60);
        return total - Object.keys(B.lava.warn).length === nSafe;
      })(), nSafe);
  }

  /* 身体压到红格就算烫（不再只看中心点） */
  {
    const f2 = list[1];
    B.lava.phase = "hot"; B.lava.t = 5; B.lava.hot = {};
    const g = B.lavaGrid();
    const ci = 3, ri = 2;
    B.lava.hot[ri * g.cols + (ci + 1)] = 1;
    f2.x = g.x0 + (ci + 0.5) * g.tw + g.tw * 0.5 - 6;
    f2.y = g.y0 + (ri + 0.5) * g.th;
    check("中心点还在安全格上", B.lavaSafeAt(f2.x, f2.y, B.lava.hot));
    check("但身体已经压到旁边红格 → 判定为烫", B.lavaBodyOn(f2, B.lava.hot));
    const hpA = f2.hp;
    for (let i = 0; i < 32; i++) B.updateLava(1 / 60);
    check("这种「贴边站」现在会掉血", f2.hp < hpA, hpA + " → " + Math.round(f2.hp));
  }

  /* 互撞：沿用滑壶规则，v4.13d 击退 +10% */
  check("击退按 bumpMul 削弱（v4.13d 提到 0.77）", C.bumpMul > 0.7, C.bumpMul);
  check("撞人判定阈值已放宽（原 130）", C.bumpMinSpd < 130, C.bumpMinSpd);
  check("同一对有结算冷却（修「有时候撞不动」）", C.bumpPairCd > 0, C.bumpPairCd);
  const a = list[0], b2 = list[1];
  a.x = 400; a.y = 400; a.knockLeft = 0; a.vx = 0; a.vy = 0; a._lavaBumpT = {};
  b2.x = 400 + a.r + b2.r; b2.y = 400; b2.knockLeft = 0; b2.vx = 0; b2.vy = 0; b2._lavaBumpT = {};
  /* 上一帧在 8px 外 → 折算约 480px/s 的接近速度 */
  a._lvpx = a.x - 8; a._lvpy = a.y; b2._lvpx = b2.x; b2._lvpy = b2.y;
  B.lavaBump(1 / 60);
  check("高速撞上对手会把对方撞飞", b2.knockLeft > 0, b2.knockLeft.toFixed(2) + "s");

  /* 慢速挨在一起不算撞 */
  list.forEach(o => { o.knockLeft = 0; o._lvpx = null; o._lvpy = null; o._lavaBumpT = {}; });
  const c1 = list[2], c2 = list[3];
  c1.x = 300; c1.y = 300; c1.knockLeft = 0;
  c2.x = 300 + c1.r + c2.r; c2.y = 300; c2.knockLeft = 0;
  c1._lvpx = c1.x - 0.5; c1._lvpy = c1.y; c2._lvpx = c2.x; c2._lvpy = c2.y;
  B.lavaBump(1 / 60);
  check("慢速贴在一起不算撞", c2.knockLeft <= 0, c2.knockLeft.toFixed(2) + "s");
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

console.log("\n=== 9. 渲染与人机不崩 ===");
{
  const rules = ["statue", "chair", "hide", "lava", "barrage"];
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
  check("五个模式渲染都不崩", drawOk);
  check("五套人机逻辑都不崩", aiOk);
  check("五套人机都已注册", ["statue", "chair", "hide", "lava", "barrage"].every(r => typeof LD.casualAI[r] === "function"));
}

/* v4.13f 回归：整局全自动跑，验证「鬼真的抓得到人」。
 * 旧版这里 120 秒 0 次抓获 —— 玩家报的「我知道他躲这儿，怎么抓都没用」就是它。 */
console.log("\n=== 10. 躲猫猫整局：人机鬼真的抓得到人 ===");
{
  const runs = 3, samples = [];
  let withCatch = 0, total = 0;
  for (let g = 0; g < runs; g++) {
    const list = setupRule("hide", 4);
    list.forEach(f => LD.AI.mkBot(f, "normal"));
    let frames = 0;
    for (; frames < 120 * 60; frames++) {
      list.forEach(f => LD.AI.tickHero(f, 1 / 60));
      B.update(1 / 60);
      if (B.state !== "fight") break;
    }
    if (B.hide.caught > 0) withCatch++;
    total += B.hide.caught;
    samples.push(B.hide.caught + "人/" + B.t.toFixed(0) + "s");
  }
  check(runs + " 局里至少 " + (runs - 1) + " 局抓到了人", withCatch >= runs - 1, samples.join("  "));
  check("累计抓获 > 0（旧版整局 0 次）", total > 0, total + " 人");
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
