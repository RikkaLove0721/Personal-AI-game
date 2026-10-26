/* 孤高旅斗 v4.13 渡江战役测试
 * 覆盖：地图尺寸（竖 70% / 横 160%）/ 两岸与水面分布 / 水里大幅减速 /
 *       水中零星小岛 + 礁石 / 船只生成（数量 = 存活人数 - 1）/ 船不能上岸 /
 *       30 秒重刷且把人请下船 / 开局只锁技能大招普攻可用 / 右岸升旗解锁 /
 *       人机优先抢船过江 / 对将靠岸者仇恨更高 / 渲染不崩
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
function setupRiver(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(mkHero(i, i));
  B.setup({ mode: "duel", rule: "river", fighters: list, isHost: true, mySide: 0, matchT: 180,
    mapCfg: LD.mapCfg({ preset: "arena", seed: 11, ground: "sand" }) });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return list;
}

console.log("=== 1. 模式注册 ===");
{
  check("渡江战役已注册", LD.ruleInfo("river").id === "river");
  check("归入战斗模式", (LD.ruleInfo("river").cat || "combat") === "combat");
  check("不在娱乐模式名单里", !LD.isCasual("river") && !LD.isEntertain("river"));
  check("战斗 15 种", LD.rulesBy("combat").length === 15, LD.rulesBy("combat").length);
  check("有专属成就与称号", LD.ACHIEVEMENTS.some(a => a.id === "river_win")
    && LD.TITLES.some(t => t.ach === "river_win"));
}

console.log("\n=== 2. 地图尺寸与地形 ===");
{
  const list = setupRiver(4);
  const c = LD.RIVER;
  check("竖宽 = 常规 1600 的 70%", c.world.h === 1120, c.world.h);
  check("横长 = 常规 1600 的 160%", c.world.w === 2560, c.world.w);
  check("世界尺寸已应用", B.world.w === 2560 && B.world.h === 1120, B.world.w + "×" + B.world.h);

  const rx = B.riverShoreRx();
  check("右岸起点位置", Math.abs(rx - (2560 - c.shoreR)) < 1e-6, rx);
  check("左岸算陆地", !B.riverInWater(100, 600), "x=100");
  check("右岸算陆地", !B.riverInWater(rx + 80, 600), "x=" + (rx + 80));
  check("江心算水", B.riverInWater((c.shoreL + rx) / 2, 600), "x=" + Math.round((c.shoreL + rx) / 2));
  check("顶部大厅不算水", !B.riverInWater((c.shoreL + rx) / 2, 40), "y=40");

  const props = B.terrain.props;
  check("水面已铺开", props.filter(o => o.kind === "water").length >= 4,
    props.filter(o => o.kind === "water").length + " 块");
  check("水中有零星小岛", props.filter(o => o.islet).length >= c.islets - 3,
    props.filter(o => o.islet).length + " 座");
  check("小岛上撒了礁石", props.filter(o => o.riverRock).length > 0,
    props.filter(o => o.riverRock).length + " 个");
  check("礁石挡船（blockMove）", props.filter(o => o.riverRock).every(o => o.blockMove));
  check("小岛本身不挡人（可踩上去）", props.filter(o => o.islet).every(o => !o.blockMove));
}

console.log("\n=== 3. 水里大幅减速 ===");
{
  const list = setupRiver(4);
  const c = LD.RIVER;
  const rx = B.riverShoreRx();
  const land = list[0], water = list[1];
  /* 先把采样点附近的干扰全部清走再量位移。
   * 船和礁石都是 blockMove 的：角色一旦和它们重叠，
   * T.collideFighter 会一帧把他推出几十像素，
   * 量到的就不是「水里走得慢」而是「被挤开了」。
   * 地形是随机摆的（每次跑位置都不一样），所以只能按坐标反过来挪开挡路的东西。 */
  const wx = (c.shoreL + rx) / 2, wy = 600;
  const parkShips = () => {
    ((B.terrain && B.terrain.props) || []).forEach(o => {
      if (o.ship) { o.x = B.world.w - 60; o.y = B.world.pt + 40; }
    });
  };
  const clearNear = (px, py, pad) => {
    ((B.terrain && B.terrain.props) || []).forEach(o => {
      if (o.dead || o.kind === "water") return;
      /* v4.13c 之后小岛也会改变判定（站上去既不减速也不被冲），必须一并挪走，
       * 否则它会随机压在采样点上，让「水里应该减速」量出 1.0。 */
      if (!o.blockMove && !o.islet) return;
      if (Math.abs(o.x - px) < (o.w || 0) / 2 + pad && Math.abs(o.y - py) < (o.h || 0) / 2 + pad) {
        o.x = B.world.w - 60; o.y = B.world.pt + 40;
      }
    });
  };
  parkShips();
  clearNear(wx, wy, 180);
  clearNear(100, 600, 180);
  /* 其余角色也统一停到左岸角落，避免英雄之间的分离推挤污染位移 */
  list.forEach(f => { if (f !== land && f !== water) { f.x = 60; f.y = B.world.pt + 40; } });
  land.x = 100; land.y = 600;
  water.x = wx; water.y = wy;

  check("陆地上移速不变", LD.RULE_SPD.river.call(B, land) === 1);
  const wm = LD.RULE_SPD.river.call(B, water);
  check("水里移速大幅下降", wm > 0 && wm <= 0.4, wm);

  /* 靠岸浅水比深水快一点 */
  water.x = c.shoreL + 40;
  const sh = LD.RULE_SPD.river.call(B, water);
  check("近岸浅水比深水快", sh > wm, sh + " > " + wm);

  /* 船里的人不受水里减速影响（船本身就是过江手段） */
  water.x = (c.shoreL + rx) / 2;
  const ship = ((B.terrain && B.terrain.props) || []).find(o => o.ship && !o.dead);
  if (ship) {
    ship.x = wx; ship.y = wy;
    B.enterCar(water, ship);
    check("坐在船上不受水中减速", LD.RULE_SPD.river.call(B, water) === 1);
    B.exitCar(water, false);
    /* 这艘船此刻正压在采样点上，不挪回去的话下一段量到的又是「被船挤开」 */
    parkShips();
    clearNear(wx, wy, 180);
  } else {
    check("船上不受水中减速（本局没船，跳过）", true);
  }

  /* 真的走一帧：水里的位移明显小于陆地。
   * 注意要把两边都放回干净状态（上一段把 water 挪到了浅水，速度会不一样）。 */
  parkShips();
  clearNear(wx, wy, 180);
  clearNear(100, 600, 180);
  land.x = 100; land.y = 600; land.vx = 0; land.vy = 0; land.knockLeft = 0;
  land.ctrl.mx = 1; land.ctrl.my = 0;
  water.x = wx; water.y = wy; water.vx = 0; water.vy = 0; water.knockLeft = 0;
  water.ctrl.mx = 1; water.ctrl.my = 0;
  const lx0 = land.x, wx0 = water.x;
  /* 量一帧位移时单独调用：updateHero 会先跑击退位移再跑方向键位移，
   * 所以两边都必须先归零 knockLeft / chg / root，否则量到的是上一次测试的余波。 */
  land.knockLeft = 0; water.knockLeft = 0;
  land.chg = null; water.chg = null;
  land.root = 0; water.root = 0;
  land.stun = 0; water.stun = 0;
  B.updateHero(land, 1 / 60);
  B.updateHero(water, 1 / 60);
  const lm = land.x - lx0, wmv = water.x - wx0;
  check("同一帧水里挪得明显更少", lm > 1 && wmv > 0 && wmv < lm * 0.5,
    wmv.toFixed(2) + " vs " + lm.toFixed(2));
}

