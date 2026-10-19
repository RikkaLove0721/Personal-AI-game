/* 孤高旅斗 v3.0 地形系统测试
 * 覆盖：
 *   ① 五类地形的通行规则（挡人 / 挡飞行物 / 可破坏 / 可推动）
 *   ② 格子化生成：数量、对齐、不重叠、连通、种子确定性、出生保护区
 *   ③ 碰撞：角色推出、飞行物命中、围栏放行
 *   ④ 可破坏：吃伤害、碎裂、回合复原
 *   ⑤ 可推动：近战推力 > 远程、质量影响速度、摩擦衰减、边界即墙
 *   ⑥ 近战扇形 / 爆炸范围 / AI 绕障
 *   ⑦ 战斗与房间集成：mapCfg、出生点安全、BOSS 预设、旧调用兼容
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
      if (k === "createPattern") return () => ({});
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
    placeholder: "", width: 0, height: 0, disabled: false, onclick: null, onchange: null, oninput: null, title: "",
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
function makeSandbox() {
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
  return sb;
}
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ✔ " + label + (extra !== undefined && extra !== "" && extra !== false ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✘ " + label + (extra !== undefined ? "  → " + extra : "")); }
}

const sb = makeSandbox();
const LD = sb.LD, B = LD.Battle, T = LD.Terrain, UI = LD.UI;
LD.CONF.critRate = 0;

function mat(kind, id) {
  return (LD.TERRAIN.mats[kind] || []).find(m => m.id === id);
}
function mkProp(kind, matId, x, y, cw, ch) {
  const m = mat(kind, matId) || mat("solid", "stone");
  cw = cw || 1; ch = ch || 1;
  return {
    uid: Math.floor(Math.random() * 1e6), kind: kind, mat: m.id, shape: m.shape,
    cw: cw, ch: ch, w: cw * 40, h: ch * 40, x: x, y: y, ox: x, oy: y,
    elev: m.elev, mass: m.mass, hp: m.hp || 0, maxHp: m.hp || 0,
    dead: false, flash: 0, vx: 0, vy: 0, free: false, variant: 1,
    blockMove: LD.TERRAIN.types[kind].blockMove, blockProj: LD.TERRAIN.types[kind].blockProj
  };
}
function miniMap(props) {
  return { tile: 40, cols: 40, rows: 37, top: 120, cfg: { ground: "grass" }, props: props, ground: [] };
}
function distToProp(o, x, y) {
  const l = o.x - o.w / 2, r = o.x + o.w / 2, t = o.y - o.h / 2, b = o.y + o.h / 2;
  const cx = Math.max(l, Math.min(r, x)), cy = Math.max(t, Math.min(b, y));
  return Math.hypot(x - cx, y - cy);
}

/* ============================================================ */
console.log("=== 1. 数据层：五类地形与预设 ===");
check("格子单位 40x40", LD.TERRAIN.tile === 40, LD.TERRAIN.tile);
check("地形类型齐全（含 v3.1 新增设施）",
  ["solid", "breakable", "pushable", "fence", "bush", "water", "barrel", "car", "tire", "supply", "barricade", "room"]
    .every(k => LD.TERRAIN.types[k]));
check("实心 / 可破坏 / 可推动都挡人挡飞行物",
  ["solid", "breakable", "pushable"].every(k => LD.TERRAIN.types[k].blockMove && LD.TERRAIN.types[k].blockProj));
check("围栏挡人但不挡飞行物",
  LD.TERRAIN.types.fence.blockMove && !LD.TERRAIN.types.fence.blockProj);
check("草丛 / 水池不挡人也不挡飞行物",
  !LD.TERRAIN.types.bush.blockMove && !LD.TERRAIN.types.water.blockMove &&
  !LD.TERRAIN.types.bush.blockProj && !LD.TERRAIN.types.water.blockProj);
check("炸药桶 / 补给箱 / 路障可破坏（有血量）",
  ["barrel", "supply", "barricade"].every(k => LD.TERRAIN.types[k].damageable));
check("四类地形都有多种材质（>=3）",
  ["solid", "breakable", "pushable", "fence"].every(k => LD.TERRAIN.mats[k].length >= 3),
  ["solid", "breakable", "pushable", "fence"].map(k => LD.TERRAIN.mats[k].length).join("/"));
