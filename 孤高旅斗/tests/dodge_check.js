/* 临时验证：双击闪避 + 激光波CD不再卡死（跑完可删） */
const fs = require("fs"), vm = require("vm");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let CLK = 0;

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
    placeholder: "", width: 0, height: 0, disabled: false, onclick: null, onchange: null, title: "",
    classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); } },
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
      createElement: t => makeEl(t), querySelector: () => makeEl(), querySelectorAll: () => [],
      addEventListener: on, readyState: "complete", hidden: false, body: makeEl()
    },
    addEventListener: on, innerWidth: 1400, innerHeight: 900
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
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

/* ---- 1. 激光波CD回归（曾经卡死在7.5） ---- */
console.log("=== 激光波 CD 回归 ===");
P.d.coins = 100;
check("购买激光波", P.buySkill("laserWave").ok);
check("装配到技能1", P.equipSkill("skill1", "laserWave").ok && P.d.loadout.skill1 === "laserWave");
P.equipSkill("skill2", null);
UI.startDragon(LD.LEVELS[0], LD.DIFF.normal);
step(S, 150);                       // 过倒计时进入战斗
const me = B.fighters[B.mySide != null ? B.mySide : 0];
tap(S, "KeyK");                     // 施放激光波
step(S, 120);                       // 蓄力1.5s + 光束0.22s + endSlot
const cd0 = me.cd.skill1;
check("施放后 CD 进入 8 秒冷却", cd0 > 7.4 && cd0 <= 8, cd0.toFixed(2));
step(S, 60);                        // 1 秒后
const cd1 = me.cd.skill1;
check("1秒后 CD 正常递减（不再卡死）", cd1 < cd0 - 0.8 && cd1 > 6, cd0.toFixed(2) + "→" + cd1.toFixed(2));
let wait = 0;
while (me.cd.skill1 > 0 && wait < 60 * 25) {
  B.projs.length = 0; me.hp = me.maxHp; me.stun = 0; me.root = 0;   // 隔离巨龙干扰, 防止 hitstop 膨胀与死亡冻结
  step(S, 1); wait++;
}
check("CD 走完归零可再放", me.cd.skill1 === 0, me.cd.skill1.toFixed(2));
tap(S, "KeyK");
step(S, 40);
check("第二次施放成功（slot 激活）", me.slot.skill1.on, me.slot.skill1.phase);
UI.quitGame();

/* ---- 2. 双击方向键闪避 ---- */
console.log("=== 双击闪避 ===");
UI.startDragon(LD.LEVELS[0], LD.DIFF.normal);
step(S, 150);
const me2 = B.fighters[0];
const dg = B.fighters[1];
const isolate = () => {   // 把双方拉开并清控制状态，避免巨龙火球干扰时序
  me2.x = 120; me2.y = 500; me2.stun = 0; me2.root = 0; me2.meditate = 0;
  dg.x = 840; dg.y = 120; dg.mode = "idle"; dg.modeT = 0; dg.charge = 0; dg.telegraph = null;
};
isolate(); step(S, 1);
const x0 = me2.x, y0 = me2.y;
key(S, "KeyD", true); step(S, 1); key(S, "KeyD", false); step(S, 1);   // 第一击
isolate();
key(S, "KeyD", true); step(S, 1); key(S, "KeyD", false);               // 280ms 内第二击
step(S, 2);
check("双击触发闪避位移", me2.x > x0 + 80, (me2.x - x0).toFixed(1));
check("闪避后 CD = 2.5", Math.abs(me2.cd.dodge - 2.5) < 0.15, me2.cd.dodge.toFixed(2));
isolate();
const x1 = me2.x;
key(S, "KeyD", true); key(S, "KeyD", false); key(S, "KeyD", true); key(S, "KeyD", false); step(S, 2);
check("冷却期内再次双击不位移", Math.abs(me2.x - x1) < 1, (me2.x - x1).toFixed(1));
for (let i = 0; i < 60 * 3; i++) { isolate(); step(S, 1); }   // 等 CD 转好（全程隔离巨龙）
isolate();
const x2 = me2.x;
key(S, "KeyA", true); key(S, "KeyA", false); key(S, "KeyA", true); key(S, "KeyA", false); step(S, 2);
check("CD 转好后可再次闪避", me2.x < x2 - 80, (x2 - me2.x).toFixed(1));

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
