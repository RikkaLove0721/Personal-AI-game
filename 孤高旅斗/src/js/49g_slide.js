/* ============================================================
 *  49g_slide.js — v4.12 冰面滑壶
 * ============================================================
 *  全场结冰：方向键不再是「直接位移」而是「推力」，人靠惯性滑行，根本刹不住车
 *  （阻尼从常规的 exp(-7.5·dt) 放宽到 exp(-0.55·dt)，详见 40_battle.js 的位移段）。
 *
 *  中央是一片得分区：滑进去每秒加分，先到 need 分获胜。
 *  高速撞上对手会把对方撞飞（相对速度超过 minBumpSpd 才算撞），
 *  所以「把自己稳在圈里」和「把对手撞出去」是同一件事的两面。
 *
 *  本模式禁用普攻 / 技能 / 大招——你能用的只有体重和速度。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.SLIDE || {};

  const C_ICE = "#7dd3fc", C_ZONE = "#38bdf8", C_HIT = "#fbbf24";

  B.initSlide = function () {
    const c = C(), w = this.world;
    const alive = this.casualAlive();
    this.casualThinProps(c.propsKeep != null ? c.propsKeep : 0.35);
    const zone = { x: w.w / 2, y: ((w.pt || 110) + w.h) / 2, r: c.zoneR || 195 };
    /* 开局沿得分区外圈铺开，谁都不占便宜 */
    const pts = alive.map((f, i) => {
      const a = (i / Math.max(1, alive.length)) * TAU + rnd(-0.2, 0.2);
      return { x: zone.x + Math.cos(a) * (zone.r + 150), y: zone.y + Math.sin(a) * (zone.r + 120) };
    });
    this.casualPlace(pts, alive);
    alive.forEach(f => {
      f.vx = 0; f.vy = 0;
      f.slideScore = 0;
      f.slideAggro = rnd(0.25, 0.9);
      f.slideAimT = 0;
    });
    this.slide = { zone: zone, spark: 0 };
    FX.float(w.w / 2, w.pt + 40, "冰面滑壶——滑进圈里得分", C_ICE, 19);
  };

  B.updateSlide = function (dt) {
    const st = this.slide, c = C();
    if (!st) return;
    const z = st.zone;
    const alive = this.casualAlive();

    /* ---- 计分：站（滑）在得分区里每秒加分 ---- */
    for (const f of alive) {
      const d = Math.hypot(f.x - z.x, f.y - z.y);
      if (d > z.r) continue;
      f.slideScore = (f.slideScore || 0) + (c.scorePerSec || 10) * dt;
      /* 越靠内圈越快（滑壶的味道：正中靶心） */
      if (d < z.r * 0.4) f.slideScore += (c.scorePerSec || 10) * 0.5 * dt;
      if ((f.slideScore || 0) >= (c.need || 80)) {
        FX.burst(f.x, f.y - 30, 34, [C_ZONE, "#fff", C_HIT], { speed: 320 });
        this.casualWin(f, "滑壶之王！");
        return;
      }
    }

    /* ---- 角色互撞：相对速度够快就互相撞飞（本模式唯一的「攻击」手段） ---- */
    const minSpd = c.minBumpSpd || 150, kb = c.bumpKb || 330;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const touch = a.r + b.r + 4;
        if (d > touch) continue;
        /* 先把两人分开，免得叠在一起互相反复结算 */
        const ux = dx / d, uy = dy / d, pen = (touch - d) / 2 + 0.5;
        if (a.knockLeft <= 0) { a.x -= ux * pen; a.y -= uy * pen; }
        if (b.knockLeft <= 0) { b.x += ux * pen; b.y += uy * pen; }
        /* 接近速度 = 两者速度在连线方向上的分量之差 */
        const close = (a.vx - b.vx) * ux + (a.vy - b.vy) * uy;
        if (close < minSpd) continue;
        if (this.knockDist) {
          this.knockDist(b, { x: a.x, y: a.y }, kb * clamp(close / 340, 0.6, 1.6), false);
          this.knockDist(a, { x: b.x, y: b.y }, kb * 0.45 * clamp(close / 340, 0.6, 1.6), false);
        }
        FX.ring((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, 44, "rgba(251,191,36,.9)", 5, 0.35);
        FX.burst((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, 12, [C_HIT, "#fff"], { speed: 220 });
        FX.float((a.x + b.x) / 2, (a.y + b.y) / 2 - 66, "撞飞！", C_HIT, 16);
        this.ev.push(["h", (a.x + b.x) / 2, (a.y + b.y) / 2 - 66, "撞飞！", C_HIT]);
        FX.shake(7);
      }
    }

    /* 冰屑拖尾 */
    if (Math.random() < dt * 22) {
      const f = alive[(Math.random() * alive.length) | 0];
      if (f && Math.hypot(f.vx || 0, f.vy || 0) > 90) FX.trail(f.x + rnd(-8, 8), f.y, C_ICE, 4, 0.35);
    }
  };

  B.slideTimeUp = function () {
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if ((f.slideScore || 0) > (w.slideScore || 0)) w = f; });
    this.casualWin(w, "时间到·分数最高");
  };

  /* ---------------- 渲染 ---------------- */
  B.drawSlide = function (ctx) {
    const st = this.slide, c = C(), w = this.world;
    if (!st) return;
    const z = st.zone;

    /* 冰面：一层冷色薄雾铺在整个可行走区域 */
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = C_ICE;
    ctx.fillRect(0, w.pt || 110, w.w, w.h - (w.pt || 110));
    ctx.restore();

    /* 得分区：三圈同心靶 */
    ctx.save();
    ctx.globalAlpha = 0.16; ctx.fillStyle = C_ZONE;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.55; ctx.strokeStyle = C_ZONE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 0.66, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 0.4, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#e0f2fe";
    ctx.font = "bold 13px system-ui,'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("得分区", z.x, z.y - z.r + 18);
    ctx.restore();

    /* 分数条（画在每个人头顶） */
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
    for (const f of this.casualAlive()) {
      const k = clamp((f.slideScore || 0) / (c.need || 80), 0, 1);
      ctx.fillStyle = "rgba(15,23,42,.7)";
      ctx.fillRect(f.x - 22, f.y - 112, 44, 7);
      ctx.fillStyle = k > 0.75 ? C_HIT : C_ZONE;
      ctx.fillRect(f.x - 21, f.y - 111, 42 * k, 5);
      ctx.fillStyle = "#e0f2fe";
      ctx.fillText(Math.round(f.slideScore || 0) + "", f.x, f.y - 122);
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    ctx.fillStyle = C_ICE;
    ctx.fillText("冰面滑壶 · 先到 " + (c.need || 80) + " 分", w.w / 2, w.pt + 14);
    ctx.restore();
  };

  /* ---------------- 人机 ---------------- */
  LD.casualAI.slide = function (f, dt, ctrl) {
    const st = B.slide, c = LD.SLIDE || {};
    ctrl.press = {};
    if (!st) { ctrl.mx = 0; ctrl.my = 0; return; }
    const z = st.zone, w = B.world;
    const vmax = c.vmax || 330;

    /* 目标：多数时候奔靶心；性格凶的（slideAggro 高）会顺路撞人 */
    let tx = z.x, ty = z.y;
    const aggro = f.slideAggro != null ? f.slideAggro : 0.5;
    let ram = null, rd = Infinity;
    for (const o of B.fighters) {
      if (o === f || o.kind !== "hero" || o.dead || o.bench) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < rd) { rd = d; ram = o; }
    }
    f.slideAimT = (f.slideAimT || 0) - dt;
    if (ram && rd < 320 && aggro > 0.55 && f.slideAimT <= 0) {
      /* 只有当「撞他」不会把自己带偏太远时才撞：夹角小于 60° 才顺路 */
      const a1 = Math.atan2(ty - f.y, tx - f.x);
      const a2 = Math.atan2(ram.y - f.y, ram.x - f.x);
      let diff = Math.abs(((a2 - a1 + Math.PI * 3) % TAU) - Math.PI);
      const inZone = Math.hypot(f.x - z.x, f.y - z.y) < z.r;
      if (diff < 1.05 || (inZone && rd < 150)) { tx = ram.x; ty = ram.y; f.slideAimT = 1.2; }
    }

    /* 关键：冰面上不能「朝目标直推」，要按「期望速度 − 当前速度」来修正，
     * 否则会绕着靶心画圈永远停不进去。 */
    const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
    /* 快到靶心时把期望速度降下来，才能稳住不掉出去 */
    const want = vmax * clamp(d / (z.r * 0.55), 0.15, 1);
    let wvx = dx / d * want, wvy = dy / d * want;
    if (d < z.r * 0.45) { wvx *= 0.25; wvy *= 0.25; }        // 进圈了就刹车
    let ax = wvx - (f.vx || 0), ay = wvy - (f.vy || 0);

    /* 别滑出场边 */
    const pad = 90;
    if (f.x < pad) ax += (pad - f.x) * 3;
    if (f.x > w.w - pad) ax -= (f.x - (w.w - pad)) * 3;
    if (f.y < (w.pt || 110) + pad) ay += ((w.pt || 110) + pad - f.y) * 3;
    if (f.y > w.h - pad) ay -= (f.y - (w.h - pad)) * 3;

    const n = Math.hypot(ax, ay) || 1;
    const s = LD.AI.steer(f, ax / n, ay / n, null);
    ctrl.mx = s.x; ctrl.my = s.y;
  };
})(window.LD = window.LD || {});
