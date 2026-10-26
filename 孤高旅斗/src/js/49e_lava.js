/* ============================================================
 *  49e_lava.js — v4.13 地板是岩浆（改版）
 * ============================================================
 *  地砖周期发红：calm（平静）→ warn（预警闪烁，warnT 秒）→ hot（真正致命，
 *  hotT 秒，站上去每秒掉 dps 血）→ gap（间歇）。
 *
 *  v4.13 的变化：
 *    - 地图缩到原尺寸的 70%
 *    - **取消安全台**：再也不存在「站着就绝对安全」的地方，只能靠走位躲红格
 *    - 每轮岩浆面积**大幅**增加（ratioStep 0.14，一路涨到 78% 的格子都烧起来）
 *    - 加入冰面滑壶那套玩家互撞规则（相对速度够快才算撞），击退削弱到 70%：
 *      后期格子越来越少，抢同一块安全格时可以把人撞出去——这是本模式唯一的「打架」手段
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

  /** v4.13 安全台已取消：这一格此刻安全，只看它有没有被点亮 */
  B.lavaSafeAt = function (x, y, hot) {
    return !(hot && hot[B.lavaCell.call(this, x, y)]);
  };

  /**
   * v4.13d 按**整个身体**判断，而不是只看脚下那一个中心点。
   * 之前用 lavaCell(f.x, f.y) 做点判定 —— 人站在格子边缘、身体已经压到红格上，
   * 中心点却还在隔壁安全格里，于是「明明踩在岩浆上却不掉血」。
   * 现在把角色的包围盒覆盖到的所有格子都算一遍，压到任意一格就算烫到。
   */
  B.lavaBodyOn = function (f, set) {
    if (!f || !set) return false;
    const g = B.lavaGrid.call(this);
    const r = f.r || 15;
    const c0 = clamp(Math.floor((f.x - r - g.x0) / g.tw), 0, g.cols - 1);
    const c1 = clamp(Math.floor((f.x + r - g.x0) / g.tw), 0, g.cols - 1);
    const r0 = clamp(Math.floor((f.y - r - g.y0) / g.th), 0, g.rows - 1);
    const r1 = clamp(Math.floor((f.y + r - g.y0) / g.th), 0, g.rows - 1);
    for (let ri = r0; ri <= r1; ri++) {
      for (let ci = c0; ci <= c1; ci++) {
        if (set[ri * g.cols + ci]) return true;
      }
    }
    return false;
  };

  /**
   * v4.13 玩家互撞：沿用冰面滑壶那套规则（相对接近速度够快才算「撞」），
   * 击退力按 bumpMul（70%）削弱。岩浆模式是位移式移动，f.vx / f.vy 只在击退时才有值，
   * 所以这里用**上一帧到这一帧的位移**反推速度。
   */
  B.lavaBump = function (dt) {
    const c = C();
    const alive = this.casualAlive();
    if (alive.length < 2 || !(dt > 0)) return;
    const minSpd = c.bumpMinSpd || 80;
    const kb = (c.bumpKb || 330) * (c.bumpMul || 0.77);
    const pairCd = c.bumpPairCd || 0.4;
    const spdOf = (f) => ({
      vx: (f._lvpx == null ? 0 : (f.x - f._lvpx) / dt),
      vy: (f._lvpy == null ? 0 : (f.y - f._lvpy) / dt)
    });
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const touch = a.r + b.r + 4;
        if (d > touch) continue;
        const ux = dx / d, uy = dy / d, pen = (touch - d) / 2 + 0.5;
        if (a.knockLeft <= 0) { a.x -= ux * pen; a.y -= uy * pen; }
        if (b.knockLeft <= 0) { b.x += ux * pen; b.y += uy * pen; }
        /* v4.13d 同一对人 0.4 秒内只结算一次：
         * 之前没有冷却，贴着走的时候命中判定依赖「上一帧位移」这种很脆的量，
         * 于是同一次接触有时弹一串特效、有时一帧都没触发——手感上就是「撞人有时候没用」。 */
        a._lavaBumpT = a._lavaBumpT || {};
        if (a._lavaBumpT[b.side] > 0) continue;
        const va = spdOf(a), vb = spdOf(b);
        const close = (va.vx - vb.vx) * ux + (va.vy - vb.vy) * uy;
        if (close < minSpd) continue;
        a._lavaBumpT[b.side] = pairCd;
        b._lavaBumpT = b._lavaBumpT || {};
        b._lavaBumpT[a.side] = pairCd;
        if (this.knockDist) {
          this.knockDist(b, { x: a.x, y: a.y }, kb * clamp(close / 340, 0.6, 1.6), false);
          this.knockDist(a, { x: b.x, y: b.y }, kb * 0.45 * clamp(close / 340, 0.6, 1.6), false);
        }
        FX.ring((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, 34, "rgba(249,115,22,.9)", 4, 0.3);
        FX.burst((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, 10, [C_HOT, "#fff"], { speed: 220 });
        FX.float((a.x + b.x) / 2, (a.y + b.y) / 2 - 46, "撞飞！", C_HOT, 14);
        this.ev.push(["t", (a.x + b.x) / 2, (a.y + b.y) / 2 - 46, "撞飞！", C_HOT]);
        FX.shake(5);
      }
    }
    alive.forEach(f => {
      f._lvpx = f.x; f._lvpy = f.y;
      if (f._lavaBumpT) {
        Object.keys(f._lavaBumpT).forEach(k => {
          if (f._lavaBumpT[k] > 0) f._lavaBumpT[k] = Math.max(0, f._lavaBumpT[k] - dt);
        });
      }
    });
  };

  B.initLava = function () {
    const c = C(), w = this.world;
    const alive = this.casualAlive();
    /* v4.13 没有安全台了：开局直接铺开在场地各处 */
    const pts = alive.map(() => ({ x: rnd(110, w.w - 110), y: rnd(w.pt + 90, w.h - 90) }));
    this.casualPlace(pts, alive);
    alive.forEach(f => { f.lavaTick = 0; f.lavaAim = null; f.lavaAimT = 0; f._lvpx = null; f._lvpy = null; });

    this.lava = {
      phase: "calm", t: 3.2, round: 0, ratio: c.firstRatio || 0.28,
      hot: null, warn: null
    };
    FX.float(w.w / 2, w.pt + 40, "地板要烧起来了——躲开红格", C_WARN, 19);
  };

  B.updateLava = function (dt) {
    const st = this.lava, c = C();
    if (!st) return;
    const alive = this.casualAlive();
    const g = B.lavaGrid.call(this);
    const total = g.cols * g.rows;

    st.t -= dt;

    /* ---- v4.13 玩家互撞（滑壶那套，击退削弱到 70%） ---- */
    this.lavaBump(dt);

    /* ---- 岩浆灼烧（按 0.5 秒结算一次，避免每帧飘字） ---- */
    if (st.phase === "hot" && st.hot) {
      for (const f of alive) {
        /* v4.13d 用身体包围盒判定：贴着格子边缘站也算踩上去 */
        if (!B.lavaBodyOn.call(this, f, st.hot)) { f.lavaTick = 0; continue; }
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
      /* v4.13d 岩浆量不再按比例涨，而是**按人数**定：
       * 安全格 = 存活人数 + safeExtra（默认 1），其余全烧。
       * 人越少安全格越少，后期一定是「几个人抢最后几块落脚地」。 */
      const nSafe = clamp(alive.length + (c.safeExtra == null ? 1 : c.safeExtra),
        c.minSafe || 2, total);
      const nHot = Math.max(0, total - nSafe);
      const idx = [];
      for (let i = 0; i < total; i++) idx.push(i);
      if (nHot < total) {
        for (let i = idx.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
        }
      }
      const set = {};
      for (let i = 0; i < nHot; i++) set[idx[i]] = 1;
      st.warn = set; st.hot = null;
      st.nSafe = total - nHot;
      st.ratio = total > 0 ? nHot / total : 0;
      st.phase = "warn"; st.t = c.warnT || 2.0;
      FX.float(this.world.w / 2, this.world.pt + 40, "地板开始发红了！只剩 " + (total - nHot) + " 块安全地", C_WARN, 19);
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
      return;
    }
    /* gap → 下一轮（v4.13d 岩浆量由存活人数决定，这里只推进轮次） */
    st.round++;
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

    /* v4.13 安全台已取消：改成把「还算安全」的格子淡淡描一圈，方便读盘 */
    const safeSet = st.phase === "warn" ? st.warn : (st.phase === "hot" ? st.hot : null);
    if (safeSet) {
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = "#7ff0c4"; ctx.lineWidth = 2;
      const g = B.lavaGrid.call(this);
      for (let i = 0; i < g.cols * g.rows; i++) {
        if (safeSet[i]) continue;
        const cell = B.lavaCellXY.call(this, i);
        ctx.strokeRect(cell.x - cell.w / 2 + 3, cell.y - cell.h / 2 + 3, cell.w - 6, cell.h - 6);
      }
      ctx.restore();
    }

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
      : st.phase === "warn" ? "要烧起来了！快挪窝"
        : st.phase === "hot" ? "岩浆！别站在红格上" : "歇一会儿";
    ctx.fillStyle = st.phase === "hot" ? C_HOT : (st.phase === "warn" ? C_WARN : "#7ff0c4");
    ctx.fillText(txt, w.w / 2, w.pt + 14);
    if (st.phase !== "hot") {
      ctx.font = "13px system-ui,'Microsoft YaHei',sans-serif";
      ctx.fillStyle = "#94a3b8";
      const nSafe = st.nSafe != null ? st.nSafe : Math.max(0, Math.round((1 - st.ratio) * 100));
      ctx.fillText("安全格 " + nSafe + " 块（存活人数 + " + (c.safeExtra == null ? 1 : c.safeExtra)
        + "）· 岩浆 " + Math.round(st.ratio * 100) + "%", w.w / 2, w.pt + 34);
    }
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
    /* 危险 = 身体压到了红格（不是只看中心点），或预警里自己这块马上要烧起来 */
    const curSafe = !B.lavaBodyOn.call(B, f, hot);
    const soonUnsafe = !!(warnSet && B.lavaBodyOn.call(B, f, warnSet));

    /* v4.13 没有安全台了：唯一的落脚点就是「还没被点亮的格子」，
     * 而且后期格子越少越要抢——所以选点时要避开别人已经占着的格子。 */
    const bestCell = () => {
      const g = B.lavaGrid.call(B);
      let best = null, bs = Infinity;
      for (let i = 0; i < g.cols * g.rows; i++) {
        if ((hot && hot[i]) || (warnSet && warnSet[i])) continue;
        const cell = B.lavaCellXY.call(B, i);
        let crowd = 0;
        for (let k = 0; k < B.fighters.length; k++) {
          const o = B.fighters[k];
          if (o === f || o.kind !== "hero" || o.dead || o.bench) continue;
          if (Math.hypot(o.x - cell.x, o.y - cell.y) < Math.min(cell.w, cell.h) * 0.55) crowd++;
        }
        const d = Math.hypot(cell.x - f.x, cell.y - f.y) + crowd * 130;
        if (d < bs) { bs = d; best = cell; }
      }
      return best;
    };

    if (!curSafe || soonUnsafe) {
      const best = bestCell();
      if (best) {
        const dx = best.x - f.x, dy = best.y - f.y, d = Math.hypot(dx, dy) || 1;
        if (d > 8) {
          const s = LD.AI.steer(f, dx / d, dy / d, null);
          ctrl.mx = s.x; ctrl.my = s.y;
        } else { ctrl.mx = 0; ctrl.my = 0; }
        return;
      }
      /* 全烧起来了：只能往人少的方向硬闯 */
      let ax = 0, ay = 0;
      for (let k = 0; k < B.fighters.length; k++) {
        const o = B.fighters[k];
        if (o === f || o.kind !== "hero" || o.dead || o.bench) continue;
        const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 1;
        ax += dx / d / d * 500; ay += dy / d / d * 500;
      }
      const s = LD.AI.steer(f, ax, ay, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      return;
    }

    /* 安全：在附近小范围游走，别站死（被别人撞出去就没地方站了） */
    f.lavaAimT = (f.lavaAimT || 0) - dt;
    if (!f.lavaAim || f.lavaAimT <= 0) {
      f.lavaAim = bestCell();
      f.lavaAimT = rnd(2.0, 4.5);
    }
    if (f.lavaAim) {
      const a = B.t * 0.6 + (f.side || 0);
      const tx = f.lavaAim.x + Math.cos(a) * 22, ty = f.lavaAim.y + Math.sin(a) * 16;
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
      if (d > 10) {
        const s = LD.AI.steer(f, dx / d, dy / d, null);
        ctrl.mx = s.x * 0.7; ctrl.my = s.y * 0.7;
      } else { ctrl.mx = 0; ctrl.my = 0; }
    } else { ctrl.mx = 0; ctrl.my = 0; }
  };
})(window.LD = window.LD || {});
