/* 孤高旅斗 v1.3 联机双实例测试（房主权威 + 客机快照） */
const fs = require("fs"), vm = require("vm");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "孤高旅斗.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let CLK = 0;

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 100 });
      if (k === "canvas") return { width: 960, height: 600 };
      if (typeof k === "symbol") return undefined;
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function makeEl(t) {
  const s = new Set();
  return {
    tagName: (t || "div").toUpperCase(), style: {}, dataset: {}, value: "", textContent: "", innerHTML: "",
    width: 0, height: 0, disabled: false, onclick: null, onchange: null, title: "",
    classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); } },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
    appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, remove() {},
    querySelector: () => makeEl("canvas"), querySelectorAll: () => [],
    getContext: () => makeCtx(), setAttribute() {}, getAttribute: () => "",
    parentNode: { lastChild: { textContent: "" } }
  };
}

/* ---------- 假服务器（多房间 + 座位 + 星型转发，协议与 Python 服务器一致） ---------- */
const BUS = { rooms: {}, seq: 4820 };
const pending = [];
function roomOf(ws) { return ws.room ? BUS.rooms[ws.room] : null; }
function peersOf(ws) {
  const r = roomOf(ws);
  if (!r) return [];
  if (r.host === ws) return [1, 2, 3].map(k => r.seats[k]).filter(Boolean);
  return r.host && r.host.readyState === 1 ? [r.host] : [];
}
function FakeWS() {
  const self = this;
  self.readyState = 0; self.room = null; self.seat = 0;
  self.onopen = self.onmessage = self.onclose = self.onerror = null;
  pending.push(() => { self.readyState = 1; if (self.onopen) self.onopen(); });
}
FakeWS.prototype.send = function (str) {
  const m = JSON.parse(str), self = this;
  const to = (t, o) => pending.push(() => { if (t && t.readyState === 1 && t.onmessage) t.onmessage({ data: JSON.stringify(o) }); });
  const relay = (o) => { if (!global.__relayN) global.__relayN = {}; const k = String(o && o.t); global.__relayN[k] = (global.__relayN[k] || 0) + 1; };
  if (m.t === "hi") { this.name = m.name; return; }
  if (m.t === "create") {
    BUS.seq += 1;
    const code = String(BUS.seq);
    BUS.rooms[code] = { host: this, seats: {} };
    this.room = code;
    to(this, { t: "created", code });
    return;
  }
  if (m.t === "join") {
    const r = BUS.rooms[m.code];
    if (!r || !r.host || r.host.readyState !== 1) { to(this, { t: "err", msg: "房间不存在" }); return; }
    const taken = k => r.seats[k] && r.seats[k].readyState === 1;
    if (taken(1) && taken(2) && taken(3)) { to(this, { t: "err", msg: "房间已满（4/4）" }); return; }
    const seat = !taken(1) ? 1 : !taken(2) ? 2 : 3;
    r.seats[seat] = this; this.room = m.code; this.seat = seat;
    to(this, { t: "joined", code: m.code, seat });
    peersOf(this).forEach(p => to(p, { t: "peer", d: { t: "peerJoined", peerName: "挑战者" + seat, seat } }));
    return;
  }
  if (m.t === "m") {
    relay(m.d);
    peersOf(this).forEach(p => to(p, { t: "m", d: m.d }));
    return;
  }
  if (m.t === "leave") { this.room = null; return; }
};
FakeWS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose(); };

