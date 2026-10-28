/* 孤高旅斗 · 联机「客机到底缺什么」审计工具
 *
 * test_netparity.js 是断言式的回归（跑完给红绿灯）。这个文件是**排查**用的：
 * 改动联机协议之后，直接看哪一项对不上，不用猜。
 *
 * 用法：
 *   node tests/net_audit.js                # 全跑（默认 20 秒采样）
 *   node tests/net_audit.js props          # 只查道具层字段
 *   node tests/net_audit.js entities       # 只查「谁被画出来」
 *   node tests/net_audit.js fighters       # 只查玩家身上的字段
 *   node tests/net_audit.js fields         # 只查 Battle 对象上的字段
 *   SECS=40 node tests/net_audit.js props  # 改采样时长
 *
 * 判定口径：
 *   · 带 (无害) 标记的是「逻辑字段」或「客机补的默认值」，客机不跑逻辑用不到
 *   · 其余对不上的，基本就是协议漏了字段
 */
const P = require("./_netpair.js");
const SB = require("./_sandbox.js");

const SECS = Number(process.env.SECS || 20);
const ALL_RULES = ["brawl", "team", "overlord", "gifts", "ring", "auction", "doomsday",
  "relay", "hunt", "warmup", "blackout", "escort", "bump", "river", "capture", "tower",
  "hotpotato", "statue", "chair", "hide", "lava", "barrage"];

const S = v => {
  let s;
  try { s = JSON.stringify(v); } catch (e) { s = "<circ>"; }
  if (s === undefined) s = String(v);
  return s.length > 44 ? s.slice(0, 44) + "…" : s;
};

function head(t) { console.log("\n" + "=".repeat(64) + "\n  " + t + "\n" + "=".repeat(64)); }

/* ---------------------------------------------------------------- props */
/* 开局道具只走 tm（不像运行期新增的走 packProp），所以 tm 没列的运行时变量
 * 在客机上是永远停在开局值的 —— 这里就是把那些找出来。 */
const PROP_NOISE = new Set([
  "driver", "occupant", "pt", "canvas", "ctx", "img", "cargo", "carried", "uid",
  "kind", "x", "y", "w", "h", "r", "dead", "hp", "fuel", "ox", "oy", "vx", "vy"
]);
function auditProps(rules) {
  head("道具层：开局道具的运行时变量（tm 没覆盖到的字段）");
  rules.forEach(rule => {
    let p;
    try {
      p = P.makePair({ rule, fighters: 3, seed: 20260214, draw: false });
      p.frame(SECS);
    } catch (e) { console.log(rule + "  ERR " + e.message); return; }
    const hp = p.HP.terrain ? p.HP.terrain.props : [];
    const cp = p.CP.terrain ? p.CP.terrain.props : [];
    if (hp.length !== cp.length) {
      console.log("  " + rule.padEnd(11) + "道具数 H=" + hp.length + " C=" + cp.length + "  ← 结构就不一致");
      return;
    }
    const rows = [];
    for (let i = 0; i < hp.length; i++) {
      const a = hp[i], b = cp[i];
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (PROP_NOISE.has(k) || k[0] === "_") continue;
        const x = a[k], y = b[k];
        if (typeof x === "function" || (x && typeof x === "object")) continue;
        const diff = (typeof x === "number" && typeof y === "number")
          ? Math.abs(x - y) > 0.5 : S(x) !== S(y);
        if (diff) rows.push("#" + i + " " + (a.kind || "?") + "." + k + "  H=" + S(x) + " C=" + S(y));
      }
    }
    console.log("  " + rule.padEnd(11) + (rows.length ? "差异 " + rows.length + " 项" : "一致"));
    rows.slice(0, 8).forEach(r => console.log("       " + r));
    if (rows.length > 8) console.log("       …还有 " + (rows.length - 8) + " 项");
  });
}

/* ------------------------------------------------------------- entities */
/* hook 实体绘制函数，比「谁被画出来、各画了几个」。
 * 比绘图指令总数严：总数一样也可能「房主画 A、客机画成 B」。 */
const ENTITY_FNS = ["chibi", "dragon", "minion", "robot", "grave", "bomb", "structure", "prop"];
function hookView(LD, sink) {
  const V = LD.View;
  ENTITY_FNS.forEach(name => {
    if (typeof V[name] !== "function" || V[name].__hooked) return;
    const orig = V[name];
    const w = function () {
      const a = arguments;
      sink.push({ fn: name, kind: name === "prop" ? (a[1] && a[1].kind) : null });
      return orig.apply(this, a);
    };
    w.__hooked = true;
    V[name] = w;
  });
}
function auditEntities(rules) {
  head("实体绘制：两端画出来的是不是同一批东西（每 3 秒对一次账）");
  rules.forEach(rule => {
    let p;
    try { p = P.makePair({ rule, fighters: 3, seed: 20260214, draw: false }); }
    catch (e) { console.log(rule + "  ERR " + e.message); return; }
    const hl = [], cl = [];
    hookView(p.host.LD, hl); hookView(p.client.LD, cl);
    const ctx = SB.makeCtx();
    const marks = [];
    for (let step = 0; step < Math.max(1, Math.round(SECS / 3)); step++) {
      p.frame(3);
      hl.length = 0; cl.length = 0;
      try { p.HP.draw(ctx); } catch (e) { marks.push("@" + ((step + 1) * 3) + "s 房主绘制异常 " + e.message); }
      try { p.CP.draw(ctx); } catch (e) { marks.push("@" + ((step + 1) * 3) + "s 客机绘制异常 " + e.message); }
      const t = arr => {
        const m = {};
        arr.forEach(r => { const k = r.fn + (r.kind ? ":" + r.kind : ""); m[k] = (m[k] || 0) + 1; });
        return m;
      };
      const hs = t(hl), cs = t(cl);
      for (const k of new Set([...Object.keys(hs), ...Object.keys(cs)])) {
        const a = hs[k] || 0, b = cs[k] || 0;
        if (a === b) continue;
        /* 人形差 1 个是合法的视角差：隐身 / 草丛 / 柜子都是「自己看得见、别人看不见」 */
        if (k === "chibi" && Math.abs(a - b) <= 1) continue;
        marks.push("@" + ((step + 1) * 3) + "s " + k + " H=" + a + " C=" + b);
      }
    }
    console.log("  " + rule.padEnd(11) + (marks.length ? marks.length + " 处不一致" : "一致"));
    marks.slice(0, 6).forEach(m => console.log("       " + m));
  });
}

