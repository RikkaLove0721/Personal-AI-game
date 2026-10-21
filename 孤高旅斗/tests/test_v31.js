/* 孤高旅斗 v3.1 测试
 * 覆盖：
 *   ① 新地形设施（草丛 / 水池 / 炸药桶 / 汽车 / 轮胎 / 补给箱 / 路障 / 建筑）
 *   ② 可推动物体的推挤与击飞
 *   ③ 墙体概念：边界 + 障碍、赫撞墙、苍撞墙
 *   ④ 新技能：钢链 / 运货 / 咸鱼 / 突击枪
 *   ⑤ 新大招：爆裂之火 / 流水碎岩拳 / 黄金弹力炮
 *   ⑥ 败者食尘回溯技能 CD
 *   ⑦ 死战闯关配置与结算
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
const LD = sb.LD, B = LD.Battle, T = LD.Terrain, UI = LD.UI;
LD.CONF.critRate = 0;

function mkProp(kind, matId, x, y, cw, ch) {
  const list = LD.TERRAIN.mats[kind] || [];
  const m = list.find(v => v.id === matId) || list[0] || LD.TERRAIN.mats.solid[0];
  cw = cw || 1; ch = ch || 1;
  const def = LD.TERRAIN.types[kind] || {};
  return {
    uid: Math.floor(Math.random() * 1e6), kind: kind, mat: m.id, shape: m.shape,
    cw: cw, ch: ch, w: cw * 40, h: ch * 40, x: x, y: y, ox: x, oy: y,
    elev: m.elev, mass: m.mass, hp: m.hp || 0, maxHp: m.hp || 0,
    dead: false, flash: 0, vx: 0, vy: 0, free: false, variant: 1,
    blockMove: !!def.blockMove, blockProj: !!def.blockProj
  };
}
function miniMap(props) {
  return { tile: 40, cols: 40, rows: 37, top: 120, cfg: { ground: "grass" }, props: props || [], ground: [] };
}
function mkHero(side, loadout) {
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(),
    loadout: loadout || { basic: "slash", skill1: null, skill2: null, ult: null }, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  return f;
}
function setupDuel(a, e, mapCfg) {
  B.setup({ mode: "duel", rule: "brawl", fighters: [a, e],
    mapCfg: mapCfg || { preset: "arena", counts: { solid: 0, breakable: 0, pushable: 0, fence: 0 },
      bush: 0, water: 0, barrel: 0, car: 0, tire: 0, supply: 0, barricade: 0, room: 0, seed: 7 } });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  a.x = 600; a.y = 900; e.x = 1100; e.y = 900;
}
function step(n, dt) {
  for (let i = 0; i < n; i++) B.update(dt || 1 / 60);
}

console.log("=== 1. 新技能 / 大招数据 ===");
["chain", "cargo", "fish", "assault"].forEach(id => {
  const s = LD.skill(id);
  check("技能「" + id + "」已注册", !!s && s.kind === "skill" && s.price === 6, s && s.name + " cd=" + s.cd);
});
check("钢链：10 / 22 伤害、250 距离、0.4s 前摇", LD.skill("chain").dmg === 10 &&
  LD.skill("chain").farDmg === 22 && LD.skill("chain").range === 250 && LD.skill("chain").charge === 0.4);
check("运货：蓄力 1s / 木箱 20 血 / 25 伤害", LD.skill("cargo").charge === 1 &&
  LD.skill("cargo").crateHp === 20 && LD.skill("cargo").dmg === 25);
check("咸鱼：26 伤害 / 吸 20 能量", LD.skill("fish").dmg === 26 && LD.skill("fish").drain === 20);
check("突击枪：600 距离 / 8 发 / 每发 5", LD.skill("assault").range === 600 &&
  LD.skill("assault").n === 8 && LD.skill("assault").dmg === 5);
["blaze", "rockFist", "goldCannon"].forEach(id => {
  const s = LD.skill(id);
  check("大招「" + id + "」已注册", !!s && s.kind === "ult" && s.price === 10, s && s.name);
});
check("爆裂之火：外圈 150 / 内圈 55 / 蓄力 0.6s / 12 颗火球 2s",
  LD.skill("blaze").outer === 150 && LD.skill("blaze").inner === 55 &&
  LD.skill("blaze").charge === 0.6 && LD.skill("blaze").drops === 12 && LD.skill("blaze").dur === 2);
check("流水碎岩拳：5 拳 ×10 伤 / 200 距离", LD.skill("rockFist").punches === 5 &&
  LD.skill("rockFist").dmg === 10 && LD.skill("rockFist").move === 200);
check("黄金弹力炮：2000 总弹射距离", LD.skill("goldCannon").dist === 2000);

console.log("\n=== 2. 地形数据与新设施 ===");
check("赫：15 伤害 + 撞墙 15", LD.skill("he").dmg === 15 && LD.skill("he").wallDmg === 15);
check("苍：撞墙额外 18", LD.skill("cang").wallDmg === 18);
["bush", "water", "barrel", "car", "tire", "supply", "barricade", "room"].forEach(k =>
  check("地形类型「" + k + "」存在", !!LD.TERRAIN.types[k]));
check("草丛 / 水池是软地形（不挡人）",
  !LD.TERRAIN.types.bush.blockMove && !LD.TERRAIN.types.water.blockMove);
check("汽车 / 轮胎可推动且不可破坏",
  ["car", "tire"].every(k => LD.TERRAIN.types[k].pushable && !LD.TERRAIN.types[k].damageable));
check("炸药桶会爆炸、补给箱会掉落",
  LD.TERRAIN.types.barrel.explosive && LD.TERRAIN.types.supply.drop);
check("城市预设存在且房间数量 > 0",
  !!LD.MAPS.presets.find(p => p.id === "city") && LD.MAPS.presets.find(p => p.id === "city").counts.room === 3);
check("房间滑条上限 3", LD.MAPS.sliders.find(s => s.key === "room").max === 3);

console.log("\n=== 3. 城市地图生成 ===");
const cityCfg = LD.mapCfg({ preset: "city", seed: 4242 });
const MC = T.build(cityCfg, { w: 1600, h: 1600, pt: 120 }, []);
const kinds = {};
MC.props.forEach(o => { kinds[o.kind] = (kinds[o.kind] || 0) + 1; });
check("城市图生成了建筑墙体", (kinds.room || 0) >= 8, JSON.stringify(kinds));
check("城市图生成了汽车", (kinds.car || 0) >= 1, kinds.car);
check("城市图生成了路障 / 补给箱", (kinds.barricade || 0) + (kinds.supply || 0) >= 1);
check("汽车占多格", MC.props.some(o => o.kind === "car" && (o.cw > 1 || o.ch > 1)));
check("建筑墙按条合并（不是单格碎块）", MC.props.some(o => o.kind === "room" && (o.cw > 1 || o.ch > 1)));
check("城市图空格连通", T.connected(MC.occ, MC.cols, MC.rows));
check("房间内部铺了木地板", MC.ground.some(row => row.indexOf("wood") >= 0));

console.log("\n=== 3.5 水池放大 / 补给箱血量 ===");
{
  const cfg = LD.mapCfg({ preset: "arena", seed: 9090, counts: {
    solid: 0, breakable: 0, pushable: 0, fence: 0, bush: 0, barrel: 0, car: 0, tire: 0,
    supply: 0, barricade: 0, room: 0, locker: 0, mud: 0, water: 3 } });
  const MW = T.build(cfg, { w: 1600, h: 1600, pt: 120 }, []);
  const ws = MW.props.filter(o => o.kind === "water");
  const tiles = ws.map(o => o.cw * o.ch);
  check("水池生成 3 个", ws.length === 3, ws.length);
  check("单池 10~12 格（约 12 格连成一片）", tiles.every(t => t >= 10 && t <= 12), tiles.join(","));
  check("水池是成片大池（长边至少 3 格）",
    ws.every(o => Math.max(o.cw, o.ch) >= 3), ws.map(o => o.cw + "x" + o.ch).join(" "));
}
{
  const box = mkProp("supply", "crate_supply", 800, 700, 1, 1);
  check("补给箱 20 血（打破所需伤害减半）", box.hp === 20 && box.maxHp === 20, box.maxHp);
  const m = miniMap([box]);
  T.hitProp(m, box, 19, { melee: true, dir: 0 });
  check("19 点伤害还打不爆", !box.dead && box.hp === 1, box.hp);
  T.hitProp(m, box, 1, { melee: true, dir: 0 });
  check("再补 1 点就爆并掉落", box.dead && (m.drops || []).length === 1, (m.drops || []).length);
}

console.log("\n=== 4. 推挤与可移动物 ===");
{
  const tire = mkProp("tire", "tire_black", 700, 900, 1, 1);
  const m = miniMap([tire]);
  const f = { x: 680, y: 900, r: 16 };
  T.collideFighter(m, f, 1 / 60);
  check("角色走路能把轮胎顶走", tire.x > 700, tire.x.toFixed(1));
  check("推东西时角色进入受阻状态", f.pushT > 0, f.pushT);
  check("角色不会被推进轮胎里", f.x <= tire.x - 20 - 16 + 0.3, f.x.toFixed(1));
}
{
  const b1 = mkProp("pushable", "block_stone", 700, 700, 1, 1);
  const b2 = mkProp("pushable", "block_wood", 900, 700, 1, 1);
  const m = miniMap([b1, b2]);
  T.hitProp(m, b1, 30, { dir: 0, melee: false });
  T.hitProp(m, b2, 30, { dir: 0, melee: false });
  check("可推动物受击获得速度", Math.hypot(b1.vx, b1.vy) > 0, Math.hypot(b1.vx, b1.vy).toFixed(0));
  check("木块比石块飞得快", Math.hypot(b2.vx, b2.vy) > Math.hypot(b1.vx, b1.vy));
}
{
  const barrel = mkProp("barrel", "barrel_red", 700, 700, 1, 1);
  const m = miniMap([barrel]);
  T.hitProp(m, barrel, 999, { melee: true, dir: 0 });
  check("炸药桶被打爆后排队爆炸", barrel.dead && (m.booms || []).length === 1,
    (m.booms || []).length);
  const box = mkProp("supply", "crate_supply", 800, 700, 1, 1);
  const m2 = miniMap([box]);
  T.hitProp(m2, box, 999, { melee: true, dir: 0 });
  check("补给箱被打爆后排队掉落", box.dead && (m2.drops || []).length === 1, (m2.drops || []).length);
}

console.log("\n=== 5. 墙体概念 ===");
{
  const a = mkHero(0, { basic: "slash", skill1: "he", skill2: null, ult: null });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  B.terrain = miniMap([mkProp("solid", "stone", 1000, 900, 1, 1)]);
  check("地图边界算墙", B.hitWallAt(a, 10, 900) && B.hitWallAt(a, 1590, 900));
  check("障碍（含可破坏物）算墙",
    B.hitWallAt(a, 982, 900) &&
    B.hitWallAt(Object.assign({}, a, { r: 16 }), 966, 900) === true);
  /* 赫：无墙时只吃 15 */
  B.terrain = miniMap([]);
  a.x = 760; a.y = 900; e.x = 880; e.y = 900;
  a.facing = { x: 1, y: 0 };
  e.hp = 500; e.maxHp = 500;
  a.cd.skill1 = 0;
  B.trySlot(a, "skill1", a.ctrl);
  step(4);
  check("赫：直接命中 15 伤害", e.hp === 485, e.hp);
  /* 目标被击飞到墙上：再吃 15 */
  B.terrain = miniMap([mkProp("breakable", "crate_wood", 960, 900, 1, 1)]);
  e.x = 880; e.y = 900; e.hp = 500; e.knockLeft = 0; e.knockWall = false;
  a.cd.skill1 = 0;
  B.trySlot(a, "skill1", a.ctrl);
  step(10);
  check("赫：撞墙追加 15 伤害", e.hp === 470, e.hp);
}

