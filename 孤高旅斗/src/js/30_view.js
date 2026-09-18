/* ============================================================
 *  30_view.js — Q版角色渲染 / 巨龙 / 场景 / 特效 / 大招演出
 * ============================================================ */
(function (LD) {
  "use strict";
  const V = LD.View = {};
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  V.TAU = TAU; V.clamp = clamp;

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  V.rr = rr;
  function ell(ctx, x, y, rx, ry, rot) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
  }
  V.ell = ell;
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU); }
  V.circle = circle;
  function glow(ctx, x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save(); ctx.globalAlpha = a == null ? 1 : a;
    ctx.fillStyle = g; circle(ctx, x, y, r); ctx.fill(); ctx.restore();
  }
  V.glow = glow;
  V.shade = function (hex, amt) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = clamp(Math.round(r + amt), 0, 255); g = clamp(Math.round(g + amt), 0, 255); b = clamp(Math.round(b + amt), 0, 255);
    return "rgb(" + r + "," + g + "," + b + ")";
  };
  const SKIN = { boy: "#f6d0b0", girl: "#fbdcc8", jianghu: "#e8c9a0", tophat: "#f2cfae" };

  /* ==========================================================
   *  Q版三段式角色：头部 + 上身 + 下身
   *  origin 在角色「脚下」；向上为负 y
   * ========================================================== */
  V.chibi = function (ctx, ox, oy, facing, look, st) {
    st = st || {};
    const t = st.t || 0;
    const moving = !!st.moving;
    const phase = st.walkPhase || 0;
    const flip = (facing && facing.x < -0.15) ? -1 : 1;
    const back = !!(facing && facing.y < -0.55);        // 朝上 → 展示背面
    const bob = moving ? Math.sin(phase * 2) * 1.6 : Math.sin(t * 2.2) * 0.7;
    const swing = st.atk || 0;                          // 0..1 挥砍进度

    const H = look.head, U = look.upper, L = look.lower;
    const torsoW = 26, torsoH = 24, legH = 17;
    const headR = 15;
    /* 画笔已 translate(ox, oy)，下方所有绘制都使用局部坐标；
       头部中心必须用局部 y（-legH-torsoH-headR+2），否则会随 oy 二次下移导致「头飞到脚下」 */
    const headLocalY = -legH - torsoH - headR + 2 + bob;

    ctx.save();
    ctx.translate(ox, oy);

    // 落地阴影
    ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = "#000";
    ell(ctx, 0, 1, 15, 5.5); ctx.fill(); ctx.restore();

    if (st.dead) { ctx.globalAlpha = 0.55; ctx.rotate(flip * 1.15); ctx.translate(0, -6); }

    /* ---------- 腿 ---------- */
    const lsw = moving ? Math.sin(phase) * 5 : 0;
    [[-7, lsw], [7, -lsw]].forEach(([lx, off]) => {
      ctx.fillStyle = L.c1;
      rr(ctx, lx - 5 + off * 0.35, -legH, 10, legH + 1, 4); ctx.fill();
      ctx.fillStyle = L.c2;                                 // 鞋
      rr(ctx, lx - 6.5 + off * 0.5, -5.5, 13, 6.5, 3); ctx.fill();
    });

    /* ---------- 躯干 ---------- */
    ctx.fillStyle = U.c1;
    rr(ctx, -torsoW / 2, -legH - torsoH, torsoW, torsoH + 3, 7); ctx.fill();
    // 衣领 / 装饰条
    ctx.fillStyle = U.c2;
    rr(ctx, -torsoW / 2 + 3, -legH - torsoH + 2, torsoW - 6, 4.5, 2); ctx.fill();
    ctx.globalAlpha = 0.5;
    rr(ctx, -3, -legH - torsoH + 8, 6, torsoH - 8, 3); ctx.fill();
    ctx.globalAlpha = 1;

    /* ---------- 手臂 ---------- */
    const shoulderY = -legH - torsoH + 7;
    const armSw = moving ? Math.sin(phase + Math.PI) * 4 : 0;
    // 后手
    ctx.fillStyle = V.shade(U.c1, -26);
    rr(ctx, -torsoW / 2 - 6.5, shoulderY + armSw * 0.5, 8, 17, 4); ctx.fill();
    // 前手（挥砍时抬起）
    ctx.save();
    ctx.translate(torsoW / 2 + 3, shoulderY + 3);
    ctx.rotate(flip * (-1.35 * swing + 0.12) + (moving ? Math.sin(phase) * 0.14 : 0));
    ctx.fillStyle = U.c1;
    rr(ctx, -4, -3, 8, 19, 4); ctx.fill();
    // 武器（斩击时可见）
    if (st.weapon) {
      ctx.save();
      ctx.translate(0, 15);
      ctx.rotate(flip * 0.5);
      ctx.globalCompositeOperation = "lighter";
      const wc = st.weaponColor || "#7fe6f7";
      glow(ctx, 0, 0, 20, wc, 0.85);
      ctx.fillStyle = "#eafcff";
      ctx.beginPath(); ctx.moveTo(-2.5, 4); ctx.lineTo(2.5, 4); ctx.lineTo(0, -30); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* ---------- 头 ---------- */
    drawHead(ctx, 0, headLocalY, headR, H, flip, back, t, st);

    // 受击白闪
    if (st.flash > 0) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.85, st.flash * 2.6); ctx.fillStyle = "#fff";
      rr(ctx, -torsoW / 2 - 4, -legH - torsoH - headR * 2, torsoW + 8, torsoH + legH + headR * 2, 8); ctx.fill();
      ctx.restore();
    }
    // 护盾
    if (st.shield > 0) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const a = 0.30 + Math.sin(t * 8) * 0.08;
      glow(ctx, 0, -28, 44, "rgba(251,191,36," + a + ")", 1);
      ctx.strokeStyle = "rgba(252,211,77,.85)"; ctx.lineWidth = 2.2;
      circle(ctx, 0, -26, 34); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  function drawHead(ctx, cx, cy, r, H, flip, back, t, st) {
    const blink = st.blinkAmt == null ? 1 : st.blinkAmt;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(flip, 1);

    const c1 = H.c1 || "#2b3445", c2 = H.c2 || "#22d3ee";
    const skin = H.c3 || SKIN[H.model] || "#f6d0b0";

    if (H.model === "robot") {
      // 方形金属头 + 天线 + LED 眼
      ctx.fillStyle = V.shade(c1, -40);
      rr(ctx, -r, -r + 1, r * 2, r * 2 - 1, 6); ctx.fill();
      ctx.fillStyle = c1;
      rr(ctx, -r + 1.5, -r + 2.5, r * 2 - 3, r * 2 - 4, 5); ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = "lighter"; glow(ctx, 0, 2, 13, c2, 0.55); ctx.restore();
      // 面罩
      ctx.fillStyle = "#0b1220";
      rr(ctx, -r + 3, -2.5, r * 2 - 6, 9, 3.5); ctx.fill();
      ctx.fillStyle = c2;
      const ew = 4.2;
      rr(ctx, -ew - 3.4, 0.2, ew, 2.6 * blink, 1.2); ctx.fill();
      rr(ctx, 3.4, 0.2, ew, 2.6 * blink, 1.2); ctx.fill();
      // 天线
      ctx.strokeStyle = V.shade(c1, -50); ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(0, -r + 1); ctx.lineTo(0, -r - 8); ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      glow(ctx, 0, -r - 9, 6, "#fb7185", 0.6 + Math.sin(t * 5) * 0.3);
      ctx.fillStyle = "#ffd7dd"; circle(ctx, 0, -r - 9, 2.4); ctx.fill(); ctx.restore();
      if (back) { ctx.fillStyle = "rgba(0,0,0,.35)"; rr(ctx, -r + 1.5, -r + 2.5, r * 2 - 3, r * 2 - 4, 5); ctx.fill(); }

    } else if (H.model === "boy") {
      ctx.fillStyle = skin; circle(ctx, 0, 0.6, r); ctx.fill();
      // 头发
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI * 1.04, Math.PI * 1.96);
      ctx.lineTo(r * 0.86, -r * 0.16); ctx.lineTo(r * 0.5, -r * 0.5);
      ctx.lineTo(r * 0.16, -r * 0.2); ctx.lineTo(-r * 0.3, -r * 0.55);
      ctx.lineTo(-r * 0.64, -r * 0.14); ctx.lineTo(-r * 0.92, -r * 0.34);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = c2; ctx.globalAlpha = 0.75;
      rr(ctx, -r * 0.8, -r * 0.82, r * 0.7, 2.6, 1.3); ctx.fill();
      ctx.globalAlpha = 1;
      if (!back) { eyes(ctx, r, c1); }

    } else if (H.model === "girl") {
      // 后发
      ctx.fillStyle = V.shade(c1, -18);
      ell(ctx, 0, 2, r * 1.16, r * 1.22); ctx.fill();
      ctx.fillStyle = skin; circle(ctx, 0, 0.4, r); ctx.fill();
      // 双丸子 + 前发
      ctx.fillStyle = c1;
      ctx.beginPath(); ctx.arc(0, -0.4, r, Math.PI * 1.02, Math.PI * 1.98); ctx.lineTo(r, r * 0.2); ctx.lineTo(-r, r * 0.2); ctx.closePath(); ctx.fill();
      [-1, 1].forEach(s => { circle(ctx, s * r * 0.94, -r * 0.62, r * 0.36); ctx.fill(); });
      [-1, 1].forEach(s => { ctx.save(); ctx.globalCompositeOperation = "lighter"; glow(ctx, s * r * 0.94, -r * 0.62, 6, c2, 0.5); ctx.restore(); });
      if (!back) {
        ctx.fillStyle = "#2b2b3a";
        ell(ctx, -r * 0.36, 2.4, 2.3, 3.0 * blink); ctx.fill();
        ell(ctx, r * 0.36, 2.4, 2.3, 3.0 * blink); ctx.fill();
        ctx.fillStyle = "#fff"; circle(ctx, -r * 0.30, 1.4, 0.9); ctx.fill(); circle(ctx, r * 0.42, 1.4, 0.9); ctx.fill();
        ctx.fillStyle = "rgba(255,140,170,.45)";
        ell(ctx, -r * 0.66, 5.4, 3.0, 1.9); ctx.fill(); ell(ctx, r * 0.66, 5.4, 3.0, 1.9); ctx.fill();
      }

    } else if (H.model === "jianghu") {
      // 斗笠 + 披风领
      ctx.fillStyle = V.shade(c1, -30);
      ctx.beginPath(); ctx.moveTo(-r * 1.35, -r * 0.42); ctx.lineTo(0, -r * 1.5); ctx.lineTo(r * 1.35, -r * 0.42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = skin;
      ell(ctx, 0, 1.6, r * 0.86, r * 0.92); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.42)";
      rr(ctx, -r * 0.9, -r * 0.5, r * 1.8, r * 0.62, 2); ctx.fill();     // 帽檐阴影
      // 飘带
      ctx.strokeStyle = c2; ctx.lineWidth = 2.6; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.4);
      ctx.quadraticCurveTo(-r * 1.5, -r * 0.9 + Math.sin(t * 4) * 3, -r * 2.1, -r * 0.2 + Math.sin(t * 4 + 1) * 4);
      ctx.stroke();
      if (!back) { eyes(ctx, r, "#1a1a1a"); }

    } else { // tophat 高帽企业家
      ctx.fillStyle = skin; circle(ctx, 0, 0.8, r); ctx.fill();
      ctx.fillStyle = V.shade(c1, -18);
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI * 1.06, Math.PI * 1.94); ctx.closePath(); ctx.fill();
      // 帽檐 + 帽筒
      ctx.fillStyle = c1;
      rr(ctx, -r * 1.34, -r * 0.72, r * 2.68, r * 0.30, 2); ctx.fill();
      rr(ctx, -r * 0.72, -r * 1.72, r * 1.44, r * 1.02, 2.5); ctx.fill();
      ctx.fillStyle = c2;
      rr(ctx, -r * 0.72, -r * 0.98, r * 1.44, r * 0.22, 1.5); ctx.fill();
      if (!back) {
        eyes(ctx, r, c1);
        // 单片眼镜
        ctx.strokeStyle = c2; ctx.lineWidth = 1.5;
        circle(ctx, r * 0.36, 2.4, 4.0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.36 + 4, 2.4); ctx.lineTo(r * 0.95, 1.2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function eyes(ctx, r, dark) {
    ctx.fillStyle = dark || "#2b2b3a";
    ell(ctx, -r * 0.38, 3.0, 2.2, 2.9 * (window.__blink || 1)); ctx.fill();
    ell(ctx, r * 0.38, 3.0, 2.2, 2.9 * (window.__blink || 1)); ctx.fill();
    ctx.fillStyle = "#fff";
    circle(ctx, -r * 0.30, 1.9, 0.85); ctx.fill();
    circle(ctx, r * 0.46, 1.9, 0.85); ctx.fill();
  }

  /* ==========================================================
   *  巨龙
   * ========================================================== */
  V.dragon = function (ctx, d, t) {
    const x = d.x, y = d.y, R = d.r;
    const hurt = d.hitFlash > 0;
    ctx.save();
    ctx.translate(x, y);

    // 阴影
    ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = "#000";
    ell(ctx, 0, R * 0.62, R * 1.05, R * 0.34); ctx.fill(); ctx.restore();

    // 尾巴
    ctx.strokeStyle = "#243352"; ctx.lineWidth = 13; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-R * 0.5, R * 0.18);
    ctx.quadraticCurveTo(-R * 1.9, R * 0.5 + Math.sin(t * 2) * 8, -R * 2.6, -R * 0.25 + Math.sin(t * 2) * 12);
    ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = "lighter"; glow(ctx, -R * 2.6, -R * 0.25, 16, "#f59e0b", 0.5); ctx.restore();

    // 翅膀
    [-1, 1].forEach(s => {
      ctx.save();
      ctx.globalAlpha = 0.85;
      const flap = Math.sin(t * 2.6 + (s > 0 ? 0 : 1)) * 0.13;
      ctx.translate(s * R * 0.5, -R * 0.3); ctx.rotate(s * (0.42 + flap));
      ctx.fillStyle = "#1b2740";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * R * 1.5, -R * 0.9);
      ctx.lineTo(s * R * 1.75, -R * 0.1); ctx.lineTo(s * R * 1.1, R * 0.36); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(34,211,238,.5)"; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.restore();
    });

    // 身体
    const g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, hurt ? "#ffd9de" : "#2e3d5f");
    g.addColorStop(0.55, hurt ? "#ff9fb0" : "#1b2740");
    g.addColorStop(1, "#101a2e");
    ctx.fillStyle = g;
    ell(ctx, 0, 0, R * 1.02, R * 0.92); ctx.fill();
    ctx.strokeStyle = "rgba(120,160,255,.30)"; ctx.lineWidth = 2; ctx.stroke();

    // 胸口熔核
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const pulse = 0.55 + Math.sin(t * 3.4) * 0.2;
    glow(ctx, 0, R * 0.05, R * 0.72, "rgba(251,113,133," + pulse + ")", 1);
    glow(ctx, 0, R * 0.05, R * 0.30, "rgba(255,236,180,.9)", 0.9);
    ctx.restore();
    ctx.fillStyle = "#ffe8b0"; circle(ctx, 0, R * 0.05, R * 0.15); ctx.fill();

    // 头
    ctx.save();
    ctx.translate(0, -R * 0.86);
    ctx.fillStyle = hurt ? "#ffc9d2" : "#26344f";
    rr(ctx, -R * 0.62, -R * 0.5, R * 1.24, R * 0.86, R * 0.3); ctx.fill();
    // 角
    ctx.fillStyle = "#7d8aa8";
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s * R * 0.4, -R * 0.46); ctx.lineTo(s * R * 0.76, -R * 1.02); ctx.lineTo(s * R * 0.16, -R * 0.56);
      ctx.closePath(); ctx.fill();
    });
    // 眼
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const eyeCol = d.charge > 0 ? "rgba(255,80,80,.95)" : (d.mode === "ult" ? "rgba(251,146,60,.95)" : "rgba(34,211,238,.85)");
    glow(ctx, -R * 0.28, -R * 0.05, R * 0.36, eyeCol, 1);
    glow(ctx, R * 0.28, -R * 0.05, R * 0.36, eyeCol, 1);
    ctx.restore();
    ctx.fillStyle = d.charge > 0 ? "#ff6b6b" : "#9ff0ff";
    ell(ctx, -R * 0.28, -R * 0.05, R * 0.12, R * 0.09); ctx.fill();
    ell(ctx, R * 0.28, -R * 0.05, R * 0.12, R * 0.09); ctx.fill();
    ctx.restore();

    // 蓄力预警圈
    if (d.charge > 0) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const p = 1 - d.charge / Math.max(0.001, d.chargeMax);
      glow(ctx, 0, 0, R * (1.5 + p * 0.6), "rgba(255,120,90,.45)", 1);
      ctx.strokeStyle = "rgba(255,150,120,.9)"; ctx.lineWidth = 3;
      circle(ctx, 0, 0, R * (1.3 + p * 0.7)); ctx.stroke();
      ctx.restore();
    }
    if (hurt) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#fff"; ell(ctx, 0, 0, R * 1.02, R * 0.92); ctx.fill(); ctx.restore(); }
    ctx.restore();
  };

  /* ==========================================================
   *  场景
   * ========================================================== */
  V.arena = function (ctx, W, H, t, theme) {
    theme = theme || {};
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.top || "#0d1428");
    g.addColorStop(1, theme.bottom || "#050912");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 月亮 / 远景
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    glow(ctx, W * 0.78, 108, 130, theme.moon || "rgba(120,170,255,.24)", 1);
    ctx.restore();
    ctx.fillStyle = theme.moonCore || "rgba(226,240,255,.92)";
    circle(ctx, W * 0.78, 108, 40); ctx.fill();
    ctx.fillStyle = "rgba(13,20,40,.75)";
    circle(ctx, W * 0.78 - 14, 98, 34); ctx.fill();

    // 透视网格地面
    const hy = H * 0.42;
    ctx.save(); ctx.globalAlpha = 0.42;
    ctx.strokeStyle = theme.grid || "rgba(34,211,238,.42)"; ctx.lineWidth = 1;
    for (let i = 0; i <= 22; i++) {
      const x = (i / 22) * W;
      ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(W / 2 + (x - W / 2) * 0.16, hy); ctx.stroke();
    }
    for (let i = 0; i < 13; i++) {
      const p = i / 12, yy = hy + Math.pow(p, 2.1) * (H - hy);
      ctx.globalAlpha = 0.42 * (0.25 + p * 0.75);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
    ctx.restore();

    // 赛场边界
    ctx.save();
    ctx.strokeStyle = "rgba(120,160,255,.30)"; ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    rr(ctx, 26, hy + 6, W - 52, H - hy - 34, 16); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 飘浮粒子
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 26; i++) {
      const seed = i * 97.13;
      const x = (seed * 7.3) % W;
      const sp = 0.25 + ((i % 5) + 1) * 0.09;
      const y = H - ((seed * 3.1 + t * 26 * sp) % (H + 60));
      ctx.globalAlpha = 0.16 + (i % 4) * 0.07;
      ctx.fillStyle = i % 3 === 0 ? "#f472b6" : "#22d3ee";
      circle(ctx, x, y, 1.1 + (i % 3) * 0.5); ctx.fill();
    }
    ctx.restore();
  };

  /* ==========================================================
   *  特效系统
   * ========================================================== */
  const FX = LD.FX = {
    ps: [], floats: [], rings: [], marks: [],
    shakeT: 0, shakeMag: 0, stop: 0, flashT: 0, flashCol: "255,255,255", flashA: 0,

    clear() { this.ps.length = 0; this.floats.length = 0; this.rings.length = 0; this.marks.length = 0; this.shakeT = 0; this.stop = 0; this.flashT = 0; },

    burst(x, y, n, color, o) {
      o = o || {};
      const sp = o.speed || 190, life = o.life || 0.45, size = o.size || 3;
      for (let i = 0; i < n; i++) {
        const a = o.dir != null ? o.dir + (Math.random() - 0.5) * (o.spread || 1.1) : Math.random() * TAU;
        const v = sp * (0.45 + Math.random() * 0.85);
        this.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: life * (0.6 + Math.random() * 0.7),
          color: Array.isArray(color) ? color[i % color.length] : color, size: size * (0.5 + Math.random()), drag: o.drag == null ? 2.4 : o.drag, grav: o.grav || 0 });
      }
    },
    trail(x, y, color, size, life) {
      this.ps.push({ x, y, vx: 0, vy: 0, life: 0, max: life || 0.3, color, size: size || 3, drag: 0, grav: 0, still: true });
    },
    ring(x, y, maxR, color, w, life) {
      this.rings.push({ x, y, r: 6, maxR, color, w: w || 3, life: 0, max: life || 0.42 });
    },
    mark(x, y, r, color, life, kind) {
      this.marks.push({ x, y, r, color, life: 0, max: life || 0.6, kind: kind || "circle" });
    },
    float(x, y, txt, color, size) {
      this.floats.push({ x, y, txt, color, life: 0, max: 0.85, size: size || 15, vy: -46 });
    },
    shake(mag) { this.shakeMag = Math.max(this.shakeMag, mag); this.shakeT = Math.max(this.shakeT, 0.18 + mag * 0.012); },
    hitstop(t) { this.stop = Math.max(this.stop, t); },
    flash(a, col) { this.flashA = Math.max(this.flashA, a); this.flashT = 0.16; this.flashCol = col || "255,255,255"; },

    update(dt) {
      for (let i = this.ps.length - 1; i >= 0; i--) {
        const p = this.ps[i]; p.life += dt;
        if (p.life >= p.max) { this.ps.splice(i, 1); continue; }
        if (!p.still) {
          p.x += p.vx * dt; p.y += p.vy * dt;
          const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d;
          p.vy += p.grav * dt;
        }
      }
      for (let i = this.floats.length - 1; i >= 0; i--) {
        const f = this.floats[i]; f.life += dt; f.y += f.vy * dt; f.vy *= Math.exp(-2.2 * dt);
        if (f.life >= f.max) this.floats.splice(i, 1);
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i]; r.life += dt; r.r = 6 + (r.maxR - 6) * Math.min(1, r.life / r.max);
        if (r.life >= r.max) this.rings.splice(i, 1);
      }
      for (let i = this.marks.length - 1; i >= 0; i--) {
        const m = this.marks[i]; m.life += dt;
        if (m.life >= m.max) this.marks.splice(i, 1);
      }
      if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.shakeMag = 0; }
      if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flashA = 0; }
    },

    applyShake(ctx) {
      if (this.shakeT <= 0) return;
      const k = Math.max(0, this.shakeT / 0.18);
      const m = this.shakeMag * k;
      ctx.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2);
    },
    drawGround(ctx) {
      this.marks.forEach(m => {
        const p = m.life / m.max;
        ctx.save(); ctx.globalAlpha = (1 - p) * 0.9;
        ctx.strokeStyle = m.color; ctx.lineWidth = m.w || 3;
        if (m.kind === "rect") { rr(ctx, m.x - m.r, m.y - m.r * 0.42, m.r * 2, m.r * 0.84, 6); ctx.stroke(); }
        else { circle(ctx, m.x, m.y, m.r * (0.4 + p * 0.9)); ctx.stroke(); }
        ctx.restore();
      });
    },
    draw(ctx) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      this.ps.forEach(p => {
        const a = 1 - p.life / p.max;
        ctx.globalAlpha = a * 0.95; ctx.fillStyle = p.color;
        circle(ctx, p.x, p.y, p.size * (0.4 + a * 0.9)); ctx.fill();
      });
      this.rings.forEach(r => {
        const a = 1 - r.life / r.max;
        ctx.globalAlpha = a * 0.8; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * a + 0.6;
        circle(ctx, r.x, r.y, r.r); ctx.stroke();
      });
      ctx.restore();

      this.floats.forEach(f => {
        const a = 1 - Math.pow(f.life / f.max, 2);
        ctx.save(); ctx.globalAlpha = a;
        ctx.font = "900 " + f.size + "px system-ui,sans-serif";
        ctx.textAlign = "center"; ctx.lineWidth = 3.4; ctx.strokeStyle = "rgba(0,0,0,.8)";
        ctx.strokeText(f.txt, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.txt, f.x, f.y);
        ctx.restore();
      });
    },
    drawFlash(ctx, W, H) {
      if (this.flashA <= 0) return;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(" + this.flashCol + "," + (this.flashA * (this.flashT / 0.16)) + ")";
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
  };

  /* ==========================================================
   *  大招演出（全局暂停 + 局部特写 + 逐字显示技能名）
   * ========================================================== */
  const Cine = LD.Cine = {
    active: false, who: null, name: "", sub: "", t: 0, dur: 2.6, color: "#fbbf24", side: 0,
    start(who, name, sub, color) {
      this.active = true; this.who = who; this.name = name; this.sub = sub || "";
      this.t = 0; this.color = color || "#fbbf24"; this.side = who.side;
      /* 名字从 0.35s 开始逐字出现，每字 0.12s；显示完毕立刻结束演出并释放大招，
         只留 0.06s 缓冲，不再整段停留（旧版固定 2.6s，5 字名字会空等 1.6 秒） */
      this.dur = 0.35 + name.length * 0.12 + 0.06;
      FX.hitstop(0.001); FX.flash(0.28, "255,255,255"); FX.shake(10);
    },
    update(dt) { if (!this.active) return false; this.t += dt; if (this.t >= this.dur) { this.active = false; return true; } return false; },
    // 已显示的字符数
    shown() { return Math.min(this.name.length, Math.floor(Math.max(0, this.t - 0.35) / 0.12)); },

    draw(ctx, W, H, worldDraw) {
      const who = this.who;
      const zoom = 2.35;
      const p = Math.min(1, this.t / 0.28);
      const z = 1 + (zoom - 1) * (1 - Math.pow(1 - p, 3));
      ctx.save();
      ctx.translate(W / 2, H * 0.46);
      ctx.scale(z, z);
      ctx.translate(-who.x, -who.y);
      worldDraw();
      ctx.restore();

      // 暗角 + 速度线
      const g = ctx.createRadialGradient(W / 2, H * 0.46, 90, W / 2, H * 0.46, 620);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.55, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,.92)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.22;
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU + this.t * 0.7;
        ctx.strokeStyle = this.color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 2 + Math.cos(a) * 300, H * 0.46 + Math.sin(a) * 200);
        ctx.lineTo(W / 2 + Math.cos(a) * 500, H * 0.46 + Math.sin(a) * 330);
        ctx.stroke();
      }
      ctx.restore();

      // 技能名逐字出现
      const n = this.shown();
      const txt = this.name.slice(0, n);
      ctx.save();
      ctx.textAlign = "center";
      const fs = 58;
      ctx.font = "900 " + fs + "px system-ui,'PingFang SC',sans-serif";
      const w = ctx.measureText(this.name).width;
      const x0 = W / 2 - w / 2;
      ctx.fillStyle = "rgba(6,10,20,.72)";
      rr(ctx, x0 - 26, H * 0.80 - 48, w + 52, 74, 12); ctx.fill();
      ctx.strokeStyle = this.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = this.color; ctx.shadowBlur = 26;
      ctx.fillStyle = "#fff";
      ctx.fillText(txt, W / 2, H * 0.80);
      ctx.restore();
      // 已出现的字做描边强调
      ctx.font = "900 " + fs + "px system-ui,'PingFang SC',sans-serif";
      ctx.textAlign = "center";
      const who_txt = (who.name || (who.side === 0 ? "勇者" : (who.kind === "dragon" ? "巨龙" : "对手"))) + " 释放";
      ctx.font = "600 15px system-ui,sans-serif"; ctx.fillStyle = "rgba(220,232,255,.85)";
      ctx.fillText(who_txt, W / 2, H * 0.80 - 62);
      ctx.restore();
    }
  };
  V.Cine = Cine;

  /* ==========================================================
   *  商店 / 配装 预览（小画布）
   * ========================================================== */
  V.heroPreview = function (canvas, look, angle) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H - 12);
    const s = 1.45;
    ctx.scale(s, s);
    V.chibi(ctx, 0, 0, { x: 1, y: 0 }, look, { t: 0.6, moving: false, blinkAmt: 1 });
    ctx.restore();
  };
})(window.LD = window.LD || {});
