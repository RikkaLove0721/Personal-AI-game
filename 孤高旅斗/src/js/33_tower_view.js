/* ============================================================
 *  33_tower_view.js — v3.7 塔防对战渲染
 * ============================================================
 *  建筑：优先用 AI 生图（build.py 内嵌为 LD_PROP_IMG），
 *        没有图时退回程序化绘制，保证任何构建都能跑。
 *  小兵：程序化机器人（20px 高，贴图在这里反而看不清）。
 * ============================================================ */
(function (LD) {
  "use strict";
  const V = LD.View;
  const TAU = Math.PI * 2;
  const TEAM = ["#f87171", "#60a5fa"];
  const TEAM_DARK = ["#7f1d1d", "#1e3a8a"];
  const TEAM_LIGHT = ["#fecaca", "#bfdbfe"];

  const imgs = {};
  function imgOf(kind) {
    const src = (typeof window !== "undefined" && window.LD_PROP_IMG && window.LD_PROP_IMG[kind]) || null;
    if (!src) return null;
    if (!imgs[kind]) {
      const im = new Image();
      im.src = src;
      imgs[kind] = im;
    }
    const im = imgs[kind];
    return (im.complete && im.naturalWidth) ? im : null;
  }

  /* 结构轮廓（也是绘制排序 / 血条的基准） */
  V.structHeight = function (o) {
    const C = LD.TOWER || {};
    if (o.kind === "crystal") return ((C.crystal && C.crystal.h) || 110) * 1.35;
    return ((C.tower && C.tower.h) || 96) * 1.75;
  };

  V.structure = function (ctx, o, t) {
    const side = o.side === 0 ? 0 : 1;
    const col = TEAM[side], dark = TEAM_DARK[side], light = TEAM_LIGHT[side];
    const H = V.structHeight(o);
    const bob = o.kind === "crystal" ? Math.sin(t * 1.6) * 4 : 0;

    /* 地面光圈：阵营色 + 攻击范围（只在自己视野附近时画淡圈） */
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(o.x, o.y + 4, o.w * 0.72, o.h * 0.34, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.08; ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(o.x, o.y + 4, o.w * 0.72, o.h * 0.34, 0, 0, TAU); ctx.fill();
    ctx.restore();

    const im = imgOf(o.kind);
    if (im) {
      const iw = H * (im.naturalWidth / im.naturalHeight);
      ctx.save();
      ctx.globalAlpha = 0.28; ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.ellipse(o.x, o.y + 6, iw * 0.34, 12, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      /* 受击闪白 */
      if (o.flash > 0) { ctx.globalAlpha = 0.85; }
      ctx.drawImage(im, o.x - iw / 2, o.y + bob - H + 10, iw, H);
      if (o.flash > 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(0.55, o.flash * 2.4);
        ctx.drawImage(im, o.x - iw / 2, o.y + bob - H + 10, iw, H);
      }
      ctx.restore();
    } else if (o.kind === "crystal") {
      drawCrystal(ctx, o, t, col, dark, light, H, bob);
    } else {
      drawWatchtower(ctx, o, t, col, dark, light, H);
    }

    /* 水晶被防御塔保护：罩一层六边形护盾 */
    if (o.kind === "crystal" && LD.Battle && LD.Battle.crystalGuarded && LD.Battle.crystalGuarded(o)) {
      const r = Math.max(o.w, o.h) * 0.80;
      ctx.save();
      ctx.translate(o.x, o.y - H * 0.42);
      ctx.rotate(t * 0.35);
      ctx.strokeStyle = "rgba(148,197,255,.55)"; ctx.lineWidth = 2;
      ctx.setLineDash([9, 7]);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU;
        const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.9;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }

    drawHpBar(ctx, o, H, col, dark);
  };

  function drawCrystal(ctx, o, t, col, dark, light, H, bob) {
    const cy = o.y - H * 0.45 + bob;
    const r = H * 0.30;
    ctx.save();
    /* 底座 */
    ctx.fillStyle = "#334155";
    ctx.beginPath(); ctx.ellipse(o.x, o.y - 2, r * 0.9, r * 0.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#475569";
    ctx.beginPath(); ctx.ellipse(o.x, o.y - 8, r * 0.62, r * 0.2, 0, 0, TAU); ctx.fill();
    /* 玻璃球壳 */
    const g = ctx.createRadialGradient(o.x - r * 0.35, cy - r * 0.4, r * 0.15, o.x, cy, r);
    g.addColorStop(0, "rgba(255,255,255,.55)");
    g.addColorStop(0.45, "rgba(186,230,253,.20)");
    g.addColorStop(1, "rgba(56,189,248,.06)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(o.x, cy, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(191,219,254,.75)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(o.x, cy, r, 0, TAU); ctx.stroke();
    /* 内部钻石 */
    const s = r * 0.56;
    ctx.save();
    ctx.translate(o.x, cy);
    ctx.rotate(Math.sin(t * 0.9) * 0.18);
    const dg = ctx.createLinearGradient(-s, -s, s, s);
    dg.addColorStop(0, "#e0fbff"); dg.addColorStop(0.5, col); dg.addColorStop(1, "#0e7490");
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.25); ctx.lineTo(s * 0.85, -s * 0.1);
    ctx.lineTo(0, s * 1.15); ctx.lineTo(-s * 0.85, -s * 0.1);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s * 1.25); ctx.lineTo(-s * 0.3, 0); ctx.lineTo(0, s * 1.15); ctx.stroke();
    ctx.restore();
    /* 高光 */
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.beginPath(); ctx.ellipse(o.x - r * 0.36, cy - r * 0.42, r * 0.20, r * 0.12, -0.7, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  function drawWatchtower(ctx, o, t, col, dark, light, H) {
    const baseY = o.y + 2;
    const topY = o.y - H;
    const bw = o.w * 0.44, tw = o.w * 0.30;
    ctx.save();
    /* 底座台阶 */
    ctx.fillStyle = "#334155";
    ctx.beginPath();
    ctx.moveTo(o.x - bw * 1.25, baseY); ctx.lineTo(o.x - bw * 0.95, baseY - 14);
    ctx.lineTo(o.x + bw * 0.95, baseY - 14); ctx.lineTo(o.x + bw * 1.25, baseY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#475569";
    ctx.fillRect(o.x - bw * 0.95, baseY - 16, bw * 1.9, 5);
    /* 塔身（梯形） */
    const g = ctx.createLinearGradient(o.x - bw, 0, o.x + bw, 0);
    g.addColorStop(0, "#3b4a5c"); g.addColorStop(0.35, "#7b8ea3"); g.addColorStop(1, "#2b3746");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(o.x - bw, baseY - 16); ctx.lineTo(o.x - tw, topY + 34);
    ctx.lineTo(o.x + tw, topY + 34); ctx.lineTo(o.x + bw, baseY - 16);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#1b2533"; ctx.lineWidth = 2; ctx.stroke();
    /* 横梁 */
    ctx.strokeStyle = "rgba(15,23,42,.7)"; ctx.lineWidth = 3;
    for (let i = 1; i <= 3; i++) {
      const y = baseY - 26 - i * (H - 60) / 4;
      const k = 1 - i * 0.13;
      ctx.beginPath(); ctx.moveTo(o.x - bw * k, y); ctx.lineTo(o.x + bw * k, y); ctx.stroke();
    }
    /* 交叉斜撑 */
    ctx.strokeStyle = "rgba(148,163,184,.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x - bw * 0.7, baseY - 30); ctx.lineTo(o.x + tw * 0.9, topY + 50); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(o.x + bw * 0.7, baseY - 30); ctx.lineTo(o.x - tw * 0.9, topY + 50); ctx.stroke();
    /* 瞭望台 */
    const cw = o.w * 0.52, ch = 34;
    ctx.fillStyle = "#4b5b6e";
    ctx.fillRect(o.x - cw, topY + 20, cw * 2, ch);
    ctx.strokeStyle = "#1b2533"; ctx.lineWidth = 2;
    ctx.strokeRect(o.x - cw, topY + 20, cw * 2, ch);
    /* 窗口（朝向目标） */
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(o.x - cw * 0.55, topY + 29, cw * 1.1, 9);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(o.x - cw * 0.5, topY + 31, cw, 5);
    ctx.globalAlpha = 1;
    /* 屋顶 */
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(o.x - cw * 1.25, topY + 20);
    ctx.lineTo(o.x, topY - 6);
    ctx.lineTo(o.x + cw * 1.25, topY + 20);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 2; ctx.stroke();
    /* 旗 / 天线 */
    ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, topY - 6); ctx.lineTo(o.x, topY - 24); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(o.x, topY - 24); ctx.lineTo(o.x + 16, topY - 19); ctx.lineTo(o.x, topY - 14);
    ctx.closePath(); ctx.fill();
    /* 开火充能提示：枪口亮起 */
    if (o._target) {
      const a = o.aimAngle || 0;
      ctx.save();
      ctx.translate(o.x, topY + 33);
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cw * 0.55, 0, 4 + Math.sin(t * 10) * 1.2, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawHpBar(ctx, o, H, col, dark) {
    if (!(o.maxHp > 0) || o.dead) return;
    const w = o.kind === "crystal" ? 96 : 78;
    const x = o.x - w / 2, y = o.y - H - 12;
    ctx.save();
    ctx.fillStyle = "rgba(4,8,16,.72)";
    ctx.fillRect(x - 1, y - 1, w + 2, 8);
    const p = Math.max(0, Math.min(1, o.hp / o.maxHp));
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * p, 6);
    ctx.fillStyle = "rgba(255,255,255,.22)";
    ctx.fillRect(x, y, w * p, 2);
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 7);
    ctx.restore();
  }

  /* 兵线基地：回血圈 + 出生点标记 */
  V.towerField = function (ctx, B) {
    const C = LD.TOWER || {};
    const laneY = C.laneY || 560;
    const F = C.fountain || { r: 170 };
    const t = B.t || 0;
    /* 兵线通道：一条横贯全图的浅色走廊 + 流动虚线，让「往哪推」一眼可见 */
    ctx.save();
    const w = (B.world && B.world.w) || 2400;
    ctx.fillStyle = "rgba(148,163,184,.055)";
    ctx.fillRect(0, laneY - 70, w, 140);
    ctx.strokeStyle = "rgba(148,163,184,.13)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, laneY - 70); ctx.lineTo(w, laneY - 70); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, laneY + 70); ctx.lineTo(w, laneY + 70); ctx.stroke();
    ctx.setLineDash([28, 24]); ctx.lineDashOffset = -t * 30;
    ctx.strokeStyle = "rgba(148,163,184,.16)";
    ctx.beginPath(); ctx.moveTo(0, laneY); ctx.lineTo(w, laneY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    [0, 1].forEach(side => {
      const b = B.towerBase ? B.towerBase(side) : { x: side === 0 ? 96 : B.world.w - 96, y: laneY - 60 };
      const col = TEAM[side];
      ctx.save();
      const pulse = 0.5 + Math.sin(t * 1.8 + side) * 0.12;
      ctx.globalAlpha = 0.10 * pulse;
      ctx.fillStyle = "#34d399";
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 6, (F.r || 170) * 0.72, (F.r || 170) * 0.34, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "rgba(52,211,153,.55)"; ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 18;
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 6, (F.r || 170) * 0.72, (F.r || 170) * 0.34, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      /* 兵线箭头 */
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = col;
      const dir = side === 0 ? 1 : -1;
      for (let i = 0; i < 5; i++) {
        const x = b.x + dir * (200 + i * 90);
        const y = laneY + 42;
        ctx.beginPath();
        ctx.moveTo(x, y - 7); ctx.lineTo(x + dir * 14, y); ctx.lineTo(x, y + 7);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    });

    /* v3.8 敌方建筑攻击范围：玩家进入范围内（或刚踏进边缘）才显示，避免全屏红圈 */
    const me = B.hero ? B.hero(B.mySide == null ? 0 : B.mySide) : null;
    const props = B.terrain ? B.terrain.props : null;
    if (me && props && !me.dead) {
      props.forEach(o => {
        if (o.dead) return;
        if (o.kind !== "tower" && o.kind !== "crystal") return;
        if (o.side === me.team) return;
        const C2 = o.kind === "crystal" ? (C.crystal || {}) : (C.tower || {});
        const r = C2.range || 300;
        const d = Math.hypot(me.x - o.x, me.y - o.y);
        if (d > r + 60) return;
        const inside = d <= r;
        ctx.save();
        ctx.globalAlpha = inside ? 0.07 : 0.035;
        ctx.fillStyle = "#f87171";
        ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, TAU); ctx.fill();
        ctx.globalAlpha = inside ? 0.85 : 0.45;
        ctx.strokeStyle = inside ? "rgba(248,113,113,.95)" : "rgba(248,113,113,.55)";
        ctx.lineWidth = inside ? 3 : 2;
        ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 26;
        ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });
    }
  };

  /* ----------------------------------------------------------
   *  机器人小兵
   * ---------------------------------------------------------- */
  V.robot = function (ctx, m, t) {
    const side = m.side === 0 ? 0 : 1;
    const col = TEAM[side], dark = TEAM_DARK[side], light = TEAM_LIGHT[side];
    const walk = m.moving ? Math.sin((m.walkPhase || 0) * 1.6) : 0;
    const bob = m.moving ? Math.abs(Math.sin((m.walkPhase || 0) * 1.6)) * 1.8 : Math.sin(t * 2 + m.x * 0.05) * 0.8;
    const cy = m.y - 13 - bob;
    ctx.save();
    /* 影子 */
    ctx.globalAlpha = 0.3; ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(m.x, m.y + 4, 9, 3.6, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    /* 腿 */
    ctx.fillStyle = "#475569";
    ctx.fillRect(m.x - 6, m.y - 8, 4, 9 + walk * 2);
    ctx.fillRect(m.x + 2, m.y - 8, 4, 9 - walk * 2);
    /* 身体 */
    ctx.fillStyle = m.hitFlash > 0 ? "#fff" : "#64748b";
    ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 1.4;
    rrect(ctx, m.x - 8, cy - 4, 16, 15, 3);
    ctx.fill(); ctx.stroke();
    /* 胸口灯 */
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(m.x, cy + 3, 2.6, 0, TAU); ctx.fill();
    /* 头 */
    ctx.fillStyle = m.hitFlash > 0 ? "#fff" : "#94a3b8";
    rrect(ctx, m.x - 7, cy - 17, 14, 12, 3);
    ctx.fill(); ctx.stroke();
    /* 眼睛 */
    const ex = (m.facing && m.facing.x >= 0) ? 2 : -2;
    ctx.fillStyle = side === 0 ? "#fca5a5" : "#93c5fd";
    ctx.beginPath(); ctx.arc(m.x + ex, cy - 11, 2.2, 0, TAU); ctx.fill();
    /* 天线 */
    ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(m.x, cy - 17); ctx.lineTo(m.x, cy - 23); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(m.x, cy - 24, 1.8, 0, TAU); ctx.fill();
    /* 手臂（攻击时前伸） */
    const punch = m.atkAnim > 0 ? Math.sin((1 - m.atkAnim / 0.2) * Math.PI) * 7 : 0;
    ctx.strokeStyle = "#475569"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(m.x - 8, cy);
    ctx.lineTo(m.x - 11 - (m.facing.x < 0 ? punch : 0), cy + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.x + 8, cy);
    ctx.lineTo(m.x + 11 + (m.facing.x >= 0 ? punch : 0), cy + 7);
    ctx.stroke();
    /* 阵营肩章 */
    ctx.fillStyle = dark; ctx.fillRect(m.x - 8, cy - 1, 3, 4);
    ctx.fillStyle = light; ctx.fillRect(m.x + 5, cy - 1, 3, 4);
    /* 血条 */
    if (m.hp < m.maxHp) {
      const w = 20, y = cy - 30;
      ctx.fillStyle = "rgba(4,8,16,.7)"; ctx.fillRect(m.x - w / 2 - 1, y - 1, w + 2, 5);
      ctx.fillStyle = col; ctx.fillRect(m.x - w / 2, y, w * Math.max(0, m.hp / m.maxHp), 3);
    }
    ctx.restore();
  };

  /* ----------------------------------------------------------
   *  墓碑：阵亡位置 + 复活倒计时
   * ---------------------------------------------------------- */
  V.grave = function (ctx, g, t) {
    if (!g || !g.hero) return;
    const f = g.hero;
    const left = Math.max(0, Math.ceil(f.respawnT || 0));
    const h = 56;
    const im = imgOf("grave");
    const col = g.side === 0 ? "rgba(248,113,113," : "rgba(96,165,250,";
    ctx.save();
    /* 地面光圈 */
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = col + "0.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(g.x, g.y + 3, 20, 7, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    if (im) {
      const w = h * (im.naturalWidth / im.naturalHeight);
      ctx.drawImage(im, g.x - w / 2, g.y - h + 6, w, h);
    } else {
      ctx.fillStyle = "#94a3b8";
      rrect(ctx, g.x - 13, g.y - h + 10, 26, h - 12, 8); ctx.fill();
    }
    /* 倒计时 */
    ctx.font = "800 15px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#0b1220";
    ctx.fillText(left + "s", g.x + 1, g.y - h - 7);
    ctx.fillStyle = "#fde68a";
    ctx.fillText(left + "s", g.x, g.y - h - 8);
    ctx.font = "700 9px system-ui";
    ctx.fillStyle = "rgba(226,232,240,.75)";
    ctx.fillText("复活", g.x, g.y + 14);
    ctx.restore();
  };

  /* ----------------------------------------------------------
   *  高压弹
   * ---------------------------------------------------------- */
  V.bomb = function (ctx, b, t) {
    const left = Math.max(0, b.t);
    const pulse = 0.5 + Math.sin(t * 12) * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.10 + pulse * 0.08;
    ctx.fillStyle = "#fb923c";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = "rgba(251,146,60,.85)"; ctx.lineWidth = 2;
    ctx.setLineDash([10, 7]); ctx.lineDashOffset = -t * 24;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    /* 炸弹本体 */
    ctx.fillStyle = "#111827";
    ctx.beginPath(); ctx.arc(b.x, b.y - 12, 11, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x + 4, b.y - 22);
    ctx.quadraticCurveTo(b.x + 12, b.y - 30, b.x + 8, b.y - 36); ctx.stroke();
    ctx.fillStyle = pulse > 0.5 ? "#fff7d6" : "#fb923c";
    ctx.beginPath(); ctx.arc(b.x + 8, b.y - 37, 3 + pulse * 1.5, 0, TAU); ctx.fill();
    /* 倒计时数字 */
    ctx.font = "800 14px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fde68a";
    ctx.fillText(Math.ceil(left), b.x, b.y - 12);
    ctx.restore();
  };

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
})(window.LD = window.LD || {});