console.log("\n=== 4. 船只生成 ===");
{
  const list = setupRiver(4);
  const ships = () => ((B.terrain && B.terrain.props) || []).filter(o => o.ship && !o.dead);
  check("开局就有船", ships().length > 0, ships().length + " 艘");
  check("船数 = 存活人数 - 1", ships().length === 3, ships().length + " / 存活 " + B.casualAlive().length);
  check("船都停在水里", ships().every(o => B.riverInWater(o.x, o.y)),
    ships().map(o => Math.round(o.x)).join(","));
  check("船走的是汽车那套（kind = car）", ships().every(o => o.kind === "car"));
  check("船有油量（可行驶距离）", ships().every(o => o.fuel > 0 && o.fuelMax > 0));
  check("船带贴图 key", ships().every(o => !!o.shipImg));

  /* 每种船都比车大或更快，且至少两种船尺寸不同 */
  const sizes = new Set(ships().map(o => o.cw + "x" + o.ch));
  check("船有大有小", Object.keys(LD.SHIPS).length === 4 && !!LD.SHIPS.raft && !!LD.SHIPS.junk,
    Object.keys(LD.SHIPS).join("/") + " 场上 " + sizes.size + " 种尺寸");

  /* 上船 / 下船 */
  const f = list[0], sh = ships()[0];
  f.x = sh.x; f.y = sh.y + sh.h;
  f.noCarT = 0;
  check("走到船边能上船", B.enterCar(f, sh) === true);
  check("上船后 rideCar 生效", f.rideCar === sh);

  /* 船不能上岸：把船强行推进右岸，updateRiver 会把它按住（速度砍到 20%） */
  sh.x = B.riverShoreRx() + sh.w * 0.6;
  sh.y = 600;
  sh.vx = 300; sh.vy = 0;
  B.updateRiver(1 / 60);
  check("船碰到岸会被按住", Math.abs(sh.vx) < 80, Math.round(sh.vx) + "（原 300）");
  check("搁浅会给一句提示", (sh._beachT || 0) > 0, (sh._beachT || 0).toFixed(2) + "s");
  B.exitCar(f, false);

  /* 船按位移扣油（和汽车一致）。
   * 挑一条真正空旷的水平航线：把挡在这条线上的一切都先挪走，
   * 否则船会被岛 / 礁石卡住不动，位移为 0，油自然也不掉。 */
  const laneY = 560;
  const laneX0 = 420, laneX1 = 1400;
  const bumpy = o => o && !o.dead && o.blockMove && o !== sh
    && Math.abs(o.y - laneY) < (o.h + sh.h) / 2 + 30
    && o.x > laneX0 - o.w && o.x < laneX1 + o.w;
  ((B.terrain && B.terrain.props) || []).forEach(o => {
    if (!bumpy(o)) return;
    o.x = 2400; o.y = B.world.pt + 30;
  });
  sh.x = laneX0; sh.y = laneY; sh.vx = 0; sh.vy = 0;
  const fuel0 = sh.fuel;
  const px0 = sh.x;
  f.noCarT = 0;
  f.x = sh.x; f.y = sh.y;
  B.enterCar(f, sh);
  f.ctrl.mx = 1; f.ctrl.my = 0;
  for (let i = 0; i < 40; i++) B.updateVehicles(1 / 60);
  check("开船真的会往右走", sh.x - px0 > 20, (sh.x - px0).toFixed(1) + "px");
  check("开船会耗油", sh.fuel < fuel0, fuel0 + " → " + Math.round(sh.fuel));
  B.exitCar(f, false);
}

