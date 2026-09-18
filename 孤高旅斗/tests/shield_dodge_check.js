/* 专项回归：普攻与闪避共享CD + 岩土盾削弱与被打爆眩晕 */
const fs = require("fs"), vm = require("vm"), path = require("path");
let CLK = 0;
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 120 });
      if (k === "canvas") return { width: 960, height: 600 };
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
    classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); } },
    addEventListener() {}, appendChild(c) { return c; }, remove() {},
    querySelector: () => makeEl("canvas"), querySelectorAll: () => [],
    getContext: () => makeCtx(), width: 0, height: 0
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
      createElement: t => makeEl(t), querySelector: () => makeEl(), querySelectorAll: () => [],
      addEventListener: on, readyState: "complete", hidden: false, body: makeEl()
    },
    addEventListener: on, innerWidth: 1400, innerHeight: 900
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const balPath = path.join(__dirname, "..", "dist", "balance.js");
  if (fs.existsSync(balPath)) vm.runInContext(fs.readFileSync(balPath, "utf8"), sb, { filename: "balance.js" });
  vm.runInContext(code, sb);
  return { sb, L, raf };
}
function step(S, n) {
  for (let i = 0; i < (n || 1); i++) {
    CLK += 16.67;
    const cbs = S.raf.splice(0, S.raf.length);
    for (const cb of cbs) cb(CLK);
  }
}
function key(S, code, down) {
  const list = S.L[down ? "keydown" : "keyup"] || [];
  const ev = { code, repeat: false, key: code, target: null, preventDefault() {} };
  for (const f of list) f(ev);
}
function tap(S, c) { key(S, c, true); key(S, c, false); }

let pass = 0, fail = 0;
const check = (l, c, x) => { c ? (pass++, console.log("  ✔ " + l + (x !== undefined ? "  [" + x + "]" : ""))) : (fail++, console.log("  ✘ " + l + "  → " + x)); };

const S = makeSandbox();
const LD = S.sb.LD, B = LD.Battle, P = LD.Profile, UI = LD.UI;
const isolate = () => {   // 把双方拉开并清控制状态，避免巨龙火球干扰时序（不清盾/眩晕，那是要验证的状态）
  const me = B.fighters[B.mySide != null ? B.mySide : 0];
  const foe = B.fighters.find(f => f !== me);
  if (me) { me.x = 200; me.y = LD.CONF.H * 0.6; me.root = 0; }
  if (foe) { foe.x = 760; foe.y = LD.CONF.H * 0.6; }
  B.projs.length = 0;
  if (me) { me.hp = me.maxHp; }
};

/* ---- 1. 闪避 → 普攻进CD ---- */
console.log("=== 共享CD：闪避锁普攻 ===");
P.d.coins = 100;
UI.startDragon(LD.LEVELS[0], LD.DIFF.normal);
step(S, 150);
isolate(); step(S, 1);
const me = B.fighters[B.mySide != null ? B.mySide : 0];
check("开局普攻无CD", me.cd.basic === 0, me.cd.basic.toFixed(2));
key(S, "KeyD", true); key(S, "KeyD", false); step(S, 1);
key(S, "KeyD", true); key(S, "KeyD", false); step(S, 2);
isolate();
check("闪避已触发（自身闪避CD=2.5）", Math.abs(me.cd.dodge - 2.5) < 0.2, me.cd.dodge.toFixed(2));
check("普攻被闪避锁进CD（≈2.5）", me.cd.basic >= 2.3, me.cd.basic.toFixed(2));

/* ---- 2. 普攻 → 闪避进CD ---- */
console.log("=== 共享CD：普攻锁闪避 ===");
for (let i = 0; i < 60 * 4; i++) { isolate(); step(S, 1); }   // 等 CD 全部转好
isolate();
check("CD 已转好", me.cd.basic === 0 && me.cd.dodge === 0, me.cd.basic.toFixed(2) + "/" + me.cd.dodge.toFixed(2));
tap(S, "KeyJ");                     // 普攻（斩击，CD 1.6s）
step(S, 2);
isolate();
check("普攻进入CD（≈1.6）", me.cd.basic > 1.2 && me.cd.basic <= 1.7, me.cd.basic.toFixed(2));
check("闪避被普攻锁进CD", me.cd.dodge >= me.cd.basic - 0.1, me.cd.dodge.toFixed(2));

/* ---- 3. 岩土盾数值 + 被打爆眩晕 ---- */
console.log("=== 岩土盾 ===");
check("购买岩土盾", P.buySkill("rockShield").ok);
check("装配到技能2", P.equipSkill("skill2", "rockShield").ok);
B.resetRound ? B.resetRound() : null;
for (let i = 0; i < 400 && B.state !== "fight"; i++) { isolate(); step(S, 1); }   // 等进入战斗（回合时长有波动）
check("已进入战斗", B.state === "fight", B.state);
isolate(); step(S, 1);
const me2 = B.fighters[B.mySide != null ? B.mySide : 0];   // resetRound 可能重建战士，重新取引用
check("引用一致", me2 && me2.loadout.skill2 === "rockShield", me2 && me2.loadout.skill2);
const sk = LD.skill("rockShield");
check("盾量 36", sk.shield === 36, sk.shield);
check("持续 3 秒", sk.dur === 3.0, sk.dur);
check("爆炸伤害 16", sk.dmg === 16, sk.dmg);
tap(S, "KeyL");                     // 施放岩土盾
step(S, 2);
isolate();
check("护盾生效 36 点", me2.shield === 36, String(me2.shield));
check("无眩晕", me2.stun <= 0, String(me2.stun));
// 敌人主动打爆护盾
const foe = B.fighters.find(f => f !== me2);
B.damage(foe, me2, 50, { type: "skill", from: foe });
step(S, 2);
check("护盾被打爆后清零", me2.shield <= 0, String(me2.shield));
check("自己陷入 0.6 秒眩晕", Math.abs(me2.stun - 0.6) < 0.05, me2.stun.toFixed(2));
// 自然到期不眩晕（先等眩晕消退 + 技能2 CD 转好；回合超时则重开）
let tries = 0;
while (tries < 1500) {
  if (B.state === "over") B.resetRound ? B.resetRound() : null;
  isolate(); step(S, 1);
  const m = B.fighters[B.mySide != null ? B.mySide : 0];
  if (B.state === "fight" && m && m.cd.skill2 === 0 && m.stun <= 0) break;
  tries++;
}
const me3 = B.fighters[B.mySide != null ? B.mySide : 0];
isolate();
tap(S, "KeyL");
step(S, 2);
isolate();
check("二度施盾成功", me3.shield === 36, String(me3.shield));
me3.shieldT = 0.05;                  // 让护盾自然到期
for (let i = 0; i < 30 && me3.shield > 0; i++) { isolate(); step(S, 1); }
check("自然到期护盾消失", me3.shield <= 0, String(me3.shield));
check("自然到期不眩晕", me3.stun <= 0, me3.stun.toFixed(2));

console.log("=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