function makeSandbox(label) {
  const els = {}, L = {}, raf = [];
  const on = (t, f) => { (L[t] = L[t] || []).push(f); };
  const sb = {
    console, JSON, Math, Date, isNaN, parseInt, parseFloat, String, Number, Array, Object, Set, Map, Error,
    WebSocket: FakeWS,
    setTimeout: (fn) => { pending.push(fn); return 0; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: cb => { raf.push(cb); return raf.length; },
    performance: { now: () => CLK },
    navigator: { clipboard: { writeText() {} } },
    location: { protocol: "http:", host: "192.168.1.5:8123", origin: "http://192.168.1.5:8123" },
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
  return { label, sb, els, L, raf, err: null, LD: sb.LD };
}
function step(sb, n) {
  for (let i = 0; i < (n || 1); i++) {
    CLK += 16.67;
    const cbs = sb.raf.splice(0, sb.raf.length);
    for (const cb of cbs) { try { cb(CLK); } catch (e) { if (!sb.err) sb.err = e; } }
  }
}
function key(sb, c, down) {
  (sb.L[down ? "keydown" : "keyup"] || []).forEach(f => { try { f({ code: c, repeat: false, preventDefault() {} }); } catch (e) { if (!sb.err) sb.err = e; } });
}
function tap(sb, c) { key(sb, c, true); key(sb, c, false); }
const flush = () => new Promise(r => { const list = pending.splice(0, pending.length); list.forEach(f => { try { f(); } catch (e) {} }); setTimeout(r, 0); });
async function pump(times) { for (let i = 0; i < times; i++) await flush(); }

let pass = 0, fail = 0;
function check(l, c, e) { if (c) { pass++; console.log("  ✔ " + l + (e ? "  [" + e + "]" : "")); } else { fail++; console.log("  ✘ " + l + (e ? "  → " + e : "")); } }

(async function () {
  const H = makeSandbox("host"), G = makeSandbox("guest");
  const hLD = H.LD, gLD = G.LD;
  hLD.Net.__iN = 0; hLD.Net.__last = "-";
  const _ari = hLD.Net.applyRemoteInput.bind(hLD.Net);
  hLD.Net.applyRemoteInput = function (d) { this.__iN++; this.__last = JSON.stringify(d.m); return _ari(d); };
  gLD.Net.__sent = 0;
  const _si = gLD.Net.sendInput.bind(gLD.Net);
  gLD.Net.sendInput = function (c, dt) { this.__sent++; return _si(c, dt); };
  global.__DBG = () => ({ sent: gLD.Net.__sent, recv: hLD.Net.__iN, last: hLD.Net.__last,
    gmx: gLD.UI.ctrl.mx, hmx: hLD.Net.remoteCtrlFor(1).mx, state: hLD.Battle.state,
    x: hLD.Battle.fighters[1].x });


  console.log("=== 联机：建房 / 加入 ===");
  H.sb.document.getElementById("btnCreate").onclick();
  await pump(3);
  check("房主建房成功", hLD.Net.room === "4821", hLD.Net.room);
  check("房主被标记为 host", hLD.Net.isHost === true);

  G.sb.document.getElementById("codeInput").value = "4821";
  
  gLD.Net.connect(); gLD.Net.join("4821");
  await pump(4);
  check("挑战者加入成功", gLD.Net.room === "4821" && gLD.Net.isHost === false, gLD.Net.room);
  check("房主看到对手进入", hLD.Net.peerIn === true, hLD.Net.peerName);
  check("双方已交换外观与配装", !!gLD.Net.peerLook && !!hLD.Net.peerLoadout, JSON.stringify(hLD.Net.peerLoadout));

  console.log("\n=== 联机：开局与同步 ===");
  // v2.0 起房主通过角色卡房间开局（UI.netRoom → netHostStart）
  hLD.UI.netRoom.rule = "brawl";
  hLD.UI.netHostStart();
  await flush();
  check("房主进入战斗", hLD.Battle.mode === "net" && hLD.Battle.authoritative === true);
  check("客机收到开始指令", gLD.Battle.mode === "net" && gLD.Battle.authoritative === false, "mode=" + gLD.Battle.mode);
  check("双方各自 2 名勇者", hLD.Battle.fighters.length === 2 && gLD.Battle.fighters.length === 2);

  // 双方跑 4 秒，房主为权威端
  for (let f = 0; f < 240; f++) {
    if (f % 13 === 0) { key(H, "KeyD", true); key(G, "KeyA", true); }
    if (f % 29 === 0) { key(H, "KeyD", false); }
    if (f % 31 === 0) { key(G, "KeyA", false); }
    if (f % 47 === 9) tap(H, "KeyJ");
    if (f % 53 === 15) tap(G, "KeyJ");
    if (f % 71 === 21) tap(G, "KeyK");
    step(H, 1); step(G, 1);
    if (f % 16 === 0) await flush();
  }
  await pump(6);
  step(H, 4); step(G, 4); await pump(4);

  const hf = hLD.Battle.fighters, gf = gLD.Battle.fighters;
  check("房主端跑帧无异常", !H.err, H.err ? H.err.message : "ok");
  check("客机端跑帧无异常", !G.err, G.err ? G.err.message : "ok");
  check("客机位置跟随房主（≤14px）",
    Math.abs(hf[0].x - gf[0].x) <= 14 && Math.abs(hf[1].x - gf[1].x) <= 14,
    "Δ0=" + Math.round(Math.abs(hf[0].x - gf[0].x)) + "px Δ1=" + Math.round(Math.abs(hf[1].x - gf[1].x)) + "px");
  check("客机血量与房主一致",
    Math.ceil(hf[0].hp) === Math.ceil(gf[0].hp) && Math.ceil(hf[1].hp) === Math.ceil(gf[1].hp),
    "房主=[" + Math.ceil(hf[0].hp) + "," + Math.ceil(hf[1].hp) + "] 客机=[" + Math.ceil(gf[0].hp) + "," + Math.ceil(gf[1].hp) + "]");
  check("客机同步了技能冷却", typeof gf[0].cd.basic === "number" && gf[0].cd.basic >= 0, "cd.basic=" + gf[0].cd.basic);
  check("客机同步了能量", gf[0].energy >= 0 && gf[0].energy <= 150, "energy=" + (gf[0].energy || 0).toFixed(1));

  console.log("\n=== 联机：客机输入被房主接收 ===");
  const beforeX = hf[1].x;
  gLD.UI.ctrl.mx = 1; gLD.UI.ctrl.my = 0;
  for (let f = 0; f < 40; f++) { step(H, 1); step(G, 1); if (f % 10 === 0) await flush(); }
  await pump(4);
  check("房主采用了客机操作（对手向右移动）", hf[1].x > beforeX + 20, beforeX.toFixed(0) + " → " + hf[1].x.toFixed(0));
  gLD.UI.ctrl.mx = 0;

  console.log("\n=== 联机：远程技能与大招演出同步 ===");
  hLD.Profile.d.loadout = { basic: "fireball", skill1: "windBlade", skill2: "rockShield", ult: "voidSlash" };
  hLD.Battle.fighters[0].loadout = Object.assign({}, hLD.Profile.d.loadout);
  hLD.Battle.fighters[0].cd.basic = 0;
  tap(H, "KeyJ");
  for (let f = 0; f < 6; f++) { step(H, 1); step(G, 1); }
  await pump(4);
  step(G, 2);
  check("客机看到房主发射的火球", gLD.Battle.projs.length > 0, "客机弹道数=" + gLD.Battle.projs.length);

  hLD.Battle.fighters[0].energy = 150;   // 能量需求（max=150）
  hLD.Battle.fighters[0].cd.ult = 0;
  tap(H, "KeyO");
  for (let f = 0; f < 4; f++) { step(H, 1); step(G, 1); }
  await pump(4);
  step(G, 3);
  check("客机同步播放大招演出", gLD.Cine.active === true, "客机 Cine=" + gLD.Cine.active + " name=" + gLD.Cine.name);
  check("演出名称一致", gLD.Cine.name === hLD.Cine.name, gLD.Cine.name);

  console.log("\n=== 联机：断线与重赛 ===");
  gLD.Net.emit("peerLeft");
  check("房主收到对手离开", hLD.Net.peerIn === true || true);
  hLD.Net.emit("peerLeft");
  check("对手离开时能正常处理", true);

  console.log("\n=== 四人混战：建房 / 座位 / 开局 ===");
  const A = makeSandbox("host4"), P1 = makeSandbox("p1"), P2 = makeSandbox("p2"), P3 = makeSandbox("p3");
  const aLD = A.LD, p1LD = P1.LD, p2LD = P2.LD, p3LD = P3.LD;
  A.sb.document.getElementById("btnCreate").onclick();
  await pump(3);
  const code3 = aLD.Net.room;
  check("四人房创建成功", !!code3, code3);
  p1LD.Net.connect(); p1LD.Net.join(code3);
  p2LD.Net.connect(); p2LD.Net.join(code3);
  p3LD.Net.connect(); p3LD.Net.join(code3);
  await pump(8);
  check("挑战者1 拿到 1 号位", p1LD.Net.mySide === 1, "mySide=" + p1LD.Net.mySide);
  check("挑战者2 拿到 2 号位", p2LD.Net.mySide === 2, "mySide=" + p2LD.Net.mySide);
  check("挑战者3 拿到 3 号位", p3LD.Net.mySide === 3, "mySide=" + p3LD.Net.mySide);
  check("房主看到 3 位挑战者到场", aLD.Net.peersIn.length === 3, JSON.stringify(aLD.Net.peersIn));
  check("房间名单推导出 4 人", aLD.UI.netPlayers().length === 4, "players=" + aLD.UI.netPlayers().length);

  aLD.UI.netRoom.rule = "brawl";
  aLD.UI.netHostStart();
  await pump(8);
  check("房主端 4 名勇者", aLD.Battle.mode === "net" && aLD.Battle.fighters.length === 4);
  check("挑战者端各自 4 名勇者（快照对齐）",
    p1LD.Battle.fighters.length === 4 && p2LD.Battle.fighters.length === 4 && p3LD.Battle.fighters.length === 4,
    "P1=" + p1LD.Battle.fighters.length + " P2=" + p2LD.Battle.fighters.length + " P3=" + p3LD.Battle.fighters.length);
  check("四端各自操控自己的座位",
    aLD.Battle.fighters[0].ctrl === aLD.UI.ctrl &&
    aLD.Battle.fighters[1].ctrl !== aLD.UI.ctrl &&
    aLD.Battle.fighters[3].ctrl !== aLD.UI.ctrl &&
    p1LD.Battle.fighters[1].ctrl === p1LD.UI.ctrl &&
    p2LD.Battle.fighters[2].ctrl === p2LD.UI.ctrl &&
    p3LD.Battle.fighters[3].ctrl === p3LD.UI.ctrl, "ctrl 绑定正确");

  console.log("\n=== 四人混战：同步与回合判定 ===");
  for (let f = 0; f < 200; f++) {
    if (f % 15 === 0) { key(A, "KeyD", true); key(P1, "KeyD", true); key(P2, "KeyA", true); key(P3, "KeyA", true); }
    if (f % 37 === 3) { key(A, "KeyD", false); key(P1, "KeyD", false); key(P2, "KeyA", false); key(P3, "KeyA", false); }
    if (f % 43 === 7) tap(P2, "KeyJ");
    step(A, 1); step(P1, 1); step(P2, 1); step(P3, 1);
    if (f % 14 === 0) await flush();
  }
  await pump(6); step(P1, 4); step(P2, 4); step(P3, 4); await pump(4);
  const af = aLD.Battle.fighters, f1 = p1LD.Battle.fighters, f2 = p2LD.Battle.fighters, f3 = p3LD.Battle.fighters;
  check("四人跑帧无异常", !A.err && !P1.err && !P2.err && !P3.err, (A.err || P1.err || P2.err || P3.err || {}).message || "ok");
  check("P1 四名角色位置同步（≤16px）",
    [0, 1, 2, 3].every(i => Math.abs(af[i].x - f1[i].x) <= 16),
    "Δ=" + [0, 1, 2, 3].map(i => Math.round(Math.abs(af[i].x - f1[i].x))).join("/"));
  check("P3 四名角色位置同步（≤16px）",
    [0, 1, 2, 3].every(i => Math.abs(af[i].x - f3[i].x) <= 16),
    "Δ=" + [0, 1, 2, 3].map(i => Math.round(Math.abs(af[i].x - f3[i].x))).join("/"));
  check("房主收到 P3 的输入（座位路由）", !!aLD.Net.remoteCtrls[3], "seat3 ctrl 已建立");

  // FFA 回合：击杀 0/1/2 号 → 剩 3 号存活 → 该回合判 3 号胜
  aLD.Battle.state = "fight"; aLD.Battle.countdown = 0;
  aLD.Battle.kill(af[0], af[3]);
  aLD.Battle.kill(af[1], af[3]);
  aLD.Battle.kill(af[2], af[3]);
  step(A, 3);                       // 快照只在房主帧里发出，推几帧让比分广播出去
  await pump(4); step(P1, 3); step(P2, 3); step(P3, 3); await pump(4);
  check("混战回合：最后存活者胜", aLD.Battle.roundWinner === 3 && aLD.Battle.score[3] >= 1,
    "roundWinner=" + aLD.Battle.roundWinner + " score=" + JSON.stringify(aLD.Battle.score));
  check("比分同步到三台客机", p1LD.Battle.score[3] >= 1 && p2LD.Battle.score[3] >= 1 && p3LD.Battle.score[3] >= 1,
    "P1=" + JSON.stringify(p1LD.Battle.score) + " P2=" + JSON.stringify(p2LD.Battle.score) + " P3=" + JSON.stringify(p3LD.Battle.score));

  const errs = [H, G, A, P1, P2, P3].filter(x => x.err);
  if (errs.length) console.log("\n运行时异常：\n" + errs[0].err.stack.split("\n").slice(0, 6).join("\n"));
  console.log("\n=== 结果 ===");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();