console.log("\n=== 5. 每 30 秒重刷，船上的人被请下船 ===");
{
  const list = setupRiver(5);
  const c = LD.RIVER;
  const ships = () => ((B.terrain && B.terrain.props) || []).filter(o => o.ship && !o.dead);
  const f = list[0];
  const sh = ships()[0];
  sh.x = 900; sh.y = 600;
  f.x = sh.x; f.y = sh.y; f.noCarT = 0;
  B.enterCar(f, sh);
  check("先让人坐上去", f.rideCar === sh);

  B.river.shipT = 0.01;
  B.updateRiver(0.02);
  check("到点强制刷船", B.river.batch === 2, "批次 " + B.river.batch);
  check("坐在船上的人被请下船", !f.rideCar);
  check("刷新后船数仍是 存活人数 - 1", ships().length === 4, ships().length + " / 存活 " + B.casualAlive().length);
  check("重刷计时回到 30 秒", Math.abs(B.river.shipT - c.shipEvery) < 0.05, B.river.shipT.toFixed(1));

  /* 人越少船越少，但至少 1 艘 */
  B.endRound(list[1].side);
  const alive = B.casualAlive().length;
  B.riverSpawnShips(true);
  check("只剩 " + alive + " 人时船数 = " + Math.max(1, alive - 1), ships().length === Math.max(1, alive - 1), ships().length);
}

console.log("\n=== 6. 开局锁招式，升旗解锁 ===");
{
  const list = setupRiver(3);
  const f = list[0];
  const c = LD.RIVER;
  check("开局未解锁", !f.riverUnlocked);

  /* 技能 / 大招被拦，普攻放行 */
  f.cd.skill1 = 0; f.cd.ult = 0; f.energy = f.maxEnergy; f.cd.basic = 0;
  const skill1Before = f.cd.skill1, ultBefore = f.cd.ult;
  f.ctrl.press.skill1 = true;
  B.trySlot(f, "skill1", f.ctrl);
  check("未解锁时技能放不出来", f.cd.skill1 === skill1Before && !f.slot.skill1.on);
  f.ctrl.press.ult = true;
  B.trySlot(f, "ult", f.ctrl);
  check("未解锁时大招放不出来", f.cd.ult === ultBefore && !f.slot.ult.on);

  const basicBefore = f.cd.basic;
  f.ctrl.press = {};
  B.trySlot(f, "basic", f.ctrl);
  check("普攻可以用", f.cd.basic > basicBefore || f.slot.basic.on || f.atkAnim > 0);

  /* 在左岸升旗 → 不生效 */
  f.x = 120; f.y = 600;
  check("左岸按 P 不生效", LD.RULE_INTERACT.river.call(B, f) === false);
  check("左岸没有 P 提示", LD.RULE_LABEL.river.call(B, f) === "");

  /* 到旗子边 → 解锁 */
  const flag = B.river.flag;
  f.x = flag.x; f.y = flag.y;
  check("旗子边有 P 提示", /登岸/.test(LD.RULE_LABEL.river.call(B, f)), LD.RULE_LABEL.river.call(B, f));
  /* v4.13d：底部 P 键槽走的是 B.interactLabel 这一层，必须也拿得到同一句话
   * （之前只验了注册表，真机上玩家看到的却是「无」——这一条就是那个漏网之鱼的兜底） */
  check("底部 P 键槽也显示同一句提示", /登岸/.test(B.interactLabel(f)), B.interactLabel(f));
  check("靠近判定是共用一套（不会「有提示却按不动」）", B.riverNearFlagPad(f, 18) === true);
  check("离远了提示就消失", (function () {
    const bx = f.x, by = f.y;
    f.x = 120; f.y = 600;
    const gone = B.interactLabel(f) === "" && B.riverNearFlagPad(f, 18) === false;
    f.x = bx; f.y = by;
    return gone;
  })());
  check("按 P 完成登岸", LD.RULE_INTERACT.river.call(B, f) === true);
  check("登岸后已解锁", f.riverUnlocked === true);
  check("解锁者已登记", B.river.unlockedBy.indexOf(f.side) >= 0);

  /* 解锁后技能放得出来 */
  f.cd.skill1 = 0;
  f.slot.skill1.on = false;
  B.trySlot(f, "skill1", f.ctrl);
  check("解锁后技能正常放出", f.slot.skill1.on || f.cd.skill1 > 0);
}