console.log("\n=== 6. 钢链 / 咸鱼 / 突击枪 ===");
{
  const a = mkHero(0, { basic: "slash", skill1: "chain", skill2: null, ult: null });
  const n1 = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, n1);
  a.facing = { x: 1, y: 0 };
  const near = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  const far = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  B.fighters.push(near, far);
  near.x = 720; near.y = 900; near.hp = 500; near.maxHp = 500;
  far.x = 830; far.y = 900; far.hp = 500; far.maxHp = 500;
  a.cd.skill1 = 0;
  B.trySlot(a, "skill1", a.ctrl);
  check("钢链：前摇期间不出链", near.hp === 500 && far.hp === 500, near.hp + "/" + far.hp);
  step(26);
  check("钢链：近端命中 10", near.hp === 490, near.hp);
  check("钢链：末端命中 22", far.hp === 478, far.hp);
  check("钢链：放完进入 7 秒 CD", a.cd.skill1 > 6.4 && a.cd.skill1 <= 7, a.cd.skill1.toFixed(2));
}
{
  const a = mkHero(0, { basic: "slash", skill1: "fish", skill2: null, ult: null });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  a.facing = { x: 1, y: 0 }; a.x = 600; a.y = 900; e.x = 760; e.y = 900;
  e.hp = 500; e.maxHp = 500; e.energy = 120; e.maxEnergy = 150;
  a.energy = 10; a.maxEnergy = 150;
  a.cd.skill1 = 0;
  B.trySlot(a, "skill1", a.ctrl);
  step(40);
  check("咸鱼：命中 26 伤害", e.hp === 474, e.hp);
  /* 命中本身还会给双方回能（命中 +12 / 被击中 +10），这里只验证净抽能方向 */
  check("咸鱼：抽走 20 能量", e.energy < 115, e.energy.toFixed(1));
  check("咸鱼：自己获得能量（20 抽能 + 命中回能）", a.energy >= 40, a.energy.toFixed(1));
}
{
  const a = mkHero(0, { basic: "slash", skill1: "assault", skill2: null, ult: null });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  a.facing = { x: 1, y: 0 }; e.x = 1400; e.y = 1400;
  a.cd.skill1 = 0;
  B.trySlot(a, "skill1", a.ctrl);
  step(18);
  const mine = B.projs.filter(p => p.owner === a && p.type === "bullet");
  check("突击枪：短时间内连射多发", mine.length >= 4, mine.length);
  step(20);
  check("突击枪：共 8 发", B.projs.filter(p => p.owner === a).length <= 8,
    B.projs.filter(p => p.owner === a).length);
}

