/* ============================================================
 *  42_tower.js — v3.8 塔防对战（3v3 单线推塔）
 * ============================================================
 *  载入顺序在 40_battle.js 之后，所以这里可以直接给 LD.Battle 挂方法，
 *  并包装 damage / kill 做金币、经验、助攻与复活结算。
 *
 *  结构：
 *    initTower        开局：分队、等级、金币、团队强化
 *    updateTower      每帧：兵线、建筑开火、炸弹、基地回血、复活
 *    spawnTowerWave   兵线刷新（6 只机器人）
 *    updateLaneMinions 小兵 AI：先打周围敌人，其次推塔，否则沿兵线前进
 *    towerShop / towerBuy / useTowerActive  局内装备
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle;
  if (!B) return;
  const CFG = () => (LD.TOWER || {});
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ----------------------------------------------------------
   *  开局
   * ---------------------------------------------------------- */
  B.initTower = function () {
    const C = CFG();
    this.tScore = [0, 0];
    this.towerT = 0;                        // 不限时：打到水晶破
    this.towerResult = "";
    this.waveT = (C.wave && C.wave.first) || 10;
    this.waveN = 0;
    this.towerKills = [0, 0];               // 每队已拆掉的敌塔数 → 强化自家小兵
    this.towerDone = false;
    this.graves = [];
    this.bombs = [];
    this.minionBuff = [{ hp: 0, atk: 0 }, { hp: 0, atk: 0 }];
    const heroes = this.fighters.filter(f => f.kind === "hero" && !f.bench);
    const mid = Math.ceil(heroes.length / 2);
    heroes.forEach(f => {
      /* 房间选过红/蓝就沿用；没选过按座位前后各一半 */
      if (f.team !== 0 && f.team !== 1) f.team = (f.side < mid) ? 0 : 1;
      f.level = 1; f.xp = 0;
      f.bcoins = C.startGold || 200;
      f.dmgBonus = 0; f.dr = 0; f.lifesteal = 0; f.cdM = 1;
      f.energyMul = 1; f.dodgeChance = 0; f.projDR = 0;
      f.lastHurtAt = -99; f.requiemT = 0; f.requiemCd = 0; f.ccImmune = false; f.reflectT = 0;
      f.items = {}; f.activeItem = null; f.activeCd = 0;
      f.speedBuffT = 0; f.speedBuff = 1;
      f.towerKills = 0; f.towerDeaths = 0;
      f.deaths = 0;
      f._assist = {};
      f.aimProp = null;
      f.energy = 0;
    });
  };

  /** 基地坐标（也是复活点） */
  B.towerBase = function (side) {
    const C = CFG();
    const y = (C.laneY || 380) - 50;
    return { x: side === 0 ? 96 : this.world.w - 96, y };
  };

  B.placeTowerHeroes = function () {
    const cnt = { 0: 0, 1: 0 };
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.bench) return;
      const side = f.team === 1 ? 1 : 0;
      const b = this.towerBase(side);
      const k = cnt[side]++;
      const dir = side === 0 ? 1 : -1;
      f.x = b.x + dir * (26 + k * 26);
      f.y = b.y + (k - 1) * 26;
      f.facing = { x: dir, y: 0 };
    });
  };

  B.crystalGuarded = function (o) {
    if (!o || o.kind !== "crystal" || !this.terrain) return false;
    return this.terrain.props.some(p => !p.dead && p.kind === "tower" && p.side === o.side);
  };

  /** 最近的敌方建筑：优先防御塔，其次水晶 */
  B.enemyStructure = function (side, x, y, maxD) {
    if (!this.terrain) return null;
    let tower = null, td = Infinity, cry = null, cd = Infinity;
    for (const o of this.terrain.props) {
      if (o.dead || o.side === side) continue;
      if (o.kind !== "tower" && o.kind !== "crystal") continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d > (maxD || Infinity)) continue;
      if (o.kind === "tower") { if (d < td) { td = d; tower = o; } }
      else if (d < cd) { cd = d; cry = o; }
    }
    return tower || cry;
  };

  /** 攻击瞄准兜底：身边没有敌人时，把最近的敌方建筑当成目标 */
  B.aimStructFor = function (f) {
    if (this.rule !== "tower" || !this.terrain) return null;
    if (f.aimProp && !f.aimProp.dead) return f.aimProp;
    const foe = this.foeOf(f);
    if (foe && !foe.dead && dist(f, foe) < 300) return null;
    return this.enemyStructure(f.team === 1 ? 1 : 0, f.x, f.y, 520);
  };

  /* ----------------------------------------------------------
   *  经济 / 经验 / 团队强化
   * ---------------------------------------------------------- */
  B.towerGold = function (f, n, why) {
    if (!f || f.dead || f.kind !== "hero" || !(n > 0)) return;
    f.bcoins = (f.bcoins || 0) + n;
    LD.FX.float(f.x, f.y - 68, "+" + n + (why ? " " + why : " 金"), "#fcd34d", 14);
  };

  B.towerXp = function (f, n) {
    if (!f || f.dead || f.kind !== "hero" || !(n > 0)) return;
    const C = CFG();
    f.xp = (f.xp || 0) + n;
    const lv = (C.xp && C.xp.levels) || [0, 100, 240, 420, 640, 900];
    let want = 1;
    for (let i = 0; i < lv.length; i++) if (f.xp >= lv[i]) want = i + 1;
    while ((f.level || 1) < want) this.towerLevelUp(f);
  };

  B.towerLevelUp = function (f) {
    const C = CFG();
    f.level = (f.level || 1) + 1;
    const add = C.levelHp || 40;
    f.maxHp += add; f.hp = Math.min(f.maxHp, f.hp + add);
    f.dmgBonus = (f.dmgBonus || 0) + (C.levelDmg || 0.04);
    LD.FX.ring(f.x, f.y - 26, 78, "rgba(252,211,77,.95)", 5, 0.5);
    LD.FX.burst(f.x, f.y - 26, 22, ["#fcd34d", "#fff"], { speed: 240 });
    LD.FX.float(f.x, f.y - 78, "Lv." + f.level, "#fcd34d", 18);
    this.ev.push(["h", f.x, f.y - 78, "升级 Lv." + f.level, "#fcd34d"]);
  };

  /* ----------------------------------------------------------
   *  建筑受击 / 摧毁
   * ---------------------------------------------------------- */
  B.structureDamaged = function (o, dmg, opt) {
    o.flash = 0.16;
    if (opt && opt.src && opt.src.kind === "hero") {
      o._lastHit = opt.src;
      LD.FX.float(o.x + (Math.random() * 24 - 12), o.y - (o.elev || 80) + 14, Math.round(dmg), "#fff", 13);
    }
  };

  B.onStructureBroken = function (o) {
    const C = CFG();
    const side = o.side === 0 ? 1 : 0;
    LD.FX.burst(o.x, o.y - (o.elev || 60) * 0.5, 40, ["#fff", "#fca5a5", "#fbbf24"], { speed: 360, life: 1 });
    LD.FX.ring(o.x, o.y - (o.elev || 60) * 0.4, 150, "rgba(255,255,255,.9)", 8, 0.7);
    LD.FX.shake(16);
    if (o.kind === "tower") {
      this.towerKills[side]++;
      this.ev.push(["h", o.x, o.y - 60, "防御塔被摧毁！", "#fbbf24"]);
      const killer = o._lastHit && !o._lastHit.dead ? o._lastHit : null;
      this.fighters.forEach(f => {
        if (f.kind !== "hero" || f.team !== side) return;
        if (f === killer) this.towerGold(f, (C.gold && C.gold.tower) || 180, "推塔");
        else this.towerGold(f, (C.gold && C.gold.towerShare) || 60, "团队");
      });
      if (killer) this.towerXp(killer, (C.xp && C.xp.tower) || 120);
      LD.FX.float(o.x, o.y - 90, "防御塔被摧毁！", "#fbbf24", 18);
      return;
    }
    if (o.kind === "crystal") {
      this.ev.push(["h", o.x, o.y - 70, "水晶被摧毁！", "#f87171"]);
      LD.FX.float(o.x, o.y - 100, "水晶被摧毁！", "#f87171", 22);
      this.endTowerMatch(side, "水晶被摧毁");
    }
  };

  /* ----------------------------------------------------------
   *  防御塔 / 水晶开火（高速 + 追踪）
   * ---------------------------------------------------------- */
  B.towerSrc = function (o) {
    if (!o.src) {
      o.src = {
        side: o.side, team: o.team, kind: "tower", isStruct: true,
        name: o.kind === "crystal" ? "水晶" : "防御塔",
        x: o.x, y: o.y, r: 1, hp: 1, maxHp: 1,
        dmgDealt: 0, dmgTaken: 0, kills: 0, buff: {}, energy: 0, maxEnergy: 0, enGainT: 9
      };
    }
    o.src.x = o.x; o.src.y = o.y - (o.elev || 80) * 0.45;
    return o.src;
  };

  B.updateStructures = function (dt) {
    if (!this.terrain) return;
    const C = CFG();
    const power = C.structurePower || 1;
    for (const o of this.terrain.props) {
      if (o.dead || (o.kind !== "tower" && o.kind !== "crystal")) continue;
      const S = o.kind === "crystal" ? (C.crystal || {}) : (C.tower || {});
      o.shotT = Math.max(0, (o.shotT || 0) - dt);
      const range = S.range || 300;
      let best = null, bd = Infinity;
      for (const f of this.fighters) {
        if (f.dead || f.bench) continue;
        if (f.kind !== "hero" && f.kind !== "laneMinion") continue;
        if (f.team === o.side) continue;
        if (f.stealthT > 0) continue;
        const d = Math.hypot(f.x - o.x, f.y - o.y);
        if (d > range) continue;
        const w = f.kind === "laneMinion" ? d * 0.72 : d;
        if (w < bd) { bd = w; best = f; }
      }
      if (!best) { o._target = null; continue; }
      o._target = best;
      const oy = o.y - (o.elev || 80) * 0.5;
      o.aimAngle = Math.atan2((best.y - 26) - oy, best.x - o.x);
      if (o.shotT > 0) continue;
      o.shotT = S.atk || 1.05;
      const a = o.aimAngle;
      const src = this.towerSrc(o);
      const pr = this.spawnProj({
        x: o.x + Math.cos(a) * 18, y: oy + Math.sin(a) * 12,
        vx: Math.cos(a) * (S.projSpeed || 1100), vy: Math.sin(a) * (S.projSpeed || 1100),
        r: o.kind === "crystal" ? 12 : 9, dmg: Math.round((S.dmg || 26) * power),
        life: 2.2, owner: src, color: o.side === 0 ? "#fca5a5" : "#93c5fd",
        core: "#fff", type: "towerbolt", kindTag: "skill", trail: true,
        homing: S.homing || 0
      });
      pr.data.tgt = best;                     // 追踪目标
      LD.FX.burst(o.x + Math.cos(a) * 20, oy, 6, o.side === 0 ? "#fca5a5" : "#93c5fd", { speed: 130, dir: a });
    }
  };

  /* ----------------------------------------------------------
   *  高压弹（主动装备）
   * ---------------------------------------------------------- */
  B.dropBomb = function (f) {
    this.bombs = this.bombs || [];
    this.bombs.push({ x: f.x, y: f.y, t: 3, max: 3, owner: f, r: 100, dmg: 100 });
    LD.FX.float(f.x, f.y - 60, "炸弹已放置", "#fbbf24", 14);
    LD.FX.ring(f.x, f.y, 26, "rgba(251,191,36,.9)", 3, 0.4);
  };

  B.updateBombs = function (dt) {
    if (!this.bombs || !this.bombs.length) return;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.bombs.splice(i, 1);
      LD.FX.ring(b.x, b.y, b.r, "rgba(251,146,60,.95)", 8, 0.55);
      LD.FX.burst(b.x, b.y - 10, 34, ["#fbbf24", "#fff", "#fb923c"], { speed: 340 });
      LD.FX.shake(10);
      for (const f of this.fighters) {
        if (f.dead || f.bench) continue;
        if (f.kind !== "hero" && f.kind !== "laneMinion") continue;
        if (f.team === b.owner.team) continue;
        if (Math.hypot(f.x - b.x, f.y - b.y) <= b.r + f.r)
          this.damage(b.owner, f, b.dmg, { type: "skill", kb: 160, from: b.owner, bomb: true });
      }
      if (!this.terrain) continue;
      for (const o of this.terrain.props) {
        if (o.dead) continue;
        if (o.kind !== "tower" && o.kind !== "crystal") continue;
        if (o.team === b.owner.team) continue;
        if (o.kind === "crystal" && this.crystalGuarded(o)) continue;
        if (Math.hypot(o.x - b.x, o.y - b.y) > b.r + Math.max(o.w || 40, o.h || 40) * 0.5) continue;
        LD.Terrain.hitProp(this.terrain, o, b.dmg, { dir: Math.atan2(o.y - b.y, o.x - b.x), melee: false, src: b.owner });
      }
    }
  };

  /* ----------------------------------------------------------
   *  兵线
   * ---------------------------------------------------------- */
  B.spawnTowerWave = function (side) {
    const C = CFG();
    const W = C.wave || {};
    const M = C.minion || {};
    const U = C.minionUp || { hp: 0.12, atk: 0.08 };
    const up = (this.minionBuff && this.minionBuff[side]) || { hp: 0, atk: 0 };
    const n = W.count || 6;
    const sy = C.laneY || 380;
    const sx = side === 0 ? 300 : this.world.w - 300;
    const scale = 1 + (C.minion && C.minion.scalePerTower || 0.15) * (this.towerKills[side] || 0);
    const hpMul = scale * (1 + U.hp * (up.hp || 0));
    const atkMul = scale * (1 + U.atk * (up.atk || 0));
    for (let i = 0; i < n; i++) {
      const hp = Math.round((M.hp || 67) * hpMul);
      const m = {
        kind: "laneMinion", isMinion: true, isLane: true, side, id: -1,
        team: side, x: sx + (i % 3) * 46 * (side === 0 ? 1 : -1) + (Math.random() * 12 - 6),
        y: sy + (Math.floor(i / 3) * 50 - 25),
        r: M.r || 12, facing: { x: side === 0 ? 1 : -1, y: 0 },
        hp, maxHp: hp, dmg: Math.round((M.dmg || 9) * atkMul),
        speed: M.speed || 62, atkCd: Math.random() * 0.4, aggro: M.aggro || 190,
        range: M.range || 40, moving: false, walkPhase: Math.random() * 6,
        atkAnim: 0, atkDur: 0.22, hitFlash: 0, dead: false, deadAt: 0, corpseT: 0,
        stun: 0, root: 0, invuln: 0, shield: 0, shieldT: 0, slowT: 0,
        dmgDealt: 0, dmgTaken: 0, kills: 0, energy: 0, maxEnergy: 0,
        buff: { rage: 0, thousand: 0, rush: 0 }, target: null
      };
      this.fighters.push(m);
      LD.FX.burst(m.x, m.y - 8, 8, side === 0 ? ["#fca5a5", "#fff"] : ["#93c5fd", "#fff"], { speed: 120 });
    }
    this.waveN++;
  };

  B.minionStrike = function (m, tgt) {
    const target = tgt.isStruct ? tgt.prop : tgt;
    m.atkAnim = 0.2; m.atkDur = 0.2;
    m.atkCd = (CFG().minion && CFG().minion.atk) || 1.15;
    const ang = Math.atan2(target.y - m.y, target.x - m.x);
    if (tgt.isStruct) {
      if (LD.Terrain && this.terrain)
        LD.Terrain.hitProp(this.terrain, target, m.dmg, { dir: ang, melee: true, src: m });
      LD.FX.burst(target.x - Math.cos(ang) * 20, target.y - 20 - Math.sin(ang) * 10, 6,
        m.side === 0 ? ["#fca5a5", "#fff"] : ["#93c5fd", "#fff"], { speed: 140, dir: ang });
      return;
    }
    this.damage(m, target, m.dmg, { type: "basic", kb: 40, from: m, basic: true, hitDir: ang });
    LD.FX.burst(target.x, target.y - 24, 6, ["#fde68a", "#fff"], { speed: 150, dir: ang });
  };

  B.updateLaneMinions = function (dt) {
    const C = CFG();
    const laneY = C.laneY || 380;
    for (let i = this.fighters.length - 1; i >= 0; i--) {
      const m = this.fighters[i];
      if (m.kind !== "laneMinion") continue;
      if (m.dead) {
        m.corpseT = (m.corpseT || 0) - dt;
        if (m.corpseT <= 0) this.fighters.splice(i, 1);
        continue;
      }
      m.hitFlash = Math.max(0, m.hitFlash - dt);
      m.atkCd = Math.max(0, m.atkCd - dt);
      m.atkAnim = Math.max(0, m.atkAnim - dt);
      m.stun = Math.max(0, m.stun - dt);
      if (m.stun > 0) continue;

      let tgt = m.target;
      if (tgt && (tgt.isStruct ? (tgt.prop.dead || !tgt.prop) : tgt.dead)) tgt = null;
      if (tgt && !tgt.isStruct && dist(m, tgt) > m.aggro + 80) tgt = null;

      if (!tgt) {
        let best = null, bd = m.aggro;
        for (const f of this.fighters) {
          if (f === m || f.dead || f.bench) continue;
          if (f.kind !== "hero" && f.kind !== "laneMinion") continue;
          if (f.team === m.team || f.stealthT > 0) continue;
          const d = dist(m, f);
          if (d < bd) { bd = d; best = f; }
        }
        if (!best) {
          const st = this.enemyStructure(m.team, m.x, m.y, 320);
          if (st) best = { isStruct: true, prop: st, x: st.x, y: st.y, r: 12, dead: false };
        }
        tgt = best;
        m.target = tgt;
      }

      m.moving = false;
      if (tgt) {
        const target = tgt.isStruct ? tgt.prop : tgt;
        const dx = target.x - m.x, dy = target.y - m.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = tgt.isStruct
          ? Math.max(target.w || 40, target.h || 40) * 0.5 + m.r + 6
          : m.range + (target.r || 12);
        m.facing = { x: dx / d, y: dy / d };
        if (d > reach) {
          m.x += dx / d * m.speed * dt;
          m.y += dy / d * m.speed * dt;
          m.moving = true; m.walkPhase += dt * 12;
        } else if (m.atkCd <= 0) {
          this.minionStrike(m, tgt);
        }
      } else {
        const goalX = m.team === 0 ? this.world.w - 200 : 200;
        const dx = goalX - m.x;
        const dy = laneY - m.y;
        const n = Math.hypot(dx, dy) || 1;
        m.facing = { x: dx / n, y: dy / n };
        m.x += dx / n * m.speed * dt;
        m.y += dy / n * m.speed * dt;
        m.moving = true; m.walkPhase += dt * 12;
      }
      m.x = clamp(m.x, 40, this.world.w - 40);
      m.y = clamp(m.y, this.world.pt + 20, this.world.h - 40);
    }
  };

  /* ----------------------------------------------------------
   *  每帧主循环（只在 fight 阶段调用）
   * ---------------------------------------------------------- */
  B.updateTower = function (dt) {
    const C = CFG();
    this.updateLaneMinions(dt);
    this.updateStructures(dt);
    this.updateBombs(dt);

    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.waveT = (C.wave && C.wave.every) || 32;
      this.spawnTowerWave(0);
      this.spawnTowerWave(1);
    }

    const F = C.fountain || { r: 170, healPct: 0.035 };
    this.fighters.forEach(f => {
      if (f.kind !== "hero") return;
      if (f.activeCd > 0) f.activeCd = Math.max(0, f.activeCd - dt);
      if (f.speedBuffT > 0) f.speedBuffT = Math.max(0, f.speedBuffT - dt);
      if (f.reflectT > 0) f.reflectT = Math.max(0, f.reflectT - dt);
      if (f.requiemCd > 0) f.requiemCd = Math.max(0, f.requiemCd - dt);
      if (f.dead) {
        if (f.respawnT > 0) {
          f.respawnT -= dt;
          if (f.respawnT <= 0) this.towerRespawn(f);
        }
        return;
      }
      /* 敢死队：残血霸体 */
      f.ccImmune = !!(f.items && f.items.brave && f.hp < 80);
      /* 还魂曲 */
      if (f.items && f.items.requiem && f.hp > 0 && f.hp < 30 && (f.requiemT || 0) <= 0 && (f.requiemCd || 0) <= 0) {
        f.requiemT = 5; f.requiemCd = 60;
        LD.FX.ring(f.x, f.y - 26, 64, "rgba(244,114,182,.85)", 5, 0.45);
        LD.FX.float(f.x, f.y - 62, "还魂曲", "#f472b6", 15);
      }
      if (f.requiemT > 0) {
        f.requiemT = Math.max(0, f.requiemT - dt);
        f.hp = Math.min(f.maxHp, f.hp + 10 * dt);
        if (Math.random() < dt * 8) LD.FX.trail(f.x + (Math.random() * 18 - 9), f.y - 20, "#f472b6", 3, 0.35);
      }
      /* 续航宝石 */
      if (f.items && f.items.regen && this.t - (f.lastHurtAt || -99) > 5 && f.hp < f.maxHp) {
        f.hp = Math.min(f.maxHp, f.hp + 2 * dt);
      }
      /* 基地回血圈 */
      const b = this.towerBase(f.team === 1 ? 1 : 0);
      if (f.hp < f.maxHp && Math.hypot(f.x - b.x, f.y - b.y) <= (F.r || 170)) {
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * (F.healPct || 0.035) * dt);
        if (Math.random() < dt * 6) LD.FX.trail(f.x + (Math.random() * 20 - 10), f.y - Math.random() * 30, "#34d399", 3, 0.4);
      }
      f._assist = f._assist || {};
      Object.keys(f._assist).forEach(k => { if (this.t - f._assist[k] > (C.assistT || 8)) delete f._assist[k]; });
    });

    /* 人机买装备 / 用主动装备 */
    this.botShopT = (this.botShopT || 0) + dt;
    if (this.botShopT >= 4) {
      this.botShopT = 0;
      this.botTowerShopping();
    }
  };

  B.botTowerShopping = function () {
    const order = ["hp", "atk", "armor", "spd", "energy", "vamp", "cdr", "steel", "cloak", "regen", "brave", "requiem",
      "heal", "ward", "bomb", "frost", "haste", "thorns", "minionHp", "minionAtk"];
    this.fighters.forEach(f => {
      if (!f.isBot || f.kind !== "hero" || f.dead || f.bench) return;
      if (f.activeItem && (f.activeCd || 0) <= 0) {
        const near = this.fighters.some(o => o !== f && !o.dead && o.team !== f.team &&
          (o.kind === "hero" || o.kind === "laneMinion") && dist(f, o) < 120);
        const id = f.activeItem;
        if (id === "heal" && f.hp < f.maxHp * 0.6) this.useTowerActive(f);
        else if (id === "ward" && f.hp < f.maxHp * 0.7) this.useTowerActive(f);
        else if ((id === "bomb" || id === "frost" || id === "thorns") && near) this.useTowerActive(f);
        else if (id === "haste" && (f.hp < f.maxHp * 0.45 || near)) this.useTowerActive(f);
      }
      if (f.rideCar && (f.rideCar.fuel || 0) < (f.rideCar.fuelMax || 0) * 0.55 &&
          (f.bcoins || 0) >= ((LD.TOWER.fuel && LD.TOWER.fuel.price) || 80)) {
        if (this.towerBuy(f, "fuel")) return;
      }
      for (const id of order) {
        const it = LD.towerItem(id);
        if (!it) continue;
        if (it.kind === "team") {
          if (this.towerStack(f, id) >= ((LD.TOWER.minionUp || {}).max || 5)) continue;
        } else {
          if (f.items && f.items[id]) continue;
          if (it.kind === "active" && f.activeItem) continue;
        }
        if ((f.bcoins || 0) >= it.price) { this.towerBuy(f, id); break; }
      }
    });
  };

  B.towerRespawn = function (f) {
    const C = CFG();
    const b = this.towerBase(f.team === 1 ? 1 : 0);
    f.dead = false; f.respawnT = 0;
    f.hp = f.maxHp; f.energy = 0;
    f.stun = 0; f.root = 0; f.silenceT = 0; f.blind = 0; f.slowT = 0; f.shield = 0; f.shieldT = 0;
    f.knockLeft = 0; f.knockWall = false; f.meditate = 0; f.hitFlash = 0;
    f.buff = { rage: 0, thousand: 0, rush: 0 };
    f.reflectT = 0; f.requiemT = 0; f.ccImmune = false;
    Object.keys(f.slot || {}).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
    if (f.cd) { f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.dodge = 0; f.cd.ult = 1.5; }
    f.x = b.x + (f.team === 0 ? 24 : -24);
    f.y = b.y;
    f.invuln = (C.respawn && C.respawn.invuln) || 2;
    this.graves = (this.graves || []).filter(g => g.hero !== f);
    LD.FX.ring(f.x, f.y - 26, 80, "rgba(103,232,249,.95)", 5, 0.5);
    LD.FX.burst(f.x, f.y - 26, 20, ["#7fe6f7", "#fff"], { speed: 240 });
    LD.FX.float(f.x, f.y - 70, "复活", "#7fe6f7", 17);
  };

  B.endTowerMatch = function (winner, why) {
    if (this.state === "over" || this.towerDone) return;
    this.towerDone = true;
    this.state = "over";
    this.matchWinner = winner;
    this.towerResult = why || "";
    const me = this.hero(this.mySide == null ? 0 : this.mySide);
    const win = !!(me && winner >= 0 && me.team === winner);
    if (winner >= 0) {
      const names = ["红队", "蓝队"];
      LD.Cine && LD.Cine.start && LD.Cine.start(me, names[winner] + "胜利", why || "",
        winner === 0 ? "#f87171" : "#60a5fa", "比分 " + this.tScore[0] + " : " + this.tScore[1]);
    }
    if (this.onEnd) this.onEnd(win);
  };

  /* ----------------------------------------------------------
   *  局内装备
   * ---------------------------------------------------------- */
  B.towerShop = function () { return LD.TOWER_SHOP || []; };

  B.towerStack = function (f, id) {
    if (!f) return 0;
    const it = LD.towerItem(id);
    if (!it || it.kind !== "team") return 0;
    const key = id === "minionHp" ? "hp" : "atk";
    const t = (this.minionBuff && this.minionBuff[f.team]) || null;
    return t ? (t[key] || 0) : 0;
  };

  B.towerCanBuy = function (f, id) {
    const it = LD.towerItem(id);
    if (!f || !it) return { ok: false, why: "没有这件装备" };
    /* v3.9 汽油桶：只有坐在车上才能买，可无限买 */
    if (it.kind === "fuel") {
      const car = f.rideCar;
      if (!car || car.dead) return { ok: false, why: "需要先坐进车里" };
      if ((car.fuel || 0) >= (car.fuelMax || 0)) return { ok: false, why: "油箱已经满了" };
      if ((f.bcoins || 0) < it.price) return { ok: false, why: "金币不足" };
      return { ok: true, item: it };
    }
    if (it.kind === "team") {
      const max = (LD.TOWER.minionUp || {}).max || 5;
      if (this.towerStack(f, id) >= max) return { ok: false, why: "已经叠满 " + max + " 层" };
    } else {
      if ((f.items || {})[id]) return { ok: false, why: "已经买过了" };
      if (it.kind === "active" && f.activeItem) return { ok: false, why: "只能携带一件主动装备" };
    }
    if ((f.bcoins || 0) < it.price) return { ok: false, why: "金币不足" };
    return { ok: true, item: it };
  };

  B.towerBuy = function (f, id) {
    const r = this.towerCanBuy(f, id);
    if (!r.ok) return false;
    const it = r.item;
    f.bcoins -= it.price;
    f.items = f.items || {};
    if (it.kind === "fuel") {
      const car = f.rideCar;
      const C = CFG();
      const add = (C.fuel && C.fuel.add) || 2000;
      const before = car.fuel || 0;
      car.fuel = Math.min(car.fuelMax || before + add, before + add);
      car._fuelSaid = false;
      LD.FX.float(car.x, car.y - 58, "+" + Math.round(car.fuel - before) + " 油", "#fbbf24", 16);
      LD.FX.ring(car.x, car.y - 20, 50, "rgba(251,191,36,.85)", 4, 0.4);
      LD.FX.float(f.x, f.y - 70, "汽油桶", "#fcd34d", 14);
      return true;
    }
    if (it.kind === "team") {
      const key = id === "minionHp" ? "hp" : "atk";
      this.minionBuff = this.minionBuff || [{ hp: 0, atk: 0 }, { hp: 0, atk: 0 }];
      const t = this.minionBuff[f.team] || (this.minionBuff[f.team] = { hp: 0, atk: 0 });
      t[key] = (t[key] || 0) + 1;
      LD.FX.float(f.x, f.y - 66, it.name + " ×" + t[key], "#7ff0c4", 15);
      LD.FX.ring(f.x, f.y - 26, 60, "rgba(52,211,153,.8)", 4, 0.4);
      return true;
    }
    f.items[id] = 1;
    switch (id) {
      case "hp": f.maxHp += 160; f.hp += 160; break;
      case "atk": f.dmgBonus = (f.dmgBonus || 0) + 0.18; break;
      case "spd": f.speedMul = (f.speedMul || 1) + 0.12; break;
      case "armor": f.dr = (f.dr || 0) + 0.15; break;
      case "vamp": f.lifesteal = (f.lifesteal || 0) + 0.12; break;
      case "cdr": f.cdM = (f.cdM || 1) * 0.82; break;
      case "energy": f.energyMul = (f.energyMul || 1) * 1.15; break;
      case "steel": f.projDR = (f.projDR || 0) + 0.20; break;
      case "cloak": f.dodgeChance = (f.dodgeChance || 0) + 0.12; break;
      default:
        if (it.kind === "active") { f.activeItem = id; f.activeCd = 0; }
    }
    LD.FX.ring(f.x, f.y - 26, 66, "#fcd34d", 5, 0.4);
    LD.FX.float(f.x, f.y - 66, it.name, "#fcd34d", 15);
    if (typeof Audio2 !== "undefined" && Audio2.buy) Audio2.buy();
    return true;
  };

  /** P 键：释放主动装备 */
  B.useTowerActive = function (f) {
    if (!f || f.dead || !f.activeItem) return false;
    const it = LD.towerItem(f.activeItem);
    if (!it) return false;
    if (f.activeCd > 0) {
      LD.FX.float(f.x, f.y - 62, "装备冷却 " + Math.ceil(f.activeCd) + "s", "#9fb3dd", 13);
      return false;
    }
    const id = f.activeItem;
    if (id === "heal") {
      if (f.hp >= f.maxHp) { LD.FX.float(f.x, f.y - 62, "血量已满", "#9fb3dd", 13); return false; }
      const heal = Math.round(f.maxHp * 0.35);
      f.hp = Math.min(f.maxHp, f.hp + heal);
      LD.FX.float(f.x, f.y - 66, "+" + heal, "#34d399", 17);
      LD.FX.ring(f.x, f.y - 26, 62, "rgba(52,211,153,.9)", 5, 0.45);
    } else if (id === "haste") {
      f.speedBuffT = 3; f.speedBuff = 1.6;
      LD.FX.float(f.x, f.y - 66, "疾行！", "#67e8f9", 16);
      LD.FX.ring(f.x, f.y - 26, 60, "rgba(103,232,249,.9)", 5, 0.4);
    } else if (id === "ward") {
      f.shield = Math.max(f.shield || 0, 180);
      f.shieldT = Math.max(f.shieldT || 0, 8);
      LD.FX.float(f.x, f.y - 66, "护盾 180", "#fcd34d", 16);
      LD.FX.ring(f.x, f.y - 26, 70, "rgba(252,211,77,.9)", 5, 0.45);
    } else if (id === "bomb") {
      this.dropBomb(f);
    } else if (id === "thorns") {
      f.reflectT = 4;
      LD.FX.float(f.x, f.y - 66, "刺甲 4s", "#86efac", 16);
      LD.FX.ring(f.x, f.y - 26, 64, "rgba(134,239,172,.9)", 5, 0.45);
    } else if (id === "frost") {
      let hit = 0;
      for (const o of this.fighters) {
        if (o === f || o.dead || o.bench) continue;
        if (o.kind !== "hero" && o.kind !== "laneMinion") continue;
        if (o.team === f.team) continue;
        if (Math.hypot(o.x - f.x, o.y - f.y) > 80 + o.r) continue;
        this.applyStun(o, 2.5);
        LD.FX.ring(o.x, o.y - 20, 30, "rgba(147,197,253,.9)", 3, 0.35);
        hit++;
      }
      LD.FX.ring(f.x, f.y - 26, 90, "rgba(147,197,253,.95)", 6, 0.5);
      LD.FX.float(f.x, f.y - 66, hit ? "冻结 " + hit + " 人" : "身边没人", "#93c5fd", 16);
    } else return false;
    f.activeCd = it.cd || 40;
    return true;
  };

  /* ----------------------------------------------------------
   *  对 damage / kill 做包装
   * ---------------------------------------------------------- */
  const _damage = B.damage;
  B.damage = function (src, tgt, amt, o) {
    o = o || {};
    const wasDead = tgt && tgt.dead;
    const r = _damage.apply(this, arguments);
    if (this.rule !== "tower" || !r || r <= 0) return r;
    /* 吸血 */
    if (src && src.lifesteal && src.kind === "hero" && !src.dead && src.hp < src.maxHp) {
      const heal = Math.max(1, Math.round(r * src.lifesteal));
      src.hp = Math.min(src.maxHp, src.hp + heal);
      if (Math.random() < 0.5) LD.FX.float(src.x, src.y - 52, "+" + heal, "#34d399", 12);
    }
    /* 助攻 */
    if (src && src.kind === "hero" && tgt && tgt.kind === "hero" && !wasDead && !tgt.dead && src.team !== tgt.team) {
      tgt._assist = tgt._assist || {};
      tgt._assist[src.side] = this.t;
    }
    /* 刺甲：把 50% 伤害返还给攻击者 */
    if (tgt && tgt.reflectT > 0 && !o.reflect && src && src !== tgt && (src.kind === "hero" || src.kind === "laneMinion") && !src.dead) {
      const back = Math.max(1, Math.round(r * 0.5));
      this.damage(tgt, src, back, { type: "dot", reflect: true, kb: 0 });
      LD.FX.float(tgt.x, tgt.y - 74, "反伤 " + back, "#86efac", 13);
    }
    return r;
  };

  const _kill = B.kill;
  B.kill = function (f, by) {
    if (!f || f.dead || this.rule !== "tower") return _kill.apply(this, arguments);

    if (f.kind === "laneMinion") {
      f.dead = true; f.deadAt = this.t; f.corpseT = 0.45;
      this.ev.push(["k", f.x, f.y - 12]);
      LD.FX.burst(f.x, f.y - 10, 18, ["#e2e8f0", "#94a3b8", "#64748b"], { speed: 220, life: 0.6 });
      LD.FX.ring(f.x, f.y - 10, 34, "rgba(226,232,240,.7)", 3, 0.3);
      if (by && by.kind === "hero" && !by.dead) {
        this.towerGold(by, (CFG().gold && CFG().gold.minion) || 32, "补兵");
        this.towerXp(by, (CFG().xp && CFG().xp.minion) || 20);
      }
      return;
    }
    if (f.kind !== "hero") return _kill.apply(this, arguments);

    const C = CFG();
    f.dead = true; f.deadAt = this.t;
    f.towerDeaths = (f.towerDeaths || 0) + 1;
    f.deaths = (f.deaths || 0) + 1;
    LD.FX.burst(f.x, f.y - 26, 36, ["#fff", "#fb7185", "#fbbf24"], { speed: 340, life: 0.9 });
    LD.FX.ring(f.x, f.y - 26, 110, "rgba(255,255,255,.9)", 6, 0.6);
    LD.FX.shake(14);
    this.ev.push(["k", f.x, f.y - 26]);
    if (by && by.kind === "hero") by.kills++;
    const loser = f.team === 1 ? 1 : 0;
    this.tScore[1 - loser] = (this.tScore[1 - loser] || 0) + 1;

    if (by && by.kind === "hero" && !by.dead && by.team !== f.team) {
      this.towerGold(by, (C.gold && C.gold.hero) || 240, "击杀");
      this.towerXp(by, (C.xp && C.xp.hero) || 120);
      LD.FX.float(by.x, by.y - 92, "击杀 +" + ((C.gold && C.gold.hero) || 240), "#fcd34d", 16);
    }
    Object.keys(f._assist || {}).forEach(s => {
      const a = this.fighters.find(x => x.side === +s);
      if (!a || a === by || a.dead || a.team === f.team) return;
      this.towerGold(a, (C.gold && C.gold.assist) || 120, "助攻");
      this.towerXp(a, Math.round(((C.xp && C.xp.hero) || 120) * 0.5));
    });
    f._assist = {};

    const lv = f.level || 1;
    f.respawnT = Math.min((C.respawn && C.respawn.max) || 28,
      ((C.respawn && C.respawn.base) || 8) + lv * ((C.respawn && C.respawn.perLv) || 2.2));
    f.hp = 0;
    this.graves = this.graves || [];
    this.graves.push({ x: f.x, y: f.y, side: loser, hero: f, born: this.t });
    LD.FX.float(f.x, f.y - 70, Math.ceil(f.respawnT) + " 秒后复活", "#9fb3dd", 14);
  };
})(window.LD = window.LD || {});
