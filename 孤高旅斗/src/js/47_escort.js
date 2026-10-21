/* ============================================================
 *  47_escort.js — v4.5 护送情报箱
 * ============================================================
 *  两队（红 0 / 蓝 1）：
 *    - 场中央反复投放情报箱，任何英雄走到箱子旁自动抱起（不用按键）
 *    - 抱箱者要把它送进【敌方】交付点圈，进圈即得 1 分
 *    - 抱箱期间移速 -8%（LD.ESCORT.speedMul），阵亡则箱子掉在原地
 *    - 先到 3 分结束；时间到比分高者胜，同分比队伍剩余总血量
 *
 *  实现要点：
 *    - 队伍只用 0 / 1：若房间没分队（team < 0），按座位奇偶补，避免同队互伤判定失效
 *    - 箱子是 B.escort.box 里的纯状态对象，不走 pickups（pickups 会被自动吃、有 26 秒寿命）
 *    - 移速削减在 40_battle.js 的移动速度计算里单点加 f.intel 判定，不乘进 speedMul
 *      （speedMul 是持久字段，反复乘会漂）
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const TAU = Math.PI * 2;

  const C_RED = "#f87171", C_BLUE = "#60a5fa";

  /* ==========================================================
   *  开局：交付点 + 箱子 + 队伍归并
   * ========================================================== */
  B.initEscort = function () {
    const E = LD.ESCORT || {};
    const w = this.world.w, top = this.world.pt || 0;
    const cy = top + (this.world.h - top) / 2;
    const inset = E.goalInset || 220;
    this.escort = {
      score: [0, 0],
      box: { x: w / 2, y: cy, alive: true },
      carried: false,          // true = 箱子在某个玩家手上（不对应「等待重生」）
      respawnT: 0,
      dropT: 0,
      done: false
    };
    this.escortGoals = [
      { team: 0, x: inset, y: cy },
      { team: 1, x: w - inset, y: cy }
    ];
    this.fighters.forEach(f => {
      f.intel = false;
      if (f.kind !== "hero") return;
      if (f.team == null || f.team < 0) f.team = f.side % 2;
      f.team = f.team > 0 ? 1 : 0;      // 本模式只有两队，2/3 号队并到蓝队
    });
  };

  B.escortGoalOf = function (team) {
    const g = this.escortGoals || [];
    return g[team > 0 ? 1 : 0] || g[0] || null;
  };

  /** 放下箱子（阵亡 / 手动） */
  B.escortDrop = function (f) {
    if (!this.escort) return;
    const E = LD.ESCORT || {};
    f.intel = false;
    const b = this.escort.box;
    b.x = f.x; b.y = f.y; b.alive = true;
    this.escort.carried = false;
    this.escort.dropT = E.protect != null ? E.protect : 0.8;
    FX.ring(f.x, f.y - 10, 46, "rgba(251,191,36,.9)", 4, 0.4);
    FX.float(f.x, f.y - 70, "情报箱掉落", "#fbbf24", 14);
  };

  /* ==========================================================
   *  每帧：拾取 / 交付 / 重生 / 计时
   * ========================================================== */
  B.updateEscort = function (dt) {
    const E = LD.ESCORT || {};
    const st = this.escort;
    if (!st || st.done) return;
    const b = st.box;
    st.dropT = Math.max(0, (st.dropT || 0) - dt);

    /* 交付后的重新投放（被抱在手上时 carried=true，不参与重生倒计时） */
    if (!b.alive && !st.carried) {
      st.respawnT -= dt;
      if (st.respawnT <= 0) {
        b.x = this.world.w / 2;
        b.y = (this.world.pt || 0) + (this.world.h - (this.world.pt || 0)) / 2;
        b.alive = true;
        FX.ring(b.x, b.y, 62, "rgba(251,191,36,.9)", 5, 0.5);
        FX.float(b.x, b.y - 58, "情报箱已投放", "#fbbf24", 15);
        this.ev.push(["h", b.x, b.y - 58, "情报箱已投放", "#fbbf24"]);
      }
    }

    const boxR = E.boxR || 58;
    const goalR = E.goalR || 110;
    const need = E.need || 3;
    for (const f of this.fighters) {
      if (f.kind !== "hero" || f.bench) continue;

      /* 持箱者阵亡 → 掉在原地（B.kill 之后状态才稳定，这里统一处理） */
      if (f.intel && f.dead) { this.escortDrop(f); continue; }

      /* 拾取：任何没箱子的活人都能捡，谁先贴上去算谁的 */
      if (b.alive && !f.intel && !f.dead && st.dropT <= 0 &&
          Math.hypot(f.x - b.x, f.y - b.y) <= boxR + f.r) {
        b.alive = false;
        f.intel = true;
        st.carried = true;                 // 箱子在手上：别触发重生分支，否则会凭空多出一个
        FX.ring(f.x, f.y - 20, 56, "rgba(251,191,36,.95)", 5, 0.45);
        FX.burst(f.x, f.y - 26, 12, ["#fde68a", "#fff"], { speed: 150 });
        FX.float(f.x, f.y - 76, "拿到情报箱！", "#fbbf24", 17);
        this.ev.push(["h", f.x, f.y - 76, "拿到情报箱！", "#fbbf24"]);
      }

      /* 交付：进入敌方交付点 */
      if (f.intel) {
        const goal = this.escortGoalOf(f.team === 0 ? 1 : 0);
        if (goal && Math.hypot(f.x - goal.x, f.y - goal.y) <= goalR) {
          f.intel = false;
          const ti = f.team > 0 ? 1 : 0;
          st.score[ti] = (st.score[ti] || 0) + 1;
          b.alive = false;
          st.carried = false;
          st.respawnT = E.respawn || 2.2;
          FX.ring(f.x, f.y - 20, 96, "rgba(74,222,128,.95)", 7, 0.6);
          FX.burst(f.x, f.y - 26, 20, ["#86efac", "#fff"], { speed: 210 });
          FX.float(f.x, f.y - 86, "交付成功 +1（" + st.score[ti] + "/" + need + "）", "#4ade80", 18);
          this.ev.push(["h", f.x, f.y - 86, "情报交付 +1", "#4ade80"]);
          if (st.score[ti] >= need) { this.escortFinish(ti); return; }
        }
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

    /* 交付点：己方的圈（站在自己圈里没有用），用队伍色 + 缓慢呼吸 */
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
      /* 圈心画一面小旗，指示「往这里送」 */
      ctx.globalAlpha = alive ? 0.55 : 0.28;
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(g.x, g.y + 22); ctx.lineTo(g.x, g.y - 26); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - 26); ctx.lineTo(g.x + 30, g.y - 16); ctx.lineTo(g.x, g.y - 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    /* 持箱者：脚下金色光环 + 头顶箱子标记 + 指向敌方交付点的引导虚线 */
    const carrier = this.fighters.find(f => f.kind === "hero" && f.intel && !f.dead);
    if (carrier) {
      const goal = this.escortGoalOf(carrier.team === 0 ? 1 : 0);
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(t * 5) * 0.16;
      ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(carrier.x, carrier.y - 6, 26, 13, 0, 0, TAU); ctx.stroke();
      if (goal) {
        ctx.globalAlpha = 0.28;
        ctx.setLineDash([10, 12]); ctx.lineDashOffset = -t * 34;
        ctx.beginPath(); ctx.moveTo(carrier.x, carrier.y - 23); ctx.lineTo(goal.x, goal.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    /* 地上的箱子 */
    const b = st.box;
    if (b.alive) {
      const bob = Math.sin(t * 3.4) * 4;
      const y = b.y + bob;
      ctx.save();
      /* 光柱 */
      const gr = ctx.createRadialGradient ? ctx.createRadialGradient(b.x, y, 4, b.x, y, 62) : null;
      if (gr && gr.addColorStop) {
        gr.addColorStop(0, "rgba(251,191,36,.34)");
        gr.addColorStop(1, "rgba(251,191,36,0)");
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(b.x, y, 62, 0, TAU); ctx.fill();
      }
      /* 箱体 */
      ctx.fillStyle = "#b45309"; ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.rect(b.x - 15, y - 19, 30, 24); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath(); ctx.rect(b.x - 15, y - 19, 30, 7); ctx.fill();
      ctx.fillStyle = "#fde68a";
      ctx.fillRect(b.x - 2.5, y - 19, 5, 24);          // 竖向绑带
      ctx.fillRect(b.x - 15, y - 8, 30, 3);            // 横向绑带
      ctx.restore();
    }
  };
})(window.LD = window.LD || {});