console.log("\n=== 7. 运货 / 黄金弹力炮 / 爆裂之火 / 流水碎岩拳 ===");
{
  const a = mkHero(0, { basic: "slash", skill1: "cargo", skill2: null, ult: null });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e,
    { preset: "arena", counts: { solid: 0, breakable: 0, pushable: 0, fence: 0, bush: 0, water: 0,
      barrel: 0, car: 0, tire: 0, supply: 0, barricade: 0, room: 0 }, seed: 11 });
  a.facing = { x: 1, y: 0 }; a.cd.skill1 = 0;
  B.trySlot(a, "skill1", a.ctrl);
  step(75);
  const crate = (B.terrain.props || []).find(o => o.cargo);
  check("运货：蓄力后扔出木箱", !!crate, crate ? Math.round(crate.x) + "," + Math.round(crate.y) : "none");
  check("运货：木箱 20 血、可破坏", !!crate && crate.hp === 20 && crate.kind === "breakable");
  step(90);
  check("运货：落地后变成普通木箱", !!crate && !crate.cargo && !crate.dead);
}
{
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: "goldCannon" });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  B.terrain = miniMap([mkProp("solid", "stone", 760, 900, 1, 1)]);
  B.terrain.top = 120;
  a.facing = { x: 1, y: 0 }; a.energy = a.maxEnergy; a.cd.ult = 0;
  B.trySlot(a, "ult", a.ctrl);
  check("黄金弹力炮：演出期间不出弹", !B.projs.some(p => p.type === "gold") && LD.Cine.active);
  LD.Cine.active = false;
  step(3);
  const g = B.projs.find(p => p.type === "gold");
  check("黄金弹力炮：生成专属弹道", !!g && g.passWall === false, !!g);
  step(45);
  check("黄金弹力炮：碰到柱子会弹射", !!g && (g.data.bounces || 0) >= 1,
    g ? "bounces=" + g.data.bounces + " vx=" + g.vx.toFixed(0) : "gone");
}
{
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: "blaze" });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  e.x = 665; e.y = 900; e.hp = 500; e.maxHp = 500;   // 距圆心 65：外圈内、内圈外
  a.energy = a.maxEnergy; a.cd.ult = 0;
  B.trySlot(a, "ult", a.ctrl);
  check("爆裂之火：有大招演出", LD.Cine.active);
  LD.Cine.active = false;
  step(120);
  check("爆裂之火：火球持续降落会命中", e.hp < 500, e.hp);
  check("爆裂之火：附带减速", (e.slowT || 0) > 0, (e.slowT || 0).toFixed(2));
}
{
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: "blaze" });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  e.x = 620; e.y = 900; e.hp = 500; e.maxHp = 500;   // 距圆心 20：安全区
  a.energy = a.maxEnergy; a.cd.ult = 0;
  B.trySlot(a, "ult", a.ctrl);
  LD.Cine.active = false;
  step(150);
  check("爆裂之火：脚下 55 半径是安全区", e.hp === 500, e.hp);
}
{
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: "rockFist" });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  a.x = 600; e.x = 720; e.y = 900; e.hp = 500; e.maxHp = 500;
  a.facing = { x: 1, y: 0 };
  a.energy = a.maxEnergy; a.cd.ult = 0;
  B.trySlot(a, "ult", a.ctrl);
  check("流水碎岩拳：有大招演出", LD.Cine.active);
  LD.Cine.active = false;
  step(60);
  check("流水碎岩拳：会向前推进", a.x > 600, Math.round(a.x));
  check("流水碎岩拳：多段命中", e.hp < 500, e.hp);
}
{
  /* v3.4：撞墙不再中断，五拳照样打完，且贴着墙滑行 */
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: "rockFist" });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  a.x = 600; a.y = 900; e.x = 700; e.y = 900; e.hp = 500; e.maxHp = 500;
  B.terrain = miniMap([mkProp("solid", "wall_stone", 660, 900, 1, 1)]);
  a.facing = { x: 1, y: 0 }; a.energy = a.maxEnergy; a.cd.ult = 0;
  B.trySlot(a, "ult", a.ctrl);
  LD.Cine.active = false;
  let maxN = 0;
  for (let i = 0; i < 80; i++) {
    B.update(1 / 60);
    if (a.slot.ult && a.slot.ult.n > maxN) maxN = a.slot.ult.n;
  }
  check("流水碎岩拳：撞墙不中断，五拳全部打出", maxN === 5, maxN);
  check("流水碎岩拳：撞墙后停在墙前", a.x < 645, Math.round(a.x));
  const lost = 500 - e.hp;
  check("流水碎岩拳：每拳 10 伤害（总伤害是 10 的倍数）", lost > 0 && lost % 10 === 0, lost);
}
{
  /* 斜着撞墙：x 被墙挡死，y 沿墙继续滑过去 */
  const a = mkHero(0, { basic: "slash", skill1: null, skill2: null, ult: "rockFist" });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  a.x = 600; a.y = 800; e.x = 740; e.y = 980; e.hp = 500; e.maxHp = 500;
  B.terrain = miniMap([mkProp("solid", "wall_stone", 660, 900, 1, 8)]);
  a.energy = a.maxEnergy; a.cd.ult = 0;
  B.trySlot(a, "ult", a.ctrl);
  LD.Cine.active = false;
  for (let i = 0; i < 80; i++) B.update(1 / 60);
  check("流水碎岩拳：斜撞墙时沿墙滑行", a.x < 645 && a.y > 850, Math.round(a.x) + "," + Math.round(a.y));
}

