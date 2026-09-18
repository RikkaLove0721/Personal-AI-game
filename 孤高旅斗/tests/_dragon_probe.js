/* 临时探针：巨龙火球 windup 化后是否正常出手（跑完可删） */
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

const S = makeSandbox();
const LD = S.sb.LD, B = LD.Battle, UI = LD.UI;
UI.startDragon(LD.LEVELS[0], LD.DIFF.normal);
step(S, 150);
const me = B.fighters[0], dg = B.fighters[1];
me.x = 120; me.y = 520; dg.x = 840; dg.y = 120;   // 拉开但不隔离伤害
let sawProj = 0, sawWindup = 0;
for (let i = 0; i < 60 * 10; i++) {
  step(S, 1);
  if (dg.slot.basic.phase === "dWindup") sawWindup++;
  sawProj = Math.max(sawProj, B.projs.length);
  if ((i % 120) === 0) console.log("t=%ds hp=%s dg.basic={on:%s phase:%s cd:%s} projs=%d dealt=%d",
    (i / 60).toFixed(1), me.hp, dg.slot.basic.on, dg.slot.basic.phase, (dg.cd.basic||0).toFixed(2), B.projs.length, dg.dmgDealt || 0);
}
console.log("windup 帧数:", sawWindup, " 最大同屏弹体:", sawProj, " 巨龙输出:", dg.dmgDealt || 0,
  " 英雄血量:", me.hp, "/", me.maxHp);
