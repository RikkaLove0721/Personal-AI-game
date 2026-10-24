/* ============================================================
 *  49_hotpotato.js — v4.11 烫手山芋
 * ============================================================
 *  混战：普攻 / 技能 / 大招全部禁用，全场只剩一件事——把山芋甩给别人。
 *    - 开局随机抽一个人：先给 warn 秒预警（他头顶有红圈），随后山芋
 *      从高空锁定飞到他头上（飞行 drop 秒，期间甩不掉）
 *    - 刚接手的人 slowT 秒内减速到 slowMul，且这段时间**传不出去**
 *    - 熬过 slowT 后速度变成 boostMul（比别人快），用来追人甩锅
 *    - 碰到别人就把山芋甩给他，对方同样吃 slowT 秒减速
 *    - 从山芋落到第一个人手上开始 fuse 秒倒计时，到点爆炸：
 *      持有者 -(holderBase + 存活人数 × holderPerAlive)，小范围内其他人 -splashDmg
 *    - v4.12 引信逐轮加速：第 1 轮 fuse 秒，此后每个新山芋 −fuseStep 秒
 *      （30 → 25 → 20 → 15），降到 fuseMin 后固定在该值
 *    - 炸完重新抽人、重新计时，循环；血空的人出局，最后一个站着的赢
 *
 *  实现要点：
 *    - 全员 team = -1（同队互不伤害），所以传递**不走** B.damage：
 *      那会被 sameTeam 直接挡掉，只能手动扣血。
 *    - 每帧先把所有人 hotMul 清零，再由当前持有者写入，保证「一换手
 *      立刻失效」，不会有人永久带着减速 / 加速跑。
 *    - 山芋坐标存在 B.potato.x / y 上，传递判定与渲染共用同一份。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  const C_GOLD = "#fbbf24", C_HOT = "#f97316", C_SKIN = "#c08552";

  const cfg = () => LD.HOTPOTATO || {};
  const C = cfg();

  /* 山芋挂在头顶的高度 */
  const RIDE_Y = 62;

  /* v4.12 本轮引信时长：第 1 轮 fuse 秒，之后每轮 −fuseStep，下限 fuseMin。
   * 例：30 → 25 → 20 → 15 → 15 → ...  （round 从 1 起算） */
  const potatoFuse = function () {
    const base = C.fuse || 30;
    const step = C.fuseStep || 0;
    const min = C.fuseMin != null ? C.fuseMin : base;
    const r = Math.max(1, (B.potato && B.potato.round) || 1);
    return Math.max(min, base - step * (r - 1));
  };

  /* v4.12 持有者伤害：base + 场上存活人数 × per。
   * 人越多炸得越疼，逼玩家别磨到最后——只剩两个人时是 75，满员 6 人是 175。 */
  const holderDmgOf = function () {
    let alive = 0;
    for (const f of B.fighters) if (f.kind === "hero" && !f.dead && !f.bench) alive++;
    return (C.holderBase || 25) + alive * (C.holderPerAlive || 25);
  };

  /* ==========================================================
   *  开局
   * ========================================================== */
  B.initHotPotato = function () {
    /* 混战：所有人同队，互相打不到（也就没法用伤害甩锅） */
    this.fighters.forEach(f => { if (f.kind === "hero") f.team = -1; });
    this.potato = {
      phase: "warn",     // warn（预警）→ fly（天降）→ held（持有中）
      tgt: null,
      holder: null,
      holdT: 0,
      t: C.warn || 3.0,
      fuse: 0,             // 真正的值在 potatoPickTarget 里按轮次写入
      boomT: 0,
      x: this.world.w / 2,
      y: this.world.h / 2,
      fx: this.world.w / 2,
      fy: this.world.h / 2,
      round: 0
    };
    this.potatoPickTarget();
  };

  /** 随机抽一个活着的英雄当下一任「倒霉蛋」 */
  B.potatoPickTarget = function () {
    const st = this.potato;
    if (!st) return null;
    const alive = this.fighters.filter(f => f.kind === "hero" && !f.dead && !f.bench);
    if (!alive.length) { st.phase = "idle"; st.tgt = null; st.holder = null; return null; }
    st.round++;
    st.phase = "warn";
    st.t = C.warn || 3.0;
    st.fuse = potatoFuse();            // v4.12 本轮引信（逐轮变短，下限 fuseMin）
    st.tgt = alive[(Math.random() * alive.length) | 0];
    st.holder = null;
    st.prevHolder = null;
    st.holdT = 0;
    st.x = st.tgt.x; st.y = st.tgt.y - 300;
    st.fx = st.x; st.fy = st.y;
    FX.ring(st.tgt.x, st.tgt.y - 30, 72, "rgba(251,191,36,.85)", 5, 0.5);
    FX.float(st.tgt.x, st.tgt.y - 98, "山芋锁定：" + (st.tgt.name || "?"), C_GOLD, 17);
    /* 第 2 轮起提示本轮引信变短了，让玩家知道节奏在加快 */
    if (st.round > 1) FX.float(st.tgt.x, st.tgt.y - 124, "引信 " + st.fuse + "s", C_HOT, 15);
    return st.tgt;
  };

  /* ==========================================================
   *  每帧
   * ========================================================== */
  B.updateHotPotato = function (dt) {
    const st = this.potato;
    if (!st || st.phase === "idle") return;
    const slowT = C.slowT || 2.0, slowMul = C.slowMul || 0.5, boostMul = C.boostMul || 1.2;
    const passR = C.passR || 44, passCd = C.passCd || 0.5;

    /* 速度倍率每帧重算：先全部清零，再写当前持有者——换手即失效 */
    for (const f of this.fighters) if (f.kind === "hero") f.hotMul = 0;

    st.t -= dt;
    if ((st.passLockT || 0) > 0) st.passLockT = Math.max(0, st.passLockT - dt);
    if (st.boomT > 0) st.boomT = Math.max(0, st.boomT - dt);

    if (st.phase === "warn") {
      /* 预警期：红圈跟着目标，warn 秒后山芋开始下落 */
      const t = st.tgt;
      if (!t || t.dead) { this.potatoPickTarget(); return; }
      st.x = t.x; st.y = t.y - 300;
      st.fx = st.x; st.fy = st.y;
      /* 1e-6 容差：dt 反复累加会留下 1e-16 级别的残值，严格 <=0 会让预警 / 天降各多卡一帧 */
      if (st.t <= 1e-6) { st.phase = "fly"; st.t = C.drop || 0.85; }
      return;
    }

    if (st.phase === "fly") {
      const t = st.tgt;
      if (!t || t.dead) { this.potatoPickTarget(); return; }
      const dur = C.drop || 0.85;
      const k = clamp(1 - st.t / dur, 0, 1);
      const tx = t.x, ty = t.y - RIDE_Y;
      st.x = st.fx + (tx - st.fx) * k;
      st.y = st.fy + (ty - st.fy) * k;
      if (Math.random() < dt * 30) FX.trail(st.x, st.y, C_GOLD, 3, 0.3);
      if (st.t <= 1e-6) { st.holder = t; st.holdT = 0; st.phase = "held"; st.fuse = potatoFuse(); }
      return;
    }

    /* ---- 持有中 ---- */
    const h = st.holder;
    if (!h || h.dead || h.bench) { this.potatoPickTarget(); return; }

    st.holdT += dt;
    st.fuse -= dt;
    st.x = h.x; st.y = h.y - RIDE_Y;

    /* 减速期结束后才提速（前 slowT 秒是「懵」的状态） */
    h.hotMul = st.holdT < slowT ? slowMul : boostMul;

    /* 传递：碰到别人就把山芋甩过去（减速期内传不出去） */
    if (st.holdT >= slowT && !(st.passLockT > 0)) {
      for (const o of this.fighters) {
        if (o === h || o.kind !== "hero" || o.dead || o.bench) continue;
        const gap = Math.hypot(o.x - h.x, o.y - h.y) - h.r - o.r;
        if (gap > passR) continue;
        /* 记下上一任：AI 选目标时会跳过他。刚传完时前任就在身边且正减速（50%），
         * 是最好追的目标，不跳过就会变成两个人原地来回弹球，其余人全程轮不到。 */
        st.prevHolder = h;
        st.holder = o; st.holdT = 0;
        st.passLockT = C.passCd || 0.5;
        FX.ring(o.x, o.y - 30, 78, "rgba(249,115,22,.9)", 5, 0.45);
        FX.burst(o.x, o.y - 26, 18, [C_GOLD, "#fff", C_HOT], { speed: 250 });
        FX.float(o.x, o.y - 94, "接锅！", C_HOT, 17);
        this.ev.push(["h", o.x, o.y - 94, "接锅！", C_HOT]);
        break;
      }
    }

    if (st.fuse <= 0) this.potatoBoom();
  };

  /** 山芋爆炸：持有者吃动态伤害（人越多越疼），范围内其他人吃 splashDmg */
  B.potatoBoom = function () {
    const st = this.potato;
    if (!st) return;
    const h = st.holder;
    const R = C.splashR || 130;
    st.boomT = 0.5;
    st.phase = "boom";
    const bx = st.x, by = st.y;
    FX.ring(bx, by, R, "rgba(249,115,22,.95)", 7, 0.6);
    FX.burst(bx, by, 28, [C_HOT, C_GOLD, "#fff"], { speed: 330 });
    FX.shake(13); FX.flash(0.18, "249,115,22");
    this.ev.push(["x", bx, by, R]);
    /* 传递不走 B.damage（全员同队会被 sameTeam 挡掉），这里手动结算 */
    if (h && !h.dead) {
      const dmg = holderDmgOf();
      h.hp = Math.max(0, h.hp - dmg);
      FX.float(h.x, h.y - 100, "烫手了！-" + dmg, C_HOT, 19);
      if (h.hp <= 0) this.kill(h, null, { type: "env" });
    }
    this.fighters.forEach(o => {
      if (o === h || o.kind !== "hero" || o.dead || o.bench) return;
      if (Math.hypot(o.x - bx, o.y - by) > R + o.r * 0.5) return;
      o.hp = Math.max(0, o.hp - (C.splashDmg || 50));
      FX.float(o.x, o.y - 88, "-" + (C.splashDmg || 50), C_HOT, 16);
      if (o.hp <= 0) this.kill(o, null, { type: "env" });
    });
    /* 炸完重新抽人 */
    this.potatoPickTarget();
  };

  /* ==========================================================
   *  渲染（世界坐标）
   * ========================================================== */
  B.drawHotPotato = function (ctx) {
    const st = this.potato;
    if (!st || st.phase === "idle" || st.phase === "boom") return;

    /* 预警：目标头顶红圈 + 落点提示 */
    if (st.phase === "warn" && st.tgt && !st.tgt.dead) {
      const t = st.tgt;
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin((this.t || 0) * 9) * 0.25;
      ctx.strokeStyle = C_HOT; ctx.lineWidth = 4;
      ctx.setLineDash([10, 9]); ctx.lineDashOffset = -(this.t || 0) * 40;
      ctx.beginPath(); ctx.arc(t.x, t.y - RIDE_Y, 40, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C_HOT;
      ctx.font = "bold 13px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("山芋来了 " + Math.max(0, st.t).toFixed(1) + "s", t.x, t.y - RIDE_Y - 34);
      ctx.restore();
    }

    const h = st.holder;
    if (!h || h.dead) return;

    const x = st.x, y = st.y;
    /* 快炸了就抖得厉害 */
    const hot = st.fuse != null && st.fuse < 6;
    const jit = hot ? Math.sin((this.t || 0) * 42) * 3 : 0;
    ctx.save();
    /* 阴影 */
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(x + jit, y + 18, 16, 6, 0, 0, TAU); ctx.fill();
    /* 芋体 */
    ctx.globalAlpha = 1;
    ctx.fillStyle = C_SKIN;
    ctx.beginPath(); ctx.ellipse(x + jit, y, 17, 13, 0.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#8a5a2b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x + jit, y, 17, 13, 0.3, 0, TAU); ctx.stroke();
    /* 芽眼 */
    ctx.fillStyle = "#8a5a2b";
    ctx.beginPath(); ctx.arc(x - 6 + jit, y - 3, 2.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 5 + jit, y + 2, 2.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 1 + jit, y - 7, 1.8, 0, TAU); ctx.fill();
    /* 引信 + 火花：颜色随剩余时间越来越红 */
    /* 按「本轮引信满值」归一化，短引信也能烧到最红 */
    const full = potatoFuse();
    const k = clamp(1 - (st.fuse == null ? full : st.fuse) / full, 0, 1);
    ctx.strokeStyle = "#7c5c3a"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 9 + jit, y - 8);
    ctx.quadraticCurveTo(x + 17 + jit, y - 20, x + 12 + jit, y - 30);
    ctx.stroke();
    ctx.fillStyle = k > 0.6 ? "#ef4444" : C_GOLD;
    ctx.beginPath();
    ctx.arc(x + 12 + jit, y - 31, 3 + k * 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  };
})(window.LD = window.LD || {});
