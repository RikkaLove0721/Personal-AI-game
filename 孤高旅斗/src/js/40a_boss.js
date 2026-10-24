/* ============================================================
 *  40a_boss.js - BOSS 与特殊单位技能实现（IMPL.g_* / b_* / f_* / t_* / gm_* / ts_* / d_*）
 *  自 40_battle.js 拆分（v4.12 工程债）。只搬代码，判定逻辑一行未改。
 *  瞄准工具 aimAt / arcFX 留在 40a_skill.js 里并挂到 B 上，本模块顶部转一层即可原样调用。
 * ============================================================ */
(function (LD) {
  "use strict";
  const C = LD.CONF, TAU = Math.PI * 2;
  const FX = LD.FX, V = LD.View;
  const clamp = V.clamp;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const B = LD.Battle;
  const IMPL = LD.SKILL_IMPL;

  const aimAt = (f, impl) => B.aimAt(f, impl);
  const arcFX = (f, color, reach) => B.arcFX(f, color, reach);

  /* ---- 快枪手：快枪（1s CD 手枪普攻，全程持续） ----
   * 不能直接复用 IMPL.pistol：手枪读的是 sk.proj.*，而 BOSS 的普攻配置是扁平的
   * speed/r/life，直接复用会因 sk.proj 为 undefined 抛错，BOSS 一枪都打不出来。 */
  IMPL.g_shot = {
    start(f, slot, sk) {
      const pj = sk.proj || sk;                      // 两种写法都兼容
      f.atkAnim = 0.22; f.atkDur = 0.22;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      const v = pj.speed || 860;
      B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 12,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: pj.r || 7, dmg: sk.dmg, life: pj.life || 1.5, owner: f,
        color: "#fde68a", core: "#fffbeb", type: "bullet", kindTag: "basic", basic: true, trail: true
      });
      FX.burst(f.x + Math.cos(a) * 26, f.y - 26, 7, "#fef3c7", { speed: 190, dir: a, spread: 0.4 });
      FX.shake(2.5);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 快枪手：炸弹投掷（朝玩家位置扔出中范围炸弹） ---- */
  IMPL.g_bomb = {
    start(f, slot, sk) {
      f.atkAnim = 0.3; f.atkDur = 0.3;
      const foe = B.foeOf(f);
      const tx = foe ? foe.x : f.x - 220, ty = foe ? foe.y : f.y;
      const fuse = sk.fuse || 1.05;
      const t = fuse * 0.92;                      // 打一点提前量，正好落在玩家脚下
      B.spawnProj({
        x: f.x, y: f.y - 40,
        vx: (tx - f.x) / t * 0.88, vy: (ty - (f.y - 40)) / t * 0.88,
        r: 10, dmg: 0, life: fuse + 1.2, owner: f, type: "bomb",
        data: { fuse, R: sk.boomR || 112, boom: sk.dmg, stun: 0 }
      });
      FX.burst(f.x, f.y - 40, 8, ["#a78bfa", "#fff"], { speed: 140 });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 快枪手：连环十响（朝前方快速打出 10 发子弹） ---- */
  IMPL.g_burst = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "burst"; s.t = 0;
      const foe = B.foeOf(f);
      if (foe) {
        const dx = foe.x - f.x, dy = foe.y - f.y, dd = Math.hypot(dx, dy) || 1;
        f.facing = { x: dx / dd, y: dy / dd };
      }
      s.d.a = Math.atan2(f.facing.y, f.facing.x);
      s.d.n = 0; s.d.acc = 0;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "burst") return;
      s.d.acc += dt;
      if (s.d.n >= sk.n || s.d.acc < (sk.gap || 0.07)) return;
      s.d.acc = 0; s.d.n++;
      const a = s.d.a + rand(-(sk.spread || 0.15), sk.spread || 0.15) * 0.6;
      B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 12,
        vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed,
        r: sk.r, dmg: sk.dmg, life: sk.life || 1.3, owner: f,
        color: "#fde68a", core: "#fffbeb", type: "bullet", kindTag: "skill", trail: true
      });
      f.atkAnim = 0.16; f.atkDur = 0.16;
      FX.burst(f.x + Math.cos(a) * 26, f.y - 26, 5, "#fde68a", { speed: 150, dir: a });
      if (s.d.n >= sk.n) B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 快枪手：幻影隐身（8s 隐身，期间攻击照常且不现形） ---- */
  IMPL.g_ghost = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "ghost"; s.t = 0;
      f.stealthT = sk.dur; f.stealthSlot = slot;
      f.stealthKeep = true; f._ghostNoFlash = true;
      LD.Cine.start(f, sk.name, "", "#94a3b8");
      FX.ring(f.x, f.y - 26, 70, "rgba(148,163,184,.9)", 5, 0.5);
      FX.burst(f.x, f.y - 26, 20, ["#94a3b8", "#fff"], { speed: 240 });
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "ghost") return;
      s.t += dt;
      f.stealthT = Math.max(0, sk.dur - s.t);
      if (s.t >= sk.dur) {
        f.stealthT = 0; f.stealthKeep = false; f._ghostNoFlash = false;
        FX.ring(f.x, f.y - 26, 60, "rgba(148,163,184,.9)", 4, 0.4);
        B.endSlot(f, slot, sk.cd * (f.rateM || 1));
      }
    }
  };

  /* ==================== v2.6 新 BOSS 技能实现 ==================== */

  /* ---- 机械蜂后：尾针 / 孵化 / 蜂群冲锋 / 蜂群倾巢 ---- */
  IMPL.b_needle = {
    start(f, slot, sk) {
      const pj = sk.proj || sk;
      f.atkAnim = 0.22; f.atkDur = 0.22;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      const v = pj.speed || 640;
      B.spawnProj({
        x: f.x + Math.cos(a) * 22, y: f.y - 26 + Math.sin(a) * 10,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: pj.r || 7, dmg: sk.dmg, life: pj.life || 2.0, owner: f,
        color: "#a3e635", core: "#f7fee7", type: "bullet", kindTag: "basic", basic: true, trail: true
      });
      FX.burst(f.x + Math.cos(a) * 24, f.y - 26, 6, "#a3e635", { speed: 170, dir: a, spread: 0.4 });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.b_hatch = {
    start(f, slot, sk) {
      f.atkAnim = 0.35; f.atkDur = 0.35;
      const n = sk.n || 2;
      const alive = B.fighters.filter(x => x.kind === "minion" && x.owner === f && !x.dead).length;
      for (let i = 0; i < n && alive + i < 6; i++) {
        const a = rand(0, TAU);
        B.spawnMinion("beeDrone", f.x + Math.cos(a) * 42, f.y + Math.sin(a) * 30, f);
      }
      FX.ring(f.x, f.y - 26, 80, "rgba(163,230,53,.95)", 5, 0.45);
      FX.float(f.x, f.y - 78, "孵化！", "#a3e635", 16);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.b_sweep = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "beeWind"; s.t = 0;
      s.d.n = 0; s.d.acc = 0;
      f.facing = aimAt(f, this);
      f.root = Math.max(f.root, (sk.windup || 0.35) + (sk.hits || 3) * (sk.gap || 0.16) + 0.15);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase === "beeWind") {
        s.t += dt;
        FX.trail(f.x + rand(-20, 20), f.y - 26 + rand(-26, 10), "#fbbf24", 6, 0.3);
        if (s.t >= (sk.windup || 0.35)) { s.phase = "beeSlash"; s.t = 0; s.d.acc = 0; }
      } else if (s.phase === "beeSlash") {
        s.d.acc += dt;
        if (s.d.n < sk.hits && s.d.acc >= (sk.gap || 0.16)) {
          s.d.acc = 0; s.d.n++;
          f.atkAnim = 0.2; f.atkDur = 0.2;
          f.facing = aimAt(f, this);
          B.melee(f, { reach: sk.reach || 110, half: 1.3, dmg: sk.dmg, type: "skill", kb: 170 });
          arcFX(f, "#fbbf24", 100);
          FX.shake(5);
          if (s.d.n >= sk.hits) B.endSlot(f, slot, sk.cd * (f.rateM || 1));
        }
      }
    }
  };
  IMPL.b_swarm = {
    start(f, slot, sk) {
      LD.Cine.start(f, sk.name, "", "#a3e635");
      const foe = B.foeOf(f);
      const cx = foe ? foe.x : f.x, cy = foe ? foe.y : f.y;
      const n = sk.n || 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand(-0.3, 0.3);
        const rr2 = rand(60, 130);
        B.spawnMinion("beeDrone",
          clamp(cx + Math.cos(a) * rr2, 40, B.world.w - 40),
          clamp(cy + Math.sin(a) * rr2, B.world.pt, B.world.h - 40), f);
      }
      FX.shake(10); FX.flash(0.2, "163,230,53");
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 霜甲巨像：冰锥 / 霜压 / 寒霜领域 / 绝对零度 ---- */
  IMPL.f_cone = {
    start(f, slot, sk) {
      f.atkAnim = 0.28; f.atkDur = 0.28;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 26, y: f.y - 30 + Math.sin(a) * 10,
        vx: Math.cos(a) * (sk.speed || 380), vy: Math.sin(a) * (sk.speed || 380),
        r: sk.r || 12, dmg: sk.dmg, life: sk.life || 2.6, owner: f,
        color: "#7dd3fc", core: "#f0f9ff", type: "icicle", kindTag: "basic", basic: true, trail: true
      });
      FX.burst(f.x + Math.cos(a) * 28, f.y - 30, 7, "#bae6fd", { speed: 160, dir: a, spread: 0.4 });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.f_quake = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "quakeCast"; s.t = 0;
      B.zones.push({
        type: "quake", x: f.x, y: f.y, r: sk.r || 150, warn: sk.warn || 0.7,
        life: 0, max: 0.3, dmg: sk.dmg, owner: f, hits: {}
      });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.f_field = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "fieldCast"; s.t = 0;
      B.zones.push({
        type: "frost", x: f.x, y: f.y, r: sk.r || 175,
        life: 0, max: sk.dur || 6, owner: f, hits: {},
        dmg: sk.dmg || 3, tick: sk.tick || 0.5, fromField: true
      });
      FX.ring(f.x, f.y - 20, sk.r || 175, "rgba(125,211,252,.9)", 6, 0.6);
      FX.float(f.x, f.y - 84, "寒霜领域", "#7dd3fc", 16);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.f_zero = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "zeroCast"; s.t = 0;
      s.d.warn = sk.warn || 2.6;
      LD.Cine.start(f, sk.name, "", "#7dd3fc");
      B.zones.push({
        type: "zero", x: f.x, y: f.y, r: sk.safeR || 210, warn: sk.warn || 2.6,
        life: 0, max: 0.4, dmg: sk.dmg, stun: sk.stun || 1.5, owner: f, hits: {}
      });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 双子剑客：交替突刺 / 交叉突进 / 合璧斩 ---- */
  IMPL.t_slash = {
    start(f, slot, sk) {
      f.atkAnim = 0.22; f.atkDur = 0.26;
      f.facing = aimAt(f, this);
      B.melee(f, { reach: 78, half: 1.2, dmg: sk.dmg, type: "basic", kb: 120, basic: true });
      arcFX(f, "#cbd5e1", 78);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.t_cross = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "twinWind"; s.t = 0;
      const foe = B.foeOf(f);
      if (foe) {
        const a = Math.atan2(f.y - foe.y, f.x - foe.x) || 0;
        f.x = clamp(foe.x + Math.cos(a) * (foe.r + f.r + 12), 40, B.world.w - 40);
        f.y = clamp(foe.y + Math.sin(a) * (foe.r + f.r + 12), B.world.pt + 10, B.world.h - 44);
        const dx = foe.x - f.x, dy = foe.y - f.y, dd = Math.hypot(dx, dy) || 1;
        f.facing = { x: dx / dd, y: dy / dd };
        FX.burst(f.x, f.y - 26, 14, ["#cbd5e1", "#475569"], { speed: 240 });
        f.invuln = Math.max(f.invuln, (sk.windup || 0.3) + 0.1);
        f.root = Math.max(f.root, (sk.windup || 0.3) + 0.35);
      }
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "twinWind") return;
      s.t += dt;
      FX.trail(f.x + rand(-16, 16), f.y - 26 + rand(-22, 10), "#94a3b8", 6, 0.3);
      if (s.t >= (sk.windup || 0.3)) {
        f.atkAnim = 0.2; f.atkDur = 0.2;
        B.melee(f, { reach: sk.reach || 130, half: 1.25, dmg: sk.dmg, type: "skill", kb: 220 });
        arcFX(f, "#cbd5e1", 110);
        FX.shake(7);
        B.endSlot(f, slot, sk.cd * (f.rateM || 1));
      }
    }
  };
  IMPL.t_duo = {
    start(f, slot, sk) {
      LD.Cine.start(f, sk.name, "", "#cbd5e1");
      const s = f.slot[slot]; s.on = true; s.phase = "duoWind"; s.t = 0;
      s.d.wind = sk.windup || 0.5;
      f.root = Math.max(f.root, (sk.windup || 0.5) + 0.6);
      /* 另一位双子也同步突进 */
      const partner = f.twinLink;
      if (partner && !partner.dead) {
        const foe2 = B.foeOf(partner);
        if (foe2) {
          const a2 = Math.atan2(partner.y - foe2.y, partner.x - foe2.x) || 0;
          partner.x = clamp(foe2.x + Math.cos(a2) * (foe2.r + partner.r + 12), 40, B.world.w - 40);
          partner.y = clamp(foe2.y + Math.sin(a2) * (foe2.r + partner.r + 12), B.world.pt + 10, B.world.h - 44);
          const dx2 = foe2.x - partner.x, dy2 = foe2.y - partner.y, dd2 = Math.hypot(dx2, dy2) || 1;
          partner.facing = { x: dx2 / dd2, y: dy2 / dd2 };
          partner.root = Math.max(partner.root, (sk.windup || 0.5) + 0.6);
          FX.burst(partner.x, partner.y - 26, 14, ["#cbd5e1", "#fff"], { speed: 240 });
        }
      }
      f.invuln = Math.max(f.invuln, (sk.windup || 0.5) + 0.1);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "duoWind") return;
      s.t += dt;
      FX.trail(f.x + rand(-18, 18), f.y - 26 + rand(-24, 10), "#e2e8f0", 7, 0.3);
      if (s.t >= (sk.windup || 0.5)) {
        const foe = B.foeOf(f);
        if (foe) {
          const dx = foe.x - f.x, dy = foe.y - f.y, dd = Math.hypot(dx, dy) || 1;
          f.facing = { x: dx / dd, y: dy / dd };
        }
        f.atkAnim = 0.24; f.atkDur = 0.24;
        B.melee(f, { reach: sk.reach || 160, half: 1.4, dmg: sk.dmg, type: "ult", kb: 380 });
        arcFX(f, "#e2e8f0", 140);
        FX.shake(12);
        const partner = f.twinLink;
        if (partner && !partner.dead) {
          partner.atkAnim = 0.24; partner.atkDur = 0.24;
          B.melee(partner, { reach: sk.reach || 160, half: 1.4, dmg: sk.dmg, type: "ult", kb: 380 });
          arcFX(partner, "#e2e8f0", 140);
        }
        B.endSlot(f, slot, sk.cd * (f.rateM || 1));
      }
    }
  };

  /* ---- 赌徒：掷骰 / 抽牌 / 出千 / 俄罗斯轮盘 ---- */
  IMPL.gm_dice = {
    start(f, slot, sk) {
      f.atkAnim = 0.24; f.atkDur = 0.24;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      const dmg = 4 + Math.floor(Math.random() * 11);          // 4 - 14 随机
      B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 10,
        vx: Math.cos(a) * (sk.speed || 560), vy: Math.sin(a) * (sk.speed || 560),
        r: sk.r || 9, dmg, life: sk.life || 2.2, owner: f,
        color: "#34d399", core: "#ecfdf5", type: "dice", kindTag: "basic", basic: true, spin: true
      });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.gm_card = {
    start(f, slot, sk) {
      f.atkAnim = 0.3; f.atkDur = 0.3;
      const roll = Math.random();
      if (roll < 0.3) {
        B.heal(f, 15);
        FX.float(f.x, f.y - 80, "回血牌 +15", "#7ff0c4", 16);
      } else if (roll < 0.6) {
        f.buff.rush = 4;
        FX.float(f.x, f.y - 80, "加速牌！", "#fbbf24", 16);
      } else if (roll < 0.85) {
        f.invuln = Math.max(f.invuln, 1.5);
        FX.float(f.x, f.y - 80, "无敌牌！", "#67e8f9", 16);
      } else {
        B.damage(f, f, 8, { type: "dot", kb: 0, noSrc: true });
        FX.float(f.x, f.y - 80, "自爆牌…", "#fb7185", 16);
      }
      FX.burst(f.x, f.y - 40, 12, ["#34d399", "#fbbf24", "#fff"], { speed: 200 });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.gm_cheat = {
    start(f, slot, sk) {
      f.atkAnim = 0.3; f.atkDur = 0.3;
      let n = 0;
      B.projs.forEach(p => {
        if (p.side === f.side || p.type === "hbomb" || p.type === "bomb") return;
        p.side = f.side; p.owner = f; p.reflect = true;
        p.vx *= -1; p.vy *= -1;
        p.dmg = Math.round(p.dmg * 1.2) + 2;
        p.color = "#34d399"; p.life = 0; p.maxLife = 3;
        n++;
      });
      FX.ring(f.x, f.y - 26, 110, "rgba(52,211,153,.95)", 6, 0.5);
      FX.float(f.x, f.y - 82, n ? "出千！弹幕反转 x" + n : "出千…但场上没有你的弹", "#34d399", 16);
      FX.flash(0.16, "52,211,153");
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.gm_roulette = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "roulCast"; s.t = 0;
      LD.Cine.start(f, sk.name, "", "#34d399");
      const foe = B.foeOf(f);
      const cx = foe ? foe.x : f.x, cy = foe ? foe.y : f.y;
      const n = sk.n || 6;
      const bigIdx = (Math.random() * n) | 0;
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), rr2 = rand(30, 240);
        const zx = clamp(cx + Math.cos(a) * rr2, 50, B.world.w - 50);
        const zy = clamp(cy + Math.sin(a) * rr2, B.world.pt, B.world.h - 46);
        B.zones.push({
          type: "roul", x: zx, y: zy, r: sk.r || 64,
          warn: (sk.warn || 1.0) + (i % 2) * 0.3,           // 一半格子提前亮出
          life: 0, max: 0.25, dmg: i === bigIdx ? sk.dmg : (sk.small || 6),
          big: i === bigIdx, owner: f, hits: {}
        });
      }
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 磁暴坦克：电弧 / 极性反转 / 电磁护盾 / 雷暴 ---- */
  IMPL.ts_zap = {
    start(f, slot, sk) {
      f.atkAnim = 0.2; f.atkDur = 0.2;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 10,
        vx: Math.cos(a) * (sk.speed || 1000), vy: Math.sin(a) * (sk.speed || 1000),
        r: sk.r || 6, dmg: sk.dmg, life: sk.life || 1.4, owner: f,
        color: "#a78bfa", core: "#ede9fe", type: "zap", kindTag: "basic", basic: true, trail: true
      });
      FX.burst(f.x + Math.cos(a) * 26, f.y - 26, 6, "#c4b5fd", { speed: 200, dir: a, spread: 0.5 });
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.ts_polar = {
    start(f, slot, sk) {
      f.atkAnim = 0.3; f.atkDur = 0.3;
      B.magnetT = sk.dur || 5;
      FX.ring(B.world.w / 2, (B.world.pt + B.world.h) / 2, 130, "rgba(167,139,250,.95)", 7, 0.6);
      FX.float(f.x, f.y - 84, "极性反转！", "#a78bfa", 17);
      B.ev.push(["h", f.x, f.y - 84, "极性反转！", "#a78bfa"]);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.ts_shield = {
    start(f, slot, sk) {
      f.atkAnim = 0.3; f.atkDur = 0.3;
      f.shield = Math.max(f.shield || 0, sk.shield || 60);
      f.shieldT = sk.dur || 6;
      f.shieldBoom = { R: sk.boomR || 130, dmg: sk.boomDmg || 10 };   // 破盾放电（见 B.shieldBreak）
      FX.ring(f.x, f.y - 26, 80, "rgba(196,181,253,.95)", 6, 0.5);
      FX.float(f.x, f.y - 80, "电磁护盾", "#c4b5fd", 15);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
  IMPL.ts_storm = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "stormCast"; s.t = 0;
      LD.Cine.start(f, sk.name, "", "#a78bfa");
      const foe = B.foeOf(f);
      const cx = foe ? foe.x : f.x, cy = foe ? foe.y : f.y;
      const n = sk.n || 10;
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), rr2 = rand(20, 300);
        B.zones.push({
          type: "bolt", x: clamp(cx + Math.cos(a) * rr2, 50, B.world.w - 50),
          y: clamp(cy + Math.sin(a) * rr2, B.world.pt, B.world.h - 46),
          r: sk.r || 56, warn: (sk.warn || 1.0) * (0.7 + 0.6 * Math.random()),
          life: 0, max: 0.2, dmg: sk.dmg, owner: f, hits: {}
        });
      }
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 巨龙：火球 / 爪击 / 爆裂火焰 ---- */
  IMPL.d_fireball = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      const foe = B.foeOf(f);
      const tx = foe ? foe.x : f.x - 100, ty = foe ? foe.y - 26 : f.y;
      s.on = true; s.phase = "dWindup"; s.t = 0;
      s.d.a = Math.atan2(ty - (f.y - 26), tx - f.x);
      f.charge = sk.windup; f.chargeMax = sk.windup;   // 龙眼变红 + 嘴部聚能，给玩家可读的前摇
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "dWindup") return;
      s.t += dt;
      const a = s.d.a;
      FX.trail(f.x + Math.cos(a) * (f.r + 10), f.y - 26 + Math.sin(a) * (f.r + 10), "#fb7185", 6, 0.25);
      if (s.t >= sk.windup) {
        f.charge = 0;
        const n = Math.max(1, f._burst || 1);
        for (let i = 0; i < n; i++) {
          const aa = a + (i - (n - 1) / 2) * 0.20;
          B.spawnProj({ x: f.x + Math.cos(aa) * (f.r + 12), y: f.y - 26 + Math.sin(aa) * (f.r + 12),
            vx: Math.cos(aa) * sk.speed, vy: Math.sin(aa) * sk.speed,
            r: sk.r, dmg: sk.dmg, life: 3.0, owner: f, color: "#fb7185", core: "#fff1f2",
            type: "fireball", kindTag: "basic", basic: true, trail: true });
        }
        FX.burst(f.x, f.y - 26, 14, ["#fb7185", "#fecdd3"], { speed: 180 });
        FX.shake(4);
        B.endSlot(f, slot, sk.cd * (f.rateM || 1));
      }
    }
  };

  IMPL.d_claw = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      const foe = B.foeOf(f);
      const a = foe ? Math.atan2(foe.y - f.y, foe.x - f.x) : Math.PI;
      s.on = true; s.phase = "windup"; s.t = 0;
      s.d = { a, tx: foe ? foe.x : f.x, ty: foe ? foe.y : f.y };
      f.telegraph = { x: s.d.tx, y: s.d.ty, r: sk.r, t: 0, max: sk.windup };
      FX.mark(s.d.tx, s.d.ty, sk.r, "rgba(251,113,133,.95)", sk.windup, "circle");
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase === "windup") {
        s.t += dt;
        if (f.telegraph) f.telegraph.t += dt;
        if (s.t >= sk.windup) {
          s.phase = "dash"; s.t = 0;
          f.telegraph = null;
          f.dashVX = Math.cos(s.d.a) * (sk.dash / sk.dashT);
          f.dashVY = Math.sin(s.d.a) * (sk.dash / sk.dashT);
          s.d.hit = false;
          FX.burst(f.x, f.y - 26, 20, ["#fb7185", "#fff"], { speed: 260, dir: s.d.a });
          FX.shake(10);
        }
      } else if (s.phase === "dash") {
        s.t += dt;
        f.x += f.dashVX * dt; f.y += f.dashVY * dt;
        FX.trail(f.x, f.y, "#fb7185", 12, 0.3);
        const foe = B.foeOf(f);
        if (foe && !foe.dead && !s.d.hit && dist(f, foe) < f.r + foe.r) {
          s.d.hit = true;
          B.damage(f, foe, sk.dmg, { type: "skill", kb: 360, stun: 0.25, from: f, dmgFromDragon: true });
        }
        if (s.t >= sk.dashT) { f.dashVX = 0; f.dashVY = 0; B.endSlot(f, slot, sk.cd * (f.rateM || 1)); }
      }
    }
  };

  IMPL.d_ult = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      s.on = true; s.phase = "fireCharge"; s.t = 0;
      LD.Cine.start(f, sk.name, "", "#fb923c");
      /* 同 voidSlash：蓄力在演出（战斗暂停）期间预支，演出一结束立刻落火柱 */
      f.chargeMax = sk.windup + 0.6; f.charge = sk.windup + 0.6;
      s.t = sk.windup + 0.6;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "fireCharge") { return; }
      s.t += dt; f.charge = Math.max(0, f.charge - dt);
      FX.trail(f.x + rand(-f.r, f.r), f.y - rand(0, f.r), "#fb923c", 5, 0.4);
      if (s.t >= sk.windup + 0.6) {
        s.phase = "pillars"; s.t = 0; s.d.n = 0; s.d.acc = 0;
        f.charge = 0;
        FX.shake(18); FX.flash(0.34, "255,170,90");
      }
    },
    after(f, slot, sk, dt) { }
  };

  // 火柱生成（在 update 中统一处理）
  B.updateDragonPillars = function (f, slot, sk, dt) {
    const s = f.slot[slot];
    if (s.phase !== "pillars") return;
    s.t += dt; s.d.acc += dt;
    const foe = B.foeOf(f);
    if (s.d.n < sk.pillars && s.d.acc >= sk.gap) {
      s.d.acc = 0; s.d.n++;
      const bx = foe ? foe.x : f.x - 200, by = foe ? foe.y : f.y;
      const px = clamp(bx + rand(-90, 90), 60, B.world.w - 60);
      const py = clamp(by + rand(-60, 60), B.world.pt + 14, B.world.h - 56);
      B.zones.push({ type: "pillar", x: px, y: py, r: sk.pillarR, life: 0, max: sk.dur, dmg: sk.dmg,
        owner: f, hit: false, color: "#fb923c", warn: sk.warn || 0.28 });
      FX.mark(px, py, sk.pillarR, "rgba(251,146,60,.95)", (sk.warn || 0.28) + sk.dur + 0.3, "circle");
      FX.shake(8);
    }
    if (s.d.n >= sk.pillars && s.t > sk.gap * sk.pillars + sk.dur) {
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };
})(window.LD = window.LD || {});
