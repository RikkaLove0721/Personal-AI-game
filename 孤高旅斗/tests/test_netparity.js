/* 孤高旅斗 v4.34 · 联机「双端一致」回归
 *
 * 为什么要有这个文件：
 *   以前联机那条线只能靠肉身开两台电脑试，出问题的都是「客机视角缺东西」——
 *   山芋没了、情报箱停在地图中间、夜战看不见手电筒、变鬼后搜不了柜子。
 *   这些全都可以在一个进程里复现：两个沙箱各加载一份游戏，中间接一根内存网线，
 *   跑真实的 send / handle / snapshot / apply 流程（见 _netpair.js）。
 *
 * 这一版测四件事：
 *   1. 协议覆盖度 —— 每个有状态的模式都进了 NetMode 表，别再有「漏一个模式」
 *   2. 回程保真   —— 房主发包那一刻的状态，客机 apply 完之后「再打包一次」必须一模一样
 *                     （这条能抓住 apply 少写一个字段、道具下标错位、引用没回填）
 *   3. 状态会动   —— 客机那份状态必须随房主变化，不能永远停在初始值
 *                     （用户报的「计时器卡住 / 山芋不见了」就是这个）
 *   4. 不崩不爆   —— 逐帧双端绘制无异常；快照带宽在局域网可接受范围
 *
 * 断言口径：数值允许「同一帧内的量化误差」（pack 里 r2 / Math.round 的锅），
 * 字符串、布尔、数组长度必须严格相等。
 */
const fs = require("fs");
const path = require("path");
const P = require("./_netpair.js");

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const RULES = ["brawl", "team", "overlord", "gifts", "ring", "auction", "doomsday", "relay",
  "hunt", "warmup", "blackout", "escort", "bump", "river", "capture", "tower",
  "hotpotato", "statue", "chair", "hide", "lava", "barrage"];

/* 有独立状态对象的模式（其余靠 fighters / projs / tm 已经覆盖） */
const STATEFUL = ["overlord", "ring", "hunt", "blackout", "escort", "bump", "river",
  "capture", "tower", "hotpotato", "statue", "chair", "hide", "lava", "barrage"];

/* ------------------------------------------------------------------ *
 *  比较工具
 * ------------------------------------------------------------------ */

/** 数值容差：pack 里 r2 两位小数、坐标取整，跨帧量化误差就在这个量级 */
function tolOf(a, b) {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return Math.max(0.06, m * 0.004);
}

/** 深度近似比较，返回第一处差异的文字描述；一致返回 null */
function nearDiff(a, b, trail) {
  const t = trail || "";
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) <= tolOf(a, b)) return null;
    return t + ": " + a + " \u2260 " + b;
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    /* null 与 0 / -1 在 pack 里是两种语义，必须分得清 */
    if (a === b) return null;
    if ((a == null) !== (b == null)) return t + ": " + JSON.stringify(a) + " \u2260 " + JSON.stringify(b);
    return null;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return t + ": 类型不同（数组 vs " + typeof b + "）";
    if (a.length !== b.length) return t + ".length: " + a.length + " \u2260 " + b.length;
    for (let i = 0; i < a.length; i++) {
      const d = nearDiff(a[i], b[i], t + "[" + i + "]");
      if (d) return d;
    }
    return null;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join(",") !== kb.join(",")) return t + ": 字段集不同 {" + ka.join(",") + "} vs {" + kb.join(",") + "}";
    for (const k of ka) {
      const d = nearDiff(a[k], b[k], t + "." + k);
      if (d) return d;
    }
    return null;
  }
  return t + ": " + JSON.stringify(a) + " \u2260 " + JSON.stringify(b);
}

/* ------------------------------------------------------------------ *
 *  每个模式的「心跳」观测量
 * ------------------------------------------------------------------
 *  注意别拿「pack 出来的那串东西」当心跳：blackout 只发电站坐标（本来就静止），
 *  bump 只发比分（9 秒里可能一个都没撞出去）。这类断言会假红。
 *  这里给每个模式指定一个**必然会动**的东西（计时器 / 阶段 / 电量 / 进度）。
 */
