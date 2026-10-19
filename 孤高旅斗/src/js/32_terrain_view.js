/* ============================================================
 *  32_terrain_view.js — v3.0 地形渲染（程序化像素贴图）
 * ============================================================
 *  素材按类型分区缓存：
 *    ground:<材质>      地面纹理（3 个变体，40x40 无缝重复）
 *    prop:<材质>        障碍顶面纹理（64x64）
 *  全部用固定种子程序化生成，不依赖外部图片；同一种材质每局一致。
 * ============================================================ */
(function (LD) {
  "use strict";
  const V = LD.View;
  const TAU = Math.PI * 2;
  const TILE = 40;

  const groundCanvas = {};
  const propCanvas = {};
  const patterns = {};

  function cnv(w, h) {
    try {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      return c;
    } catch (e) { return null; }
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function groundDef(id) {
    return (LD.TERRAIN.grounds || []).find(g => g.id === id) || LD.TERRAIN.grounds[0];
  }

  /* ---------------- 地面纹理 ---------------- */
  function makeGround(id, v) {
    const def = groundDef(id), p = def.pal;
    const c = cnv(TILE, TILE);
    if (!c) return null;
    const g = c.getContext("2d");
    if (!g) return null;
    const R = rng(hash(id) + v * 977);
    g.fillStyle = p.base; g.fillRect(0, 0, TILE, TILE);

    /* 低对比噪点：2px 像素块，看得出材质但不抢视觉 */
    for (let i = 0; i < 30; i++) {
      const x = (R() * TILE) | 0, y = (R() * TILE) | 0;
      const s = R() < 0.58 ? 2 : 3;
      g.fillStyle = R() < 0.5 ? p.a : p.b;
      g.globalAlpha = 0.55;
      g.fillRect(x - (x % 2), y - (y % 2), s, s);
    }
    g.globalAlpha = 1;

    /* 不同材质的小特征 */
    if (id === "grass") {
      for (let i = 0; i < 7; i++) {
        const x = (R() * TILE) | 0, y = (R() * TILE) | 0;
        g.strokeStyle = p.c; g.globalAlpha = 0.42; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 1, y - 4); g.moveTo(x + 2, y); g.lineTo(x + 3, y - 3); g.stroke();
      }
    } else if (id === "stone" || id === "metal") {
      /* 石板接缝：每隔一格一条极淡的线，形成砖块感 */
      g.globalAlpha = 0.28; g.strokeStyle = p.b; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0.5); g.lineTo(TILE, 0.5);
      g.moveTo(0.5, 0); g.lineTo(0.5, TILE);
      if (id === "stone") { g.moveTo(TILE / 2, 0); g.lineTo(TILE / 2, TILE / 2); }
      g.stroke();
    } else if (id === "wood") {
      g.globalAlpha = 0.3; g.strokeStyle = p.b; g.lineWidth = 1;
      for (let y = 8; y < TILE; y += 13) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(TILE, y + 0.5); g.stroke(); }
    } else if (id === "sand" || id === "snow" || id === "ash") {
      for (let i = 0; i < 12; i++) {
        g.globalAlpha = 0.22; g.fillStyle = p.c;
        g.fillRect((R() * TILE) | 0, (R() * TILE) | 0, 1, 1);
      }
    }
    g.globalAlpha = 1;
    return c;
  }

  function groundPattern(ctx, id, v) {
    const key = id + ":" + v;
    if (patterns[key]) return patterns[key];
    if (!groundCanvas[key]) groundCanvas[key] = makeGround(id, v);
    const cv = groundCanvas[key];
    if (!cv || !ctx.createPattern) return defColor(id);
    try { patterns[key] = ctx.createPattern(cv, "repeat"); } catch (e) { patterns[key] = null; }
    return patterns[key] || defColor(id);
  }
  function defColor(id) {
    const d = groundDef(id);
    return (d && d.pal && d.pal.base) || "#333944";
  }

  /** 画可见范围内的地面材质（ctx 已随摄像机平移） */
  V.terrainGround = function (ctx, map, t, cam, vw, vh) {
    if (!map || !map.ground) return;
    const c0 = Math.max(0, Math.floor((cam ? cam.x : 0) / TILE) - 1);
    const r0 = Math.max(0, Math.floor(((cam ? cam.y : 0) - map.top) / TILE) - 1);
    const c1 = Math.min(map.cols - 1, Math.ceil(((cam ? cam.x : 0) + (vw || 960)) / TILE) + 1);
    const r1 = Math.min(map.rows - 1, Math.ceil(((cam ? cam.y : 0) + (vh || 600) - map.top) / TILE) + 1);
    const baseId = (map.cfg && map.cfg.ground) || "grass";
    /* 主材质整块铺（逐格 fillRect 在非整数缩放下会产生拼缝），斑块按行合并后半透明叠加 */
    const gx = c0 * TILE, gy = map.top + r0 * TILE;
    ctx.fillStyle = groundPattern(ctx, baseId, 0);
    ctx.fillRect(gx, gy, (c1 - c0 + 1) * TILE, (r1 - r0 + 1) * TILE);
    for (let r = r0; r <= r1; r++) {
      const row = map.ground[r];
      if (!row) continue;
      let c = c0;
      while (c <= c1) {
        const id = row[c] || baseId;
        if (id === baseId) { c++; continue; }
        let c2 = c;
        while (c2 + 1 <= c1 && (row[c2 + 1] || baseId) === id) c2++;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = groundPattern(ctx, id, 0);
        ctx.fillRect(c * TILE, map.top + r * TILE, (c2 - c + 1) * TILE, TILE);
        ctx.restore();
        c = c2 + 1;
      }
    }
    /* 场地四周压暗一圈，让地图边界更清楚 */
    ctx.save();
    ctx.strokeStyle = "rgba(6,10,18,.55)"; ctx.lineWidth = 10;
    ctx.strokeRect(-5, map.top - 5, map.cols * TILE + 10, map.rows * TILE + 10);
    ctx.restore();
  };

  /* ---------------- 障碍顶面纹理 ---------------- */
  function makeProp(mat) {
    const c = cnv(64, 64);
    if (!c) return null;
    const g = c.getContext("2d");
    if (!g) return null;
    const p = mat.pal, R = rng(hash(mat.id));
    g.fillStyle = p.top; g.fillRect(0, 0, 64, 64);

    if (/crate_wood|block_wood|wood|bamboo/i.test(mat.id)) {
      /* 木板：竖纹 + 板缝 */
      for (let x = 0; x < 64; x += 10) {
        g.fillStyle = (x / 10) % 2 ? p.top : p.hi;
        g.globalAlpha = 0.45; g.fillRect(x, 0, 5, 64);
      }
      g.globalAlpha = 0.75; g.strokeStyle = p.lo; g.lineWidth = 1;
      for (let x = 0; x < 64; x += 13) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 64); g.stroke(); }
      g.globalAlpha = 1;
    } else if (/crate_metal|metal/i.test(mat.id)) {
      /* 钢板 + 铆钉 */
      g.globalAlpha = 0.5; g.fillStyle = p.hi; g.fillRect(4, 4, 56, 56);
      g.globalAlpha = 0.75; g.strokeStyle = p.edge; g.lineWidth = 2; g.strokeRect(4.5, 4.5, 55, 55);
      g.fillStyle = p.spec;
      [[10, 10], [54, 10], [10, 54], [54, 54]].forEach(([x, y]) => {
        g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill();
      });
      g.globalAlpha = 1;
    } else if (/clay/i.test(mat.id)) {
      g.globalAlpha = 0.5; g.strokeStyle = p.lo; g.lineWidth = 2;
      g.beginPath(); g.arc(32, 32, 20, 0, TAU); g.stroke();
      g.globalAlpha = 0.9; g.strokeStyle = p.spec; g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = 10 + i * 10;
        g.beginPath(); g.moveTo(12, y); g.quadraticCurveTo(32, y + 4, 52, y); g.stroke();
      }
      g.globalAlpha = 1;
    } else if (/crystal/i.test(mat.id)) {
      g.globalAlpha = 0.7;
      g.fillStyle = p.spec;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        const x = 12 + i * 13;
        g.moveTo(x, 56); g.lineTo(x + 6, 8); g.lineTo(x + 12, 56);
        g.closePath(); g.fill();
      }
      g.globalAlpha = 0.35; g.fillStyle = "#fff";
      g.fillRect(0, 0, 64, 6);
      g.globalAlpha = 1;
    } else {
      /* 石材：碎石噪点 + 裂纹 */
      for (let i = 0; i < 90; i++) {
        g.fillStyle = R() < 0.5 ? p.hi : p.lo;
        g.globalAlpha = 0.35 + R() * 0.3;
        g.fillRect((R() * 64) | 0, (R() * 64) | 0, 1 + ((R() * 3) | 0), 1 + ((R() * 3) | 0));
      }
      g.globalAlpha = 0.5; g.strokeStyle = p.edge; g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        const x = 8 + R() * 48, y = 8 + R() * 48;
        g.moveTo(x, y); g.lineTo(x + R() * 18 - 9, y + R() * 18 - 9);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    /* 统一的内描边，贴图缩放到任意格数时都有清晰的块感 */
    g.globalAlpha = 0.55; g.strokeStyle = p.edge; g.lineWidth = 2;
    g.strokeRect(1, 1, 62, 62);
    g.globalAlpha = 1;
    return c;
  }

  function allMats() {
    const m = LD.TERRAIN.mats;
    return [].concat(m.solid || [], m.breakable || [], m.pushable || [], m.fence || [],
      m.bush || [], m.water || [], m.barrel || [], m.car || [], m.tire || [],
      m.supply || [], m.barricade || [], m.locker || [], m.mud || []);
  }

  function propPattern(ctx, matId) {
    if (matId.indexOf("fence_") === 0) return null;
    if (patterns["p:" + matId]) return patterns["p:" + matId];
    const mat = allMats().find(m => m.id === matId);
    if (!mat) return "#666";
    if (!propCanvas[matId]) propCanvas[matId] = makeProp(mat);
    const cv = propCanvas[matId];
    if (!cv || !ctx.createPattern) return mat.pal.top;
    try { patterns["p:" + matId] = ctx.createPattern(cv, "repeat"); } catch (e) { patterns["p:" + matId] = null; }
    return patterns["p:" + matId] || mat.pal.top;
  }

  function matOf(o) {
    const m = allMats().find(x => x.id === o.mat);
    return m || { pal: { top: "#666", hi: "#888", lo: "#444", edge: "#222", spec: "#ccc" }, elev: 26 };
  }

  /* ---------------- 障碍绘制 ---------------- */
  V.prop = function (ctx, o, t) {
    if (!o || o.dead) return;
    const mat = matOf(o);
    const p = mat.pal;
    const w = o.w, h = o.h, x = o.x, y = o.y;
    const x0 = x - w / 2, y0 = y - h / 2;
    const base = y0 + h;
    const el = o.elev || mat.elev || 26;

    /* 投影 */
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.30)";
    ctx.beginPath(); ctx.ellipse(x + 3, base - 2, w * 0.56, h * 0.26, 0, 0, TAU); ctx.fill();
    ctx.restore();

    if (o.kind === "bush" || o.kind === "water") return;      // 由 V.bushPass / V.terrainFlat 绘制
    /* v3.7 塔防建筑：防御塔 / 水晶（贴图或程序化） */
    if ((o.kind === "tower" || o.kind === "crystal") && V.structure) { V.structure(ctx, o, t); return; }
    if (o.kind === "fence") { drawFence(ctx, o, mat, x0, y0, w, h, base, el); return; }
    if (o.kind === "barrel") { drawBarrel(ctx, o, mat, x0, top0(o, y0, el), w, h, el); return; }
    if (o.kind === "tire") { drawTire(ctx, o, mat, x0, y0, w, h, el); return; }
    if (o.kind === "car") { drawCar(ctx, o, mat, x0, y0, w, h, el); return; }
    if (o.kind === "locker") { drawLocker(ctx, o, mat, x0, y0, w, h, el); return; }
    if (o.kind === "mud") { drawMud(ctx, o, mat, x0, y0, w, h); return; }
    if (o.kind === "blower") { drawBlower(ctx, o, mat, x0, y0, w, h, el, t); return; }
    if (o.kind === "supply") { drawSupply(ctx, o, mat, x0, top0(o, y0, el), w, h, el); return; }
    if (o.kind === "barricade") { drawBarricade(ctx, o, mat, x0, top0(o, y0, el), w, h, el); return; }

    const topY = y0 - el;
    if (o.shape === "round") {
      /* 标准圆柱：侧面（左右暗中间亮）+ 椭圆顶面贴图 */
      const rx = w / 2 - 1;
      const ry = Math.min(h * 0.30, 14);
      const cyT = y0 + ry;
      const cyB = y0 + h - ry;
      const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      grad.addColorStop(0, p.lo); grad.addColorStop(0.35, p.top);
      grad.addColorStop(0.62, p.hi); grad.addColorStop(1, p.edge);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - rx, cyT);
      ctx.lineTo(x - rx, cyB);
      ctx.ellipse(x, cyB, rx, ry, 0, Math.PI, 0, true);
      ctx.lineTo(x + rx, cyT);
      ctx.closePath(); ctx.fill();
      /* 顶面（在障碍自身的局部坐标系里填充，贴图随方块移动） */
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, cyT, rx, ry, 0, 0, TAU); ctx.clip();
      ctx.translate(x0, topY);
      ctx.fillStyle = propPattern(ctx, o.mat);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      ctx.strokeStyle = p.edge; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(x, cyT, rx, ry, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = p.hi; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(x - rx * 0.16, cyT - ry * 0.18, rx * 0.62, ry * 0.52, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      /* 正面 */
      const fg = ctx.createLinearGradient(0, base - el, 0, base);
      fg.addColorStop(0, p.lo); fg.addColorStop(1, p.edge);
      ctx.fillStyle = fg;
      ctx.fillRect(x0, base - el, w, el);
      /* 顶面（在障碍自身的局部坐标系里填充，贴图随方块移动） */
      ctx.save();
      ctx.translate(x0, topY);
      ctx.fillStyle = propPattern(ctx, o.mat);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      /* 棱线 */
      ctx.strokeStyle = p.edge; ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 1, topY + 1, w - 2, h - 2);
      ctx.strokeStyle = p.hi; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0 + 2, topY + h - 2); ctx.lineTo(x0 + w - 2, topY + h - 2); ctx.stroke();
      ctx.globalAlpha = 1;
      /* 货箱交叉木条 */
      if (/crate_wood/.test(o.mat)) {
        ctx.strokeStyle = p.lo; ctx.globalAlpha = 0.75; ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x0 + 7, topY + 7); ctx.lineTo(x0 + w - 7, topY + h - 7);
        ctx.moveTo(x0 + w - 7, topY + 7); ctx.lineTo(x0 + 7, topY + h - 7);
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    }

    /* 受损裂纹 + 受击白闪 */
    if (o.maxHp > 0) {
      const dmgR = 1 - o.hp / o.maxHp;
      if (dmgR > 0.02) {
        const R = rng(hash(o.mat) + o.uid * 131);
        ctx.save();
        ctx.strokeStyle = "rgba(10,10,14,.72)"; ctx.lineWidth = 1.4;
        const n = 1 + Math.floor(dmgR * 5);
        for (let i = 0; i < n; i++) {
          let cx = x0 + 8 + R() * (w - 16), cy = topY + 8 + R() * (h - 16);
          ctx.beginPath(); ctx.moveTo(cx, cy);
          for (let k = 0; k < 3; k++) {
            cx += R() * 18 - 9; cy += R() * 14 - 7;
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      if (o.hp < o.maxHp) {
        const bw = Math.max(20, w * 0.62), bx = x - bw / 2, by = topY - 9;
        ctx.fillStyle = "rgba(4,8,16,.75)"; ctx.fillRect(bx, by, bw, 4);
        const ratio = Math.max(0, o.hp / o.maxHp);
        ctx.fillStyle = ratio > 0.55 ? "#7ff0c4" : ratio > 0.28 ? "#fbbf24" : "#f87171";
        ctx.fillRect(bx + 1, by + 1, (bw - 2) * ratio, 2);
      }
    }
    if (o.flash > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(0.55, o.flash * 3.4);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x0, topY, w, h + el * 0.4);
      ctx.restore();
    }
  };

  function top0(o, y0, el) { return y0 - el; }

  /* 炸药桶：圆柱体 + 铁箍 + 危险标记 */
  function drawBarrel(ctx, o, mat, x0, topY, w, h, el) {
    const p = mat.pal, x = x0 + w / 2, y0 = topY + el;
    const rx = w / 2 - 2, ry = Math.min(8, h * 0.16);
    const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    grad.addColorStop(0, p.lo); grad.addColorStop(0.36, p.top);
    grad.addColorStop(0.62, p.hi); grad.addColorStop(1, p.edge);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - rx, y0);
    ctx.lineTo(x - rx, y0 + el);
    ctx.ellipse(x, y0 + el, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(x + rx, y0);
    ctx.closePath(); ctx.fill();
    /* 顶盖 */
    ctx.fillStyle = p.top;
    ctx.beginPath(); ctx.ellipse(x, y0, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.edge; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y0, rx, ry, 0, 0, TAU); ctx.stroke();
    /* 铁箍 */
    ctx.strokeStyle = p.edge; ctx.globalAlpha = 0.8; ctx.lineWidth = 2.4;
    [0.32, 0.68].forEach(k => {
      const yy = y0 + el * k;
      ctx.beginPath(); ctx.ellipse(x, yy, rx, ry * 0.8, 0, 0, Math.PI); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    /* 危险标记 */
    ctx.fillStyle = p.spec; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y0 + el * 0.34);
    ctx.lineTo(x + 7, y0 + el * 0.56);
    ctx.lineTo(x - 7, y0 + el * 0.56);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.edge;
    ctx.fillRect(x - 1, y0 + el * 0.4, 2, el * 0.08);
    ctx.globalAlpha = 1;
  }

  /* 轮胎：圆环 + 轮毂 */
  function drawTire(ctx, o, mat, x0, y0, w, h, el) {
    const p = mat.pal, x = x0 + w / 2, y = y0 + h / 2 - el * 0.4;
    const r = Math.min(w, h) / 2 - 2;
    ctx.save();
    ctx.fillStyle = p.lo;
    ctx.beginPath(); ctx.ellipse(x, y + el * 0.25, r, r * 0.55, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.top;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.86, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.edge; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.86, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = p.hi;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.5, r * 0.44, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.edge;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.22, r * 0.2, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.spec; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.56, y + Math.sin(a) * r * 0.5);
      ctx.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* 汽车：车身 + 车顶 + 车窗 + 车轮（横放 / 竖放自动切换）
   * v3.3：大巴加长车窗；坦克单独走 drawTank */
  function drawCar(ctx, o, mat, x0, y0, w, h, el) {
    if (o.vtype === "tank") { drawTank(ctx, o, mat, x0, y0, w, h, el); return; }
    const p = mat.pal;
    const horiz = w >= h;
    const bodyH = Math.min(h, 52);
    const by = y0 + h - bodyH;
    const bus = o.vtype === "bus";
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.34)";
    ctx.beginPath(); ctx.ellipse(x0 + w / 2 + 3, y0 + h - 4, w * 0.55, h * 0.2, 0, 0, TAU); ctx.fill();
    /* 车身 */
    const g = ctx.createLinearGradient(0, by, 0, by + bodyH);
    g.addColorStop(0, p.hi); g.addColorStop(0.55, p.top); g.addColorStop(1, p.lo);
    ctx.fillStyle = g;
    const rad = Math.min(10, bodyH * 0.3);
    roundRect(ctx, x0 + 1, by + el * 0.15, w - 2, bodyH - el * 0.15, rad);
    ctx.fill();
    /* 车窗 */
    ctx.fillStyle = "rgba(186,230,253,.55)";
    if (horiz) {
      if (bus) {
        /* 大巴：四段长窗 */
        for (let i = 0; i < 4; i++) {
          roundRect(ctx, x0 + 10 + i * ((w - 24) / 4), by - el * 0.30, (w - 34) / 4, el * 0.34 + 6, 3);
          ctx.fill();
        }
      } else {
        roundRect(ctx, x0 + w * 0.24, by - el * 0.34, w * 0.46, el * 0.42 + 6, 4); ctx.fill();
      }
    } else {
      roundRect(ctx, x0 + 6, by + 4, w - 12, bodyH * 0.28, 4); ctx.fill();
    }
    /* 车顶 */
    ctx.fillStyle = p.lo;
    if (horiz) {
      if (bus) {
        roundRect(ctx, x0 + w * 0.20, by - el * 0.42, w * 0.58, el * 0.30, 4); ctx.fill();
        /* 车顶警示灯带 */
        ctx.fillStyle = "rgba(253,230,138,.55)";
        ctx.fillRect(x0 + w * 0.24, by - el * 0.46, w * 0.52, 2);
      } else { roundRect(ctx, x0 + w * 0.22, by - el * 0.4, w * 0.5, el * 0.34, 4); ctx.fill(); }
    } else { roundRect(ctx, x0 + 5, by + 2, w - 10, bodyH * 0.24, 4); ctx.fill(); }
    /* 前后灯 */
    ctx.fillStyle = p.spec;
    if (horiz) {
      ctx.fillRect(x0 + 3, by + bodyH * 0.34, 4, 5);
      ctx.fillRect(x0 + w - 7, by + bodyH * 0.34, 4, 5);
    } else {
      ctx.fillRect(x0 + 6, by + bodyH - 6, 6, 4);
      ctx.fillRect(x0 + w - 12, by + bodyH - 6, 6, 4);
    }
    /* 车轮 */
    ctx.fillStyle = "#111114";
    const wy = by + bodyH - 5;
    const wheels = horiz
      ? (bus ? [[x0 + w * 0.14, wy], [x0 + w * 0.40, wy], [x0 + w * 0.74, wy], [x0 + w * 0.90, wy]]
             : [[x0 + w * 0.24, wy], [x0 + w * 0.76, wy]])
      : [[x0 + 8, wy - 2], [x0 + w - 8, wy - 2]];
    wheels.forEach(([wx, w2]) => {
      ctx.beginPath(); ctx.ellipse(wx, w2, 7, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#52525b";
      ctx.beginPath(); ctx.ellipse(wx, w2, 3, 2.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#111114";
    });
    ctx.strokeStyle = p.edge; ctx.lineWidth = 1.6;
    roundRect(ctx, x0 + 1, by + el * 0.15, w - 2, bodyH - el * 0.15, rad); ctx.stroke();
    /* 驾驶中：前灯亮起 */
    if (o.driver) {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#fef9c3";
      ctx.beginPath(); ctx.ellipse(x0 + w + 8, by + bodyH * 0.42, 22, 8, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* 坦克：履带 + 车体 + 炮塔（炮管朝驾驶员面向） */
  function drawTank(ctx, o, mat, x0, y0, w, h, el) {
    const p = mat.pal, cx = x0 + w / 2, cy = y0 + h / 2 - el * 0.35;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.36)";
    ctx.beginPath(); ctx.ellipse(cx + 3, y0 + h - 5, w * 0.54, h * 0.2, 0, 0, TAU); ctx.fill();
    /* 履带 */
    ctx.fillStyle = "#1c1f18";
    roundRect(ctx, x0 + 1, y0 + 6, 14, h - 12, 7); ctx.fill();
    roundRect(ctx, x0 + w - 15, y0 + 6, 14, h - 12, 7); ctx.fill();
    ctx.strokeStyle = "#3d4436"; ctx.lineWidth = 1.2;
    for (let yy = y0 + 10; yy < y0 + h - 10; yy += 9) {
      ctx.beginPath(); ctx.moveTo(x0 + 3, yy); ctx.lineTo(x0 + 13, yy);
      ctx.moveTo(x0 + w - 13, yy); ctx.lineTo(x0 + w - 3, yy); ctx.stroke();
    }
    /* 车体 */
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, p.hi); g.addColorStop(0.55, p.top); g.addColorStop(1, p.lo);
    ctx.fillStyle = g;
    roundRect(ctx, x0 + 13, y0 + 4, w - 26, h - 8, 6); ctx.fill();
    ctx.strokeStyle = p.edge; ctx.lineWidth = 1.6;
    roundRect(ctx, x0 + 13, y0 + 4, w - 26, h - 8, 6); ctx.stroke();
    /* 炮塔 + 炮管 */
    const a = o.driver ? Math.atan2(o.driver.facing.y, o.driver.facing.x) : (w >= h ? 0 : -Math.PI / 2);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(a);
    ctx.fillStyle = p.lo;
    ctx.fillRect(0, -4, Math.max(20, w * 0.42), 8);
    ctx.strokeStyle = p.edge; ctx.lineWidth = 1.4; ctx.strokeRect(0, -4, Math.max(20, w * 0.42), 8);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU);
    ctx.fillStyle = p.hi; ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(-2, -2, 7, 0, TAU); ctx.fillStyle = p.top; ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  /* 柜子：两扇门 + 把手 + 顶面（比普通箱子高，方便一眼认出能躲） */
  /* v3.5 吹风机机身：金属方块 + 正面大风扇 + 顶部朝向箭头 + 受损血条 */
  function drawBlower(ctx, o, mat, x0, y0, w, h, el, t) {
    const p = mat.pal, base = y0 + h, cx = o.x;
    const topY = y0 - el;
    ctx.save();
    /* 顶面 */
    const tg = ctx.createLinearGradient(x0, topY, x0 + w, topY + h);
    tg.addColorStop(0, p.hi); tg.addColorStop(0.5, p.top); tg.addColorStop(1, p.lo);
    ctx.fillStyle = tg;
    ctx.fillRect(x0, topY, w, h);
    ctx.strokeStyle = p.edge; ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, topY + 1, w - 2, h - 2);
    /* 正面 */
    const fg = ctx.createLinearGradient(0, base - el, 0, base);
    fg.addColorStop(0, p.top); fg.addColorStop(0.65, p.lo); fg.addColorStop(1, p.edge);
    ctx.fillStyle = fg;
    ctx.fillRect(x0, base - el, w, el);
    ctx.strokeStyle = p.edge; ctx.lineWidth = 1.6;
    ctx.strokeRect(x0 + 1, base - el + 1, w - 2, el - 2);
    /* 风扇：外圈 + 旋转叶片 + 格栅 */
    const fy = base - el * 0.52, fr = Math.min(w, el) * 0.34;
    ctx.fillStyle = "rgba(8,14,26,.85)";
    ctx.beginPath(); ctx.arc(cx, fy, fr, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.hi; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, fy, fr, 0, TAU); ctx.stroke();
    ctx.save();
    ctx.translate(cx, fy);
    ctx.rotate(t * 7.5);
    ctx.fillStyle = p.spec;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(fr * 0.72, -fr * 0.30, fr * 0.86, 0);
      ctx.quadraticCurveTo(fr * 0.44, fr * 0.10, 0, 0);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(226,242,255,.30)"; ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(cx - fr * 0.9, fy + i * fr * 0.42);
      ctx.lineTo(cx + fr * 0.9, fy + i * fr * 0.42); ctx.stroke();
    }
    /* 顶部朝向箭头 */
    const d = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }][o.dir || 0];
    const ax = cx + d.x * (w * 0.30), ay = topY + h / 2 + d.y * (h * 0.30);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(125,211,252,.95)";
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(d.y, d.x) + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    /* 受损血条 */
    if (o.maxHp > 0 && o.hp < o.maxHp) {
      const bw = w * 0.82, bh = 4;
      const bx = cx - bw / 2, by = topY - 9;
      ctx.fillStyle = "rgba(8,14,26,.8)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      const r = Math.max(0, o.hp / o.maxHp);
      ctx.fillStyle = r > 0.5 ? "#4ade80" : (r > 0.25 ? "#fbbf24" : "#f87171");
      ctx.fillRect(bx, by, bw * r, bh);
    }
    ctx.restore();
  }

  function drawLocker(ctx, o, mat, x0, y0, w, h, el) {
    const p = mat.pal, base = y0 + h, cx = x0 + w / 2;
    const topY = y0 - el;
    ctx.save();
    /* 顶面 */
    ctx.fillStyle = p.top;
    ctx.fillRect(x0, topY, w, h);
    ctx.strokeStyle = p.edge; ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, topY + 1, w - 2, h - 2);
    ctx.fillStyle = p.hi; ctx.globalAlpha = 0.35;
    ctx.fillRect(x0 + 3, topY + 3, w - 6, 3); ctx.globalAlpha = 1;
    /* 正面 */
    const fg = ctx.createLinearGradient(0, base - el, 0, base);
    fg.addColorStop(0, p.lo); fg.addColorStop(1, p.edge);
    ctx.fillStyle = fg;
    ctx.fillRect(x0, base - el, w, el);
    /* 门缝 */
    ctx.strokeStyle = p.edge; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, base - el + 4); ctx.lineTo(cx, base - 4); ctx.stroke();
    /* 门板内框 */
    ctx.strokeStyle = p.hi; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 4, base - el + 5, w / 2 - 7, el - 10);
    ctx.strokeRect(cx + 3, base - el + 5, w / 2 - 7, el - 10);
    ctx.globalAlpha = 1;
    /* 把手 */
    ctx.fillStyle = p.spec;
    ctx.fillRect(cx - 5, base - el * 0.52, 2.4, 7);
    ctx.fillRect(cx + 2.6, base - el * 0.52, 2.4, 7);
    /* 躲了人：门缝透出一点光 */
    if (o.occupant) {
      ctx.save(); ctx.globalAlpha = 0.5;
      ctx.fillStyle = "rgba(165,180,252,.55)";
      ctx.fillRect(cx - 1, base - el + 6, 2, el - 12);
      ctx.restore();
    }
    ctx.restore();
  }

  /* 泥土：一整块圆滚滚的土坨（不挡路，按 P 可搬起） */
  function drawMud(ctx, o, mat, x0, y0, w, h) {
    const p = mat.pal, cx = o.x, cy = o.y + h * 0.04;
    const R = rng(hash(o.mat) + o.uid * 271);
    const rx = w * 0.44, ry = h * 0.40;
    ctx.save();
    /* 地面投影 */
    ctx.fillStyle = "rgba(0,0,0,.26)";
    ctx.beginPath(); ctx.ellipse(cx + 2, cy + h * 0.26, rx * 0.92, ry * 0.40, 0, 0, TAU); ctx.fill();
    /* 圆土块本体：左上受光、右下压暗 */
    const g = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.45, 2, cx, cy, Math.max(rx, ry) * 1.15);
    g.addColorStop(0, p.hi); g.addColorStop(0.55, p.top); g.addColorStop(1, p.lo);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.edge; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    /* 表面小颗粒（仍是一整块，只做质感） */
    for (let i = 0; i < 4; i++) {
      const a = R() * TAU, d = R() * 0.6;
      ctx.fillStyle = i % 2 ? p.lo : p.top;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d,
        1.6 + R() * 2.2, 1.2 + R() * 1.6, a, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    /* 顶部高光 */
    ctx.fillStyle = p.spec; ctx.globalAlpha = 0.32;
    ctx.beginPath(); ctx.ellipse(cx - rx * 0.34, cy - ry * 0.42, rx * 0.34, ry * 0.22, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* 五角星（补给箱中心标） */
  function starPath(ctx, cx, cy, R, ratio, rot) {
    const r = R * (ratio || 0.44);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot - Math.PI / 2 + i * Math.PI / 5;
      const rad = i % 2 === 0 ? R : r;
      const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /* 补给箱：蓝白配色 + 蓝光 + 星星标 */
  function drawSupply(ctx, o, mat, x0, topY, w, h, el) {
    const p = mat.pal, x = x0 + w / 2, y = topY + h / 2;
    const base = topY + h;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.ellipse(x + 2, base - 2, w * 0.5, h * 0.22, 0, 0, TAU); ctx.fill();
    /* 蓝光 */
    const gl = ctx.createRadialGradient(x, topY + h * 0.45, 4, x, topY + h * 0.45, Math.max(w, h) * 0.85);
    gl.addColorStop(0, "rgba(125,211,252,.34)");
    gl.addColorStop(1, "rgba(125,211,252,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(x0 - w * 0.5, topY - h * 0.5, w * 2, h * 2);
    /* 箱体 */
    const g = ctx.createLinearGradient(0, topY, 0, base);
    g.addColorStop(0, p.hi); g.addColorStop(0.5, p.top); g.addColorStop(1, p.lo);
    ctx.fillStyle = g;
    roundRect(ctx, x0 + 2, topY + 2, w - 4, h - 4, 5); ctx.fill();
    ctx.strokeStyle = "#e0f2fe"; ctx.lineWidth = 2;
    roundRect(ctx, x0 + 2, topY + 2, w - 4, h - 4, 5); ctx.stroke();
    /* 中心五角星标（v3.4：原来的十字改成星星） */
    const R = Math.min(w, h) * 0.27;
    ctx.save();
    ctx.shadowColor = "rgba(191,219,254,.9)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#f8fafc";
    starPath(ctx, x, y, R, 0.44, 0);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(30,64,175,.55)"; ctx.lineWidth = 1.2;
    starPath(ctx, x, y, R, 0.44, 0);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  /* 路障：橙白斜条纹 */
  function drawBarricade(ctx, o, mat, x0, topY, w, h, el) {
    const p = mat.pal;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.ellipse(x0 + w / 2 + 2, topY + h - 2, w * 0.52, h * 0.2, 0, 0, TAU); ctx.fill();
    const g = ctx.createLinearGradient(0, topY, 0, topY + h);
    g.addColorStop(0, p.hi); g.addColorStop(1, p.lo);
    ctx.fillStyle = g;
    roundRect(ctx, x0 + 1, topY + 2, w - 2, h - 4, 3); ctx.fill();
    ctx.save();
    roundRect(ctx, x0 + 1, topY + 2, w - 2, h - 4, 3); ctx.clip();
    ctx.fillStyle = "rgba(248,250,252,.85)";
    for (let i = -h; i < w + h; i += 22) {
      ctx.beginPath();
      ctx.moveTo(x0 + i, topY + h);
      ctx.lineTo(x0 + i + 10, topY + h);
      ctx.lineTo(x0 + i + 10 + h, topY);
      ctx.lineTo(x0 + i + h, topY);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = p.edge; ctx.lineWidth = 1.6;
    roundRect(ctx, x0 + 1, topY + 2, w - 2, h - 4, 3); ctx.stroke();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 水池（画在地面之上、角色之下） ---------- */
  /* v3.5 吹风机气流：1 格宽的长条，动态虚线沿风向流动 */
  function drawWindBand(ctx, o, t) {
    const TILE = 40, half = TILE / 2, L = (o.len || 3) * TILE;
    let bx, by, bw, bh;
    if (o.dir === 0) { bx = o.x + half; by = o.y - half; bw = L; bh = half * 2; }
    else if (o.dir === 2) { bx = o.x - half - L; by = o.y - half; bw = L; bh = half * 2; }
    else if (o.dir === 1) { bx = o.x - half; by = o.y + half; bw = half * 2; bh = L; }
    else { bx = o.x - half; by = o.y - half - L; bw = half * 2; bh = L; }
    const horiz = o.dir === 0 || o.dir === 2;
    ctx.save();
    /* 底色 */
    const g = horiz
      ? ctx.createLinearGradient(bx, 0, bx + bw, 0)
      : ctx.createLinearGradient(0, by, 0, by + bh);
    if (o.dir === 0 || o.dir === 1) { g.addColorStop(0, "rgba(186,230,253,.24)"); g.addColorStop(1, "rgba(186,230,253,.02)"); }
    else { g.addColorStop(0, "rgba(186,230,253,.02)"); g.addColorStop(1, "rgba(186,230,253,.24)"); }
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw, bh);
    /* 流动虚线 */
    ctx.strokeStyle = "rgba(224,242,254,.55)";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([12, 12]);
    ctx.lineDashOffset = -((t * 190) % 24);
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 11;
      ctx.beginPath();
      if (horiz) { ctx.moveTo(bx, o.y + off); ctx.lineTo(bx + bw, o.y + off); }
      else { ctx.moveTo(o.x + off, by); ctx.lineTo(o.x + off, by + bh); }
      ctx.globalAlpha = i === 1 ? 0.9 : 0.55;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  V.terrainFlat = function (ctx, map, t) {
    if (!map || !map.props) return;
    map.props.forEach(o => {
      if (o.dead) return;
      if (o.kind === "blower") { drawWindBand(ctx, o, t); return; }
      if (o.kind !== "water") return;
      const p = matOf(o).pal;
      const x = o.x, y = o.y, w = o.w, h = o.h;
      ctx.save();
      /* 水面 */
      const g = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
      g.addColorStop(0, p.lo); g.addColorStop(0.5, p.top); g.addColorStop(1, p.edge);
      ctx.globalAlpha = 0.82;
      roundRect(ctx, x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 14);
      ctx.fillStyle = g; ctx.fill();
      ctx.globalAlpha = 1;
      /* 岸线 */
      ctx.strokeStyle = "rgba(226,242,255,.35)"; ctx.lineWidth = 2;
      roundRect(ctx, x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 14); ctx.stroke();
      /* 波纹 */
      ctx.save();
      roundRect(ctx, x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 6, 14); ctx.clip();
      ctx.strokeStyle = "rgba(190,240,255,.4)"; ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const yy = y - h / 2 + 13 + i * (h / 3.4);
        ctx.beginPath();
        for (let xx = x - w / 2 + 6; xx < x + w / 2 - 6; xx += 8) {
          const off = Math.sin((xx * 0.05) + t * 1.6 + i) * 2.2;
          if (xx === x - w / 2 + 6) ctx.moveTo(xx, yy + off); else ctx.lineTo(xx, yy + off);
        }
        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 2 + i);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    });
  };

  /* ---------- 杂草（画在角色之上，站在里面会被遮住） ----------
   * v3.6：从「圆叶片团」改成「从地里长出来的尖刺草」——
   * 每丛都是从根部向上收尖的细长草叶，略带弯曲与随风摆动，
   * 根脚压一圈深色土痕，另加少量亮色尖草做层次。
   */
  V.bushPass = function (ctx, map, t) {
    if (!map || !map.props) return;
    map.props.forEach(o => {
      if (o.dead || o.kind !== "bush") return;
      const p = matOf(o).pal;
      const R = rng(hash(o.mat) + o.uid * 313);
      const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2;
      ctx.save();
      /* 根脚阴影 / 泥土 */
      ctx.fillStyle = "rgba(6,14,8,.34)";
      ctx.beginPath(); ctx.ellipse(o.x, y0 + o.h * 0.72, o.w * 0.46, o.h * 0.26, 0, 0, TAU); ctx.fill();

      /* 一根草叶：根部 (bx,by)，向上收成尖，lean 控制弯曲方向 */
      const blade = (bx, by, len, lean, wd, col) => {
        const sw = Math.sin(t * 1.7 + bx * 0.045 + by * 0.02) * (1.1 + len * 0.035);
        const tx = bx + Math.sin(lean) * len + sw;
        const ty = by - Math.cos(lean) * len;
        const mx = bx + Math.sin(lean) * len * 0.58 + sw * 0.55;
        const my = by - Math.cos(lean) * len * 0.58;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(bx - wd / 2, by);
        ctx.quadraticCurveTo(mx - wd * 0.34, my, tx, ty);
        ctx.quadraticCurveTo(mx + wd * 0.34, my, bx + wd / 2, by);
        ctx.closePath();
        ctx.fill();
      };

      /* 一丛一丛地长：每丛 4~7 根，根部散开一点；先铺一层贴地的短刺，再长高草 */
      const tufts = Math.max(10, Math.min(38, Math.round(o.w * o.h / 300)));
      for (let i = 0; i < tufts; i++) {
        const bx = x0 + 5 + R() * (o.w - 10);
        const by = y0 + o.h * (0.30 + R() * 0.66);
        const n = 4 + ((R() * 4) | 0);
        for (let k = 0; k < n; k++) {
          const len = o.h * 0.20 + R() * (o.h * 0.46);
          const lean = (R() - 0.5) * 0.95;
          const wd = 1.8 + R() * 1.9;
          const roll = R();
          const col = roll < 0.42 ? p.lo : (roll < 0.88 ? p.top : p.hi);
          blade(bx + (R() - 0.5) * 7, by + (R() - 0.5) * 4, len, lean, wd, col);
        }
        /* 贴地的短刺：让根部不是一根根光杆，而是一簇扎进土里 */
        const lowN = 2 + ((R() * 3) | 0);
        for (let k = 0; k < lowN; k++) {
          blade(bx + (R() - 0.5) * 10, by + (R() - 0.5) * 5,
            o.h * (0.08 + R() * 0.14), (R() - 0.5) * 1.5, 1.5 + R() * 1.2,
            R() < 0.5 ? p.lo : p.top);
        }
        /* 根部一小撮深色断茬 */
        if (R() < 0.55) {
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = p.edge;
          ctx.beginPath();
          ctx.ellipse(bx, by, 3.6 + R() * 2.4, 1.8 + R(), 0, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      /* 少量亮色尖草：用本材质的亮色（不能拿 spec —— 花丛的 spec 是淡紫，
       * 用上去会像一片白草），让整丛有层次但不跳色 */
      ctx.globalAlpha = 0.6;
      const hl = Math.max(3, Math.round(tufts * 0.26));
      for (let i = 0; i < hl; i++) {
        const bx = x0 + 6 + R() * (o.w - 12);
        const by = y0 + o.h * (0.34 + R() * 0.58);
        blade(bx, by, o.h * (0.34 + R() * 0.30), (R() - 0.5) * 0.85, 1.6, p.hi);
      }
      ctx.globalAlpha = 1;

      /* 花丛点缀：小四瓣花夹在草尖之间 */
      if (/flower/.test(o.mat)) {
        for (let i = 0; i < 5; i++) {
          const bx = x0 + 10 + R() * (o.w - 20);
          const by = y0 + o.h * (0.18 + R() * 0.55);
          ctx.fillStyle = R() < 0.5 ? "#e9d5ff" : "#fbcfe8";
          for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2 + 0.4;
            ctx.beginPath();
            ctx.ellipse(bx + Math.cos(a) * 1.9, by + Math.sin(a) * 1.9, 1.8, 1.5, a, 0, TAU);
            ctx.fill();
          }
          ctx.fillStyle = "#fde68a";
          ctx.beginPath(); ctx.arc(bx, by, 1.1, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    });
  };

  function drawFence(ctx, o, mat, x0, y0, w, h, base, el) {
    const p = mat.pal;
    const topY = y0 - el;
    const horiz = w >= h;
    ctx.save();
    ctx.strokeStyle = p.lo; ctx.lineCap = "round";
    /* 横杆 / 竖杆 */
    ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.12);
    const rails = horiz ? [topY + h * 0.28, topY + h * 0.68] : [x0 + w * 0.3, x0 + w * 0.7];
    ctx.strokeStyle = p.top;
    rails.forEach(v => {
      ctx.beginPath();
      if (horiz) { ctx.moveTo(x0 + 2, v); ctx.lineTo(x0 + w - 2, v); }
      else { ctx.moveTo(v, topY); ctx.lineTo(v, base); }
      ctx.stroke();
    });
    /* 立柱 */
    const posts = horiz ? [x0 + 5, x0 + w / 2, x0 + w - 5] : [topY + 6, topY + h / 2, base - 6];
    posts.forEach(v => {
      ctx.strokeStyle = p.hi; ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.14);
      ctx.beginPath();
      if (horiz) { ctx.moveTo(v, topY + 2); ctx.lineTo(v, base - 2); }
      else { ctx.moveTo(x0 + 2, v); ctx.lineTo(x0 + w - 2, v); }
      ctx.stroke();
    });
    /* 顶端高光 */
    ctx.globalAlpha = 0.35; ctx.strokeStyle = p.spec; ctx.lineWidth = 1;
    ctx.beginPath();
    if (horiz) { ctx.moveTo(x0 + 3, topY + 2); ctx.lineTo(x0 + w - 3, topY + 2); }
    else { ctx.moveTo(x0 + 2, topY + 2); ctx.lineTo(x0 + w - 2, topY + 2); }
    ctx.stroke();
    if (o.flash > 0) {
      ctx.globalAlpha = Math.min(0.5, o.flash * 3);
      ctx.fillStyle = "#fff"; ctx.fillRect(x0, topY, w, h + el * 0.3);
    }
    ctx.restore();
  }
})(window.LD = window.LD || {});
