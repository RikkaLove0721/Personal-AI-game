/* ============================================================
 *  49c_chair.js — v4.13 抢椅子（重做）
 * ============================================================
 *  一轮的流程：
 *    hint  只给「椅子即将出现」的时间提示——**不给任何位置信息**
 *    rush  几秒后椅子在地图上**瞬间随机出现**，玩家与 AI 在这一刻才得知位置，立刻开抢
 *    抢座  grabT 秒内跑到椅子边**按 P 坐下**（不是靠范围圈自动判定）
 *    结算  没坐到的人扣 missDmg 血（不出局，容错很高）
 *    rest  间歇，椅子清空，数量 -1，回到 hint
 *
 *  椅子数量：开局 = 存活人数 + extra，每轮 -1，最少 minSeats。
 *  **假椅子**：每把椅子有 fakeP 的概率是坏的——外观和其他椅子完全一致，
 *  坐上去当场散架，白跑一趟还得愣神 fakeStun 秒。
 *
 *  禁用普攻 / 技能 / 大招——抢不到就是抢不到，打人没有用。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.CHAIR || {};

  const C_SEAT = "#38bdf8", C_HOT = "#f87171", C_OK = "#7ff0c4", C_GOLD = "#fbbf24";

  /** 瞬间随机摆一批椅子（避开障碍、彼此不重叠）；每把独立掷一次「是不是假椅子」 */
  B.chairLaySeats = function (n) {
    const c = C(), w = this.world;
    const props = (this.terrain && this.terrain.props) || [];
    const seats = [];
    const R = c.seatR || 62;
    for (let i = 0; i < n; i++) {
      let best = null, bestScore = -1;
      for (let tries = 0; tries < 60; tries++) {
        const x = rnd(90, w.w - 90), y = rnd(w.pt + 80, w.h - 80);
        let ok = true, near = Infinity;
        for (let k = 0; k < props.length; k++) {
          const o = props[k];
          if (o.dead || !o.blockMove) continue;
          if (Math.abs(x - o.x) < (o.w || 40) / 2 + R * 0.5 && Math.abs(y - o.y) < (o.h || 40) / 2 + R * 0.5) { ok = false; break; }
        }
        if (!ok) continue;
        for (let k = 0; k < seats.length; k++) near = Math.min(near, Math.hypot(seats[k].x - x, seats[k].y - y));
        if (near < R * 1.9) continue;
        const score = near === Infinity ? 9999 : near;
        if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
      }
      if (!best) best = { x: rnd(120, w.w - 120), y: rnd(w.pt + 90, w.h - 90) };
      seats.push({
        x: best.x, y: best.y, r: R,
        fake: Math.random() < (c.fakeP || 0.22),   // 外观完全一样，坐上去才知道
        taken: null, t: 0, broken: false
      });
    }
    /* 至少留一把真椅子，免得整轮谁都坐不上（人数很少时才有必要兜底） */
    if (seats.length && seats.every(s => s.fake)) seats[(Math.random() * seats.length) | 0].fake = false;
    return seats;
  };

  /** 够得着、还能坐的椅子（按 P 的目标）；返回下标，-1 = 身边没有 */
  B.chairNearSeat = function (f) {
    const st = this.chair, c = C();
    if (!st || !st.seats || !f) return -1;
    const R = (c.sitR || 28) + (f.r || 16);
    let bi = -1, bd = 1e9;
    for (let i = 0; i < st.seats.length; i++) {
      const s = st.seats[i];
      if (s.broken || s.taken) continue;
      const d = Math.hypot(s.x - f.x, s.y - f.y);
      if (d > R || d >= bd) continue;
      bd = d; bi = i;
    }
    return bi;
  };

  /**
   * v4.13d 吹风机：抢椅子的场地里多摆几台风扇。
   * 冲过去的路上会被侧风推偏，抢到最后一步还可能被吹离座位——比纯赛跑好玩。
   * 机身是 blockMove，`chairLaySeats` 本来就会避开它，不用额外处理。
   */
  B.chairBlowers = function (n) {
    const T = this.terrain, w = this.world;
    if (!T || !T.props) return 0;
    const force = (LD.BLOWER && LD.BLOWER.force) || 420;
    let made = 0;
    for (let i = 0; i < n * 10 && made < n; i++) {
      const x = rnd(150, w.w - 150), y = rnd(w.pt + 130, w.h - 130);
      if (LD.Terrain.clearAt && !LD.Terrain.clearAt(T, x, y, 80)) continue;
      /* WIND_DIR 顺序：0 右 1 下 2 左 3 上 —— 随机朝四个方向之一 */
      T.props.push({
        uid: 895000 + i * 7 + Math.floor(Math.random() * 900),
        kind: "blower", mat: "blower_steel", shape: "blower",
        cw: 1, ch: 1, w: 40, h: 40, x: x, y: y, ox: x, oy: y,
        elev: 44, mass: 5, hp: 110, maxHp: 110,
        dead: false, flash: 0, vx: 0, vy: 0, free: false, glow: null,
        boomR: 0, boomDmg: 0, variant: (i * 131) % 997, runtime: true,
        blockMove: true, blockProj: true,
        dir: (Math.random() * 4) | 0, len: 4,
        power: Math.round(force * 0.8), _fuelSaid: false
      });
      made++;
    }
    return made;
  };

  /** 坐下：真椅子 = 占位（先按先得）；假椅子 = 当场散架 + 愣神 */
  B.chairSit = function (f, i) {
    const st = this.chair, c = C();
    const s = st && st.seats && st.seats[i];
    if (!s || s.broken || s.taken) return false;
    if (s.fake) {
      s.broken = true;
      FX.burst(s.x, s.y, 18, ["#b45309", "#fbbf24", "#7c5a33"], { speed: 260 });
      FX.ring(s.x, s.y, s.r, "rgba(251,191,36,.9)", 5, 0.35);
      FX.float(s.x, s.y - 62, "散架了！", C_GOLD, 18);
      this.ev.push(["t", s.x, s.y - 62, "散架了！", C_GOLD]);
      f.root = Math.max(f.root || 0, c.fakeStun || 0.55);
      f.chairSeat = -1;
      if (LD.Audio && LD.Audio.beep) LD.Audio.beep(180, 0.16, "square", 0.05);
      return true;
    }
    s.taken = f; s.t = this.t;
    f.chairSeat = i; f.chairT = this.t;
    FX.ring(s.x, s.y, s.r, "rgba(127,240,196,.95)", 5, 0.35);
    FX.float(s.x, s.y - 62, "抢到了", C_OK, 17);
    if (LD.Audio && LD.Audio.beep) LD.Audio.beep(720, 0.1, "triangle", 0.05);
    return true;
  };

  B.initChair = function () {
    const c = C(), w = this.world;
    const alive = this.casualAlive();
    /* 开局把人铺开，别挤在一堆 */
    const pts = alive.map(() => ({ x: rnd(120, w.w - 120), y: rnd(w.pt + 90, w.h - 90) }));
    this.casualPlace(pts, alive);
    alive.forEach(f => {
      f.maxHp = Math.max(f.maxHp, 200); f.hp = f.maxHp;
      f.chairSeat = -1; f.chairT = 0;
      f.chairSkill = rnd(0.45, 0.95);      // 眼疾手快的程度
      f.chairReact = rnd(0.05, 0.35);      // 椅子出现后的反应延迟
      f.chairPick = -1; f.chairPickT = 0;
    });
    this.chair = {
      phase: "hint",                        // hint → rush → rest
      t: rnd(c.hintMin || 2.6, c.hintMax || 4.5),
      round: 0,
      n: Math.max(c.minSeats || 1, alive.length + (c.extra || 2)),
      seats: []                             // 预告阶段还没有椅子，谁也不知道位置
    };
    /* v4.13d 场上的吹风机：抢座路上会被侧风推偏 */
    this.chairBlowers(c.blowers || 5);
    FX.float(w.w / 2, w.pt + 40, "椅子即将出现…", C_GOLD, 19);
  };

  B.updateChair = function (dt) {
    const st = this.chair, c = C();
    if (!st) return;
    const alive = this.casualAlive();

    /* 坐定的人钉在椅子上（root 由 stepFighter 每帧递减，这里持续补上） */
    for (let i = 0; i < alive.length; i++) {
      const f = alive[i];
      if (f.chairSeat >= 0) f.root = Math.max(f.root || 0, 0.2);
    }

    st.t -= dt;

    /* ---- hint：只倒计时，不暴露任何位置 ---- */
    if (st.phase === "hint") {
      if (st.t > 1e-6) return;
      this.chairRush();
      return;
    }

    /* ---- rush：椅子已在场上，抢 grabT 秒 ---- */
    if (st.phase === "rush") {
      if (st.t > 1e-6) return;
      this.chairResolve();
      return;
    }

    /* ---- rest：间歇后进入下一轮 ---- */
    if (st.phase === "rest") {
      if (st.t > 1e-6) return;
      st.round++;
      st.n = Math.max(c.minSeats || 1, st.n - 1);
      st.seats = [];
      st.phase = "hint";
      st.t = rnd(c.hintMin || 2.6, c.hintMax || 4.5);
      FX.float(this.world.w / 2, this.world.pt + 40, "第 " + (st.round + 1) + " 轮 · 剩 " + st.n + " 把椅子", C_GOLD, 18);
      return;
    }
  };

  /** 椅子瞬间出现——这一刻所有人才拿到位置信息 */
  B.chairRush = function () {
    const st = this.chair, c = C();
    const alive = this.casualAlive();
    st.seats = this.chairLaySeats(Math.max(c.minSeats || 1, st.n));
    st.phase = "rush";
    st.t = c.grabT || 2.6;
    alive.forEach(f => { f.chairSeat = -1; f.chairPick = -1; f.chairPickT = 0; });
    FX.shake(6);
    FX.float(this.world.w / 2, this.world.pt + 40, "椅子出现了！抢！", C_HOT, 22);
    this.ev.push(["h", this.world.w / 2, this.world.pt + 40, "椅子出现了！抢！", C_HOT]);
    if (LD.Audio && LD.Audio.beep) LD.Audio.beep(880, 0.12, "square", 0.06);
  };

  B.chairResolve = function () {
    const st = this.chair, c = C();
    const won = {};
    st.seats.forEach(s => {
      if (s.broken || !s.taken) return;
      won[s.taken.side] = 1;
      FX.ring(s.x, s.y, s.r, "rgba(127,240,196,.9)", 5, 0.4);
    });
    let missed = 0;
    const alive = this.casualAlive();
    for (let i = 0; i < alive.length; i++) {
      const f = alive[i];
      f.chairSeat = -1; f.root = 0;
      if (won[f.side]) continue;
      missed++;
      FX.ring(f.x, f.y - 26, 56, "rgba(248,113,113,.9)", 5, 0.4);
      this.casualHurt(f, c.missDmg || 55, { color: C_HOT, text: "没抢到 -", size: 18 });
    }
    if (missed) FX.shake(7);
    st.phase = "rest"; st.t = c.restT || 2.4;
  };

  B.chairTimeUp = function () {
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if (f.hp > w.hp) w = f; });
    this.casualWin(w, "时间到·血量最高");
  };

  /* ---------------- P 键 ---------------- */
  LD.RULE_INTERACT.chair = function (f) {
    if (!this.chair || this.chair.phase !== "rush") return false;
    if (f.chairSeat >= 0) return false;
    const i = B.chairNearSeat.call(this, f);
    if (i < 0) return false;
    return B.chairSit.call(this, f, i);
  };
  LD.RULE_LABEL.chair = function (f) {
    if (!this.chair || this.chair.phase !== "rush" || f.chairSeat >= 0) return "";
    return B.chairNearSeat.call(this, f) >= 0 ? "坐下" : "";
  };

  /* ---------------- 渲染 ---------------- */
  B.drawChair = function (ctx) {
    const st = this.chair, c = C(), w = this.world;
    if (!st) return;

    /* 预告阶段：只画一圈「未知」的虚影，绝不给位置 */
    if (st.phase === "hint") {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.t * 6);
      ctx.strokeStyle = C_GOLD; ctx.lineWidth = 3; ctx.setLineDash([10, 12]);
      ctx.beginPath();
      ctx.arc(w.w / 2, (w.pt + w.h) / 2, Math.min(w.w, w.h - w.pt) * 0.30, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = C_GOLD;
      ctx.font = "bold 16px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("？", w.w / 2, (w.pt + w.h) / 2);
      ctx.restore();
    }

    /* 椅子 */
    ctx.save();
    st.seats.forEach(s => {
      if (s.broken) {
        /* 散架的假椅子：一地木屑 */
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#7c5a33";
        for (let k = 0; k < 5; k++) {
          const a = k * 1.3 + s.x;
          ctx.fillRect(s.x + Math.cos(a) * 16 - 4, s.y + Math.sin(a) * 12 - 3, 9, 5);
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = C_GOLD;
        ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("坏的", s.x, s.y - 34);
        return;
      }
      const live = st.phase === "rush";
      const mine = s.taken;
      ctx.globalAlpha = live ? 0.34 : 0.20;
      ctx.fillStyle = mine ? C_OK : (live ? C_SEAT : "#7dd3fc");
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = live ? 0.95 : 0.6;
      ctx.strokeStyle = mine ? C_OK : (live ? C_SEAT : "#7dd3fc");
      ctx.lineWidth = live ? 4 : 2;
      ctx.setLineDash(live ? [] : [9, 8]);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      /* 一把简笔椅子（真假长得一模一样——这就是假椅子的意义） */
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(s.x - 14, s.y - 16, 28, 8);
      ctx.fillRect(s.x - 14, s.y - 10, 5, 20);
      ctx.fillRect(s.x + 9, s.y - 10, 5, 20);
      ctx.fillRect(s.x - 14, s.y - 22, 28, 6);
      if (mine) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = C_OK;
        ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("已占", s.x, s.y - 38);
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    /* 顶部状态条 */
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    let txt = "", col = C_GOLD;
    if (st.phase === "hint") { txt = "椅子即将出现… " + Math.max(0, st.t).toFixed(1) + "s"; col = C_GOLD; }
    else if (st.phase === "rush") { txt = "抢！ " + Math.max(0, st.t).toFixed(1) + "s（靠近按 P 坐下）"; col = C_HOT; }
    else { txt = "下一轮剩 " + Math.max(c.minSeats || 1, st.n - 1) + " 把椅子"; col = C_OK; }
    ctx.fillStyle = col;
    ctx.fillText(txt, w.w / 2, w.pt + 14);
    ctx.font = "13px system-ui,'Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("第 " + (st.round + 1) + " 轮 · 当前 " + st.n + " 把椅子", w.w / 2, w.pt + 34);
    ctx.restore();
  };

  /* ---------------- 人机 ----------------
   * hint 阶段：椅子还没出现，AI 也不知道位置 —— 只能绕着场心游走，尽量站到中枢。
   * rush 阶段：瞬间锁定最近的空椅子，冲过去按 P（假椅子照样会踩，和人一样会中招）。 */
  LD.casualAI.chair = function (f, dt, ctrl) {
    const st = B.chair, c = LD.CHAIR || {};
    ctrl.press = ctrl.press || {};
    if (!st) { ctrl.mx = 0; ctrl.my = 0; return; }

    /* 已经坐下了：钉住不动 */
    if (f.chairSeat >= 0) { ctrl.mx = 0; ctrl.my = 0; return; }

    if (st.phase !== "rush" || !st.seats || !st.seats.length) {
      /* 预告阶段：绕着场心慢慢兜圈，等椅子刷出来时能少跑两步 */
      const w = B.world, pt = w.pt || 0;
      const a = B.t * 0.9 + (f.side || 0) * 1.7;
      const rr = Math.min(w.w, w.h - pt) * 0.28;
      const tx = w.w / 2 + Math.cos(a) * rr, ty = (pt + w.h) / 2 + Math.sin(a) * rr * 0.8;
      const s = LD.AI.steer(f, tx - f.x, ty - f.y, null);
      ctrl.mx = s.x * 0.55; ctrl.my = s.y * 0.55;
      return;
    }

    /* 反应延迟：椅子刚出现的一瞬间不是所有人都能立刻反应过来 */
    const elapsed = (c.grabT || 2.6) - st.t;
    if (elapsed < (f.chairReact || 0.1)) { ctrl.mx = 0; ctrl.my = 0; return; }

    /* 挑目标：越近越好，同时避开别人明显更近的椅子（去了也抢不到） */
    f.chairPickT = (f.chairPickT || 0) - dt;
    const cur = st.seats[f.chairPick];
    if (f.chairPickT <= 0 || !cur || cur.taken || cur.broken) {
      let bi = -1, bs = Infinity;
      for (let i = 0; i < st.seats.length; i++) {
        const s = st.seats[i];
        if (s.taken || s.broken) continue;
        const d = Math.hypot(s.x - f.x, s.y - f.y);
        let rivals = 0;
        for (let k = 0; k < B.fighters.length; k++) {
          const o = B.fighters[k];
          if (o === f || o.kind !== "hero" || o.dead || o.bench) continue;
          if (Math.hypot(s.x - o.x, s.y - o.y) < d - 12) rivals++;
        }
        const score = d + rivals * 140;
        if (score < bs) { bs = score; bi = i; }
      }
      f.chairPick = bi;
      f.chairPickT = 0.2;
    }
    const tgt = st.seats[f.chairPick];
    if (!tgt) { ctrl.mx = 0; ctrl.my = 0; return; }

    const dx = tgt.x - f.x, dy = tgt.y - f.y, d = Math.hypot(dx, dy) || 1;
    if (d > 8) {
      const s = LD.AI.steer(f, dx, dy, null);
      const skill = f.chairSkill != null ? f.chairSkill : 0.7;
      ctrl.mx = s.x * (0.85 + 0.15 * skill); ctrl.my = s.y * (0.85 + 0.15 * skill);
    } else { ctrl.mx = 0; ctrl.my = 0; }
    if (d - (f.r || 16) <= (c.sitR || 44)) ctrl.press.interact = true;
  };
})(window.LD = window.LD || {});