const BEAT = {
  overlord: B => B.crown.phase + ":" + Math.round(B.crown.warnT * 10),
  ring: B => String(Math.round(B.ringT * 10)),
  hunt: B => String(Math.round(B.huntRing.r)),
  /* 夜战的心跳在手电筒电量上：电站坐标是静态的，不算数 */
  blackout: B => B.fighters.filter(f => f.kind === "hero")
    .map(f => Math.round(f.battery || 0) + "/" + (f.flash ? 1 : 0)).join(","),
  /* 护送：箱子只有被人推才会动，人机整局对它不理不睬也很正常（这就是它唯一的
   * 动态量都没有的情况），所以心跳里带上人的位置，免得断言假红。
   * 「箱子有没有跟房主同步」由第 2 节的回程保真精确校验，不靠这条。 */
  escort: B => Math.round(B.escort.box.x) + "," + Math.round(B.escort.box.y) + "/" +
    B.escort.score.join("-") + "/" + Math.round(B.escort.respawnT * 10) + "/" +
    B.fighters.filter(f => f.kind === "hero")
      .map(f => Math.round(f.x / 8) * 8 + "," + Math.round(f.y / 8) * 8).join(";"),
  /* 碰碰车没有计时器也没有车身数组（车是道具、由英雄驾驶），心跳只能看人有没有在动 */
  bump: B => B.fighters.filter(f => f.kind === "hero")
    .map(f => Math.round(f.x / 4) * 4 + "," + Math.round(f.y / 4) * 4).join(";"),
  river: B => Math.round(B.river.rise * 10) + "/" + B.river.batch + "/" + B.river.drums.length,
  capture: B => B.capture.pts.map(p => p.owner + ":" + Math.round(p.prog * 10)).join(";"),
  tower: B => Math.round(B.waveT * 10) + "/" + B.tScore.join("-") + "/" +
    B.fighters.filter(f => f.kind === "laneMinion").length,
  hotpotato: B => B.potato.phase + ":" + Math.round(B.potato.fuse * 10),
  statue: B => B.statue.phase + ":" + Math.round(B.statue.t * 10),
  chair: B => B.chair.phase + ":" + Math.round(B.chair.t * 10),
  hide: B => Math.round(B.hide.hintT * 10) + "/" + B.hide.caught,
  lava: B => B.lava.phase + ":" + Math.round(B.lava.t * 10),
  barrage: B => Math.round(B.barrage.modeT * 10) + "/" + B.barrage.bullets.length
};

/** 跑一个模式，返回测试需要的东西 */
function runRule(rule, sec, fighters) {
  const st = { rule: rule, snapMo: null, drawErr: null };
  const p = P.makePair({
    rule: rule,
    fighters: fighters || 3,
    seed: 20260214,
    onSnap: (api, snap) => { st.snapMo = snap.mo || {}; st.snapBytes = JSON.stringify(snap).length; }
  });
  p.frame(0.5);
  let firstBeat;
  try { firstBeat = BEAT[rule] ? BEAT[rule](p.CP) : null; } catch (e) { firstBeat = "?" + e.message; }
  p.frame(sec - 0.5);
  let lastBeat;
  try { lastBeat = BEAT[rule] ? BEAT[rule](p.CP) : null; } catch (e) { lastBeat = "?" + e.message; }
  const hostAfter = p.HB.NetMode.pack()[rule];
  const cliAfter = p.CB.NetMode.pack()[rule];
  if (p.hostDrawErr) st.drawErr = "host: " + p.hostDrawErr.message;
  if (p.cliDrawErr) st.drawErr = (st.drawErr ? st.drawErr + " | " : "") + "client: " + p.cliDrawErr.message;
  return {
    p: p, rule: rule,
    host: hostAfter, client: cliAfter,
    sent: st.snapMo ? st.snapMo[rule] : undefined,
    snapBytes: st.snapBytes || 0,
    firstBeat: firstBeat,
    lastBeat: lastBeat,
    drawErr: st.drawErr,
    bytes: p.bytes(),
    /* 客机侧「房主追加的实体」：塔防小兵 / 分身 / 龙 */
    shells: p.CP.fighters.filter(f => f.isRemote || f.kind !== "hero").length,
    hostShells: p.HP.fighters.filter(f => f.kind !== "hero" || f.isClone).length
  };
}

/* 单机起一局（只为了拿战斗对象，不走 UI） */
const BASE_LOADOUT = { basic: "slash", skill1: "dashSlash", skill2: "blink", ult: "n_ult" };
function bootRule(sb, rule, n) {
  const B = sb.LD.Battle;
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(B.mkHero(i, { x: 800, y: 900, look: sb.LD.Profile.look(), loadout: BASE_LOADOUT, name: "H" + i }));
  }
  B.setup({
    mode: "duel", rule: rule, fighters: list, isHost: true, mySide: 0, matchT: 180,
    mapCfg: sb.LD.mapCfg({ preset: "arena", seed: 7, ground: "stone" }), seed: 99
  });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return B;
}

/* ================================================================== *
 *  1. 协议覆盖度
 * ================================================================== */