check("地面材质至少 6 种（含草地 / 石地）",
  LD.TERRAIN.grounds.length >= 6 && ["grass", "stone"].every(id => LD.TERRAIN.grounds.some(g => g.id === id)),
  LD.TERRAIN.grounds.map(g => g.id).join(","));
check("地图预设 8 个（含新增城市）", LD.MAPS.presets.length === 8 &&
  LD.MAPS.presets.some(p => p.id === "city"), LD.MAPS.presets.length);
check("全部随机预设的数量本身也随机", LD.MAPS.presets.find(p => p.id === "random").random === true);
check("滑条 15 条（v3.5 新增吹风机）、上限 8",
  LD.MAPS.sliders.length === 15 && LD.MAPS.sliderMax === 8, LD.MAPS.sliders.length);
check("BOSS 九关都有地图预设", LD.LEVELS.every(l => !!LD.BOSS_MAPS[l.boss]),
  LD.LEVELS.map(l => l.boss + ":" + (LD.BOSS_MAPS[l.boss] ? "ok" : "缺")).join(" "));

console.log("\n=== 2. 配置归一化 ===");
const cfg0 = LD.mapCfg({ preset: "desert", counts: { solid: 99, breakable: -3, pushable: 4.6, fence: 2 }, seed: 7 });
check("数量下限 0", cfg0.counts.breakable === 0, cfg0.counts.breakable);
check("数量上限 8", cfg0.counts.solid === 8, cfg0.counts.solid);
check("小数四舍五入", cfg0.counts.pushable === 5, cfg0.counts.pushable);
check("种子保留", cfg0.seed === 7, cfg0.seed);
check("未知预设回退到全部随机", LD.mapCfg({ preset: "不存在" }).preset === "random");
check("预设带地面风格（沙漠=沙地）", cfg0.ground === "sand", cfg0.ground);

console.log("\n=== 3. 生成：数量 / 对齐 / 不重叠 / 连通 / 确定性 ===");
const gcfg = { preset: "arena", counts: { solid: 3, breakable: 2, pushable: 2, fence: 2 }, seed: 20261017 };
const M = T.build(gcfg, { w: 1600, h: 1600, pt: 120 }, []);
const c = T.counts(M);
check("生成数量与滑条一致", c.solid === 3 && c.breakable === 2 && c.pushable === 2 && c.fence === 2,
  JSON.stringify(c));
check("全部障碍整格对齐", M.props.every(o =>
  (o.x - o.w / 2) % 40 === 0 && (o.y - 120 - o.h / 2) % 40 === 0));
check("全部障碍在地图内且不越过上边界", M.props.every(o =>
  o.x - o.w / 2 >= 0 && o.x + o.w / 2 <= 1600 &&
  o.y - o.h / 2 >= 120 && o.y + o.h / 2 <= 1600));
check("障碍之间互不重叠", M.props.every((a, i) => M.props.every((b, j) =>
  i === j || a.x + a.w / 2 <= b.x - b.w / 2 || a.x - a.w / 2 >= b.x + b.w / 2 ||
  a.y + a.h / 2 <= b.y - b.h / 2 || a.y - a.h / 2 >= b.y + b.h / 2)));
check("空格全连通（不会被障碍封死）", T.connected(M.occ, M.cols, M.rows));
check("地面网格尺寸与地图一致", M.ground.length === M.rows && M.ground[0].length === M.cols);
check("地面至少有 1 种斑块材质", new Set(M.ground.flat()).size >= 2,
  Array.from(new Set(M.ground.flat())).join(","));

const M2 = T.build(gcfg, { w: 1600, h: 1600, pt: 120 }, []);
check("同种子生成完全一致", JSON.stringify(M.props.map(o => [o.x, o.y, o.mat])) ===
  JSON.stringify(M2.props.map(o => [o.x, o.y, o.mat])));
const M3 = T.build(Object.assign({}, gcfg, { seed: 88 }), { w: 1600, h: 1600, pt: 120 }, []);
check("不同种子布局不同", JSON.stringify(M.props.map(o => [o.x, o.y])) !==
  JSON.stringify(M3.props.map(o => [o.x, o.y])));

