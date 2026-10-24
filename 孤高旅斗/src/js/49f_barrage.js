/* ============================================================
 *  49f_barrage.js — v4.12 弹幕生存
 * ============================================================
 *  场地边缘架着若干座炮台，持续朝场内倾泻弹幕。弹幕每 waveEvery 秒换一种模式：
 *    sweep  来回扫射（角度缓慢摆动，考验读节奏）
 *    ring   环形齐射（一次撒一圈，考验找缝隙）
 *    aim    瞄准追人（盯着最近的人打，考验跑位）
 *  换模式时有 safeGap 秒的安全间隙喘口气。
 *
 *  被弹幕打中掉 bulletDmg 血并被推开——血空才出局，活得最久的赢。
 *  本模式禁用普攻 / 技能 / 大招：想让对手少吃子弹，只能靠身位把他挤进弹道。
 *
 *  为什么弹幕不走 B.projs：全员同队，B.damage 会被 sameTeam 挡掉，
 *  所以这里自己维护一份子弹数组，命中用 casualHurt 结算。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.BARRAGE || {};

  const C_BULLET = "#f472b6", C_TURRET = "#a78bfa", C_SAFE = "#7ff0c4";

  const MODES = ["sweep", "ring", "aim"];

  B.initBarrage = function () {
    const c = C(), w = this.world;
    const alive = this.casualAlive();
    const n = c.turrets || 5;
    /* 炮台沿场地一圈均匀摆开（离边 56px，别贴脸） */
    const ts = [];
    const pad = 56, x0 = pad, x1 = w.w - pad, y0 = (w.pt || 110) + pad, y1 = w.h - pad;
    const per = Math.max(1, Math.ceil(n / 4));
    let k = 0;
    for (let side = 0; side < 4 && ts.length < n; side++) {
      for (let i = 0; i < per && ts.length < n; i++) {
        const t = (i + 0.5) / per;
        if (side === 0) ts.push({ x: x0 + (x1 - x0) * t, y: y0 });
        else if (side === 1) ts.push({ x: x1, y: y0 + (y1 - y0) * t });
        else if (side === 2) ts.push({ x: x1 - (x1 - x0) * t, y: y1 });
        else ts.push({ x: x0, y: y0 + (y1 - y0) * t });
        const o = ts[ts.length - 1];
        o.cd = rnd(0.2, c.fireEvery || 1.15);
        o.phase = rnd(0, TAU);
        o.k = k++;
      }
    }
    /* 开局把人铺在中场附近 */
    const pts = alive.map(() => ({ x: rnd(w.w * 0.3, w.w * 0.7), y: rnd((w.pt || 110) + 160, w.h - 160) }));
    this.casualPlace(pts, alive);
    alive.forEach(f => { f.barDodge = rnd(0.55, 0.95); });

    this.barrage = {
      turrets: ts, bullets: [], mode: "sweep", modeT: c.waveEvery || 12,
      gap: 2.0, flash: 0
    };
    FX.float(w.w / 2, w.pt + 40, "弹幕来了——活下去", C_TURRET, 19);
  };

  B.barrageFire = function (t, mode) {
    const c = C(), w = this.world;
    const spd = c.bulletSpd || 215;
    const mk = (x, y, a) => {
      this.barrage.bullets.push({
        x: x, y: y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        ax: Math.cos(a), ay: Math.sin(a),
        life: c.bulletLife || 6.5, r: c.bulletR || 9, hit: {}
      });
    };
    const cx = w.w / 2, cy = ((w.pt || 110) + w.h) / 2;
    if (mode === "sweep") {
      const a = Math.atan2(cy - t.y, cx - t.x) + Math.sin(this.t * 1.05 + t.phase) * 0.95;
      mk(t.x, t.y, a);
      if (Math.random() < 0.5) mk(t.x, t.y, a + rnd(-0.16, 0.16));
    } else if (mode === "ring") {
      const base = this.t * 0.7 + t.phase;
      for (let i = 0; i < 8; i++) mk(t.x, t.y, base + i * TAU / 8);
    } else {
      let tgt = null, td = Infinity;
      for (const f of this.casualAlive()) {
        const d = Math.hypot(f.x - t.x, f.y - t.y);
        if (d < td) { td = d; tgt = f; }
      }
      if (!tgt) return;
      const a = Math.atan2(tgt.y - t.y, tgt.x - t.x);
      mk(t.x, t.y, a - 0.10);
      mk(t.x, t.y, a + 0.10);
    }
  };

  B.updateBarrage = function (dt) {
    const st = this.barrage, c = C();
    if (!st) return;
    const w = this.world;
    const alive = this.casualAlive();

    /* ---- 换模式 + 安全间隙 ---- */
    st.modeT -= dt;
    if (st.modeT <= 0) {
      st.modeT = c.waveEvery || 12;
      st.gap = c.safeGap || 3.0;
      let next = MODES[(Math.random() * MODES.length) | 0];
      if (next === st.mode) next = MODES[(MODES.indexOf(next) + 1) % MODES.length];
      st.mode = next;
      st.flash = 0.4;
      FX.float(w.w / 2, w.pt + 40, "弹幕换招：" + (next === "sweep" ? "扫射" : next === "ring" ? "环形齐射" : "瞄准追人"), C_TURRET, 19);
      this.ev.push(["h", w.w / 2, w.pt + 40, "弹幕换招", C_TURRET]);
      if (LD.Audio && LD.Audio.beep) LD.Audio.beep(660, 0.14, "square", 0.05);
    }
    if (st.gap > 0) st.gap = Math.max(0, st.gap - dt);
    if (st.flash > 0) st.flash = Math.max(0, st.flash - dt);

    /* ---- 开火 ---- */
    if (st.gap <= 0) {
      for (const t of st.turrets) {
        t.cd -= dt;
        if (t.cd > 0) continue;
        t.cd = (c.fireEvery || 1.15) * (st.mode === "ring" ? 2.1 : 1) * rnd(0.85, 1.2);
        this.barrageFire(t, st.mode);
        FX.trail(t.x, t.y, C_TURRET, 4, 0.25);
      }
    }

    /* ---- 子弹推进 + 命中 ---- */
    for (let i = st.bullets.length - 1; i >= 0; i--) {
      const b = st.bullets[i];
      b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0 || b.x < -30 || b.x > w.w + 30 || b.y < (w.pt || 110) - 30 || b.y > w.h + 30) {
        st.bullets.splice(i, 1); continue;
      }
      for (const f of alive) {
        if (b.hit[f.side]) continue;
        if (Math.hypot(f.x - b.x, f.y - b.y) > b.r + f.r) continue;
        b.hit[f.side] = 1;
        this.casualHurt(f, c.bulletDmg || 22, {
          color: C_BULLET, text: "-", size: 15,
          kb: c.kb || 130, kbx: b.x - b.ax * 60, kby: b.y - b.ay * 60
        });
        FX.burst(b.x, b.y, 8, [C_BULLET, "#fff"], { speed: 180 });
        st.bullets.splice(i, 1);
        break;
      }
    }
  };

  B.barrageTimeUp = function () {
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if (f.hp > w.hp) w = f; });
    this.casualWin(w, "时间到·血量最高");
  };

  /* ---------------- 渲染 ---------------- */
  B.drawBarrage = function (ctx) {
    const st = this.barrage, w = this.world;
    if (!st) return;

    /* 炮台 */
    ctx.save();
    st.turrets.forEach(t => {
      ctx.fillStyle = "#4c1d95";
      ctx.beginPath(); ctx.arc(t.x, t.y, 20, 0, TAU); ctx.fill();
      ctx.strokeStyle = C_TURRET; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, 20, 0, TAU); ctx.stroke();
      ctx.fillStyle = C_TURRET;
      ctx.beginPath(); ctx.arc(t.x, t.y, 8, 0, TAU); ctx.fill();
      /* 换模式间隙：画一个「熄火」的灰环 */
      if (st.gap > 0) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = C_SAFE; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.x, t.y, 28, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });
    ctx.restore();

    /* 子弹 */
    ctx.save();
    st.bullets.forEach(b => {
      ctx.fillStyle = C_BULLET;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = "#fbcfe8";
      ctx.beginPath(); ctx.arc(b.x - b.ax * 2.5, b.y - b.ay * 2.5, b.r * 0.45, 0, TAU); ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    ctx.fillStyle = st.gap > 0 ? C_SAFE : C_TURRET;
    ctx.fillText(st.gap > 0 ? "安全间隙 " + st.gap.toFixed(1) + "s"
      : "弹幕：" + (st.mode === "sweep" ? "扫射" : st.mode === "ring" ? "环形齐射" : "瞄准追人"),
      w.w / 2, w.pt + 14);
    ctx.restore();
  };

  /* ---------------- 人机 ---------------- */
  LD.casualAI.barrage = function (f, dt, ctrl) {
    const st = B.barrage;
    ctrl.press = {};
    if (!st) { ctrl.mx = 0; ctrl.my = 0; return; }
    const w = B.world;
    const skill = f.barDodge != null ? f.barDodge : 0.7;

    /* 1) 躲弹幕：只躲「正朝自己飞来」的那几颗，横向让开比后退有效得多 */
    let ax = 0, ay = 0;
    for (const b of st.bullets) {
      const dx = f.x - b.x, dy = f.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 210) continue;
      const closing = -(dx / d) * b.ax - (dy / d) * b.ay;     // 1 = 正对着飞过来
      if (closing < 0.55) continue;
      /* 让开的方向：垂直于弹道，并且朝「远离弹道直线」的那一侧 */
      const cross = b.ax * dy - b.ay * dx;                    // >0 表示人在弹道左侧
      const sign = cross >= 0 ? 1 : -1;
      const k = (1 - d / 210) * closing * 460;
      ax += -b.ay * sign * k;
      ay += b.ax * sign * k;
    }

    /* 2) 别贴边：靠近边界就往中心拉（贴边会被扫射压死） */
    const cx = w.w / 2, cy = ((w.pt || 110) + w.h) / 2;
    const pad = 130;
    if (f.x < pad) ax += (pad - f.x) * 2.2;
    if (f.x > w.w - pad) ax -= (f.x - (w.w - pad)) * 2.2;
    if (f.y < (w.pt || 110) + pad) ay += ((w.pt || 110) + pad - f.y) * 2.2;
    if (f.y > w.h - pad) ay -= (f.y - (w.h - pad)) * 2.2;

    /* 3) 有空就往场地中心靠（弹幕密度最低的地方），并和别人散开 */
    ax += (cx - f.x) * 0.12; ay += (cy - f.y) * 0.12;
    for (const o of B.fighters) {
      if (o === f || o.kind !== "hero" || o.dead || o.bench) continue;
      const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 1;
      if (d > 110) continue;
      ax += dx / d * (110 - d) * 1.4; ay += dy / d * (110 - d) * 1.4;
    }
    /* 4) 一点随机扰动：技术差的人机（skill 低）更容易慌不择路 */
    ax += rnd(-60, 60) * (1.2 - skill); ay += rnd(-60, 60) * (1.2 - skill);

    const n = Math.hypot(ax, ay);
    if (n < 1) { ctrl.mx = 0; ctrl.my = 0; return; }
    const s = LD.AI.steer(f, ax / n, ay / n, null);
    ctrl.mx = s.x; ctrl.my = s.y;
  };
})(window.LD = window.LD || {});