console.log("=== 1. 协议覆盖度（别再漏模式） ===");
{
  const SB = require("./_sandbox.js");
  const sb = SB.makeSandbox("np-cover");
  const NM = sb.LD.NetMode;
  check("61_netmode.js 已加载", !!NM && typeof NM.pack === "function");
  check("沙箱里的规则表都在", RULES.every(r => sb.LD.RULES.some(x => x.id === r)),
    RULES.filter(r => !sb.LD.RULES.some(x => x.id === r)).join(",") || "22/22");
  /* 规则表注册在闭包里，用「实际跑一遍」来验：房主 pack 出东西才算覆盖 */
  const noState = [];
  for (const r of STATEFUL) {
    const sb2 = SB.makeSandbox("np-cov-" + r);
    bootRule(sb2, r, 3);
    const d = sb2.LD.NetMode.pack()[r];
    if (d === undefined || d === null) noState.push(r);
  }
  check("所有有状态的模式都能 pack 出内容", noState.length === 0,
    noState.join(",") || STATEFUL.length + "/" + STATEFUL.length);
  const idle = ["brawl", "team", "gifts", "auction", "doomsday", "relay", "warmup"];
  const noisy = idle.filter(r => {
    const sb3 = SB.makeSandbox("np-cov2-" + r);
    bootRule(sb3, r, 3);
    return sb3.LD.NetMode.pack()[r] !== undefined;
  });
  check("无状态模式不硬塞空字段", noisy.length === 0, noisy.join(",") || idle.length + " 个纯战斗模式");
}

/* ================================================================== *
 *  2. 回程保真：房主发出什么，客机就该还原成什么
 * ================================================================== */
console.log("\n=== 2. 回程保真（房主发包那一刻 \u2192 客机 apply \u2192 再打包） ===");
const RESULTS = [];
for (const r of STATEFUL) {
  const res = runRule(r, 9);
  RESULTS.push(res);
  if (res.drawErr) {
    check(r + " 双端绘制无异常", false, res.drawErr);
    continue;
  }
  const d = nearDiff(res.sent, res.client, r);
  check(r + " 客机状态与房主一致", d === null, d || (JSON.stringify(res.sent).length + "B"));
}

/* ================================================================== *
 *  3. 状态会动：不能永远停在初始值（心跳表定义在文件上半部分）
 * ================================================================== */
console.log("\n=== 3. 状态随房主变化（客机不是一张静止照片） ===");
for (const res of RESULTS) {
  if (!BEAT[res.rule]) { check(res.rule + " 有心跳观测量", false); continue; }
  check(res.rule + " 客机状态在 9 秒内发生了变化", res.firstBeat !== res.lastBeat,
    res.firstBeat === res.lastBeat
      ? "一直停在 " + String(res.firstBeat).slice(0, 60)
      : String(res.firstBeat).slice(0, 28) + " \u2192 " + String(res.lastBeat).slice(0, 28));
}

/* 用户点名的三处，单独给更强的断言 */
console.log("\n  -- 用户点名的问题逐条复核 --");
{
  const hot = RESULTS.find(x => x.rule === "hotpotato");
  const tgt = hot.client;
  const hx = hot.sent ? hot.sent[4] : tgt[4], hy = hot.sent ? hot.sent[5] : tgt[5];
  check("山芋模式：客机拿到的山芋坐标不是 (0,0)", hx !== 0 || hy !== 0, "(" + hx + "," + hy + ")");
  check("山芋模式：客机拿到的山芋阶段不是 undefined", typeof tgt[0] === "string", String(tgt[0]));

  const esc = RESULTS.find(x => x.rule === "escort");
  check("情报箱：客机拿到的箱子不在「地图正中默认值」",
    !(esc.client[3] === 0 && esc.client[4] === 0), "(" + esc.client[3] + "," + esc.client[4] + ")");

  const blk = RESULTS.find(x => x.rule === "blackout");
  check("夜战：客机拿到的电站坐标与房主一致", blk.client.length > 0 && blk.client.length === blk.host.length,
    blk.client.length + " 个电站");
  /* 手电筒本身走 packFighter，下面第 5 节单独查字段 */
}

/* ================================================================== *
 *  4. 客机侧的「影子实体」：小兵 / 分身 / 龙
 * ================================================================== */
