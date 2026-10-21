/* ============================================================
 *  49_bumpcar.js — v4.8 碰碰车竞技
 * ============================================================
 *  圆形擂台 + 场外水池，开局每人自动坐上一辆碰碰车：
 *    - 车车对撞按「接近速度」结算伤害与击退，主动撞人的一方也吃 35%
 *    - 车耐久归零 → 报废（+2 分给撞爆的人），4 秒后重生
 *    - 人或车越过擂台边缘 → 掉进水里（+3 分给 3 秒内撞过他的人），2.4 秒后回中心重新发车
 *    - 先到 12 分获胜；时间到分数最高者获胜
 *
 *  实现要点：
 *    - 车就是地形里的 kind:"car" prop，只是打了 o.bump 标记：移动 / 撞人 /
 *      渲染全部沿用既有载具通道，本模块只加「车对车碰撞」与「出圈判定」。
 *    - 碰碰车电力视为无限：fuel / fuelMax 给 1e9，updateVehicles 里的耗油照样跑但扣不完。
 *    - 落水不调用 B.kill：本模式没有淘汰概念，B.kill 里加了 bump 分支直接返回，
 *      这里用 f.bumpOut + f.dead 自己管理「出局 → 复活」。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX, T = LD.Terrain;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* 碰碰车外观：轮转几种车身配色，方便区分谁是谁 */
  const CAR_MATS = ["car_red", "car_blue", "car_taxi", "car_mint", "car_police", "car_white"];

  /* ==========================================================
   *  擂台
   * ========================================================== */
  B.bumpArena = function () {
    const C = LD.BUMP || {};
    const w = this.world.w, top = this.world.pt || 0;
    const h = this.world.h - top;
    const r = Math.min(w, h) * (C.arenaMul || 0.34);
    /* v4.10 中心水圈：可活动范围 = 圆环（ir = 内圈半径，0 = 没有内圈的老擂台） */
    const ir = (C.innerMul || 0) > 0 ? r * C.innerMul : 0;
    return { x: w / 2, y: top + h / 2, r: r, ir: ir };
  };

  /** 环带里的一个空位（离内外边缘都留 pad、不压设施） */
  B.bumpSpot = function (pad) {
    const A = this.bumpArena();
    const pOut = pad == null ? 66 : pad;
    const pIn = A.ir > 0 ? Math.max(40, pOut) : 0;
    const dMin = A.ir + pIn, dMax = A.r - pOut;
    if (dMax <= dMin) return { x: A.x + (A.ir + A.r) / 2, y: A.y };
    for (let k = 0; k < 70; k++) {
      const a = Math.random() * TAU, d = dMin + Math.random() * (dMax - dMin);
      const x = A.x + Math.cos(a) * d, y = A.y + Math.sin(a) * d;
      if (!this.terrain || !T || !T.clearAt || T.clearAt(this.terrain, x, y, 44)) return { x: x, y: y };
    }
    const d = (dMin + dMax) / 2;
    return { x: A.x + d, y: A.y };
  };

  /** 清 / 加设施后重标占用格（地形层没有公开的 reindex，这里照抄 48_capture 的口径） */
  function reindex(map) {
    if (!map || !map.occ) return;
    const tile = map.tile || 40, top = map.top != null ? map.top : 0;
    for (let r = 0; r < map.rows; r++) { const row = map.occ[r]; if (row) for (let c = 0; c < row.length; c++) row[c] = 0; }
    (map.props || []).forEach(p => {
      if (!p.blockMove || p.dead) return;
      const c0 = Math.max(0, Math.floor((p.x - p.w / 2) / tile));
      const c1 = Math.min(map.cols - 1, Math.floor((p.x + p.w / 2 - 1) / tile));
      const r0 = Math.max(0, Math.floor((p.y - p.h / 2 - top) / tile));
      const r1 = Math.min(map.rows - 1, Math.floor((p.y + p.h / 2 - 1 - top) / tile));
      for (let r = r0; r <= r1; r++) if (map.occ[r]) for (let c = c0; c <= c1; c++) map.occ[r][c] = 1;
    });
  }
  B.bumpReindex = function () { reindex(this.terrain); };

  /** 生成一辆碰碰车（结构与 15_terrain 里的 car prop 对齐） */
  B.mkBumper = function (x, y, i) {
    const C = LD.BUMP || {};
    const def = (LD.TERRAIN && LD.TERRAIN.types && LD.TERRAIN.types.car) || {};
    const matId = CAR_MATS[i % CAR_MATS.length];
    const mat = (LD.TERRAIN && LD.TERRAIN.mats && LD.TERRAIN.mats.car || []).find(m => m.id === matId) || null;
    const hp = C.carHp || 100;
    return {
      uid: 880000 + i, kind: "car", mat: matId, shape: "car",
      cw: 2, ch: 1, w: 80, h: 40, x: x, y: y, ox: x, oy: y,
      elev: (mat && mat.elev) || 30, mass: 2.6,
      hp: 0, maxHp: 0, dead: false, flash: 0, vx: 0, vy: 0, free: false,
      boomR: 0, boomDmg: 0, variant: (i * 53) % 997, runtime: true,
      blockMove: !!def.blockMove, blockProj: !!def.blockProj,
      vtype: "bumper", fuelMax: 1e9, fuel: 1e9, speedMul: 1.95,
      ramCd: 0, hornCd: 0, cannonCd: 0, driver: null,
      /* 碰碰车专用 */
      bump: true, bumpHp: hp, bumpMax: hp, bumpRespawn: 0
    };
  };

  /** 找一辆没人开的碰碰车（离 f 最近的） */
  B.bumpFreeCar = function (f) {
    const cars = (this.terrain && this.terrain.props) || [];
    let best = null, bd = Infinity;
    for (const o of cars) {
      if (!o.bump || o.dead || o.driver) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  /* ==========================================================
   *  开局
   * ========================================================== */
  B.initBump = function () {
    const C = LD.BUMP || {};
    const A = this.bumpArena();
    const map = this.terrain;
    const heroes = this.fighters.filter(f => f.kind === "hero" && !f.bench);

    /* 1. 生成物减半（v4.10）：先随机砍一半，再清掉环带外 / 内圈里的（圆外圆内都是水） */
    if (map && map.props) {
      const keep = (C.propsKeep != null ? C.propsKeep : 1);
      map.props = map.props.filter(o => o.kind === "car" ? false : Math.random() < keep);
    }

    /* 1.5 吹风机（v4.10）：环带里均匀摆 C.blowers 台，朝向沿切线，气流能把车吹偏航 */
    const blowers = C.blowers || 0;
    for (let i = 0; i < blowers; i++) {
      const ang = (i + 0.5) / blowers * TAU + Math.random() * 0.5;
      const d = (A.ir + A.r) / 2;
      const x = A.x + Math.cos(ang) * d, y = A.y + Math.sin(ang) * d;
      if (map && T && T.clearAt && !T.clearAt(map, x, y, 40)) continue;
      /* WIND_DIR 顺序：0 右 1 下 2 左 3 上——取与半径垂直的切线方向 */
      const tang = Math.round(((ang + Math.PI / 2) / (Math.PI / 2))) % 4;
      map.props.push({
        uid: 890000 + i, kind: "blower", mat: "blower_steel", shape: "blower",
        cw: 1, ch: 1, w: 40, h: 40, x: x, y: y, ox: x, oy: y,
        elev: 44, mass: 5, hp: 110, maxHp: 110,
        dead: false, flash: 0, vx: 0, vy: 0, free: false, glow: null,
        boomR: 0, boomDmg: 0, variant: (i * 97) % 997, runtime: true,
        blockMove: true, blockProj: true, dir: tang, len: 5,
        power: (LD.BLOWER && LD.BLOWER.force) || 420, _fuelSaid: false
      });
    }

    /* 2. 清掉水域里的设施并重标占用格 */
    if (map && map.props) {
      map.props = map.props.filter(o => {
        const d = Math.hypot(o.x - A.x, o.y - A.y);
        return d <= A.r - 26 && d >= A.ir + 26;
      });
      reindex(map);
    }

    /* 3. 摆车：沿环带中部均匀分布，车头朝切线方向（比赛一开始就能跑起来） */
    const n = heroes.length + (C.extraCars || 2);
    const cars = [];
    for (let i = 0; i < n; i++) {
      const ang = i / n * TAU;
      const d = (A.ir + A.r) / 2;
      let x = A.x + Math.cos(ang) * d;
      let y = A.y + Math.sin(ang) * d;
      const o = this.mkBumper(x, y, i);
      o.facing = { x: -Math.sin(ang), y: Math.cos(ang) };   // 切线方向（逆时针）
      cars.push(o);
      if (map && map.props) map.props.push(o);
    }
    reindex(map);

    /* 3. 每人上自己的车；混战口径（team = -1，谁都能撞谁） */
    heroes.forEach((f, i) => {
      f.team = -1;
      f.bumpOut = false; f.bumpOutT = 0;
      f.lastHitBy = null; f.lastHitT = -99;
      const o = cars[i] || null;
      if (!o) return;
      const p = this.bumpSpot(60);
      f.x = p.x; f.y = p.y;
      f.noCarT = 0;                       // 开局不受「被震下车」的禁令影响
      this.enterCar(f, o);
    });

    this.bump = {
      score: this.fighters.map(() => 0),
      cd: {},            // 车对车的撞击间隔（key: uid_uid → 上次结算时间）
      done: false,
      cars: cars
    };
  };

  /* ==========================================================
   *  结算：撞爆 / 落水 / 复活
   * ========================================================== */
  B.bumpWreck = function (o, by) {
    const C = LD.BUMP || {};
    if (!o || o.dead) return;
    const drv = o.driver;
    o.bumpHp = 0;
    o.dead = true;
    o.bumpRespawn = C.carRespawn || 4;
    if (drv) this.exitCar(drv, false);
    FX.burst(o.x, o.y - 22, 30, ["#fbbf24", "#f97316", "#fff"], { speed: 380, life: 0.9 });
    FX.ring(o.x, o.y - 18, 112, "rgba(249,115,22,.9)", 6, 0.55);
    FX.shake(12);
    FX.float(o.x, o.y - 74, "碰碰车报废！", "#f97316", 18);
    this.ev.push(["h", o.x, o.y - 74, "碰碰车报废！", "#f97316"]);
    if (by && by.kind === "hero" && by !== drv && this.bump) {
      const i = this.fighters.indexOf(by);
      if (i >= 0) {
        const pts = C.scoreWreck || 2;
        this.bump.score[i] = (this.bump.score[i] || 0) + pts;
        FX.float(by.x, by.y - 94, "撞爆 +" + pts + " 分", "#fcd34d", 17);
      }
    }
    if (drv) this.bumpDunk(drv, by, true);
  };

  /** 掉进水里：wreck=true 表示是被撞爆后落的（撞爆分已经记过，不再重复加落水分） */
  B.bumpDunk = function (f, by, wreck) {
    const C = LD.BUMP || {};
    /* 注意：B.kill 的撞死分支也会走到这里，那时 f.dead 已经是 true —— 只看 bumpOut 防重入 */
    if (!f || f.bumpOut) return;
    /* 车跟着人一起沉：留在圈外会变成「复活陷阱」——复活时系统会把人塞进最近的车，
     * 结果一落地就又在圈外，无限落水。报废的车同理，统一走重生流程回到擂台内。 */
    if (f.rideCar) {
      const o = f.rideCar;
      this.exitCar(f, false);
      if (o && o.bump) { o.dead = true; o.bumpRespawn = (LD.BUMP || {}).carRespawn || 4; }
    }
    f.bumpOut = true;
    f.bumpOutT = C.respawn || 2.4;
    f.dead = true; f.hp = 0;
    f.vx = 0; f.vy = 0; f.knockLeft = 0; f.knockWall = false;
    if (f.slot) Object.keys(f.slot).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
    FX.ring(f.x, f.y - 8, 96, "rgba(56,189,248,.95)", 6, 0.5);
    FX.burst(f.x, f.y - 14, 22, ["#7dd3fc", "#fff", "#0ea5e9"], { speed: 300 });
    FX.shake(8);
    FX.float(f.x, f.y - 78, wreck ? "车报废，落水！" : "掉进水里！", "#38bdf8", 18);
    this.ev.push(["h", f.x, f.y - 78, wreck ? "车报废，落水！" : "掉进水里！", "#38bdf8"]);
    if (!wreck && by && by !== f && !by.dead && by.kind === "hero" && this.bump) {
      const i = this.fighters.indexOf(by);
      if (i >= 0) {
        const pts = C.scoreDunk || 3;
        this.bump.score[i] = (this.bump.score[i] || 0) + pts;
        FX.float(by.x, by.y - 94, "撞出擂台 +" + pts + " 分", "#fcd34d", 18);
      }
    }
    /* 最后一击的时间戳清掉，别让下一局的归属串味 */
    f.lastHitBy = null;
  };

  B.bumpRespawnHero = function (f) {
    const C = LD.BUMP || {};
    f.bumpOut = false; f.bumpOutT = 0; f.dead = false;
    f.hp = f.maxHp; f.energy = 0;
    f.stun = 0; f.root = 0; f.silenceT = 0; f.blind = 0; f.slowT = 0;
    f.knockLeft = 0; f.knockWall = false; f.hitFlash = 0;
    f.buff = { rage: 0, thousand: 0, rush: 0 };
    if (f.cd) { f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.dodge = 0; f.cd.ult = 1.5; }
    f.invuln = C.invuln || 1.2;
    f.noCarT = 0; f.noHideT = 0;
    const p = this.bumpSpot(70);
    f.x = p.x; f.y = p.y; f.vx = 0; f.vy = 0;
    FX.ring(f.x, f.y - 26, 78, "rgba(103,232,249,.95)", 5, 0.5);
    FX.burst(f.x, f.y - 26, 18, ["#7fe6f7", "#fff"], { speed: 240 });
    FX.float(f.x, f.y - 72, "回到擂台！", "#7fe6f7", 17);
    const car = this.bumpFreeCar(f);
    if (car) { f.noCarT = 0; this.enterCar(f, car); }
  };

  /* ==========================================================
   *  每帧
   * ========================================================== */
  B.updateBump = function (dt) {
    const C = LD.BUMP || {};
    const st = this.bump;
    if (!st || st.done) return;
    const A = this.bumpArena();
    const cars = ((this.terrain && this.terrain.props) || []).filter(o => o.bump && !o.dead);

    /* ---- 1. 报废车辆重生 ---- */
    let reindexed = false;
    ((this.terrain && this.terrain.props) || []).forEach(o => {
      if (!o.bump || !o.dead) return;
      o.bumpRespawn = (o.bumpRespawn || 0) - dt;
      if (o.bumpRespawn > 0) return;
      const p = this.bumpSpot(70);
      o.x = p.x; o.y = p.y; o.ox = p.x; o.oy = p.y;
      o.vx = 0; o.vy = 0; o.dead = false; o.flash = 0;
      o.bumpHp = o.bumpMax; o.driver = null;
      FX.ring(o.x, o.y - 16, 72, "rgba(125,211,252,.85)", 5, 0.45);
      FX.float(o.x, o.y - 68, "碰碰车就位", "#bae6fd", 14);
      reindexed = true;
    });
    if (reindexed) reindex(this.terrain);

    /* ---- 2. 车对车：按接近速度结算伤害 + 击退 ---- */
    const hitCd = C.hitCd || 0.35;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const hw = (a.w + b.w) / 2 + 2, hh = (a.h + b.h) / 2 + 2;
        if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) continue;
        const key = a.uid + "_" + b.uid;
        if (st.cd[key] != null && this.t - st.cd[key] < hitCd) continue;
        /* 最小穿透轴当碰撞法线（AABB MTV），分离与击退共用 */
        const ox = hw - Math.abs(dx), oy = hh - Math.abs(dy);
        let nx = 0, ny = 0, pen = 0;
        if (ox < oy) { nx = dx >= 0 ? 1 : -1; pen = ox; } else { ny = dy >= 0 ? 1 : -1; pen = oy; }
        /* 先分开，免得两辆车黏在一起反复触发 */
        if (pen > 0) {
          a.x -= nx * pen * 0.5; a.y -= ny * pen * 0.5;
          b.x += nx * pen * 0.5; b.y += ny * pen * 0.5;
        }
        const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;   // >0：a 撞向 b
        const sp = Math.abs(vrel);
        if (sp < (C.minSpd || 110)) continue;                    // 只是轻轻蹭了一下
        st.cd[key] = this.t;
        const atk = vrel > 0 ? a : b, vic = vrel > 0 ? b : a;
        const sgn = vrel > 0 ? 1 : -1;
        const dirx = nx * sgn, diry = ny * sgn;
        const dmg = clamp(sp * (C.dmgPerSpd || 0.055), C.dmgMin || 6, C.dmgMax || 30);
        vic.bumpHp -= dmg;
        atk.bumpHp -= dmg * (C.selfMul || 0.35);
        vic.flash = 0.18;
        const imp = (C.kb || 300) + sp * (C.kbPerSpd || 0.62);
        vic.vx += dirx * imp; vic.vy += diry * imp;
        atk.vx *= 0.45; atk.vy *= 0.45;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        FX.burst(mx, my - 20, 14, ["#fde68a", "#fff", "#fb923c"], { speed: 260 });
        FX.ring(mx, my - 14, 44, "rgba(253,230,138,.85)", 4, 0.35);
        FX.shake(Math.min(11, 4 + sp * 0.02));
        /* 归属：被撞的人 3 秒内掉进水里算攻击者的 */
        const vicF = vic.driver, atkF = atk.driver;
        if (vicF && atkF) { vicF.lastHitBy = atkF; vicF.lastHitT = this.t; FX.float(mx, my - 58, "撞击 -" + Math.round(dmg), "#fbbf24", 14); }
        if (vic.bumpHp <= 0) this.bumpWreck(vic, atkF);
        if (atk.bumpHp <= 0) this.bumpWreck(atk, vicF);
      }
    }

    /* ---- 3. 落水（v4.10 圆环擂台：冲出外圈 / 冲进中心水圈都算） ---- */
    const credit = C.credit || 3;
    for (const f of this.fighters) {
      if (f.kind !== "hero" || f.bench || f.dead || f.bumpOut) continue;
      const d = Math.hypot(f.x - A.x, f.y - A.y);
      if (d <= A.r && d >= A.ir) continue;
      const by = (f.lastHitBy && !f.lastHitBy.dead && this.t - (f.lastHitT == null ? -99 : f.lastHitT) <= credit)
        ? f.lastHitBy : null;
      this.bumpDunk(f, by, false);
    }

    /* ---- 4. 落水者复活 ---- */
    for (const f of this.fighters) {
      if (f.kind !== "hero" || !f.bumpOut) continue;
      f.bumpOutT -= dt;
      if (f.bumpOutT > 0) continue;
      this.bumpRespawnHero(f);
    }

    /* ---- 5. 先到 need 分 ---- */
    const need = C.need || 12;
    let best = -1, bs = -1;
    for (let i = 0; i < st.score.length; i++) {
      const f = this.fighters[i];
      if (!f || f.kind !== "hero") continue;
      const s = st.score[i] || 0;
      if (s > bs) { bs = s; best = i; }
    }
    if (best >= 0 && bs >= need) this.bumpFinish(this.fighters[best].side);
  };

  B.bumpFinish = function (side) {
    const st = this.bump;
    if (!st || st.done) return;
    st.done = true;
    const me = this.hero(this.mySide == null ? 0 : this.mySide);
    const w = this.fighters.find(f => f.side === side);
    this.matchWinner = side;
    if (w) {
      const s = st.score[this.fighters.indexOf(w)] || 0;
      LD.Cine.start(w, "胜者：" + (w.name || ("玩家" + (w.side + 1))), "", "#fcd34d", s + " 分 · 碰碰车之王");
    }
    this.finish(!!(me && w && me.side === w.side));
  };

  /** 时间到：分数最高者获胜 */
  B.bumpTimeUp = function () {
    const st = this.bump;
    if (!st || st.done) return;
    let best = -1, bs = -1;
    for (let i = 0; i < st.score.length; i++) {
      const f = this.fighters[i];
      if (!f || f.kind !== "hero") continue;
      const s = st.score[i] || 0;
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0) { this.finish(false); return; }
    FX.float(this.fighters[best].x, this.fighters[best].y - 84, "最高分获胜！", "#fcd34d", 22);
    this.bumpFinish(this.fighters[best].side);
  };

  /* ==========================================================
   *  渲染（世界坐标，ctx 已随摄像机平移）
   * ========================================================== */
  B.drawBump = function (ctx) {
    const C = LD.BUMP || {};
    const st = this.bump;
    if (!st) return;
    const A = this.bumpArena();
    const t = this.t || 0;
    const top = this.world.pt || 0;

    /* 1. 水池（v4.10 圆环）：外圈之外 + 中心水圈，整块挖掉 + 同心波纹 */
    ctx.save();
    ctx.beginPath();
    ctx.rect(-240, top - 240, this.world.w + 480, this.world.h - top + 480);
    ctx.arc(A.x, A.y, A.r, 0, TAU, true);
    ctx.fillStyle = "rgba(9,32,54,.80)";
    ctx.fill("evenodd");
    if (A.ir > 0) {
      ctx.beginPath(); ctx.arc(A.x, A.y, A.ir, 0, TAU);
      ctx.fillStyle = "rgba(9,32,54,.80)";
      ctx.fill();
    }
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = "#7dd3fc"; ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const rr = A.r + 26 + ((t * 26 + k * 44) % 176);
      ctx.globalAlpha = 0.20 * (1 - k * 0.22);
      ctx.beginPath(); ctx.arc(A.x, A.y, rr, 0, TAU); ctx.stroke();
      if (A.ir > 0) {
        /* 内圈波纹往里收 */
        const ri = A.ir - 26 - ((t * 26 + k * 44) % 110);
        if (ri > 8) {
          ctx.globalAlpha = 0.18 * (1 - k * 0.22);
          ctx.beginPath(); ctx.arc(A.x, A.y, ri, 0, TAU); ctx.stroke();
        }
      }
    }
    ctx.restore();

    /* 2. 擂台边缘（外圈 + 内圈）：黄黑警示带 + 内侧柔光 */
    ctx.save();
    const rim = C.rimW || 16;
    const rimRing = (rr) => {
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([26, 18]); ctx.lineDashOffset = -t * 26;
      ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = rim;
      ctx.beginPath(); ctx.arc(A.x, A.y, rr - rim / 2, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.25 + Math.sin(t * 2) * 0.06;
      ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(A.x, A.y, rr - rim - 3, 0, TAU); ctx.stroke();
    };
    rimRing(A.r);
    if (A.ir > 0) rimRing(A.ir);
    ctx.restore();

    /* 3. 车辆耐久条（画在车顶上方） */
    const cars = ((this.terrain && this.terrain.props) || []).filter(o => o.bump && !o.dead && o.driver);
    cars.forEach(o => {
      const bw = 58, bh = 7;
      const x = o.x - bw / 2, y = o.y - o.h / 2 - 44;
      const k = clamp((o.bumpHp || 0) / (o.bumpMax || 1), 0, 1);
      ctx.save();
      ctx.fillStyle = "rgba(6,10,22,.72)";
      ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
      ctx.fillStyle = k > 0.5 ? "#4ade80" : k > 0.25 ? "#fbbf24" : "#f87171";
      ctx.fillRect(x, y, bw * k, bh);
      ctx.strokeStyle = "rgba(226,232,240,.55)"; ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, bw + 1, bh + 1);
      ctx.restore();
    });
  };
})(window.LD = window.LD || {});