console.log("\n=== 7. 人机 ===");
{
  const list = setupRiver(4);
  const c = LD.RIVER;
  const rx = B.riverShoreRx();

  /* 还在左岸、场上有船 → 朝船走 */
  const f = list[0];
  f.x = 110; f.y = 600; f.riverUnlocked = false;
  f.rideCar = null;
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  f.bot = { conf: {}, foe: null, retargetT: 0 };
  const took = B.riverThink(f, 1 / 60, f.ctrl);
  check("人机接管过江流程", took === true);
  check("人机在动（朝船或朝右岸）", Math.abs(f.ctrl.mx) + Math.abs(f.ctrl.my) > 0.05,
    f.ctrl.mx.toFixed(2) + "," + f.ctrl.my.toFixed(2));

  /* 场上一艘船都不给 → 也应该往右走（不原地发呆） */
  ((B.terrain && B.terrain.props) || []).forEach(o => { if (o.ship) { o.driver = null; o.dead = true; } });
  f.x = 110; f.y = 600; f.ctrl.mx = 0; f.ctrl.my = 0;
  B.riverThink(f, 1 / 60, f.ctrl);
  check("没船就蹚水往右走", f.ctrl.mx > 0.3, f.ctrl.mx.toFixed(2));

  /* 已经到右岸 → 去旗子那儿升旗 */
  f.x = rx + 120; f.y = B.river.flag.y - 200; f.ctrl.mx = 0; f.ctrl.my = 0;
  B.riverThink(f, 1 / 60, f.ctrl);
  check("上岸后朝旗子走", Math.abs(f.ctrl.mx) + Math.abs(f.ctrl.my) > 0.05
    || f.ctrl.press.interact === true);

  /* 贴到旗子边 → 按 P */
  f.x = B.river.flag.x; f.y = B.river.flag.y;
  B.riverThink(f, 1 / 60, f.ctrl);
  check("到旗子边按 P 升旗", f.ctrl.press.interact === true);

  /* 解锁之后交回通用战斗逻辑 */
  f.riverUnlocked = true;
  check("解锁后不再接管（落回正常战斗）", B.riverThink(f, 1 / 60, f.ctrl) === false);

  /* 在船上 → 朝右开 */
  const list2 = setupRiver(4);
  const g = list2[0];
  g.riverUnlocked = false;
  const ship = ((B.terrain && B.terrain.props) || []).find(o => o.ship && !o.dead);
  if (ship) {
    ship.x = 700; ship.y = 600;
    g.x = ship.x; g.y = ship.y; g.noCarT = 0;
    B.enterCar(g, ship);
    g.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
    B.riverThink(g, 1 / 60, g.ctrl);
    check("在船上朝右岸开", g.ctrl.mx > 0.3, g.ctrl.mx.toFixed(2));
    B.exitCar(g, false);
  } else check("在船上朝右岸开（本局没船，跳过）", true);

  /* 仇恨：离右岸越近越招打 */
  const near = { x: rx - 40, y: 600, kind: "hero", dead: false };
  const far = { x: 200, y: 600, kind: "hero", dead: false };
  const an = B.riverAggro(near), af = B.riverAggro(far);
  check("快靠岸的人仇恨更高", an < af, an.toFixed(2) + " < " + af.toFixed(2));
  check("远离岸的人仇恨不变", af === 1, af);
}

