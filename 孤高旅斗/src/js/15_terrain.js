/* ============================================================
 *  15_terrain.js — v3.1 地形生成与碰撞
 * ============================================================
 *  生成：滑条数量 + 随机种子 → 整格摆放的多格设施 + 地面材质网格
 *       建筑（room）先生成，用石墙围出带 1-2 个门洞的房间
 *  碰撞：挡人（圆 vs 圆 / 圆 vs 矩形）、挡飞行物、近战与爆炸伤害
 *  物理：可推动障碍受击 / 被角色推挤后获得速度，按质量换算加速度
 *  特殊：草丛隐身、水池减速、炸药桶爆炸、补给箱掉落、投掷木箱
 * ============================================================ */
(function (LD) {
  "use strict";

  const T = LD.Terrain = {};
  const TILE = 40;

  /* 固定种子 PRNG：联机两端用同一个 seed 生成同一张图 */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  T.mulberry32 = mulberry32;

  T.palColors = function (mat) {
    const p = (mat && mat.pal) || {};
    return [p.hi || "#fff", p.top || "#888", p.lo || "#444", p.spec || "#ddd"];
  };

  /* 取某种类型可用的材质列表（noRandom 的专用材质不参与随机生成） */
  function matsOf(cfg, kind) {
    const all = (LD.TERRAIN.mats[kind] || []).filter(m => !m.noRandom);
    const want = cfg.mats && cfg.mats[kind];
    if (!want || !want.length) return all;
    const list = want.map(id => all.find(m => m.id === id)).filter(Boolean);
    return list.length ? list : all;
  }

  /* v3.3：车辆材质抽取 —— 普通车为主，大巴次之，坦克概率很小 */
  function pickCarMat(rnd, list) {
    if (!list || !list.length) return null;
    const CFG = LD.VEHICLE_CFG || {};
    const tanks = list.filter(m => m.vehicle === "tank");
    const buses = list.filter(m => m.vehicle === "bus");
    const normal = list.filter(m => m.vehicle !== "tank" && m.vehicle !== "bus");
    const r = rnd();
    if (tanks.length && r < (CFG.tankChance || 0.1)) return tanks[Math.floor(rnd() * tanks.length)];
    if (buses.length && r < (CFG.tankChance || 0.1) + (CFG.busChance || 0.16)) return buses[Math.floor(rnd() * buses.length)];
    const pool = normal.length ? normal : list;
    return pool[Math.floor(rnd() * pool.length)];
  }

  /* 障碍的尺寸（单位：格） */
  function pickSize(rnd, kind) {
    const q = rnd();
    if (kind === "solid") {
      if (q < 0.60) return [1, 1];
      if (q < 0.78) return [1, 2];
      if (q < 0.93) return [2, 1];
      return [2, 2];
    }
    if (kind === "breakable" || kind === "supply" || kind === "barrel") {
      return q < 0.78 ? [1, 1] : (q < 0.9 ? [1, 2] : [2, 1]);
    }
    if (kind === "pushable") return q < 0.82 ? [1, 1] : [2, 1];
    if (kind === "barricade") return q < 0.5 ? [2, 1] : [3, 1];
    if (kind === "car") return q < 0.62 ? [2, 1] : [2, 2];
    if (kind === "tire") return [1, 1];
    if (kind === "locker") return q < 0.72 ? [1, 1] : [1, 2];   // v3.3 柜子：单格 / 高柜
    if (kind === "mud") return [1, 1];                          // v3.3 泥土：单格
    if (kind === "blower") return [1, 1];                       // v3.5 吹风机：单格机身
    if (kind === "bush") return q < 0.45 ? [2, 2] : (q < 0.8 ? [3, 2] : [3, 3]);
    /* v3.4 水池放大：整池 10~12 格连成一片，不再是零散小水洼 */
    if (kind === "water") return q < 0.35 ? [4, 3] : (q < 0.68 ? [3, 4] : (q < 0.86 ? [5, 2] : [2, 5]));
    /* 围栏：长条 */
    return q < 0.35 ? [2, 1] : (q < 0.7 ? [3, 1] : [1, 2]);
  }

  /** 闯关 BOSS 关卡的地图预设（固定种子，每次进入同一关布局一致） */
  T.bossCfg = function (level) {
    const b = (LD.BOSS_MAPS && level && LD.BOSS_MAPS[level.boss]) || null;
    if (!b) return LD.mapCfg({ preset: "arena", seed: 9000 + ((level && level.id) || 0) });
    return LD.mapCfg({
      preset: b.preset, seed: b.seed, counts: b.counts,
      ground: b.ground, mats: b.mats, patches: b.patches
    });
  };

  function mkProp(kind, mat, cw, ch, area, world, uid, rnd) {
    const px = area.c * TILE + cw * TILE / 2;
    const py = world.pt + area.r * TILE + ch * TILE / 2;
    const def = LD.TERRAIN.types[kind] || {};
    const hp = def.damageable ? (mat.hp || 40) : 0;
    const o = {
      uid: uid,
      kind: kind,
      mat: mat.id,
      shape: mat.shape || "square",
      cw: cw, ch: ch,
      w: cw * TILE, h: ch * TILE,
      x: px, y: py, ox: px, oy: py,
      elev: mat.elev || 26,
      mass: mat.mass || 1.5,
      hp: hp, maxHp: hp,
      dead: false, flash: 0,
      vx: 0, vy: 0, free: false,
      glow: mat.glow || null,
      boomR: mat.boomR || 150, boomDmg: mat.boomDmg || 40,
      variant: Math.floor(rnd() * 1000),
      soft: !!def.soft,
      blockMove: !!def.blockMove,
      blockProj: !!def.blockProj
    };
    /* v3.3 车辆：随机车型 / 随机油量（可行驶距离 2000~6000px）/ 随机速度倍率。
     * 全部由地图种子的 rnd 推导 → 联机两端生成结果一致。 */
    if (kind === "car") {
      const VC = LD.VEHICLES || {};
      const vc = VC[mat.vehicle || "sedan"] || VC.sedan || { speed: [1.2, 1.7], fuel: [2000, 6000] };
      o.vtype = vc.id;
      o.fuelMax = Math.round(vc.fuel[0] + rnd() * (vc.fuel[1] - vc.fuel[0]));
      o.fuel = o.fuelMax;
      o.speedMul = vc.speed[0] + rnd() * (vc.speed[1] - vc.speed[0]);
      o.ramCd = 0; o.hornCd = 0; o.cannonCd = 0;
      o.driver = null;
    }
    /* v3.3 柜子 / 泥土 */
    if (kind === "locker") o.occupant = null;
    if (kind === "mud") { o.carried = false; o.cargo = false; o.landed = true; }
    /* v3.5 吹风机：随机朝向 + 气流长度（全部由地图种子的 rnd 推导，联机两端一致） */
    if (kind === "blower") {
      const BC = LD.BLOWER || {};
      o.dir = Math.floor(rnd() * 4);                 // 0 右 / 1 下 / 2 左 / 3 上
      const lo = BC.lenMin || 3, hi = BC.lenMax || 6;
      let len = lo + Math.floor(rnd() * (hi - lo + 1));
      const half = TILE / 2;
      /* 别让气流穿出地图：按机身到边界还剩几格收一下 */
      if (o.dir === 0) len = Math.min(len, Math.floor((world.w - (px + half)) / TILE));
      else if (o.dir === 2) len = Math.min(len, Math.floor((px - half) / TILE));
      else if (o.dir === 1) len = Math.min(len, Math.floor((world.h - (py + half)) / TILE));
      else len = Math.min(len, Math.floor((py - half - world.pt) / TILE));
      o.len = Math.max(2, len);
      o.power = BC.force || 420;
      o._fuelSaid = false;
    }
    return o;
  }

  /** 生成一张地图。world = {w,h,pt}；avoid = [{x,y,r}] 出生点保护区 */
  T.build = function (srcCfg, world, avoid) {
    const cfg = LD.mapCfg(srcCfg);
    world = world || (LD.WORLD || { w: 1600, h: 1600, pt: 120 });
    const cols = Math.max(8, Math.floor(world.w / TILE));
    const rows = Math.max(8, Math.floor((world.h - world.pt) / TILE));
    let best = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const rnd = mulberry32(cfg.seed + attempt * 7919);
      const occ = [];      // 挡人障碍占用
      const soft = [];     // 草丛 / 水池占用（不挡人，但不可与其它设施重叠）
      for (let r = 0; r < rows; r++) { occ.push(new Array(cols).fill(0)); soft.push(new Array(cols).fill(0)); }

      /* 出生保护区：整格标记，禁止摆放任何障碍 */
      const guard = [];
      for (let r = 0; r < rows; r++) guard.push(new Array(cols).fill(0));
      (avoid || []).forEach(a => {
        const c0 = Math.floor((a.x - a.r) / TILE), c1 = Math.floor((a.x + a.r) / TILE);
        const r0 = Math.floor((a.y - a.r - world.pt) / TILE), r1 = Math.floor((a.y + a.r - world.pt) / TILE);
        for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++)
          for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) guard[r][c] = 1;
      });

      const props = [];
      const rooms = [];
      let uid = 0;

      /* ---- 建筑：石墙围成的房间，留 1-2 个门洞 ---- */
      const roomN = cfg.counts.room || 0;
      for (let i = 0; i < roomN; i++) {
        let placedRoom = false;
        for (let tries = 0; tries < 40 && !placedRoom; tries++) {
          const rw = 5 + Math.floor(rnd() * 3);      // 外框宽（格）
          const rh = 4 + Math.floor(rnd() * 3);      // 外框高（格）
          const c = 1 + Math.floor(rnd() * Math.max(1, cols - rw - 2));
          const r = 1 + Math.floor(rnd() * Math.max(1, rows - rh - 2));
          let ok = true;
          for (let rr = r - 1; rr <= r + rh && ok; rr++)
            for (let cc = c - 1; cc <= c + rw; cc++) {
              if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) { ok = false; break; }
              if (occ[rr][cc] || soft[rr][cc] || guard[rr][cc]) { ok = false; break; }
            }
          if (!ok) continue;

          /* 墙体格子 + 门洞 */
          const walls = [];
          const isWall = (cc, rr) => (cc === c || cc === c + rw - 1 || rr === r || rr === r + rh - 1);
          /* 门洞：随机 1-2 条边各开 1-2 格 */
          const doors = [];
          const sides = [0, 1, 2, 3].sort(() => rnd() - 0.5).slice(0, rnd() < 0.55 ? 1 : 2);
          sides.forEach(sd => {
            if (sd === 0 || sd === 2) {          // 上 / 下边
              const dw = 1 + (rnd() < 0.4 ? 1 : 0);
              const dc = c + 1 + Math.floor(rnd() * Math.max(1, rw - 2 - dw));
              for (let k = 0; k < dw; k++) doors.push([dc + k, sd === 0 ? r : r + rh - 1]);
            } else {                              // 左边 / 右边
              const dh = 1 + (rnd() < 0.4 ? 1 : 0);
              const dr = r + 1 + Math.floor(rnd() * Math.max(1, rh - 2 - dh));
              for (let k = 0; k < dh; k++) doors.push([sd === 1 ? c : c + rw - 1, dr + k]);
            }
          });
          const doorSet = new Set(doors.map(d => d[0] + "," + d[1]));
          for (let rr = r; rr < r + rh; rr++)
            for (let cc = c; cc < c + rw; cc++)
              if (isWall(cc, rr) && !doorSet.has(cc + "," + rr)) walls.push([cc, rr]);

          /* 把墙按行列合并成长条，减少实体数量 */
          const wallSet = new Set(walls.map(w => w[0] + "," + w[1]));
          const done = new Set();
          const stoneMat = (LD.TERRAIN.mats.solid || []).find(m => m.id === "stone")
            || (LD.TERRAIN.mats.solid || [])[0];
          const parts = [];
          walls.forEach(([cc, rr]) => {
            const key = cc + "," + rr;
            if (done.has(key)) return;
            /* 先尝试向右延伸，再尝试向下 */
            let len = 1;
            while (wallSet.has((cc + len) + "," + rr) && !done.has((cc + len) + "," + rr)) len++;
            if (len >= 2) {
              for (let k = 0; k < len; k++) done.add((cc + k) + "," + rr);
              parts.push({ c: cc, r: rr, cw: len, ch: 1 });
            } else {
              len = 1;
              while (wallSet.has(cc + "," + (rr + len)) && !done.has(cc + "," + (rr + len))) len++;
              for (let k = 0; k < len; k++) done.add(cc + "," + (rr + k));
              parts.push({ c: cc, r: rr, cw: 1, ch: len });
            }
          });

          parts.forEach(pt => {
            const o = mkProp("room", stoneMat, pt.cw, pt.ch, { c: pt.c, r: pt.r }, world, uid++, rnd);
            o.isWall = true;
            props.push(o);
            for (let rr = pt.r; rr < pt.r + pt.ch; rr++)
              for (let cc = pt.c; cc < pt.c + pt.cw; cc++) occ[rr][cc] = 1;
          });
          /* 门洞内外各留一格净空，避免后续设施把门堵死 */
          doors.forEach(([cc, rr]) => {
            for (let dr = -1; dr <= 1; dr++)
              for (let dc = -1; dc <= 1; dc++) {
                const nr = rr + dr, nc = cc + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) guard[nr][nc] = 1;
              }
          });
          rooms.push({ c: c, r: r, w: rw, h: rh });
          placedRoom = true;
        }
      }

      /* ---- 常规设施 ---- */
      const order = ["solid", "breakable", "pushable", "fence", "barrel", "barricade",
                     "supply", "car", "tire", "bush", "water", "locker", "mud", "blower"];
      order.forEach(kind => {
        const n = cfg.counts[kind] || 0;
        const matList = matsOf(cfg, kind);
        const def = LD.TERRAIN.types[kind] || {};
        for (let i = 0; i < n; i++) {
          /* v3.3：车辆先定材质（车型决定占地大小），特殊车按概率抽 */
          const mat = kind === "car" ? pickCarMat(rnd, matList) : matList[Math.floor(rnd() * matList.length)] || matList[0];
          let [cw, ch] = pickSize(rnd, kind);
          if (mat && mat.tiles) { cw = mat.tiles[0]; ch = mat.tiles[1]; }
          let placed = false;
          for (let tries = 0; tries < 90 && !placed; tries++) {
            const c = 1 + Math.floor(rnd() * Math.max(1, cols - cw - 1));
            const r = 1 + Math.floor(rnd() * Math.max(1, rows - ch - 1));
            /* 1 格净空：障碍之间不贴脸，保证至少有绕着走的通道 */
            let ok = true;
            for (let rr = r - 1; rr <= r + ch && ok; rr++) {
              for (let cc = c - 1; cc <= c + cw; cc++) {
                if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) { ok = false; break; }
                if (occ[rr][cc] || soft[rr][cc] || guard[rr][cc]) { ok = false; break; }
              }
            }
            if (!ok) continue;
            if (!mat) continue;
            const o = mkProp(kind, mat, cw, ch, { c: c, r: r }, world, uid++, rnd);
            props.push(o);
            for (let rr = r; rr < r + ch; rr++)
              for (let cc = c; cc < c + cw; cc++) {
                /* 泥土不挡路，按软地形占位（不参与连通性判定） */
                if (def.soft || kind === "mud") soft[rr][cc] = 1; else occ[rr][cc] = 1;
              }
            placed = true;
          }
        }
      });
      /* 非软地形占位（避免 spawn 到房间里太挤） */

      if (!T.connected(occ, cols, rows)) continue;
      best = { cfg: cfg, cols: cols, rows: rows, top: world.pt, props: props,
               occ: occ, soft: soft, rooms: rooms, tile: TILE, seed: cfg.seed,
               booms: [], drops: [] };
      break;
    }

    /* 极端情况下 8 次都没通过连通检查：退化成一张空图，宁可不摆也不能把玩家关死 */
    if (!best) {
      const occ = [], soft = [];
      for (let r = 0; r < rows; r++) { occ.push(new Array(cols).fill(0)); soft.push(new Array(cols).fill(0)); }
      best = { cfg: cfg, cols: cols, rows: rows, top: world.pt, props: [], occ: occ, soft: soft,
               rooms: [], tile: TILE, seed: cfg.seed, booms: [], drops: [] };
    }

    best.ground = T.genGround(best, cfg, mulberry32(cfg.seed ^ 0x9E3779B9));
    best.avoid = avoid || [];
    return best;
  };

  /* ----------------------------------------------------------
   * v3.2 世界末日：场地中心生成石墙庇护所
   *   在半径 r 的环带上按 40px 格子铺满石墙块，左右各留一个两格宽门洞。
   *   纯几何推导、无随机数，联机两端各自构建结果完全一致。
   * ---------------------------------------------------------- */
  T.buildShelter = function (map, world, opt) {
    if (!map) return null;
    const D = LD.DOOMSDAY || {};
    const o = opt || {};
    const tile = TILE;
    const cx = world.w / 2;
    const cy = (world.pt + world.h) / 2;
    const r = o.r != null ? o.r : (D.r || 280);
    const gapW = (o.gap != null ? o.gap : (D.gap || 2)) * tile;    // 门洞高度（像素）
    const mat = (LD.TERRAIN.mats.solid || []).find(m => m.id === (o.mat || "wall_stone"))
      || (LD.TERRAIN.mats.solid || [])[0] || { id: "stone", shape: "square", elev: 30, mass: 3 };
    /* 清场：房间会把自己的地图配置传进来，随机设施可能正好堵死门洞、或在城里塞满箱子。
     * 环带（城内 + 墙体所在格）与左右门洞的进出走廊一律清空，纯几何判定、两端一致。 */
    map.props = (map.props || []).filter(p => {
      const dx = p.x - cx, dy = p.y - cy;
      if (Math.hypot(dx, dy) < r + tile * 0.75) return false;                     // 城内 + 墙带
      if (Math.abs(dy) < gapW / 2 + 14 && Math.abs(dx) < r + 150) return false;   // 门洞走廊
      return true;
    });
    let uid = 900000;
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const x = col * tile + tile / 2;
        const y = world.pt + row * tile + tile / 2;
        if (Math.abs(Math.hypot(x - cx, y - cy) - r) > tile * 0.5) continue;   // 只取环带
        /* 左右门洞：水平轴上下各留半个门宽（两格 = 80px），其余环带照常砌墙 */
        if (Math.abs(y - cy) < gapW / 2 && Math.abs(Math.abs(x - cx) - r) < tile) continue;
        map.props.push({
          uid: uid++, kind: "solid", mat: mat.id, shape: mat.shape || "square",
          cw: 1, ch: 1, w: tile, h: tile, x: x, y: y, ox: x, oy: y,
          elev: mat.elev || 32, mass: mat.mass || 3,
          hp: 0, maxHp: 0, dead: false, flash: 0,
          vx: 0, vy: 0, free: false, glow: null,
          boomR: 150, boomDmg: 40, variant: (col * 37 + row * 71) % 997,
          soft: false, blockMove: true, blockProj: true
        });
        if (map.occ && map.occ[row]) map.occ[row][col] = 1;
      }
    }
    return { x: cx, y: cy, r: r,
      gaps: [{ x: cx + r, y: cy }, { x: cx - r, y: cy }], tile: tile };
  };

  /* ----------------------------------------------------------
   * v3.7 塔防对战：窄长对称地图 + 双方水晶 / 防御塔
   *   横向 2400（推塔轴），纵向 760（可视 600，只在靠近边界时轻微滚动）。
   *   左 0 队 / 右 1 队，结构位置镜像；塔与水晶都走「可破坏障碍」逻辑，
   *   带 side / team 字段，好让弹道判定敌我。
   *   纯几何推导 + 固定装饰点位，联机两端各生成一份完全一致。
   * ---------------------------------------------------------- */
  T.buildTowerMap = function (world) {
    const W = world || (LD.TOWER && LD.TOWER.world) || { w: 2800, h: 540, pt: 80 };
    const cfgT = LD.TOWER || {};
    const cy = cfgT.laneY || 380;
    const sy = cy - (cfgT.structDy == null ? 110 : cfgT.structDy);
    const cols = Math.max(8, Math.floor(W.w / TILE));
    const rows = Math.max(6, Math.floor((W.h - W.pt) / TILE));
    const props = [];
    const occ = [], soft = [];
    for (let r = 0; r < rows; r++) { occ.push(new Array(cols).fill(0)); soft.push(new Array(cols).fill(0)); }

    let uid = 800000;
    const mark = (o) => {
      if (!o.blockMove) return;
      const c0 = Math.max(0, Math.floor((o.x - o.w / 2) / TILE));
      const c1 = Math.min(cols - 1, Math.floor((o.x + o.w / 2 - 1) / TILE));
      const r0 = Math.max(0, Math.floor((o.y - o.h / 2 - W.pt) / TILE));
      const r1 = Math.min(rows - 1, Math.floor((o.y + o.h / 2 - 1 - W.pt) / TILE));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) occ[r][c] = 1;
    };

    const struct = (kind, side, x, y) => {
      const C = kind === "crystal" ? (cfgT.crystal || {}) : (cfgT.tower || {});
      const w = kind === "crystal" ? 112 : 84;
      const h = kind === "crystal" ? 80 : 60;
      const hp = C.hp || (kind === "crystal" ? 1500 : 1000);
      const o = {
        uid: uid++, kind, mat: kind, shape: "square",
        side, team: side,
        cw: 2, ch: 2,
        w, h, x, y, ox: x, oy: y,
        elev: C.h || (kind === "crystal" ? 110 : 96),
        mass: 99,
        hp, maxHp: hp,
        dead: false, flash: 0, shotT: 0, aimAngle: side === 0 ? 0 : Math.PI,
        vx: 0, vy: 0, free: false, glow: null,
        boomR: 0, boomDmg: 0, variant: 0,
        soft: false, blockMove: true, blockProj: true
      };
      props.push(o);
      mark(o);
      return o;
    };

    /* 最外侧水晶，然后两座塔；红蓝完全镜像，中间 1120~1680 留空做战斗区 */
    struct("crystal", 0, 200, sy);
    struct("crystal", 1, W.w - 200, sy);
    [620, 1120].forEach(dx => { struct("tower", 0, dx, sy); struct("tower", 1, W.w - dx, sy); });


    /* ---- 随机设施：只在左右两侧（不压中心战斗区、不压兵线与建筑），生成后镜像 ---- */
    const rnd = mulberry32(((cfgT.seed || 20261019) + ((Math.random() * 1e9) | 0)) >>> 0);
    const mats = LD.TERRAIN.mats;
    const pickMat = (kind) => {
      const list = (mats[kind] || []).filter(m => !m.noRandom);
      return list.length ? list[Math.floor(rnd() * list.length)] : (mats[kind] || [])[0];
    };
    const near = (x, y, list, pad) => list.some(p => Math.abs(p.x - x) < p.r + pad && Math.abs(p.y - y) < p.r + pad);
    const keepOut = [
      { x: 200, y: sy, r: 150 }, { x: W.w - 200, y: sy, r: 150 },
      { x: 620, y: sy, r: 120 }, { x: 1120, y: sy, r: 120 },
      { x: W.w - 620, y: sy, r: 120 }, { x: W.w - 1120, y: sy, r: 120 }
    ];
    const kinds = ["solid", "breakable", "bush", "barrel", "car", "barricade", "pushable", "tire"];
    let placed = 0;
    for (let i = 0; i < 90 && placed < 9; i++) {
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const mat = pickMat(kind);
      if (!mat) continue;
      const x = 420 + rnd() * 620;                      // 左半区，镜像到右半区
      const y = W.pt + 60 + rnd() * (W.h - W.pt - 130);
      if (Math.abs(y - cy) < 86) continue;              // 兵线走廊保持畅通
      if (near(x, y, keepOut, 40)) continue;
      const def = LD.TERRAIN.types[kind] || {};
      let cw = 1, ch = 1;
      if (kind === "car") { cw = 2; ch = rnd() < 0.5 ? 2 : 1; }
      if (kind === "barricade") { cw = 2; ch = 1; }
      if (kind === "bush") { cw = 2; ch = 2; }
      if (kind === "tire") { cw = 1; ch = 1; }
      const w = cw * TILE, h = ch * TILE;
      /* 新设施不能和已有设施叠在一起（叠住的车会把 AI 夹在中间） */
      const clash = (px, py) => props.some(o =>
        Math.abs(o.x - px) < (o.w + w) / 2 + 16 && Math.abs(o.y - py) < (o.h + h) / 2 + 16);
      if (clash(x, y) || clash(W.w - x, y)) continue;
      /* 车辆参数先在镜像前定好，保证左右两侧是同一车型 / 同一油量 */
      let carCfg = null;
      if (kind === "car") {
        const VC = LD.VEHICLES || {};
        const ids = mat.vehicle ? [mat.vehicle] : ["sedan", "van"];
        if (rnd() < 0.16) ids.push("tank");
        if (rnd() < 0.20) ids.push("bus");
        const vc = VC[ids[Math.floor(rnd() * ids.length)]] || VC.sedan || { speed: [1.2, 1.7], fuel: [2000, 6000] };
        carCfg = {
          vtype: vc.id,
          fuelMax: Math.round(vc.fuel[0] + rnd() * (vc.fuel[1] - vc.fuel[0])),
          speedMul: vc.speed[0] + rnd() * (vc.speed[1] - vc.speed[0])
        };
      }
      [x, W.w - x].forEach(px => {
        const hp = def.damageable ? (mat.hp || 40) : 0;
        const o = {
          uid: uid++, kind, mat: mat.id, shape: mat.shape || "square",
          cw, ch, w, h, x: px, y, ox: px, oy: y,
          elev: mat.elev || 26, mass: mat.mass || 1.5,
          hp, maxHp: hp, dead: false, flash: 0, vx: 0, vy: 0, free: false,
          glow: mat.glow || null, boomR: mat.boomR || 150, boomDmg: mat.boomDmg || 40,
          variant: (px + y) % 997, soft: !!def.soft,
          blockMove: !!def.blockMove, blockProj: !!def.blockProj
        };
        /* 车辆：沿用上面的对称参数 */
        if (kind === "car" && carCfg) {
          o.vtype = carCfg.vtype;
          o.fuelMax = carCfg.fuelMax;
          o.fuel = o.fuelMax;
          o.speedMul = carCfg.speedMul;
          o.ramCd = 0; o.hornCd = 0; o.cannonCd = 0; o.driver = null;
        }
        props.push(o);
        mark(o);
      });
      placed++;
    }

    /* 保证至少刷一对车（有概率是坦克），否则随机池可能一辆车都不出 */
    if (!props.some(o => o.kind === "car")) {
      const carMat = (mats.car || []).find(m => m.id === "car_red") || (mats.car || [])[0];
      for (let k = 0; k < 40 && carMat; k++) {
        const x = 480 + rnd() * 480, y = W.pt + 70 + rnd() * (W.h - W.pt - 150);
        if (Math.abs(y - cy) < 86 || near(x, y, keepOut, 40)) continue;
        const VC = LD.VEHICLES || {};
        const vc = (rnd() < 0.4 ? VC.tank : (rnd() < 0.5 ? VC.van : VC.sedan)) || VC.sedan || { speed: [1.2, 1.7], fuel: [2000, 6000] };
        [x, W.w - x].forEach(px => {
          const o = {
            uid: uid++, kind: "car", mat: carMat.id, shape: "square", cw: 2, ch: 2,
            w: 80, h: 80, x: px, y, ox: px, oy: y, elev: carMat.elev || 26, mass: carMat.mass || 3,
            hp: 0, maxHp: 0, dead: false, flash: 0, vx: 0, vy: 0, free: false,
            glow: null, boomR: 0, boomDmg: 0, variant: 7, soft: false,
            blockMove: true, blockProj: true,
            vtype: vc.id, fuelMax: Math.round(vc.fuel[0] + rnd() * (vc.fuel[1] - vc.fuel[0])),
            speedMul: vc.speed[0] + rnd() * (vc.speed[1] - vc.speed[0]),
            ramCd: 0, hornCd: 0, cannonCd: 0, driver: null
          };
          o.fuel = o.fuelMax;
          props.push(o); mark(o);
        });
        break;
      }
    }

    const map = {
      cols, rows, top: W.pt, props, occ, soft, rooms: [], tile: TILE,
      booms: [], drops: [], cfg: LD.mapCfg({ preset: "arena", ground: "stone", patches: ["sand"], counts: {} })
    };
    map.ground = T.genGround(map, map.cfg, mulberry32(20261019));
    map.avoid = [];
    return map;
  };

  /** 连通性：所有空格必须能从任意一个空格走到（4 邻域） */  T.connected = function (occ, cols, rows) {
    let total = 0, start = null;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!occ[r][c]) { total++; if (!start) start = [c, r]; }
    }
    if (!start || total <= 1) return true;
    const seen = [];
    for (let r = 0; r < rows; r++) seen.push(new Array(cols).fill(false));
    const q = [start];
    seen[start[1]][start[0]] = true;
    let n = 0;
    while (q.length) {
      const [c, r] = q.pop(); n++;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let i = 0; i < 4; i++) {
        const nc = c + dirs[i][0], nr = r + dirs[i][1];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (seen[nr][nc] || occ[nr][nc]) continue;
        seen[nr][nc] = true; q.push([nc, nr]);
      }
    }
    return n >= total;
  };

  /** 地面材质网格：主材质 + 若干斑块，纯视觉；房间内部铺木地板 */
  T.genGround = function (map, cfg, rnd) {
    const base = cfg.ground || "grass";
    const patchList = (cfg.patches && cfg.patches.length ? cfg.patches
      : ["stone"]).filter(id => id !== base);
    const g = [];
    for (let r = 0; r < map.rows; r++) {
      const row = [];
      for (let c = 0; c < map.cols; c++) row.push(base);
      g.push(row);
    }
    /* 房间内部：木地板，和室外街面形成区分 */
    (map.rooms || []).forEach(rm => {
      for (let r = rm.r + 1; r < rm.r + rm.h - 1; r++)
        for (let c = rm.c + 1; c < rm.c + rm.w - 1; c++)
          if (g[r] && g[r][c] != null) g[r][c] = "wood";
    });
    if (!patchList.length) return g;
    const blobs = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < blobs; b++) {
      const mat = patchList[Math.floor(rnd() * patchList.length)];
      let c = 1 + Math.floor(rnd() * (map.cols - 2));
      let r = 1 + Math.floor(rnd() * (map.rows - 2));
      const steps = 14 + Math.floor(rnd() * 18);
      for (let i = 0; i < steps; i++) {
        const rad = 1 + Math.floor(rnd() * 2);
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
          if (dr * dr + dc * dc > rad * rad + 1) continue;
          const rr = r + dr, cc = c + dc;
          if (rr > 0 && rr < map.rows - 1 && cc > 0 && cc < map.cols - 1) g[rr][cc] = mat;
        }
        c += (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.5 ? 0 : 1);
        r += (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.5 ? 0 : 1);
        c = Math.max(1, Math.min(map.cols - 2, c));
        r = Math.max(1, Math.min(map.rows - 2, r));
      }
    }
    return g;
  };

  /* ---------------- 几何 ---------------- */
  T.radiusOf = function (o) { return Math.min(o.w, o.h) / 2; };

  /** 圆（x,y,r）与障碍的碰撞：返回推出向量 {nx,ny,pen}，无碰撞返回 null */
  T.pushOut = function (o, x, y, r) {
    if (o.dead) return null;
    if (o.shape === "round") {
      const dx = x - o.x, dy = y - o.y;
      const d = Math.hypot(dx, dy);
      const lim = r + T.radiusOf(o);
      if (d >= lim || d < 0.0001) return d < 0.0001 ? { nx: 1, ny: 0, pen: lim } : null;
      return { nx: dx / d, ny: dy / d, pen: lim - d };
    }
    const l = o.x - o.w / 2, rr = o.x + o.w / 2;
    const t = o.y - o.h / 2, b = o.y + o.h / 2;
    const cx = Math.max(l, Math.min(rr, x));
    const cy = Math.max(t, Math.min(b, y));
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= r) return null;
    if (d > 0.0001) return { nx: dx / d, ny: dy / d, pen: r - d };
    /* 圆心在矩形内部：沿最近的一条边推出 */
    const dl = x - l, dr = rr - x, dt = y - t, db = b - y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { nx: -1, ny: 0, pen: dl + r };
    if (m === dr) return { nx: 1, ny: 0, pen: dr + r };
    if (m === dt) return { nx: 0, ny: -1, pen: dt + r };
    return { nx: 0, ny: 1, pen: db + r };
  };

  /** 把角色推出所有障碍（移动后调用）。
   *  v3.1：撞到可推动物体（汽车 / 轮胎 / 方块）时，角色会把它们往前顶一点，
   *  自身被剩下部分挡住并减速（f.pushT 交给移动逻辑降速）。 */
  T.collideFighter = function (map, f, dt) {
    if (!map) return;
    dt = dt || 1 / 60;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < map.props.length; i++) {
        const o = map.props[i];
        if (!o.blockMove || o.dead) continue;
        const hit = T.pushOut(o, f.x, f.y, f.r);
        if (!hit) continue;
        if (pass === 0 && (o.kind === "pushable" || o.kind === "car" || o.kind === "tire") && !o.cargo && !o.driver) {
          /* 推挤：重物推得慢，轻物推得快 */
          const nx = -hit.nx, ny = -hit.ny;                 // 从角色指向障碍
          const gain = 62 / Math.max(0.4, o.mass || 1.5);   // px/s
          const step = Math.min(hit.pen, gain * dt);
          const tx = o.x + nx * step, ty = o.y + ny * step;
          if (!T.blockedAt(map, o, tx, ty)) {
            o.x = tx; o.y = ty;
            o.vx = nx * 26; o.vy = ny * 26;
            f.pushT = 0.16;
          }
        }
        f.x += hit.nx * (hit.pen + 0.05);
        f.y += hit.ny * (hit.pen + 0.05);
      }
    }
    f.x = Math.max(34, Math.min(map.cols * TILE - 34, f.x));
    f.y = Math.max(map.top + 26, Math.min(map.top + map.rows * TILE - 26, f.y));
  };

  /** 该位置是否没有阻挡（出生点 / 掉落物可用） */
  T.clearAt = function (map, x, y, r) {
    if (!map) return true;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (!o.blockMove || o.dead) continue;
      if (T.pushOut(o, x, y, r || 16)) return false;
    }
    return true;
  };

  /** 角色所在位置的草丛（没有返回 null） */
  T.bushAt = function (map, x, y) {
    if (!map) return null;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (o.dead || o.kind !== "bush") continue;
      if (Math.abs(x - o.x) < o.w / 2 && Math.abs(y - o.y) < o.h / 2) return o;
    }
    return null;
  };

  /** 角色所在位置的水池（没有返回 null） */
  T.waterAt = function (map, x, y) {
    if (!map) return null;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (o.dead || o.kind !== "water") continue;
      if (Math.abs(x - o.x) < o.w / 2 && Math.abs(y - o.y) < o.h / 2) return o;
    }
    return null;
  };

  /** 视线检测：两点连线是否被挡飞行物的障碍截断。
   *  返回第一个挡住视线的障碍（用于 AI 判断“打不打得到”），通畅返回 null */
  T.losHit = function (map, x1, y1, x2, y2, pad) {
    if (!map) return null;
    pad = pad || 0;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const ux = dx / len, uy = dy / len;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (!o.blockProj || o.dead) continue;
      if (o.shape === "round") {
        const r = T.radiusOf(o) + pad;
        const cx = o.x - x1, cy = o.y - y1;
        const tproj = cx * ux + cy * uy;
        if (tproj < -r || tproj > len + r) continue;
        const t = Math.max(0, Math.min(len, tproj));
        if (Math.hypot(x1 + ux * t - o.x, y1 + uy * t - o.y) < r) return o;
      } else {
        /* 线段 vs 扩边 AABB（slab 法） */
        const l = o.x - o.w / 2 - pad, r2 = o.x + o.w / 2 + pad;
        const t2 = o.y - o.h / 2 - pad, b2 = o.y + o.h / 2 + pad;
        let tmin = 0, tmax = len, hit = true;
        const p = [x1, y1], u = [ux, uy], lo = [l, t2], hi = [r2, b2];
        for (let a = 0; a < 2 && hit; a++) {
          if (Math.abs(u[a]) < 1e-6) { if (p[a] < lo[a] || p[a] > hi[a]) hit = false; }
          else {
            let ta = (lo[a] - p[a]) / u[a], tb = (hi[a] - p[a]) / u[a];
            if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
            tmin = Math.max(tmin, ta); tmax = Math.min(tmax, tb);
            if (tmin > tmax) hit = false;
          }
        }
        if (hit) return o;
      }
    }
    return null;
  };

  /** AI 绕障：返回远离障碍的转向向量 */
  T.avoid = function (map, x, y, rad, skip) {
    const out = { x: 0, y: 0 };
    if (!map) return out;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (o === skip) continue;
      if (!o.blockMove || o.dead) continue;
      const l = o.x - o.w / 2, r = o.x + o.w / 2, t = o.y - o.h / 2, b = o.y + o.h / 2;
      const cx = Math.max(l, Math.min(r, x)), cy = Math.max(t, Math.min(b, y));
      let dx = x - cx, dy = y - cy;
      let d = Math.hypot(dx, dy);
      const lim = (rad || 64) + 16;
      if (d > lim) continue;
      if (d < 0.001) { dx = x - o.x; dy = y - o.y; d = Math.hypot(dx, dy) || 1; }
      const w = (lim - d) / lim;
      out.x += (dx / d) * w * 1.8;
      out.y += (dy / d) * w * 1.8;
    }
    return out;
  };

  /** 飞行物命中的障碍（围栏不挡飞行物；大招弹道无视墙体） */
  T.projHit = function (map, p) {
    if (!map || p.passWall) return null;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (!o.blockProj || o.dead) continue;
      /* v3.7 塔防：己方防御塔 / 水晶不挡自己的弹道（也不会被友军打掉） */
      if (o.kind === "tower" || o.kind === "crystal") {
        if (p.owner && o.team != null && LD.Battle && LD.Battle.sameTeam(p.owner, o)) continue;
      }
      if (o.shape === "round") {
        if (Math.hypot(p.x - o.x, p.y - o.y) < p.r + T.radiusOf(o)) return o;
      } else {
        const cx = Math.max(o.x - o.w / 2, Math.min(o.x + o.w / 2, p.x));
        const cy = Math.max(o.y - o.h / 2, Math.min(o.y + o.h / 2, p.y));
        if (Math.hypot(p.x - cx, p.y - cy) < p.r) return o;
      }
    }
    return null;
  };

  /** 近战扫击：命中挡在前方扇形内的可破坏 / 可推动障碍，返回命中数量 */
  T.melee = function (map, f, reach, half, dmg) {
    if (!map) return 0;
    const fa = Math.atan2(f.facing.y, f.facing.x);
    let n = 0;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (o.dead || !(LD.TERRAIN.types[o.kind] || {}).damageable && !(LD.TERRAIN.types[o.kind] || {}).pushable) continue;
      /* v3.7 塔防：不打自家建筑 */
      if ((o.kind === "tower" || o.kind === "crystal") && f && o.team != null &&
          LD.Battle && LD.Battle.sameTeam(f, o)) continue;
      const dx = o.x - f.x, dy = o.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > reach + Math.max(o.w, o.h) * 0.5) continue;
      const ang = Math.atan2(dy, dx);
      const da = Math.abs(((ang - fa + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da > (half || 1.05) + 0.35) continue;
      T.hitProp(map, o, dmg, { dir: ang, melee: true, src: f });
      n++;
    }
    return n;
  };

  /** 爆炸对地形的作用（范围伤害 + 径向推力） */
  T.blast = function (map, x, y, r, dmg) {
    if (!map) return 0;
    let n = 0;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      const def = LD.TERRAIN.types[o.kind] || {};
      if (o.dead || (!def.damageable && !def.pushable)) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d > r + Math.max(o.w, o.h) * 0.45) continue;
      T.hitProp(map, o, dmg, { dir: Math.atan2(o.y - y, o.x - x), blast: true });
      n++;
    }
    return n;
  };

  /** 对障碍结算一次伤害 */
  T.hitProp = function (map, o, dmg, opt) {
    if (!o || o.dead) return;
    opt = opt || {};
    dmg = Math.max(0, dmg || 0);
    const def = LD.TERRAIN.types[o.kind] || {};
    /* v3.5：攻击打在藏人的柜子上 → 里面的人照样被揪出来（免疫这一下、眩晕 2 秒）。
     * 否则远程 AI 的子弹全被柜子吃掉，看起来像「人机不会打」。 */
    if (o.kind === "locker" && o.occupant && dmg > 0 && LD.Battle && LD.Battle.ejectLocker) {
      LD.Battle.ejectLocker(o.occupant, opt.src || null);
    }
    /* v3.6：打在载人的车上 → 驾驶员被震出车外（免疫这一下、眩晕 2 秒）。
     * 车体会挡住弹道，原本远程攻击永远碰不到车里的人，AI 的普攻 / 技能全被车皮吃掉，
     * 表现就是「人机很久才想起要把人从车上打下来」。 */
    if (o.kind === "car" && dmg > 0 && o.driver && opt.src && LD.Battle && LD.Battle.exitCar) {
      const drv = o.driver;
      if (!LD.Battle.sameTeam(opt.src, drv)) LD.Battle.exitCar(drv, true, opt.src);
    }
    /* v3.7 塔防：水晶在防御塔全部倒下前免疫一切伤害 */
    if (o.kind === "crystal" && dmg > 0) {
      if (LD.Battle && LD.Battle.crystalGuarded && LD.Battle.crystalGuarded(o)) {
        const now = (LD.Battle && LD.Battle.t) || 0;
        if (LD.FX && now - (o._guardAt || -9) > 1.5) {
          o._guardAt = now;
          LD.FX.float(o.x, o.y - (o.elev || 90) - 10, "先拆掉防御塔！", "#9fb3dd", 13);
        }
        return;
      }
    }
    if ((o.kind === "tower" || o.kind === "crystal") && dmg > 0 && opt.src) {
      /* v3.8 拆塔倍率：英雄 2.2 倍、小兵 2 倍，否则 1000 血的塔要磨太久 */
      const C = LD.TOWER || {};
      if (opt.src.kind === "hero") dmg = Math.round(dmg * (C.structDmgMul || 1));
      else if (opt.src.kind === "laneMinion") dmg = Math.round(dmg * (C.minionStructMul || 1));
    }
    if ((o.kind === "tower" || o.kind === "crystal") && dmg > 0) {
      o.shotT = o.shotT || 0;
      if (LD.Battle && LD.Battle.structureDamaged) LD.Battle.structureDamaged(o, dmg, opt);
    }
    /* v3.5 车体受击也会漏油：1 点伤害 = 20 可行驶距离 */    if (o.kind === "car" && dmg > 0 && (o.fuel || 0) > 0) {
      const per = (LD.VEHICLE_CFG && LD.VEHICLE_CFG.fuelPerDmg) || 20;
      o.fuel = Math.max(0, o.fuel - dmg * per);
      if (o.fuel <= 0 && !o._fuelSaid) {
        o._fuelSaid = true;
        if (LD.FX) LD.FX.float(o.x, o.y - 66, "油箱被打漏了！", "#fbbf24", 14);
      }
    }
    if (def.pushable) {
      /* 冲量 → 速度：质量越大加速度越小；近战推力约 3 倍（v3.1 整体加强） */
      const mul = opt.melee ? 64 : (opt.blast ? 27 : 19);
      const imp = dmg * mul / (o.mass || 1.5);
      const sp = Math.hypot(o.vx || 0, o.vy || 0);
      const add = Math.min(760, imp);
      const vx = Math.cos(opt.dir || 0) * add, vy = Math.sin(opt.dir || 0) * add;
      /* 同向叠加、反向削减，避免连续击打时速度无限累加 */
      if (sp > 0 && (o.vx * vx + o.vy * vy) > 0) {
        o.vx += vx * 0.6; o.vy += vy * 0.6;
      } else {
        o.vx = (o.vx || 0) * 0.4 + vx; o.vy = (o.vy || 0) * 0.4 + vy;
      }
      const cap = 640;
      const ns = Math.hypot(o.vx, o.vy);
      if (ns > cap) { o.vx = o.vx / ns * cap; o.vy = o.vy / ns * cap; }
      o.free = true; o.flash = 0.14;
      const mat = (LD.TERRAIN.mats[o.kind] || []).find(m => m.id === o.mat) || {};
      LD.FX.burst(o.x, o.y - 12, 8, T.palColors(mat), { speed: 120, dir: opt.dir || 0, spread: 0.8 });
      return;
    }
    if (def.damageable) {
      o.hp -= Math.round(dmg);
      o.flash = 0.14;
      if (o.hp <= 0) T.breakProp(map, o);
    }
  };

  T.breakProp = function (map, o) {
    o.dead = true; o.hp = 0;
    const mat = (LD.TERRAIN.mats[o.kind] || []).find(m => m.id === o.mat);
    const cols = mat ? T.palColors(mat) : ["#cbd5e1", "#94a3b8", "#475569"];
    LD.FX.burst(o.x, o.y - 10, 26, cols, { speed: 260, life: 0.85 });
    LD.FX.ring(o.x, o.y - 6, Math.max(o.w, o.h) * 0.55, "rgba(203,213,225,.55)", 3, 0.35);
    LD.FX.shake(4);
    /* v3.3 柜子被打碎：里面躲着的人被强行弹出 */
    if (o.occupant) {
      const f = o.occupant;
      o.occupant = null;
      if (f && LD.Battle && LD.Battle.leaveLocker) LD.Battle.leaveLocker(f, true);
    }
    const def = LD.TERRAIN.types[o.kind] || {};
    if (def.explosive) (map.booms = map.booms || []).push({ x: o.x, y: o.y, r: o.boomR || 150, dmg: o.boomDmg || 40 });
    if (def.drop) (map.drops = map.drops || []).push({ x: o.x, y: o.y });
    /* v3.7 塔防：防御塔 / 水晶被打掉 → 交给战斗层结算金币、兵线强化与胜负 */
    if ((o.kind === "tower" || o.kind === "crystal") && LD.Battle && LD.Battle.onStructureBroken)
      LD.Battle.onStructureBroken(o);
  };

  /* ==========================================================
   *  v3.5 吹风机：气流判定
   *  机身 1 格，气流从出风口向外延伸 len 格、宽 1 格；只在机身正面生效。
   * ========================================================== */
  const WIND_DIR = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  T.inBlower = function (o, x, y) {
    if (!o || o.dead || o.kind !== "blower") return false;
    const half = TILE / 2, L = (o.len || 0) * TILE;
    const dx = x - o.x, dy = y - o.y;
    if (o.dir === 0) return dx >= 0 && dx <= half + L && Math.abs(dy) <= half;
    if (o.dir === 2) return dx <= 0 && dx >= -(half + L) && Math.abs(dy) <= half;
    if (o.dir === 1) return dy >= 0 && dy <= half + L && Math.abs(dx) <= half;
    return dy <= 0 && dy >= -(half + L) && Math.abs(dx) <= half;
  };
  /** 返回某点的风力向量（多台叠加）；不在任何气流里则返回 null */
  T.windAt = function (map, x, y) {
    if (!map || !map.props) return null;
    let vx = 0, vy = 0;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (o.kind !== "blower" || o.dead || !T.inBlower(o, x, y)) continue;
      const f = o.power || 420, d = WIND_DIR[o.dir] || WIND_DIR[0];
      vx += d.x * f; vy += d.y * f;
    }
    return (vx || vy) ? { x: vx, y: vy } : null;
  };

  /** 每帧推进可推动障碍：速度衰减 + 与墙 / 其他障碍 / 角色的碰撞 */
  T.update = function (map, dt, B) {
    if (!map) return;
    /* 炸药桶 / 补给箱的延迟结算（由战斗层处理伤害与掉落） */
    if (map.booms && map.booms.length) {
      const list = map.booms.splice(0, map.booms.length);
      list.forEach(b => { if (B && B.terrainBoom) B.terrainBoom(b.x, b.y, b.r, b.dmg); });
    }
    if (map.drops && map.drops.length) {
      const list = map.drops.splice(0, map.drops.length);
      list.forEach(d => { if (B && B.dropPickup) B.dropPickup(d.x, d.y); });
    }

    const world = (B && B.world) || (LD.WORLD || { w: 1600, h: 1600, pt: 120 });
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (o.carried) continue;                       // v3.3 被扛在身上的泥土：不推进、不碰撞
      if (o.flash > 0) o.flash = Math.max(0, o.flash - dt);

      /* 投掷木箱（运货）/ 泥土（v3.3）：飞行中受重力式减速，撞墙停下，撞人造成伤害 */
      if (o.cargo && !o.landed && !o.dead) {
        o.x += o.vx * dt; o.y += o.vy * dt;
        o.vx *= Math.exp(-0.7 * dt); o.vy *= Math.exp(-0.7 * dt);
        if (T.blockedAt(map, o, o.x, o.y)) {
          o.x -= o.vx * dt; o.y -= o.vy * dt;
          o.vx = 0; o.vy = 0; o.landed = true;
          if (B) LD.FX.shake(3);
        }
        const hw = o.w / 2, hh = o.h / 2;
        if (o.x < hw + 4 || o.x > world.w - hw - 4) { o.x = Math.max(hw + 4, Math.min(world.w - hw - 4, o.x)); o.vx = 0; o.landed = true; }
        if (o.y < world.pt + hh + 2 || o.y > world.h - hh - 4) { o.y = Math.max(world.pt + hh + 2, Math.min(world.h - hh - 4, o.y)); o.vy = 0; o.landed = true; }
        if (B && B.fighters) {
          for (let j = 0; j < B.fighters.length; j++) {
            const f = B.fighters[j];
            if (f.dead || f.bench || f === o.owner) continue;
            if (B.sameTeam && B.sameTeam(o.owner, f)) continue;
            if (Math.hypot(f.x - o.x, (f.y - 26) - o.y) < f.r + Math.max(o.w, o.h) * 0.45) {
              B.damage(o.owner || null, f, o.hitDmg || 25, { type: "skill", stun: o.kind === "mud" ? 0 : 1.0, kb: o.kind === "mud" ? 90 : 120, from: o.owner });
              LD.FX.float(f.x, f.y - 60, o.kind === "mud" ? "被泥土砸中！" : "被木箱砸中！", "#fbbf24", 15);
              o.vx = 0; o.vy = 0; o.landed = true;
              /* v3.3：泥土砸中人后损坏（消失），没砸中则落地重新可拾取 */
              if (o.kind === "mud") {
                o.dead = true; o.cargo = false;
                LD.FX.burst(o.x, o.y - 8, 16, ["#8a6b4a", "#5b4632", "#3f3021"], { speed: 190 });
                LD.FX.shake(3);
              }
              break;
            }
          }
        }
        if (o.landed) { o.cargo = false; o.throwT = 0; }
        continue;
      }

      if (!(o.kind === "pushable" || o.kind === "car" || o.kind === "tire")) continue;
      if (o.dead || o.driver) continue;              // 被驾驶的车由 battle.updateVehicles 接管
      const sp = Math.hypot(o.vx || 0, o.vy || 0);
      if (sp < 1.5) { o.vx = 0; o.vy = 0; continue; }

      const px = o.x, py = o.y;
      /* 分轴移动：撞到东西时只停这一轴，保留另一轴的滑动 */
      o.x += o.vx * dt;
      if (T.blockedAt(map, o, o.x, o.y)) { o.x = px; o.vx = 0; }
      o.y += o.vy * dt;
      if (T.blockedAt(map, o, o.x, o.y)) { o.y = py; o.vy = 0; }

      /* 地图边界 = 墙 */
      const hw = o.w / 2, hh = o.h / 2;
      const lx = hw + 4, rx = world.w - hw - 4;
      const ty = world.pt + hh + 2, by = world.h - hh - 4;
      if (o.x < lx) { o.x = lx; o.vx = Math.abs(o.vx) * 0.15; }
      if (o.x > rx) { o.x = rx; o.vx = -Math.abs(o.vx) * 0.15; }
      if (o.y < ty) { o.y = ty; o.vy = Math.abs(o.vy) * 0.15; }
      if (o.y > by) { o.y = by; o.vy = -Math.abs(o.vy) * 0.15; }

      /* 摩擦：速度指数衰减 */
      const damp = Math.exp(-3.1 * dt);
      o.vx *= damp; o.vy *= damp;

      /* 把挡在方块里的角色顶出去（避免方块压住人） */
      if (B && B.fighters) {
        for (let j = 0; j < B.fighters.length; j++) {
          const f = B.fighters[j];
          if (f.dead || f.bench) continue;
          const hit = T.pushOut(o, f.x, f.y, f.r);
          if (hit) { f.x += hit.nx * (hit.pen + 0.2); f.y += hit.ny * (hit.pen + 0.2); }
        }
      }
    }
  };

  /** 方块在 (x,y) 是否撞到别的障碍（忽略自己） */
  T.blockedAt = function (map, self, x, y) {
    const l = x - self.w / 2, r = x + self.w / 2;
    const t = y - self.h / 2, b = y + self.h / 2;
    for (let i = 0; i < map.props.length; i++) {
      const o = map.props[i];
      if (o === self || o.dead || !o.blockMove) continue;
      const ol = o.x - o.w / 2, or_ = o.x + o.w / 2, ot = o.y - o.h / 2, ob = o.y + o.h / 2;
      if (l < or_ && r > ol && t < ob && b > ot) return true;
    }
    return false;
  };

  /** 回合重开：被打碎的箱子复原、被推走的方块回到初始格、清掉投掷物 */
  T.reset = function (map) {
    if (!map) return;
    for (let i = map.props.length - 1; i >= 0; i--) {
      const o = map.props[i];
      if (o.runtime) { map.props.splice(i, 1); continue; }
      o.dead = false;
      o.hp = o.maxHp;
      o.flash = 0;
      o.vx = 0; o.vy = 0; o.free = false;
      o.cargo = false; o.landed = false;
      o.x = o.ox; o.y = o.oy;
      /* v3.3：柜子 / 泥土 / 车辆状态复位 */
      if (o.kind === "locker") o.occupant = null;
      if (o.kind === "mud") { o.carried = false; o.landed = true; }
      if (o.kind === "car") { o.driver = null; o.fuel = o.fuelMax; o.ramCd = 0; o.hornCd = 0; o.cannonCd = 0; o._fuelSaid = false; }
      /* v3.7 塔防建筑：射击计时与护盾提示一并复位 */
      if (o.kind === "tower" || o.kind === "crystal") { o.shotT = 0; o._guardAt = 0; }
    }
    map.booms = []; map.drops = [];
  };

  /** 统计（UI / 测试用） */
  T.counts = function (map) {
    const n = {};
    (LD.MAPS.sliders || []).forEach(s => { n[s.key] = 0; });
    if (!map) return n;
    map.props.forEach(o => { if (!o.dead && n[o.kind] != null) n[o.kind]++; });
    return n;
  };
})(window.LD = window.LD || {});