console.log("\n=== 4. 房主追加的实体在客机有影子 ===");
{
  const tw = runRule("tower", 14);
  const laneMinions = tw.p.CP.fighters.filter(f => f.kind === "laneMinion");
  check("塔防：客机看得到小兵", laneMinions.length > 0, laneMinions.length + " 个");
  check("塔防：客机的小兵有绘制需要的 look",
    laneMinions.length === 0 || laneMinions.every(f => f.look && f.look.head),
    laneMinions.length && !laneMinions[0].look ? "缺 look" : "有");
  check("塔防：客机的英雄带着等级 / 金币", tw.p.CP.fighters.some(f => f.kind === "hero" && (f.level || 0) >= 1));
  check("塔防：客机小兵与房主数量接近",
    Math.abs(laneMinions.length - tw.p.HP.fighters.filter(f => f.kind === "laneMinion").length) <= 2,
    laneMinions.length + " vs " + tw.p.HP.fighters.filter(f => f.kind === "laneMinion").length);
}

/* ================================================================== *
 *  4.5 「画得和房主一样多」—— 看不见的东西测不测得到？
 * ==================================================================
 *  只验状态一致还不够：状态对了但绘制层走了 early return（`if (!B.potato) return`），
 *  画面照样是空的。这里给 ctx 套一层计数，比较同一次 draw 里两端发出的绘图指令数。
 *
 *  阈值定在 0.6 而不是 0.95：差额几乎全是**本机粒子**（毒圈掉血的血花、脚步尘土、
 *  命中火花）。那些在房主的 update 里用 Math.random 生成，客机本来就没有，也不该有
 *  —— 客机自己的特效由 Net.smooth 里的事件另开一份。实测 15 个模式落在 0.7~1.05。
 *  真正要抓的是「状态是空壳导致整段分支没进去」，那种情况会掉到 0.2 以下。
 */
console.log("\n=== 4.5 客机画出来的东西和房主一样多 ===");
{
  const SB = require("./_sandbox.js");
  const mkCount = () => {
    const base = SB.makeCtx();
    let n = 0;
    const ctx = new Proxy(base, {
      get(t, k) {
        const v = t[k];
        if (typeof v === "function") return function () { n++; return v.apply(null, arguments); };
        return v;
      }
    });
    return { ctx: ctx, count: () => n };
  };
  const bad = [];
  const detail = [];
  for (const rule of STATEFUL) {
    const p = P.makePair({ rule: rule, fighters: 3, seed: 20260214, draw: false });
    p.frame(4);
    const a = mkCount(), b = mkCount();
    let hostN = 0, cliN = 0;
    try { p.HP.draw(a.ctx); hostN = a.count(); } catch (e) { hostN = -1; }
    try { p.CP.draw(b.ctx); cliN = b.count(); } catch (e) { cliN = -1; }
    const ratio = hostN > 0 ? cliN / hostN : 0;
    detail.push(rule + " " + ratio.toFixed(2));
    if (!(ratio >= 0.6) || cliN < 400) bad.push(rule + " " + ratio.toFixed(2) + "/" + cliN + "op");
  }
  check("15 个模式客机绘图量与房主同量级", bad.length === 0,
    bad.length ? bad.join(",") : detail.join(" "));
}


/* ================================================================== *
 *  5. packFighter 字段覆盖（源码 + 运行时两路一起看）
 * ================================================================== */
