/* 孤高旅斗 · 无头测试共享沙箱
 *
 * 背景：18 个 test_*.js 过去各复制一份 makeCtx / makeEl / makeSandbox / step / key / tap，
 * 逐版演进后长出分叉（有的有 createPattern、有的 oninput 是 null 有的是 ""、
 * measureText 宽度 120 与 100 并存），改一处要改 18 处，且新测试容易抄到过期版本。
 * 现在统一到这里：本模块是各版本样板的**并集**，新测试直接 require 即可。
 *
 * 用法：
 *   const SB = require("./_sandbox.js");
 *   const { html, code, makeCtx, makeEl, makeSandbox, step, key, tap } = SB;
 *
 * 可选参数：
 *   makeSandbox(label, { textW: 100 })   自定义 measureText 返回宽度（默认 120）
 *   makeSandbox(label, { balance: false }) 跳过 dist/balance.js 预执行（默认执行，
 *                                          与浏览器一致：balance.js 在主脚本之前）
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DIST_HTML = path.join(DIST, "孤高旅斗.html");

if (!fs.existsSync(DIST_HTML)) {
  console.error("!! 找不到 " + DIST_HTML + "，请先运行 python scripts/build.py --keep");
  process.exit(2);
}

/* 交付产物本体 —— 测试的就是要交付的那个文件，不存在「源码过了打包坏了」的缝隙 */
const html = fs.readFileSync(DIST_HTML, "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let CLK = 0;

function makeCtx(opts) {
  const o = opts || {};
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient")
        return () => ({ addColorStop() {} });
      if (k === "createPattern") return () => ({});
      if (k === "measureText") return () => ({ width: o.textW == null ? 120 : o.textW });
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
    tagName: (tag || "div").toUpperCase(),
    style: {}, dataset: {}, value: "", textContent: "", innerHTML: "",
    placeholder: "", width: 0, height: 0, disabled: false,
    onclick: null, onchange: null, oninput: null, onsubmit: null, title: "",
    checked: false, className: "", id: "", href: "", src: "",
    classList: {
      add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, f) => {
        if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); }
        else if (f) s.add(c); else s.delete(c);
      }
    },
    children: [], childNodes: [],
    addEventListener() {}, removeEventListener() {},
    focus() {}, select() {}, blur() {}, click() {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {},
    querySelector: sel => makeEl(/canvas/i.test(String(sel)) ? "canvas" : "div"),
    querySelectorAll: () => [],
    getContext: () => makeCtx(opts_of()),
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    hasAttribute: () => false, matches: () => false, closest: () => null,
    insertAdjacentHTML() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 960, bottom: 600, width: 960, height: 600 }),
    scrollTop: 0, scrollHeight: 0, clientWidth: 960, clientHeight: 600,
    firstChild: null, lastChild: null,
    parentNode: { lastChild: { textContent: "" }, appendChild() {}, removeChild() {} }
  };
}

/* getContext 需要拿到外层 opts，用一个模块级游标传递 */
let _curOpts = null;
function opts_of() { return _curOpts; }