console.log("\n=== 8. 败者食尘回溯 CD ===");
{
  const a = mkHero(0, { basic: "slash", skill1: "he", skill2: null, ult: "eatDust" });
  const e = mkHero(1, { basic: "slash", skill1: null, skill2: null, ult: null });
  setupDuel(a, e);
  B.t = 20;
  a.hp = 40; a.maxHp = 100;
  a.hpHist = [{ t: 17, hp: 90 }];
  a.posHist = [{ t: 17, x: 700, y: 900 }];
  a.cdHist = [{ t: 17, cd: { basic: 0.5, skill1: 0.5, skill2: 2, ult: 0 } }];
  a.cd.basic = 3; a.cd.skill1 = 7; a.cd.skill2 = 9; a.cd.ult = 0;
  a.energy = a.maxEnergy;
  B.trySlot(a, "ult", a.ctrl);
  check("败者食尘：血量回到 3 秒前", a.hp === 90, a.hp);
  check("败者食尘：位置回到 3 秒前", Math.round(a.x) === 700, Math.round(a.x));
  check("败者食尘：技能 CD 回到 3 秒前",
    a.cd.skill1 === 0.5 && a.cd.basic === 0.5, "s1=" + a.cd.skill1 + " basic=" + a.cd.basic);
}

console.log("\n=== 9. 死战闯关 ===");
{
  const _sd = UI.startDragon, _toast = UI.toast, _reset = UI.resetRunPerks, _show = UI.show;
  let launched = 0;
  UI.startDragon = () => { launched++; };
  UI.toast = () => {}; UI.show = () => {};
  UI.resetRunPerks = () => { UI.runPerks = []; };
  UI.gauntlet = null;
  UI.startGauntlet();
  const g = UI.gauntlet;
  check("死战闯关固定 6 关", g && g.picks.length === 6, g && g.picks.length);
  check("前 4 普通 / 后 2 困难", g && g.picks.slice(0, 4).every(p => p.diff.key === "normal") &&
    g.picks.slice(4).every(p => p.diff.key === "hard"), g && g.picks.map(p => p.diff.key).join(","));
  check("关卡不重复", g && new Set(g.picks.map(p => p.level.id)).size === 6);
  UI.startDragon = _sd; UI.toast = _toast; UI.resetRunPerks = _reset; UI.show = _show;
  UI.gauntlet = null;
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