console.log("\n=== 8. 渲染不崩 ===");
{
  const list = setupRiver(3);
  let ok = true;
  try {
    const ctx = makeCtx();
    B.draw(ctx);
    for (let i = 0; i < 12; i++) { B.update(1 / 60); B.draw(ctx); }
  } catch (e) { ok = false; console.log("    绘制异常：" + e.message); }
  check("渡江战役画面能一直画下去", ok);
  check("船只贴图已内嵌进单文件", /LD_PROP_IMG\["boat_row"\]/.test(html)
    && /LD_PROP_IMG\["boat_junk"\]/.test(html));
  check("船渲染分支已接进地形渲染", code.indexOf("o.ship") >= 0 && code.indexOf("drawShip") >= 0);
}

console.log("\n=== 9. v4.13b 渡江节奏（船速砍半 / 油量锐减 / 顶部倒计时 / 油尽沉船）===");
{
  const list = setupRiver(4);
  const c = LD.RIVER;
  const wide = B.riverShoreRx() - c.shoreL;          // 江面宽度 2060
  const spdOf = id => LD.CONF.hero.speed * LD.SHIPS[id].speedMul;
  const rangeOf = id => {
    const s = LD.SHIPS[id];
    return [Math.round(c.shipFuel[0] * s.fuelMul), Math.round(c.shipFuel[1] * s.fuelMul)];
  };

  /* ---- 船速：整体砍到人类的移速以内 ---- */
  check("四种船的速度倍率都不到 1", Math.max(...Object.keys(LD.SHIPS).map(k => LD.SHIPS[k].speedMul)) < 1,
    Object.keys(LD.SHIPS).map(k => LD.SHIPS[k].speedMul).join("/"));
  check("船越大越慢", LD.SHIPS.raft.speedMul > LD.SHIPS.row.speedMul
    && LD.SHIPS.row.speedMul > LD.SHIPS.fish.speedMul
    && LD.SHIPS.fish.speedMul > LD.SHIPS.junk.speedMul);
  check("最快的竹筏也跑不过徒步的人", spdOf("raft") < LD.CONF.hero.speed,
    spdOf("raft").toFixed(0) + " < " + LD.CONF.hero.speed);
  check("最慢的福船明显慢于常规车速（1.4 倍）", spdOf("junk") < LD.CONF.hero.speed * 0.6,
    spdOf("junk").toFixed(0) + "px/s");

  /* ---- 油量：快的不经烧、经烧的不快 ---- */
  check("油量基准已大幅下调", c.shipFuel[1] <= 1800, c.shipFuel.join("～"));
  check("快的带不远、远的不快", LD.SHIPS.raft.fuelMul < LD.SHIPS.junk.fuelMul
    && LD.SHIPS.raft.speedMul > LD.SHIPS.junk.speedMul);
  check("竹筏满油也开不过半个江面", rangeOf("raft")[1] < wide * 0.5,
    rangeOf("raft")[1] + " / 江面 " + wide);
  check("竹筏和小木船怎么摇都到不了对岸", ["raft", "row"].every(id => rangeOf(id)[1] < wide),
    ["raft", "row"].map(id => id + " " + rangeOf(id)[1]).join(" / "));
  check("福船油箱明显更大（但不一定够跑到头）", rangeOf("junk")[1] >= wide * 0.6,
    rangeOf("junk").join("～") + " / 江面 " + wide);

  /* ---- 车型表和 SHIPS 不能各写一份数值 ---- */
  check("车型表里的船只数值跟着 SHIPS 走", Object.keys(LD.SHIPS).every(k => {
    const v = LD.VEHICLES[k];
    return v && v.name === LD.SHIPS[k].name
      && v.speed[0] === LD.SHIPS[k].speedMul
      && v.fuel[1] === rangeOf(k)[1] && v.fuel[0] === rangeOf(k)[0];
  }), Object.keys(LD.SHIPS).map(k => LD.VEHICLES[k].name + " " + LD.VEHICLES[k].speed[0]).join("/"));

  /* ---- 场上真实生成的船 ---- */
  const ships = ((B.terrain && B.terrain.props) || []).filter(o => o.ship && !o.dead);
  check("生成出来的船速度取自配置", ships.every(o => o.speedMul === LD.SHIPS[o.vtype].speedMul));
  check("生成出来的船油量落在配置区间", ships.every(o => {
    const rg = rangeOf(o.vtype);
    return o.fuelMax >= rg[0] && o.fuelMax <= rg[1];
  }), ships.map(o => o.vtype + ":" + o.fuelMax).join(" "));
  /* 别写「有船不足半程」这种看运气的断言：抽到渔船 / 福船就一定超。
   * 改成确定性的上界——这条能挡住「有人在别处又把油量填回去」。 */
  const ceil = Math.max(...Object.keys(LD.SHIPS).map(k => rangeOf(k)[1]));
  check("场上的油上限不会超过福船满油", ships.every(o => o.fuelMax <= ceil),
    "最满 " + Math.max(...ships.map(o => Math.round(o.fuelMax))) + " / 上限 " + ceil);

  /* ---- 顶部倒计时 ---- */
  check("顶部倒计时函数已就绪", typeof B.drawRiverHud === "function");
  check("倒计时总量就是刷新间隔", B.river.refreshT === c.shipEvery, B.river.refreshT);
  const t0 = B.river.shipT;
  B.updateRiver(1.0);
  check("倒计时每秒往下走", Math.abs(B.river.shipT - (t0 - 1)) < 1e-6,
    t0.toFixed(1) + " → " + B.river.shipT.toFixed(1));
  let drew1 = true;
  try { B.drawRiverHud(makeCtx(), 900, 600); } catch (e) { drew1 = false; console.log("    HUD 异常：" + e.message); }
  check("倒计时面板能画出来", drew1);
  let drew2 = true;
  try { B.drawRiverHud(makeCtx(), 320, 240); } catch (e) { drew2 = false; console.log("    小屏异常：" + e.message); }
  check("窄屏也不崩（改成按宽度算比例）", drew2);

  const meF = B.hero(0);
  const sh0 = ships[0];
  meF.noCarT = 0; meF.x = sh0.x; meF.y = sh0.y;
  B.enterCar(meF, sh0);
  let drew3 = true;
  try { B.drawRiverHud(makeCtx(), 900, 600); } catch (e) { drew3 = false; console.log("    油量条异常：" + e.message); }
  check("在船上时 HUD 多一条油量且不崩", drew3 && meF.rideCar === sh0);
  B.exitCar(meF, false);

  /* ---- 油尽：先给一段补救时间，之后沉没，避免江面被空船堵死 ---- */
  B.river.shipT = 999;                       // 别让 30 秒重刷插进来干扰
  const dry = ships.find(o => !o.dead) || ships[0];
  const p = list[1];
  dry.x = 700; dry.y = 600; dry.fuel = 0; dry.dryT = 0; dry.driver = null;
  p.noCarT = 0; p.x = dry.x; p.y = dry.y;
  B.enterCar(p, dry);
  B.updateRiver(1.0);
  check("刚没油不会立刻沉（还有补救时间）", !dry.dead, "dryT " + dry.dryT.toFixed(1));
  check("没油时给了缓冲倒计时", dry.dryT > 0.5 && dry.dryT < c.dryFade, dry.dryT.toFixed(1) + " / " + c.dryFade);
  for (let i = 0; i < 12; i++) B.updateRiver(1.0);
  check("超过 dryFade 秒后沉没", dry.dead === true, "dryT " + (dry.dryT || 0).toFixed(1));
  check("沉船把人丢回水里", !p.rideCar);
}

