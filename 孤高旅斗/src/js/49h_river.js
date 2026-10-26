/* ============================================================
 *  49h_river.js — v4.13 渡江战役（战斗模式）
 * ============================================================
 *  竖窄（常规宽 70%）横长（常规长 160%）的渡江战场：
 *
 *     ┌──┬─────────────────────────────────────┬────┐
 *     │左│            整片水（↓ 水流）          │右岸│
 *     │岸│   零星小岛 + 礁石（挡船也挡人）      │旗子│
 *     │出│   顺水漂下来的小油桶（给船加油）      │    │
 *     └──┴─────────────────────────────────────┴────┘
 *            ↑ 55 秒后江水从这里开始一条条吃掉左岸
 *
 *  规则要点：
 *    - 水里移速只剩三成多（深水 0.34 / 近岸浅水 0.52），只能靠船过江
 *    - 船 = kind "car"，驾驶 / 油量 / 被打强制下船全部复用汽车那套，
 *      区别只在于「船不能上岸」：船体一旦碰到陆地就停住
 *    - 船每隔 shipEvery 秒重刷一批，数量 = 存活人数 - 1，已经在船上的人被请下船
 *    - 开局只能用普攻；跑到右岸中央的旗子前按 P 完成登岸 → 技能与大招解锁
 *    - 活到最后赢
 *
 *  v4.13c 补上的三件事（解决「渡江这一步被绕过 / 过程全是空转」）：
 *    ① 涨潮  → 55 秒后江水从左侧起定时吞岸，给「为什么非渡不可」一个理由
 *    ② 水流  → 整条江恒定向下游推，过江必须持续修正航向，而不是按住右键等
 *    ③ 油桶  → 顺水漂来的补给，让「直线快冲」和「绕去捡油」之间产生取舍
 *
 *  为什么船不用新 kind：B.enterCar / B.exitCar / T.updateVehicles / 撞击 / 漏油
 *  全是按 kind === "car" 硬编码的。复用 car 能让「被打就翻船」这些行为零成本一致。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const T = LD.Terrain;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const TILE = 40;
  const C = () => LD.RIVER || {};
  const WATER = "#1e5f8a", WATER_HI = "#3b9ec4", WATER_LO = "#0b2f47";

  /* ---------------------------------------------------------- 水面几何 */

  /** 右岸起点 x（岸区左边界） */
  B.riverShoreRx = function () {
    return this.world.w - (C().shoreR || 250);
  };

  /**
   * 江水的左边界（随涨潮往右推进）。
   * v4.13c 之前这就是常量 shoreL；涨潮开始之后每涨一档，左岸就少一条，
   * 赖着不动的人会被一寸寸逼进水里。没有 this.river 时（initRiver 铺水之前）
   * 退回常量，否则会循环依赖。
   */
  B.riverLx = function () {
    const c = C();
    const st = this.river;
    const rise = st ? (st.rise || 0) : 0;
    return (c.shoreL || 250) - rise;
  };

  /** 某个点是否在水里（左岸 / 右岸之外都算水） */
  B.riverInWater = function (x, y) {
    const w = this.world;
    if (y < (w.pt || 0) + (C().shorePad || 46) || y > w.h - 12) return false;
    const lx = this.riverLx(), rx = this.riverShoreRx();
    return x > lx && x < rx;
  };

  /**
   * 站在水里的小岛上：不被水冲、也不吃减速。
   * 之前小岛纯装饰（甚至照样减速），加了水流之后必须真能「踩上去喘口气」，
   * 否则漂流会直接把人从岛上冲走，那 9 座岛就白摆了。
   */
  B.riverOnIslet = function (x, y) {
    const T2 = this.terrain;
    if (!T2 || !T2.props) return false;
    for (let i = 0; i < T2.props.length; i++) {
      const o = T2.props[i];
      if (!o.islet || o.dead) continue;
      if (Math.abs(o.x - x) < o.w / 2 - 4 && Math.abs(o.y - y) < o.h / 2 - 4) return true;
    }
    return false;
  };

  /** 水里某个点的移速倍率（靠岸变浅、水下走快一点） */
  B.riverWaterMul = function (x) {
    const c = C(), rx = this.riverShoreRx();
    const lx = this.riverLx();
    const band = c.shallowBand || 190;
    const dl = x - lx, dr = rx - x;
    if (dl < band || dr < band) return c.waterShallow || 0.52;
    return c.waterDeep || 0.34;
  };

  /* ---------------------------------------------------------- 地形构造 */

  /** 铺水：返回整片水面的若干大块（渲染用 + 角色减速判定用） */
  B.riverWaterTiles = function () {
    const c = C(), w = this.world, pt = w.pt || 0;
    const lx = this.riverLx(), rx = this.riverShoreRx();
    const top = pt + (c.shorePad || 46);
    const bot = w.h - 10;
    const cols = Math.max(1, Math.round((rx - lx) / 400));
    const cw = (rx - lx) / cols;
    const out = [];
    for (let i = 0; i < cols; i++) {
      out.push({ x0: lx + i * cw, x1: lx + (i + 1) * cw, y0: top, y1: bot });
    }
    return out;
  };

  /** 造一艘船（kind = car，vtype = 船只型号，贴图在 32_terrain_view 里画） */
  B.riverMakeShip = function (sx, sy) {
    const T2 = this.terrain;
    if (!T2 || !T2.props) return null;
    const id = pick(LD.SHIP_IDS || ["row"]);
    const sh = (LD.SHIPS || {})[id] || { tiles: [2, 2], speedMul: 0.775, fuelMul: 0.7 };
    const cw = sh.tiles[0], ch = sh.tiles[1];
    const c = C();
    /* v4.13b 油量：基准按 ShipFuel 随机，再乘这型船的油箱倍率。
     * 小船油箱小（竹筏 0.55 倍）、大船油箱大（福船 1.6 倍），
     * 配平成「快的带不远、远的不快」。 */
    const baseFuel = rnd((c.shipFuel || [900, 1600])[0], (c.shipFuel || [900, 1600])[1]);
    const fuelMax = Math.round(baseFuel * (sh.fuelMul || 1));
    const o = {
      uid: 800000 + T2.props.length + ((Math.random() * 5000) | 0),
      kind: "car", mat: "ship_" + id, shape: "square",
      cw: cw, ch: ch, w: cw * TILE, h: ch * TILE,
      x: sx, y: sy, ox: sx, oy: sy,
      elev: 26, mass: sh.big ? 5.2 : 3.2, hp: 0, maxHp: 0,
      dead: false, flash: 0, vx: 0, vy: 0, free: true,
      soft: false, blockMove: true, blockProj: false,
      variant: (Math.random() * 1000) | 0,
      /* 车辆字段：直接借用汽车的整套逻辑 */
      vtype: id, ship: true, shipImg: sh.img, big: !!sh.big,
      speedMul: sh.speedMul || 0.8,
      fuelMax: fuelMax,
      driver: null, ramCd: 0, hornCd: 0, cannonCd: 0, dryT: 0
    };
    o.fuel = o.fuelMax;
    T2.props.push(o);
    return o;
  };

  /** 找一块不在陆地、不压障碍的水面落点（给船 / 小岛用） */
  B.riverFreeWater = function (w, h, extraPad) {
    const T2 = this.terrain, c = C();
    if (!T2) return null;
    const lx = this.riverLx() + (extraPad || 40);
    const rx = this.riverShoreRx() - (extraPad || 40);
    const top = (this.world.pt || 0) + (c.shorePad || 46) + (extraPad || 40);
    const bot = this.world.h - (extraPad || 40) - 20;
    for (let tries = 0; tries < 60; tries++) {
      const x = rnd(lx + w / 2, rx - w / 2);
      const y = rnd(top + h / 2, bot - h / 2);
      if (x - w / 2 <= lx || x + w / 2 >= rx) continue;
      let bad = false;
      for (let i = 0; i < T2.props.length && !bad; i++) {
        const o = T2.props[i];
        if (o.dead || o.kind === "water") continue;      // 水面是整片铺的，不算占用
        if (Math.abs(o.x - x) < (o.w + w) / 2 + 12 && Math.abs(o.y - y) < (o.h + h) / 2 + 12) bad = true;
      }
      if (!bad) return { x: x, y: y };
    }
    return null;
  };

  /** 刷一批船：数量 = 存活人数 - 1；已经在船上的人被请下船 */
  B.riverSpawnShips = function (silent) {
    const c = C(), T2 = this.terrain;
    if (!T2 || !T2.props) return 0;
    const alive = this.casualAlive ? this.casualAlive() : this.fighters.filter(f => f.kind === "hero" && !f.dead);
    /* 先把旧船清掉（船不残留，每批都是新的） */
    for (let i = T2.props.length - 1; i >= 0; i--) {
      const o = T2.props[i];
      if (!o.ship) continue;
      if (o.driver) this.exitCar(o.driver, false);
      T2.props.splice(i, 1);
    }
    const n = Math.max(1, alive.length - 1);
    let made = 0;
    for (let i = 0; i < n * 3 && made < n; i++) {
      const id = pick(LD.SHIP_IDS || ["row"]);
      const sh = (LD.SHIPS || {})[id] || { tiles: [2, 2] };
      const spot = this.riverFreeWater(sh.tiles[0] * TILE, sh.tiles[1] * TILE, 60);
      if (!spot) continue;
      const o = this.riverMakeShip(spot.x, spot.y);
      if (!o) continue;
      /* 人少时给船提点速，别让最后两个人干等 */
      if (n <= 2) o.speedMul *= (c.shipMinMul || 1.6) * 0.6 + 0.4;
      made++;
    }
    if (!silent) {
      const cx = (C().shoreL + this.riverShoreRx()) / 2;
      FX.float(cx, (this.world.pt || 110) + 36, "江面漂来 " + made + " 艘船！", "#7dd3fc", 18);
      this.ev.push(["t", cx, (this.world.pt || 110) + 36, "江面漂来 " + made + " 艘船", "#7dd3fc"]);
      LD.Audio && LD.Audio.beep && LD.Audio.beep(420, 0.14, "triangle", 0.05);
    }
    return made;
  };

  /* ---------------------------------------------------------- 初始化 */

  B.initRiver = function () {
    const c = C(), w = this.world;
    const alive = this.fighters.filter(f => f.kind === "hero");
    const lx = c.shoreL || 250;

    /* ---- 地形：先清空随机设施，只留我们自己铺的水 / 小岛 ---- */
    if (this.terrain && this.terrain.props) this.terrain.props.length = 0;

    /* ---- 水面（视觉块 + 减速判定都读 terrain.props 里的 water） ---- */
    const bands = this.riverWaterTiles();
    bands.forEach(b => {
      const o = {
        uid: 810000 + Math.floor(Math.random() * 99999),
        kind: "water", mat: "water_pool", shape: "water",
        cw: Math.round((b.x1 - b.x0) / TILE), ch: Math.round((b.y1 - b.y0) / TILE),
        w: b.x1 - b.x0, h: b.y1 - b.y0,
        x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2,
        ox: (b.x0 + b.x1) / 2, oy: (b.y0 + b.y1) / 2,
        elev: 0, mass: 0, hp: 0, maxHp: 0,
        dead: false, flash: 0, vx: 0, vy: 0, free: true,
        soft: true, blockMove: false, blockProj: false,
        river: true
      };
      this.terrain.props.push(o);
    });

    /* ---- 水里零星的小陆地：可站、可停船，上面再撒 1~3 个障碍挡船 ---- */
    const nIslet = c.islets || 9;
    for (let i = 0; i < nIslet; i++) {
      const cw = Math.round(rnd((c.isletTiles || [2, 3])[0], (c.isletTiles || [2, 3])[1]));
      const ch = Math.round(rnd((c.isletTiles || [2, 3])[0], (c.isletTiles || [2, 3])[1]));
      const spot = this.riverFreeWater(cw * TILE, ch * TILE, 70);
      if (!spot) continue;
      const isle = {
        uid: 820000 + i * 37 + Math.floor(Math.random() * 999),
        kind: "solid", mat: "sand", shape: "square",
        cw: cw, ch: ch, w: cw * TILE, h: ch * TILE,
        x: spot.x, y: spot.y, ox: spot.x, oy: spot.y,
        elev: 6, mass: 1.2, hp: 0, maxHp: 0,
        dead: false, flash: 0, vx: 0, vy: 0, free: true,
        soft: false, blockMove: false, blockProj: false,   // 不挡人：可以踩上去喘口气
        islet: true, isletC: cw, isletR: ch
      };
      this.terrain.props.push(isle);
      /* 岛上的礁石：挡船挡人 */
      const nProp = Math.round(rnd((c.isletProps || [1, 3])[0], (c.isletProps || [1, 3])[1]));
      for (let k = 0; k < nProp; k++) {
        const rock = {
          uid: 830000 + i * 53 + k * 7 + Math.floor(Math.random() * 999),
          kind: "solid", mat: k % 2 ? "rock" : "stone",
          shape: "square", cw: 1, ch: 1, w: TILE, h: TILE,
          x: spot.x + rnd(-(cw - 1) * TILE / 2, (cw - 1) * TILE / 2),
          y: spot.y + rnd(-(ch - 1) * TILE / 2, (ch - 1) * TILE / 2),
          ox: 0, oy: 0, elev: 26, mass: 2.4, hp: 0, maxHp: 0,
          dead: false, flash: 0, vx: 0, vy: 0, free: true,
          soft: false, blockMove: true, blockProj: true, riverRock: true
        };
        rock.ox = rock.x; rock.oy = rock.y;
        this.terrain.props.push(rock);
      }
    }

    /* ---- 全员摆在左岸 ---- */
    alive.forEach((f, i) => {
      const n = Math.max(1, alive.length);
      const span = Math.max(1, (w.h - (w.pt || 110) - 2 * (c.shorePad || 46) - 100));
      f.x = lx * 0.5 + rnd(-lx * 0.22, lx * 0.22);
      f.y = (w.pt || 110) + (c.shorePad || 46) + 60 + span * (n === 1 ? 0.5 : i / (n - 1));
      f.x = clamp(f.x, 50, lx - 40);
      f.vx = 0; f.vy = 0; f.knockLeft = 0;
      f.riverUnlocked = false;
      f._riverLockT = null;
      f._rivT = 0;
      if (f.ctrl) { f.ctrl.mx = 0; f.ctrl.my = 0; }
    });

    /* ---- 右岸中央的旗子 ---- */
    const rx = this.riverShoreRx();
    const fx = c.flagX > 0 ? c.flagX : rx + (c.shoreR || 250) * 0.5;
    this.river = {
      flag: { x: fx, y: (w.pt || 110) + (c.shorePad || 46) + (w.h - (w.pt || 110) - (c.shorePad || 46) - 20) / 2, r: c.flagR || 62 },
      shipT: c.shipFirst || 6,
      refreshT: c.shipEvery || 30,
      batch: 0,
      unlockedBy: [],
      spawnT: 0,
      /* v4.13c 涨潮：rise = 已经淹掉左岸多少 px，riseT 距下一档还剩多久 */
      rise: 0,
      riseT: c.riseAfter || 55,
      riseStep: 0,
      /* v4.13c 漂流补给：顺水漂下来的小油桶（不进地形，自己管，免得撞上碰撞与清理逻辑） */
      drumT: c.drumFirst || 5,
      drums: []
    };
    this.riverSpawnShips(true);
    this.river.batch = 1;

    FX.float(w.w * 0.5, (w.pt || 110) + 36, "渡江！先抢船，再抢右岸的旗子", "#7dd3fc", 20);
  };

  /* ---------------------------------------------------------- 每帧 */

  B.updateRiver = function (dt) {
    const st = this.river, c = C();
    if (!st) return;
    const w = this.world;
    const T2 = this.terrain;

    /* ---- 船不能上岸：任何压到陆地（左岸 / 右岸 / 小岛）的船都停住 ---- */
    if (T2 && T2.props) {
      for (let i = 0; i < T2.props.length; i++) {
        const o = T2.props[i];
        if (!o.ship || o.dead) continue;
        const l = o.x - o.w / 2, r = o.x + o.w / 2;
        const shL = this.riverLx();          // 涨潮后左岸会退，船的活动范围跟着变
        const shR = this.riverShoreRx();
        let onLand = false;
        if (l < shL - 4) onLand = true;
        else if (r > shR + 4) onLand = true;
        if (!onLand) {
          /* 小岛也算陆地 */
          for (let k = 0; k < T2.props.length; k++) {
            const isl = T2.props[k];
            if (!isl.islet || isl.dead) continue;
            if (Math.abs(isl.x - o.x) < (isl.w + o.w) / 2 - 6 &&
                Math.abs(isl.y - o.y) < (isl.h + o.h) / 2 - 6) { onLand = true; break; }
          }
        }
        if (onLand) {
          o.vx *= 0.2; o.vy *= 0.2;
          if (o.driver && (o._beachT || 0) <= 0) {
            o._beachT = 1.0;
            FX.float(o.x, o.y - 60, "船搁浅了，只能下船蹚水", "#fbbf24", 14);
          }
        }
        if (o._beachT > 0) o._beachT = Math.max(0, o._beachT - dt);

        /* v4.13b 油箱见底：先飘一会儿，dryFade 秒后沉没销毁。
         * 不做这一步的话，江面很快会被一堆没油的空船堵住（它们 blockMove），
         * 后面刷出来的船和活动路线都会被卡死。 */
        if ((o.fuel || 0) <= 0 && o.driver) {
          o.dryT = (o.dryT || 0) + dt;
          if (o.dryT > (c.dryFade || 6)) {
            const d = o.driver;
            FX.burst(o.x, o.y, 20, ["#60a5fa", "#bae6fd", "#1e5f8a"], { speed: 220 });
            FX.ring(o.x, o.y, Math.max(o.w, o.h) * 0.7, "rgba(125,211,252,.8)", 5, 0.5);
            FX.float(o.x, o.y - 50, "船沉了！", "#7dd3fc", 16);
            this.exitCar(d, false);
            o.dead = true;
          }
        } else if ((o.fuel || 0) > 0) {
          o.dryT = 0;
        }
      }
    }

    /* ---- v4.13c ①涨潮：一寸寸吃掉左岸，逼所有人动起来 ----
     * 没有这一条，最优解就是「赖在左岸把对手耗死」，整个渡江流程被完全绕过。
     * 开局先给一段自由交火的时间（riseAfter），之后每 riseEvery 秒淹掉一格。 */
    if (st.riseT > 0) {
      st.riseT -= dt;
      if (st.riseT <= 0) {
        const left = (c.riseMax || 5) - (st.riseStep || 0);
        if (left > 0) {
          st.riseStep = (st.riseStep || 0) + 1;
          st.rise += (c.riseStep || 1) * TILE;
          st.riseT = c.riseEvery || 8;
          const lineX = this.riverLx();
          FX.float(lineX + 100, (w.pt || 110) + 34, "涨潮！左岸又淹了一条", "#7dd3fc", 19);
          this.ev.push(["t", lineX + 100, (w.pt || 110) + 34, "涨潮！左岸又淹了一条", "#7dd3fc"]);
          LD.Audio && LD.Audio.beep && LD.Audio.beep(240, 0.2, "sine", 0.06);
        } else {
          st.riseT = 9999;                  // 涨到上限就收手，左岸留一格保底
        }
      }
    }

    /* ---- v4.13c ②水流：整条江恒定向下游冲 ----
     * 加了这条之后，「坐船过江」不再是按住右键干等二十几秒，
     * 而是要一边往右打舵一边持续修正下漂；想逆着水往上蹭还要额外吃亏。 */
    this.riverFlow(dt);

    /* ---- v4.13c ③漂流补给：顺水漂下来的小油桶 ----
     * 坐船压过去自动加油，游水的人撞上回点血和能量。
     * 桶随水流下移，所以「直线冲」和「绕去捡油」之间有了取舍。 */
    this.riverDrums(dt);

    /* ---- 登岸解锁 ---- */
    const flag = st.flag;
    for (const f of this.fighters) {
      if (f.kind !== "hero" || f.dead || f.bench) continue;
      if (f.riverUnlocked) continue;
      /* 只有踩在右岸上才算（水里贴过去不算） */
      if (f.x < this.riverShoreRx() + 10) continue;
      if (Math.hypot(f.x - flag.x, f.y - flag.y) > (flag.r || 62) + f.r) continue;
      /* 到了旗子圈里就算登岸（交互键由 RULE_INTERACT 处理，这里兜底自动解锁时不抢） */
      f.riverNearFlag = true;
    }

    /* ---- 船刷新计时 ---- */
    if (st.shipT > 0) st.shipT -= dt;
    if (st.shipT <= 0) {
      st.shipT = st.refreshT;
      st.batch++;
      this.riverSpawnShips(false);
    }

    /* ---- 水里冒水花（纯装饰，跟着镜头范围抽） ---- */
    if (Math.random() < dt * 22 && this.cam) {
      const cx = this.cam.x + rnd(0, 900), cy = this.cam.y + rnd(0, 700);
      if (this.riverInWater(cx, cy)) FX.trail(cx, cy, "rgba(186,230,253,.55)", 4, 0.4);
    }
  };

  /* ---------------------------------------------------------- v4.13c 水流
   * 整条江恒定向下游（屏幕下方）冲。
   * 这一条把「坐船横渡」从按住右键干等二十几秒，变成需要一边往右打舵一边修正下漂的操作。
   * 逆水往上游顶的额外阻力放在 LD.RULE_SPD.river 里做（那里才是算速度的地方），
   * 这里只负责「不管玩家怎么操作，水都在把人和船往下推」的那一份位移。 */

  B.riverFlow = function (dt) {
    const c = C(), w = this.world, T2 = this.terrain;
    const flow = (c.drift || 34) * dt;
    if (flow <= 0) return;
    const bottom = w.h - 16;

    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (f.dead || f.bench || f.kind !== "hero") continue;
      if (f.rideCar) continue;                          // 骑手跟着船走，下面统一推船体
      if (!this.riverInWater(f.x, f.y)) continue;
      if (this.riverOnIslet(f.x, f.y)) continue;        // 踩在小岛上不算泡在水里
      const ny = Math.min(bottom, f.y + flow);
      if (!this.hitWallAt(f, f.x, ny)) f.y = ny;
      f.inFlow = true;
    }

    if (!T2 || !T2.props) return;
    for (let i = 0; i < T2.props.length; i++) {
      const o = T2.props[i];
      if (!o.ship || o.dead) continue;
      const py = o.y;
      o.y = Math.min(w.h - o.h / 2 - 6, o.y + flow * (c.driftShipMul == null ? 0.85 : c.driftShipMul));
      if (o.y !== py && T.blockedAt(T2, o, o.x, o.y)) o.y = py;
      if (o.driver) { o.driver.x = o.x; o.driver.y = o.y; }
    }
  };

  /* ---------------------------------------------------------- v4.13c 漂流补给
   * 顺水漂下来的小油桶：坐船压过去自动加油，游水的人撞上回血回能。
   * 它们跟着水流从上游一路漂到下边，所以要不要绕路去捡，是这一版渡江的核心取舍之一。 */

  B.riverDrums = function (dt) {
    const st = this.river, c = C(), w = this.world;
    if (!st) return;
    st.drums = st.drums || [];

    if (st.drumT > 0) st.drumT -= dt;
    if (st.drumT <= 0 && st.drums.length < (c.drumMax || 5)) {
      st.drumT = c.drumEvery || 9;
      const d = {
        x: rnd(this.riverLx() + 90, this.riverShoreRx() - 90),
        y: (w.pt || 110) + (c.shorePad || 46) + 30,
        bob: Math.random() * 6.28, life: c.drumLife || 34, spin: rnd(-1, 1)
      };
      st.drums.push(d);
      FX.float(d.x, d.y, "上游漂来一只油桶", "#fbbf24", 13);
    }

    for (let i = st.drums.length - 1; i >= 0; i--) {
      const d = st.drums[i];
      d.life -= dt;
      d.y += (c.drift || 34) * dt;
      d.bob += dt * 3;
      if (d.life <= 0 || d.y > w.h - 34 || d.x < this.riverLx()) { st.drums.splice(i, 1); continue; }

      let taken = false;
      for (let j = 0; j < this.fighters.length && !taken; j++) {
        const f = this.fighters[j];
        if (f.dead || f.bench || f.kind !== "hero") continue;
        if (f.rideCar) {
          const sh = f.rideCar;
          if (Math.abs(sh.x - d.x) < sh.w / 2 + 14 && Math.abs(sh.y - d.y) < sh.h / 2 + 14) {
            const add = Math.round(sh.fuelMax * rnd((c.drumMul || [0.22, 0.34])[0], (c.drumMul || [0.22, 0.34])[1]));
            sh.fuel = Math.min(sh.fuelMax, sh.fuel + add);
            FX.float(sh.x, sh.y - 62, "加油 +" + add, "#34d399", 16);
            FX.ring(d.x, d.y, 42, "rgba(52,211,153,.85)", 6, 0.4);
            taken = true;
          }
        } else if (Math.hypot(f.x - d.x, f.y - d.y) < (c.drumR || 28) + f.r) {
          f.hp = Math.min(f.maxHp, f.hp + (c.drumHeroHp || 30));
          f.energy = Math.min(f.maxEnergy || 150, f.energy + (c.drumHeroEn || 20));
          FX.float(f.x, f.y - 56, "浮油 +" + (c.drumHeroHp || 30) + " 血", "#34d399", 15);
          taken = true;
        }
      }
      if (taken) { st.drums.splice(i, 1); continue; }
      if (Math.random() < dt * 3) FX.trail(d.x, d.y + 10, "rgba(251,191,36,.35)", 5, 0.5);
    }
  };

  /* ---------------------------------------------------------- 登岸交互 */

  B.riverUnlock = function (f) {
    if (!f || f.riverUnlocked || !this.river) return false;
    const st = this.river;
    if (f.x < this.riverShoreRx()) {
      FX.float(f.x, f.y - 60, "得到岸上才升旗", "#94a3b8", 13);
      return false;
    }
    if (Math.hypot(f.x - st.flag.x, f.y - st.flag.y) > (st.flag.r) + f.r) return false;
    f.riverUnlocked = true;
    st.unlockedBy.push(f.side);
    FX.ring(st.flag.x, st.flag.y - 30, 96, "rgba(250,204,21,.95)", 6, 0.5);
    FX.burst(st.flag.x, st.flag.y - 40, 28, ["#facc15", "#fde68a", "#fff"], { speed: 300 });
    FX.float(f.x, f.y - 70, "登岸成功！技能与大招已解锁", "#fcd34d", 19);
    this.ev.push(["u", f.x, f.y - 70, "登岸成功！招式解锁", "#fcd34d"]);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(720, 0.16, "triangle", 0.06);
    return true;
  };

  LD.RULE_INTERACT.river = function (f) {
    if (!this.river || f.riverUnlocked) return false;
    const st = this.river;
    if (f.x < this.riverShoreRx()) return false;
    if (Math.hypot(f.x - st.flag.x, f.y - st.flag.y) > st.flag.r + f.r + 18) return false;
    return this.riverUnlock(f);
  };

  LD.RULE_LABEL.river = function (f) {
    if (!this.river || f.riverUnlocked) return "";
    const st = this.river;
    if (f.x < this.riverShoreRx()) return "";
    if (Math.hypot(f.x - st.flag.x, f.y - st.flag.y) > st.flag.r + f.r + 18) return "";
    return "登岸升旗（解锁招式）";
  };

  /** 本地玩家是否站在旗子边上（世界层提示 / P 键提示共用一套判定） */
  B.riverNearFlagPad = function (f, pad) {
    const st = this.river;
    if (!st || !f || f.dead) return false;
    if (f.x < this.riverShoreRx()) return false;
    return Math.hypot(f.x - st.flag.x, f.y - st.flag.y) <= st.flag.r + f.r + (pad || 0);
  };

  /* 水里减速：挂在全局速度钩子上 */
  LD.RULE_SPD.river = function (f) {
    if (f.rideCar) return 1;
    if (!this.riverInWater(f.x, f.y)) return 1;
    if (this.riverOnIslet(f.x, f.y)) return 1;      // v4.13c 小岛是真正的落脚点：不减速也不被冲
    let k = this.riverWaterMul(f.x);
    /* 逆水的代价不在这里额外扣——它已经全部体现在 riverFlow 那一份恒定下漂上了。
     * 这里再加一道惩罚就会出现「无论怎么操作都只能往下走」，人会被永久压在地图下缘。 */
    return k;
  };

  /* ---------------------------------------------------------- 渲染 */

  B.drawRiver = function (ctx) {
    const st = this.river, w = this.world, c = C();
    if (!st) return;
    const baseLx = c.shoreL || 250;
    const lx = this.riverLx(), rx = this.riverShoreRx();
    const pt = w.pt || 0;
    const pad = c.shorePad || 46;

    /* 岸：左右两块沙滩（左岸随涨潮变窄） */
    ctx.save();
    const sh = (x0, x1) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, "#6b5a3e"); g.addColorStop(0.5, "#8a7550"); g.addColorStop(1, "#5e5038");
      ctx.fillStyle = g;
      ctx.fillRect(x0, pt + pad - 8, x1 - x0, w.h - pt - pad - 2);
      ctx.strokeStyle = "rgba(247,231,190,.35)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, pt + pad - 8); ctx.lineTo(x1, pt + pad - 8); ctx.stroke();
    };
    sh(0, lx);
    sh(rx, w.w);
    ctx.restore();

    /* 被淹掉的那一条：湿沙 + 退潮线，让人一眼看出左岸少了多少 */
    if ((st.rise || 0) > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(30,95,138,.55)";
      ctx.fillRect(lx, pt + pad - 8, baseLx - lx, w.h - pt - pad - 2);
      ctx.strokeStyle = "rgba(186,230,253,.4)"; ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(lx, pt + pad - 8); ctx.lineTo(lx, w.h - 10); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* 岸边浪花带 */
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.12 * Math.sin(this.t * 1.6);
    ctx.strokeStyle = "#bae6fd"; ctx.lineWidth = 3;
    for (const bx of [lx, rx]) {
      ctx.beginPath();
      ctx.moveTo(bx, pt + pad - 4);
      for (let y = pt + pad - 4; y < w.h - 6; y += 16) {
        ctx.lineTo(bx + Math.sin(y * 0.05 + this.t * 2) * 4, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    /* v4.13c 水流动感：几条向下滚的高光，看得出水在往哪儿冲 */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#bae6fd"; ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const px = lx + 40 + i * ((rx - lx - 80) / 6);
      const off = ((this.t * (c.drift || 34) + i * 137) % 260);
      for (let k = -1; k < 4; k++) {
        const y0 = pt + pad + off + k * 260;
        if (y0 > w.h - 10) continue;
        ctx.beginPath();
        ctx.moveTo(px, y0);
        ctx.quadraticCurveTo(px + 10, y0 + 18, px, y0 + 36);
        ctx.stroke();
      }
    }
    ctx.restore();

    /* v4.13c 漂流补给：顺水漂下来的小油桶 */
    if (st.drums && st.drums.length) {
      ctx.save();
      st.drums.forEach(d => {
        const bob = Math.sin(d.bob) * 3;
        ctx.fillStyle = "rgba(0,0,0,.3)";
        ctx.beginPath(); ctx.ellipse(d.x, d.y + 14, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(d.x, d.y + bob);
        ctx.rotate(Math.sin(d.bob * 0.6) * 0.14);
        ctx.fillStyle = "#b45309";
        roundRectPath(ctx, -15, -17, 30, 34, 8); ctx.fill();
        ctx.fillStyle = "#fbbf24";
        roundRectPath(ctx, -15, -5, 30, 10, 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 1.5;
        roundRectPath(ctx, -15, -17, 30, 34, 8); ctx.stroke();
        ctx.restore();
        /* 快漂到底了就闪红提示，别让人白追一趟 */
        if (d.life < 6) {
          ctx.globalAlpha = 0.35 + 0.35 * Math.sin(this.t * 9);
          ctx.strokeStyle = "#f87171"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(d.x, d.y + bob, 24, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      });
      ctx.restore();
    }

    /* 小岛：踩上去能喘口气的沙洲 */
    const T2 = this.terrain;
    if (T2 && T2.props) {
      ctx.save();
      T2.props.forEach(o => {
        if (!o.islet || o.dead) return;
        ctx.fillStyle = "rgba(6,20,30,.42)";
        ctx.beginPath();
        ctx.ellipse(o.x + 3, o.y + o.h * 0.32, o.w * 0.52, o.h * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(o.x, o.y, o.w * 0.1, o.x, o.y, o.w * 0.62);
        g.addColorStop(0, "#d8c48c"); g.addColorStop(0.72, "#b9a271"); g.addColorStop(1, "#8d7a52");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(o.x, o.y + o.h * 0.16, o.w * 0.52, o.h * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,247,214,.45)"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(o.x, o.y + o.h * 0.16, o.w * 0.52, o.h * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }

    /* 右岸旗子 */
    const fg = st.flag;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.34)";
    ctx.beginPath(); ctx.ellipse(fg.x + 3, fg.y + 16, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
    /* 旗杆 */
    ctx.strokeStyle = "#d6d3d1"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(fg.x, fg.y + 14); ctx.lineTo(fg.x, fg.y - 66); ctx.stroke();
    /* 旗面 */
    const wave = Math.sin(this.t * 3) * 4;
    const unlockAll = st.unlockedBy.length >= Math.max(1, this.fighters.filter(f => f.kind === "hero" && !f.dead).length);
    ctx.fillStyle = unlockAll ? "#fbbf24" : "#ef4444";
    ctx.beginPath();
    ctx.moveTo(fg.x + 2, fg.y - 64);
    ctx.quadraticCurveTo(fg.x + 30, fg.y - 58 + wave, fg.x + 54, fg.y - 50 + wave);
    ctx.lineTo(fg.x + 54, fg.y - 22 + wave);
    ctx.quadraticCurveTo(fg.x + 30, fg.y - 30 + wave, fg.x + 2, fg.y - 26);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1.5; ctx.stroke();
    /* 交互圈 */
    if (!unlockAll) {
      ctx.globalAlpha = 0.25 + 0.18 * Math.sin(this.t * 4);
      ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(fg.x, fg.y + 10, fg.r, fg.r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    /* v4.13d 旗子上的「按 P」气泡 —— 底部 P 键槽只有十来个字的空间，
     * 玩家经常走到旗子边还以为这里没东西可交互。这里在世界层直接给一个气泡，
     * 只要靠近就一定能看见（用的是和 RULE_LABEL 同一套判定，不会「有提示却按不动」）。 */
    const me = this.hero(this.mySide == null ? 0 : this.mySide);
    if (me && !me.dead && !me.riverUnlocked && this.riverNearFlagPad(me, 210)) {
      const inRange = this.riverNearFlagPad(me, 18);
      const by = fg.y - 96 + Math.sin(this.t * 2.6) * 3;
      ctx.save();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
      const tw = ctx.measureText("按 P 登岸升旗").width + 26;
      ctx.fillStyle = inRange ? "rgba(250,204,21,.92)" : "rgba(8,20,32,.78)";
      roundRectPath(ctx, fg.x - tw / 2, by - 15, tw, 30, 9);
      ctx.fill();
      ctx.strokeStyle = inRange ? "#fde68a" : "rgba(250,204,21,.45)";
      ctx.lineWidth = inRange ? 2 : 1.4;
      roundRectPath(ctx, fg.x - tw / 2, by - 15, tw, 30, 9);
      ctx.stroke();
      /* 小尖角，指着旗杆 */
      ctx.beginPath();
      ctx.moveTo(fg.x - 6, by + 15); ctx.lineTo(fg.x + 6, by + 15); ctx.lineTo(fg.x, by + 23);
      ctx.closePath(); ctx.fillStyle = inRange ? "rgba(250,204,21,.92)" : "rgba(8,20,32,.78)"; ctx.fill();
      ctx.fillStyle = inRange ? "#3b2a06" : "#fcd34d";
      ctx.fillText("按 P 登岸升旗", fg.x, by + 1);
      if (!inRange) {
        ctx.font = "12px system-ui,'Microsoft YaHei',sans-serif";
        ctx.fillStyle = "rgba(226,232,240,.8)";
        ctx.fillText("再靠近一点", fg.x, by + 34);
      }
      ctx.restore();
    }

};

  /* ---------------------------------------------------------- 顶部 HUD
   * 注意这里必须走**屏幕坐标**：写在 drawRiver（世界层）里的字会被摄像机滚走，
   * 地图越高越看不到。由 40b_draw.js 在所有世界内容画完之后调用。
   * ---------------------------------------------------------- */
  B.drawRiverHud = function (ctx, W, H) {
    const st = this.river, c = C();
    if (!st) return;
    const me = this.hero(this.mySide == null ? 0 : this.mySide);
    const total = st.refreshT || c.shipEvery || 30;
    const left = Math.max(0, st.shipT);
    const rush = left <= 5;                      // 最后 5 秒开始闪
    const onShip = !!(me && me.rideCar && !me.dead);
    /* 涨潮预警：只在这一档还没涨到上限时才提示 */
    const riseMax = c.riseMax || 5;
    const warnLeft = (st.riseT >= 0 && st.riseT < (c.riseWarn || 5) && (st.riseStep || 0) < riseMax)
      ? Math.max(0, st.riseT) : -1;

    const barW = Math.min(300, W * 0.3);
    const barX = W / 2 - barW / 2, barY = 12, barH = 20;

    /* ---- 先排版：面板高度取决于「有没有坐船」和「有没有涨潮预警」 ---- */
    let y = barY + barH + 14;                    // 第二行（已登岸人数 / 我方状态）
    const fuelY = onShip ? y + 18 : -1;
    if (onShip) y = fuelY + 18;
    const labY = y + 16;                         // 「渡江进度」小标题
    const trkY = labY + 8;                       // 进度条本体
    const warnY = trkY + 24;
    const bottom = (warnLeft >= 0 ? warnY + 8 : trkY + 10) + 8;

    ctx.save();
    /* 底板 */
    ctx.fillStyle = "rgba(8,20,32,.72)";
    roundRectPath(ctx, barX - 10, barY - 8, barW + 20, bottom - barY + 8, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(125,211,252,.35)"; ctx.lineWidth = 1.5;
    roundRectPath(ctx, barX - 10, barY - 8, barW + 20, bottom - barY + 8, 10);
    ctx.stroke();

    /* 标题 */
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 13px system-ui,'Microsoft YaHei',sans-serif";
    ctx.fillStyle = rush ? "#fbbf24" : "#7dd3fc";
    if (rush) ctx.globalAlpha = 0.65 + 0.35 * Math.abs(Math.sin(this.t * 6));
    ctx.fillText("⛵ 下一批船 " + left.toFixed(1) + "s", W / 2, barY + 2);
    ctx.globalAlpha = 1;

    /* 进度条：越接近刷新越满 */
    const p = total > 0 ? 1 - left / total : 1;
    ctx.fillStyle = "rgba(148,163,184,.28)";
    roundRectPath(ctx, barX, barY + barH - 6, barW, 7, 3.5); ctx.fill();
    ctx.fillStyle = rush ? "#fbbf24" : "#38bdf8";
    roundRectPath(ctx, barX, barY + barH - 6, Math.max(2, barW * p), 7, 3.5); ctx.fill();

    /* 第二行：我这边的状态 */
    ctx.font = "12px system-ui,'Microsoft YaHei',sans-serif";
    const meTxt = me && !me.dead ? (me.riverUnlocked ? "已解锁招式" : "只有普攻") : "观战中";
    ctx.fillStyle = me && me.riverUnlocked ? "#fcd34d" : "#94a3b8";
    ctx.fillText("已登岸 " + st.unlockedBy.length + " 人　·　我方 " + meTxt, W / 2, barY + barH + 14);

    /* 自己在船上时，额外给一条油量 / 还能开多远 */
    if (onShip) {
      const sh = me.rideCar;
      const pct = sh.fuelMax > 0 ? Math.max(0, sh.fuel / sh.fuelMax) : 0;
      ctx.font = "11px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(148,163,184,.9)";
      ctx.fillText("油量", barX, fuelY + 4);
      ctx.fillStyle = "rgba(148,163,184,.28)";
      roundRectPath(ctx, barX + 34, fuelY - 1, barW - 34, 7, 3.5); ctx.fill();
      ctx.fillStyle = pct > 0.35 ? "#34d399" : (pct > 0 ? "#f59e0b" : "#ef4444");
      roundRectPath(ctx, barX + 34, fuelY - 1, Math.max(pct > 0 ? 3 : 0, (barW - 34) * pct), 7, 3.5); ctx.fill();
      ctx.textAlign = "right";
      ctx.fillStyle = pct > 0 ? "rgba(226,232,240,.9)" : "#fca5a5";
      ctx.fillText(pct > 0 ? Math.round(sh.fuel) + " 可航行" : "没油了", barX + barW, fuelY + 16);
    }

    /* ---- v4.13c ④渡江进度：把每个人打到一条横条上 ----
     * 没有这条，玩家只知道自己在动，不知道谁领先、谁快靠岸；
     * 配上「越靠近右岸仇恨越高」的设定之后，这条就是局势雷达。 */
    const rx = this.riverShoreRx();
    const lxNow = this.riverLx();
    const mapX = px => barX + Math.max(0, Math.min(1, px / this.world.w)) * barW;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "11px system-ui,'Microsoft YaHei',sans-serif";
    ctx.fillStyle = "rgba(148,163,184,.9)";
    ctx.fillText("渡江进度", barX, labY);
    ctx.textAlign = "right";
    const myPct = me && !me.dead
      ? Math.round(clamp((me.x - (c.shoreL || 250)) / Math.max(1, rx - (c.shoreL || 250)), 0, 1) * 100) : 0;
    ctx.fillStyle = me && me.riverUnlocked ? "#fcd34d" : "#e2e8f0";
    ctx.fillText(me && !me.dead ? "我方 " + myPct + "%" : "观战", barX + barW, labY);

    ctx.save();
    roundRectPath(ctx, barX, trkY, barW, 10, 5); ctx.clip();
    /* 左岸（会随涨潮变窄）/ 江面 / 右岸 三段 */
    ctx.fillStyle = "rgba(180,150,100,.62)";
    ctx.fillRect(mapX(0), trkY, mapX(lxNow) - mapX(0), 10);
    ctx.fillStyle = "rgba(56,189,248,.42)";
    ctx.fillRect(mapX(lxNow), trkY, mapX(rx) - mapX(lxNow), 10);
    ctx.fillStyle = "rgba(250,204,21,.5)";
    ctx.fillRect(mapX(rx), trkY, mapX(this.world.w) - mapX(rx), 10);
    /* 正在推进的水线 */
    if ((st.rise || 0) > 0) {
      ctx.fillStyle = "rgba(186,230,253,.85)";
      ctx.fillRect(mapX(lxNow) - 1, trkY, 2, 10);
    }
    ctx.restore();

    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.dead || f.bench) return;
      const mine = f === me;
      const friend = mine || !!(me && this.sameTeam && this.sameTeam(me, f));
      ctx.fillStyle = mine ? "#ffffff" : friend ? "#7dd3fc" : "#f87171";
      ctx.beginPath();
      ctx.arc(mapX(f.x), trkY + 5, mine ? 4.6 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (f.riverUnlocked) {
        ctx.strokeStyle = "rgba(250,204,21,.9)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(mapX(f.x), trkY + 5, 6.5, 0, Math.PI * 2); ctx.stroke();
      }
    });

    /* ---- 涨潮预警：给玩家几秒钟决定要不要先动 ---- */
    if (warnLeft >= 0) {
      ctx.textAlign = "center";
      ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
      ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(this.t * 7));
      ctx.fillStyle = "#fbbf24";
      ctx.fillText("🌊 江水上涨 " + warnLeft.toFixed(1) + "s 后淹掉左岸一条", W / 2, warnY);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ---------------------------------------------------------- 人机 */

  /**
   * 渡江人机优先级（严格照玩家要求排）：
   *   1. 还没登岸 → 先到右岸（有船就抢船，没船就蹚水往右走）
   *   2. 路上看到船就近上船
   *   3. 上岸后进入正常战斗，且对「快要靠岸的人」仇恨更高
   *
   * 注意：渡江是**战斗模式**，人机不走 LD.casualAI（那套会禁用全部招式）。
   * 这里只返回 true 表示「本帧动作已接管」，50_ai.js 看到 true 就直接 return，
   * 返回 false 时落回通用战斗逻辑（已解锁的人就是这么打的）。
   */
  B.riverThink = function (f, dt, ctrl) {
    const st = this.river;
    const c = C();
    if (!st) { ctrl.mx = 0; ctrl.my = 0; return; }
    const rx = this.riverShoreRx();
    ctrl.press = ctrl.press || {};

    /* ---- 已经在岸上且解锁：走正常战斗（交给 50_ai.js 的通用分支） ---- */
    if (f.riverUnlocked) return false;

    /* ---- 在船上：朝右岸开 ---- */
    if (f.rideCar) {
      const ship = f.rideCar;
      /* 油量吃紧时先绕去捡顺路的油桶 —— 人机跟玩家面对同一个取舍。
       * 只捡前面的（油桶也随水流往下漂，往回追纯属浪费时间）。 */
      let aimY = st.flag.y;
      const lowFuel = ship.fuelMax > 0 && ship.fuel / ship.fuelMax < 0.55;
      if (lowFuel && st.drums && st.drums.length) {
        let tgt = null, bd = Infinity;
        st.drums.forEach(d => {
          if (d.x < ship.x - 40) return;
          const dd = Math.abs(d.x - ship.x) + Math.abs(d.y - ship.y) * 1.2;
          if (dd < bd) { bd = dd; tgt = d; }
        });
        if (tgt && bd < 900) aimY = tgt.y;
      }
      ctrl.mx = 1; ctrl.my = clamp((aimY - ship.y) / 220, -1, 1);
      /* 搁浅了：下船蹚水 */
      if ((ship._beachT || 0) > 0) ctrl.press.interact = true;
      return true;
    }

    /* ---- 已经在右岸：去升旗 ---- */
    if (f.x >= rx - 20) {
      const dx = st.flag.x - f.x, dy = st.flag.y - f.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 24) { const s = LD.AI.steer(f, dx / d, dy / d, null); ctrl.mx = s.x; ctrl.my = s.y; }
      else { ctrl.mx = 0; ctrl.my = 0; ctrl.press.interact = true; }
      return true;
    }

    /* ---- 水里/岸上：先找船 ---- */
    const ships = ((this.terrain && this.terrain.props) || []).filter(o => o.ship && !o.dead && !o.driver);
    let best = null, bd = Infinity;
    ships.forEach(o => {
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      /* 只考虑「朝右岸方向」的船，别为了上船往回跑 */
      const gain = o.x > f.x - 160 ? 1 : 1.9;
      const score = d * gain;
      if (score < bd) { bd = score; best = o; }
    });
    const boardR = (boardDist(f, best));
    if (best && bd < 1400) {
      const dx = best.x - f.x, dy = best.y - f.y, d = Math.hypot(dx, dy) || 1;
      const s = LD.AI.steer(f, dx / d, dy / d, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      if (d < boardR) ctrl.press.interact = true;
      return true;
    }

    /* ---- 真没船：蹚水往右走，稍微往旗子高度靠 ---- */
    const dy = st.flag.y - f.y;
    const s = LD.AI.steer(f, 1, clamp(dy / 480, -0.5, 0.5), null);
    ctrl.mx = s.x; ctrl.my = s.y;
    return true;

    function boardDist(me, o) {
      if (!o) return 58;
      return Math.max(o.w, o.h) * 0.5 + me.r + 12;
    }
  };

  /** 仇恨修正：离右岸越近的人越该被打（供 50_ai.js 索敌时调用） */
  B.riverAggro = function (foe) {
    const st = this.river;
    if (!st || !foe) return 1;
    const rx = this.riverShoreRx();
    const d = Math.max(0, rx - foe.x);
    const near = C().aggroShore || 420;
    if (d > near) return 1;
    const k = 1 - d / near;             // 0 → 1
    return 1 - k * (1 - (C().aggroMul || 0.45));
  };
})(window.LD = window.LD || {});
