/* ============================================================
 *  47_escort.js — v4.5 护送情报箱（v4.10 推箱制重做）
 * ============================================================
 *  两队（红 0 / 蓝 1，分驻左右两端）：
 *    - 场中央反复投放一个 2x2 的大情报箱，箱子**不能抱起来**
 *    - 靠近按交互键进入推箱状态：箱子跟着人朝移动方向挪，推箱时移速 20%
 *    - 推箱时挨打 → 打断 + 眩晕 1 秒 + 3 秒内不能再碰箱子
 *    - 已有人在推时再按 = 「交互占用」；再按一次交互键 = 松手
 *    - 把箱子推进【敌方】交付点得 1 分；先到 3 分结束
 *    - 时间到比分高者胜，同分比队伍剩余总血量
 *
 *  实现要点：
 *    - 队伍只用 0 / 1：若房间没分队（team < 0），按座位奇偶补，避免同队互伤判定失效
 *    - 箱子是 B.escort.box 里的纯状态对象，不走 pickups（pickups 会被自动吃、有 26 秒寿命）
 *    - 推箱移速削减在 40_battle.js 的移动速度计算里单点乘 f.pushBox（不落持久字段）
 *    - 打断钩子挂在 B.damage 单点（escortBreakPush），和蓄力中断同一通道
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const C_RED = "#f87171", C_BLUE = "#60a5fa";
  const GOLD = "#fbbf24";

  /* ==========================================================
   *  开局：交付点 + 箱子 + 队伍归并 + 左右分驻
   * ========================================================== */
  B.initEscort = function () {
    const E = LD.ESCORT || {};
    const w = this.world.w, top = this.world.pt || 0;
    const cy = top + (this.world.h - top) / 2;
    const inset = E.goalInset || 220;
    this.escort = {
      score: [0, 0],
      box: { x: w / 2, y: cy, alive: true, pusher: null },
      respawnT: 0,
      dropT: 0,
      done: false
    };
    this.escortGoals = [
      { team: 0, x: inset, y: cy },
      { team: 1, x: w - inset, y: cy }
    ];
    this.fighters.forEach(f => {
      f.intel = false; f.pushBox = null; f.noBoxT = 0;
      f.escortRespawnT = E.heroRespawn || 3.0;     // v4.11 阵亡复活计时（每次阵亡递增）
      if (f.kind !== "hero") return;
      if (f.team == null || f.team < 0) f.team = f.side % 2;
      f.team = f.team > 0 ? 1 : 0;      // 本模式只有两队，2/3 号队并到蓝队
    });
    /* v4.10 阵营分驻左右两端：红队站左交付点一带，蓝队站右交付点一带 */
    const cnt = { 0: 0, 1: 0 };
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.bench) return;
      const t = f.team > 0 ? 1 : 0;
      const g = this.escortGoals[t];
      const k = cnt[t]++;
      const ang = -0.6 + k * 0.5 + (t ? Math.PI : 0);
      const rr = 120 + (k % 2) * 60;
      f.x = clamp(g.x + Math.cos(ang) * rr * (t ? -1 : 1), 60, w - 60);
      f.y = clamp(g.y + Math.sin(ang) * rr, top + 60, this.world.h - 60);
      if (this.terrain && !LD.Terrain.clearAt(this.terrain, f.x, f.y, 26)) {
        f.x = clamp(g.x + (t ? 150 : -150), 60, w - 60);
        f.y = g.y + (k - 1) * 70;
      }
    });
  };

  B.escortGoalOf = function (team) {
    const g = this.escortGoals || [];
    return g[team > 0 ? 1 : 0] || g[0] || null;
  };

  /* ==========================================================
   *  v4.11 阵亡复活点：本方交付点一带随机取一个不卡障碍的点
   *  （阵营分驻左右两端，复活也就落在自己那一侧，不至于一睁眼就在敌方人堆里）
   * ========================================================== */
  B.escortSpawn = function (f) {
    const E = LD.ESCORT || {};
    const top = this.world.pt || 0;
    const g = this.escortGoalOf(f.team > 0 ? 1 : 0);
    const base = g || { x: this.world.w / 2, y: top + (this.world.h - top) / 2 };
    const r = E.goalR || 110;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * TAU, rr = Math.random() * r * 1.15;
      const x = clamp(base.x + Math.cos(a) * rr, 60, this.world.w - 60);
      const y = clamp(base.y + Math.sin(a) * rr, top + 60, this.world.h - 60);
      if (!this.terrain || LD.Terrain.clearAt(this.terrain, x, y, 28)) return { x: x, y: y };
    }
    return { x: base.x, y: base.y };
  };

  /* ==========================================================
   *  推箱：开始 / 松手 / 被打断
   * ========================================================== */
  B.escortStartPush = function (f, box) {
    if (!f || f.dead || !box || !box.alive || box.pusher) return false;
    box.pusher = f;
    f.pushBox = box;
    FX.ring(box.x, box.y, 66, "rgba(251,191,36,.9)", 5, 0.45);
    FX.float(f.x, f.y - 72, "推箱中（移速 -80%，受击打断）", GOLD, 14);
    return true;
  };

  /** 松手（manual=true 是主动按交互键放下） */
  B.escortRelease = function (f, manual) {
    const box = f && f.pushBox;
    if (!box) return false;
    if (box.pusher === f) box.pusher = null;
    f.pushBox = null;
    if (manual) FX.float(f.x, f.y - 66, "松手了", "#9fb3dd", 13);
    return true;
  };

  /** 推箱时挨打：打断 + 眩晕 + 3 秒禁碰（B.damage 单点回调） */
  B.escortBreakPush = function (f, src) {
    const E = LD.ESCORT || {};
    if (!f || !f.pushBox) return;
    const box = f.pushBox;
    if (box.pusher === f) box.pusher = null;
    f.pushBox = null;
    f.stun = Math.max(f.stun || 0, E.stun || 1.0);
    f.noBoxT = E.noTouch || 3.0;
    FX.ring(f.x, f.y - 16, 70, "rgba(248,113,113,.9)", 5, 0.45);
    FX.float(f.x, f.y - 78, "推箱被打断！", "#f87171", 16);
    this.ev.push(["t", f.x, f.y - 78, "推箱被打断！", "#f87171"]);
  };

  /* ==========================================================
   *  每帧：推箱位移 / 交付 / 重生 / 计时
   * ========================================================== */
  B.updateEscort = function (dt) {
    const E = LD.ESCORT || {};
    const st = this.escort;
    if (!st || st.done) return;
    const b = st.box;
    st.dropT = Math.max(0, (st.dropT || 0) - dt);
    const boxHalf = (E.boxW || 80) / 2;
    const goalR = E.goalR || 110;

    /* 交互禁令统一倒数 */
    for (const f of this.fighters) {
      if (f.kind !== "hero") continue;
      if ((f.noBoxT || 0) > 0) f.noBoxT = Math.max(0, f.noBoxT - dt);
    }

    /* 推箱者失效（阵亡 / 下场 / 被晕）→ 松手 */
    if (b.pusher && (b.pusher.dead || b.pusher.bench || b.pusher.pushBox !== b)) {
      if (b.pusher.pushBox === b) b.pusher.pushBox = null;
      b.pusher = null;
    }
    if (b.pusher && (b.pusher.stun || 0) > 0) this.escortBreakPush(b.pusher, null);

    /* 交付后的重新投放 */
    if (!b.alive) {
      st.respawnT -= dt;
      if (st.respawnT <= 0) {
        b.x = this.world.w / 2;
        b.y = (this.world.pt || 0) + (this.world.h - (this.world.pt || 0)) / 2;
        b.alive = true; b.pusher = null;
        FX.ring(b.x, b.y, 90, "rgba(251,191,36,.9)", 5, 0.5);
        FX.float(b.x, b.y - 66, "情报箱已投放", GOLD, 15);
        this.ev.push(["h", b.x, b.y - 66, "情报箱已投放", GOLD]);
      }
    }

    /* 推箱位移：箱子挂在推手面前，跟着人的朝向走（人动箱动，人停箱停） */
    if (b.alive && b.pusher) {
      const f = b.pusher;
      const fc = f.facing || { x: 1, y: 0 };
      const off = f.r + boxHalf - 8;
      b.x = clamp(f.x + fc.x * off, boxHalf + 4, this.world.w - boxHalf - 4);
      b.y = clamp(f.y + fc.y * off, (this.world.pt || 0) + boxHalf + 4, this.world.h - boxHalf - 4);
      if (Math.random() < dt * 9) FX.trail(b.x + (Math.random() - 0.5) * boxHalf, b.y - boxHalf * 0.4, "#fde68a", 3, 0.3);
    }

    /* 交付：箱子被推进某队的交付点 → 得分的是「另一个队」（推进敌方交付点） */
    if (b.alive && b.pusher && st.dropT <= 0) {
      for (const g of (this.escortGoals || [])) {
        if (g.team === (b.pusher.team > 0 ? 1 : 0)) continue;   // 自己的圈不算
        if (dist(b, g) > goalR - boxHalf * 0.4) continue;
        const ti = b.pusher.team > 0 ? 1 : 0;
        const need = E.need || 3;
        st.score[ti] = (st.score[ti] || 0) + 1;
        const pf = b.pusher;
        if (pf) pf.pushBox = null;             // v4.10 交付后推箱状态一并解除
        b.alive = false; b.pusher = null;
        st.respawnT = E.respawn || 2.2;
        FX.ring(g.x, g.y - 20, 110, "rgba(74,222,128,.95)", 7, 0.6);
        FX.burst(g.x, g.y - 26, 24, ["#86efac", "#fff"], { speed: 210 });
        FX.float(g.x, g.y - 92, "情报交付 +1（" + st.score[ti] + "/" + need + "）", "#4ade80", 18);
        this.ev.push(["h", g.x, g.y - 92, "情报交付 +1", "#4ade80"]);
        if (st.score[ti] >= need) { this.escortFinish(ti); return; }
        break;
      }
    }

    /* 限时结算：分数高者胜；同分比队伍剩余总血量 */
    this.roundT = (this.roundT || 0) - dt;
    if (this.roundT <= 0) {
      const s0 = st.score[0] || 0, s1 = st.score[1] || 0;
      let win;
      if (s0 !== s1) win = s0 > s1 ? 0 : 1;
      else {
        const hp = [0, 0];
        this.fighters.forEach(f => {
          if (f.kind !== "hero" || f.bench) return;
          hp[f.team > 0 ? 1 : 0] += Math.max(0, f.hp);
        });
        if (Math.abs(hp[0] - hp[1]) < 1e-6) win = -1;      // 完全平局：判平
        else win = hp[1] > hp[0] ? 1 : 0;
      }
      this.escortFinish(win);
    }
  };

  B.escortFinish = function (team) {
    const st = this.escort;
    if (!st || st.done) return;
    st.done = true;
    const winner = team < 0 ? null
      : (this.fighters.find(f => f.kind === "hero" && !f.bench && (f.team > 0 ? 1 : 0) === team) || null);
    const meF = this.hero(this.mySide == null ? 0 : this.mySide);
    this.matchWinner = winner ? winner.side : -1;
    if (winner) {
      LD.Cine.start(winner, "胜者：" + (winner.name || ("玩家" + (winner.side + 1))),
        "", team === 0 ? C_RED : C_BLUE, (st.score[team] || 0) + " 分");
    }
    this.finish(!!(meF && team >= 0 && (meF.team > 0 ? 1 : 0) === team));
  };

  /* ==========================================================
   *  渲染（世界坐标，ctx 已随摄像机平移）
   * ========================================================== */
  B.drawEscort = function (ctx) {
    const E = LD.ESCORT || {};
    const st = this.escort;
    if (!st) return;
    const t = this.t || 0;
    const goalR = E.goalR || 110;

    /* 交付点：己方的圈（推进自己圈里没有用），用队伍色 + 缓慢呼吸 */
    (this.escortGoals || []).forEach(g => {
      const col = g.team === 0 ? C_RED : C_BLUE;
      const alive = this.fighters.some(f => f.kind === "hero" && !f.bench && !f.dead && (f.team > 0 ? 1 : 0) === g.team);
      ctx.save();
      ctx.globalAlpha = alive ? 0.16 + Math.sin(t * 2) * 0.04 : 0.06;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(g.x, g.y, goalR, 0, TAU); ctx.fill();
      ctx.globalAlpha = alive ? 0.85 : 0.35;
      ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(g.x, g.y, goalR, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      /* 圈心画一面小旗，指示「往这里推」 */
      ctx.globalAlpha = alive ? 0.55 : 0.28;
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(g.x, g.y + 22); ctx.lineTo(g.x, g.y - 26); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - 26); ctx.lineTo(g.x + 30, g.y - 16); ctx.lineTo(g.x, g.y - 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    /* 推箱者：脚下金色光环 + 指向敌方交付点的引导虚线 */
    const pusher = st.box && st.box.alive && st.box.pusher && !st.box.pusher.dead ? st.box.pusher : null;
    if (pusher) {
      const goal = this.escortGoalOf(pusher.team === 0 ? 1 : 0);
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(t * 5) * 0.16;
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(pusher.x, pusher.y - 6, 26, 13, 0, 0, TAU); ctx.stroke();
      if (goal) {
        ctx.globalAlpha = 0.28;
        ctx.setLineDash([10, 12]); ctx.lineDashOffset = -t * 34;
        ctx.beginPath(); ctx.moveTo(pusher.x, pusher.y - 23); ctx.lineTo(goal.x, goal.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    /* 地上的箱子：2x2 大木箱 */
    const b = st.box;
    if (b && b.alive) {
      const half = (E.boxW || 80) / 2;
      const bob = Math.sin(t * 3.4) * 3;
      const y = b.y + bob;
      ctx.save();
      /* 光柱 */
      const gr = ctx.createRadialGradient ? ctx.createRadialGradient(b.x, y, 8, b.x, y, half * 1.7) : null;
      if (gr && gr.addColorStop) {
        gr.addColorStop(0, "rgba(251,191,36,.30)");
        gr.addColorStop(1, "rgba(251,191,36,0)");
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(b.x, y, half * 1.7, 0, TAU); ctx.fill();
      }
      /* 箱体（2x2，画成有点高度的大箱子） */
      ctx.fillStyle = "#b45309"; ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.rect(b.x - half, y - half - 10, half * 2, half * 2 - 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(b.x - half, y - half - 10, half * 2, 14);
      ctx.fillStyle = "#fde68a";
      ctx.fillRect(b.x - 6, y - half - 10, 12, half * 2 - 4);            // 竖向绑带
      ctx.fillRect(b.x - half, y - 14, half * 2, 6);                      // 横向绑带
      /* 「情报」封条 */
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#7c2d12";
      ctx.fillRect(b.x - 22, y - 12, 44, 22);
      ctx.fillStyle = "#fde68a";
      ctx.font = "bold 13px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("情报", b.x, y);
      /* 推箱者高亮描边 */
      if (b.pusher) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]); ctx.lineDashOffset = -t * 30;
        ctx.strokeRect(b.x - half - 5, y - half - 15, half * 2 + 10, half * 2 + 6);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  };
})(window.LD = window.LD || {});