const M4 = T.build(gcfg, { w: 1600, h: 1600, pt: 120 }, [{ x: 800, y: 800, r: 180 }]);
check("出生保护区不摆障碍", M4.props.every(o => distToProp(o, 800, 800) > 140),
  Math.round(Math.min.apply(null, M4.props.map(o => distToProp(o, 800, 800)))));

console.log("\n=== 4. 挡人与挡飞行物 ===");
const solid = mkProp("solid", "stone", 600, 400, 1, 1);
const fence = mkProp("fence", "fence_wood", 600, 600, 2, 1);
const crate = mkProp("breakable", "crate_wood", 600, 800, 1, 1);
const block = mkProp("pushable", "block_stone", 600, 1000, 1, 1);
const mm = miniMap([solid, fence, crate, block]);

const hero = B.mkHero(0, { x: 560, y: 400, look: LD.Profile.look(), loadout: { basic: "slash" }, name: "H" });
check("角色从障碍左侧撞上去会被推出", (() => {
  const f = { x: 576, y: 400, r: 16 };
  T.collideFighter(mm, f);
  return f.x <= 600 - 20 - 16 + 0.2;
})(), "x=" + (() => { const f = { x: 576, y: 400, r: 16 }; T.collideFighter(mm, f); return f.x.toFixed(1); })());
check("围栏同样挡人", !!T.pushOut(fence, 600, 600, 16));

function projAt(x, y, vx, dmg) {
  return { x: x, y: y, vx: vx || 0, vy: 0, r: 8, dmg: dmg || 20, life: 0, maxLife: 3,
    side: 0, type: "bullet", color: "#fff", core: "#fff", data: {}, basic: true, kindTag: "basic" };
}
check("飞行物会被实心障碍挡住", !!T.projHit(mm, projAt(600, 400, 600)));
check("飞行物会被可破坏障碍挡住", !!T.projHit(mm, projAt(600, 800, 600)));
check("飞行物会被可推动障碍挡住", !!T.projHit(mm, projAt(600, 1000, 600)));
check("飞行物能穿过围栏", !T.projHit(mm, projAt(600, 600, 600)));

console.log("\n=== 5. 可破坏障碍 ===");
const beforeHp = crate.hp;
T.hitProp(mm, crate, 20, { melee: true, dir: 0 });
check("木箱吃 20 伤害后剩 35", crate.hp === beforeHp - 20, crate.hp);
check("未碎前仍然挡人", !!T.pushOut(crate, 600, 800, 16));
T.hitProp(mm, crate, 40, { melee: true, dir: 0 });
check("血量归零后被破坏", crate.dead === true && crate.hp <= 0, crate.hp);
check("破坏后不再挡人", !T.pushOut(crate, 600, 800, 16));
T.reset(mm);
check("回合重开：木箱复原且回到原位", crate.dead === false && crate.hp === crate.maxHp);
check("回合重开：可推动方块回到初始格", (() => { block.x = 900; T.reset(mm); return block.x === block.ox; })());

console.log("\n=== 6. 可推动障碍物理 ===");
const b1 = mkProp("pushable", "block_stone", 700, 1200, 1, 1);
const b2 = mkProp("pushable", "block_wood", 900, 1200, 1, 1);
const m2 = miniMap([b1, b2]);
T.hitProp(m2, b1, 30, { dir: 0, melee: false });
T.hitProp(m2, b2, 30, { dir: 0, melee: false });
const rangedStone = Math.hypot(b1.vx, b1.vy);
const rangedWood = Math.hypot(b2.vx, b2.vy);
check("可推动障碍不掉血", b1.hp === b1.maxHp && b1.maxHp === 0);
check("远程伤害产生速度", rangedStone > 0, rangedStone.toFixed(0));
check("同样冲量下木方块比石方块快（质量更大加速度更小）", rangedWood > rangedStone,
  rangedWood.toFixed(0) + " > " + rangedStone.toFixed(0));

const b3 = mkProp("pushable", "block_stone", 700, 1400, 1, 1);
const b4 = mkProp("pushable", "block_stone", 900, 1400, 1, 1);
const m3 = miniMap([b3, b4]);
T.hitProp(m3, b3, 30, { dir: 0, melee: false });
T.hitProp(m3, b4, 30, { dir: 0, melee: true });
check("同伤害下近战推力远大于远程", Math.hypot(b4.vx, b4.vy) > Math.hypot(b3.vx, b3.vy) * 2.2,
  Math.hypot(b3.vx, b3.vy).toFixed(0) + " vs " + Math.hypot(b4.vx, b4.vy).toFixed(0));

