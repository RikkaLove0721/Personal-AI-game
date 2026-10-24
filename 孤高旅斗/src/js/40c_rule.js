/* ============================================================
 *  40c_rule.js - 玩法规则子模块：缩圈 / 追猎 / 丧尸危机 / 世界末日 / 车轮战 / 接力 / BOSS 阶段
 *  自 40_battle.js 拆分（v4.12 工程债）。只搬代码，判定逻辑一行未改。
 *  调度入口仍在 40_battle.js 的 B.update 里按 this.rule 分发，运行期查找，顺序无影响。
 * ============================================================ */
(function (LD) {
  "use strict";
  const C = LD.CONF, TAU = Math.PI * 2;
  const FX = LD.FX, V = LD.View;
  const clamp = V.clamp;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const B = LD.Battle;

  /* ---- 杂兵（蜂后的机械蜂等）：挂在 fighters 里复用索敌 / 弹道命中 / 阵营判断 ---- */
  B.spawnMinion = function (kind, x, y, owner, opt) {
    opt = opt || {};
    const M = (LD.MINIONS && LD.MINIONS[kind]) || { hp: 14, speed: 175, dmg: 9, boomR: 46, r: 10, life: 12 };
    const m = {
      kind: "minion", mKind: kind, side: owner ? owner.side : 1, id: -1,
      team: owner ? owner.team : 1, owner: owner || null,
      x, y, r: M.r || 10, facing: { x: 1, y: 0 },
      hp: M.hp, maxHp: M.hp, speed: M.speed || 175,
      dmg: M.dmg, boomR: M.boomR || 46, lifeT: M.life || 12,
      dead: false, hitFlash: 0, walkPhase: rand(0, 6), moving: false,
      atkAnim: 0, atkDur: 0.2, isMinion: true
    };
    this.fighters.push(m);
    FX.burst(x, y - 10, 10, ["#a3e635", "#fff"], { speed: 150 });
    return m;
  };
  B.updateMinions = function (dt) {
    for (let i = this.fighters.length - 1; i >= 0; i--) {
      const m = this.fighters[i];
      if (m.kind !== "minion") continue;
      if (m.dead) { this.fighters.splice(i, 1); continue; }
      m.lifeT -= dt;
      m.hitFlash = Math.max(0, m.hitFlash - dt);
      if (m.lifeT <= 0) { FX.burst(m.x, m.y - 10, 12, ["#94a3b8", "#fff"], { speed: 160 }); this.fighters.splice(i, 1); continue; }
      const foe = this.foeOf(m);
      m.moving = false;
      if (foe) {
        const dx = foe.x - m.x, dy = foe.y - m.y, d = Math.hypot(dx, dy) || 1;
        m.facing = { x: dx / d, y: dy / d };
        if (d > m.r + foe.r + 2) {
          m.x += dx / d * m.speed * dt; m.y += dy / d * m.speed * dt;
          m.walkPhase += dt * 16; m.moving = true;
        } else {
          /* 自爆：接触即引爆，对范围内敌人结算 */
          this.minionBoom(m);
          this.fighters.splice(i, 1);
          continue;
        }
      }
      m.x = clamp(m.x, 30, B.world.w - 30);
      m.y = clamp(m.y, B.world.pt, B.world.h - 36);
      if (m.lifeT % 0.12 < dt) FX.trail(m.x + rand(-6, 6), m.y - 12 + rand(-4, 4), "#a3e635", 3, 0.3);
    }
  };
  B.minionBoom = function (m) {
    FX.ring(m.x, m.y - 12, m.boomR, "rgba(163,230,53,.95)", 6, 0.4);
    FX.burst(m.x, m.y - 12, 22, ["#a3e635", "#fff", "#fbbf24"], { speed: 300 });
    FX.shake(8);
    for (const f of this.fighters) {
      if (f.dead || f.kind === "minion" || this.sameTeam(m, f)) continue;
      if (Math.hypot(f.x - m.x, (f.y - 20) - m.y) <= m.boomR + f.r)
        this.damage(m.owner || m, f, m.dmg, { type: "skill", kb: 180, from: m });
    }
  };

  /* ---- 缩圈乱斗（v2.7 重做）
   * 地图上撒若干个「安全圈」，圈外全是毒；安全圈会一个个消失、并持续收缩，
   * 最终只剩一个小圈，把所有人逼到一起。 */
  B.initRing = function () {
    const R = LD.RING || {};
    const w = this.world;
    const n = R.n || 4, r0 = R.r0 || 330, gap = R.gap || 1.15;
    const list = [];
    for (let i = 0; i < n; i++) {
      let bx = w.w / 2, by = (w.pt + w.h) / 2;
      for (let k = 0; k < 240; k++) {
        const tx = rand(r0 * 0.62, w.w - r0 * 0.62);
        const ty = rand(w.pt + r0 * 0.62, w.h - r0 * 0.62);
        if (list.every(c => Math.hypot(c.x - tx, c.y - ty) > r0 * gap)) { bx = tx; by = ty; break; }
      }
      list.push({ x: bx, y: by, r: r0, r0: r0, dead: false });
    }
    this.rings = list;
    this.ringT = 0;
    this.ringKillN = 0;
    this.ringTick = 0;
    this.rings.forEach(c => {
      FX.ring(c.x, c.y, c.r, "rgba(52,211,153,.55)", 5, 0.9);
    });
    /* 所有人就近落在安全圈里，开局不至于站在毒里 */
    this.placeInsideSafe();
  };
  /** 把一个坐标挪进最近的安全圈内部；没有安全圈时原样返回 */
  B.safeSpot = function (x, y, pad) {
    const list = (this.rings || []).filter(c => !c.dead);
    if (!list.length) return { x, y };
    let best = list[0], bd = Infinity;
    list.forEach(c => {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) { bd = d; best = c; }
    });
    const lim = Math.max(40, best.r - (pad || 70));
    if (bd <= lim) return { x, y };                  // 已经在圈内
    const a = Math.atan2(y - best.y, x - best.x);
    return { x: best.x + Math.cos(a) * lim * rand(0.2, 0.9), y: best.y + Math.sin(a) * lim * rand(0.2, 0.9) };
  };
  B.placeInsideSafe = function () {
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.isZombie || f.bench) return;
      const p = this.safeSpot(f.x, f.y, 80);
      f.x = clamp(p.x, 34, this.world.w - 34);
      f.y = clamp(p.y, this.world.pt, this.world.h - 40);
    });
  };
  /** 缩圈模式的掉落点：一半概率落在圈外（需要冒险去捡） */
  B.ringDropSpot = function (riskP) {
    const w = this.world;
    for (let k = 0; k < 60; k++) {
      const x = rand(80, w.w - 80), y = rand(w.pt + 60, w.h - 90);
      const inSafe = (this.rings || []).some(c => !c.dead && Math.hypot(c.x - x, c.y - y) <= c.r * 0.92);
      if (Math.random() < (riskP == null ? 0.55 : riskP)) { if (!inSafe) return { x, y }; }
      else if (inSafe) return { x, y };
    }
    return { x: rand(80, w.w - 80), y: rand(w.pt + 60, w.h - 90) };
  };
  /** 坐标是否处于毒圈里（不在任何存活的安全圈内） */
  B.inPoison = function (x, y) {
    const list = (this.rings || []).filter(c => !c.dead);
    if (!list.length) return false;
    return !list.some(c => Math.hypot(c.x - x, c.y - y) <= c.r);
  };
  B.updateRing = function (dt) {
    const R = LD.RING || {};
    if (!this.rings) return;
    this.ringT += dt;
    const killAt = R.killAt || [];
    while (this.ringKillN < killAt.length && this.ringT >= killAt[this.ringKillN]) {
      this.ringKillN++;
      const alive = this.rings.filter(c => !c.dead);
      if (alive.length > 1) this.ringCollapse(alive[(Math.random() * alive.length) | 0]);
    }
    /* 持续收缩：开场 14 秒是完整的大圈，之后线性缩到初始半径的 48% */
    const t0 = R.shrinkStart != null ? R.shrinkStart : 14;
    const rate = R.shrinkRate != null ? R.shrinkRate : 0.0078;
    const minMul = R.minMul != null ? R.minMul : 0.48;
    const p = this.ringT <= t0 ? 1 : Math.max(minMul, 1 - (this.ringT - t0) * rate);
    this.rings.forEach(c => { if (!c.dead) c.r = c.r0 * p; });
    /* 圈外持续掉血 */
    this.ringTick -= dt;
    if (this.ringTick <= 0) {
      this.ringTick = R.tick || 0.5;
      const dmg = R.dmg != null ? R.dmg : 5;
      for (const f of this.fighters) {
        if (f.dead || f.kind !== "hero" || f.bench) continue;
        if (this.inPoison(f.x, f.y)) {
          this.damage(null, f, dmg, { type: "dot", kb: 0, noSrc: true });
          if (f.hp > 0) FX.float(f.x, f.y - 60, "毒圈！", "#f87171", 13);
        }
      }
    }
    /* 兜底：最后一个小圈已经缩到最小、还拖太久的话按血量判胜，避免无限对局 */
    const lim = R.limit != null ? R.limit : 165;
    if (this.ringT > lim && this.state === "fight") {
      const alive = this.humans(true);
      let win = alive[0];
      alive.forEach(x => { if (x.hp > (win ? win.hp : 0)) win = x; });
      this.endRound(win ? win.side : 0);
    }
  };
  /** 某个安全圈塌陷消失（画一圈收缩动画 + 文字提示） */
  B.ringCollapse = function (c) {
    c.dead = true;
    FX.ring(c.x, c.y, c.r, "rgba(248,113,113,.9)", 7, 0.8);
    FX.float(c.x, c.y - 40, "安全圈消失！", "#f87171", 20);
    this.ev.push(["h", c.x, c.y - 40, "安全圈消失！", "#f87171"]);
    const left = this.rings.filter(x => !x.dead).length;
    FX.float(c.x, c.y + 40, "剩余安全圈 " + left, "#fcd34d", 15);
  };

  /* ---- 追猎时刻（v2.7 重做）：随机一名猎人 + 缓慢收缩的大毒圈 ---- */
  B.initHunt = function () {
    const H = LD.HUNT || {};
    const cdMul = H.cdMul != null ? H.cdMul : 0.5;
    const hs = this.fighters.filter(f => f.kind === "hero" && !f.isZombie && !f.bench);
    if (!hs.length) return;
    const hi = (Math.random() * hs.length) | 0;
    hs.forEach((f, i) => {
      /* 幂等：setup 与 resetRound 都会抽签，必须先在「基础 CD / 基础血量」上还原，
       * 否则 CD 会一次次乘 0.5 越叠越低，当过猎人的玩家血量会永远留在 800。 */
      if (f._huntBase == null) f._huntBase = f.rateM == null ? 1 : f.rateM;
      if (f._huntBaseHp == null) f._huntBaseHp = f.maxHp;
      if (i === hi) {
        f.huntRole = "hunter"; f.team = 9; f.huntCrown = true;
        f.maxHp = H.hp || 800; f.hp = f.maxHp;
        f.rateM = f._huntBase * cdMul;                                  // 猎人全部 CD 减半
        f.huntDmgM = 1;                                                 // v2.7：随存活人数动态提升，见 updateHunt
      } else {
        f.huntRole = "runner"; f.team = 0;                              // 生存者互相同队，保留自己选的技能
        f.huntCrown = false;
        f.rateM = f._huntBase;                                          // 上一轮当过猎人的，加成也要撤掉
        f.maxHp = f._huntBaseHp; f.hp = Math.min(f.hp, f.maxHp);        // 血量同样还原
      }
    });
    this.hunterSide = hs[hi].side;
    this.roundT = H.roundT || 90;
    const w = this.world;
    this.huntRing = { x: w.w / 2, y: (w.pt + w.h) / 2, r: H.r0 || 740, tick: 0, minR: H.minR || 315 };
    /* 猎人特写：与大招演出同款的镜头，让全场都看清谁是猎人 */
    const hf = hs[hi];
    LD.Cine.start(hf, "追猎时刻", "", "#fb7185", "本局猎人：" + (hf.name || ("玩家" + (hf.side + 1))));
  };
  B.updateHunt = function (dt) {
    const H = LD.HUNT || {};
    const R = this.huntRing;
    if (!R) return;
    /* v2.7 追猎时刻：猎人伤害随「存活幸存者数」提升，每多一人 +20%（3 人 = +60%）。
     * 人数越少猎人越弱，给幸存者翻盘留出空间。 */
    const aliveRunners = this.fighters.filter(f => f.kind === "hero" && f.huntRole === "runner" && !f.dead && !f.bench).length;
    const hunter = this.fighters.find(f => f.kind === "hero" && f.huntRole === "hunter");
    if (hunter && !hunter.dead) hunter.huntDmgM = 1 + aliveRunners * (H.dmgPerRunner != null ? H.dmgPerRunner : 0.20);
    if (R.r > R.minR) R.r = Math.max(R.minR, R.r - (H.shrink || 6.2) * dt);
    R.tick -= dt;
    if (R.tick <= 0) {
      R.tick = H.tick || 0.5;
      const dmg = H.dmg != null ? H.dmg : 6;
      for (const f of this.fighters) {
        if (f.dead || f.kind !== "hero" || f.bench) continue;
        if (Math.hypot(f.x - R.x, f.y - R.y) > R.r) {
          this.damage(null, f, dmg, { type: "dot", kb: 0, noSrc: true });
          if (f.hp > 0) FX.float(f.x, f.y - 60, "毒圈！", "#f87171", 13);
        }
      }
    }
  };

  /* ---- 军备竞赛（v2.7）/ 世界末日（v3.2）：刷僵尸 ---- */
  B.updateZombies = function (dt) {
    if (!this.zombieOn()) return;
    const Z = LD.ZOMBIE || {};
    const D = LD.DOOMSDAY || {};
    const alive = this.fighters.filter(f => f.isZombie && !f.dead).length;
    const doom = this.rule === "doomsday";
    const players = Math.max(1, this.humans(true).length);
    this.zombieT -= dt;
    if (this.zombieT > 0) return;
    /* 世界末日：存活玩家越多刷得越快（间隔 = 基础 / 人数），同时放宽在场上限 */
    this.zombieT = doom ? Math.max(D.sprayMin || 0.55, (D.sprayBase || 2.6) / players)
      : (Z.every || 11);
    const cap = doom ? (D.maxBase || 5) + players * (D.maxPer || 2) : (Z.max || 6);
    if (alive >= cap) return;
    let bx, by;
    /* v4.0：僵尸只从右大陆冒出来，绝不刷在庇护所里，也不刷在悬崖上 */
    const dm = doom ? ((LD.Terrain && LD.Terrain.doomLand) ? LD.Terrain.doomLand.main : null) : null;
    if (doom && dm) {
      bx = null;
      for (let k = 0; k < 40; k++) {
        const x = rand(dm.x0 + 80, dm.x1 - 80), y = rand(dm.y0 + 70, dm.y1 - 70);
        if (this.humans(true).some(f => Math.hypot(f.x - x, f.y - y) < 380)) continue;   // 别贴脸刷
        if (!this.terrain || LD.Terrain.clearAt(this.terrain, x, y, 26)) { bx = x; by = y; break; }
      }
      if (bx == null) { bx = rand(dm.x0 + 120, dm.x1 - 120); by = rand(dm.y0 + 90, dm.y1 - 90); }
    } else if (doom && this.shelter) {
      const sh = this.shelter;
      bx = null;
      for (let k = 0; k < 40; k++) {
        const a2 = Math.random() * TAU;
        const dd = sh.r + rand(110, 360);
        const x = clamp(sh.x + Math.cos(a2) * dd, 60, this.world.w - 60);
        const y = clamp(sh.y + Math.sin(a2) * dd, this.world.pt + 40, this.world.h - 60);
        if (Math.hypot(x - sh.x, y - sh.y) <= sh.r + 80) continue;      // 绝不刷在庇护所里
        if (!this.terrain || LD.Terrain.clearAt(this.terrain, x, y, 26)) { bx = x; by = y; break; }
      }
      if (bx == null) {
        const a2 = Math.random() * TAU;
        bx = clamp(sh.x + Math.cos(a2) * (sh.r + 170), 60, this.world.w - 60);
        by = clamp(sh.y + Math.sin(a2) * (sh.r + 170), this.world.pt + 40, this.world.h - 60);
      }
    } else {
      const w = this.world;
      bx = rand(80, w.w - 80); by = rand(w.pt + 60, w.h - 90);
      for (let k = 0; k < 30; k++) {
        const x = rand(80, w.w - 80), y = rand(w.pt + 60, w.h - 90);
        const near = this.humans(true).some(f => Math.hypot(f.x - x, f.y - y) < 260);
        if (!near) { bx = x; by = y; break; }
      }
    }
    const z = this.mkZombie(bx, by);
    this.fighters.push(z);          // 必须入列：否则僵尸只是被创建出来、永远不进战斗
    FX.ring(bx, by - 26, 60, "rgba(163,230,53,.9)", 5, 0.5);
    FX.float(bx, by - 70, "僵尸出现！", "#a3e635", 17);
    this.ev.push(["h", bx, by - 70, "僵尸出现！", "#a3e635"]);
    return z;
  };
  B.zombieOn = function () { return this.rule === "auction" || this.rule === "doomsday" || this.mod("zombie"); };

  /* ---- v4.0 世界末日：庇护所内缓慢回血；v4.2 右大陆整块变成危险区 ---- */
  /** 坐标是否踩在危险区（右边那块矩形大陆）里 —— 判定口径与缩圈毒圈一致 */
  B.inDoomDanger = function (x, y) {
    const L = LD.Terrain && LD.Terrain.doomLand;
    if (!L) return false;
    const m = L.main;
    return x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1;
  };
  B.updateDoomsday = function (dt) {
    if (!this.shelter) return;
    const D = LD.DOOMSDAY || {};
    const heal = D.shelterHeal || 0;
    const dg = D.danger || {};
    const tick = dg.tick || 0.5;
    this.doomTick = (this.doomTick == null ? tick : this.doomTick) - dt;
    if (this.doomTick > 0) return;
    this.doomTick = tick;
    for (const f of this.fighters) {
      if (f.dead || f.kind !== "hero" || f.isZombie || f.bench) continue;
      /* 危险区：整块右大陆等同圈外，站上去每 tick 掉一次血（僵尸是原住民，不受影响） */
      if (this.inDoomDanger(f.x, f.y)) {
        this.damage(null, f, dg.dmg || 5, { type: "dot", kb: 0, noSrc: true });
        if (f.hp > 0) FX.float(f.x, f.y - 60, "危险区！", "#f87171", 13);
        continue;
      }
      if (heal <= 0) continue;
      if (Math.hypot(f.x - this.shelter.x, f.y - this.shelter.y) > this.shelter.r) continue;
      if (f.hp >= f.maxHp) continue;
      const before = f.hp;
      f.hp = Math.min(f.maxHp, f.hp + heal * tick);
      if (Math.floor(f.hp) > Math.floor(before)) FX.float(f.x, f.y - 60, "庇护所回血", "#4ade80", 12);
    }
  };
  /** v4.0 已无门洞，保留空实现以免旧调用报错 */
  B.doomGap = function () { return null; };
  /**
   * v4.0 独木桥寻路目标点。
   * 桥只有两格宽，直奔岛上会把僵尸们挤在崖边打转，所以拆成两段：
   * 在大陆 → 先走到桥的东头；上了桥 → 一路往西穿过桥面；到了岛上就交回正常战斗移动。
   */
  B.doomAim = function (f) {
    const L = LD.Terrain && LD.Terrain.doomLand;
    if (!L) return null;
    const isl = L.island, b = L.bridge, m = L.main;
    if (Math.hypot(f.x - isl.x, f.y - isl.y) <= isl.r - 20) return null;      // 已经上岛
    const cy = (b.y0 + b.y1) / 2;
    if (f.x >= m.x0) return { x: b.x1 - 46, y: cy };                          // 大陆 → 桥东头
    if (f.x > b.x0 + 60) return { x: b.x0 + 46, y: cy };                      // 桥上 → 继续往西
    return { x: isl.x, y: isl.y };
  };
  /** v4.0 独木桥减速：僵尸踩上桥面就明显变慢，给守桥的人留输出窗口 */
  B.updateGateSlow = function (dt) {
    const L = LD.Terrain && LD.Terrain.doomLand;
    if (!L) return;
    const b = L.bridge;
    for (const f of this.fighters) {
      if (f.dead || !f.isZombie) continue;
      if (f.x >= b.x0 && f.x <= b.x1 && f.y >= b.y0 && f.y <= b.y1) {
        f.gateSlowT = 0.16;      // 每帧续期，离开桥面后很快恢复
        if (Math.random() < dt * 3) FX.trail(f.x + rand(-8, 8), f.y - rand(4, 26), "#67e8f9", 4, 0.3);
      }
    }
  };
  /**
   * v4.0 悬崖边界：所有人（含位移 / 击退 / 载具）一律夹回陆地。
   * 放在角色循环之后统一处理，这样任何一种改坐标的通道都逃不掉。
   */
  B.clampDoomLand = function () {
    const T = LD.Terrain;
    if (!T || !T.doomLand || !T.landFit) return;
    for (const f of this.fighters) {
      if (f.dead || f.bench || f.hideProp) continue;
      const p = T.landFit(f.x, f.y);
      if (!p) continue;
      f.x = p.x; f.y = p.y;
      if (f.vx != null) { f.vx *= 0.15; f.vy *= 0.15; }      // 撞崖即停，别贴着崖边弹跳
    }
  };
  /** 人机逛商店：残血先买血包，否则轮流买加成，钱不够或都买不了就收手 */
  B.botSpin = function (f) {
    if (!f.isBot) return;
    const S = LD.ASHOP || {};
    let guard = 0;
    while (guard++ < 4) {
      const low = f.hp < f.maxHp * 0.55;
      const order = low ? ["heal", "hp", "spd"] : ["hp", "spd", "heal"];
      /* v3.2：有大招且能量不满时优先买能量球 */
      if (f.loadout && f.loadout.ult && f.energy < f.maxEnergy * 0.6) order.unshift("energy");
      let bought = false;
      for (const id of order) {
        const item = this.armyShop().find(i => i.id === id);
        if (!item || (f.bcoins || 0) < item.price) continue;
        if (id === "spd" && (f.spdBuys || 0) >= (S.spdMax != null ? S.spdMax : 3)) continue;
        if (id === "heal" && f.hp >= f.maxHp) continue;
        if (this.armyBuy(f, id)) { bought = true; break; }
      }
      if (!bought) break;
    }
  };
  /** 摇一次技能轮盘：返回 3 个候选（小概率出大招） */
  B.rollWheel = function (n) {
    const skills = LD.skillsBy("skill").filter(s => !s.noAI);
    const ults = LD.skillsBy("ult").filter(s => !s.noAI);
    const out = [];
    for (let i = 0; i < (n || 3); i++) {
      const ult = ults.length && Math.random() < 0.18;      // 小概率刷出大招
      const pool = ult ? ults : (skills.length ? skills : ults);
      const sk = pool[(Math.random() * pool.length) | 0];
      if (sk && out.indexOf(sk.id) < 0) out.push(sk.id);
    }
    return out;
  };
  /** 把某个技能装进配装（优先空槽，其次随机置换） */
  B.equipIntoLoadout = function (f, id) {
    const sk = LD.skill(id);
    if (!sk || !f.loadout) return null;
    let slot;
    if (sk.kind === "ult") slot = "ult";
    else if (!f.loadout.skill1) slot = "skill1";
    else if (!f.loadout.skill2) slot = "skill2";
    else if (f.loadout.skill1 === id) slot = "skill1";
    else if (f.loadout.skill2 === id) slot = "skill2";
    else slot = Math.random() < 0.5 ? "skill1" : "skill2";
    f.loadout[slot] = id;
    f.cd[slot] = 0.6;
    if (f.slot) f.slot[slot] = { on: false, phase: "", t: 0, d: {} };
    FX.ring(f.x, f.y - 26, 54, "#c4b5fd", 4, 0.4);
    FX.float(f.x, f.y - 64, "轮盘：" + sk.name + " → " + ({ basic: "J", skill1: "K", skill2: "L", ult: "O" }[slot]), "#c4b5fd", 15);
    return slot;
  };

  /* ---- 车轮战：败者下台，胜者回血 30% 并迎接下一位（本地面板轮换，不上联机） ---- */
  B.initRelay = function () {
    const heroes = this.fighters.filter(f => f.kind === "hero");
    this.relay = { order: heroes.map(f => f.side), alive: heroes.map(f => f.side) };
    heroes.forEach((f, i) => { if (i >= 2) { f.bench = true; f.x = -200; f.y = -200; } });
  };
  B.relayOnKill = function (f, by) {
    /* f 刚被击杀。胜者 = by（若同归则取另一位在台者） */
    const alive = this.fighters.filter(x => x.kind === "hero" && !x.dead && !x.bench);
    const winner = by && by.kind === "hero" && !by.dead ? by : alive[0];
    if (winner) {
      winner.hp = Math.min(winner.maxHp, Math.round(winner.hp + winner.maxHp * 0.3));
      FX.float(winner.x, winner.y - 80, "胜者回血 30%", "#7ff0c4", 15);
    }
    const nextSide = (this.relay.alive || []).find(s => {
      const ff = this.fighters.find(o => o.side === s);
      return ff && !ff.dead && ff !== f && ff !== winner;   // 挑战者通常在板凳上（bench），不排除
    });
    if (nextSide == null) {
      /* 台上只剩胜者 → 整场结束 */
      if (winner) this.finish(winner.side === this.mySide);
      return;
    }
    this.relayNext = 1.6;               // 1.6 秒后下一位上场
    this.relayIn = nextSide;
    FX.float(B.world.w / 2, B.world.pt + 60, "下一位挑战者登场！", "#fcd34d", 20);
  };
  B.relayTick = function (dt) {
    if (!this.relayNext) return;
    this.relayNext -= dt;
    if (this.relayNext > 0) return;
    this.relayNext = 0;
    const f = this.fighters.find(o => o.side === this.relayIn);
    if (!f) return;
    f.bench = false; f.dead = false;
    f.hp = f.maxHp; f.stun = 0; f.invuln = 1;
    f.x = B.world.w * rand(0.25, 0.75);
    f.y = B.world.h * rand(0.4, 0.7);
    f.energy = 0;
    Object.keys(f.slot || {}).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
    if (f.cd) { f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.dodge = 0; f.cd.ult = 1.5; }
    FX.ring(f.x, f.y - 26, 90, "rgba(252,211,77,.95)", 6, 0.5);
    this.state = "fight";
  };

  /* ---- 技能轮盘修饰符：每 12 秒全场勇者随机换一套技能 ---- */
  B.updateWheel = function (dt) {
    if (!this.mod("wheel")) return;
    this.wheelT = (this.wheelT || 0) + dt;
    if (this.wheelT < 12) return;
    this.wheelT = 0;
    const skills = LD.skillsBy("skill").filter(s => !s.noAI);
    const ults = LD.skillsBy("ult").filter(s => !s.noAI);
    const pick = arr => arr[(Math.random() * arr.length) | 0];
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.dead || f.bench) return;
      if (f.isZombie) return;                 // v3.1：僵尸只有固定的突刺 / 撕咬，不参与技能轮盘
      f.loadout.skill1 = pick(skills).id;
      let s2 = pick(skills).id, guard = 0;
      while (s2 === f.loadout.skill1 && guard++ < 10) s2 = pick(skills).id;
      f.loadout.skill2 = s2;
      f.loadout.ult = pick(ults).id;
      ["skill1", "skill2", "ult"].forEach(k => { if (f.slot) f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
      if (f.cd) f.cd.ult = 3;
      FX.float(f.x, f.y - 78, "轮盘换技能！", "#c4b5fd", 15);
    });
    FX.flash(0.18, "196,181,253");
  };

  /* ---- BOSS 二阶段：血量过半触发狂暴（巨龙有自己的 rageStage，不走这里） ---- */
  B.updateBossPhase = function (dt) {
    this.fighters.forEach(f => {
      if (!f.isBoss || f.dead || f.phase2) return;
      const cfg = LD.BOSS && LD.BOSS[f.bossKind];
      const p2 = cfg && cfg.phase2;
      if (!p2) return;
      if (f.hp <= f.maxHp * (p2.hpPct != null ? p2.hpPct : 0.5)) {
        f.phase2 = true;
        f.rateM = (f.rateM || 1) * (p2.rateMul || 1.3);
        f.dmgM = (f.dmgM || 1) * (p2.dmgMul || 1.15);
        FX.flash(0.3, "251,113,133"); FX.shake(14);
        FX.ring(f.x, f.y - 26, 130, "rgba(251,113,133,.95)", 7, 0.6);
        FX.float(f.x, f.y - 90, "狂暴！", "#fb7185", 24);
        this.ev.push(["h", f.x, f.y - 90, "狂暴！", "#fb7185"]);
      }
    });
  };
})(window.LD = window.LD || {});
