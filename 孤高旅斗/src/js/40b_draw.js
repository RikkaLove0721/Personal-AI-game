/* ============================================================
 *  40b_draw.js - 战斗绘制：竞技场 / 实体 / 血条 / 弹道表现
 *  自 40_battle.js 拆分（v4.12 工程债）。只搬渲染代码，判定逻辑一行未改。
 *  皇冠图标 drawCrownIcon 只被 B.draw 用到，一并搬过来。
 * ============================================================ */
(function (LD) {
  "use strict";
  const C = LD.CONF, TAU = Math.PI * 2;
  const FX = LD.FX, V = LD.View;
  const clamp = V.clamp;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const B = LD.Battle;

  /* v3.9 皇冠图标：三尖一带的金色小皇冠，alpha 用于天降时的淡入 */
  function drawCrownIcon(ctx, x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(-14, 8); ctx.lineTo(-14, -6);
    ctx.lineTo(-7, 1); ctx.lineTo(0, -9);
    ctx.lineTo(7, 1); ctx.lineTo(14, -6);
    ctx.lineTo(14, 8);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -10, 0, 10);
    g.addColorStop(0, "#fff7d6"); g.addColorStop(0.5, "#fbbf24"); g.addColorStop(1, "#b45309");
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = "#78350f"; ctx.lineWidth = 1.2; ctx.stroke();
    /* 三颗宝石 */
    [[-9, 4], [0, 4], [9, 4]].forEach(p => {
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.7, 0, TAU);
      ctx.fillStyle = p[0] === 0 ? "#f87171" : "#60a5fa"; ctx.fill();
    });
    ctx.restore();
  }


  B.draw = function (ctx) {
    const W = C.W, H = C.H;
    this.updateCam();
    ctx.save();
    FX.applyShake(ctx);
    V.arena(ctx, W, H, this.t, this.theme, this.world);

    const worldDraw = () => {
      FX.drawGround(ctx);
      /* v3.7 塔防：基地回血圈、兵线指示与敌方攻击范围 */
      if (this.rule === "tower" && V.towerField) V.towerField(ctx, this);
      /* v3.8 塔防：炸弹画在地面之上、角色之下 */
      if (this.rule === "tower" && V.bomb) (this.bombs || []).forEach(b => V.bomb(ctx, b, this.t));
      /* ---- v2.7 毒圈绘制：缩圈乱斗的多个安全圈 / 追猎时刻的大毒圈，通用同款画法 ---- */
      const poisonSets = [];
      if (this.rule === "ring" && this.rings)
        poisonSets.push({ list: this.rings.filter(c => !c.dead), ink: "rgba(120,10,30,.36)", line: "rgba(248,113,113,.95)", safe: true });
      if (this.rule === "hunt" && this.huntRing)
        poisonSets.push({ list: [this.huntRing], ink: "rgba(120,10,30,.34)", line: "rgba(248,113,113,.9)", safe: false });
      /* v4.0 世界末日：旧版「庇护所外整片红圈」已随出圈掉血一起移除 ——
       * 悬崖地形本身就是边界（深渊 + 崖壁由 V.doomChasm 绘制），再叠一层红会把整张图染成暗红色 */
      poisonSets.forEach(set => {
        if (!set.list.length) return;
        ctx.save();
        /* 先铺满整块场地，再把安全圈作为「洞」挖掉（evenodd 填充） */
        ctx.beginPath();
        ctx.rect(-40, B.world.pt - 120, B.world.w + 80, B.world.h - B.world.pt + 160);
        set.list.forEach(c => { ctx.moveTo(c.x + c.r, c.y); ctx.arc(c.x, c.y, c.r, 0, TAU, true); });
        ctx.fillStyle = set.ink;
        ctx.fill("evenodd");
        ctx.setLineDash([18, 12]); ctx.lineDashOffset = -this.t * 30;
        set.list.forEach(c => {
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU);
          ctx.strokeStyle = set.line; ctx.lineWidth = 4; ctx.stroke();
          if (set.safe) {                     // 安全圈再描一层绿色内边，区分「圈内安全」
            ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(4, c.r - 6), 0, TAU);
            ctx.strokeStyle = "rgba(52,211,153,.5)"; ctx.lineWidth = 2; ctx.stroke();
          }
        });
        ctx.setLineDash([]);
        ctx.restore();
      });
      /* v4.2 世界末日：整块右大陆是危险区（等同圈外掉血），铺一层缓慢呼吸的红雾 + 虚线边界 */
      if (this.rule === "doomsday") {
        const L = LD.Terrain && LD.Terrain.doomLand;
        if (L) {
          const m = L.main;
          ctx.save();
          ctx.globalAlpha = 0.74 + Math.sin(this.t * 1.7) * 0.12;
          ctx.fillStyle = "rgba(120,10,30,.26)";
          ctx.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
          ctx.globalAlpha = 1;
          ctx.setLineDash([20, 13]); ctx.lineDashOffset = -this.t * 26;
          ctx.strokeStyle = "rgba(248,113,113,.85)"; ctx.lineWidth = 5;
          ctx.strokeRect(m.x0 + 3, m.y0 + 3, m.x1 - m.x0 - 6, m.y1 - m.y0 - 6);
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
      if (this.rule === "doomsday" && this.shelter && this.shelter.gaps) {
        const D = LD.DOOMSDAY || {};
        const gr = D.gateR || 92;
        const pulse = 0.5 + Math.sin(this.t * 2.4) * 0.14;
        this.shelter.gaps.forEach(g => {
          ctx.save();
          ctx.globalAlpha = 0.1 + Math.sin(this.t * 2.4) * 0.03;   // 减速圈淡青色底
          ctx.fillStyle = "#67e8f9";
          ctx.beginPath(); ctx.arc(g.x, g.y, gr, 0, TAU); ctx.fill();
          ctx.globalAlpha = pulse;
          ctx.setLineDash([10, 8]); ctx.lineDashOffset = -this.t * 22;
          ctx.strokeStyle = "rgba(103,232,249,.95)"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(g.x, g.y, gr, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.5 + Math.sin(this.t * 3) * 0.16;
          ctx.strokeStyle = "rgba(52,211,153,.85)"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(g.x, g.y, 34, 46, 0, 0, TAU); ctx.stroke();
          ctx.restore();
        });
      }
      /* v4.5 护送情报箱：交付点 + 地上的箱子 + 持箱者引导线 */
      if (this.rule === "escort" && this.drawEscort) this.drawEscort(ctx);
      /* v4.6 占点争夺：据点圈 + 归属旗 + 占领读条 */
      if (this.rule === "capture" && this.drawCapture) this.drawCapture(ctx);
      /* v4.8 碰碰车竞技：场外水池 + 擂台警示带 + 车辆耐久条 */
      if (this.rule === "bump" && this.drawBump) this.drawBump(ctx);
      /* v4.11 烫手山芋：山芋本体 + 持有者高亮 + 倒计时 */
      if (this.rule === "hotpotato" && this.drawHotPotato) this.drawHotPotato(ctx);
      /* v4.12 娱乐模式批次：各自的场地元素（终点线 / 安全位 / 岩浆格 / 炮台 / 得分区） */
      if (LD.isCasual && LD.isCasual(this.rule) && this.drawCasual) this.drawCasual(ctx);
      /* v3.9.1 停电夜战：充电站（排在掉落物之前，压在人物下层） */
      if (this.drawStations) this.drawStations(ctx);
      /* v3.1 补给掉落物：血包 / 能量包 / 移速包 */
      (this.pickups || []).forEach(pk => {
        const bob = Math.sin(this.t * 4 + pk.x * 0.05) * 3;
        const col = pk.kind === "heal" ? "#34d399" : pk.kind === "energy" ? "#818cf8" : "#fbbf24";
        const edge = pk.kind === "heal" ? "#065f46" : pk.kind === "energy" ? "#3730a3" : "#92400e";
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, pk.x, pk.y - 14 + bob, 26, col, 0.42);
        ctx.restore();
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.3)";
        ctx.beginPath(); ctx.ellipse(pk.x, pk.y + 8, 13, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pk.x, pk.y - 30 + bob);
        ctx.lineTo(pk.x + 12, pk.y - 18 + bob);
        ctx.lineTo(pk.x + 12, pk.y - 4 + bob);
        ctx.lineTo(pk.x, pk.y + 8 + bob);
        ctx.lineTo(pk.x - 12, pk.y - 4 + bob);
        ctx.lineTo(pk.x - 12, pk.y - 18 + bob);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff";
        if (pk.kind === "heal") {
          ctx.fillRect(pk.x - 2.4, pk.y - 21 + bob, 4.8, 12);
          ctx.fillRect(pk.x - 6, pk.y - 17.4 + bob, 12, 4.8);
        } else if (pk.kind === "energy") {
          ctx.beginPath();
          ctx.moveTo(pk.x + 1, pk.y - 24 + bob); ctx.lineTo(pk.x - 5, pk.y - 12 + bob);
          ctx.lineTo(pk.x - 0.5, pk.y - 12 + bob); ctx.lineTo(pk.x - 2, pk.y - 2 + bob);
          ctx.lineTo(pk.x + 6, pk.y - 15 + bob); ctx.lineTo(pk.x + 1, pk.y - 15 + bob);
          ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(pk.x - 7, pk.y - 19 + bob); ctx.lineTo(pk.x - 1, pk.y - 19 + bob);
          ctx.lineTo(pk.x - 5, pk.y - 10 + bob); ctx.lineTo(pk.x + 1, pk.y - 10 + bob);
          ctx.lineTo(pk.x - 4, pk.y - 1 + bob); ctx.lineTo(pk.x - 2, pk.y - 12 + bob);
          ctx.lineTo(pk.x - 8, pk.y - 12 + bob);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      });
      /* v3.9 霸主争霸：皇冠预警圈（地面）与落下的皇冠 */
      if (this.rule === "overlord" && this.crown && this.crown.phase !== "held") {
        const cw = this.crown, C = LD.CROWN || {};
        ctx.save();
        const bob = Math.sin(this.t * 4) * 3;
        if (cw.phase === "warn") {
          /* 落点：收缩的金色圆环 + 倒计时 */
          const p = 1 - Math.max(0, cw.warnT) / (C.warnT || 5);
          ctx.globalAlpha = 0.5 + Math.sin(this.t * 9) * 0.2;
          ctx.strokeStyle = "#fcd34d"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(cw.x, cw.y, 46, 22, 0, 0, TAU); ctx.stroke();
          ctx.setLineDash([6, 6]);
          ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(cw.x, cw.y, 46 + (1 - p) * 40, 22 + (1 - p) * 19, 0, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          /* 天上的皇冠随倒计时下降 */
          const drop = Math.max(0, 1 - cw.warnT / (C.warnT || 5));
          const cy = cw.y - 260 * (1 - drop);
          drawCrownIcon(ctx, cw.x, cy, 1.1, 0.55 + drop * 0.45);
          ctx.fillStyle = "#fde68a"; ctx.font = "bold 13px ui-monospace,Menlo,Consolas,monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText("皇冠 " + Math.ceil(Math.max(0, cw.warnT)) + "s", cw.x, cy - 22);
        } else if (cw.phase === "fallen") {
          ctx.globalAlpha = 0.85;
          V.glow(ctx, cw.x, cw.y - 14, 44, "rgba(252,211,77,.55)", 1);
          ctx.fillStyle = "rgba(0,0,0,.28)";
          ctx.beginPath(); ctx.ellipse(cw.x, cw.y + 6, 22, 8, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          drawCrownIcon(ctx, cw.x, cw.y - 18 + bob, 1.35, 1);
        }
        ctx.restore();
      }

      /* v3.9 蓄力进度条（能量包开包 / 霸主加冕）：头顶进度 + 剩余秒数 */
      this.fighters.forEach(f => {
        if (!f.chg || f.dead) return;
        const cfg = (LD.CHARGE || {})[f.chg.kind] || { need: 5, label: "蓄力", color: "#818cf8" };
        const p = Math.max(0, Math.min(1, f.chg.t / cfg.need));
        const bw = 74, bh = 7, bx = f.x - bw / 2, by = f.y - 84;
        ctx.save();
        ctx.fillStyle = "rgba(10,12,22,.72)";
        ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.fillStyle = "rgba(148,163,184,.28)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = cfg.color;
        ctx.fillRect(bx, by, bw * p, bh);
        ctx.strokeStyle = "rgba(226,232,240,.9)"; ctx.lineWidth = 1;
        ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
        ctx.fillStyle = "#e2e8f0"; ctx.font = "11px ui-monospace,Menlo,Consolas,monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(cfg.label + " " + (cfg.need - f.chg.t).toFixed(1) + "s", f.x, by - 4);
        ctx.restore();
      });
      (this.coins || []).forEach(c => {                 // 军备竞赛：局内金币
        const bob = Math.sin(this.t * 5 + c.x) * 3;
        ctx.save();
        V.glow(ctx, c.x, c.y - 12 + bob, 22, "rgba(252,211,77,.5)", 1);
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath(); ctx.arc(c.x, c.y - 12 + bob, 8, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#b45309"; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = "#fde68a";
        ctx.beginPath(); ctx.arc(c.x - 2.4, c.y - 15 + bob, 2.6, 0, TAU); ctx.fill();
        ctx.restore();
      });
      if (this.magnetT > 0) {                           // 磁暴坦克：极性反转中心提示
        const cx = B.world.w / 2, cy = (B.world.pt + B.world.h) / 2;
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, cx, cy, 120 + Math.sin(this.t * 8) * 22, "rgba(167,139,250,.35)", 1);
        ctx.restore();
      }
      /* v2.6 新区域预警圈（霜压 / 绝对零度 / 轮盘 / 雷暴） */
      this.zones.forEach(z => {
        if ((z.type !== "quake" && z.type !== "zero" && z.type !== "roul" && z.type !== "bolt") || z.life >= z.warn) return;
        const p = Math.min(1, z.life / z.warn);
        const col = z.type === "quake" ? "147,197,253" : z.type === "zero" ? "191,219,254"
          : z.type === "roul" ? (z.big ? "248,113,113" : "52,211,153") : "167,139,250";
        ctx.save();
        ctx.globalAlpha = 0.10 + p * 0.2;
        ctx.fillStyle = "rgb(" + col + ")";
        ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.55, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = "rgb(" + col + ")"; ctx.lineWidth = 2.4;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.55, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });

      /* v3.1 爆裂之火：外圈预警 + 内圈安全区（挖空） */
      this.zones.forEach(z => {
        if (z.type !== "blaze" || z.life >= z.warn) return;
        const p = Math.min(1, z.life / z.warn);
        const outer = z.r, inner = z.inner || 40;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(z.x, z.y, outer, outer * 0.58, 0, 0, TAU);
        ctx.ellipse(z.x, z.y, inner, inner * 0.58, 0, 0, TAU);
        ctx.globalAlpha = 0.12 + p * 0.22;
        ctx.fillStyle = "#fb923c";
        ctx.fill("evenodd");
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "rgba(251,146,60,.95)"; ctx.lineWidth = 2.6;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.ellipse(z.x, z.y, outer, outer * 0.58, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(134,239,172,.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(z.x, z.y, inner, inner * 0.58, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      });

      // 激光预警
      this.fighters.forEach(f => {
        if (f.kind !== "hero") return;
        ["skill1", "skill2"].forEach(slot => {
          const id = f.loadout[slot]; if (id !== "laserWave") return;
          const sk = LD.skill(id), s = f.slot[slot];
          if (s.phase !== "laserCharge") return;
          const a = Math.atan2(f.facing.y, f.facing.x);
          ctx.save();
          ctx.translate(f.x, f.y - 26); ctx.rotate(a);
          ctx.globalAlpha = 0.22 + s.t * 0.5;
          const g = ctx.createLinearGradient(0, 0, sk.range, 0);
          g.addColorStop(0, "rgba(103,232,249,.9)"); g.addColorStop(1, "rgba(103,232,249,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, -sk.width / 2, sk.range, sk.width);
          ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(224,251,255,.85)"; ctx.lineWidth = 2;
          ctx.strokeRect(0, -sk.width / 2, sk.range, sk.width);
          ctx.restore();
        });
      });

      // 区域（火柱 / 激光实体）
      this.zones.forEach(z => {
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        if (z.type === "beam") {
          const a = z.life / z.max, alpha = Math.max(0, 1 - a);
          ctx.globalAlpha = alpha;
          const w = z.w * (1 - a * 0.45);
          ctx.strokeStyle = "#e0fbff"; ctx.lineWidth = w * 0.34;
          ctx.beginPath(); ctx.moveTo(z.x0, z.y0); ctx.lineTo(z.x1, z.y1); ctx.stroke();
          ctx.strokeStyle = z.color; ctx.lineWidth = w; ctx.globalAlpha = alpha * 0.5;
          ctx.beginPath(); ctx.moveTo(z.x0, z.y0); ctx.lineTo(z.x1, z.y1); ctx.stroke();
        } else if (z.type === "frost") {
          ctx.globalCompositeOperation = "source-over";
          const a = Math.min(1, z.life * 6) * Math.min(1, (z.max - z.life) * 1.4);
          ctx.globalAlpha = 0.5 * a;
          ctx.fillStyle = "#7cb8ff";
          ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.5, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.85 * a;
          ctx.strokeStyle = "#e0f2fe"; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * 0.8, z.r * 0.4, 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 0.9 * a;
          ctx.strokeStyle = "rgba(191,219,254,.8)"; ctx.lineWidth = 1.2;
          for (let k = 0; k < 3; k++) {
            const ang = z.x * 0.7 + k * 2.1;
            ctx.beginPath();
            ctx.moveTo(z.x + Math.cos(ang) * z.r * 0.55, z.y + Math.sin(ang) * z.r * 0.28);
            ctx.lineTo(z.x - Math.cos(ang) * z.r * 0.55, z.y - Math.sin(ang) * z.r * 0.28);
            ctx.stroke();
          }
        } else if (z.type === "fire") {
          ctx.globalCompositeOperation = "source-over";
          const a = Math.min(1, z.life * 5) * Math.min(1, (z.max - z.life) * 2);
          const g = ctx.createRadialGradient(z.x, z.y - 20, 10, z.x, z.y - 20, z.r);
          g.addColorStop(0, "rgba(254,215,120," + 0.5 * a + ")");
          g.addColorStop(0.55, "rgba(251,146,60," + 0.34 * a + ")");
          g.addColorStop(1, "rgba(239,68,68,0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(z.x, z.y - 20, z.r, 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.75 * a; ctx.strokeStyle = "#fb923c"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.45, 0, 0, TAU); ctx.stroke();
        } else if (z.type === "water") {
          ctx.globalCompositeOperation = "lighter";
          const a = Math.min(1, z.life * 6) * Math.min(1, (z.max - z.life) * 2.5);
          V.glow(ctx, z.x, z.y, z.r * 2.1, "rgba(103,232,249," + 0.55 * a + ")", 1);
          ctx.globalAlpha = a;
          ctx.fillStyle = "#7dd3fc"; ctx.strokeStyle = "#e0f2fe"; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,.75)";
          ctx.beginPath(); ctx.arc(z.x - z.r * 0.3, z.y - z.r * 0.3, z.r * 0.28, 0, TAU); ctx.fill();
        } else if (z.type === "prison") {
          ctx.globalCompositeOperation = "source-over";
          const a = Math.min(1, z.life * 4) * Math.min(1, (z.max - z.life) * 1.6);
          ctx.globalAlpha = 0.14 * a; ctx.fillStyle = "#7c3aed";
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.95 * a; ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 5;
          ctx.setLineDash([18, 10]); ctx.lineDashOffset = -z.life * 60;
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.5 * a; ctx.strokeStyle = "#ede9fe"; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r - 7, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 0.8 * a;
          ctx.font = "700 13px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#c4b5fd";
          ctx.fillText("绝望囚牢 " + Math.max(0, z.max - z.life).toFixed(1) + "s", z.x, z.y - z.r - 12);
        } else if (z.type === "shuriken") {
          // 螺旋手里剑：巨大蓝色能量球 + 旋转叶片
          const a = Math.min(1, z.life * 5);
          ctx.globalAlpha = a;
          V.glow(ctx, z.x, z.y, z.r * 2.4, "rgba(56,189,248,.55)", 1);
          ctx.save();
          ctx.translate(z.x, z.y); ctx.rotate(z.spin || 0);
          ctx.strokeStyle = "rgba(224,242,254,.95)"; ctx.lineWidth = 4; ctx.lineCap = "round";
          for (let b = 0; b < 4; b++) {
            ctx.rotate(Math.PI / 2);
            ctx.beginPath(); ctx.moveTo(z.r * 0.25, 0); ctx.quadraticCurveTo(z.r * 0.7, -z.r * 0.34, z.r * 0.95, 0);
            ctx.quadraticCurveTo(z.r * 0.7, z.r * 0.34, z.r * 0.25, 0); ctx.stroke();
          }
          const gg = ctx.createRadialGradient(0, 0, 2, 0, 0, z.r * 0.5);
          gg.addColorStop(0, "rgba(255,255,255,.95)"); gg.addColorStop(1, "rgba(56,189,248,.85)");
          ctx.fillStyle = gg;
          ctx.beginPath(); ctx.arc(0, 0, z.r * 0.5, 0, TAU); ctx.fill();
          ctx.restore();
        } else if (z.type === "pillar") {
          if (z.life < z.warn) {
            ctx.globalAlpha = 0.32 + Math.sin(z.life * 40) * 0.18;
            ctx.strokeStyle = "#fb923c"; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.45, 0, 0, TAU); ctx.stroke();
          } else {
            const p = Math.min(1, (z.life - z.warn) / 0.14);
            ctx.globalAlpha = 0.95;
            const hgt = 210 * p;
            const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y - hgt);
            g.addColorStop(0, "rgba(255,220,150,.95)"); g.addColorStop(0.4, "rgba(251,146,60,.75)"); g.addColorStop(1, "rgba(251,113,133,0)");
            ctx.fillStyle = g;
            ctx.fillRect(z.x - z.r * 0.62, z.y - hgt, z.r * 1.24, hgt);
            V.glow(ctx, z.x, z.y, z.r * 1.5, "rgba(251,146,60,.6)", 1);
          }
        }
        ctx.restore();
      });

      // 弹道
      this.projs.forEach(p => this.drawProj(ctx, p));

      // 天外来物：技能 / 大招掉落物（降落 2 秒后落地可拾取）
      (this.gifts || []).forEach(g => {
        const sk = LD.skill(g.id);
        if (!sk) return;
        const fall = g.landed ? 0 : 1 - g.t / ((LD.GIFTS && LD.GIFTS.fallT) || 2);
        const yy = g.y - 16 - fall * 130;
        const isUlt = g.kind === "ult";
        ctx.save();
        // 影子
        ctx.globalAlpha = 0.3; ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(g.x, g.y + 4, 16 * (1 - fall * 0.5), 6 * (1 - fall * 0.5), 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, g.x, yy, isUlt ? 40 : 28, isUlt ? "rgba(252,211,77,.8)" : "rgba(103,232,249,.8)", 1);
        ctx.globalCompositeOperation = "source-over";
        ctx.font = (isUlt ? "24px" : "19px") + " system-ui";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(sk.icon || "?", g.x, yy);
        if (!g.landed) {
          ctx.globalAlpha = 0.7; ctx.strokeStyle = isUlt ? "#fcd34d" : "#67e8f9"; ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.arc(g.x, g.y, 20, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.font = "700 11px system-ui";
          ctx.fillStyle = isUlt ? "#fcd34d" : "#7fe6f7";
          ctx.fillText(isUlt ? "大招" : "技能", g.x, yy + (isUlt ? 24 : 22));
        }
        ctx.restore();
      });

      // v2.7 血包（「回复」修饰符 / 缩圈模式圈外补给）
      (this.heals || []).forEach(h => {
        const H = LD.HEALS || {};
        const fall = h.landed ? 0 : 1 - h.t / (H.fallT || 1.4);
        const yy = h.y - 12 - fall * 120;
        ctx.save();
        ctx.globalAlpha = 0.3; ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(h.x, h.y + 4, 13 * (1 - fall * 0.5), 5 * (1 - fall * 0.5), 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, h.x, yy, 26, "rgba(52,211,153,.75)", 1);
        ctx.globalCompositeOperation = "source-over";
        // 白色药箱 + 绿色十字
        ctx.fillStyle = "#f8fafc"; ctx.strokeStyle = "#047857"; ctx.lineWidth = 1.6;
        V.rr(ctx, h.x - 10, yy - 8, 20, 16, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#10b981";
        ctx.fillRect(h.x - 2.2, yy - 6, 4.4, 12);
        ctx.fillRect(h.x - 6, yy - 2.2, 12, 4.4);
        if (h.landed) {
          ctx.font = "700 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = "#6ee7b7";
          ctx.fillText("血包", h.x, yy + 22);
        }
        ctx.restore();
      });

      // 能量石（霸主争霸）
      if (this.stone) {
        const s = this.stone, pulse = 0.6 + Math.sin(this.t * 8) * 0.35;
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, s.x, s.y - 22, 46 * pulse, "rgba(252,211,77,.85)", 1);
        ctx.translate(s.x, s.y - 22); ctx.rotate(this.t * 2.4);
        ctx.fillStyle = "#fcd34d"; ctx.strokeStyle = "#fffbeb"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -16); ctx.lineTo(11, 0); ctx.lineTo(0, 16); ctx.lineTo(-11, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.save(); ctx.font = "700 11px system-ui"; ctx.textAlign = "center";
        ctx.fillStyle = "#fcd34d"; ctx.fillText(s.landed ? "能量石" : "飞散中…", s.x, s.y + 18); ctx.restore();
      }

      // 王从天降：红圈落点标记（未触发二段时只有释放者自己看得见）
      const meHero = this.hero(this.mySide == null ? 0 : this.mySide);
      this.fighters.forEach(f => {
        const m = f.kingMark;
        if (!m || f.dead) return;
        if (!m.global && f !== meHero) return;
        const pulse = 0.55 + Math.sin(this.t * 7) * 0.3;
        ctx.save();
        ctx.globalAlpha = m.global ? 0.85 : 0.4;
        ctx.strokeStyle = "#ef4444"; ctx.lineWidth = m.global ? 5 : 3;
        ctx.setLineDash([14, 9]);
        ctx.beginPath(); ctx.arc(m.x, m.y, 170 * pulse, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = m.global ? 0.16 : 0.08; ctx.fillStyle = "#ef4444";
        ctx.beginPath(); ctx.arc(m.x, m.y, 170, 0, TAU); ctx.fill();
        ctx.restore();
      });

      // 角色 + 地形障碍统一按 y 排序，保证人站在箱子前面 / 后面时遮挡关系正确
      const drawList = this.fighters.map(f => ({ f: f, y: f.y + (f.kind === "dragon" ? 20 : 0), prop: null }));
      if (this.terrain) this.terrain.props.forEach(o => {
        if (o.dead || o.kind === "bush" || o.kind === "water") return;
        drawList.push({ f: null, y: o.y + o.h / 2, prop: o });
      });
      drawList.sort((a, b) => a.y - b.y);
      drawList.forEach(it => {
        const f = it.f;
        if (it.prop) { V.prop(ctx, it.prop, this.t); return; }
        if (f.dead && f.corpseGone) return;        // v3.5 超过 10 具的老丧尸尸体已消失
        if (f.dead && this.rule === "tower") return;   // v3.7 塔防：阵亡尸体不留在场上（等复活）
        if (f.bench) return;                       // 车轮战板凳：不渲染
        if (f.rideCar || f.hiddenNet) return;      // v3.3 坐在车里 / 客机收到躲藏状态：只画车或什么都不画
        if (f.hideProp && f !== meHero) return;    // v3.3 躲在柜子里：别人看不见
        /* v3.1 草丛隐身：对手在草丛里时本地看不见 */
        if (f.bushHide && !this.sameTeam(meHero, f)) return;
        if (f.kind === "laneMinion") {              // v3.7 塔防：机器人小兵
          if (!f.dead) V.robot(ctx, f, this.t);
          return;
        }
        if (f.kind === "minion") {                 // v2.6 杂兵（机械蜂等）
          if (!f.dead) V.minion(ctx, f, this.t);
          return;
        }
        if (f.kind === "dragon") {
          /* 尸体 3 秒后消失（最后 1 秒渐隐） */
          if (!(f.dead && (this.dragonCorpseT || 0) > 3)) {
            const corpse = f.dead ? Math.max(0, (this.dragonCorpseT || 0)) : 0;
            ctx.save();
            if (f.dead) ctx.globalAlpha = corpse > 2 ? Math.max(0, 1 - (corpse - 2)) : 1;
            V.dragon(ctx, f, this.t);
            ctx.restore();
          }
          return;
        }
        /* 自己在草丛里：半透明，方便看清走位 */
        const bushAlpha = (f.inBush && f === meHero) ? 0.62 : 1;
        if (bushAlpha < 1) { ctx.save(); ctx.globalAlpha = bushAlpha; }
        // 蓄力光环
        if (f.slot.skill1.phase === "blinkCharge" || f.slot.skill2.phase === "blinkCharge") {
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          V.glow(ctx, f.x, f.y - 26, 56, "rgba(248,113,113," + (0.35 + Math.sin(this.t * 14) * 0.15) + ")", 1);
          ctx.restore();
        }
        if (f.buff.rush > 0) {
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          V.glow(ctx, f.x, f.y - 26, 48, "rgba(251,191,36,.45)", 1); ctx.restore();
        }
        // 血怒 / 千剑 光环
        if (f.buff.rage > 0 || f.buff.thousand > 0) {
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          V.glow(ctx, f.x, f.y - 26, 46, f.buff.rage > 0 ? "rgba(244,114,182,.42)" : "rgba(165,243,252,.42)", 1);
          ctx.restore();
        }
        // 能量满时脚下光圈
        if (f.energy >= f.maxEnergy && !f.dead) {
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.5 + Math.sin(this.t * 5) * 0.2;
          ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, 22, 8, 0, 0, TAU); ctx.stroke(); ctx.restore();
        }
        // 隐匿自视角：蓝色灵光环绕（只有自己看得见，别人眼里依然完全隐形）
        if (f === meHero && f.stealthT > 0 && !f.dead) {
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          const sa = 0.38 + Math.sin(this.t * 6) * 0.16;
          V.glow(ctx, f.x, f.y - 26, 54, "rgba(147,197,253," + sa + ")", 1);
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = "rgba(147,197,253,.75)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, 27, 12, 0, 0, TAU); ctx.stroke();
          ctx.restore();
        }
        // 隐匿：自己的视角半透明（闪烁期全显），敌人视角完全消失（闪烁期显形）
        if (f.stealthT > 0 && !f.dead) {
          const flash = !f._ghostNoFlash && f.stealthT > 1.6 && f.stealthT <= 2.0;
          if (f !== meHero && !flash) return;        // 别人视角：完全看不见
          /* v3.9.1 停电夜战里全员一直在隐身状态，再压到 45% 就黑得看不见自己了，
           * 这里按模式给个更实心的自视角——黑幕本来就够暗了。 */
          ctx.save(); ctx.globalAlpha = flash ? 1 : (this.rule === "blackout" ? 0.85 : 0.45);
        }
        // 王从天降：飞天阶段整体上移
        if (f.kingRise > 0) {
          ctx.save();
          ctx.translate(0, -80 * f.kingRise);
        }
        V.chibi(ctx, f.x, f.y, f.facing, f.look, {
          t: this.t, moving: f.moving, walkPhase: f.walkPhase,
          atk: f.atkAnim > 0 ? Math.min(1, 1 - f.atkAnim / Math.max(0.01, f.atkDur)) : 0,
          weapon: f.atkAnim > 0, weaponColor: "#7fe6f7",
          flash: f.hitFlash, dead: f.dead, blinkAmt: f.blinkAmt,
          shield: f.shield > 0 ? 1 : 0
        });
        if (f.stealthT > 0 && !f.dead) ctx.restore();
        if (f.kingRise > 0) {
          ctx.restore();
          ctx.save(); ctx.globalAlpha = 0.3 * (1 - f.kingRise * 0.5);
          ctx.fillStyle = "#000"; ctx.beginPath();
          ctx.ellipse(f.x, f.y, 16 * (1 - f.kingRise * 0.4), 6 * (1 - f.kingRise * 0.4), 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
        if (f.stun > 0) {
          ctx.save(); ctx.font = "700 13px system-ui"; ctx.textAlign = "center";
          ctx.fillStyle = "#fcd34d"; ctx.fillText("✦", f.x, f.y - 76); ctx.restore();
        }
        if (f.root > 0) {
          ctx.save(); ctx.globalAlpha = 0.8; ctx.strokeStyle = "#6ee7b7"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, 24, 9, 0, 0, TAU); ctx.stroke(); ctx.restore();
        }
        // 名字（阵营模式在名字前加彩色圆点，霸主加皇冠；自己标「你」，不再一律显示「勇者」）
        /* v3.9：走 LD.teamColor，塔防的红 / 蓝两队不再被四队配色染成黄名 */
        const meF2 = this.hero(this.mySide == null ? 0 : this.mySide);
        ctx.save(); ctx.font = "600 11px system-ui"; ctx.textAlign = "center";
        const baseNm = f.name || (f.side === 0 ? "房主" : "玩家" + (f.side + 1));
        const nm = (meF2 && meF2 === f) ? "你 · " + baseNm : baseNm;
        const dot = (f.team != null && f.team >= 0 && !f.isZombie) ? (LD.teamColor ? LD.teamColor(f.team) : (LD.TEAM_COLORS || [])[f.team]) : null;
        const label = ((f.overlord || f.huntRole === "hunter") ? "👑 " : "") + nm;
        ctx.fillStyle = f.isZombie ? "rgba(163,230,53,.95)" : (dot || (f.side === 0 ? "rgba(159,230,247,.9)" : "rgba(255,170,180,.9)"));
        ctx.fillText(label, f.x, f.y + 20);
        if (dot) {
          const w = ctx.measureText(label).width;
          ctx.beginPath(); ctx.arc(f.x - w / 2 - 7, f.y + 16, 4, 0, TAU); ctx.fillStyle = dot; ctx.fill();
        }
        ctx.restore();
        // 霸主金色光环
        if (f.overlord) {
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.45 + Math.sin(this.t * 6) * 0.2;
          ctx.strokeStyle = "#fcd34d"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, 28, 11, 0, 0, TAU); ctx.stroke(); ctx.restore();
        }
        if (bushAlpha < 1) ctx.restore();
        // 索敌标记：本地玩家锁定的目标头顶黄色三角
        {
          const meF = this.hero(this.mySide == null ? 0 : this.mySide);
          if (meF && meF !== f && meF.lock === f.side && !f.dead) {
            const yy = f.y - 74 + Math.sin(this.t * 5) * 4;
            ctx.save(); ctx.fillStyle = "#fcd34d"; ctx.strokeStyle = "rgba(120,80,0,.8)"; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(f.x, yy + 12); ctx.lineTo(f.x - 10, yy - 6); ctx.lineTo(f.x + 10, yy - 6);
            ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
          }
        }
      });

      /* v3.1 草丛前景层：站在草丛里的人被草叶遮住 */
      if (this.terrain) V.bushPass(ctx, this.terrain, this.t);

      /* v3.8 塔防：墓碑压在角色之上，倒计时不会被挡住 */
      if (this.rule === "tower" && V.grave) (this.graves || []).forEach(g => V.grave(ctx, g, this.t));

      /* v3.3 交互提示浮窗（靠近柜子 / 车 / 掉落物 / 泥土时显示 O + 动作） */
      if (this.drawInteractHints) this.drawInteractHints(ctx);

      FX.draw(ctx);
    };

    /* v2.6 世界坐标 → 屏幕：世界内容随摄像机平移（大招演出期间交给 Cine 自己做特写变换） */
    const drawWorld = () => {
      const co = LD.Cine.active ? { x: 0, y: 0 } : (this.cam || { x: 0, y: 0 });
      ctx.save();
      ctx.translate(-Math.round(co.x), -Math.round(co.y));
      if (this.terrain) {
        /* v3.0：地面材质替换原来的空白网格底；边界与顶部渐变仍由 V.ground 补 */
        V.terrainGround(ctx, this.terrain, this.t, co, W, H);
        V.ground(ctx, this.world, this.t, true);
        V.terrainFlat(ctx, this.terrain, this.t);
      } else {
        V.ground(ctx, this.world, this.t);
      }
      worldDraw();
      ctx.restore();
    };

    if (LD.Cine.active) {
      LD.Cine.draw(ctx, W, H, drawWorld);
    } else {
      drawWorld();
      /* v2.6 大地图：视野外的敌人用屏幕边缘箭头提示方位 */
      const meCam = this.fighters.find(f => f.side === this.mySide && f.kind === "hero") || this.fighters[0];
      this.fighters.forEach(f => {
        if (f === meCam || f.dead || f.kind === "minion" || f.bench || f.isClone) return;
        if (this.sameTeam(meCam, f)) return;
        const sx = f.x - (this.cam ? this.cam.x : 0), sy = f.y - (this.cam ? this.cam.y : 0);
        if (sx > 14 && sx < W - 14 && sy > 14 && sy < H - 14) return;
        const cx = clamp(sx, 22, W - 22), cy = clamp(sy, 22, H - 22);
        const ang = meCam ? Math.atan2(f.y - meCam.y, f.x - meCam.x) : 0;
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.fillStyle = "rgba(251,113,133,.9)";
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      // 倒计时
      if (this.state === "countdown") {
        const n = Math.ceil(this.countdown);
        ctx.save(); ctx.textAlign = "center";
        ctx.font = "900 70px system-ui"; ctx.fillStyle = "rgba(255,255,255,.9)";
        ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 24;
        ctx.fillText(n > 0 ? String(Math.min(3, n)) : "GO", W / 2, H * 0.42);
        ctx.restore();
      }
    }
    /* v3.9.1 停电夜战：全屏黑幕。画在战斗内容与屏幕边缘指示箭头之上、
     * 倒计时与「被糊住了」提示之下——黑幕该盖住场上的人，但不该盖住提示文字。 */
    if (this.drawNight) this.drawNight(ctx, W, H);
    ctx.restore();
    FX.drawFlash(ctx, W, H);

    // 致盲（粪击命中）：屏幕中央出现巨大的不透明棕色波浪圆，背后完全看不见
    const meF = this.hero(this.mySide == null ? 0 : this.mySide);
    if (meF && meF.blind > 0 && !meF.dead) {
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) * 0.44;
      ctx.save();
      // 波浪圆主体（完全不透明，遮死背后画面）
      ctx.beginPath();
      const wob = 6, wobA = 0.055, t = this.t || 0;
      for (let i = 0; i <= 72; i++) {
        const ang = (i / 72) * TAU;
        const rr = R * (1 + Math.sin(ang * wob + t * 2.2) * wobA);
        const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = "#5b3a17";
      ctx.fill();
      ctx.lineWidth = 10; ctx.strokeStyle = "#3f2710"; ctx.stroke();
      // 内部旋涡纹路（只是装饰，不透出画面）
      ctx.clip();
      ctx.globalAlpha = 0.22;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const ang = (i / 60) * TAU * 1.6 + k * 1.57 + t * 0.6;
          const rr = R * 0.16 + i * R * 0.013;
          const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "#7a5222"; ctx.lineWidth = 9;
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.font = "700 15px system-ui"; ctx.textAlign = "center";
      ctx.fillStyle = "#fcd34d";
      ctx.fillText("被糊住了！ " + meF.blind.toFixed(1) + "s", W / 2, H * 0.14);
      ctx.restore();
    }
  };

  B.drawProj = function (ctx, p) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (p.type === "bomb") {
      const k = 1 - p.life / p.data.fuse;
      ctx.fillStyle = "#a78bfa";
      ctx.beginPath(); ctx.arc(p.x, p.y, 11 + Math.sin(p.life * 30) * 2, 0, TAU); ctx.fill();
      V.glow(ctx, p.x, p.y, 46, "rgba(167,139,250,.75)", 1);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(196,181,253,.8)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.data.R, 0, TAU); ctx.stroke();
      ctx.restore(); return;
    }
    if (p.type === "wind") {
      ctx.translate(p.x, p.y); ctx.rotate(p.life * 12);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = i % 2 ? "rgba(167,243,208,.85)" : "rgba(255,255,255,.6)";
        ctx.lineWidth = 3 - i * 0.5;
        ctx.beginPath(); ctx.arc(0, 0, p.r * (0.35 + i * 0.3), 0.4, 3.6); ctx.stroke();
      }
      V.glow(ctx, 0, 0, p.r * 1.6, "rgba(110,231,183,.5)", 1);
      ctx.restore(); return;
    }
    if (p.type === "palm") {
      ctx.translate(p.x, p.y);
      const a = Math.atan2(p.vy, p.vx);
      ctx.rotate(a);
      V.glow(ctx, 0, 0, p.r * 1.9, "rgba(251,191,36,.55)", 1);
      ctx.fillStyle = "rgba(253,230,138,.9)";
      for (let i = -2; i <= 2; i++) { V.rr(ctx, 6, i * 13 - 5, 26, 10, 5); ctx.fill(); }
      V.rr(ctx, -26, -18, 34, 36, 12); ctx.fill();
      ctx.restore(); return;
    }
    if (p.type === "void") {
      ctx.translate(p.x, p.y);
      const a = Math.atan2(p.vy, p.vx);
      ctx.rotate(a + Math.sin(p.life * 10) * 0.05);
      V.glow(ctx, 0, 0, p.r * 3, "rgba(251,191,36,.6)", 1);
      const g = ctx.createLinearGradient(-70, 0, 70, 0);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,251,235,.95)"); g.addColorStop(1, "rgba(251,146,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-90, 0); ctx.lineTo(0, -p.r); ctx.lineTo(90, 0); ctx.lineTo(0, p.r); ctx.closePath(); ctx.fill();
      ctx.restore(); return;
    }
    if (p.type === "sword") {
      ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      V.glow(ctx, 0, 0, p.r * 2.4, "rgba(165,243,252,.7)", 1);
      ctx.fillStyle = "#f0feff";
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(0, -3.4); ctx.lineTo(14, 0); ctx.lineTo(0, 3.4); ctx.closePath(); ctx.fill();
      ctx.restore(); return;
    }
    if (p.type === "shuriken") {
      // 黑侠客飞镖：旋转四角星
      ctx.translate(p.x, p.y); ctx.rotate(p.life * 16);
      V.glow(ctx, 0, 0, p.r * 2.2, "rgba(103,232,249,.7)", 1);
      ctx.fillStyle = "#e0faff";
      for (let b = 0; b < 4; b++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(p.r * 0.4, -p.r * 0.35); ctx.lineTo(p.r, 0); ctx.lineTo(p.r * 0.4, p.r * 0.35);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath(); ctx.arc(0, 0, p.r * 0.3, 0, TAU); ctx.fill();
      ctx.restore(); return;
    }
    if (p.type === "dung") {
      ctx.globalCompositeOperation = "source-over";
      const a = Math.atan2(p.vy, p.vx);
      ctx.translate(p.x, p.y); ctx.rotate(a);
      const s = p.r / 26;
      ctx.font = Math.round(44 * s) + "px system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("💩", 0, 0);
      ctx.restore(); return;
    }
    if (p.type === "hbomb") {
      ctx.globalCompositeOperation = "source-over";
      const a = Math.atan2(p.vy, p.vx);
      ctx.translate(p.x, p.y); ctx.rotate(a);
      const wob = Math.sin(p.life * 26) * 0.12;
      ctx.rotate(wob);
      ctx.font = "26px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🧨", 0, 0);
      ctx.rotate(-wob);
      // 倒计时文字
      const tv = Math.max(0, p.data.timer || 0);
      ctx.font = "800 14px system-ui";
      ctx.fillStyle = tv < 1.2 ? "#ef4444" : "#fbbf24";
      ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 3;
      const txt = tv.toFixed(1);
      ctx.strokeText(txt, 0, -24); ctx.fillText(txt, 0, -24);
      // 爆炸范围预警圈
      ctx.globalAlpha = 0.3 + Math.sin(p.life * 18) * 0.12;
      ctx.strokeStyle = tv < 1.2 ? "#ef4444" : "#fbbf24"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, p.data.boomR || 150, 0, TAU); ctx.stroke();
      ctx.restore(); return;
    }
    if (p.type === "arrow" || p.type === "sarrow") {
      ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
      V.glow(ctx, 0, 0, p.r * 2.6, "rgba(253,230,138,.7)", 1);
      ctx.fillStyle = "#fef9c3";
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -p.r * 0.7); ctx.lineTo(-6, 0); ctx.lineTo(-10, p.r * 0.7); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(253,224,71,.8)"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-8, 0); ctx.stroke();
      ctx.restore(); return;
    }
    if (p.type === "hook") {
      // 钩索：钩头 + 回到主人的绳索
      const own = p.owner;
      if (own) {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(148,163,184,.85)"; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(own.x, own.y - 26); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.translate(p.x, p.y); ctx.rotate(p.life * 14);
      ctx.globalCompositeOperation = "lighter";
      V.glow(ctx, 0, 0, p.r * 2.4, "rgba(203,213,225,.7)", 1);
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath(); ctx.arc(0, 0, p.r * 0.55, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0.6, 4.2); ctx.stroke();
      ctx.restore(); return;
    }
    // 默认（火球）
    const col = p.reflect ? "#22d3ee" : p.color;
    V.glow(ctx, p.x, p.y, p.r * (p.reflect ? 3.6 : 3), (p.reflect ? "rgba(165,243,252,.85)" : "rgba(255,220,170,.85)"), 1);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.fillStyle = p.reflect ? "#e0faff" : p.core;
    ctx.beginPath(); ctx.arc(p.x - p.vx * 0.004, p.y - p.vy * 0.004, p.r * 0.55, 0, TAU); ctx.fill();
    ctx.restore();
  };
})(window.LD = window.LD || {});