const b5 = mkProp("pushable", "block_stone", 700, 1500, 1, 1);
const m5 = miniMap([b5]);
const world = { w: 1600, h: 1600, pt: 120 };
T.hitProp(m5, b5, 30, { dir: 0, melee: true });
const v0 = Math.hypot(b5.vx, b5.vy), x0 = b5.x;
T.update(m5, 0.1, null);
check("可推动障碍会随速度位移", b5.x > x0, (b5.x - x0).toFixed(1) + "px");
check("摩擦让速度衰减", Math.hypot(b5.vx, b5.vy) < v0, Math.hypot(b5.vx, b5.vy).toFixed(0) + " < " + v0.toFixed(0));

/* 边界视作墙 */
b5.vx = 3000; b5.vy = 0; b5.x = 1500; b5.y = 800;
for (let i = 0; i < 60; i++) T.update(m5, 1 / 60, null);
check("撞到地图右边界会停住 / 回弹", b5.x <= world.w - b5.w / 2 - 3.9, b5.x.toFixed(1));

/* 两个方块互相挡 */
const p1 = mkProp("pushable", "block_stone", 600, 300, 1, 1);
const p2 = mkProp("solid", "stone", 680, 300, 1, 1);
const m6 = miniMap([p1, p2]);
T.hitProp(m6, p1, 60, { dir: 0, melee: true });
const px0 = p1.x;
for (let i = 0; i < 30; i++) T.update(m6, 1 / 60, null);
check("可推动方块撞到实心障碍会被挡住", p1.x + p1.w / 2 <= 680 - 20 + 1.5, p1.x.toFixed(1) + " (初始 " + px0 + ")");

console.log("\n=== 7. 近战扇形 / 爆炸 / AI 绕障 ===");
const c1 = mkProp("breakable", "crate_wood", 700, 500, 1, 1);   // 正前方
const c2 = mkProp("breakable", "crate_wood", 500, 500, 1, 1);   // 背后
const m7 = miniMap([c1, c2]);
const f7 = { x: 640, y: 500, facing: { x: 1, y: 0 }, r: 16 };
T.melee(m7, f7, 66, 1.05, 20);
check("近战只打前方扇形内的箱子", c1.hp < c1.maxHp && c2.hp === c2.maxHp, c1.hp + "/" + c2.hp);

const c3 = mkProp("breakable", "crate_wood", 760, 500, 1, 1);
const c4 = mkProp("breakable", "crate_wood", 850, 500, 1, 1);
const m8 = miniMap([c3, c4]);
T.blast(m8, 800, 500, 100, 40);
check("爆炸会同时伤到范围内的箱子", c3.hp < c3.maxHp && c4.hp < c4.maxHp, c3.hp + "/" + c4.hp);

const av = T.avoid(miniMap([mkProp("solid", "stone", 400, 400, 1, 1)]), 380, 400, 70);
check("AI 靠近障碍时得到反向斥力", av.x < 0, av.x.toFixed(2));

console.log("\n=== 8. 战斗集成 ===");
const fs2 = [];
for (let i = 0; i < 2; i++) {
  const f = B.mkHero(i, { x: 0, y: 0, look: LD.Profile.look(), loadout: { basic: "slash" }, name: "H" + i });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  fs2.push(f);
}
B.setup({ mode: "duel", rule: "brawl", fighters: fs2,
  mapCfg: { preset: "arena", counts: { solid: 2, breakable: 2, pushable: 2, fence: 1 }, seed: 4321 } });
check("B.setup 带 mapCfg 时生成地形", !!B.terrain && B.terrain.props.length === 7,
  B.terrain ? B.terrain.props.length : "null");
B.resetRound(false);
B.state = "fight"; B.countdown = 0;
check("出生点全部避开障碍", fs2.every(f => T.clearAt(B.terrain, f.x, f.y, 16)),
  fs2.map(f => Math.round(f.x) + "," + Math.round(f.y)).join(" | "));