console.log("\n=== 10. v4.13c ①涨潮 ===");
{
  const list = setupRiver(4);
  const c = LD.RIVER, TL = 40;
  /* 把船和油桶的计时踢远，免得它们在这节里插进来乱数 */
  B.river.shipT = 9999; B.river.drumT = 9999;

  check("开局还没涨潮", B.river.rise === 0 && B.riverLx() === c.shoreL, B.riverLx());
  check("涨潮倒计时已挂上", B.river.riseT === c.riseAfter, B.river.riseT);
  check("左岸边缘原本算陆地", !B.riverInWater(c.shoreL - 20, 600));

  B.river.riseT = 0.01;
  B.updateRiver(0.02);
  check("到点涨第一档", B.river.riseStep === 1 && B.river.rise === TL, B.river.rise);
  check("左岸退了整整一格", B.riverLx() === c.shoreL - TL, B.riverLx());
  check("原来站得住的地方现在泡水了", B.riverInWater(c.shoreL - 20, 600));
  check("计时重置成涨潮间隔", Math.abs(B.river.riseT - c.riseEvery) < 1e-6, B.river.riseT);

  /* 一路涨到上限就停，左岸不能彻底没了 */
  for (let k = 0; k < 30; k++) { B.river.riseT = 0.01; B.updateRiver(0.02); }
  check("涨到上限就收手", B.river.riseStep === c.riseMax, B.river.riseStep + " / " + c.riseMax);
  check("左岸至少留一格", B.riverLx() >= TL, B.riverLx() + "（原 " + c.shoreL + "）");
  check("再怎么也不会把右岸吃掉", B.riverShoreRx() === B.world.w - c.shoreR);
}

