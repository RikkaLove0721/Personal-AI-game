/* ============================================================
 *  49b_statue.js — v4.13 一二三木头人（重做）
 * ============================================================
 *  长跑道（1920 = 原长度 ×2），全员从最左跑到最右的终点线。
 *
 *  **没有坚守者实体**：取代它的是天上（地图右方天上）的监测者——
 *  不做实体，只保留一个伤害来源坐标（LD.STATUE.skyX / skyY）。
 *
 *  核心变化：**玩家无从得知监测者什么时候在观测**。
 *  没有任何预警信号、没有视野扇形、没有回头动作。观测发生时，
 *  所有还在移动的人会被天上打下来的光束命中，掉血 + 往左击退。
 *  于是唯一的情报来源就是「看别人有没有被打」——这是本模式的博弈点：
 *  看见有人被光束砸中，说明这一波正在观测；长时间风平浪静，说明可以贪几步。
 *
 *  掩体：**站在 blockMove 障碍左方 coverTiles 格内** = 监测死角，不会被打。
 *  场上还会刷新道具包，走近按 P 开包：回血 或 短暂提速。
 *
 *  被抓到只吃伤害与击退，**不退回到起点**（进度保留）。
 *  禁用普攻 / 技能 / 大招；P 键交互保留（开道具包）。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.STATUE || {};

  const C_GOLD = "#fbbf24", C_RED = "#f87171", C_SKY = "#fca5a5", C_DIM = "#7c8697";

  /* ---------------- 掩体 ---------------- */

  /**
   * 是否处在某个掩体左方的监测死角里：
   * 掩体在你右边、横向没隔太远、纵向大致对得上 → 天上的监测者照不到你。
   */
  B.statueCover = function (f) {
    const T = this.terrain, c = C();
    if (!T || !T.props || !f) return false;
    const span = (c.coverTiles || 2.4) * (c.coverCell || 44);
    for (let i = 0; i < T.props.length; i++) {
      const o = T.props[i];
      if (o.dead || !o.blockMove) continue;
      const hw = (o.w || 40) * 0.5, hh = (o.h || 40) * 0.5;
      const lx = o.x - hw;                              // 掩体左边缘
      if (f.x > lx) continue;                           // 必须在掩体左方
      if (lx - f.x > span) continue;                    // 隔太远就不算贴着掩体
      if (Math.abs(f.y - o.y) > hh + 26) continue;      // 纵向要大致对得上
      return true;
    }
    return false;
  };

  /** 找前方（右侧）最近的掩体，返回它的左边缘 x 与中心 y（AI 用它挑落脚点） */
  B.statueCoverAhead = function (f, maxAhead) {
    const T = this.terrain;
    if (!T || !T.props || !f) return null;
    const lim = maxAhead || 340;
    let best = null, bd = 1e9;
    for (let i = 0; i < T.props.length; i++) {
      const o = T.props[i];
      if (o.dead || !o.blockMove) continue;
      const hw = (o.w || 40) * 0.5, hh = (o.h || 40) * 0.5;
      const lx = o.x - hw;
      const ahead = lx - f.x;
      if (ahead < 20 || ahead > lim) continue;
      if (Math.abs(f.y - o.y) > hh + 120) continue;
      const d = Math.abs(ahead) + Math.abs(f.y - o.y) * 0.6;
      if (d < bd) { bd = d; best = { lx: lx, y: o.y }; }
    }
    return best;
  };

  /** v4.13h 绕障落脚点：贴墙的障碍物只能从「宽敞的那一侧」绕过去。
   *  返回 { x, y }（落脚点在障碍物左方、另一侧通道里）或 null。
   *
   *  为什么必须显式算：LD.AI.steer 只往前探 70px 做局部避让。遇到贴着上墙的障碍物，
   *  上方根本没有路，它算出来的「能走的方向」往往是**朝后**——人机于是贴着障碍物
   *  来回晃，看上去就是「卡在障碍物后面不敢前进」。这里直接给出一个能绕过去的点，
   *  人手一个明确的目标，问题就没了。 */
  B.statueBypass = function (f) {
    const T = this.terrain, w = this.world;
    if (!T || !T.props || !f) return null;
    const c = C();
    const pt = w.pt || 96, botY = w.h - 34, r = f.r || 16;
    let best = null, bx = 300;
    for (let i = 0; i < T.props.length; i++) {
      const o = T.props[i];
      if (o.dead || !o.blockMove) continue;
      const hw = (o.w || 40) * 0.5, hh = (o.h || 40) * 0.5;
      const gap = (o.x - hw) - f.x;                       // 左边缘还差多远
      if (gap > bx) continue;                             // 太远，不是眼前这块
      if (gap < -hw - 24) continue;                       // 已经整个甩到身后了
      if (Math.abs(f.y - o.y) > hh + r + 10) continue;    // 高度上挡不住我
      bx = gap; best = { o: o, hw: hw, hh: hh };
    }
    if (!best) return null;
    const o = best.o;
    const pad = r + (c.aiBypassPad || 26);
    const upY = o.y - best.hh - pad, dnY = o.y + best.hh + pad;
    const upRoom = upY - (pt + 22), dnRoom = botY - dnY;
    const upOk = upRoom > 8, dnOk = dnRoom > 8;
    if (!upOk && !dnOk) return null;                      // 真堵死了：交给下面的兜底
    /* x 只往前给：不许为了绕障往回退（退回去就等于又得重跑） */
    const tx = clamp(o.x - best.hw - (c.aiBypassBack || 24), f.x + 6, f.x + 180);
    /* v4.13h：落脚点必须在空地上！否则会出现「绕障点算在另一块障碍物里面」，
     * 人机朝着那面墙一路使劲，看上去就是彻底卡死。沿着绕行方向继续往外挪，直到空地。 */
    const T2 = this.terrain, br = r + 6;
    const clear = (y) => !(LD.Terrain.clearAt && T2) || LD.Terrain.clearAt(T2, tx, y, br);
    const sides = (dnOk && (!upOk || dnRoom > upRoom)) ? [dnY, upY] : [upY, dnY];
    for (let i = 0; i < sides.length; i++) {
      const y0 = sides[i];
      const sgn = y0 > o.y ? 1 : -1;
      for (let k = 0; k <= 6; k++) {
        const y = clamp(y0 + sgn * k * (c.aiLaneStep || 34), pt + 26, botY);
        if (clear(y)) return { x: tx, y: y };
      }
    }
    return null;
  };

  /* ---------------- 道具包 ---------------- */

  B.statueSpawnPack = function () {
    const st = this.statue, c = C(), w = this.world;
    if (!st) return null;
    const x = rnd((c.startX || 82) + 150, (c.finishX || 1838) - 120);
    const y = rnd(w.pt + 60, w.h - 70);
    if (this.terrain && LD.Terrain.clearAt && !LD.Terrain.clearAt(this.terrain, x, y, 26)) return null;
    const p = { x: x, y: y, t: 0, bob: rnd(0, TAU) };
    st.packs.push(p);
    FX.ring(x, y, 40, "rgba(129,140,248,.85)", 4, 0.45);
    return p;
  };

  /** 找身边够得着的道具包（净距判定，和通用交互一个口径） */
  B.statueNearPack = function (f, extra) {
    const st = this.statue, c = C();
    if (!st || !f) return null;
    const R = (c.packR || 36) + (extra || 0);
    let best = null, bd = 1e9;
    for (let i = 0; i < st.packs.length; i++) {
      const p = st.packs[i];
      const d = Math.hypot(p.x - f.x, p.y - f.y) - (f.r || 16);
      if (d > R) continue;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  /** 开包：一半概率回血、一半概率短暂提速 */
  B.statueOpenPack = function (f, p) {
    const st = this.statue, c = C();
    if (!st || !f || !p) return false;
    const i = st.packs.indexOf(p);
    if (i < 0) return false;
    st.packs.splice(i, 1);
    if (Math.random() < 0.5 || f.hp >= f.maxHp) {
      const heal = Math.min(c.packHeal || 80, f.maxHp - f.hp);
      f.hp = Math.min(f.maxHp, f.hp + (c.packHeal || 80));
      FX.float(f.x, f.y - 78, "+" + Math.round(heal), "#7ff0c4", 18);
      this.ev.push(["h", f.x, f.y - 78, "+" + Math.round(heal), "#7ff0c4"]);
    } else {
      f.statueSpdT = c.packSpdT || 5.0;
      FX.float(f.x, f.y - 78, "加速！", "#7dd3fc", 18);
      this.ev.push(["t", f.x, f.y - 78, "加速！", "#7dd3fc"]);
    }
    FX.burst(p.x, p.y, 14, ["#a5b4fc", "#fff"], { speed: 220 });
    if (LD.Audio && LD.Audio.beep) LD.Audio.beep(760, 0.1, "triangle", 0.05);
    return true;
  };

  /* ---------------- 天的监测者：一次观测结算 ---------------- */

  /** 结算一波观测：所有还在移动、又没躲在掩体左方的人 → 掉血 + 往左击退 */
  B.statueStrike = function () {
    const st = this.statue, c = C();
    if (!st) return 0;
    const alive = this.casualAlive();
    let n = 0;
    for (let i = 0; i < alive.length; i++) {
      const f = alive[i];
      if (f.statueDone) continue;
      /* 「在动」= 正在按方向键；被击退途中（knockLeft > 0）不算主动移动，避免连锁挨打 */
      const knock = (f.knockLeft || 0) > 0;
      const moving = !!f.moving || (!knock && Math.hypot(f.vx || 0, f.vy || 0) > 130);
      if (!moving) continue;
      if (B.statueCover.call(this, f)) {
        FX.float(f.x, f.y - 96, "掩体挡住了", "#9fb3dd", 13);
        continue;
      }
      const d = this.casualHurt(f, c.scanDmg || 26, {
        color: C_SKY, text: "监测 -", size: 17, dy: 84,
        kb: c.scanKb || 250, kbx: c.skyX || 1900, kby: c.skyY || 110
      });
      if (d > 0) {
        n++;
        st.beams.push({ x: f.x, y: f.y - 26, t: 0.38 });
        FX.burst(f.x, f.y - 26, 12, [C_SKY, "#fff"], { speed: 240 });
        FX.shake(3);
      }
    }
    if (n > 0) {
      st.lastHitT = st.clock;
      st.hitCount++;
      if (LD.Audio && LD.Audio.beep) LD.Audio.beep(240, 0.14, "sawtooth", 0.05);
    }
    return n;
  };

  /* ---------------- 初始化 / 主循环 ---------------- */

  /** 复活点：保留 x 进度（被抓到只吃伤害，绝不退回起点） */
  B.statueSpot = function (f) {
    const c = C(), w = this.world;
    const x = clamp((f.statueX != null ? f.statueX : f.x) - 26, c.startX || 82, (c.finishX || 1838) - 40);
    return { x: x, y: rnd(w.pt + 50, w.h - 60) };
  };

  B.initStatue = function () {
    const c = C(), w = this.world;
    /* 地形按本模式的尺寸生成过，先清掉越界的，再抽稀留一批当掩体（掩体现在是核心机制，多留点） */
    this.casualThinProps(0.55);
    /* v4.13f：**可推动的障碍物在这一律不许出现**。
     * 掩体是这模式的命根子（站在障碍左边 = 监测死角），而可推动的轮胎 / 箱子 / 汽车
     * 就是「随身携带的掩体」——推着走等于永远无敌。整类清掉，一了百了。 */
    if (this.terrain && this.terrain.props) {
      const TT = (LD.TERRAIN && LD.TERRAIN.types) || {};
      const keep = [];
      for (let i = 0; i < this.terrain.props.length; i++) {
        const o = this.terrain.props[i], def = TT[o.kind];
        if (def && def.pushable) continue;
        keep.push(o);
      }
      this.terrain.props.length = 0;
      keep.forEach(o => this.terrain.props.push(o));
    }
    const alive = this.casualAlive();
    /* 起跑线：全部塞在最左侧，纵向均分 */
    const top = w.pt + 60, bot = w.h - 60;
    const pts = alive.map((f, i) => ({
      x: (c.startX || 82),
      y: top + (bot - top) * (alive.length > 1 ? i / (alive.length - 1) : 0.5)
    }));
    this.casualPlace(pts, alive);
    alive.forEach(f => {
      f.statueX = f.x; f.statueDone = false;
      f.statueBold = rnd(0.35, 0.95);       // 胆子：越大越敢贪步
      f.statueSpdT = 0;
      f.stMode = "stop"; f.stT = rnd(0.3, 1.2); f.stSeen = -99; f.stTx = f.x; f.stTy = f.y;
    });

    this.statue = {
      phase: "idle",          // idle = 没在观测；scan = 正在观测（玩家看不见这个状态）
      t: 2.6,                 // 开局先给 2.6 秒，让玩家看清场面
      tickT: 0,
      clock: 0,               // 本模式自己的秒表（AI 判断「多久没人被打」用）
      lastHitT: -99,          // 最近一次有人被击中的时刻
      hitCount: 0,
      round: 0,
      packs: [],
      packT: 4.5,
      beams: []
    };
    FX.float(w.w * 0.5, w.pt + 40, "预备——跑！", C_GOLD, 20);
  };

  B.updateStatue = function (dt) {
    const st = this.statue, c = C();
    if (!st) return;
    const alive = this.casualAlive();
    st.clock += dt;

    /* 提速包计时 */
    for (let i = 0; i < alive.length; i++) {
      const f = alive[i];
      if (f.statueSpdT > 0) f.statueSpdT = Math.max(0, f.statueSpdT - dt);
    }

    /* 到达终点线 → 直接赢下这一局 */
    for (let i = 0; i < alive.length; i++) {
      const f = alive[i];
      f.statueX = Math.max(f.statueX || 0, f.x);
      if (!f.statueDone && f.x >= (c.finishX || 1838)) {
        f.statueDone = true;
        FX.burst(f.x, f.y - 30, 30, [C_GOLD, "#fff"], { speed: 300 });
        if (LD.Audio && LD.Audio.beep) LD.Audio.beep(880, 0.16, "triangle", 0.06);
        this.casualWin(f, "冲线！");
        return;
      }
    }

    /* 命中光束的残留表现 */
    for (let i = st.beams.length - 1; i >= 0; i--) {
      st.beams[i].t -= dt;
      if (st.beams[i].t <= 0) st.beams.splice(i, 1);
    }

    /* 道具包刷新 */
    st.packT -= dt;
    if (st.packT <= 0) {
      st.packT = c.packEvery || 8.5;
      if (st.packs.length < (c.packMax || 5)) this.statueSpawnPack();
    }

    /* ---- 观测状态机：全程没有任何对外提示 ---- */
    st.t -= dt;
    if (st.phase === "idle") {
      if (st.t <= 1e-6) {
        st.phase = "scan";
        st.t = rnd(c.scanMin || 0.85, c.scanMax || 1.5);
        st.tickT = 0;          // 观测的第一帧就先结算一次
        st.round++;
      }
      return;
    }
    /* scan：每隔 scanTick 结算一次——立刻停手的人只吃一发，硬闯的会连吃好几发 */
    st.tickT -= dt;
    if (st.tickT <= 1e-6) {
      this.statueStrike();
      st.tickT = c.scanTick || 0.40;
    }
    if (st.t <= 1e-6) {
      st.phase = "idle";
      st.t = rnd(c.idleMin || 2.4, c.idleMax || 4.6);
    }
  };

  B.statueTimeUp = function () {
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if ((f.statueX || f.x) > (w.statueX || w.x)) w = f; });
    this.casualWin(w, "时间到·跑得最远");
  };

  /* ---------------- P 键 / 移速钩子 ---------------- */

  LD.RULE_SPD.statue = function () { return (LD.STATUE && LD.STATUE.speedMul) || 0.7; };
  LD.RULE_INTERACT.statue = function (f) {
    const p = B.statueNearPack.call(this, f, 0);
    if (!p) return false;
    return B.statueOpenPack.call(this, f, p);
  };
  LD.RULE_LABEL.statue = function (f) {
    return B.statueNearPack.call(this, f, 0) ? "开启道具包" : "";
  };

  /* ---------------- 渲染 ---------------- */

  B.drawStatue = function (ctx) {
    const st = this.statue, c = C(), w = this.world;
    if (!st) return;
    const skyX = c.skyX || 1900, skyY = c.skyY || 110;

    /* 掩体死角提示：每个障碍左方铺一层暗色阴影，告诉玩家「站这儿安全」 */
    const T = this.terrain;
    if (T && T.props) {
      const span = (c.coverTiles || 2.4) * (c.coverCell || 44);
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#38bdf8";
      for (let i = 0; i < T.props.length; i++) {
        const o = T.props[i];
        if (o.dead || !o.blockMove) continue;
        const hw = (o.w || 40) * 0.5, hh = (o.h || 40) * 0.5;
        ctx.fillRect(o.x - hw - span, o.y - hh, span, hh * 2);
      }
      ctx.restore();
    }

    /* 起跑线 / 终点线 */
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.moveTo(c.startX || 82, w.pt); ctx.lineTo(c.startX || 82, w.h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = C_GOLD; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(c.finishX || 1838, w.pt); ctx.lineTo(c.finishX || 1838, w.h); ctx.stroke();
    ctx.fillStyle = C_GOLD;
    ctx.font = "bold 13px system-ui,'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("终点", (c.finishX || 1838), w.pt + 26);
    ctx.restore();

    /* 天上的监测者：只是一个静态标记（不做实体、不暴露状态） */
    ctx.save();
    ctx.translate(skyX, skyY);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = C_DIM; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = C_RED;
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = C_DIM;
    ctx.font = "11px system-ui,'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("监测者", 0, 19);
    ctx.restore();

    /* 道具包 */
    ctx.save();
    st.packs.forEach(p => {
      const bob = Math.sin(this.t * 3 + p.bob) * 3;
      const y = p.y + bob;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#1e293b";
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 12, 17, 6, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#6366f1";
      ctx.fillRect(p.x - 14, y - 12, 28, 24);
      ctx.fillStyle = "#a5b4fc";
      ctx.fillRect(p.x - 14, y - 12, 28, 6);
      ctx.strokeStyle = "#312e81"; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 14, y - 12, 28, 24);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("P", p.x, y);
    });
    ctx.restore();

    /* 命中光束：从右上方斜插下来（这是玩家唯一能读到的「有人在动」的信号） */
    ctx.save();
    st.beams.forEach(bm => {
      const k = clamp(bm.t / 0.38, 0, 1);
      ctx.globalAlpha = k;
      ctx.strokeStyle = C_SKY;
      ctx.lineWidth = 3 + 7 * k;
      ctx.beginPath();
      ctx.moveTo(bm.x + 170, bm.y - 240);
      ctx.lineTo(bm.x, bm.y);
      ctx.stroke();
      ctx.globalAlpha = k * 0.55;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5 + 2 * k;
      ctx.beginPath();
      ctx.moveTo(bm.x + 170, bm.y - 240);
      ctx.lineTo(bm.x, bm.y);
      ctx.stroke();
    });
    ctx.restore();

    /* 躲在掩体死角里的自己人：头顶挂个「掩体」标记 */
    ctx.save();
    ctx.font = "bold 11px system-ui,'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const alive = this.casualAlive();
    for (let i = 0; i < alive.length; i++) {
      const f = alive[i];
      if (!B.statueCover.call(this, f)) continue;
      ctx.fillStyle = "rgba(56,189,248,.9)";
      ctx.fillText("掩体", f.x, f.y - 52);
    }
    ctx.restore();

    /* 顶部状态条：刻意不给任何「现在是否在观测」的提示 */
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    ctx.fillStyle = C_DIM;
    ctx.fillText("它什么时候在看？——看别人有没有被打", w.w * 0.5, w.pt + 14);
    ctx.restore();
  };

  /* ---------------- 人机 ----------------
   * 行为完全照需求来：
   *   1) 随机前进一点 → 停下
   *   2) 看到有人被光束命中 → 等一会儿再前进一点 → 再停下
   *   3) 很久都没人被打 → 主动前进（不再干等）
   * 顺路会拐去捡道具包；前进时优先挑「掩体左方」当落脚点。 */
  LD.casualAI.statue = function (f, dt, ctrl) {
    const st = B.statue, c = LD.STATUE || {};
    ctrl.press = ctrl.press || {};
    if (!st || f.statueDone) { ctrl.mx = 0; ctrl.my = 0; return; }
    if (f.stMode == null) {
      f.stMode = "stop"; f.stT = rnd(0.3, 1.2); f.stSeen = -99; f.stTx = f.x; f.stTy = f.y;
    }

    /* 站着不动按 P 开包是零风险的——够得着就开 */
    if (B.statueNearPack.call(B, f, 0)) ctrl.press.interact = true;

    /* 看到有人被击中 → 说明这波正在观测，先停手，过一会儿再动 */
    if (st.lastHitT > (f.stSeen || -99)) {
      f.stSeen = st.lastHitT;
      const bold = f.statueBold != null ? f.statueBold : 0.6;
      f.stMode = "stop";
      f.stT = rnd(c.aiWaitMin || 0.40, c.aiWaitMax || 1.05) * (1.15 - 0.35 * bold);
    }

    /* v4.13g **修「人机躲在障碍物后面不敢前进」**：
     * 旧版这里每次都挑「前方最近掩体的左边缘再往左 30px」当目标。只要人机停下时
     * 正好站在掩体左边 30px 处，下一轮算出来的目标就等于它脚下（差 0~30px < 到达阈值 24），
     * 于是「到达 → 停 0.2 秒 → 再规划 → 还是脚下」无限循环，一辈子卡在同一个障碍物后面。
     * 现在拆成两条铁律：
     *   1) 目标点**必须真的在前面**（至少 aiMinAhead），掩体只是「顺路蹭一下」的加分项；
     *   2) 只有「蹭到就能继续往前走」的掩体才值得去（比脚下远 aiMinAhead 以上）。 */
    const plan = (noCover) => {
      const pt = B.world.pt || 96;
      const ahead = c.aiMinAhead || 80;
      /* 终点要瞄准线**后面**一点：旧版写 finishX-10，AI 走到线前 10px 就当成「到了」，
       * 而通关判定是 x >= finishX —— 人机会永远停在终点线前 10 像素处不动。 */
      const finish = (c.finishX || 1838) + 8;
      /* 顺路的道具包优先 */
      let pk = null, pd = 1e9;
      for (let i = 0; i < st.packs.length; i++) {
        const p = st.packs[i];
        if (p.x < f.x + 20) continue;
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        if (d > 330 || d >= pd) continue;
        pd = d; pk = p;
      }
      if (pk) { f.stTx = pk.x; f.stTy = pk.y; return; }
      /* 默认：闷头往右挪一段 */
      let tx = Math.min(f.x + rnd(c.aiStepMin || 150, c.aiStepMax || 320), finish);
      let ty = clamp(f.y + rnd(-45, 45), pt + 55, B.world.h - 55);
      /* 掩体：只有「明显在前方」才拐过去蹭一下，且不是每次都蹭（不然一路掩体一路停） */
      if (!noCover) {
        const cv = B.statueCoverAhead.call(B, f, 340);
        if (cv && (cv.lx - 34) > f.x + ahead && Math.random() < (c.aiCoverBias || 0.45)) {
          tx = cv.lx - 34;
          ty = clamp(cv.y, pt + 55, B.world.h - 55);
        }
      }
      /* 铁律：不管走哪条分支，目标都必须真的在前面 */
      if (tx < f.x + ahead) tx = Math.min(f.x + ahead, finish);
      /* v4.13h：目标点不能落在障碍物里面（落进去就等于「走不到」，
       * 人机会一直朝着那面墙使劲）。上下挪到最近的空档。 */
      const T = B.terrain;
      const br = (f.r || 16) + 6;
      if (T && LD.Terrain.clearAt && !LD.Terrain.clearAt(T, tx, ty, br)) {
        const lo = pt + 26, hi = B.world.h - 40;
        let fixed = false;
        for (let k = 1; k <= 8 && !fixed; k++) {
          for (let s2 = 0; s2 < 2 && !fixed; s2++) {
            const ny = ty + (s2 ? -1 : 1) * k * (c.aiLaneStep || 34);
            if (ny < lo || ny > hi) continue;
            if (LD.Terrain.clearAt(T, tx, ny, br)) { ty = ny; fixed = true; }
          }
        }
      }
      f.stTx = tx; f.stTy = ty;
    };

    /* v4.13h 兜底：被夹在两块障碍物之间的窄缝里、前后都过不去时就**先退回去**。
     * 以前这种地形里的表现是「面朝障碍物一直按前进」，玩家看到的就是一动不动卡在障碍物后面。 */
    if (f.stMode === "retreat") {
      const rdx = f.stTx - f.x, rdy = f.stTy - f.y;
      f.stT -= dt;
      if (Math.hypot(rdx, rdy) < 20 || f.stT <= 0) {
        f.stMode = "stop"; f.stT = rnd(c.aiStopMin || 0.14, c.aiStopMax || 0.40);
      } else {
        const s = LD.AI.steer(f, rdx, rdy, null);
        ctrl.mx = s.x; ctrl.my = s.y;
        if (Math.abs(s.x) < 1 && Math.abs(s.y) < 1) ctrl.my = rdy >= 0 ? 1 : -1;
        return;
      }
    }

    if (f.stMode === "run") {
      const dx = f.stTx - f.x, dy = f.stTy - f.y;
      if (Math.hypot(dx, dy) < 24) { f.stMode = "stop"; f.stT = rnd(c.aiStopMin || 0.14, c.aiStopMax || 0.40); }
      else {
        const s = LD.AI.steer(f, dx, dy, null);
        ctrl.mx = s.x; ctrl.my = s.y;
        /* v4.13h **「障碍物贴墙时人机卡在后面」的真正原因**：
         * steer 只往前探 70px 做局部避让。障碍物贴着上/下墙时，另一侧才是唯一的路，
         * 而 70px 的探测距离看不到那条路，于是它给出的「安全方向」经常是**朝后**。
         * 人机于是在障碍物左边缘来回晃，永远过不去（玩家看到的「卡在障碍物后面」）。
         * 对策：目标在前方时一律不许倒退；被挡住就顺着障碍物滑向宽敞的那一侧。 */
        if (f.stTx > f.x + 10 && ctrl.mx < 0) {
          const bp = B.statueBypass.call(B, f);
          ctrl.mx = 0;
          ctrl.my = bp ? (bp.y - f.y) : (f.y > (B.world.pt + B.world.h) * 0.5 ? -1 : 1);
          if (!ctrl.my) ctrl.my = f.y > (B.world.pt + B.world.h) * 0.5 ? -1 : 1;
          if (ctrl.my < 0 && f.y <= (B.world.pt || 96) + 40) ctrl.my = 1;   // 顶到墙了就别再往上
        }
        f.stT -= dt;
        /* v4.13g 防卡死：跑了一会儿却几乎没往右挪（顶着障碍物绕不过去）→ 立刻换目标，
         * 这次不许惦记掩体，纯往前走。以前这种时候 AI 会一直贴着障碍物磨到这一趟跑完。 */
        if (f.x > (f.stLastX == null ? -1e9 : f.stLastX) + 6) {
          f.stLastX = f.x; f.stStall = 0; f.stStuckN = 0;
        }
        else {
          f.stStall = (f.stStall || 0) + dt;
          if (f.stStall > (c.aiStallT || 1.1)) {
            f.stStall = 0; f.stLastX = f.x;
            f.stStuckN = (f.stStuckN || 0) + 1;
            /* 绕了好几次还是过不去（典型：被夹在两块贴墙障碍之间的窄缝里）→ 退回去重来 */
            if (f.stStuckN >= (c.aiStuckMax || 3)) {
              f.stStuckN = 0;
              f.stMode = "retreat";
              f.stT = c.aiRetreatT || 1.4;
              const midY = ((B.world.pt || 96) + B.world.h) * 0.5;
              f.stTx = Math.max(f.x - (c.aiRetreatD || 90), 40);
              f.stTy = clamp(f.y + (f.y > midY ? -1 : 1) * 100, (B.world.pt || 96) + 40, B.world.h - 44);
              return;
            }
            /* v4.13h：先试「绕障落脚点」（贴墙的障碍物只有这一条活路），
             * 没有可绕的障碍才退回「忽略掩体、闷头往前」。 */
            const bp = B.statueBypass.call(B, f);
            if (bp) { f.stTx = bp.x; f.stTy = bp.y; }
            else plan(true);
            f.stT = Math.max(f.stT, c.aiBypassT || 1.2);
            const s2 = LD.AI.steer(f, f.stTx - f.x, f.stTy - f.y, null);
            ctrl.mx = s2.x; ctrl.my = s2.y;
            if (f.stTx > f.x + 10 && ctrl.mx < 0) { ctrl.mx = 0; ctrl.my = (f.stTy - f.y) || 1; }
          }
        }
        if (f.stT <= 0) { f.stMode = "stop"; f.stT = rnd(c.aiStopMin || 0.14, c.aiStopMax || 0.40); }
        return;
      }
    }

    /* stop：一动不动（这就是「木头人」）
     * v4.13f：把「风平浪静就主动前进」的门槛压得更低、加速更猛，
     * 并且停的时间缩短 —— 以前 AI 大半时间在发呆，玩家一路小跑就到终点了。 */
    const quiet = (st.clock - st.lastHitT) > (c.aiQuiet || 3.0);
    f.stT -= dt * (quiet ? (c.aiQuietMul || 3.0) : 1);
    if (f.stT <= 0) {
      plan();
      f.stMode = "run";
      f.stT = rnd(c.aiRunMin || 0.80, c.aiRunMax || 1.90);
      f.stLastX = f.x; f.stStall = 0;
      const s = LD.AI.steer(f, f.stTx - f.x, f.stTy - f.y, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      /* v4.13h：同上，目标在前方就不许被局部避让带着往回走 */
      if (f.stTx > f.x + 10 && ctrl.mx < 0) {
        const bp = B.statueBypass.call(B, f);
        ctrl.mx = 0;
        ctrl.my = bp ? (bp.y - f.y) : (f.y > (B.world.pt + B.world.h) * 0.5 ? -1 : 1);
        if (!ctrl.my) ctrl.my = f.y > (B.world.pt + B.world.h) * 0.5 ? -1 : 1;
      }
      return;
    }
    ctrl.mx = 0; ctrl.my = 0;
  };
})(window.LD = window.LD || {});