/* 不传 mapCfg 时保持空场地（旧调用 / 无头测试兼容） */
const fs3 = [B.mkHero(0, { x: 0, y: 0, look: LD.Profile.look(), loadout: { basic: "slash" }, name: "X" })];
fs3[0].ctrl = { mx: 0, my: 0, hold: {}, press: {} };
B.setup({ mode: "duel", rule: "brawl", fighters: fs3 });
check("不传 mapCfg 时不生成地形（向后兼容）", B.terrain === null);

/* 飞行物真的会被地形拦下 */
const fs4 = B.mkHero(0, { x: 0, y: 0, look: LD.Profile.look(), loadout: { basic: "slash" }, name: "Y" });
fs4.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
B.setup({ mode: "duel", rule: "brawl", fighters: [fs4],
  mapCfg: { preset: "arena", counts: { solid: 1, breakable: 0, pushable: 0, fence: 0 }, seed: 99 } });
const pillar = B.terrain.props.find(o => o.kind === "solid");
const pr = projAt(pillar.x - 160, pillar.y, 600, 10);
B.projs = [pr];
let guard = 0;
while (B.projs.length && guard++ < 30) B.updateProjs(1 / 60);
check("战斗循环里飞行物撞柱子后消失", B.projs.length === 0);

/* 近战砸箱 */
const cx0 = 640, cy0 = 700;
const crateLive = mkProp("breakable", "crate_wood", 700, cy0, 1, 1);
B.terrain = miniMap([crateLive]);
const f9 = B.mkHero(0, { x: cx0, y: cy0, look: LD.Profile.look(), loadout: { basic: "slash" }, name: "Z" });
f9.facing = { x: 1, y: 0 };
B.fighters = [f9];
B.melee(f9, { reach: 66, half: 1.05, dmg: 30, type: "basic" });
check("战斗近战（没有敌人时）也能砸中箱子", crateLive.hp === crateLive.maxHp - 30, crateLive.hp);

console.log("\n=== 9. BOSS 地图与房间默认值 ===");
const bc1 = T.bossCfg({ id: 1, boss: "dragon" });
const bc2 = T.bossCfg({ id: 1, boss: "dragon" });
check("BOSS 地图预设固定种子", bc1.seed === 1201 && bc2.seed === 1201, bc1.seed);
check("BOSS 九关预设都能构建", LD.LEVELS.every(l => {
  const m = T.build(T.bossCfg(l), { w: 1600, h: 1600, pt: 120 }, [{ x: 420, y: 800, r: 90 }, { x: 1200, y: 800, r: 90 }]);
  return !!m && T.connected(m.occ, m.cols, m.rows);
}));
check("同一关每次布局一致", (() => {
  const a = T.build(T.bossCfg({ id: 3, boss: "gun" }), { w: 1600, h: 1600, pt: 120 }, []);
  const b = T.build(T.bossCfg({ id: 3, boss: "gun" }), { w: 1600, h: 1600, pt: 120 }, []);
  return JSON.stringify(a.props.map(o => [o.x, o.y])) === JSON.stringify(b.props.map(o => [o.x, o.y]));
})());
check("房间默认带地图配置", !!UI.room.map && UI.room.map.counts && typeof UI.room.map.seed === "number");
check("联机房间默认带地图配置", !!UI.netRoom.map && !!UI.netRoom.map.counts);
check("开局配置会刷新种子", (() => {
  const a = UI.mapCfgForStart({ preset: "desert", seed: 1 });
  return a.seed !== 1 && a.preset === "desert";
})());
check("滑条为 0 时该地形不生成", (() => {
  const m = T.build({ preset: "arena", counts: { solid: 0, breakable: 0, pushable: 0, fence: 1 }, seed: 5 },
    { w: 1600, h: 1600, pt: 120 }, []);
  const cc = T.counts(m);
  return cc.solid === 0 && cc.breakable === 0 && cc.pushable === 0 && cc.fence === 1;
})());

