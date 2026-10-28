/* 孤高旅斗 v3.7 塔防对战测试
 * 覆盖：P 键交互 / 天外来物按 P 拾取与替换 / 柜子躲藏（被打出来 + AI 2 秒察觉）/
 *       汽车驾驶（油量·速度·撞人·下车眩晕·技能禁用·喇叭·坦克炮）/
 *       泥土拾取投掷 / 物资刷新修饰符 / AI 交互欲望 / 交互提示文案
 */
const SB = require("./_sandbox.js");
const { fs, path, html, code, makeCtx, makeEl } = SB;
const makeSandbox = (label) => SB.makeSandbox(label, { image: false });

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}


const sb = makeSandbox();
const LD = sb.LD, B = LD.Battle, T = LD.Terrain;
LD.CONF.critRate = 0;
const C = LD.TOWER;
const BASE = { basic: "slash", skill1: "dashSlash", skill2: "chain", ult: "bloodRage" };

function mkHero(side, lo) {
  const f = B.mkHero(side, { x: 0, y: 0, look: LD.Profile.look(), loadout: lo || BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
function field(n, bots, teams) {
  const fs2 = [];
  for (let i = 0; i < (n || 6); i++) {
    const f = mkHero(i);
    if (bots && i > 0) LD.AI.mkBot(f, "normal");
    fs2.push(f);
  }
  B.setup({ mode: "duel", rule: "tower", fighters: fs2, isHost: true, mySide: 0, matchT: 600, teams: teams });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0; B.roundT = 0;
  fs2.forEach(f => { f.invuln = 0; });
  return fs2;
}
const propsOf = kind => B.terrain.props.filter(o => o.kind === kind && !o.dead);
const step = dt => B.update(dt || 1 / 60);
const stepN = n => { for (let i = 0; i < n; i++) step(); };

console.log("=== 1. 配置 / 地图 / 分队 ===");
{
  check("规则表里有塔防对战", LD.RULES.some(r => r.id === "tower"));
  check("地图 2800 x 600", C.world.w === 2800 && C.world.h === 600, C.world.w + "x" + C.world.h);
  check("兵线 400 / 建筑抬高 110", C.laneY === 400 && C.structDy === 110);
  const hs = field(6, false);
  check("双方各一座水晶", propsOf("crystal").length === 2);
  check("双方各两座防御塔", propsOf("tower").length === 4);
  const cr = propsOf("crystal").sort((a, b) => a.side - b.side);
  check("水晶左右镜像", Math.abs((cr[0].x + cr[1].x) - B.world.w) < 2, cr[0].x + "/" + cr[1].x);
  const ts = propsOf("tower").sort((a, b) => a.side - b.side || a.x - b.x);
  check("一塔之间留出中心战斗区（≥500px）", Math.abs(ts[1].x - ts[2].x) >= 500, ts.map(o => o.x).join(","));
  check("3v3 分队：前三红队 / 后三蓝队", hs.every((f, i) => f.team === (i < 3 ? 0 : 1)), hs.map(f => f.team).join(","));
  check("开局金币 200 / 等级 1 / 死亡 0", hs.every(f => f.bcoins === 200 && f.level === 1 && f.deaths === 0));
  check("塔防保留大招", hs.every(f => !!f.loadout.ult));
  check("英雄出生在自家基地附近", hs[0].x < 260 && hs[5].x > B.world.w - 260,
    Math.round(hs[0].x) + " / " + Math.round(hs[5].x));
  check("中心没有猴子了", propsOf("monkey").length === 0);
  check("塔 1200 血 / 水晶 2400 血", C.tower.hp === 1200 && C.crystal.hp === 2400);
  check("塔/水晶射程 300 / 340", C.tower.range === 300 && C.crystal.range === 340);
  check("建筑弹道高速且带追踪", C.tower.projSpeed >= 1000 && C.tower.homing > 0 && C.crystal.homing > 0);
  check("地图会生成随机设施（含车辆/坦克的可能）",
    B.terrain.props.some(o => ["solid", "breakable", "bush", "barrel", "car", "barricade", "pushable", "tire"].indexOf(o.kind) >= 0));
}

console.log("\n=== 2. 建筑：可破坏 / 水晶保护 ===");
{
  field(2, false);
  const cry = propsOf("crystal").find(o => o.side === 1);
  const towers = propsOf("tower").filter(o => o.side === 1);
  const hp0 = cry.hp;
  T.hitProp(B.terrain, cry, 200, { dir: 0 });
  check("防御塔还在时水晶免疫伤害", cry.hp === hp0, cry.hp + "/" + hp0);
  towers.forEach(o => { T.hitProp(B.terrain, o, 99999, { dir: 0 }); });
  check("防御塔可以被破坏", towers.every(o => o.dead));
  T.hitProp(B.terrain, cry, 200, { dir: 0 });
  check("塔倒后水晶可以被打", cry.hp === hp0 - 200, cry.hp);
  T.hitProp(B.terrain, cry, 99999, { dir: 0 });
  check("水晶被拆 → 对局结束", cry.dead && B.state === "over");
  check("胜利方是进攻方", B.matchWinner === 0, B.matchWinner);
}

console.log("\n=== 3. 防御塔 / 水晶开火 ===");
{
  const hs = field(2, false);
  const foe = hs[1];
  const tower = propsOf("tower").find(o => o.side === 0);
  B.projs.length = 0; tower.shotT = 0;
  foe.x = tower.x + tower.w / 2 + 120; foe.y = tower.y;
  foe.invuln = 0;
  stepN(2);
  check("进入圆圈范围的敌人被锁定", tower._target === foe, tower._target && tower._target.name);
  const bolt = B.projs.find(p => p.type === "towerbolt");
  check("射出追踪炮弹", !!bolt && bolt.homing > 0 && bolt.data.tgt === foe,
    bolt ? "speed=" + Math.round(Math.hypot(bolt.vx, bolt.vy)) + " homing=" + bolt.homing : "没出弹");
  check("炮弹速度 ≥1000", bolt && Math.hypot(bolt.vx, bolt.vy) >= 1000);
  const hpA = foe.hp;
  B.damage(tower.src || B.towerSrc(tower), foe, 26, { type: "skill", proj: true });
  check("炮弹按配置伤害结算", foe.hp === hpA - 26, hpA + " → " + foe.hp);
  foe.x = tower.x + 900; foe.y = tower.y;
  stepN(16);
  check("离开范围后不再锁定", !tower._target);
}

console.log("\n=== 4. 兵线 ===");
{
  const hs = field(6, false);
  check("开局 9 秒内没有小兵", B.fighters.every(f => f.kind !== "laneMinion"));
  for (let i = 0; i < 9 * 60; i++) step();
  check("9 秒还没刷", B.fighters.every(f => f.kind !== "laneMinion"));
  stepN(70);
  const ms = B.fighters.filter(f => f.kind === "laneMinion");
  check("10 秒刷第一波：双方各 6 只", ms.filter(m => m.team === 0).length === 6 && ms.filter(m => m.team === 1).length === 6, ms.length);
  check("小兵血量改成原来的 70%（67）", ms[0].maxHp === 67, ms[0].maxHp);
  const x0 = ms[0].x;
  stepN(60);
  check("小兵沿兵线推进", Math.abs(ms[0].x - x0) > 20, Math.round(ms[0].x - x0) + "px");
}

console.log("\n=== 5. 金币 / 经验 / 等级 ===");
{
  const hs = field(2, false);
  const me = hs[0];
  me.bcoins = 200; me.xp = 0; me.level = 1;
  B.spawnTowerWave(0);
  const mm = B.fighters.filter(f => f.kind === "laneMinion" && f.team === 0)[0];
  B.kill(mm, me);
  check("击杀小兵 +32 金币", me.bcoins === 232, me.bcoins);
  check("击杀小兵 +20 经验", me.xp === 20, me.xp);
  B.towerXp(me, 80);
  check("满 100 经验升到 2 级", me.level === 2 && me.maxHp === LD.CONF.hero.hp + C.levelHp);
  const hs3 = field(3, false);
  const A = hs3[0], mate = hs3[1], foe = hs3[2];
  B.damage(mate, foe, 10, { type: "skill" });
  B.damage(A, foe, 9999, { type: "skill" });
  check("击杀英雄 +240", A.bcoins >= 440, A.bcoins);
  check("助攻 +120", mate.bcoins >= 320, mate.bcoins);
  check("队伍击杀计分", B.tScore[0] === 1, B.tScore.join(":"));
  check("击杀者 K / 阵亡者 D 有记录", A.kills === 1 && foe.deaths === 1, A.kills + "/" + foe.deaths);
}

console.log("\n=== 6. 局内装备 ===");
{
  const hs = field(2, false);
  const me = hs[0];
  me.bcoins = 9999; me.items = {}; me.activeItem = null; me.dmgBonus = 0; me.dr = 0;
  const hp0 = me.maxHp;
  check("生命宝石 +160", B.towerBuy(me, "hp") && me.maxHp === hp0 + 160);
  check("不能重复购买被动", B.towerBuy(me, "hp") === false);
  check("力量护腕 +18% 伤害", B.towerBuy(me, "atk") && Math.abs(me.dmgBonus - 0.18) < 1e-6);
  check("能量水晶：能量获取 +15%", B.towerBuy(me, "energy") && Math.abs(me.energyMul - 1.15) < 1e-6, me.energyMul);
  check("钢甲：飞行物减伤 20%", B.towerBuy(me, "steel") && Math.abs(me.projDR - 0.20) < 1e-6);
  check("魔法斗篷：12% 闪避", B.towerBuy(me, "cloak") && Math.abs(me.dodgeChance - 0.12) < 1e-6);
  check("续航宝石 / 还魂曲 / 敢死队已上架",
    ["regen", "requiem", "brave"].every(id => !!LD.towerItem(id)));
  check("主动装备只能带一件", B.towerBuy(me, "heal") && B.towerBuy(me, "bomb") === false);
  me.hp = 10;
  check("按 P 释放治疗", B.useTowerActive(me) && me.hp > 10 && me.activeCd > 0);
  /* 高压弹 */
  const hs2 = field(2, false);
  const m2 = hs2[0];
  m2.items = {}; m2.activeItem = "bomb"; m2.bcoins = 999;
  m2.x = 700; m2.y = C.laneY;
  B.dropBomb(m2);
  const foe2 = hs2[1];
  foe2.team = 1; foe2.x = 730; foe2.y = C.laneY; foe2.hp = 200; foe2.invuln = 0;
  const hpB = foe2.hp;
  for (let i = 0; i < 200; i++) step();
  check("高压弹 3 秒后爆炸并造成 100 伤害", foe2.hp <= hpB - 100, hpB + " → " + foe2.hp);
  /* 刺甲 */
  const f3 = field(2, false)[0];
  f3.reflectT = 4; f3.hp = 200;
  const e3 = B.fighters[1]; e3.team = 1; e3.hp = 200; e3.invuln = 0;
  const hpE = e3.hp;
  B.damage(e3, f3, 40, { type: "skill" });
  check("刺甲反弹 50% 伤害", e3.hp === hpE - 20 && f3.hp === 200 - 40, "对方 " + e3.hp + " 自己 " + f3.hp);
  /* 寒霜 */
  const f4 = field(2, false)[0];
  f4.activeItem = "frost"; f4.activeCd = 0;
  const e4 = B.fighters[1]; e4.team = 1; e4.x = f4.x + 40; e4.y = f4.y;
  B.useTowerActive(f4);
  check("寒霜冻结身边敌人 2.5 秒", e4.stun >= 2.4, e4.stun.toFixed(1));
  /* 团队强化 */
  const f5 = field(6, false)[0];
  f5.bcoins = 9999;
  for (let i = 0; i < 5; i++) B.towerBuy(f5, "minionHp");
  check("强化小兵血量可叠 5 层", B.towerStack(f5, "minionHp") === 5, B.towerStack(f5, "minionHp"));
  check("叠满后不能再买", B.towerBuy(f5, "minionHp") === false);
  B.towerBuy(f5, "minionAtk");
  check("强化小兵攻击单独计层", B.towerStack(f5, "minionAtk") === 1);
  B.spawnTowerWave(0);
  const up = B.fighters.filter(f => f.kind === "laneMinion" && f.team === 0).pop();
  check("强化后小兵更肉更疼", up.maxHp > 67 && up.dmg > 9, up.maxHp + "hp / " + up.dmg + "atk");
  /* v3.9 汽油桶：只有车上能买，80 金 +2000 油，无限买 */
  const fuel = LD.towerItem("fuel");
  check("汽油桶已上架（团队道具，80 金）", !!fuel && fuel.price === 80 && LD.TOWER.fuel.add === 2000);
  const f6 = field(2, false)[0];
  f6.bcoins = 9999; f6.items = {}; f6.activeItem = null;
  check("没上车买不了汽油桶", B.towerBuy(f6, "fuel") === false);
  const car = B.terrain.props.find(o => o.kind === "car");
  check("地图上至少有一辆车", !!car, car && car.vtype);
  if (car) {
    f6.rideCar = car;
    const gold0 = f6.bcoins;
    car.fuelMax = 3000; car.fuel = 1000;
    check("车上买汽油桶 +2000 油", B.towerBuy(f6, "fuel") && car.fuel === 3000, car.fuel);
    check("汽油桶扣 80 金", f6.bcoins === gold0 - 80, f6.bcoins);
    check("油箱已满时不能再买", B.towerBuy(f6, "fuel") === false);
    car.fuel = 0;
    for (let i = 0; i < 3; i++) B.towerBuy(f6, "fuel");
    check("汽油桶可以无限买（不占装备格）", car.fuel === 3000 && !(f6.items || {}).fuel, car.fuel);
    f6.rideCar = null;
  }
}

console.log("\n=== 7. 复活 / 墓碑 ===");
{
  const hs = field(2, false);
  const me = hs[0], foe = hs[1];
  me.team = 0; foe.team = 1;
  me.hp = 1; me.x = 800; me.y = C.laneY;
  B.damage(foe, me, 999, { type: "skill" });
  /* v3.9 复活改为 5 秒 + 等级 × 5 秒：1 级 10s、5 级 30s */
  check("阵亡进入复活倒计时（5 + 等级×5）",
    me.dead && Math.abs(me.respawnT - (5 + (me.level || 1) * 5)) < 0.2, me.respawnT.toFixed(1) + "s");
  check("原地留下墓碑", (B.graves || []).some(g => g.hero === me && Math.abs(g.x - 800) < 1));
  const waitFrames = Math.ceil(me.respawnT * 60) + 12;   // 先算好帧数，别在循环条件里读会变化的 respawnT
  for (let i = 0; i < waitFrames; i++) step();
  check("倒计时结束在基地复活", !me.dead && me.hp === me.maxHp && me.x < 260);
  check("墓碑消失", !(B.graves || []).some(g => g.hero === me));
  check("复活后短暂无敌", me.invuln > 0, me.invuln.toFixed(1));
  /* v3.9 基地回血大幅提高：12% 最大生命 / 秒 */
  const me2 = field(2, false)[0];
  const base = B.towerBase(me2.team === 1 ? 1 : 0);
  me2.x = base.x; me2.y = base.y; me2.hp = 60;
  const before = me2.hp;
  stepN(60);
  check("基地回血 12% / 秒", me2.hp - before >= me2.maxHp * 0.11, Math.round(me2.hp - before) + " / " + Math.round(me2.maxHp));

  /* 5 级阵亡：5 + 5×5 = 30 秒 */
  const hs5 = field(2, false);
  const h5 = hs5[0];
  h5.team = 0; h5.level = 5; h5.hp = 1; h5.x = 800; h5.y = C.laneY;
  B.damage(hs5[1], h5, 999, { type: "skill" });
  check("5 级阵亡复活 30 秒", h5.dead && Math.abs(h5.respawnT - 30) < 0.2, h5.respawnT.toFixed(1) + "s");
}

console.log("\n=== 7.5 推掉两塔后 AI 仍会推水晶 / 满血不冥想 ===");
{
  const MEDI = { basic: "slash", skill1: "meditate", skill2: "chain", ult: "bloodRage" };
  const hs = [];
  for (let i = 0; i < 6; i++) {
    const f = mkHero(i, i === 3 ? MEDI : null);
    LD.AI.mkBot(f, "normal");
    hs.push(f);
  }
  B.setup({ mode: "duel", rule: "tower", fighters: hs, isHost: true, mySide: 0, matchT: 600 });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0; B.roundT = 0;
  hs.forEach(f => { f.invuln = 0; });

  /* 蓝队两座塔全拆掉，只剩水晶 */
  B.terrain.props.filter(o => o.kind === "tower" && o.side === 1).forEach(o => { o.dead = true; o.hp = 0; });
  const cry = B.terrain.props.find(o => o.kind === "crystal" && o.side === 1);
  const red = hs.filter(f => f.team === 0);
  red.forEach(f => { f.x = cry.x - 300; f.y = C.laneY; f.hp = f.maxHp; });
  /* 守方拉到兵线上方远处：贴脸时 AI 理应先打人，这里测的是「没人贴身就专心推水晶」 */
  hs.filter(f => f.team === 1).forEach(f => { f.x = cry.x; f.y = 110; f.hp = f.maxHp; });

  /* 关键：enemyStructure 返回的是 prop，上面没有 .d —— 距离要自己算 */
  const ord = B.enemyStructure(0, red[0].x, red[0].y, 2000);
  check("推掉两塔后目标是水晶", ord && ord.kind === "crystal", ord && ord.kind);
  check("距离由调用方计算（prop 上没有 .d）", ord && ord.d === undefined);

  /* v3.9 新规则：没有兵线顶着时 AI 不会一个人钻进水晶火力圈，所以这里持续补兵压到水晶前。
   * 小兵 dmg 设为 0 —— 水晶掉下来的血必须来自英雄，否则这条断言会被兵线蒙混过关。
   * 小兵血量拉满且每帧回满：水晶会优先点兵，兵被点光的话 AI 就没有「顶在前面」的
   * 许可，一路在外围瞄着不动，二十秒下来水晶一滴血不掉 —— 这条断言于是变成
   * 「兵线活得够不够久」的抽奖（实测四次挂一次）。把兵钉成点不死的肉盾，
   * 测的就只剩「AI 肯不肯上手打水晶」这一件事。 */
  const topLane = () => {
    const mins = B.fighters.filter(f => f.kind === "laneMinion" && f.team === 0 && !f.dead);
    if (mins.length < 3) B.spawnTowerWave(0);
    B.fighters.filter(f => f.kind === "laneMinion" && f.team === 0 && !f.dead).forEach((m, i) => {
      m.x = cry.x - 170 - (i % 3) * 22;
      m.y = C.laneY + (Math.floor(i / 3) * 22 - 11);
      m.dmg = 0;
      m.maxHp = m.hp = 9999;
      m.invuln = 0;
    });
  };
  topLane();

  let aimed = 0;                                    // 累计有多少帧有人在瞄水晶（瞬时采样会被残血回家打断）
  for (let i = 0; i < 60 * 20; i++) {
    hs.forEach(f => { if (!f.dead) LD.AI.tickHero(f, 1 / 60); });
    step();
    if (i % 90 === 0) topLane();                    // 兵线会被水晶点掉，持续补兵才像真实的推进
    if (red.some(f => f.aimProp === cry)) aimed++;
  }
  check("AI 会真的去打水晶", cry.hp < cry.maxHp, Math.round(cry.hp) + "/" + Math.round(cry.maxHp));
  check("AI 会瞄准水晶", aimed > 0, aimed + " 帧");

  /* 满血的人机不应该按冥想 */
  const medi = hs[3];
  let used = 0;
  const _ts = B.trySlot;
  B.trySlot = function (f, slot, ctrl) {
    if (f === medi && slot === "skill1" && f.hp >= f.maxHp * 0.999) used++;
    return _ts.apply(this, arguments);
  };
  medi.hp = medi.maxHp;
  medi.cd.skill1 = 0;
  for (let i = 0; i < 60 * 20; i++) {
    hs.forEach(f => { if (!f.dead) LD.AI.tickHero(f, 1 / 60); });
    step();
    medi.hp = medi.maxHp;                       // 全程满血
  }
  check("满血时不会按冥想（推塔不再乱放回复技）", used === 0, used + " 次");
  B.trySlot = _ts;
}

console.log("\n=== 7.6 v3.9 无兵线不顶塔 / 塔下挨打先撤出塔圈 ===");
{
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const towerR = C.tower.range + C.tower.r;          // 塔的火力圈半径
  const mkField = () => {
    const hs = [];
    for (let i = 0; i < 6; i++) { const f = mkHero(i); LD.AI.mkBot(f, "normal"); hs.push(f); }
    B.setup({ mode: "duel", rule: "tower", fighters: hs, isHost: true, mySide: 0, matchT: 600 });
    B.resetRound(false);
    B.state = "fight"; B.countdown = 0; B.roundT = 0;
    hs.forEach(f => { f.invuln = 0; });
    return hs;
  };

  /* A. 开局没有兵线：AI 停在塔火力圈外等兵，不一个人钻进去挨打 */
  {
    const hs = mkField();
    const red = hs.filter(f => f.team === 0);
    const blue = hs.filter(f => f.team === 1);
    B.fighters = B.fighters.filter(f => f.kind !== "laneMinion");
    blue.forEach((f, i) => { f.x = 2500 + i * 26; f.y = 290; });   // 守方缩在自家水晶边
    const tw = propsOf("tower").filter(o => o.side === 1).sort((a, b) => a.x - b.x)[0];
    let minD = 1e9, inside = 0, lost = 0;
    const hp0 = red.map(f => f.hp);
    for (let i = 0; i < 60 * 12; i++) {
      red.forEach(f => { if (!f.dead) LD.AI.tickHero(f, 1 / 60); });
      step();
      B.fighters = B.fighters.filter(f => f.kind !== "laneMinion");   // 全程不放兵线
      red.forEach(f => { const dd = d(f, tw); if (dd < minD) minD = dd; if (dd < towerR) inside++; });
    }
    lost = red.reduce((s, f, i2) => s + Math.max(0, hp0[i2] - f.hp), 0);
    check("没有兵线时 AI 不踏进塔的火力圈", inside === 0, "最近 " + Math.round(minD) + "px / 火力圈 " + towerR + "px");
    check("没有兵线时推塔不掉血", lost === 0, Math.round(lost) + " 血");
    check("停在火力圈外一点点（不是原地不动）", minD < towerR + 120, Math.round(minD - towerR) + "px 余量");
  }

  /* B. 兵线打光、人还站在塔圈里挨打 → 优先撤出塔圈，而不是等到残血才回家 */
  {
    const hs = mkField();
    const red = hs.filter(f => f.team === 0);
    const blue = hs.filter(f => f.team === 1);
    B.fighters = B.fighters.filter(f => f.kind !== "laneMinion");
    blue.forEach((f, i) => { f.x = 2500 + i * 26; f.y = 290; f.hp = f.maxHp; });
    const tw = propsOf("tower").filter(o => o.side === 1).sort((a, b) => a.x - b.x)[0];
    const me = red[0];
    red.slice(1).forEach((f, i) => { f.x = 700 + i * 30; f.y = 290; f.hp = f.maxHp; });
    me.x = tw.x - 160; me.y = tw.y + 20; me.hp = me.maxHp; me.invuln = 0;
    let outT = -1;
    for (let i = 0; i < 60 * 8; i++) {
      red.forEach(f => { if (!f.dead) LD.AI.tickHero(f, 1 / 60); });
      step();
      B.fighters = B.fighters.filter(f => f.kind !== "laneMinion");
      if (outT < 0 && d(me, tw) > towerR + 20) outT = i / 60;
    }
    check("塔圈里挨打会撤出来", outT >= 0, outT >= 0 ? outT.toFixed(2) + "s" : "8 秒没撤");
    check("撤得早（不是掉到残血才回家）", outT >= 0 && outT < 4 && me.hp > me.maxHp * 0.5,
      outT >= 0 ? "剩 " + Math.round(me.hp) + "/" + me.maxHp + " 血" : "—");
  }

  /* C. 塔防里不去找柜子 / 车 / 泥土：有塔要推，别脱离兵线乱跑 */
  {
    const hs = mkField();
    stepN(30);
    hs.forEach(f => { if (!f.dead) LD.AI.tickHero(f, 1 / 60); });
    check("塔防模式下 AI 不产生交互目标（柜子/车/泥土）", hs.every(f => !f.useTarget));
  }
}

console.log("\n=== 7.7 v3.9 塔防蓝队队色 / 车辆要能开出去 ===");
{
  const hs = field(6, false);
  /* 蓝队队色：塔防只有红蓝两队，不能沿用四队配色的「1 号 = 黄」 */
  check("塔防 0 队 = 红", LD.teamColor(0) === "#f87171", LD.teamColor(0));
  check("塔防 1 队 = 蓝（不是黄）", LD.teamColor(1) === "#60a5fa", LD.teamColor(1));
  const keepRule = B.rule;
  B.rule = "team";
  check("非塔防仍走四队配色（1 号黄队）", LD.teamColor(1) === "#fbbf24", LD.teamColor(1));
  B.rule = keepRule;
  check("切回塔防后 1 号又是蓝队", LD.teamColor(1) === "#60a5fa", LD.teamColor(1));
  check("头顶名字取的就是这个色", LD.teamColor(hs[3].team) === "#60a5fa", "team=" + hs[3].team);

  /* 车辆：至少有一个方向能一口气开出 80px，且与最近的阻挡物留有间隙 */
  const cars = B.terrain.props.filter(o => o.kind === "car" && !o.dead);
  check("塔防地图刷出了车", cars.length >= 2, cars.length + " 辆");
  const freeRun = (o, dx, dy) => {
    let d = 0;
    const x0 = o.x, y0 = o.y;
    for (; d < 320; d += 4) {
      const nx = x0 + dx * d, ny = y0 + dy * d;
      if (nx < o.w / 2 + 4 || nx > B.world.w - o.w / 2 - 4) break;
      if (ny < B.world.pt + o.h / 2 + 2 || ny > B.world.h - o.h / 2 - 4) break;
      if (T.blockedAt(B.terrain, o, nx, ny)) break;
    }
    o.x = x0; o.y = y0;
    return d;
  };
  const dirs = [[1, 0], [-1, 0], [0, -1], [0, 1]];
  const worst = cars.map(o => Math.max(...dirs.map(d => freeRun(o, d[0], d[1]))));
  check("每辆车至少有一个方向能开出 80px（不然一上去就卡死）",
    worst.every(v => v >= 80), worst.join(","));
  const gapOf = o => {
    let g = Infinity;
    B.terrain.props.forEach(p => {
      if (p === o || p.dead || !p.blockMove) return;
      const gx = Math.abs(p.x - o.x) - (p.w + o.w) / 2;
      const gy = Math.abs(p.y - o.y) - (p.h + o.h) / 2;
      if (gx < 0 && gy < 0) g = -1;                        // 重叠
      else g = Math.min(g, Math.max(gx, gy));
    });
    return g;
  };
  const gaps = cars.map(gapOf);
  check("车与最近阻挡物的间隙 ≥ 40px", gaps.every(g => g >= 40), gaps.map(g => Math.round(g)).join(","));
}

console.log("\n=== 8. 无时限 ===");
{
  const hs = field(2, false);
  check("塔防没有时间限制", C.matchT === 0 && (B.towerT || 0) === 0);
  B.tScore = [3, 1];
  stepN(60 * 5);
  check("打了 5 分钟仍不结算（只有水晶能结束）", B.state === "fight" && B.matchWinner === -1);
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