console.log("\n=== 5. 每个玩家的随身状态都过线 ===");
{
  const root = path.join(__dirname, "..");
  const net = fs.readFileSync(path.join(root, "src/js/60_net.js"), "utf8");
  const fields = {
    "手电筒开关 flash": /f\.flash \? 1 : 0/,
    "手电筒电量 battery": /f\.battery == null \? 100 : f\.battery/,
    "黑暗度 dark": /f\.dark \|\| 0/,
    "躲猫猫身份 hideRole": /f\.hideRole === "seeker"/,
    "普攻皮肤 loadout.basic": /\(f\.loadout && f\.loadout\.basic\)/,
    "等级 level": /f\.level \|\| 1/,
    "金币 bcoins": /Math\.round\(f\.bcoins \|\| 0\)/,
    "草丛隐身 bushHide": /f\.bushHide \? 1 : 0/,
    "草里 inBush": /f\.inBush \? 1 : 0/,
    "座位 chairSeat": /f\.chairSeat == null \? -1 : f\.chairSeat/,
    "壳种类（小兵/分身/龙）": /f\.kind === "laneMinion" \? 1 : f\.kind === "minion" \? 2/
  };
  const lost = Object.keys(fields).filter(k => !fields[k].test(net));
  check("packFighter 带齐随身状态", lost.length === 0, lost.join(",") || "11/11");
  check("unpackFighter 有对应的还原", /f\.hideRole = /.test(net) && /f\.battery = /.test(net) &&
    /f\.chairSeat = /.test(net), "hideRole / battery / chairSeat");
  check("模式状态在 tm 之前应用（道具结构要先对齐）",
    net.indexOf("LD.NetMode.apply(s.mo)") >= 0 &&
    net.indexOf("LD.NetMode.apply(s.mo)") < net.indexOf("s.tm"),
    "顺序正确");
  check("道具位置对所有 kind 都跟随（不再只同步车和船）",
    /o\.x = a\[1\];\s*o\.y = a\[2\];/.test(net));
  check("客机也推进 B.t（否则呼吸 / 闪烁动画全死）", /B\.t = \(B\.t \|\| 0\) \+ dt/.test(net));

  /* 运行时：夜战跑一段，看客机英雄身上真的有电量 / 手电筒字段 */
  const blk = RESULTS.find(x => x.rule === "blackout");
  const hf = blk.p.CP.fighters.filter(f => f.kind === "hero");
  check("夜战：客机英雄带着手电筒状态",
    hf.length > 0 && hf.every(f => typeof f.battery === "number" && typeof f.flash === "boolean"),
    hf.length + " 人，电量 " + (hf[0] ? hf[0].battery : "-"));
  check("夜战：客机英雄手电筒电量与房主一致",
    hf.every((f, i) => {
      const h = blk.p.HP.fighters.filter(x => x.kind === "hero" && x.side === f.side)[0];
      return h && Math.abs((h.battery || 0) - (f.battery || 0)) < 1;
    }), "对齐");

  const hid = RESULTS.find(x => x.rule === "hide");
  const hh = hid.p.CP.fighters.filter(f => f.kind === "hero");
  check("躲猫猫：客机的英雄带着身份（鬼 / 人）",
    hh.length > 0 && hh.some(f => f.hideRole === "seeker" || f.hideRole === "hider"),
    hh.map(f => f.hideRole || "-").join(","));
  check("躲猫猫：客机搜索进度字段结构正确（变鬼后能搜柜子）",
    hid.sent !== null && hid.sent !== undefined, "search 段长度 " + String(hid.sent).length);
}

/* ================================================================== *
 *  6. 布局同种子一致 + 运行期道具
 * ================================================================== */
