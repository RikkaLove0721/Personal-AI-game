/* ============================================================
 *  49b_statue.js — v4.12 一二三木头人
 * ============================================================
 *  小地图（960 × 600，正好一屏）全员同视野，从最左边跑到最右边的终点线。
 *  终点线外站着一座监视者雕像，周期性回头：
 *    back（背对，可全速跑）→ tell（预警信号：黄闪 + 视野扇形预告 + 头顶文字）
 *    → look（回头盯着看）→ back ...
 *
 *  回头期间的规则：
 *    - 处在视野扇形里、并且**还在移动**的人会被锁定
 *    - 锁定先画 0.42 秒的红圈（来得及闪避 / 横移躲开），落点结算：
 *      掉 lockDmg 血 + 被往左击退一大段
 *    - **不退回起点**：进度保留，只吃伤害与击退（这是本模式与常规「退回起点」的核心差别）
 *    - 偶尔来一次「假回头」（时间明显更短），让信号不能无脑信任
 *
 *  禁用普攻 / 技能 / 大招；P 键交互保留（场景道具照常可用）。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.STATUE || {};

  const C_GOLD = "#fbbf24", C_RED = "#f87171", C_STONE = "#8b8f9a";

  /* 视野扇形：从监视者朝左，半角 fovHalf、半径 fovR */
  B.statueInFov = function (x, y) {
    const c = C();
    const wx = c.watcherX, wy = c.watcherY;
    const dx = x - wx, dy = y - wy;
    const d = Math.hypot(dx, dy);
    if (d > (c.fovR || 720) || d < 24) return false;
    const a = Math.atan2(dy, dx);
    let diff = Math.abs(((a - Math.PI + Math.PI * 3) % TAU) - Math.PI);
    return diff <= (c.fovHalf || 0.28);
  };

  /** 复活点：保留 x 进度（被抓到只吃伤害，绝不退回起点） */
  B.statueSpot = function (f) {
    const c = C(), w = this.world;
    const x = clamp((f.statueX != null ? f.statueX : f.x) - 26, c.startX || 82, (c.finishX || 884) - 40);
    return { x: x, y: rnd(w.pt + 50, w.h - 60) };
  };

  B.initStatue = function () {
    const c = C(), w = this.world;
    /* 地形按大地图生成过，先清掉越界的，再抽稀留一点当路障（抢道才有互动） */
    this.casualThinProps(0.34);
    const alive = this.casualAlive();
    /* 起跑线：全部塞在最左侧，纵向均分（小地图一屏，谁都看得见谁） */
    const top = w.pt + 60, bot = w.h - 60;
    const pts = alive.map((f, i) => ({
      x: (c.startX || 82),
      y: top + (bot - top) * (alive.length > 1 ? i / (alive.length - 1) : 0.5)
    }));
    this.casualPlace(pts, alive);
    alive.forEach(f => { f.statueX = f.x; f.statueDone = false; f.statueBold = rnd(0.35, 0.95); });

    this.statue = {
      phase: "back",
      t: 2.2,                                   // 开局先给 2.2 秒让玩家看清场面
      lookT: 0,
      fake: false,
      locks: [],
      lockedSet: {},
      round: 0,
      flash: 0
    };
    FX.float(w.w / 2, w.pt + 40, "预备——跑！", C_GOLD, 20);
  };

  B.updateStatue = function (dt) {
    const st = this.statue, c = C();
    if (!st) return;
    const alive = this.casualAlive();

    /* 到达终点线 → 直接赢下这一局 */
    for (const f of alive) {
      f.statueX = Math.max(f.statueX || 0, f.x);
      if (!f.statueDone && f.x >= (c.finishX || 884)) {
        f.statueDone = true;
        FX.burst(f.x, f.y - 30, 30, [C_GOLD, "#fff"], { speed: 300 });
        if (LD.Audio && LD.Audio.beep) LD.Audio.beep(880, 0.16, "triangle", 0.06);
        this.casualWin(f, "冲线！");
        return;
      }
    }

    st.t -= dt;
    if (st.flash > 0) st.flash = Math.max(0, st.flash - dt);

    /* ---- back → tell ---- */
    if (st.phase === "back") {
      if (st.t <= 1e-6) {
        st.phase = "tell"; st.t = c.tellT || 1.15; st.fake = Math.random() < (c.fakeP || 0);
        st.flash = 0.35;
        FX.float(c.watcherX - 150, c.watcherY - 90, "要回头了！", C_GOLD, 20);
        this.ev.push(["h", c.watcherX - 150, c.watcherY - 90, "要回头了！", C_GOLD]);
        if (LD.Audio && LD.Audio.beep) LD.Audio.beep(520, 0.12, "square", 0.05);
      }
      return;
    }

    /* ---- tell → look ---- */
    if (st.phase === "tell") {
      if (st.t <= 1e-6) {
        st.phase = "look";
        st.lookT = st.fake ? (c.fakeT || 0.75) : rnd(c.lookMin || 2.0, c.lookMax || 3.2);
        st.t = st.lookT;
        st.locks.length = 0; st.lockedSet = {};
        st.round++;
        FX.shake(5);
        if (LD.Audio && LD.Audio.beep) LD.Audio.beep(300, 0.18, "sawtooth", 0.05);
      }
      return;
    }

    /* ---- look：抓移动的人 ---- */
    if (st.phase === "look") {
      if (st.locks.length < 3) {
        for (const f of alive) {
          if (f.statueDone || st.lockedSet[f.side]) continue;
          if (!(f.moving || Math.hypot(f.vx || 0, f.vy || 0) > 90)) continue;
          if (!B.statueInFov(f.x, f.y)) continue;
          st.lockedSet[f.side] = 1;
          st.locks.push({ x: f.x, y: f.y, t: c.lockT || 0.42, f: f });
          FX.ring(f.x, f.y - 26, 62, "rgba(248,113,113,.9)", 5, 0.4);
          FX.float(f.x, f.y - 92, "被盯上了！", C_RED, 16);
          this.ev.push(["h", f.x, f.y - 92, "被盯上了！", C_RED]);
        }
      }
      /* 锁定落点逐个结算：锁定的是**位置**，0.42 秒内横移 / 闪避可以躲开 */
      for (let i = st.locks.length - 1; i >= 0; i--) {
        const L = st.locks[i];
        L.t -= dt;
        if (L.t > 0) continue;
        st.locks.splice(i, 1);
        FX.ring(L.x, L.y - 26, c.lockR || 54, "rgba(248,113,113,.95)", 6, 0.35);
        FX.burst(L.x, L.y - 26, 16, [C_RED, "#fff"], { speed: 260 });
        this.ev.push(["x", L.x, L.y - 26, (c.lockR || 54) * 0.8]);
        for (const f of alive) {
          if (f.dead) continue;
          if (Math.hypot(f.x - L.x, f.y - L.y) > (c.lockR || 54) + f.r * 0.5) continue;
          this.casualHurt(f, c.lockDmg || 60, {
            color: C_RED, text: "锁定 -", size: 18,
            kb: c.lockKb || 300, kbx: c.watcherX, kby: c.watcherY
          });
        }
      }
      if (st.t <= 1e-6) {
        st.phase = "back";
        st.t = rnd(c.backMin || 3.0, c.backMax || 4.8);
        st.locks.length = 0; st.lockedSet = {};
      }
    }
  };

  B.statueTimeUp = function () {
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if ((f.statueX || f.x) > (w.statueX || w.x)) w = f; });
    this.casualWin(w, "时间到·跑得最远");
  };

  /* ---------------- 渲染 ---------------- */
  B.drawStatue = function (ctx) {
    const st = this.statue, c = C(), w = this.world;
    if (!st) return;

    /* 起跑线 / 终点线 */
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.moveTo(c.startX || 82, w.pt); ctx.lineTo(c.startX || 82, w.h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = C_GOLD; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(c.finishX || 884, w.pt); ctx.lineTo(c.finishX || 884, w.h); ctx.stroke();
    ctx.fillStyle = C_GOLD;
    ctx.font = "bold 13px system-ui,'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("终点", c.finishX || 884, w.pt + 26);
    ctx.restore();

    const wx = c.watcherX, wy = c.watcherY;
    const half = c.fovHalf || 0.28, R = c.fovR || 720;

    /* 视野扇形：look 期是红色实体，tell 期是黄色预告（这就是「回头前的信号」） */
    if (st.phase === "look" || st.phase === "tell") {
      const warn = st.phase === "tell";
      ctx.save();
      ctx.globalAlpha = warn ? (0.10 + 0.10 * Math.sin(this.t * 16)) : 0.16;
      ctx.fillStyle = warn ? C_GOLD : C_RED;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.arc(wx, wy, R, Math.PI - half, Math.PI + half);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = warn ? 0.55 : 0.75;
      ctx.strokeStyle = warn ? C_GOLD : C_RED; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    /* 监视者雕像：背对时是后脑勺，回头时正面 + 红眼 */
    ctx.save();
    ctx.translate(wx, wy);
    ctx.fillStyle = "#3a3f4a";
    ctx.beginPath(); ctx.ellipse(0, 6, 26, 12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = C_STONE;
    ctx.beginPath(); ctx.ellipse(0, -30, 24, 26, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#5b616d"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.beginPath(); ctx.ellipse(0, -8, 34, 16, 0, 0, TAU); ctx.fill();
    if (st.phase === "back") {
      /* 后脑勺：一条发缝暗示他背对着 */
      ctx.strokeStyle = "#5b616d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -52); ctx.lineTo(0, -14); ctx.stroke();
    } else {
      ctx.fillStyle = st.phase === "look" ? C_RED : C_GOLD;
      const blink = st.phase === "look" ? 1 : (0.6 + 0.4 * Math.sin(this.t * 18));
      ctx.globalAlpha = blink;
      ctx.beginPath(); ctx.arc(-9, -34, 4.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -34, 4.5, 0, TAU); ctx.fill();
    }
    ctx.restore();

    /* 锁定落点：收缩的红圈 + 倒数 */
    ctx.save();
    st.locks.forEach(L => {
      const k = clamp(L.t / (c.lockT || 0.42), 0, 1);
      ctx.strokeStyle = C_RED; ctx.lineWidth = 4;
      ctx.globalAlpha = 0.35 + 0.5 * (1 - k);
      ctx.beginPath(); ctx.arc(L.x, L.y - 26, (c.lockR || 54) * (0.45 + 0.55 * k), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C_RED;
      ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(L.t.toFixed(1), L.x, L.y - 26);
    });
    ctx.restore();

    /* 顶部状态条 */
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    const txt = st.phase === "back" ? "他背对着——跑！"
      : st.phase === "tell" ? "要回头了！站住别动"
        : "别动！他在看";
    ctx.fillStyle = st.phase === "back" ? "#7ff0c4" : (st.phase === "tell" ? C_GOLD : C_RED);
    ctx.fillText(txt, w.w / 2, w.pt + 14);
    ctx.restore();
  };

  /* ---------------- 人机 ---------------- */
  LD.casualAI.statue = function (f, dt, ctrl) {
    const st = B.statue, c = LD.STATUE || {};
    ctrl.press = {};
    if (!st || f.statueDone) { ctrl.mx = 0; ctrl.my = 0; return; }

    /* 被锁定：横向猛挪，争取在落点结算前挪出判定圈 */
    if (st.locks && st.locks.length) {
      for (const L of st.locks) {
        if (L.f !== f) continue;
        const up = Math.abs(f.y - (B.world.pt + 70)) < Math.abs((B.world.h - 70) - f.y) ? -1 : 1;
        const s = LD.AI.steer(f, rnd(-0.4, 0.4), up, null);
        ctrl.mx = s.x; ctrl.my = s.y;
        return;
      }
    }

    const bold = f.statueBold != null ? f.statueBold : 0.6;
    const safe = !B.statueInFov(f.x, f.y);
    const runTo = () => {
      const ty = clamp(f.y, B.world.pt + 60, B.world.h - 60);
      const s = LD.AI.steer(f, (c.finishX || 884) - f.x, ty - f.y, null);
      ctrl.mx = s.x; ctrl.my = s.y;
    };

    if (st.phase === "look") {
      /* 已经在扇形外 → 趁着别人不敢动，加速偷跑；在扇形里 → 一动不动 */
      if (safe) runTo(); else { ctrl.mx = 0; ctrl.my = 0; }
      return;
    }
    if (st.phase === "tell") {
      /* 越快回头越要早停；胆子大的（bold 高）会多贪几步，扇形外的直接无视信号继续冲 */
      if (safe) { runTo(); return; }
      if (st.t > 0.15 + (1 - bold) * 0.5) runTo(); else { ctrl.mx = 0; ctrl.my = 0; }
      return;
    }
    runTo();
  };
})(window.LD = window.LD || {});