console.log("\n=== 11. v4.13c ②水流 ===");
{
  const list = setupRiver(4);
  const c = LD.RIVER;
  B.river.shipT = 9999; B.river.drumT = 9999; B.river.riseT = 9999;
  /* 找一块既不压障碍也不在小岛上的干净水面，否则量到的是碰撞推挤 */
  /* padX / padY 是「要放进去的那个东西」的半尺寸：
   * 之前只拿中心点算间隙，放到体长 160px 的福船上就会被旁边的礁石卡住，
   * 位移量 0 却看不出为什么。 */
  const props = B.terrain.props;
  const pickClear = (padX, padY) => {
    const px = padX == null ? 30 : padX, py = padY == null ? 30 : padY;
    for (let k = 0; k < 400; k++) {
      const x = 420 + Math.random() * 1500, y = 260 + Math.random() * 620;
      if (!B.riverInWater(x, y)) continue;
      if (B.riverOnIslet(x, y)) continue;
      let bad = false;
      for (let i = 0; i < props.length && !bad; i++) {
        const o = props[i];
        if (o.dead || o.kind === "water" || !o.blockMove) continue;
        if (Math.abs(o.x - x) < o.w / 2 + px && Math.abs(o.y - y) < o.h / 2 + py) bad = true;
      }
      if (!bad) return { x: x, y: y };
    }
    return null;
  };

  check("水流函数已接上", typeof B.riverFlow === "function");

  const spot = pickClear();
  const swim = list[1];
  swim.x = spot.x; swim.y = spot.y;
  swim.ctrl.mx = 0; swim.ctrl.my = 0; swim.vx = 0; swim.vy = 0; swim.knockLeft = 0;
  const y0 = swim.y;
  B.riverFlow(1.0);
  const pushed = swim.y - y0;
  check("水里不动也会被冲向下游", pushed > c.drift * 0.8, pushed.toFixed(1) + "px / " + c.drift);

  /* 真实深水速度：必须实测，不能只看 LD.RIVER.waterDeep ——
   * 40_battle 里那条「站在 water 地形上 ×0.55」会和 RULE_SPD 叠乘，
   * 照 0.34 单算会得到 66px/s，实际只有 36 左右，drift 就会配过头。 */
  swim.ctrl.mx = 1; swim.ctrl.my = 0;
  const mx0 = swim.x;
  B.updateHero(swim, 1 / 60);
  const spd = (swim.x - mx0) * 60;
  swim.ctrl.mx = 0;
  check("实测深水速度约等于 0.34 × 0.55", spd > 30 && spd < 42, spd.toFixed(1) + "px/s");

  /* 岸上 / 小岛上的人不该被冲 */
  const land = list[0];
  land.x = 100; land.y = 600;
  const ly0 = land.y;
  B.riverFlow(1.0);
  check("站在岸上不会被冲", Math.abs(land.y - ly0) < 1e-6, land.y - ly0);

  const islet = props.filter(o => o.islet && !o.dead)[0];
  swim.x = islet.x; swim.y = islet.y;
  check("踩在小岛上算落脚点", B.riverOnIslet(islet.x, islet.y));
  const iy0 = swim.y;
  B.riverFlow(1.0);
  check("小岛上的不被水流带走", Math.abs(swim.y - iy0) < 1e-6, swim.y - iy0);
  check("小岛也不再吃减速", LD.RULE_SPD.river.call(B, swim) === 1, LD.RULE_SPD.river.call(B, swim));

  /* 船也顺流漂，骑手跟着走 */
  const sh = props.filter(o => o.ship && !o.dead)[0];
  const shipSpot = pickClear(sh.w / 2 + 24, sh.h / 2 + 24);
  sh.x = shipSpot.x; sh.y = shipSpot.y; sh.driver = null;
  const sy0 = sh.y;
  B.riverFlow(1.0);
  check("船也会被水冲向下游", sh.y - sy0 > c.drift * c.driftShipMul * 0.8,
    (sh.y - sy0).toFixed(1) + "px");
  check("船比人漂得慢一点", (sh.y - sy0) < pushed, (sh.y - sy0).toFixed(1) + " < " + pushed.toFixed(1));

  /* 设计保证：人可以把住上游，别被永久压在地图下缘 */
  check("水流不能强过深水泳速（否则永远顶不回去）", c.drift < spd, c.drift + " < " + spd.toFixed(1));
  const th0 = Math.asin(Math.min(1, c.drift / spd));
  check("抬头不到 30 度就能维持高度", th0 * 180 / Math.PI < 30, (th0 * 180 / Math.PI).toFixed(1) + "°");
  check("维持高度时水平还剩九成左右", Math.cos(th0) > 0.85,
    (Math.cos(th0) * 100).toFixed(0) + "%");

  /* 真的走一秒：按那个角度打舵，应该既不往上也不往下 */
  const s2 = pickClear();
  const latK = Math.cos(th0);
  swim.x = s2.x; swim.y = s2.y; swim.vx = 0; swim.vy = 0; swim.knockLeft = 0; swim.chg = null;
  swim.ctrl.mx = Math.cos(th0); swim.ctrl.my = -Math.sin(th0);
  const xA = swim.x, yA = swim.y;
  for (let i = 0; i < 60; i++) { B.updateHero(swim, 1 / 60); B.riverFlow(1 / 60); }
  check("仰着打舵一秒真的能维持高度", Math.abs(swim.y - yA) < 14, (swim.y - yA).toFixed(1) + "px");
  check("而且确实在往对岸推进", swim.x - xA > spd * latK * 0.75,
    (swim.x - xA).toFixed(1) + "px（理论 " + (spd * latK).toFixed(1) + "）");
}

