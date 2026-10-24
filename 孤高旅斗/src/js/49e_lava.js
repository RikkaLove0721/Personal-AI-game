/* ============================================================
 *  49e_lava.js — v4.12 地板是岩浆
 * ============================================================
 *  地砖周期发红：calm（平静）→ warn（预警闪烁，warnT 秒）→ hot（真正致命，
 *  hotT 秒，站上去每秒掉 dps 血）→ gap（间歇，随机消失一个安全台）。
 *
 *  安全落脚点：场上散落一批安全台（家具 / 平台），站在台子上就不算踩到岩浆。
 *  但安全台每轮随机消失一个（直到只剩 padsMin 个），场地越来越挤 ——
 *  后期「抢台子」本身就是最大的冲突来源，而本模式禁用普攻 / 技能 / 大招，
 *  抢不到台子就只能硬吃伤害。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.LAVA || {};

  const C_HOT = "#f97316", C_WARN = "#fbbf24", C_PAD = "#7dd3fc";

  /* ---- 网格：只对可行走区域（pt 以下）分格 ---- */
  B.lavaGrid = function () {
    const c = C(), w = this.world;
    const x0 = 40, y0 = (w.pt || 110) + 40, x1 = w.w - 40, y1 = w.h - 40;
    return {
      x0: x0, y0: y0,
      tw: (x1 - x0) / (c.cols || 8),
      th: (y1 - y0) / (c.rows || 6),
      cols: c.cols || 8, rows: c.rows || 6
    };
  };
  B.lavaCell = function (x, y) {
    const g = B.lavaGrid.call(this);
    const ci = clamp(Math.floor((x - g.x0) / g.tw), 0, g.cols - 1);
    const ri = clamp(Math.floor((y - g.y0) / g.th), 0, g.rows - 1);
    return ri * g.cols + ci;
  };
  B.lavaCellXY = function (idx) {
    const g = B.lavaGrid.call(this);
    const ci = idx % g.cols, ri = Math.floor(idx / g.cols);
    return { x: g.x0 + (ci + 0.5) * g.tw, y: g.y0 + (ri + 0.5) * g.th, w: g.tw, h: g.th };
  };

  /** 站在安全台上？（安全台是唯一在岩浆期也安全的地方） */
  B.lavaOnPad = function (x, y) {
    const st = this.lava;
    if (!st || !st.pads) return false;
    for (const p of st.pads) {
      if (p.dead) continue;
      if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2) return true;
    }
    return false;
  };
  /** 这一格此刻安全吗（安全台 或 没被点亮的格子） */
  B.lavaSafeAt = function (x, y, hot) {
    if (B.lavaOnPad.call(this, x, y)) return true;
    return !(hot && hot[B.lavaCell.call(this, x, y)]);
  };

  B.initLava = function () {
    const c = C(), w = this.world;
    const alive = this.casualAlive();
    /* 安全台：彼此不重叠，也不压在障碍上 */
    const props = (this.terrain && this.terrain.props) || [];
    const pads = [];
    const PW = c.padW || 96, PH = c.padH || 82;
    for (let i = 0; i < (c.pads || 8); i++) {
      let ok = false, px = 0, py = 0;
      for (let tries = 0; tries < 70 && !ok; tries++) {
        px = rnd(110, w.w - 110); py = rnd(w.pt + 90, w.h - 90);
        ok = true;
        for (const p of pads) if (Math.abs(px - p.x) < PW * 1.5 && Math.abs(py - p.y) < PH * 1.5) { ok = false; break; }
        if (!ok) continue;
        for (const o of props) {
          if (o.dead || !o.blockMove) continue;
          if (Math.abs(px - o.x) < (o.w || 40) / 2 + PW / 2 && Math.abs(py - o.y) < (o.h || 40) / 2 + PH / 2) { ok = false; break; }
        }
      }
      pads.push({ x: px, y: py, w: PW, h: PH, dead: false, sink: 0 });
    }
    /* 开局把人放在安全台附近，先给一个喘息的位置 */
    const pts = alive.map((f, i) => {
      const p = pads[i % pads.length];
      return p ? { x: p.x + rnd(-30, 30), y: p.y + rnd(-24, 24) } : { x: rnd(120, w.w - 120), y: rnd(w.pt + 90, w.h - 90) };
    });
    this.casualPlace(pts, alive);
    alive.forEach(f => { f.lavaTick = 0; f.lavaAim = null; f.lavaAimT = 0; });

    this.lava = {
      phase: "calm", t: 3.2, round: 0, ratio: c.firstRatio || 0.22,
      hot: null, warn: null, pads: pads
    };
    FX.float(w.w / 2, w.pt + 40, "地板要烧起来了——站到台子上", C_WARN, 19);
  };

  B.updateLava = function (dt) {
    const st = this.lava, c = C();
    if (!st) return;
    const alive = this.casualAlive();
    const g = B.lavaGrid.call(this);
    const total = g.cols * g.rows;

    st.t -= dt;

    /* ---- 岩浆灼烧（按 0.5 秒结算一次，避免每帧飘字） ---- */
    if (st.phase === "hot" && st.hot) {
      for (const f of alive) {
        if (B.lavaSafeAt.call(this, f.x, f.y, st.hot)) { f.lavaTick = 0; continue; }
        f.lavaTick = (f.lavaTick || 0) + dt;
        if (f.lavaTick < 0.5) continue;
        const dmg = (c.dps || 55) * f.lavaTick;
        f.lavaTick = 0;
        this.casualHurt(f, dmg, { color: C_HOT, text: "烫！-", size: 16 });
        if (Math.random() < 0.35) FX.trail(f.x + rnd(-10, 10), f.y, C_HOT, 4, 0.3);
      }
    } else {
      for (const f of alive) f.lavaTick = 0;
    }

    if (st.t > 1e-6) return;

    if (st.phase === "calm") {
      /* 抽一批格子发红（比例逐轮上升） */
      const n = Math.max(1, Math.round(total * st.ratio));
      const set = {};
      for (let i = 0; i < n; i++) set[(Math.random() * total) | 0] = 1;
      st.warn = set; st.hot = null;
      st.phase = "warn"; st.t = c.warnT || 1.6;
      FX.float(this.world.w / 2, this.world.pt + 40, "地板开始发红了！", C_WARN, 19);
      if (LD.Audio && LD.Audio.beep) LD.Audio.beep(520, 0.12, "square", 0.05);
      return;
    }
    if (st.phase === "warn") {
      st.hot = st.warn; st.warn = null;
      st.phase = "hot"; st.t = c.hotT || 2.6;
      FX.shake(9); FX.flash(0.14, "249,115,22");
      if (LD.Audio && LD.Audio.beep) LD.Audio.beep(300, 0.16, "sawtooth", 0.06);
      return;
    }
    if (st.phase === "hot") {
      st.hot = null;
      st.phase = "gap"; st.t = c.gapT || 1.1;
      /* 间歇期随机消失一个安全台（保底 padsMin 个），场地越来越挤 */
      const live = st.pads.filter(p => !p.dead);
      if (live.length > (c.padsMin || 2)) {
        const gone = live[(Math.random() * live.length) | 0];
        gone.dead = true;
        FX.ring(gone.x, gone.y, 60, "rgba(148,163,184,.9)", 5, 0.45);
        FX.float(gone.x, gone.y - 40, "塌了！", "#94a3b8", 16);
      }
      return;
    }
    /* gap → 下一轮 */
    st.round++;
    st.ratio = Math.min(c.ratioMax || 0.5, (c.firstRatio || 0.22) + (c.ratioStep || 0.05) * st.round);
    st.phase = "calm"; st.t = rnd(2.6, 4.2);
  };

  B.lavaTimeUp = function () {
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if (f.hp > w.hp) w = f; });
    this.casualWin(w, "时间到·血量最高");
  };

  /* ---------------- 渲染 ---------------- */
  B.drawLava = function (ctx) {
    const st = this.lava, c = C(), w = this.world;
    if (!st) return;

    /* 安全台：抬高的石台 + 一圈冷色描边 */
    ctx.save();
    st.pads.forEach(p => {
      if (p.dead) {
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = "#64748b"; ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
        ctx.setLineDash([]);
        return;
      }
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = "#164e63";
      ctx.fillRect(p.x - p.w / 2 - 5, p.y - p.h / 2 - 5, p.w + 10, p.h + 10);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#0e7490";
      ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      ctx.strokeStyle = C_PAD; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#a5f3fc";
      ctx.font = "bold 11px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("安全", p.x, p.y);
    });
    ctx.restore();

    /* 发红的地砖 */
    const set = st.phase === "warn" ? st.warn : (st.phase === "hot" ? st.hot : null);
    if (set) {
      const hot = st.phase === "hot";
      ctx.save();
      ctx.globalAlpha = hot ? 0.55 : (0.18 + 0.16 * Math.sin(this.t * 18));
      ctx.fillStyle = hot ? C_HOT : C_WARN;
      Object.keys(set).forEach(k => {
        const cell = B.lavaCellXY.call(this, +k);
        ctx.fillRect(cell.x - cell.w / 2 + 2, cell.y - cell.h / 2 + 2, cell.w - 4, cell.h - 4);
      });
      if (hot) {
        ctx.globalAlpha = 0.9; ctx.strokeStyle = "#fdba74"; ctx.lineWidth = 2;
        Object.keys(set).forEach(k => {
          const cell = B.lavaCellXY.call(this, +k);
          ctx.strokeRect(cell.x - cell.w / 2 + 2, cell.y - cell.h / 2 + 2, cell.w - 4, cell.h - 4);
        });
      }
      ctx.restore();
      /* 岩浆里冒火苗 */
      if (hot && Math.random() < 0.5) {
        const keys = Object.keys(set);
        const cell = B.lavaCellXY.call(this, +keys[(Math.random() * keys.length) | 0]);
        FX.trail(cell.x + rnd(-cell.w / 3, cell.w / 3), cell.y + rnd(-cell.h / 3, cell.h / 3), C_HOT, 5, 0.4);
      }
    }

    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    const txt = st.phase === "calm" ? "地面冷却中…"
      : st.phase === "warn" ? "要烧起来了！快找台子"
        : st.phase === "hot" ? "岩浆！别站在红格上" : "歇一会儿";
    ctx.fillStyle = st.phase === "hot" ? C_HOT : (st.phase === "warn" ? C_WARN : "#7ff0c4");
    ctx.fillText(txt, w.w / 2, w.pt + 14);
    ctx.restore();
  };

  /* ---------------- 人机 ---------------- */
  LD.casualAI.lava = function (f, dt, ctrl) {
    const st = B.lava;
    ctrl.press = {};
    if (!st) { ctrl.mx = 0; ctrl.my = 0; return; }
    const w = B.world;
    const hot = st.phase === "hot" ? st.hot : null;
    const warnSet = st.phase === "warn" ? st.warn : null;

    /* 站在安全台上就别乱跑（gap / calm 期可以到边缘活动一下） */
    const onPad = B.lavaOnPad(f.x, f.y);
    const curSafe = B.lavaSafeAt(f.x, f.y, hot);
    const soonUnsafe = warnSet && !B.lavaSafeAt(f.x, f.y, warnSet) && !onPad;

    if (!curSafe || soonUnsafe) {
      /* 找一个安全的落脚点：优先安全台（且别人少），其次没被点亮的格子中心 */
      let best = null, bs = Infinity;
      st.pads.forEach(p => {
        if (p.dead) return;
        let crowd = 0;
        for (const o of B.fighters) {
          if (o === f || o.kind !== "hero" || o.dead || o.bench) continue;
          if (Math.hypot(o.x - p.x, o.y - p.y) < p.w * 0.6) crowd++;
        }
        const d = Math.hypot(p.x - f.x, p.y - f.y) + crowd * 150;
        if (d < bs) { bs = d; best = { x: p.x, y: p.y }; }
      });
      if (!best) {
        const g = B.lavaGrid.call(B);
        for (let i = 0; i < g.cols * g.rows; i++) {
          if ((hot && hot[i]) || (warnSet && warnSet[i])) continue;
          const cell = B.lavaCellXY.call(B, i);
          const d = Math.hypot(cell.x - f.x, cell.y - f.y);
          if (d < bs) { bs = d; best = cell; }
        }
      }
      if (best) {
        const dx = best.x - f.x, dy = best.y - f.y, d = Math.hypot(dx, dy) || 1;
        if (d > 8) {
          const s = LD.AI.steer(f, dx / d, dy / d, null);
          ctrl.mx = s.x; ctrl.my = s.y;
        } else { ctrl.mx = 0; ctrl.my = 0; }
        return;
      }
    }

    /* 安全：在安全台附近小范围游走，别站死（也别被别人挤出去） */
    f.lavaAimT = (f.lavaAimT || 0) - dt;
    if (!f.lavaAim || f.lavaAimT <= 0) {
      const live = st.pads.filter(p => !p.dead);
      f.lavaAim = live.length ? live[(Math.random() * live.length) | 0] : null;
      f.lavaAimT = rnd(2.5, 5.5);
    }
    if (f.lavaAim) {
      const a = B.t * 0.6 + (f.side || 0);
      const tx = f.lavaAim.x + Math.cos(a) * 26, ty = f.lavaAim.y + Math.sin(a) * 20;
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
      if (d > 10) {
        const s = LD.AI.steer(f, dx / d, dy / d, null);
        ctrl.mx = s.x * 0.7; ctrl.my = s.y * 0.7;
      } else { ctrl.mx = 0; ctrl.my = 0; }
    } else { ctrl.mx = 0; ctrl.my = 0; }
  };
})(window.LD = window.LD || {});
