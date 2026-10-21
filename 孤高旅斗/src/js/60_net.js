/* ============================================================
 *  60_net.js — 局域网 1v1（房主权威模拟 / 客机快照插值）
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, C = LD.CONF;

  const Net = LD.Net = {
    ws: null, ok: false, room: null, isHost: false,
    mySide: 0,                       // 座位：房主=0，挑战者1/2 由服务器分配
    peerIn: false, peerName: "", peersIn: [], ping: 0,   // peersIn: 已加入的挑战者座位列表（房主用）
    roster: {},                      // 座位 → {look, loadout, name}（房主收集，开局随 go 下发）
    handlers: {},
    queue: [], lastSend: 0, sendInt: 1 / 30,
    snapPrev: null, snapCur: null, snapT: 0, snapInt: 1 / 30,
    started: false, peerLook: null, peerLoadout: null,   // peerLook/peerLoadout 兼容 1v1 旧字段
    remoteCtrls: {},                 // 座位 → 虚拟手柄（房主用）
    lanUrls: [], lanLoading: false   // 服务器告知的「朋友该打开的网址」列表
  };

  Net.on = function (k, fn) { (this.handlers[k] = this.handlers[k] || []).push(fn); };
  Net.emit = function (k, a) { (this.handlers[k] || []).forEach(f => { try { f(a); } catch (e) { console.warn(e); } }); };
  Net.url = function () {
    const p = location.protocol === "https:" ? "wss:" : "ws:";
    return p + "//" + location.host + "/ws";
  };

  Net.connect = function () {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (!location.protocol.startsWith("http")) { this.emit("status", { ok: false, why: "file" }); return; }
    this.fetchLanUrls();
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e) { this.emit("status", { ok: false, why: "err" }); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.ok = true;
      // 连接建立前的消息先排队，避免「连上之前点了创建房间」被丢弃
      const q = this.queue.splice(0, this.queue.length);
      q.forEach(o => { try { ws.send(JSON.stringify(o)); } catch (e) {} });
      this.emit("status", { ok: true });
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } this.handle(m); };
    ws.onclose = () => { this.ok = false; this.peerIn = false; this.queue.length = 0; this.emit("status", { ok: false, why: "closed" }); };
    ws.onerror = () => { this.emit("status", { ok: false, why: "err" }); };
  };

  /* 向服务器要局域网地址列表：服务端知道自己监听的端口，
     而客户端地址栏里的 localhost 发给朋友是连不上的。取不到就退回 location.origin */
  Net.fetchLanUrls = function () {
    if (this.lanUrls.length || this.lanLoading) return;
    if (!location.protocol.startsWith("http") || typeof fetch !== "function") return;
    this.lanLoading = true;
    const done = list => {
      this.lanUrls = list && list.length ? list : [location.origin];
      this.lanLoading = false;
      this.emit("lan", this.lanUrls);
    };
    try {
      fetch(location.protocol + "//" + location.host + "/api/lanip", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
        .then(j => {
          const port = j && j.port;
          const ips = (j && j.ips) || [];
          done(port ? ips.map(ip => location.protocol + "//" + ip + ":" + port) : null);
        })
        .catch(() => done(null));
    } catch (e) { this.lanLoading = false; done(null); }
  };

  Net.send = function (o) {
    if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(o)); } catch (e) {} return; }
    this.queue.push(o);
    if (this.queue.length > 60) this.queue.shift();
  };
  Net.toPeer = function (d) { this.send({ t: "m", d }); };

  Net.create = function () { this.send({ t: "hi", name: "房主" }); this.send({ t: "create" }); };
  Net.join = function (code) { this.send({ t: "hi", name: "挑战者" }); this.send({ t: "join", code: code }); };
  Net.leave = function () { this.send({ t: "leave" }); this.room = null; this.peerIn = false; };

  Net.handle = function (m) {
    switch (m.t) {
      case "created": this.room = m.code; this.isHost = true; this.mySide = 0; this.emit("created", m.code); break;
      case "joined": this.room = m.code; this.isHost = false; this.mySide = m.seat == null ? 1 : m.seat;
        this.emit("joined", m.code); this.sendProfile(); break;
      case "err": this.emit("err", m.msg); break;
      case "peer":
        if (m.d.t === "peerJoined") {
          this.peerIn = true;
          const seat = m.d.seat == null ? 1 : m.d.seat;
          if (this.peersIn.indexOf(seat) < 0) this.peersIn.push(seat);
          this.peerName = m.d.peerName || "挑战者";
          this.emit("peerJoined", seat); this.sendProfile();
        } else { this.peerIn = false; this.peersIn.length = 0; this.emit("peerLeft"); }
        break;
      case "m": this.fromPeer(m.d); break;
    }
  };

  Net.sendProfile = function () {
    const p = LD.Profile;
    this.toPeer({ t: "pl", side: this.mySide, look: p.look(), loadout: Object.assign({}, p.d.loadout), name: p.d.name || "勇者" });
  };

  Net.fromPeer = function (d) {
    switch (d.t) {
      case "pl": {
        const seat = d.side == null ? 1 : d.side;
        this.roster[seat] = { look: d.look, loadout: d.loadout, name: d.name || ("玩家" + (seat + 1)) };
        this.peerLook = d.look; this.peerLoadout = d.loadout;   // 兼容 1v1
        this.emit("profile", d); break;
      }
      case "rt": this.emit("roomTeam", d); break;   // 客机 → 房主：改自己的阵营
      case "room": this.emit("room", d); break;     // 房主 → 客机：房间状态（角色卡名单）
      case "go": this.emit("start", d); break;
      case "i": this.applyRemoteInput(d); break;
      case "s": this.applySnapshot(d); break;
      case "ce": this.playEvents(d.ev); break;   // 房主广播的伤害数字 / 暴击 / 弹反 / 爆炸
      case "again": this.emit("again"); break;
      case "bye": this.emit("peerLeft"); break;
    }
  };

  /* ---------------- 输入同步 ---------------- */
  Net.remoteCtrl = { mx: 0, my: 0, hold: {}, press: {} };   // 兼容 1v1（座位1）
  Net.remoteCtrlFor = function (seat) {
    if (!this.remoteCtrls[seat]) this.remoteCtrls[seat] = { mx: 0, my: 0, hold: {}, press: {} };
    return this.remoteCtrls[seat];
  };
  Net.applyRemoteInput = function (d) {
    const seat = d.side == null ? 1 : d.side;
    const rc = this.remoteCtrlFor(seat);
    rc.mx = d.m[0]; rc.my = d.m[1];
    ["basic", "skill1", "skill2", "ult"].forEach((k, i) => {
      rc.hold[k] = !!d.h[i];
      if (d.p[i]) rc.press[k] = true;
    });
    if (d.dd) rc.dodge = { x: d.dd[0], y: d.dd[1] };   // 双击闪避请求
    if (d.lk) rc.lockNext = d.lk;                      // V 键索敌切换
    if (d.it) rc.press.interact = true;                // v3.3 P 键交互
    // 时间戳用于延迟估算
    if (d.ts) this.ping = Math.max(0, Math.round(Date.now() - d.ts));
  };

  Net.sendInput = function (ctrl, dt) {
    this.lastSend += dt;
    const p = ["basic", "skill1", "skill2", "ult"];
    const anyPress = p.some(k => ctrl.press[k]);
    const dd = ctrl.dodge || null;
    const lk = ctrl.lockNext || 0;
    const it = ctrl.press.interact ? 1 : 0;
    if (dd) ctrl.dodge = null;
    if (lk) ctrl.lockNext = 0;
    if (this.lastSend < this.sendInt && !anyPress && !dd && !lk && !it) return;
    this.lastSend = 0;
    this.toPeer({
      t: "i", ts: Date.now(),          // 注意：时间戳字段必须与消息类型 t 区分开
      side: this.mySide,               // 房主按座位路由到对应虚拟手柄
      m: [Math.round(ctrl.mx * 100) / 100, Math.round(ctrl.my * 100) / 100],
      h: p.map(k => ctrl.hold[k] ? 1 : 0),
      p: p.map(k => ctrl.press[k] ? 1 : 0),
      dd: dd ? [Math.round(dd.x * 100) / 100, Math.round(dd.y * 100) / 100] : null,
      lk: lk, it: it
    });
    p.forEach(k => { ctrl.press[k] = false; });
    ctrl.press.interact = false;
  };

  /* ---------------- 快照 ---------------- */
  const SLOTS = ["basic", "skill1", "skill2", "ult"];
  function packFighter(f) {
    return [
      r(f.x), r(f.y), r(f.facing.x, 2), r(f.facing.y, 2),
      Math.round(f.hp), f.dead ? 1 : 0,
      r(f.vx, 0), r(f.vy, 0),
      f.kind === "hero" ? r(f.energy, 1) : 0,
      r(f.stun, 2), r(f.root, 2), r(f.invuln, 2), r(f.shield, 0), r(f.shieldT, 1),
      r(f.atkAnim, 2), r(f.atkDur, 2), f.moving ? 1 : 0, r(f.walkPhase, 1),
      f.hitFlash > 0 ? 1 : 0, f.blinkAmt != null ? r(f.blinkAmt, 2) : 1,
      f.buff ? r(f.buff.rage, 1) : 0, f.buff ? r(f.buff.thousand, 1) : 0, f.buff ? r(f.buff.rush, 1) : 0,
      f.meditate ? 1 : 0, r(f.parryT, 2),
      SLOTS.map(k => r(f.cd ? f.cd[k] : 0, 2)),
      SLOTS.map(k => (f.slot && f.slot[k] && f.slot[k].on) ? (f.slot[k].phase || "1") : ""),
      f.kind === "dragon" ? [f.mode, r(f.charge, 2), r(f.chargeMax, 2), f.rageStage || 0] : null,
      r(f.blind || 0, 2), f.overlord ? 1 : 0, f.team == null ? -1 : f.team, f.lock == null ? -1 : f.lock,
      r(f.stealthT || 0, 2),
      f.kind === "hero" ? [f.loadout.skill1 || "", f.loadout.skill2 || "", f.loadout.ult || ""].join("|") : "",
      Math.round(f.maxHp), f.isZombie ? 1 : 0,      // v2.7：血上限（猎人 800 / 霸主 ×1.5）+ 僵尸标记
      (f.hideProp || f.rideCar) ? 1 : 0             // v3.3：躲在柜子 / 坐在车上（客机据此不画人）
    ];
    function r(v, n) { return n ? Math.round(v * Math.pow(10, n)) / Math.pow(10, n) : Math.round(v); }
  }

  function packProj(p) {
    return [Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), Math.round(p.r),
      r2(p.life), p.side, p.reflect ? 1 : 0, p.type, p.color, r2(p.maxLife), p.data && p.data.R ? p.data.R : 0,
      p.trail ? 1 : 0, p.basic ? 1 : 0, p.kindTag === "basic" ? 0 : p.kindTag === "ult" ? 2 : 1, r2(p.stun || 0), r2(p.blind || 0),
      r2(p.data && p.data.timer || 0)];
    function r2(v) { return Math.round(v * 100) / 100; }
  }

  Net.snapshot = function () {
    return {
      t: "s", n: B.frame || 0, ph: B.state, ct: Math.round(B.countdown * 100) / 100,
      rt: Math.round((B.roundT || 0) * 10) / 10,
      f: B.fighters.map(packFighter),
      p: B.projs.map(packProj),
      z: B.zones.map(z => [z.type, Math.round(z.x || z.x0 || 0), Math.round(z.y || z.y0 || 0), Math.round(z.r || z.w || 0),
        Math.round(z.life * 100) / 100, Math.round((z.max || 0) * 100) / 100, z.warn || 0,
        Math.round(z.x0 || 0), Math.round(z.y0 || 0), Math.round(z.x1 || 0), Math.round(z.y1 || 0)]),
      sc: B.score.slice(), rw: B.roundWinner, mw: B.matchWinner,
      w: (B.wScore || []).slice(),                    // v2.7 乱斗热身：击杀分
      g: (B.gifts || []).map(g => [Math.round(g.x), Math.round(g.y), g.kind === "ult" ? 1 : 0, g.id,
        Math.round((g.t || 0) * 100) / 100, g.landed ? 1 : 0, Math.round((g.born || 0) * 100) / 100]),
      /* v3.0 地形：只同步会变化的部分（是否被打碎 / 方块位置 / 剩余血量），
         布局本身由房主下发的 mapCfg 种子在两端各生成一份，完全一致 */
      tm: B.terrain ? B.terrain.props.map(o => [o.dead ? 1 : 0, Math.round(o.x), Math.round(o.y),
        Math.round(o.hp || 0), Math.round(o.fuel || 0), o.driver ? o.driver.side : -1,
        o.carried ? 1 : 0, o.cargo ? 1 : 0, o.occupant ? o.occupant.side : -1]) : null
    };
  };

  function unpackFighter(f, a) {
    if (!a) return;
    f._tx = a[0]; f._ty = a[1];
    if (!f._init) { f.x = a[0]; f.y = a[1]; f._init = true; }
    f.facing = { x: a[2], y: a[3] };
    const wasDead = f.dead;
    f.hp = a[4]; f.dead = !!a[5];
    f.vx = a[6]; f.vy = a[7];
    if (f.kind === "hero") f.energy = a[8];
    f.stun = a[9]; f.root = a[10]; f.invuln = a[11]; f.shield = a[12]; f.shieldT = a[13];
    f.atkAnim = a[14]; f.atkDur = a[15]; f.moving = !!a[16]; f.walkPhase = a[17];
    f.hitFlash = a[18] ? 0.14 : 0; f.blinkAmt = a[19];
    f.buff = { rage: a[20], thousand: a[21], rush: a[22] };
    f.meditate = a[23]; f.parryT = a[24];
    SLOTS.forEach((k, i) => {
      f.cd[k] = a[25][i];
      const ph = a[26][i];
      if (f.slot[k].phase !== ph) { f.slot[k].on = !!ph; f.slot[k].phase = ph; if (!ph) { f.slot[k].t = 0; f.slot[k].d = {}; } }
    });
    if (a[27] && f.kind === "dragon") { f.mode = a[27][0]; f.charge = a[27][1]; f.chargeMax = a[27][2]; f.rageStage = a[27][3]; }
    f.blind = a[28] || 0;
    f.overlord = !!a[29];
    f.team = a[30] == null ? -1 : a[30];
    f.lock = a[31] == null ? -1 : a[31];
    f.stealthT = a[32] || 0;
    if (a[33] != null && a[33] !== "" && f.kind === "hero" && f.loadout) {
      const parts = a[33].split("|");                 // 天外来物：房主权威换装后同步到客机
      if (f.loadout.skill1 !== (parts[0] || null)) f.loadout.skill1 = parts[0] || null;
      if (f.loadout.skill2 !== (parts[1] || null)) f.loadout.skill2 = parts[1] || null;
      if (f.loadout.ult !== (parts[2] || null)) f.loadout.ult = parts[2] || null;
    }
    if (a[34] != null) f.maxHp = a[34];               // v2.7：血量上限随快照同步
    f.hiddenNet = !!a[36];                            // v3.3：躲藏 / 驾驶中，客机不画小人
    /* v2.7 追猎：猎人的身份靠 team（9）判断，客机不需要自己抽签 */
    if (B.rule === "hunt" && f.kind === "hero") {
      f.huntRole = f.team === 9 ? "hunter" : "runner";
      f.huntCrown = f.huntRole === "hunter";
    }
    if (!wasDead && f.dead) { LD.FX.shake(14); LD.FX.burst(f.x, f.y - 26, 34, ["#fff", "#fb7185"], { speed: 340, life: 0.9 }); }
  }

  Net.applySnapshot = function (s) {
    this.snapCur = s; this.snapT = 0;
    const wasOver = B.state === "over";
    B.state = s.ph;
    if (s.ph === "over" && !wasOver && s.mw != null && s.mw >= 0) {
      /* 客机不会跑权威结算，靠快照发现比赛结束 */
      this.emit("matchEnd", s.mw);
    }
    if (s.ct != null) B.countdown = s.ct;
    if (s.rt) B.roundT = s.rt;
    B.score = s.sc; B.roundWinner = s.rw; B.matchWinner = s.mw;
    if (s.w) B.wScore = s.w.slice();                  // v2.7 乱斗热身计分板
    if (s.tm && B.terrain && B.terrain.props) {
      s.tm.forEach((a, i) => {
        const o = B.terrain.props[i];
        if (!o) return;
        o.dead = !!a[0];
        if (o.maxHp > 0) o.hp = a[3];
        if (o.kind === "pushable" || o.kind === "car" || o.kind === "mud") { o.x = a[1]; o.y = a[2]; }
        if (o.kind === "car") {
          o.fuel = a[4] || 0;
          o.driver = a[5] >= 0 ? (B.fighters.find(f => f.side === a[5]) || null) : null;
        }
        if (o.kind === "mud") {
          /* v3.3：泥土被搬起 / 正在飞行 / 已落地，客机要跟着同步，否则会看到它原地不动 */
          o.carried = !!a[6];
          o.cargo = !!a[7];
          if (!o.cargo) o.landed = true;
          o.vx = 0; o.vy = 0;
        }
        if (o.kind === "locker") {
          o.occupant = a[8] >= 0 ? (B.fighters.find(f => f.side === a[8]) || null) : null;
        }
      });
    }
    /* 客机补胜者特写：权威端 endRound 播放大招式演出，客机靠快照里 roundWinner 的变化本地触发 */
    if (s.rw !== this._lastRW) {
      if (s.rw != null && s.rw >= 0 && B.state === "roundEnd") {
        const wf = B.fighters[s.rw];
        if (wf && wf.kind === "hero")
          LD.Cine.start(wf, "胜者：" + (wf.name || ("玩家" + (s.rw + 1))), "",
            wf.team != null && wf.team >= 0 ? ((LD.teamColor && LD.teamColor(wf.team)) || "#fcd34d") : "#fcd34d", "赢得了本局胜利");
      }
      this._lastRW = s.rw;
    }
    s.f.forEach((a, i) => {
      /* v2.7：房主多出来的实体（僵尸永远追加在数组末尾）按需在客机侧补出外壳 */
      if (!B.fighters[i]) {
        if (!(a && a[35])) return;
        B.fighters[i] = B.mkZombieShell();
      }
      unpackFighter(B.fighters[i], a);
    });
    if (B.fighters.length > s.f.length) B.fighters.length = s.f.length;   // 房主清场后同步裁掉多余僵尸
    // 天外来物掉落物：直接重建（拾取与置换由房主权威结算，客机只管渲染）
    B.gifts = (s.g || []).map(a => ({
      x: a[0], y: a[1], kind: a[2] ? "ult" : "skill", id: a[3], t: a[4], landed: !!a[5], born: a[6]
    }));
    // 弹道：直接重建
    B.projs = s.p.map(a => ({
      x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4], life: a[5], maxLife: a[10], side: a[6], reflect: !!a[7],
      type: a[8], color: a[9], core: "#fff", owner: B.fighters.find(x => x.side === a[6]) || B.fighters[0], pierce: false,
      data: { R: a[11], timer: a[17] || 0, boomR: 150, dmg: 28 }, tick: 0, hits: {}, absorb: 0, absorbed: 0, spin: 0,
      trail: !!a[12], basic: !!a[13], kindTag: a[14] === 0 ? "basic" : a[14] === 2 ? "ult" : "skill",
      stun: a[15] || 0, blind: a[16] || 0,
      dmg: 0, homing: 0, scale: 1
    }));
    B.zones = s.z.map(a => {
      if (a[0] === "beam") return { type: "beam", x0: a[7], y0: a[8], x1: a[9], y1: a[10], w: a[3], life: a[4], max: a[5], color: "#67e8f9", owner: B.fighters[0] };
      const z = { type: a[0], x: a[1], y: a[2], r: a[3], life: a[4], max: a[5], warn: a[6], color: "#fb923c", owner: B.fighters[1] || B.fighters[0] };
      if (z.type === "pillar") z.hit = a[4] > (a[6] || 0);
      if (z.type === "water") {                      // 判定补偿走本地配置，保证与房主端一致
        const sk = LD.skill && LD.skill("waterOrbs");
        z.hitPad = sk && sk.hitPad != null ? sk.hitPad : 32;
      }
      return z;
    });
  };

  /* 客机位置平滑 */
  Net.smooth = function (dt) {
    const k = 1 - Math.exp(-22 * dt);
    B.fighters.forEach(f => {
      if (f._tx == null) return;
      /* v2.6：误差超过 90px（闪避 / 传送 / 出生点差异）直接吸附，避免长时间回弹 */
      if (Math.abs(f._tx - f.x) > 90 || Math.abs(f._ty - f.y) > 90) { f.x = f._tx; f.y = f._ty; return; }
      f.x += (f._tx - f.x) * k;
      f.y += (f._ty - f.y) * k;
      f.hitFlash = Math.max(0, f.hitFlash - dt);
      if (f.blinkAmt != null && f.blinkAmt < 1) f.blinkAmt = Math.min(1, f.blinkAmt + dt * 12);
      f.atkAnim = Math.max(0, f.atkAnim - dt);
    });
    // 客机补拖尾：快照只带静态位置，弹道要在本地按速度推进 + 逐帧生成尾迹
    // （否则非房主看到的远程普攻是 30Hz 传送、拖尾稀疏甚至看不见）
    B.projs.forEach(p => {
      if (p.type !== "bomb" && p.type !== "hbomb") { p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; }
      if (p.trail || p.type === "fireball" || p.type === "sword") LD.FX.trail(p.x, p.y, p.color, p.r * 0.55, 0.26);
    });
    LD.FX.update(dt);
    if (LD.Cine.active) LD.Cine.update(dt);
  };

  /* 广播本地特效事件（伤害数字、弹反、爆炸、大招演出） */
  Net.flushEvents = function () {
    if (!B.authoritative || !(this.peerIn && this.peersIn.length)) { B.ev.length = 0; return; }
    if (!B.ev.length) return;
    const ev = B.ev.splice(0, B.ev.length);
    this.toPeer({ t: "ce", ev: ev.map(e => {
      if (e[0] === "h" || e[0] === "t" || e[0] === "p" || e[0] === "b") return [e[0], Math.round(e[1]), Math.round(e[2]), e[3], e[4]];
      if (e[0] === "k") return ["k", Math.round(e[1]), Math.round(e[2])];
      if (e[0] === "x") return ["x", Math.round(e[1]), Math.round(e[2]), Math.round(e[3])];
      return e;
    }) });
  };

  Net.playEvents = function (ev) {
    const FX = LD.FX;
    (ev || []).forEach(e => {
      switch (e[0]) {
        case "h": case "t": case "b": FX.float(e[1], e[2], e[3], e[4], 15); break;
        case "p": FX.ring(e[1], e[2], 76, "rgba(150,230,255,.95)", 5, 0.42); FX.float(e[1], e[2], e[3], e[4], 20); FX.shake(11); break;
        case "k": FX.shake(15); FX.burst(e[1], e[2], 36, ["#fff", "#fb7185"], { speed: 340, life: 0.9 }); break;
        case "x": FX.ring(e[1], e[2], e[3], "rgba(167,139,250,.95)", 7, 0.5); FX.burst(e[1], e[2], 26, ["#a78bfa", "#fff"], { speed: 300 }); FX.shake(12); break;
      }
    });
  };

  /* ---------------- 战斗流程 ---------------- */
  /* 无花名册时的兜底：按座位号临时拼一份（用本地外观与默认配装） */
  Net.buildRoster = function (count) {
    const P = LD.Profile;
    const list = [];
    for (let i = 0; i < count; i++) {
      const r = this.roster[i];
      list.push({
        look: i === this.mySide ? P.look() : (r && r.look) || P.look(),
        loadout: i === this.mySide ? Object.assign({}, P.d.loadout)
          : Object.assign({}, (r && r.loadout) || LD.DEFAULT_LOADOUT),
        name: (r && r.name) || (i === 0 ? "房主" : "玩家" + (i + 1)),
        team: -1
      });
    }
    return list;
  };

  /* roster: 座位数组 [{look, loadout, name, team, bot, level}]，长度 2~4。缺省项用默认外观兜底。
   * cfg: { isHost, mySide, roster, rule, dragonDiff } */
  Net.buildNetBattle = function (cfg) {
    const me = cfg.mySide == null ? this.mySide : cfg.mySide;
    const roster = cfg.roster && cfg.roster.length >= 2 ? cfg.roster : this.buildRoster(cfg.rosterCount || 2);
    const fighters = roster.map((r, i) =>
      B.mkHero(i, { x: 0, y: 0, look: r.look, loadout: r.loadout, name: r.name }));
    fighters.forEach((f, i) => {
      f.team = roster[i] && roster[i].team != null ? roster[i].team : -1;
      if (roster[i] && roster[i].bot) LD.AI.mkBot(f, roster[i].level || "normal");
    });
    if (cfg.rule === "overlord") {
      const dr = B.mkDragon({ diff: (LD.DIFF && LD.DIFF[cfg.dragonDiff || "normal"]) || LD.DIFF.normal });
      dr.side = fighters.length; dr.id = dr.side; dr.team = -1;
      fighters.push(dr);
    }
    B.setup({ mode: "net", rule: cfg.rule || "brawl", isHost: cfg.isHost, mySide: me, fighters, theme: {},
      mods: cfg.mods || [], matchT: cfg.matchT || 120, mapCfg: cfg.mapCfg || null });
    B.authoritative = !!cfg.isHost;
    fighters.forEach((f, i) => {
      if (f.kind !== "hero") return;
      if (roster[i] && roster[i].bot) return;                 // 人机由 AI 驾驶
      f.ctrl = i === me ? LD.UI.ctrl : this.remoteCtrlFor(i);
    });
    B.roundT = cfg.rule === "overlord" ? 0 : 75;
    B.resetRound(false);
    if (cfg.rule === "overlord") B.roundT = 0;
    B.state = "countdown"; B.countdown = 2.0;
    this.started = true;
  };

  /* ---------------- 客机：接管主循环 ---------------- */
  const _updB = B.update;
  B.update = function (rdt) {
    if (!this.authoritative && this.state !== "idle") { LD.Net.smooth(rdt); return; }
    return _updB.call(this, rdt);
  };

  const _setupB = B.setup;
  B.setup = function (cfg) {
    const r = _setupB.call(this, cfg);
    this.authoritative = !(cfg.mode === "net" && cfg.isHost === false);
    return r;
  };
})(window.LD = window.LD || {});