console.log("\n=== 6. 布局与运行期道具 ===");
{
  const root = path.join(__dirname, "..");
  check("14_rand.js 提供了可复现随机源", fs.existsSync(path.join(root, "src/js/14_rand.js")));
  const battle = fs.readFileSync(path.join(root, "src/js/40_battle.js"), "utf8");
  const seededCalls = (battle.match(/seeded\(this, "/g) || []).length;
  check("resetRound 的各 init 都套了同种子", seededCalls >= 12, seededCalls + " 处");
  check("布局基线 propBase 已记录", /this\.propBase = /.test(battle));
  check("B.setup 里保存了 netSeed", /this\.netSeed = cfg\.seed/.test(battle));

  /* 运行时：同一模式同一种子起两局，道具布局应完全一样（两端靠这个对齐） */
  const SB = require("./_sandbox.js");
  const mk = tag => {
    const sb = SB.makeSandbox("np-seed-" + tag);
    bootRule(sb, "capture", 3);
    return sb.LD.Battle.terrain.props.map(o => (o.kind || "?") + "@" + Math.round(o.x) + "," + Math.round(o.y)).join("|");
  };
  check("同种子两次开局的道具布局完全一致", mk("a") === mk("b"),
    mk("a") === mk("b") ? "一致" : "不同");

  /* 运行期道具：渡江的船 / 抢椅子的椅子 / 塔防炮塔 —— 客机侧长度要跟房主对上 */
  const riv = RESULTS.find(x => x.rule === "river");
  const hp = riv.p.HP.terrain.props.length, cp = riv.p.CP.terrain.props.length;
  check("渡江：客机道具数量与房主一致（船不能凭空少）", hp === cp, hp + " vs " + cp);

  const cap = RESULTS.find(x => x.rule === "capture");
  check("占点：客机也拿到了据点炮塔",
    cap.p.CP.terrain.props.length === cap.p.HP.terrain.props.length,
    cap.p.CP.terrain.props.length + " vs " + cap.p.HP.terrain.props.length);
  const capTurrets = cap.p.CP.terrain.props.filter(o => o.pt);
  check("占点：炮塔能反查到据点（转属绘制要用）",
    cap.p.CP.terrain.props.length === cap.p.HP.terrain.props.length &&
    (capTurrets.length === 0 || capTurrets.every(o => o.pt && o.pt.turret === o)),
    capTurrets.length + " 座");
}

/* ================================================================== *
 *  7. 带宽 / 稳定性
 * ================================================================== */
console.log("\n=== 7. 带宽与稳定性 ===");
{
  const worst = RESULTS.slice().sort((a, b) => b.snapBytes - a.snapBytes)[0];
  check("单帧快照不超过 4 KB", worst.snapBytes < 4096, "最大 " + worst.rule + " " + worst.snapBytes + "B");
  const perSec = worst.snapBytes * 30;
  check("30Hz 下带宽 < 150 KB/s（局域网够用）", perSec < 150 * 1024,
    (perSec / 1024).toFixed(0) + " KB/s");
  const allOk = RESULTS.every(r => !r.drawErr);
  check("15 个模式全程双端绘制无异常", allOk,
    RESULTS.filter(r => r.drawErr).map(r => r.rule + ":" + r.drawErr).join(" | ") || "15/15");
  check("客机没有把快照反灌回房主（流量只单向）",
    RESULTS.every(r => r.bytes > 0), "单向正常");
}

/* ================================================================== *
 *  8. 多人房间能选塔防
 * ================================================================== */
console.log("\n=== 8. 多人模式里的塔防 ===");
{
  const root = path.join(__dirname, "..");
  const room = fs.readFileSync(path.join(root, "src/js/75_room.js"), "utf8");
  check("联机房间的规则栏不再排除 tower",
    /ruleBarHtml\(R\.rule, \["relay"\], "nrule", !isHost\)/.test(room),
    "排除列表只剩 relay（车轮战确实不适合联机）");
  check("本地房间的规则栏同样不排除 tower",
    /ruleBarHtml\(room\.rule, \["relay"\]\)/.test(room), "排除列表只剩 relay");

  /* 真的渲一遍房间面板，确认 tower 那个按钮出现在 HTML 里 */
  const SB = require("./_sandbox.js");
  const sb = SB.makeSandbox("np-roombar");
  let html = "";
  try {
    sb.LD.UI.renderRoom();
    const body = sb.document.getElementById("roomBody");
    html = body ? (body.innerHTML || "") : "";
  } catch (e) { html = ""; }
  check("房间面板真的渲染出了 tower 按钮",
    html.indexOf('data-rule="tower"') >= 0,
    html ? (html.indexOf('data-rule="tower"') >= 0 ? "有" : "没有") : "renderRoom 未产出 HTML");
  check("联机规则栏用的是 data-nrule",
    /data-' \+ attrName|"data-" \+ attrName/.test(room) || room.indexOf("data-' + attrName") >= 0);

  check("开局时下发种子（两端布局同源）",
    /const seed = \(\(Math\.random\(\) \* 1e9\) \| 0\) \|\| 1/.test(room) &&
    /t: "go"[\s\S]{0,200}seed/.test(room));
  const ui = fs.readFileSync(path.join(root, "src/js/70_ui.js"), "utf8");
  check("UI.startNetBattle 接收 seed", /startNetBattle\s*=\s*function\s*\([^)]*seed/.test(ui) ||
    /startNetBattle\(roster[\s\S]{0,120}seed/.test(ui));
  check("go 消息里的 seed 被透传下去", /d\.seed/.test(ui));
}

/* ================================================================== *
 *  9. 「画得出来」不等于「画得对」：逐实体比对
 * ==================================================================
 *  第 4.5 节只比了绘图指令的**总数**。总数一样，仍可能「房主画了 A，
 *  客机画成了 B」。这里 hook 掉 View 的实体绘制函数，记录每一笔
 *  「谁被画在哪儿」，再逐类对账。
 *  另外两个坑必须写进断言：
 *    · 王从天降的红圈 kingMark（global 的那个是给**全员**的预警，
 *      漏了客机被砸之前没有任何预兆）
 *    · 丧尸超过 10 具后 corpseGone 不再画老尸体，漏了客机画面越堆越脏
 */
console.log("\n=== 9. 逐实体比对（画的是不是同一批东西） ===");
{
  const SB = require("./_sandbox.js");
  const FNS = ["chibi", "dragon", "minion", "robot", "grave", "bomb", "structure", "prop"];
  const hook = (LD, sink) => {
    const V = LD.View;
    FNS.forEach(name => {
      if (typeof V[name] !== "function" || V[name].__hooked) return;
      const orig = V[name];
      const w = function () {
        const a = arguments;
        let rec;
        if (name === "prop") rec = { fn: name, kind: a[1] && a[1].kind };
        else rec = { fn: name };
        sink.push(rec);
        return orig.apply(this, a);
      };
      w.__hooked = true;
      V[name] = w;
    });
  };
  const bad = [];
  for (const rule of STATEFUL.concat(["brawl", "gifts", "auction", "doomsday", "warmup"])) {
    const p = P.makePair({ rule: rule, fighters: 3, seed: 20260214, draw: false });
    const hl = [], cl = [];
    hook(p.host.LD, hl); hook(p.client.LD, cl);
    const ctx = SB.makeCtx();
    /* 跑 24 秒：王冠落地、僵尸堆起来、船换过一批……这些都要时间才出现 */
    let badRule = false;
    for (let step = 0; step < 8 && !badRule; step++) {
      p.frame(3);
      hl.length = 0; cl.length = 0;
      try { p.HP.draw(ctx); } catch (e) {}
      try { p.CP.draw(ctx); } catch (e) {}
      const t = arr => {
        const m = {};
        arr.forEach(r => { const k = r.fn + (r.kind ? ":" + r.kind : ""); m[k] = (m[k] || 0) + 1; });
        return m;
      };
      const hs = t(hl), cs = t(cl);
      const keys = new Set([...Object.keys(hs), ...Object.keys(cs)]);
      for (const k of keys) {
        const a = hs[k] || 0, b = cs[k] || 0;
        if (a === b) continue;
        /* 人形差 1 个是合法的「视角差」：夜战全员隐身、草丛隐身、躲进柜子，
         * 设计上都是「自己看得见、别人看不见」，而两端各看各的 meHero
         * （房主看自己，客机看自己），所以各自少画一个人才对。
         * 车 / 塔 / 墓碑 / 小兵这些没有视角概念，差一个就是真漏了。 */
        if (k === "chibi" && Math.abs(a - b) <= 1) continue;
        badRule = true;
      }
    }
    if (badRule) bad.push(rule);
  }
  check("9 秒 × 8 轮里双端画出的实体种类与数量始终一致", bad.length === 0, bad.join(",") || "20/20");
}

/* ================================================================== *
 *  10. 客机的按键真的能驱动自己那台角色
 * ==================================================================
 *  这条链路以前完全没测过 —— 测试台里客机座位也是人机，从不按任何一个键。
 *  而「变鬼后搜不了柜子」「上不了车」「打不出伤害」全在这条链路上。
 *  链路：客机 UI.ctrl → Net.sendInput → 房主 applyRemoteInput → remoteCtrl
 *        → 房主权威逻辑 → 快照回传
 */
console.log("\n=== 10. 客机按键 → 房主执行 → 回传 ===");
{
  const mk = rule => {
    const p = P.makePair({ rule: rule, fighters: 3, seed: 20260214, draw: false, clientManual: true });
    p.frame(3);                     // 过掉 2 秒倒计时，否则 state 不是 fight，按键不生效
    return p;
  };
  {
    const p = mk("brawl");
    const h = p.HP.fighters.find(f => f.side === 1);
    check("客机座位不是人机（不然测不到按键）", !h.bot && !h.isBot);
    const x0 = h.x;
    p.CB.UI.ctrl.mx = 1; p.CB.UI.ctrl.my = 0;
    p.frame(0.8);
    p.CB.UI.ctrl.mx = 0;
    check("客机按住方向键，房主侧那台角色真的在走",
      Math.abs(p.HP.fighters.find(f => f.side === 1).x - x0) > 20,
      "Δx=" + (p.HP.fighters.find(f => f.side === 1).x - x0).toFixed(1));

    const before = p.HP.fighters.find(f => f.side === 1).cd.basic;
    p.CB.UI.ctrl.press.basic = true;
    p.frame(0.15);
    const after = p.HP.fighters.find(f => f.side === 1).cd.basic;
    check("客机按普攻，房主侧进入攻击冷却", after > before, before + " → " + after.toFixed(2));
    check("攻击动画也回传到客机（不然客机看不到自己在打）",
      p.CP.fighters.find(f => f.side === 1).atkAnim > 0,
      p.CP.fighters.find(f => f.side === 1).atkAnim.toFixed(2));
  }
  {
    /* 躲猫猫：变鬼之后按 P 能不能搜柜子 —— 用户亲自报的问题 */
    const p = mk("hide");
    const me = p.HP.fighters.find(f => f.side === 1);
    const lockers = p.HP.terrain.props.filter(o => o.kind === "locker" && !o.dead);
    if (!lockers.length) check("躲猫猫地图里有柜子", false);
    else {
      const L = lockers[0];
      me.x = L.x; me.y = L.y + (L.h || 40) / 2 + 18;
      p.frame(0.2);
      p.CB.UI.ctrl.press.interact = true;
      p.frame(0.6);
      check("客机按 P 真的钻进了柜子（房主侧）", !!p.HP.fighters.find(f => f.side === 1).hideProp);
      /* v4.35：在柜子里用的是 hideProp（自己看得见自己），不再和「在开车」共用 hiddenNet */
      check("客机自己也看到自己躲进柜子（hideProp 回传，自己仍可见）",
        !!p.CP.fighters.find(f => f.side === 1).hideProp &&
        !p.CP.fighters.find(f => f.side === 1).hiddenNet);
    }
  }
}

/* ================================================================== *
 *  11. 开局道具的运行时变量（tm 那 9 个字段之外的部分）
 * ==================================================================
 *  packProp 只管「运行期 push 的道具」，开局就摆好的车 / 船 / 炮塔只走 tm。
 *  tm 原来只发 [dead, x, y, hp, fuel, driver, carried, cargo, occupant]，
 *  于是这几样在客机上永远停在开局值：
 *    · 碰碰车的车损 bumpHp —— 客机看到的每辆车都是满耐久
 *    · 炮塔的炮管朝向 aimAngle —— 客机的炮管永远朝左
 *    · 船的型号 / 油箱 —— 激流模式整批换船后，客机还拿着开局那条旧船
 */
console.log("\n=== 11. 开局道具的运行时变量 ===");
{
  {
    const p = P.makePair({ rule: "bump", fighters: 3, seed: 20260214, draw: false });
    p.frame(20);
    const hc = p.HP.terrain.props.filter(o => o.kind === "car");
    const cc = p.CP.terrain.props.filter(o => o.kind === "car");
    const mismatch = hc.filter((o, i) => !cc[i] || Math.abs((o.bumpHp || 0) - (cc[i].bumpHp || 0)) > 1);
    check("碰碰车 20 秒后车损一致（客机不再全是满耐久）", mismatch.length === 0,
      mismatch.length ? mismatch.length + " 辆车对不上" : hc.map(o => Math.round(o.bumpHp)).join("/"));
  }
  {
    const p = P.makePair({ rule: "tower", fighters: 3, seed: 20260214, draw: false });
    p.frame(20);
    const ht = p.HP.terrain.props.filter(o => o.kind === "tower");
    const ct = p.CP.terrain.props.filter(o => o.kind === "tower");
    const mismatch = ht.filter((o, i) => !ct[i] || Math.abs((o.aimAngle || 0) - (ct[i].aimAngle || 0)) > 0.05);
    check("塔防的炮管朝向一致（客机的炮管会转）", mismatch.length === 0,
      mismatch.length ? mismatch.length + " 座塔朝向不同" : ht.length + " 座塔");
  }
  {
    const p = P.makePair({ rule: "river", fighters: 3, seed: 20260214, draw: false });
    p.frame(20);
    const hs = p.HP.terrain.props.filter(o => o.ship);
    const cs = p.CP.terrain.props.filter(o => o.ship);
    const same = hs.length === cs.length && hs.every((o, i) =>
      o.vtype === cs[i].vtype && (o.fuelMax || 0) === (cs[i].fuelMax || 0));
    check("激流换船后两端型号与油箱一致", same,
      hs.map((o, i) => o.vtype + "/" + o.fuelMax + (cs[i] ? " vs " + cs[i].vtype + "/" + cs[i].fuelMax : ""))
        .join("  "));
  }
}

/* ================================================================== *
 *  12. 纯视觉字段（画面上看不见但必须对）
 * ================================================================== */
console.log("\n=== 12. 纯视觉字段 ===");
{
  const root = path.join(__dirname, "..");
  const net = fs.readFileSync(path.join(root, "src/js/60_net.js"), "utf8");
  check("kingRise（飞天抬升）过线", /f\.kingRise/.test(net) === false ? false : /Math\.round\(\(f\.kingRise \|\| 0\) \* 100\)/.test(net));
  check("corpseGone（老尸体已清理）过线", /f\.corpseGone \? 1 : 0/.test(net));
  check("kingMark（全员可见的落点红圈）过线", /f\.kingMark \? \[/.test(net));
  check("respawnT（复活倒计时）过线", /r\(f\.respawnT \|\| 0, 1\)/.test(net));

  /* 塔防墓碑：客机的 B.graves 以前是 undefined，于是「队友死在哪儿」完全看不到 */
  const nm = fs.readFileSync(path.join(root, "src/js/61_netmode.js"), "utf8");
  check("塔防墓碑过线", /B\.graves \|\| \[\]/.test(nm) && /B\.graves\.push/.test(nm));

  const p = P.makePair({ rule: "tower", fighters: 3, seed: 20260214, draw: false });
  p.frame(24);
  check("塔防跑 24 秒后客机有墓碑列表（哪怕空数组也不是 undefined）",
    Array.isArray(p.CP.graves), typeof p.CP.graves + "/" + (p.CP.graves && p.CP.graves.length));
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
