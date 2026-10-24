/* ============================================================
 *  48_capture.js — v4.7 占点争夺
 * ============================================================
 *  两队（红 0 / 蓝 1）抢据点：
 *    - 每局随机 3~5 座，大点（B）恒定在地图正中，小点撒在外围
 *    - 站进圈里读条占领，人越多越快（v4.12 起线性叠加：2 人 ×2 / 3 人 ×3）
 *    - 多队同抢一个点按净值结算（2 红 1 蓝 = 1 红的速度）；人数相等则僵持冻结
 *    - 空点 5 秒占下，抢敌方已占的点要两倍时间（10 秒）
 *    - 占领后每秒产分，大点权重 2、小点 1，先到 need 分获胜
 *    - 占领时据点中心升起炮塔（数值同塔防防御塔、射程 = 据点半径）；
 *      易主只换攻击目标、血量保留；被拆掉则本局永久消失
 *    - 阵亡 3 秒复活，之后每死一次 +3 秒；自家基地圈内缓慢回血
 *
 *  实现要点：
 *    - 据点进度只用一个数字 p.prog（0..1）+ p.by（谁在推），归属 p.owner(-1/0/1)。
 *    - 炮塔复用地形 prop 的 turret 通道（drawGuardPost 有现成美术 + 血条），
 *      额外打 capTurret 标记：拆解倍率、被摧毁回调、易主换边都靠它区分。
 *    - 炮塔射程直接取 p.r（每个据点自己的圈），不读 LD.TOWER.tower.range。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const C_RED = "#f87171", C_BLUE = "#60a5fa";
  const C_NEU = "#94a3b8";
  const colOf = (t) => (t > 0 ? C_BLUE : C_RED);
  const nameOf = (t) => (t > 0 ? "蓝队" : "红队");
  const teamOf = (f) => (f && f.team > 0 ? 1 : 0);

  /* ==========================================================
   *  基地
   * ========================================================== */
  B.captureBase = function (team) {
    const C = LD.CAPTURE || {};
    const t = team > 0 ? 1 : 0;
    const inset = C.spawnInset || 170;
    const top = this.world.pt || 0;
    return {
      x: t > 0 ? this.world.w - inset : inset,
      y: top + (this.world.h - top) / 2,
      r: C.baseR || 190,
      team: t
    };
  };

  /* ==========================================================
   *  开局：随机据点 + 队伍归并 + 站到自家基地
   * ========================================================== */
  B.initCapture = function () {
    const C = LD.CAPTURE || {};
    const w = this.world.w, h = this.world.h, top = this.world.pt || 0;
    const edge = C.edge || 260;
    const minGap = C.minGap || 720;
    const baseGap = C.baseGap || 480;
    const bigC = C.big || { r: 180, w: 2, name: "B" };
    const smallC = C.small || { r: 150, w: 1 };
    const bases = [this.captureBase(0), this.captureBase(1)];

    /* 大点：永远在地图正中 */
    const big = {
      i: 0, big: true,
      name: bigC.name || "B",
      x: w / 2, y: top + (h - top) / 2,
      r: bigC.r || 180, w: bigC.w || 2,
      owner: -1, prog: 0, by: -1, c0: 0, c1: 0, flash: 0, turret: null
    };
    const pts = [big];

    /* v4.11 据点数量：保底 3 座（左 / 中 / 右），房间每多 perExtra 名玩家再 +1 座，
     * 最多 maxPts 座（3 人 3 座 / 5 人 4 座 / 7 人 5 座 / 9 人 6 座封顶）。 */
    const heroN = this.fighters.filter(f => f.kind === "hero" && !f.bench).length;
    const perExtra = C.perExtra || 2;
    const total = Math.max(C.basePts || 3, Math.min(C.maxPts || 6,
      (C.basePts || 3) + Math.max(0, Math.floor((heroN - 3) / perExtra))));
    const names = ["A", "C", "D", "E"];
    const smallR = smallC.r || 150;
    const mkSmall = (i, nm, x, y) => ({
      i: i, big: false, name: nm, x: x, y: y, r: smallR, w: smallC.w || 1,
      owner: -1, prog: 0, by: -1, c0: 0, c1: 0, flash: 0, turret: null
    });
    /* v4.11 左右两点：贴各自半场，纵向随机落点，和中间大点构成三足鼎立。
     * 基地在左右两端正中，所以这两点必须往上下偏，摇不到就贴最近的顶 / 底边。 */
    const sideX = Math.max(C.sideInset || 300, edge);
    const yTop = top + edge, yBot = h - edge;
    const baseClear = (C.baseR || 190) + smallR + 50;
    const okSpot = (x, y) => bases.every(b => Math.hypot(b.x - x, b.y - y) >= baseClear)
      && pts.every(p => Math.hypot(p.x - x, p.y - y) >= minGap * 0.8);
    function sideSpot(cx) {
      for (let k = 0; k < 60; k++) {
        const x = rand(Math.max(edge, cx - 160), Math.min(w - edge, cx + 160));
        const y = rand(yTop, yBot);
        if (okSpot(x, y)) return { x: x, y: y };
      }
      return { x: cx, y: yTop };                  // 兜底：贴顶边，离两个基地都最远
    }
    if (total >= 2) { const p = sideSpot(sideX); pts.push(mkSmall(1, "A", p.x, p.y)); }
    if (total >= 3) { const p = sideSpot(w - sideX); pts.push(mkSmall(2, "C", p.x, p.y)); }
    /* 多出来的：随机撒，满足最小间距、离边界、离基地三条约束 */
    for (let n = pts.length; n < total; n++) {
      let spot = null;
      for (let k = 0; k < 220; k++) {
        const x = rand(edge, w - edge), y = rand(top + edge, h - edge);
        if (pts.some(p => Math.hypot(p.x - x, p.y - y) < minGap)) continue;
        if (bases.some(b => Math.hypot(b.x - x, b.y - y) < baseGap + (smallC.r || 150))) continue;
        spot = { x: x, y: y };
        break;
      }
      /* 兜底：极端情况下放宽约束，至少保证还在图内 */
      if (!spot) {
        for (let k = 0; k < 80 && !spot; k++) {
          const x = rand(edge, w - edge), y = rand(top + edge, h - edge);
          if (pts.some(p => Math.hypot(p.x - x, p.y - y) < minGap * 0.55)) continue;
          spot = { x: x, y: y };
        }
      }
      if (!spot) spot = { x: rand(edge, w - edge), y: rand(top + edge, h - edge) };
      pts.push(mkSmall(n, names[n - 1] || ("P" + (n + 1)), spot.x, spot.y));
    }
    /* 按横坐标排序，读起来就是「左 → 右」，小点命名也稳定 */
    const rest = pts.slice(1).sort((a, b) => a.x - b.x || a.y - b.y);
    rest.forEach((p, i) => { p.name = names[i] || ("P" + (i + 1)); });
    this.capture = {
      score: [0, 0],
      acc: 0,
      done: false,
      big: big,
      pts: [big].concat(rest)
    };

    /* 圈心清场：随机设施可能正好卡在据点正中，人站不进去就读不了条。
     * 只清中心 45%（外圈保留掩体，占点时还有东西可以绕）。 */
    if (this.terrain && this.terrain.props) {
      const all = this.capture.pts;
      this.terrain.props = this.terrain.props.filter(p =>
        !all.some(pt => Math.hypot(p.x - pt.x, p.y - pt.y) < pt.r * 0.45));
      this.captureReindex();
    }
    this.fighters.forEach(f => {
      if (f.kind !== "hero") return;
      if (f.team == null || f.team < 0) f.team = f.side % 2;
      f.team = f.team > 0 ? 1 : 0;
      /* v4.7 复活时间递增：首次 respawn，之后每次 +respawnStep */
      f.capRespawnT = C.respawn || 3.0;
      f.capHealAcc = 0;
    });
    this.placeCaptureHeroes();
  };

  /** 清掉设施后重标占用格，否则 AI 会绕着已经不存在的障碍走 */
  B.captureReindex = function () {
    const map = this.terrain;
    if (!map || !map.occ) return;
    const tile = map.tile || (LD.TERRAIN && LD.TERRAIN.tile) || 40;
    const top = map.top != null ? map.top : (this.world.pt || 0);
    for (let r = 0; r < map.rows; r++) {
      const row = map.occ[r];
      if (row) for (let c = 0; c < row.length; c++) row[c] = 0;
    }
    map.props.forEach(p => {
      if (!p.blockMove || p.dead) return;
      const c0 = Math.max(0, Math.floor((p.x - p.w / 2) / tile));
      const c1 = Math.min(map.cols - 1, Math.floor((p.x + p.w / 2 - 1) / tile));
      const r0 = Math.max(0, Math.floor((p.y - p.h / 2 - top) / tile));
      const r1 = Math.min(map.rows - 1, Math.floor((p.y + p.h / 2 - 1 - top) / tile));
      for (let r = r0; r <= r1; r++) if (map.occ[r]) for (let c = c0; c <= c1; c++) map.occ[r][c] = 1;
    });
  };

  /** 复活 / 开局站位：在自家基地圈里随机找一个不卡障碍的点 */
  B.captureSpawn = function (f) {
    const b = this.captureBase(teamOf(f));
    const top = this.world.pt || 0;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * TAU, rr = Math.random() * b.r * 0.55;
      const x = clamp(b.x + Math.cos(a) * rr, 60, this.world.w - 60);
      const y = clamp(b.y + Math.sin(a) * rr, top + 60, this.world.h - 60);
      if (!this.terrain || LD.Terrain.clearAt(this.terrain, x, y, 28)) return { x: x, y: y };
    }
    return { x: b.x, y: b.y };
  };

  B.placeCaptureHeroes = function () {
    const cnt = { 0: 0, 1: 0 };
    const top = this.world.pt || 0;
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.bench) return;
      const tm = teamOf(f);
      const k = cnt[tm]++;
      const p = this.captureSpawn(f);
      f.x = p.x;
      f.y = clamp(p.y + (k - 0.5) * 74, top + 60, this.world.h - 60);
      if (this.terrain && !LD.Terrain.clearAt(this.terrain, f.x, f.y, 26)) { f.x = p.x; f.y = p.y; }
    });
  };

  /* ==========================================================
   *  据点炮塔（数值 = 塔防防御塔，射程 = 据点半径）
   * ========================================================== */
  B.captureTurretOf = function (p) {
    return (p && p.turret && !p.turret.dead) ? p.turret : null;
  };

  B.spawnCaptureTurret = function (p, team) {
    if (!this.terrain || !p) return null;
    const C = LD.CAPTURE || {}, cfg = C.turret || {};
    const TILE = (LD.TERRAIN && LD.TERRAIN.tile) || 40;
    const t = team > 0 ? 1 : 0;
    const o = {
      uid: 960000 + ((this._capSeq = (this._capSeq || 0) + 1)),
      kind: "turret", mat: "metal", shape: "round",
      cw: 1, ch: 1, w: TILE, h: TILE,
      x: p.x, y: p.y, ox: p.x, oy: p.y,
      elev: cfg.elev || 70, mass: 5,
      hp: cfg.hp || 1200, maxHp: cfg.hp || 1200,
      dead: false, flash: 0, vx: 0, vy: 0, free: false, glow: null,
      boomR: 0, boomDmg: 0, variant: ((this._capSeq || 1) * 211) % 997,
      soft: false, blockMove: true, blockProj: true,
      side: t, team: t, owner: null, shotT: 0, aimAngle: 0,
      capTurret: true, pt: p
    };
    this.terrain.props.push(o);
    p.turret = o;
    FX.ring(p.x, p.y, 62, colOf(t), 5, 0.45);
    FX.burst(p.x, p.y - 24, 18, [colOf(t), "#fff"], { speed: 200 });
    FX.float(p.x, p.y - 86, "炮塔升起", colOf(t), 15);
    return o;
  };

  /** 据点易主：炮塔活着就换边（血量保留），已被拆掉则重新立一座 */
  B.captureSetTurret = function (p, team) {
    const t = team > 0 ? 1 : 0;
    const o = this.captureTurretOf(p);
    if (!o) { p.turret = null; return this.spawnCaptureTurret(p, t); }
    o.side = t; o.team = t;
    o.src = null;                 // towerSrc 缓存了 side/team，必须重建
    o._target = null;
    o.shotT = 0;
    FX.ring(p.x, p.y, 54, colOf(t), 4, 0.4);
    FX.float(p.x, p.y - 74, "炮塔转属" + nameOf(t), colOf(t), 14);
    return o;
  };

  /** 炮塔被拆：本局永久消失，不再自动重建（等下一次据点易主） */
  B.captureTurretBroken = function (o) {
    const p = o && o.pt;
    if (p && p.turret === o) p.turret = null;
    const x = o ? o.x : 0, y = o ? o.y : 0;
    FX.float(x, y - 86, "据点炮塔被摧毁", "#fbbf24", 17);
    if (this.ev) this.ev.push(["h", x, y - 86, "据点炮塔被摧毁", "#fbbf24"]);
  };

  B.updateCaptureTurrets = function (dt) {
    const st = this.capture;
    if (!st) return;
    const C = LD.CAPTURE || {}, cfg = C.turret || {};
    for (const p of st.pts) {
      const o = this.captureTurretOf(p);
      if (!o) continue;
      o.flash = Math.max(0, (o.flash || 0) - dt);
      o.shotT = Math.max(0, (o.shotT || 0) - dt);
      const range = p.r;                 // 射程 = 据点范围
      let best = null, bd = Infinity;
      for (const f of this.fighters) {
        if (f.kind !== "hero" || f.dead || f.bench) continue;
        if (teamOf(f) === o.side) continue;
        if ((f.stealthT || 0) > 0) continue;
        const d = Math.hypot(f.x - o.x, f.y - o.y);
        if (d <= range && d < bd) { bd = d; best = f; }
      }
      o._target = best;
      if (!best) continue;
      const oy = o.y - (o.elev || 70) * 0.5;
      o.aimAngle = Math.atan2(best.y - 26 - oy, best.x - o.x);
      if (o.shotT > 0) continue;
      o.shotT = cfg.atk || 1.05;
      const a = o.aimAngle, sp = cfg.projSpeed || 1100;
      const pr = this.spawnProj({
        x: o.x + Math.cos(a) * 20, y: oy + Math.sin(a) * 12,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        /* v4.11 据点炮塔伤害 ×turretDmgMul（原样照搬塔防数值偏疼，削到 80%） */
        r: 9, dmg: Math.round((cfg.dmg || 26) * (C.turretDmgMul == null ? 1 : C.turretDmgMul)), life: 2.2,
        owner: this.towerSrc(o),
        color: o.side === 0 ? "#fca5a5" : "#93c5fd", core: "#fff",
        type: "towerbolt", kindTag: "skill", trail: true,
        homing: cfg.homing || 3.4
      });
      if (pr && pr.data) pr.data.tgt = best;
      FX.burst(o.x + Math.cos(a) * 22, oy, 5, o.side === 0 ? "#fca5a5" : "#93c5fd", { speed: 120, dir: a });
    }
  };

  /* ==========================================================
   *  每帧：基地回血 / 占领读条 / 产分 / 结算
   * ========================================================== */
  B.updateCapture = function (dt) {
    const C = LD.CAPTURE || {};
    const st = this.capture;
    if (!st || st.done) return;
    const rate = C.capRate || 0.20, stack = C.stackMul != null ? C.stackMul : 1.0;
    const smax = C.stackMax || 3, decay = C.decay || 0.16;
    const contest = C.contestMul || 2.0;

    /* 自家基地缓慢回血（只有活着、站在自家圈里的英雄吃得到） */
    const healPct = C.baseHealPct || 0.05;
    const bases = [this.captureBase(0), this.captureBase(1)];
    for (const f of this.fighters) {
      if (f.kind !== "hero" || f.dead || f.bench) continue;
      const b = bases[teamOf(f)];
      if (Math.hypot(f.x - b.x, f.y - b.y) > b.r) continue;
      if (f.hp >= f.maxHp) continue;
      f.hp = Math.min(f.maxHp, f.hp + f.maxHp * healPct * dt);
      f.capHealAcc = (f.capHealAcc || 0) + dt;
      if (f.capHealAcc >= 1.0) {
        f.capHealAcc = 0;
        FX.float(f.x + rand(-8, 8), f.y - 62, "+" + Math.round(f.maxHp * healPct), "#4ade80", 12);
      }
    }

    for (const p of st.pts) {
      p.flash = Math.max(0, (p.flash || 0) - dt);
      let c0 = 0, c1 = 0;
      for (const f of this.fighters) {
        if (f.kind !== "hero" || f.dead || f.bench) continue;
        if (Math.hypot(f.x - p.x, f.y - p.y) > p.r) continue;
        if (f.team > 0) c1++; else c0++;
      }
      p.c0 = c0; p.c1 = c1;

      /* v4.10 据点回血：站在己方已占领的据点圈里，每秒回 5 滴血（鼓励占完守点） */
      if (p.owner >= 0 && (C.pointHeal || 0) > 0) {
        for (const f of this.fighters) {
          if (f.kind !== "hero" || f.dead || f.bench) continue;
          if ((f.team > 0 ? 1 : 0) !== p.owner) continue;
          if (Math.hypot(f.x - p.x, f.y - p.y) > p.r) continue;
          if (f.hp >= f.maxHp) continue;
          f.hp = Math.min(f.maxHp, f.hp + C.pointHeal * dt);
          f.capHealAcc = (f.capHealAcc || 0) + dt;
          if (f.capHealAcc >= 1.0) {
            f.capHealAcc = 0;
            FX.float(f.x + rand(-8, 8), f.y - 62, "+" + C.pointHeal, "#4ade80", 12);
          }
        }
      }

      /* v4.12 净值争夺：两队在圈里的人两两抵消，只有净多出来的那部分人在推进占领。
       * 例：2 红 1 蓝 → 按 1 个红队的人在抢；1v1 / 2v2 → 净值 0，冻结并回落。 */
      const net = c0 - c1;
      if (net !== 0) {
        const t = net > 0 ? 0 : 1;
        const n = Math.min(smax, Math.abs(net));
        if (p.owner === t) {
          /* 己方已经占着：把对方残留的进度退回去 */
          p.prog = Math.max(0, p.prog - decay * dt);
          if (p.prog <= 0.001) { p.prog = 0; p.by = -1; }
        } else {
          if (p.by !== t) { p.by = t; p.prog = 0; }
          /* 抢敌方已占的据点耗时 ×contest（×2 → 速度减半） */
          const mode = p.owner >= 0 ? 1 / contest : 1;
          /* 人数倍率：stack = 1.0 → 2 人 ×2 / 3 人 ×3（线性叠加） */
          p.prog += rate * mode * (1 + stack * (n - 1)) * dt;
          if (p.prog >= 1) {
            p.prog = 0; p.by = -1; p.owner = t; p.flash = 0.7;
            FX.ring(p.x, p.y, p.r * 0.9, t > 0 ? "rgba(96,165,250,.95)" : "rgba(248,113,113,.95)", 6, 0.55);
            FX.burst(p.x, p.y - 20, 26, [colOf(t), "#fff"], { speed: 240 });
            FX.float(p.x, p.y - 96, nameOf(t) + "占领 " + p.name, colOf(t), 19);
            this.ev.push(["h", p.x, p.y - 96, nameOf(t) + "占领 " + p.name, colOf(t)]);
            this.captureSetTurret(p, t);
          }
        }
      } else if (c0 === 0) {
        /* 圈里没人：已积累的进度缓慢回落 */
        p.prog = Math.max(0, p.prog - decay * dt);
        if (p.prog <= 0.001) { p.prog = 0; p.by = -1; }
      }
      /* net === 0 且 c0 > 0：双方人数相等 → 僵持，进度原地冻结（不推进也不回落） */
    }

    this.updateCaptureTurrets(dt);

    /* 产分：按 tick 节拍结算 */
    st.acc += dt;
    const tick = C.tick || 0.5;
    const rateS = C.scoreRate || 1;
    while (st.acc >= tick) {
      st.acc -= tick;
      for (const p of st.pts) {
        if (p.owner < 0) continue;
        st.score[p.owner] += rateS * p.w * tick;
      }
    }

    const need = C.need || 80;
    if (st.score[0] >= need || st.score[1] >= need) {
      this.captureFinish(st.score[0] >= need ? 0 : 1);
      return;
    }

    /* 限时：比分高者胜，同分比队伍剩余总血量 */
    this.roundT = (this.roundT || 0) - dt;
    if (this.roundT <= 0) {
      const s0 = st.score[0] || 0, s1 = st.score[1] || 0;
      let win;
      if (Math.abs(s0 - s1) > 1e-6) win = s0 > s1 ? 0 : 1;
      else {
        const hp = [0, 0];
        this.fighters.forEach(f => {
          if (f.kind !== "hero" || f.bench) return;
          hp[f.team > 0 ? 1 : 0] += Math.max(0, f.hp);
        });
        if (Math.abs(hp[0] - hp[1]) < 1e-6) win = -1;
        else win = hp[1] > hp[0] ? 1 : 0;
      }
      this.captureFinish(win);
    }
  };

  B.captureFinish = function (team) {
    const st = this.capture;
    if (!st || st.done) return;
    st.done = true;
    const winner = team < 0 ? null
      : (this.fighters.find(f => f.kind === "hero" && !f.bench && (f.team > 0 ? 1 : 0) === team) || null);
    const meF = this.hero(this.mySide == null ? 0 : this.mySide);
    this.matchWinner = winner ? winner.side : -1;
    if (winner) {
      LD.Cine.start(winner, "胜者：" + (winner.name || ("玩家" + (winner.side + 1))),
        "", team === 0 ? C_RED : C_BLUE, Math.round(st.score[team] || 0) + " 分");
    }
    this.finish(!!(meF && team >= 0 && (meF.team > 0 ? 1 : 0) === team));
  };

  /* ==========================================================
   *  渲染（世界坐标，ctx 已随摄像机平移）
   * ========================================================== */
  B.drawCapture = function (ctx) {
    const st = this.capture;
    if (!st) return;
    const t = this.t || 0;
    const pts = st.pts;

    /* 双方基地：淡色回血圈 + 队名 */
    [0, 1].forEach(tm => {
      const b = this.captureBase(tm);
      const col = colOf(tm);
      ctx.save();
      ctx.globalAlpha = 0.10 + Math.sin(t * 1.6 + tm) * 0.02;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([10, 12]); ctx.lineDashOffset = t * 10 * (tm ? -1 : 1);
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.75;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = col;
      ctx.font = "bold 18px system-ui,'Microsoft YaHei',sans-serif";
      ctx.fillText(nameOf(tm) + "基地 · 回血", b.x, b.y - b.r - 18);
      ctx.restore();
    });

    /* 据点之间的连线：让随机布局也一眼看得出「几个点」 */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 3;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    pts.forEach(p => {
      const col = p.owner >= 0 ? colOf(p.owner) : C_NEU;
      const contested = p.c0 > 0 && p.c1 > 0;
      /* v4.12 净值：把场内人数对比直接写出来，玩家一眼看得出谁在推进 */
      const netTxt = contested && p.c0 !== p.c1
        ? (p.c0 > p.c1 ? "红" : "蓝") + Math.max(p.c0, p.c1) + ":" + Math.min(p.c0, p.c1) + " "
        : "";
      const tur = this.captureTurretOf(p);
      ctx.save();

      /* 地面底色 */
      ctx.globalAlpha = (p.owner >= 0 ? 0.15 : 0.06) + Math.sin(t * 2 + p.i) * 0.03;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();

      /* 边界虚线 */
      ctx.globalAlpha = p.owner >= 0 ? 0.85 : 0.45;
      ctx.setLineDash([16, 10]); ctx.lineDashOffset = -t * 18;
      ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);

      /* 占领读条：从 12 点方向顺时针 */
      if (p.by >= 0 && p.prog > 0.001) {
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = colOf(p.by); ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r - 10, -Math.PI / 2, -Math.PI / 2 + TAU * p.prog);
        ctx.stroke();
        ctx.lineCap = "butt";
      }

      /* 占领瞬间的白圈 */
      if (p.flash > 0) {
        ctx.globalAlpha = Math.min(0.7, p.flash);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.06 - p.flash * 0.12), 0, TAU); ctx.stroke();
      }

      /* 旗杆 + 旗面：颜色即归属 */
      ctx.globalAlpha = p.owner >= 0 ? 0.85 : 0.35;
      ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(p.x, p.y + p.r * 0.52); ctx.lineTo(p.x, p.y + p.r * 0.52 - 54); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + p.r * 0.52 - 54);
      ctx.lineTo(p.x + 30, p.y + p.r * 0.52 - 44);
      ctx.lineTo(p.x, p.y + p.r * 0.52 - 34);
      ctx.closePath(); ctx.fill();

      /* 炮塔归属圈：塔体由地形层绘制，这里补一圈队色便于读出归属 */
      if (tur) {
        ctx.globalAlpha = 0.55 + Math.sin(t * 3) * 0.12;
        ctx.strokeStyle = colOf(tur.side); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(tur.x, tur.y + 4, 30, 0, TAU); ctx.stroke();
      }

      /* 字母 / 权重 / 争夺提示（有炮塔时抬高，别被塔体挡住） */
      const ny = tur ? -86 : -8;
      ctx.globalAlpha = 0.9;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 30px system-ui,'Microsoft YaHei',sans-serif";
      ctx.fillText(p.name, p.x, p.y + ny);
      if (p.w > 1) {
        ctx.font = "bold 16px system-ui,'Microsoft YaHei',sans-serif";
        ctx.fillStyle = colOf(p.owner >= 0 ? p.owner : 0);
        ctx.fillText("×" + p.w, p.x, p.y + ny + 30);
      }
      if (contested) {
        ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
        ctx.fillStyle = "#fde68a";
        ctx.fillText(netTxt + (netTxt ? "推进" : "僵持"), p.x, p.y + (tur ? 118 : (p.w > 1 ? 48 : 26)));
      }
      ctx.restore();
    });
  };
})(window.LD = window.LD || {});