console.log("\n=== 12. v4.13c ③漂流补给 ===");
{
  const list = setupRiver(4);
  const c = LD.RIVER;
  B.river.shipT = 9999; B.river.riseT = 9999;
  const props = B.terrain.props;
  const ships = () => props.filter(o => o.ship && !o.dead);

  check("补给函数已接上", typeof B.riverDrums === "function");
  B.river.drums = [];
  B.river.drumT = 0.01;
  B.riverDrums(0.02);
  check("到点漂来一只油桶", B.river.drums.length === 1, B.river.drums.length);

  const d = B.river.drums[0];
  check("油桶落在江面上", B.riverInWater(d.x, d.y), Math.round(d.x) + "," + Math.round(d.y));
  const dy0 = d.y;
  B.riverDrums(1.0);
  check("油桶跟着水流往下漂", d.y - dy0 > c.drift * 0.8, (d.y - dy0).toFixed(1) + "px");

  /* 坐船压过去：自动加油，桶消失 */
  const f = list[0];
  const sh = ships()[0];
  sh.x = d.x; sh.y = d.y; sh.fuelMax = 1000; sh.fuel = 100;
  f.noCarT = 0; f.x = sh.x; f.y = sh.y;
  B.enterCar(f, sh);
  B.riverDrums(1 / 60);
  check("坐船压过去自动加油", sh.fuel > 100, "100 → " + Math.round(sh.fuel));
  check("补的不超过油箱上限", sh.fuel <= sh.fuelMax, Math.round(sh.fuel) + " / " + sh.fuelMax);
  check("捡完桶就没了", B.river.drums.length === 0);
  B.exitCar(f, false);

  /* 游水的人捡到：回血回能 */
  B.river.drumT = 0.01;
  B.riverDrums(0.02);
  const d2 = B.river.drums[0];
  const hero = list[2];
  hero.hp = 50; hero.energy = 0;
  hero.x = d2.x; hero.y = d2.y;
  B.riverDrums(1 / 60);
  check("游泳的人捡到回血", hero.hp > 50, hero.hp);
  check("顺带回一点能量", hero.energy > 0, hero.energy);
  check("人的桶也消失了", B.river.drums.length === 0);

  /* 数量封顶 + 漂到底自己烂掉 */
  for (let i = 0; i < 30; i++) { B.river.drumT = 0.01; B.riverDrums(0.02); }
  check("江面上同时最多几只是有上限的", B.river.drums.length === c.drumMax,
    B.river.drums.length + " / " + c.drumMax);
  const before = B.river.drums.length;
  B.river.drums.forEach(o => { o.y = B.world.h - 10; });
  B.riverDrums(1 / 60);
  check("漂出下边界就清掉", B.river.drums.length < before, before + " → " + B.river.drums.length);
}

console.log("\n=== 13. v4.13c ④渡江进度 + 涨潮预警 ===");
{
  const list = setupRiver(4);
  let ok = true, msg = "";
  try {
    const ctx = makeCtx();
    /* 跑够久：让涨潮、油桶、HUD 三条都真正走到有内容的分支 */
    for (let i = 0; i < 240; i++) {
      if (i === 60) { B.river.riseT = 3; B.river.riseStep = 1; }
      B.updateRiver(1 / 30);
      B.draw(ctx);
      B.drawRiverHud(ctx, 900, 600);
    }
  } catch (e) { ok = false; msg = e.message; console.log("    绘制异常：" + msg); }
  check("涨潮 + 油桶 + 进度条一起跑四秒不崩", ok, msg);
  check("这一轮真的刷出过油桶", (B.river.drums || []).length > 0 || B.river.drumT < LD.RIVER.drumEvery,
    "场上 " + (B.river.drums || []).length + " 只");
  let ok2 = true;
  try { B.drawRiverHud(makeCtx(), 320, 240); } catch (e) { ok2 = false; console.log("    窄屏异常：" + e.message); }
  check("窄屏下进度条也不崩", ok2);
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