function makeSandbox(label, opts) {
  const o = opts || {};
  _curOpts = o;
  const els = {}, L = {}, raf = [];
  const on = (t, f) => { (L[t] = L[t] || []).push(f); };
  const sb = {
    console, JSON, Math, Date, isNaN, isFinite, parseInt, parseFloat,
    String, Number, Boolean, Array, Object, Set, Map, Error, RegExp, Promise,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: cb => { raf.push(cb); return raf.length; },
    cancelAnimationFrame() {},
    performance: { now: () => CLK },
    navigator: { vibrate() {}, clipboard: { writeText() {} }, userAgent: "node-headless" },
    location: {
      protocol: "http:", host: "127.0.0.1:8123",
      origin: "http://127.0.0.1:8123", href: "http://127.0.0.1:8123/"
    },
    localStorage: {
      _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
      clear() { this._d = {}; }
    },
    document: {
      getElementById: id => els[id] || (els[id] = makeEl(id === "cv" ? "canvas" : "div")),
      createElement: t => makeEl(t),
      querySelector: sel => makeEl(/canvas/i.test(String(sel)) ? "canvas" : "div"),
      querySelectorAll: () => [], addEventListener: on, removeEventListener() {},
      readyState: "complete", hidden: false, body: makeEl("body"),
      documentElement: makeEl("html")
    },
    addEventListener: on, removeEventListener() {},
    innerWidth: 1400, innerHeight: 900, devicePixelRatio: 1,
    /* 无头环境没有真实图片解码：Image 恒为「未加载」，绘制层走程序化兜底。
     * 各测试原本对 Image 的处理并不统一（有的给 complete/naturalWidth，
     * 有的只给 onload，有的干脆不提供），所以做成可关的：
     *   makeSandbox(label, { image: false }) —— 沙箱里不存在 Image，
     *   用于专门断言「无 Image 时静默降级」的老测试。 */
    Image: (o.image === false) ? undefined : function () {
      this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0;
      this.src = ""; this.onload = null; this.onerror = null;
      this.width = 0; this.height = 0; this.alt = ""; this.className = "";
    }
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  sb.__L = L;          /* 个别测试（v33）直接取 __L.keydown 触发按键 */
  vm.createContext(sb);
  /* 与浏览器一致：<script src="balance.js"> 先于主脚本执行（曾因顺序漏测过崩溃） */
  if (o.balance !== false) {
    const balPath = path.join(DIST, "balance.js");
    if (fs.existsSync(balPath))
      vm.runInContext(fs.readFileSync(balPath, "utf8"), sb, { filename: "balance.js" });
  }
  vm.runInContext(code, sb, { filename: "孤高旅斗.html" });

  /* 返回值要同时兼容两套历史用法：
   *   老测试（v20/v26/v28/smoke…）的 makeSandbox 返回包装对象，写 S.sb.document / S.L / S.raf
   *   新测试（v30 之后）直接 `return sb`，写 sb.document / sb.L
   * 所以把沙箱自身的属性也平铺到返回对象上，两种写法都能取到。 */
  const ret = { label, sb, els, L, raf, err: null, LD: sb.LD };
  for (const k of Object.keys(sb)) if (!(k in ret)) ret[k] = sb[k];
  return ret;
}

function step(sb, n) {
  for (let i = 0; i < (n || 1); i++) {
    CLK += 16.67;
    const cbs = sb.raf.splice(0, sb.raf.length);
    for (const cb of cbs) { try { cb(CLK); } catch (e) { if (!sb.err) sb.err = e; } }
  }
}

function key(sb, code2, down) {
  const list = sb.L[down ? "keydown" : "keyup"] || [];
  const ev = { code: code2, repeat: false, key: code2, target: null, preventDefault() {} };
  for (const f of list) { try { f(ev); } catch (e) { if (!sb.err) sb.err = e; } }
}

function tap(sb, c) { key(sb, c, true); key(sb, c, false); }

/* 计数器 + 断言。老测试文件里 pass/fail 是本地变量，所以默认导出一个工厂，
 * 让迁移后的文件保留 3 行本地 check，末尾汇总代码一个字都不用改。 */
let pass = 0, fail = 0, failedLabels = [];

function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ✔ " + label + (extra ? "  [" + extra + "]" : "")); }
  else {
    fail++; failedLabels.push(label + (extra ? "  → " + extra : ""));
    console.log("  ✘ " + label + (extra ? "  → " + extra : ""));
  }
}

function counts() { return { pass, fail, failedLabels: failedLabels.slice() }; }

/* 工厂版：返回一对 [check, counts]，隔离在调用方自己的 pass/fail 上 */
function mkCheck() {
  const st = { pass: 0, fail: 0, failed: [] };
  const fn = (label, cond, extra) => {
    if (cond) { st.pass++; console.log("  ✔ " + label + (extra ? "  [" + extra + "]" : "")); }
    else {
      st.fail++; st.failed.push(label + (extra ? "  → " + extra : ""));
      console.log("  ✘ " + label + (extra ? "  → " + extra : ""));
    }
  };
  return [fn, () => st];
}

module.exports = {
  fs, vm, path, ROOT, DIST, html, code,
  makeCtx, makeEl, makeSandbox, step, key, tap,
  check, counts, mkCheck,
  now: () => CLK,
  resetClock: () => { CLK = 0; }
};