/* ------------------------------------------------------------- fighters */
/* 只挑「客机有值、房主没有」或数值明显不同，且带 (无害) 标记的跳过。
 * 房主独占的统计字段（hpHist / posHist / cdHist / dmgTaken）是回放录制用的。 */
const FIGHTER_NOISE = new Set([
  "ctrl", "AI", "look", "buff", "slot", "cd", "facing", "spr", "anim", "_tx", "_ty",
  "side", "id", "name", "team", "kind", "isBot", "loadout", "x", "y", "vx", "vy",
  "hp", "maxHp", "dead", "energy", "maxEnergy", "moving", "walkPhase", "atkAnim",
  "atkDur", "hitFlash", "blinkAmt", "stun", "root", "invuln", "shield", "shieldT",
  "parryT", "meditate", "blind", "stealthT", "overlord", "lock", "kills", "deaths",
  "respawnT", "blinkT", "hpHist", "posHist", "cdHist", "dmgTaken", "dmgDealt",
  "lastHurtAt", "bushSpotted", "windT", "coinTarget"
]);
function auditFighters(rules) {
  head("玩家字段：绘制 / HUD 会读、但客机拿不到的");
  rules.forEach(rule => {
    let p;
    try {
      p = P.makePair({ rule, fighters: 3, seed: 20260214, draw: false });
      p.frame(SECS);
    } catch (e) { console.log(rule + "  ERR " + e.message); return; }
    const key = f => (f.side == null ? f.kind + "?" : f.side) + ":" + f.kind;
    const hm = {}, cm = {};
    p.HP.fighters.forEach(f => { if (!hm[key(f)]) hm[key(f)] = f; });
    p.CP.fighters.forEach(f => { if (!cm[key(f)]) cm[key(f)] = f; });
    const rows = [];
    for (const k of Object.keys(hm)) {
      const a = hm[k], b = cm[k];
      if (!b) { rows.push(k + " 客机没有这个实体"); continue; }
      for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (FIGHTER_NOISE.has(f) || f[0] === "_") continue;
        const x = a[f], y = b[f];
        if (typeof x === "function") continue;
        if (x && typeof x === "object" && !Array.isArray(x)) continue;
        const diff = (typeof x === "number" && typeof y === "number")
          ? Math.abs(x - y) > 0.5 : S(x) !== S(y);
        if (diff) rows.push(k + "." + f + "  H=" + S(x) + " C=" + S(y));
      }
    }
    console.log("  " + rule.padEnd(11) + (rows.length ? "差异 " + rows.length + " 项" : "一致"));
    rows.slice(0, 8).forEach(r => console.log("       " + r + "   (多半无害：客机补的默认值)"));
    if (rows.length > 8) console.log("       …还有 " + (rows.length - 8) + " 项");
  });
}

/* --------------------------------------------------------------- fields */
function flat(o, pre, depth, out) {
  if (depth > 1 || !o || typeof o !== "object") return out;
  for (const k of Object.keys(o)) {
    if (k[0] === "_") continue;
    const v = o[k];
    if (typeof v === "function") continue;
    if (v && typeof v === "object") flat(v, pre + k + ".", depth + 1, out);
    else out[pre + k] = v;
  }
  return out;
}
function auditFields(rules) {
  head("Battle 对象：模式状态字段（跳过 isHost / mySide 这类本来就该不同的）");
  const SKIP = /^(Battle|Net)\.(isHost|mySide|snapCur|t|netSeed|propBase)$/;
  rules.forEach(rule => {
    let p;
    try {
      p = P.makePair({ rule, fighters: 3, seed: 20260214, draw: false });
      p.frame(SECS);
    } catch (e) { console.log(rule + "  ERR " + e.message); return; }
    const a = flat(p.HB.Battle, "", 0, {}), b = flat(p.CB.Battle, "", 0, {});
    const rows = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (SKIP.test(k)) continue;
      const x = a[k], y = b[k];
      if (typeof x === "number" && typeof y === "number") {
        if (Math.abs(x - y) > 0.06) rows.push(k + "  H=" + S(x) + " C=" + S(y));
      } else if (S(x) !== S(y)) rows.push(k + "  H=" + S(x) + " C=" + S(y));
    }
    console.log("  " + rule.padEnd(11) + (rows.length ? "差异 " + rows.length + " 项" : "一致"));
    rows.slice(0, 8).forEach(r => console.log("       " + r));
  });
}

/* ---------------------------------------------------------------- main */
const arg = process.argv[2];
const rules = process.argv.slice(3).length ? process.argv.slice(3) : ALL_RULES;
const only = arg && !arg.startsWith("-") ? arg : null;

if (!only || only === "props") auditProps(rules);
if (!only || only === "entities") auditEntities(rules);
if (!only || only === "fighters") auditFighters(rules);
if (!only || only === "fields") auditFields(rules);
console.log("");