console.log("\n=== 10. AI 视线与绕障 ===");
check("losHit：视线通畅返回 null", T.losHit(miniMap([solid]), 400, 400, 450, 400, 24) === null);
check("losHit：被实心柱挡住返回该柱", T.losHit(miniMap([solid]), 500, 400, 700, 400, 24) === solid);
check("losHit：围栏不挡视线（能打穿）", T.losHit(miniMap([fence]), 500, 600, 700, 600, 24) === null);
check("losHit：破坏后的箱子不再挡视线", (() => {
  const c = mkProp("breakable", "crate_wood", 600, 400, 1, 1);
  const m = miniMap([c]);
  T.hitProp(m, c, 999, { melee: true, dir: 0 });
  return T.losHit(m, 400, 400, 800, 400, 24) === null;
})());

/* AI：被柱子挡住时远程普攻被压制，绕开后恢复 */
function aiPair(mapCfgSeed) {
  const a = B.mkHero(0, { x: 0, y: 0, look: LD.Profile.look(),
    loadout: { basic: "pistol", skill1: null, skill2: null, ult: null }, name: "A" });
  const e = B.mkHero(1, { x: 0, y: 0, look: LD.Profile.look(),
    loadout: { basic: "slash", skill1: null, skill2: null, ult: null }, name: "E" });
  a.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  e.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  B.setup({ mode: "duel", rule: "brawl", fighters: [a, e],
    mapCfg: { preset: "arena", counts: { solid: 1, breakable: 0, pushable: 0, fence: 0 }, seed: mapCfgSeed } });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  LD.AI.mkBot(a, "normal");
  return [a, e];
}
{
  const [a, e] = aiPair(777);
  const pillar = B.terrain.props.find(o => o.kind === "solid");
  /* A 在柱子左侧 120px，E 在柱子右侧 120px，同一直线：视线必被挡 */
  a.x = pillar.x - 120; a.y = pillar.y;
  e.x = pillar.x + 120; e.y = pillar.y;
  a.cd.basic = 0;
  let pressed = 0;
  for (let i = 0; i < 12; i++) { a.bot.think = 0; LD.AI.tickHero(a, 1 / 60); if (a.ctrl.press.basic) pressed++; }
  check("视线被挡：远程普攻被压制（不浪费 CD）", pressed === 0, pressed + " 次出手");
  check("视线被挡：AI 在绕障（朝障碍侧面移动）",
    Math.abs(a.ctrl.my) > 0.2 || a.ctrl.mx < -0.2, "mx=" + a.ctrl.mx.toFixed(2) + " my=" + a.ctrl.my.toFixed(2));
  /* 绕到无遮挡的一侧：视线恢复 → 恢复开火。
   * 注意别用「沿 y 偏移 60px」这种擦角站位：losHit 的 AABB 按 pad(24) 扩边，
   * 柱子若是 1x1，斜线仍会切到扩边后的角落，断言会随地图种子时灵时不灵。
   * 这里直接把两人摆到柱子正下方同一条水平线上，用 losHit 兜底确认真的通了。 */
  a.x = pillar.x - 110;
  a.y = pillar.y + pillar.h / 2 + 100;
  e.x = pillar.x + 150;
  e.y = a.y;
  a.bot._losT = 0;
  check("视线恢复：站位确实无遮挡",
    !LD.Terrain.losHit(B.terrain, a.x, a.y, e.x, e.y, 24));
  let fired = 0;
  for (let i = 0; i < 20; i++) { a.bot.think = 0; a.cd.basic = 0; LD.AI.tickHero(a, 1 / 60); if (a.ctrl.press.basic) fired++; }
  check("视线恢复：远程普攻恢复出手", fired > 0, fired + " 次");
}

/* 巨龙：被挡时不喷火球 */
{
  const dr = B.mkDragon({ diff: LD.DIFF.normal });
  const e2 = B.mkHero(1, { x: 0, y: 0, look: LD.Profile.look(), loadout: { basic: "slash" }, name: "E2" });
  e2.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  B.fighters = [dr, e2];
  B.terrain = miniMap([mkProp("solid", "stone", (dr.x + e2.x) / 2, (dr.y + e2.y) / 2, 1, 1)]);
  dr.cd.basic = 0; dr.cd.ult = 99; dr.cd.skill1 = 99;
  let spit = 0;
  for (let i = 0; i < 30; i++) LD.AI.tickDragon(dr, 1 / 60);
  spit = B.projs.filter(p2 => p2.type === "fireball").length;
  check("巨龙视线被挡时不喷火球", spit === 0, spit + " 发");
  B.terrain = null;
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
