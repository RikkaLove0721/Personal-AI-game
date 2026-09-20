/* 临时探针：验证客机 HUD 左上角显示谁的血量 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let CLK = 0;
function makeCtx() { return new Proxy({}, { get(t, k) { if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} }); if (k === "measureText") return () => ({ width: 100 }); if (k === "canvas") return { width: 960, height: 600 }; if (typeof k === "symbol") return undefined; return function () {}; }, set(t, k, v) { t[k] = v; return true; } }); }
function makeEl(t) { const s = new Set(); return { tagName: (t || "div").toUpperCase(), style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", width: 0, height: 0, disabled: false, onclick: null, onchange: null, title: "", classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle() {} }, addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, remove() {}, querySelector: () => makeEl("canvas"), querySelectorAll: () => [], getContext: () => makeCtx(), setAttribute() {}, getAttribute: () => "", parentNode: { lastChild: { textContent: "" } } }; }
const BUS = { rooms: {}, seq: 4820 };
const pending = [];
function roomOf(ws) { return ws.room ? BUS.rooms[ws.room] : null; }
function peersOf(ws) { const r = roomOf(ws); if (!r) return []; if (r.host === ws) return [1, 2, 3].map(k => r.seats[k]).filter(Boolean); return r.host && r.host.readyState === 1 ? [r.host] : []; }
function FakeWS() { const self = this; self.readyState = 0; self.room = null; self.seat = 0; self.onopen = self.onmessage = self.onclose = self.onerror = null; pending.push(() => { self.readyState = 1; if (self.onopen) self.onopen(); }); }
FakeWS.prototype.send = function (str) {
  const m = JSON.parse(str), self = this;
  const to = (t, o) => pending.push(() => { if (t && t.readyState === 1 && t.onmessage) t.onmessage({ data: JSON.stringify(o) }); });
  if (m.t === "hi") { this.name = m.name; return; }
  if (m.t === "create") { BUS.seq += 1; const code = String(BUS.seq); BUS.rooms[code] = { host: this, seats: {} }; this.room = code; to(this, { t: "created", code }); return; }
  if (m.t === "join") { const r = BUS.rooms[m.code]; const taken = k => r.seats[k] && r.seats[k].readyState === 1; const seat = !taken(1) ? 1 : !taken(2) ? 2 : 3; r.seats[seat] = this; this.room = m.code; this.seat = seat; to(this, { t: "joined", code: m.code, seat }); peersOf(this).forEach(p => to(p, { t: "peer", d: { t: "peerJoined", peerName: "c" + seat, seat } })); return; }
  if (m.t === "m") { peersOf(this).forEach(p => to(p, { t: "m", d: m.d })); return; }
  if (m.t === "leave") { this.room = null; return; }
};
function makeSandbox(label) {
  const els = {}, L = {}, raf = [];
  const on = (t, f) => { (L[t] = L[t] || []).push(f); };
  const sb = { console, JSON, Math, Date, isNaN, parseInt, parseFloat, String, Number, Array, Object, Set, Map, Error, WebSocket: FakeWS, setTimeout: fn => { pending.push(fn); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: cb => { raf.push(cb); return raf.length; }, performance: { now: () => CLK }, navigator: { clipboard: { writeText() {} } }, location: { protocol: "http:", host: "192.168.1.5:8123", origin: "http://192.168.1.5:8123" }, localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } }, document: { getElementById: id => els[id] || (els[id] = makeEl(id === "cv" ? "canvas" : "div")), createElement: t => makeEl(t), querySelector: () => makeEl(), querySelectorAll: () => [], addEventListener: on, readyState: "complete", hidden: false, body: makeEl() }, addEventListener: on, innerWidth: 1400, innerHeight: 900 };
  sb.window = sb; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(code, sb);
  return { label, sb, els, L, raf, err: null, LD: sb.LD };
}
function step(sb, n) { for (let i = 0; i < (n || 1); i++) { CLK += 16.67; const cbs = sb.raf.splice(0, sb.raf.length); for (const cb of cbs) { try { cb(CLK); } catch (e) { if (!sb.err) sb.err = e; } } } }
const flush = () => new Promise(r => { const list = pending.splice(0, pending.length); list.forEach(f => { try { f(); } catch (e) {} }); setTimeout(r, 0); });
async function pump(t) { for (let i = 0; i < t; i++) await flush(); }

(async () => {
  const H = makeSandbox("host"), G = makeSandbox("guest");
  H.sb.document.getElementById("btnCreate").onclick();
  await pump(3);
  const code2 = H.LD.Net.room;
  G.LD.Net.connect(); G.LD.Net.join(code2);
  await pump(6);
  console.log("guest mySide =", G.LD.Net.mySide);
  H.LD.UI.netHostStart();
  await pump(6);
  step(H, 3); step(G, 3); await pump(4);
  const gh = G.LD.Battle.hero(G.LD.Battle.mySide);
  console.log("guest B.mySide =", G.LD.Battle.mySide, " own hero side =", gh && gh.side, " hp =", gh && gh.hp);
  // 房主把客机打掉 77 血 → 快照同步
  const gHeroH = H.LD.Battle.fighters.find(f => f.side === G.LD.Battle.mySide);
  gHeroH.hp -= 77; gHeroH.energy = 33;
  step(H, 4); await pump(5); step(G, 4);
  G.LD.UI.updateHud();
  const left = G.els.pBars ? G.els.pBars.innerHTML : "(none)";
  console.log("guest pBars:", left.slice(0, 160));
  console.log("guest eBars:", (G.els.eBars ? G.els.eBars.innerHTML : "(none)").slice(0, 300));
  console.log("left shows 123?", /123/.test(left), " shows 200?", /\b200 \//.test(left));
})();
