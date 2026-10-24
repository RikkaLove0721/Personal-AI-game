/* ============================================================
 *  49c_chair.js — v4.12 抢椅子
 * ============================================================
 *  地上的安全位（椅子）从多到少：开局比存活人数多 extra 个，每轮少一个，
 *  最少剩 minSeats 个。一轮的流程：
 *    music（音乐响着，自由跑动，时长随机）
 *      → 可能来一次「假停」：音乐停一下又继续，骗人提前冲（fake 阶段）
 *    → stop（音乐真停，grabT 秒内抢位）
 *    → 结算：每个安全位只认**最先踏入**的人，其余人扣 missDmg 血（不出局）
 *    → rest（间歇，重新随机摆位，椅子数 -1）
 *
 *  容错：没抢到只掉血，不掉血到 0 就还能继续抢；血空才真正出局。
 *  禁用普攻 / 技能 / 大招——抢不到就是抢不到，打人没有用。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.CHAIR || {};

  const C_SEAT = "#38bdf8", C_HOT = "#f87171", C_OK = "#7ff0c4", C_GOLD = "#fbbf24";

  /** 重新随机摆一批安全位（避开障碍、彼此不重叠） */
  B.chairLaySeats = function (n) {
    const c = C(), w = this.world;
    const props = (this.terrain && this.terrain.props) || [];
    const seats = [];
    const R = c.seatR || 72;
    for (let i = 0; i < n; i++) {
      let best = null, bestScore = -1;
      for (let tries = 0; tries < 60; tries++) {
        const x = rnd(90, w.w - 90), y = rnd(w.pt + 80, w.h - 80);
        let ok = true, near = Infinity;
        for (const o of props) {
          if (o.dead || !o.blockMove) continue;
          if (Math.abs(x - o.x) < (o.w || 40) / 2 + R * 0.5 && Math.abs(y - o.y) < (o.h || 40) / 2 + R * 0.5) { ok = false; break; }
        }
        if (!ok) continue;
        for (const s of seats) near = Math.min(near, Math.hypot(s.x - x, s.y - y));
        if (near < R * 1.9) continue;
        const score = near === Infinity ? 9999 : near;
        if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
      }
      if (!best) best = { x: rnd(120, w.w - 120), y: rnd(w.pt + 90, w.h - 90) };
      seats.push({ x: best.x, y: best.y, r: R, here: [] });
    }
    return seats;
  };

  /** 角色此刻站在哪个安全位里（-1 = 不在任何安全位上） */
  B.chairSeatAt = function (x, y) {
    const st = this.chair;
    if (!st || !st.seats) return -1;
    for (let i = 0; i < st.seats.length; i++) {
      const s = st.seats[i];
      if (Math.hypot(x - s.x, y - s.y) <= s.r) return i;
    }
    return -1;
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
      f.chairSkill = rnd(0.45, 0.95);
      f.chairReact = rnd(0.9, 2.3);
      f.chairPick = -1; f.chairPickT = 0;
    });
    this.chair = {
      phase: "music",
      t: rnd(c.musicMin || 7, c.musicMax || 12),
      round: 0,
      n: Math.max(c.minSeats || 1, alive.length + (c.extra || 2)),
      seats: []
    };
    this.chair.seats = this.chairLaySeats(this.chair.n);
    FX.float(w.w / 2, w.pt + 40, "音乐响起来了", C_GOLD, 19);
  };

  B.updateChair = function (dt) {
    const st = this.chair, c = C();
    if (!st) return;
    const alive = this.casualAlive();

    /* 每帧刷新「谁站在哪个位子上 / 站了多久」——抢先规则全靠这份记录 */
    st.seats.forEach(s => { s.here.length = 0; });
    for (const f of alive) {
      const i = this.chairSeatAt(f.x, f.y);
      if (f.chairSeat !== i) { f.chairSeat = i; f.chairT = this.t; }
      if (i >= 0) st.seats[i].here.push(f);
    }

    st.t -= dt;

    if (st.phase === "music") {
      /* 快停的时候给点提示：最后 1.5 秒音乐开始「打顿」 */
      if (st.t <= 1.5 && st.t > 0 && Math.random() < dt * 6) {
        FX.float(this.world.w / 2, this.world.pt + 40, "快停了…", C_GOLD, 14);
      }
      if (st.t > 1e-6) return;
      if (Math.random() < (c.fakeP || 0.16)) {
        st.phase = "fake"; st.t = c.fakeT || 0.9;
        FX.float(this.world.w / 2, this.world.pt + 40, "停——！", C_HOT, 20);
        if (LD.Audio && LD.Audio.beep) LD.Audio.beep(660, 0.1, "square", 0.05);
      } else {
        this.chairStop();
      }
      return;
    }

    if (st.phase === "fake") {
      if (st.t > 1e-6) return;
      st.phase = "music"; st.t = rnd(1.6, 3.6);
      FX.float(this.world.w / 2, this.world.pt + 40, "又响了！继续跑", C_OK, 19);
      if (LD.Audio && LD.Audio.beep) LD.Audio.beep(440, 0.14, "triangle", 0.05);
      return;
    }

    if (st.phase === "stop") {
      if (st.t > 1e-6) return;
      this.chairResolve();
      return;
    }

    if (st.phase === "rest") {
      if (st.t > 1e-6) return;
      st.round++;
      st.n = Math.max(c.minSeats || 1, st.n - 1);
      st.seats = this.chairLaySeats(st.n);
      st.phase = "music";
      st.t = rnd(c.musicMin || 7, c.musicMax || 12);
      FX.float(this.world.w / 2, this.world.pt + 40, "第 " + (st.round + 1) + " 轮 · 剩 " + st.n + " 个位子", C_GOLD, 18);
      return;
    }
  };

  B.chairStop = function () {
    const st = this.chair, c = C();
    st.phase = "stop"; st.t = c.grabT || 2.2;
    FX.shake(6); FX.flash(0.12, "248,113,113");
    FX.float(this.world.w / 2, this.world.pt + 40, "音乐停！抢位子", C_HOT, 22);
    this.ev.push(["h", this.world.w / 2, this.world.pt + 40, "音乐停！抢位子", C_HOT]);
    if (LD.Audio && LD.Audio.beep) LD.Audio.beep(300, 0.22, "sawtooth", 0.06);
  };

  B.chairResolve = function () {
    const st = this.chair, c = C();
    const won = {};
    st.seats.forEach(s => {
      if (!s.here.length) return;
      let best = s.here[0];
      s.here.forEach(f => { if (f.chairT < best.chairT) best = f; });
      won[best.side] = 1;
      FX.ring(s.x, s.y, s.r, "rgba(127,240,196,.9)", 5, 0.4);
      FX.float(best.x, best.y - 92, "抢到了", C_OK, 17);
    });
    let missed = 0;
    for (const f of this.casualAlive()) {
      if (won[f.side]) continue;
      missed++;
      FX.ring(f.x, f.y - 26, 56, "rgba(248,113,113,.9)", 5, 0.4);
      this.casualHurt(f, c.missDmg || 55, { color: C_HOT, text: "没抢到 -", size: 18 });
    }
    if (missed) FX.shake(7);
    st.phase = "rest"; st.t = c.restT || 2.6;
  };

  B.chairTimeUp = function () {
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if (f.hp > w.hp) w = f; });
    this.casualWin(w, "时间到·血量最高");
  };

  /* ---------------- 渲染 ---------------- */
  B.drawChair = function (ctx) {
    const st = this.chair, c = C(), w = this.world;
    if (!st) return;

    ctx.save();
    st.seats.forEach(s => {
      const live = st.phase === "stop" || st.phase === "fake";
      ctx.globalAlpha = live ? 0.34 : 0.20;
      ctx.fillStyle = live ? C_SEAT : "#7dd3fc";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = live ? 0.95 : 0.6;
      ctx.strokeStyle = live ? C_SEAT : "#7dd3fc";
      ctx.lineWidth = live ? 4 : 2;
      ctx.setLineDash(live ? [] : [9, 8]);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      /* 一把简笔椅子 */
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(s.x - 14, s.y - 16, 28, 8);
      ctx.fillRect(s.x - 14, s.y - 10, 5, 20);
      ctx.fillRect(s.x + 9, s.y - 10, 5, 20);
      ctx.fillRect(s.x - 14, s.y - 22, 28, 6);
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    let txt = "", col = C_GOLD;
    if (st.phase === "music") { txt = "音乐播放中…"; col = "#7dd3fc"; }
    else if (st.phase === "fake") { txt = "停——！（假停）"; col = C_HOT; }
    else if (st.phase === "stop") { txt = "抢位子！ " + Math.max(0, st.t).toFixed(1) + "s"; col = C_HOT; }
    else { txt = "下一轮剩 " + Math.max(c.minSeats || 1, st.n - 1) + " 个位子"; col = C_OK; }
    ctx.fillStyle = col;
    ctx.fillText(txt, w.w / 2, w.pt + 14);
    ctx.font = "13px system-ui,'Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("第 " + (st.round + 1) + " 轮 · 当前 " + st.n + " 个位子", w.w / 2, w.pt + 34);
    ctx.restore();
  };

  /* ---------------- 人机 ---------------- */
  LD.casualAI.chair = function (f, dt, ctrl) {
    const st = B.chair, c = LD.CHAIR || {};
    ctrl.press = {};
    if (!st || !st.seats || !st.seats.length) { ctrl.mx = 0; ctrl.my = 0; return; }

    const skill = f.chairSkill != null ? f.chairSkill : 0.7;
    const urgent = st.phase === "stop" || st.phase === "fake"
      || (st.phase === "music" && st.t < f.chairReact * skill);

    /* 挑目标位子：越近越好，同时避开「别人离得更近」的位子（去了也抢不到） */
    f.chairPickT = (f.chairPickT || 0) - dt;
    if (urgent || f.chairPickT <= 0 || f.chairPick == null || f.chairPick < 0 || !st.seats[f.chairPick]) {
      let bi = -1, bs = Infinity;
      st.seats.forEach((s, i) => {
        const d = Math.hypot(s.x - f.x, s.y - f.y);
        let rivals = 0;
        for (const o of B.fighters) {
          if (o === f || o.kind !== "hero" || o.dead || o.bench) continue;
          if (Math.hypot(s.x - o.x, s.y - o.y) < d - 12) rivals++;
        }
        const score = d + rivals * (urgent ? 190 : 90);
        if (score < bs) { bs = score; bi = i; }
      });
      f.chairPick = bi;
      f.chairPickT = urgent ? 0.22 : 0.5;
    }

    const tgt = st.seats[f.chairPick] || st.seats[0];
    if (!urgent) {
      /* 不急：在目标位子附近绕圈游走，别站死在上面（站死会被别人盯着） */
      const a = B.t * (0.7 + skill) + (f.side || 0);
      const tx = tgt.x + Math.cos(a) * (tgt.r + 60), ty = tgt.y + Math.sin(a) * (tgt.r + 46);
      const s = LD.AI.steer(f, tx - f.x, ty - f.y, null);
      ctrl.mx = s.x * 0.7; ctrl.my = s.y * 0.7;
      return;
    }
    /* 急：直奔位子中心，站进去就小幅晃动防止被挤出去 */
    const dx = tgt.x - f.x, dy = tgt.y - f.y, d = Math.hypot(dx, dy) || 1;
    if (d > 6) {
      const s = LD.AI.steer(f, dx / d, dy / d, null);
      ctrl.mx = s.x; ctrl.my = s.y;
    } else { ctrl.mx = 0; ctrl.my = 0; }
  };
})(window.LD = window.LD || {});
