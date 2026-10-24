/* ============================================================
 *  40a_skill.js - 英雄与通用技能实现（IMPL.slash … stealth / hbomb / shuriken / 火柱）
 *  自 40_battle.js 拆分（v4.12 工程债）。只搬代码，判定逻辑一行未改。
 *  依赖 10_data.js 建好的 LD.SKILL_IMPL 空表，本模块负责往里填招式。
 *  BOSS 与特殊单位招式已拆到 40a_boss.js；瞄准工具 aimAt / arcFX 留在文末并挂到 B 上复用。
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

  /* ==========================================================
   *  技能实现
   * ========================================================== */

  /* ---- 斩击 ---- */
  IMPL.slash = {
    start(f, slot, sk) {
      f.atkAnim = 0.34; f.atkDur = 0.34;
      f.facing = aimAt(f, this);
      const hit = B.melee(f, { reach: 66, half: 1.05, dmg: sk.dmg, type: "basic", kb: 190, basic: true });
      arcFX(f, "#7fe6f7", 68);
      if (hit) { /* 命中反馈已在 damage 内 */ }
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 远程普攻 ---- */
  IMPL.fireball = {
    start(f, slot, sk) {
      f.atkAnim = 0.26; f.atkDur = 0.26;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 22, y: f.y - 26 + Math.sin(a) * 12,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f,
        color: "#fb923c", core: "#fff3d6", type: "fireball", kindTag: "basic", basic: true, trail: true
      });
      FX.burst(f.x + Math.cos(a) * 24, f.y - 26, 8, "#fdba74", { speed: 130, dir: a });
      FX.shake(2);
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 手枪（远程普攻 · 直线高速） ---- */
  IMPL.pistol = {
    start(f, slot, sk) {
      f.atkAnim = 0.22; f.atkDur = 0.22;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 12,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f,
        color: "#fde68a", core: "#fffbeb", type: "bullet", kindTag: "basic", basic: true, trail: true
      });
      FX.burst(f.x + Math.cos(a) * 26, f.y - 26, 7, "#fef3c7", { speed: 190, dir: a, spread: 0.4 });
      FX.shake(2.5);
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 石头（远程普攻 · 命中眩晕） ---- */
  IMPL.rock = {
    start(f, slot, sk) {
      f.atkAnim = 0.26; f.atkDur = 0.26;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 22, y: f.y - 26 + Math.sin(a) * 12,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, stun: sk.stun,
        color: "#a8a29e", core: "#e7e5e4", type: "rock", kindTag: "basic", basic: true, trail: false
      });
      FX.burst(f.x + Math.cos(a) * 24, f.y - 26, 8, "#d6d3d1", { speed: 150, dir: a });
      FX.shake(2);
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 狼牙棒（近战普攻 · 0.3 秒前摇） ---- */
  IMPL.mace = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      s.on = true; s.phase = "maceWind"; s.t = 0;
      s.d.dir = { x: f.facing.x, y: f.facing.y };
      f.atkAnim = sk.windup + 0.16; f.atkDur = sk.windup + 0.16;
      FX.ring(f.x + f.facing.x * 30, f.y - 20 + f.facing.y * 14, 34, "rgba(251,146,60,.85)", 3, sk.windup);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "maceWind") return;
      s.t += dt;
      const p = Math.min(1, s.t / sk.windup);
      FX.trail(f.x + f.facing.x * 30 + rand(-6, 6), f.y - 34 + f.facing.y * 10, "#fb923c", 4, 0.2);
      if (s.t >= sk.windup) {
        f.facing = s.d.dir || f.facing;
        const hit = B.melee(f, { reach: sk.reach, half: sk.half, dmg: sk.dmg, type: "basic", kb: 260, basic: true, stun: sk.stun });
        arcFX(f, "#fb923c", sk.reach);
        FX.shake(hit ? 7 : 3);
        B.endSlot(f, slot, sk.cd);
      }
    }
  };

  /* ---- 格挡 ---- */
  IMPL.parry = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      s.on = true; s.phase = "parry"; s.t = 0;
      f.parryT = 0.36; f.parryHold = true;
      FX.ring(f.x, f.y - 26, 40, "rgba(160,230,255,.9)", 3, 0.22);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "parry") return;
      s.t += dt;
      if (s.t >= 0.36 || !f.parryHold) { f.parryT = 0; B.endSlot(f, slot, 2, { noShare: true }); }   // 空放 → 2 秒 CD
    }
  };

  /* ---- 位移斩（二段） ---- */
  IMPL.dashSlash = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      s.on = true; s.phase = "dash"; s.t = 0;
      s.d = { sx: f.x, sy: f.y, dir: { x: f.facing.x, y: f.facing.y }, hit: {}, back: false };
      f.invuln = Math.max(f.invuln, sk.invuln);
      f.atkAnim = sk.dashT + 0.08; f.atkDur = sk.dashT + 0.08;
      FX.burst(f.x, f.y - 26, 14, "#a5f3fc", { speed: 200, dir: Math.atan2(-f.facing.y, -f.facing.x), spread: 1.4 });
      FX.shake(C.shake.dash);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot], d = s.d;
      if (s.phase === "dash") {
        s.t += dt;
        const p = Math.min(1, s.t / sk.dashT);
        let tx, ty;
        if (d.back) {
          // 二段：从当前位置直线滑回起手原位（不再反向多闪一段）
          tx = d.bx + (d.sx - d.bx) * p;
          ty = d.by + (d.sy - d.by) * p;
        } else {
          tx = d.sx + d.dir.x * sk.dash * p;
          ty = d.sy + d.dir.y * sk.dash * p;
        }
        FX.trail(f.x, f.y, "#7fe6f7", 7, 0.3);
        f.x = tx; f.y = ty;
        // 路径伤害：一段与二段（回原位）都对路径上的所有敌人各结算一次
        for (const o of B.fighters) {
          if (o === f || o.dead || o.kind !== "hero" || B.sameTeam(f, o)) continue;
          if (d.hit[o.side]) continue;
          if (dist(f, o) < 44 + o.r) {
            d.hit[o.side] = 1;
            B.damage(f, o, sk.dmg, { type: "skill", kb: 150, from: f, hitDir: Math.atan2(o.y - f.y, o.x - f.x) });
          }
        }
        if (p >= 1) {
          if (!d.back) { s.phase = "second"; s.t = 0; d.secondLeft = sk.second; }
          else { B.endSlot(f, slot, sk.cd); }
        }
      } else if (s.phase === "second") {
        s.t += dt; d.secondLeft -= dt;
        if (d.secondLeft <= 0) B.endSlot(f, slot, sk.cd);
      }
    },
    again(f, slot, sk) {
      const s = f.slot[slot];
      if (s.phase !== "second") return false;
      s.phase = "dash"; s.t = 0; s.d.back = true; s.d.hit = {};
      s.d.bx = f.x; s.d.by = f.y;              // 回程起点 = 当前位置，终点 = 起手原位
      f.invuln = Math.max(f.invuln, sk.invuln);
      f.atkAnim = sk.dashT + 0.08; f.atkDur = sk.dashT + 0.08;
      FX.ring(f.x, f.y - 26, 46, "rgba(34,211,238,.9)", 3, 0.25);
      return true;
    }
  };

  /* ---- 激光波 ---- */
  IMPL.laserWave = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      s.on = true; s.phase = "laserCharge"; s.t = 0;
      s.d.a = Math.atan2(f.facing.y, f.facing.x);   // 出手瞬间锁定角度，蓄力期间不再读取实时朝向
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (!s.on) return;   // 修复：槽位结束后 update 仍被主循环调用，
                           // else 分支会每 0.22s 把 CD 重置回满 → CD 永远卡在 7.5
      s.t += dt;
      const a = s.d.a;
      if (s.phase === "laserCharge") {
        FX.trail(f.x + Math.cos(a) * 34, f.y - 26, "#67e8f9", 6, 0.2);
        if (s.t >= sk.charge) {
          s.phase = "laserFire"; s.t = 0;
          const x0 = f.x + Math.cos(a) * 34, y0 = f.y - 26 + Math.sin(a) * 16;
          const x1 = x0 + Math.cos(a) * sk.range, y1 = y0 + Math.sin(a) * sk.range;
          B.zones.push({ type: "beam", x0, y0, x1, y1, w: sk.width, life: 0, max: 0.22, dmg: sk.dmg, owner: f, half: sk.width / 2, color: "#67e8f9" });
          FX.shake(13); FX.hitstop(0.06); FX.flash(0.2, "120,230,255");
          const foe = B.foeOf(f);
          if (foe && !foe.dead && segHit(x0, y0, x1, y1, foe, sk.width / 2)) {
            B.damage(f, foe, sk.dmg, { type: "skill", kb: 300, from: f, hitDir: a });
          }
          FX.burst(x0, y0, 22, ["#e0fbff", "#67e8f9"], { speed: 260, dir: a, spread: 0.7 });
        }
      } else if (s.t >= 0.22) {
        B.endSlot(f, slot, sk.cd);
      }
    },
    tele(f, slot, sk) {   // 供渲染取预警信息
      const s = f.slot[slot];
      if (s.phase !== "laserCharge") return null;
      return { a: s.d.a, x: f.x, y: f.y - 26, r: sk.range, w: sk.width, p: s.t / sk.charge };
    }
  };

  /* ---- 风刃 ---- */
  IMPL.windBlade = {
    start(f, slot, sk) {
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({ x: f.x + Math.cos(a) * 26, y: f.y - 26 + Math.sin(a) * 14,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, color: "#a7f3d0", core: "#ecfdf5",
        type: "wind", root: sk.root, kindTag: "skill", trail: false });
      f.atkAnim = 0.3; f.atkDur = 0.3;
      FX.burst(f.x + Math.cos(a) * 28, f.y - 26, 14, ["#a7f3d0", "#d1fae5"], { speed: 180, dir: a });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 冥思 ---- */
  IMPL.meditate = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "meditate"; s.t = 0;
      f.meditate = 1;
    },
    release(f, slot, sk) {
      const s = f.slot[slot];
      if (s.phase === "meditate") { f.meditate = 0; B.endSlot(f, slot, sk.cd); }
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "meditate") return;
      s.t += dt;
      f.meditate = 1;
      const before = f.hp;
      f.hp = Math.min(f.maxHp, f.hp + sk.heal * dt);
      if (Math.floor(s.t * 2) !== Math.floor((s.t - dt) * 2)) {
        FX.float(f.x, f.y - 52, "+" + Math.round(sk.heal * 0.5), "#34d399", 12);
      }
      if (s.t % 0.12 < dt) FX.trail(f.x + rand(-16, 16), f.y - rand(0, 40), "#34d399", 3, 0.6);
    }
  };

  /* ---- 岩土盾 ---- */
  IMPL.rockShield = {
    start(f, slot, sk) {
      f.shield = sk.shield; f.shieldT = sk.dur;
      FX.ring(f.x, f.y - 26, 66, "rgba(252,211,77,.95)", 5, 0.4);
      FX.burst(f.x, f.y - 26, 20, ["#fcd34d", "#a16207"], { speed: 190, dir: -Math.PI / 2, spread: 2 });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 神龙掌 ---- */
  IMPL.dragonPalm = {
    start(f, slot, sk) {
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({ x: f.x + Math.cos(a) * 40, y: f.y - 26 + Math.sin(a) * 20,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, color: "#fbbf24", core: "#fff7d6",
        type: "palm", absorb: sk.absorb, kindTag: "skill", scale: 1 });
      f.atkAnim = 0.36; f.atkDur = 0.36;
      FX.burst(f.x + Math.cos(a) * 42, f.y - 26, 18, ["#fbbf24", "#fde68a"], { speed: 170, dir: a });
      FX.shake(5);
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 肉弹冲击 ---- */
  IMPL.meatRush = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "rush"; s.t = 0;
      f.buff.rush = sk.dur;
      FX.ring(f.x, f.y - 26, 70, "rgba(251,191,36,.95)", 5, 0.4);
      FX.shake(7);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "rush") return;
      s.t += dt;
      /* 加速 buff 严格跟随技能剩余时间：撞到人提前结束、到 3 秒正常结束，都不会再拖尾 */
      f.buff.rush = Math.max(0, sk.dur - s.t);
      FX.trail(f.x + rand(-12, 12), f.y - rand(4, 34), "#fbbf24", 5, 0.35);
      const foe = B.foeOf(f);
      if (foe && !foe.dead && dist(f, foe) < f.r + foe.r + 6) {
        B.damage(f, foe, sk.dmg, { type: "skill", stun: sk.stun, kb: 300, from: f });
        FX.ring(foe.x, foe.y - 26, 80, "rgba(251,191,36,.9)", 5, 0.4);
        f.buff.rush = 0;
        B.endSlot(f, slot, sk.cd);
        return;
      }
      if (s.t >= sk.dur) { f.buff.rush = 0; B.endSlot(f, slot, sk.cd); }
    }
  };

  /* ---- 瞬身 ---- */
  IMPL.blink = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "blinkCharge"; s.t = 0;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "blinkCharge") return;
      s.t += dt;
      FX.trail(f.x + rand(-14, 14), f.y - rand(0, 42), "#f87171", 4, 0.4);
      if (s.t >= sk.charge) {
        const foe = B.foeOf(f);
        const from = { x: f.x, y: f.y };
        if (foe) {
          const a = Math.atan2(f.y - foe.y, f.x - foe.x);
          f.x = clamp(foe.x + Math.cos(a) * 40, 40, B.world.w - 40);
          f.y = clamp(foe.y + Math.sin(a) * 40, B.world.pt, B.world.h - 46);
          f.facing = { x: Math.cos(a + Math.PI), y: Math.sin(a + Math.PI) };
        }
        FX.burst(from.x, from.y - 26, 20, ["#f87171", "#fecaca"], { speed: 240 });
        FX.burst(f.x, f.y - 26, 24, ["#f87171", "#fff"], { speed: 260 });
        FX.ring(f.x, f.y - 26, 70, "rgba(248,113,113,.95)", 5, 0.35);
        FX.shake(9); FX.hitstop(0.05);
        f.atkAnim = 0.34; f.atkDur = 0.34;
        if (foe && !foe.dead && dist(f, foe) < 70 + foe.r) B.damage(f, foe, sk.dmg, { type: "skill", kb: 200, from: f });
        /* 瞬身改版：瞬移后获得护盾（吸收 20 点伤害，持续 2 秒） */
        f.shield = Math.max(f.shield, sk.shield || 20);
        f.shieldT = Math.max(f.shieldT, sk.shieldT || 2);
        FX.ring(f.x, f.y - 26, 54, "rgba(252,211,77,.9)", 4, 0.5);
        FX.float(f.x, f.y - 60, "护盾 " + (sk.shield || 20), "#fcd34d", 13);
        B.endSlot(f, slot, sk.cd);
      }
    }
  };

  /* ---- 替身 ---- */
  IMPL.substitute = {
    start(f, slot, sk) {
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x) + Math.PI;
      const ex = clamp(f.x + Math.cos(a) * sk.back, 40, B.world.w - 40);
      const ey = clamp(f.y + Math.sin(a) * sk.back, B.world.pt, B.world.h - 46);
      const bx = f.x, by = f.y;
      f.x = ex; f.y = ey;
      f.invuln = Math.max(f.invuln, 0.24);
      FX.burst(bx, by - 26, 16, ["#c4b5fd", "#fff"], { speed: 200 });
      FX.burst(ex, ey - 26, 12, ["#c4b5fd"], { speed: 160 });
      B.projs.push({ x: bx, y: by - 22, vx: 0, vy: 0, r: 12, dmg: 0, owner: f, side: f.side, life: 0,
        maxLife: sk.fuse, color: "#a78bfa", core: "#ede9fe", type: "bomb", pierce: false, reflect: false,
        absorb: 0, absorbed: 0, tick: 0, tickMax: 0, hits: {}, data: { fuse: sk.fuse, boom: sk.dmg, R: sk.bombR, stun: sk.stun || 0 }, scale: 1, trail: false, spin: 0, stun: 0, blind: 0, kindTag: "skill" });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 飞雷神（二段：飞镖 → 闪身爆炸） ---- */
  IMPL.flyingRaijin = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      s.on = true; s.phase = "dart"; s.t = 0;
      const dart = B.spawnProj({
        x: f.x + Math.cos(a) * 26, y: f.y - 26 + Math.sin(a) * 14,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: 0, life: sk.proj.life, owner: f, pierce: true,
        color: "#c4b5fd", core: "#f5f3ff", type: "dart", kindTag: "skill", trail: true
      });
      s.d.p = dart;
      f.atkAnim = 0.28; f.atkDur = 0.28;
      FX.burst(f.x + Math.cos(a) * 28, f.y - 26, 10, ["#c4b5fd", "#fff"], { speed: 200, dir: a });
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "dart") return;
      s.t += dt;
      const alive = s.d.p && B.projs.indexOf(s.d.p) >= 0;
      if (!alive || s.t >= sk.proj.life + 0.6) {       // 飞镖已到尽头 / 超时 → 技能结束
        B.endSlot(f, slot, sk.cd * 0.45);
      }
    },
    again(f, slot, sk) {
      const s = f.slot[slot];
      if (s.phase !== "dart" || !s.d.p) return false;
      const p = s.d.p, i = B.projs.indexOf(p);
      if (i >= 0) B.projs.splice(i, 1);
      const bx = f.x, by = f.y;
      f.x = clamp(p.x, 40, B.world.w - 40);
      f.y = clamp(p.y + 26, B.world.pt, B.world.h - 40);
      f.invuln = Math.max(f.invuln, 0.12);
      FX.burst(bx, by - 26, 18, ["#c4b5fd", "#fff"], { speed: 220 });
      FX.ring(f.x, f.y - 26, 70, "rgba(167,139,250,.95)", 5, 0.35);
      FX.burst(f.x, f.y - 26, 26, ["#a78bfa", "#fff", "#ddd6fe"], { speed: 300 });
      FX.shake(11); FX.hitstop(0.05); FX.flash(0.14, "190,160,255");
      FX.float(f.x, f.y - 60, "飞雷神！", "#c4b5fd", 16);
      const R = sk.boomR || 78;
      B.fighters.forEach(o => {
        if (o === f || o.dead || B.sameTeam(f, o)) return;
        if (Math.hypot(o.x - f.x, (o.y - 26) - (f.y - 26)) <= R + o.r)
          B.damage(f, o, sk.dmg, { type: "skill", kb: 280, from: f, hitDir: Math.atan2(o.y - f.y, o.x - f.x) });
      });
      B.endSlot(f, slot, sk.cd);
      return true;
    }
  };

  /* ---- 粪击（命中致盲） ---- */
  IMPL.dung = {
    start(f, slot, sk) {
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 30, y: f.y - 26 + Math.sin(a) * 16,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, blind: sk.blind,
        color: "#92400e", core: "#d97706", type: "dung", kindTag: "skill", trail: true
      });
      f.atkAnim = 0.3; f.atkDur = 0.3;
      FX.burst(f.x + Math.cos(a) * 32, f.y - 26, 12, ["#92400e", "#a16207"], { speed: 160, dir: a });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 手里剑（v3.9.1 停电夜战的固定 K 技能）----
   * 蓄力 0.7 秒（原地定身，起手方向即出手方向）后高速掷出大型飞镖，
   * 命中第一个敌人造成 26 伤害 + 0.6 秒失明。飞镖不穿透。 */
  /* 手里剑（停电夜战 K 技能）。id 用 shurikenToss：shuriken 已被大招「螺旋手里剑」占用。 */
  IMPL.shurikenToss = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      s.on = true; s.phase = "shuWind"; s.t = 0;
      s.d.dir = { x: f.facing.x, y: f.facing.y };
      /* 蓄力期间定身：这是「交出去」的一击，起手能被读到、也能被抓 */
      f.root = Math.max(f.root || 0, sk.windup);
      f.atkAnim = sk.windup + 0.16; f.atkDur = sk.windup + 0.16;
      FX.ring(f.x + f.facing.x * 26, f.y - 26 + f.facing.y * 14, 32, "rgba(103,232,249,.9)", 3, sk.windup);
      FX.float(f.x, f.y - 78, "蓄力", "#67e8f9", 13);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "shuWind") return;
      s.t += dt;
      if (Math.random() < dt * 14) FX.trail(f.x + rand(-10, 10), f.y - 30 + rand(-6, 14), "#67e8f9", 4, 0.26);
      if (s.t < sk.windup) return;
      s.phase = "shuDone";
      const d = s.d.dir || f.facing;
      const a = Math.atan2(d.y, d.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 28, y: f.y - 26 + Math.sin(a) * 14,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, blind: sk.blind,
        color: "#22d3ee", core: "#ecfeff", type: "shuriken", kindTag: "skill", trail: true
      });
      FX.burst(f.x + Math.cos(a) * 30, f.y - 26 + Math.sin(a) * 14, 12, ["#67e8f9", "#fff"], { speed: 200, dir: a });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 嗜血斩 ---- */
  IMPL.bloodSlash = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      s.on = true; s.phase = "bdash"; s.t = 0;
      s.d = { sx: f.x, sy: f.y, dir: { x: f.facing.x, y: f.facing.y }, hit: false };
      f.hp = Math.max(0, f.hp - sk.selfCost);
      FX.float(f.x, f.y - 52, "-" + sk.selfCost, "#f87171", 14);
      FX.burst(f.x, f.y - 26, 16, ["#ef4444", "#fecaca"], { speed: 200 });
      f.atkAnim = sk.dashT + 0.16; f.atkDur = sk.dashT + 0.16;
      if (f.hp <= 0) { B.kill(f, null); return; }
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot], d = s.d;
      if (s.phase !== "bdash") return;
      s.t += dt;
      const p = Math.min(1, s.t / sk.dashT);
      FX.trail(f.x, f.y, "#ef4444", 8, 0.34);
      f.x = d.sx + d.dir.x * sk.dash * p;
      f.y = d.sy + d.dir.y * sk.dash * p;
      const foe = B.foeOf(f);
      if (foe && !foe.dead && !d.hit && dist(f, foe) < 46 + foe.r) {
        d.hit = true;
        B.damage(f, foe, sk.dmg, { type: "skill", kb: 120, from: f, heal: sk.heal });
        FX.ring(foe.x, foe.y - 26, 84, "rgba(239,68,68,.9)", 6, 0.4);
      }
      if (p >= 1) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 冰霜行者：4 秒内走过的地方结冰痕，踩上持续冻伤 + 减速 ---- */
  IMPL.frostWalk = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "frost"; s.t = 0;
      s.d.acc = 0; s.d.lx = null; s.d.ly = null;
      FX.ring(f.x, f.y - 20, 60, "rgba(147,197,253,.95)", 4, 0.5);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "frost") return;
      s.t += dt; s.d.acc += dt;
      FX.trail(f.x + rand(-10, 10), f.y + rand(-2, 6), "#93c5fd", 4, 0.4);
      /* 只有离上一块冰痕足够远才铺新的：原地站着不会把伤害叠上天 */
      const far = s.d.lx == null || Math.hypot(f.x - s.d.lx, f.y - s.d.ly) >= sk.zoneR * 1.6;
      if (s.d.acc >= 0.12 && far) {
        s.d.acc = 0; s.d.lx = f.x; s.d.ly = f.y;
        B.zones.push({ type: "frost", x: f.x, y: f.y, r: sk.zoneR, life: 0, max: sk.zoneLife,
          owner: f, hits: {}, color: "#93c5fd" });
      }
      if (s.t >= sk.dur) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 苍：把范围内敌人吸到自己身边 + 减速 ---- */
  IMPL.cang = {
    start(f, slot, sk) {
      const R = sk.range;
      FX.ring(f.x, f.y - 24, R, "rgba(103,232,249,.9)", 6, 0.45);
      FX.ring(f.x, f.y - 24, R * 0.6, "rgba(165,243,252,.95)", 5, 0.4);
      FX.shake(6);
      B.fighters.forEach(o => {
        if (o === f || o.dead || o.kind !== "hero" || B.sameTeam(f, o)) return;
        if (dist(f, o) > R + o.r) return;
        const a = Math.atan2(o.y - f.y, o.x - f.x);
        const tx = clamp(f.x + Math.cos(a) * (f.r + o.r + 6), 40, B.world.w - 40);
        const ty = clamp(f.y + Math.sin(a) * (f.r + o.r + 6), B.world.pt, B.world.h - 40);
        /* v3.1：吸引路径被墙体截断 → 停在墙前并额外受 18 伤害 */
        const blocked = (B.terrain && LD.Terrain.losHit(B.terrain, o.x, o.y - 20, tx, ty - 20, 0)) || B.hitWallAt(o, tx, ty);
        if (blocked) {
          /* 沿路径回退到最后一个不撞墙的点 */
          let px = o.x, py = o.y;
          for (let s2 = 1; s2 <= 12; s2++) {
            const qx = o.x + (tx - o.x) * s2 / 12, qy = o.y + (ty - o.y) * s2 / 12;
            if (B.hitWallAt(o, qx, qy)) break;
            px = qx; py = qy;
          }
          o.x = px; o.y = py;
          FX.float(o.x, o.y - 60, "撞墙 +" + (sk.wallDmg || 18), "#f87171", 15);
          B.damage(f, o, sk.wallDmg || 18, { type: "skill", kb: 0, from: f });
        } else {
          o.x = tx; o.y = ty;
        }
        o.slowT = Math.max(o.slowT || 0, sk.slow);
        B.damage(f, o, sk.dmg, { type: "skill", kb: 0, from: f });
        FX.burst(o.x, o.y - 26, 12, ["#67e8f9", "#fff"], { speed: 180 });
      });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 赫：范围强击飞（固定距离位移，无撞墙惩罚） ---- */
  IMPL.he = {
    start(f, slot, sk) {
      const R = sk.range;
      FX.ring(f.x, f.y - 24, R, "rgba(248,113,113,.95)", 7, 0.45);
      FX.ring(f.x, f.y - 24, R * 0.55, "rgba(254,202,202,.9)", 5, 0.35);
      FX.shake(12); FX.flash(0.12, "255,120,120");
      B.fighters.forEach(o => {
        if (o === f || o.dead || o.kind !== "hero" || B.sameTeam(f, o)) return;
        if (dist(f, o) > R + o.r) return;
        B.damage(f, o, sk.dmg, { type: "skill", kbDist: sk.kbDist || 400, wallHit: true, from: f,
          hitDir: Math.atan2(o.y - f.y, o.x - f.x) });
        FX.ring(o.x, o.y - 30, 60, "rgba(248,113,113,.85)", 5, 0.35);
      });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 回旋镖：中速掷出 → 尽头高速折返追踪主人，回手才进 CD ---- */
  IMPL.boomerang = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      s.on = true; s.phase = "boom"; s.t = 0;
      const p = B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 14,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, pierce: true, boomerang: true,
        color: "#a3e635", core: "#f7fee7", type: "boomerang", kindTag: "skill", trail: true,
        data: { phase: "out", ox: f.x, oy: f.y - 26, maxDist: sk.maxDist, backSpeed: sk.backSpeed, backDmg: sk.backDmg }
      });
      s.d.p = p;
      f.atkAnim = 0.26; f.atkDur = 0.26;
      FX.burst(f.x + Math.cos(a) * 26, f.y - 26, 8, ["#a3e635", "#fff"], { speed: 160, dir: a });
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "boom") return;
      s.t += dt;
      const p = s.d.p;
      const alive = p && B.projs.indexOf(p) >= 0;
      if (!alive) { B.endSlot(f, slot, sk.cd); return; }   // 被弹反等情况：直接结束进 CD
      if (p.data.phase === "out") {
        p.dmg = sk.dmg;
        const dx = p.x - p.data.ox, dy = p.y - p.data.oy;
        if (Math.hypot(dx, dy) >= p.data.maxDist) {        // 到尽头 → 高速折返
          p.data.phase = "back";
          p.hits = {};                                     // 回程可再次造成伤害
          FX.ring(p.x, p.y, 40, "rgba(163,230,53,.9)", 4, 0.3);
        }
      } else {
        p.dmg = p.data.backDmg != null ? p.data.backDmg : sk.backDmg;
        const a = Math.atan2((f.y - 26) - p.y, f.x - p.x); // 始终追踪释放者
        p.vx = Math.cos(a) * p.data.backSpeed;
        p.vy = Math.sin(a) * p.data.backSpeed;
        if (Math.hypot(f.x - p.x, (f.y - 26) - p.y) < 24 + f.r) {   // 回到手上 → 进 CD
          B.projs.splice(B.projs.indexOf(p), 1);
          FX.burst(f.x, f.y - 26, 10, ["#a3e635", "#fff"], { speed: 150 });
          B.endSlot(f, slot, sk.cd);
        }
      }
      if (s.t >= sk.proj.life + 0.5) {                    // 兜底超时
        const i = B.projs.indexOf(p);
        if (i >= 0) B.projs.splice(i, 1);
        B.endSlot(f, slot, sk.cd);
      }
    }
  };

  /* ---- 火男：4 秒内周身燃焰，近身敌人持续掉血（zone 跟随，可同步到客机） ---- */
  IMPL.fireAura = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "fire"; s.t = 0;
      B.zones.push({ type: "fire", x: f.x, y: f.y, r: sk.auraR, life: 0, max: sk.dur,
        owner: f, hits: {}, dmg: sk.tickDmg, tick: sk.tick });
      FX.ring(f.x, f.y - 20, sk.auraR, "rgba(251,146,60,.95)", 6, 0.5);
      FX.float(f.x, f.y - 60, "烈焰缠身！", "#fb923c", 15);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "fire") return;
      s.t += dt;
      if (s.t >= sk.dur) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 隐匿：4 秒隐身，第 2 秒闪现 0.4 秒原形，攻击提前现形 ---- */
  IMPL.stealth = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "stealth"; s.t = 0;
      f.stealthT = sk.dur; f.stealthSlot = slot;
      FX.ring(f.x, f.y - 20, 70, "rgba(196,181,253,.9)", 5, 0.5);
      FX.burst(f.x, f.y - 26, 18, ["#c4b5fd", "#fff"], { speed: 200 });
      FX.float(f.x, f.y - 60, "隐匿！", "#c4b5fd", 15);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "stealth") return;
      s.t += dt;
      f.stealthT = Math.max(0, sk.dur - s.t);
      if (s.t >= sk.dur) { f.stealthT = 0; B.endSlot(f, slot, sk.cd); B.stealthShield(f, sk); }
    }
  };
  /* 隐匿结束（自然到期或主动现形）→ 获得 14 点 / 2 秒护盾 */
  B.stealthShield = function (f, sk) {
    const amt = (sk && sk.shield) || 14, dur = (sk && sk.shieldT) || 2.0;
    f.shield = Math.max(f.shield, amt);
    f.shieldT = Math.max(f.shieldT, dur);
    FX.ring(f.x, f.y - 26, 54, "rgba(147,197,253,.9)", 4, 0.5);
    FX.float(f.x, f.y - 60, "护盾 " + amt, "#93c5fd", 13);
  };
  B.breakStealth = function (f, forced) {
    if (f.stealthT <= 0) return;
    const sk = f.loadout && LD.skill(f.loadout[f.stealthSlot || "skill1"]);
    f.stealthT = 0;
    B.endSlot(f, f.stealthSlot || "skill1", sk ? sk.cd : 8);
    FX.burst(f.x, f.y - 26, 14, ["#c4b5fd", "#fff"], { speed: 180 });
    FX.float(f.x, f.y - 58, "现形！", "#c4b5fd", 14);
    B.stealthShield(f, sk);
  };

  /* ---- 高压炸弹：掏出 4 秒倒计时炸弹，再按扔出，归零爆炸（会炸到自己） ---- */
  IMPL.hbomb = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "hbombHold"; s.t = 0;
      s.d.timer = sk.fuse;
      FX.float(f.x, f.y - 60, "倒计时 " + sk.fuse + "s", "#fbbf24", 14);
    },
    again(f, slot, sk) {
      const s = f.slot[slot];
      if (s.phase !== "hbombHold") return false;
      const a0 = Math.atan2(f.facing.y, f.facing.x);
      const spd = sk.throwSpd || 430;
      const p = B.spawnProj({
        x: f.x + Math.cos(a0) * 24, y: f.y - 26,
        vx: Math.cos(a0) * spd, vy: Math.sin(a0) * spd,
        r: 12, dmg: sk.dmg, life: sk.fuse, maxLife: sk.fuse + 2, owner: f,
        color: "#fbbf24", core: "#fef3c7", type: "hbomb", kindTag: "skill",
        data: { timer: s.d.timer, fuse: sk.fuse, boomR: sk.boomR, dmg: sk.dmg, selfDmg: sk.selfDmg || 20, throwDamp: sk.throwDamp || 1.05 }
      });
      s.d.p = p;
      B.endSlot(f, slot, sk.cd);
      FX.float(f.x, f.y - 56, "扔出！", "#fbbf24", 13);
      return true;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "hbombHold") return;
      s.t += dt; s.d.timer -= dt;
      if (s.d.timer <= 0) {                 // 留在手里 → 当场自爆
        B.hbombBoom(f, f.x, f.y - 26, sk);
        B.endSlot(f, slot, sk.cd);
      }
    }
  };
  /* 高压炸弹爆炸：敌人吃全额伤害，释放者自己只吃 selfDmg（20），不伤同阵营队友 */
  B.hbombBoom = function (owner, x, y, sk) {
    const R = sk.boomR, dmg = sk.dmg, selfDmg = sk.selfDmg != null ? sk.selfDmg : dmg;
    FX.ring(x, y, R, "rgba(251,191,36,.95)", 8, 0.55);
    FX.burst(x, y, 34, ["#fbbf24", "#fff", "#fb923c"], { speed: 340 });
    FX.shake(14); FX.flash(0.2, "255,210,120");
    for (const f of B.fighters) {
      if (f.dead || f.kind !== "hero") continue;
      if (f !== owner && B.sameTeam(owner, f)) continue;
      if (Math.hypot(f.x - x, (f.y - 26) - y) <= R + f.r) {
        B.damage(owner, f, f === owner ? selfDmg : dmg, { type: "skill", kb: 320, from: owner, hitDir: Math.atan2(f.y - 26 - y, f.x - x) });
      }
    }
    if (B.terrain) LD.Terrain.blast(B.terrain, x, y, R, dmg * 0.9);
    B.ev.push(["x", x, y, R]);
  };

  /* ---- 穿云箭：一箭 15，命中前再按散成 6 箭（各 6 伤，飞 500） ---- */
  IMPL.splitArrow = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "arrow"; s.t = 0;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      const p = B.spawnProj({
        x: f.x + Math.cos(a) * 26, y: f.y - 26 + Math.sin(a) * 14,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, maxLife: sk.proj.life + 2, owner: f,
        color: "#fde68a", core: "#fffbeb", type: "arrow", kindTag: "skill", trail: true,
        data: { split: true, splitDmg: sk.splitDmg, splitN: sk.splitN, splitLife: sk.splitLife }
      });
      s.d.p = p;
      f.atkAnim = 0.22; f.atkDur = 0.22;
      FX.burst(f.x + Math.cos(a) * 28, f.y - 26, 8, ["#fde68a", "#fff"], { speed: 170, dir: a });
    },
    again(f, slot, sk) {
      const s = f.slot[slot];
      if (s.phase !== "arrow") return false;
      const p = s.d.p;
      const alive = p && B.projs.indexOf(p) >= 0;
      if (!alive) return false;
      const a0 = Math.atan2(p.vy, p.vx);
      const sp = Math.hypot(p.vx, p.vy);
      B.projs.splice(B.projs.indexOf(p), 1);
      for (let i = 0; i < sk.splitN; i++) {
        const a = a0 + (i - (sk.splitN - 1) / 2) * 0.16;
        B.spawnProj({
          x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          r: sk.proj.r * 0.8, dmg: sk.splitDmg, life: sk.splitLife / sp, maxLife: sk.splitLife / sp + 2,
          owner: f, color: "#fef08a", core: "#fff", type: "sarrow", kindTag: "skill", trail: true, data: {}
        });
      }
      FX.burst(p.x, p.y, 16, ["#fde68a", "#fff"], { speed: 220 });
      FX.float(p.x, p.y - 30, "散箭！", "#fde68a", 14);
      B.endSlot(f, slot, sk.cd);
      return true;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "arrow") return;
      const p = s.d.p;
      if (!p || B.projs.indexOf(p) < 0) B.endSlot(f, slot, sk.cd);   // 已命中 / 消失
    }
  };

  /* ---- 钩索：钩中 22 伤 + 0.6s 眩晕，把对手拖回最多 700 距离 ---- */
  IMPL.hook = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "hookFly"; s.t = 0;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      const p = B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 14,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, maxLife: sk.proj.life + 2, owner: f,
        color: "#94a3b8", core: "#e2e8f0", type: "hook", kindTag: "skill",
        data: { pull: sk.pullDist, stun: sk.stun, ox: f.x, oy: f.y }
      });
      s.d.p = p;
      f.atkAnim = 0.24; f.atkDur = 0.24;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "hookFly") return;
      const p = s.d.p;
      if (!p || B.projs.indexOf(p) < 0) B.endSlot(f, slot, sk.cd);   // 已命中 / 消失
    }
  };

  /* ---- v3.1 僵尸突刺：向前小突进 + 沿途多段伤害 ---- */
  IMPL.z_lunge = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      s.on = true; s.phase = "lunge"; s.t = 0;
      s.d = { sx: f.x, sy: f.y, dir: { x: f.facing.x, y: f.facing.y }, tickT: 0, hits: 0 };
      f.atkAnim = (sk.dashT || 0.28) + 0.08; f.atkDur = (sk.dashT || 0.28) + 0.08;
      FX.burst(f.x, f.y - 26, 10, ["#a3e635", "#4d7c0f"],
        { speed: 180, dir: Math.atan2(-f.facing.y, -f.facing.x), spread: 1.1 });
      FX.float(f.x, f.y - 62, "突刺！", "#a3e635", 14);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot], d = s.d;
      if (s.phase !== "lunge") return;
      s.t += dt;
      const p = Math.min(1, s.t / (sk.dashT || 0.28));
      f.x = d.sx + d.dir.x * (sk.dash || 130) * p;
      f.y = d.sy + d.dir.y * (sk.dash || 130) * p;
      FX.trail(f.x, f.y, "#a3e635", 6, 0.24);
      /* 多段：每 gap 秒结算一段（最多 hits 段），空挥不消耗段数，段内命中所有贴身敌人 */
      d.tickT -= dt;
      if (d.tickT <= 0 && d.hits < (sk.hits || 3)) {
        d.tickT = sk.gap || 0.09;
        let hitAny = false;
        for (const o of B.fighters) {
          if (o === f || o.dead || B.sameTeam(f, o)) continue;
          if (dist(f, o) > (sk.reach || 46) + o.r) continue;
          hitAny = true;
          B.damage(f, o, sk.dmg, { type: "skill", kb: sk.kb || 55, from: f,
            hitDir: Math.atan2(o.y - f.y, o.x - f.x) });
        }
        if (hitAny) d.hits++;
      }
      if (p >= 1) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- v3.1 僵尸撕咬：前摇 0.18s，咬住前方敌人 → 少量伤害 + 定身 2s ---- */
  IMPL.z_bite = {
    start(f, slot, sk) {
      const s = f.slot[slot];
      f.facing = aimAt(f, this);
      s.on = true; s.phase = "biteWind"; s.t = 0;
      f.atkAnim = (sk.windup || 0.18) + 0.22; f.atkDur = (sk.windup || 0.18) + 0.22;
      const a = Math.atan2(f.facing.y, f.facing.x);
      FX.ring(f.x + Math.cos(a) * 30, f.y - 26 + Math.sin(a) * 16, 26, "rgba(163,230,53,.9)", 3, 0.16);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "biteWind") return;
      s.t += dt;
      if (s.t < (sk.windup || 0.18)) return;
      s.phase = "biteDone";
      const a = Math.atan2(f.facing.y, f.facing.x);
      const reach = sk.range || 82, half = sk.half || 1.0;
      let bit = false;
      for (const o of B.fighters) {
        if (o === f || o.dead || B.sameTeam(f, o)) continue;
        const dx = o.x - f.x, dy = o.y - f.y;
        if (Math.hypot(dx, dy) > reach + o.r) continue;
        const rel = Math.atan2(Math.sin(Math.atan2(dy, dx) - a), Math.cos(Math.atan2(dy, dx) - a));
        if (Math.abs(rel) > half) continue;
        bit = true;
        B.damage(f, o, sk.dmg, { type: "skill", kb: 20, from: f, hitDir: a });
        o.root = Math.max(o.root || 0, sk.root || 2);
        FX.float(o.x, o.y - 62, "被咬住！定身 " + (sk.root || 2) + "s", "#a3e635", 15);
        FX.burst(o.x, o.y - 26, 8, ["#a3e635", "#ecfccb"], { speed: 160, dir: a, spread: 0.8 });
      }
      if (bit) FX.shake(4);
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 钢链：向前 350 甩出锁链，近末端命中更痛 ---- */
  IMPL.chain = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "chainCharge"; s.t = 0;
      f.facing = aimAt(f, this);
      FX.float(f.x, f.y - 60, "蓄力中…", "#cbd5e1", 13);
      FX.ring(f.x, f.y - 26, 26, "rgba(203,213,225,.9)", 3, 0.35);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "chainCharge") return;
      s.t += dt;
      /* 前摇期间手上甩链的蓄势轨迹 */
      if (s.t < (sk.charge || 0.4)) {
        const a0 = Math.atan2(f.facing.y, f.facing.x);
        FX.trail(f.x + Math.cos(a0) * 20 + rand(-6, 6), f.y - 26 + Math.sin(a0) * 10 + rand(-6, 6),
          "#cbd5e1", 3, 0.18);
        return;
      }
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      const range = sk.range || 250;
      const ux = Math.cos(a), uy = Math.sin(a);
      const ox = f.x, oy = f.y - 26;
      const ex = ox + ux * range, ey = oy + uy * range;
      /* 锁链表现：一串小环节 + 末端铁钩 */
      for (let i = 0; i <= 22; i++) {
        const t2 = i / 22;
        FX.trail(ox + ux * range * t2 + Math.sin(i * 1.7) * 1.5,
                 oy + uy * range * t2 + Math.cos(i * 1.7) * 1.5, "#cbd5e1", 4.4, 0.34);
      }
      FX.burst(ex, ey, 10, ["#e2e8f0", "#fff"], { speed: 200, dir: a, spread: 0.7 });
      FX.shake(4);
      const halfW = sk.halfW || 26;
      B.fighters.forEach(o => {
        if (o === f || o.dead || B.sameTeam(f, o)) return;
        /* 点到线段距离 */
        const px = o.x - ox, py = (o.y - 26) - oy;
        let t2 = (px * ux + py * uy) / range;
        t2 = Math.max(0, Math.min(1, t2));
        const cx = ox + ux * range * t2, cy = oy + uy * range * t2;
        if (Math.hypot(o.x - cx, (o.y - 26) - cy) > halfW + o.r) return;
        const far = t2 >= (sk.farFrom || 0.66);
        B.damage(f, o, far ? (sk.farDmg || 22) : sk.dmg, {
          type: "skill", kb: 120, from: f, hitDir: a
        });
        FX.float(o.x, o.y - 60, far ? "锁链末端！" : "锁链命中", far ? "#fca5a5" : "#e2e8f0", far ? 16 : 13);
        FX.burst(o.x, o.y - 26, 10, ["#cbd5e1", "#fff"], { speed: 220, dir: a });
      });
      f.atkAnim = 0.26; f.atkDur = 0.26;
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 运货：蓄力 1 秒 → 召唤木箱并扔出 ---- */
  IMPL.cargo = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "cargoCharge"; s.t = 0;
      f.facing = aimAt(f, this);
      FX.float(f.x, f.y - 60, "蓄力中…", "#fbbf24", 13);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "cargoCharge") return;
      s.t += dt;
      if (s.t < (sk.charge || 1)) return;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      if (!B.terrain) { B.endSlot(f, slot, sk.cd); return; }
      /* 上一个木箱自动销毁 */
      if (f._cargoPrev && !f._cargoPrev.dead && B.terrain.props.indexOf(f._cargoPrev) >= 0) {
        const pr = f._cargoPrev;
        pr.dead = true;
        FX.burst(pr.x, pr.y - 14, 14, ["#9a7444", "#c39a62"], { speed: 200 });
      }
      const size = 40;
      const cx = f.x + Math.cos(a) * 42, cy = f.y - 26 + Math.sin(a) * 42 + 12;
      const mat = (LD.TERRAIN.mats.breakable || []).find(m => m.id === "crate_wood") || {};
      const o = {
        uid: 9000 + (B._crateId = (B._crateId || 0) + 1),
        kind: "breakable", mat: "crate_wood", shape: "square",
        cw: 1, ch: 1, w: size, h: size, x: cx, y: cy, ox: cx, oy: cy,
        elev: mat.elev || 22, mass: 1.1, hp: sk.crateHp || 20, maxHp: sk.crateHp || 20,
        dead: false, flash: 0, vx: Math.cos(a) * (sk.speed || 620), vy: Math.sin(a) * (sk.speed || 620),
        free: false, variant: 0, blockMove: true, blockProj: true, soft: false,
        cargo: true, landed: false, runtime: true, owner: f, ownerSide: f.side,
        hitDmg: sk.dmg || 25
      };
      B.terrain.props.push(o);
      f._cargoPrev = o;
      FX.burst(cx, cy - 10, 14, ["#9a7444", "#c39a62", "#fff"], { speed: 200, dir: a });
      FX.float(f.x, f.y - 62, "运货！", "#fbbf24", 15);
      f.atkAnim = 0.3; f.atkDur = 0.3;
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 咸鱼：命中抽能（抽多少回多少） ---- */
  IMPL.fish = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "fish"; s.t = 0;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      const p = B.spawnProj({
        x: f.x + Math.cos(a) * 24, y: f.y - 26 + Math.sin(a) * 14,
        vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
        r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, maxLife: sk.proj.life + 2, owner: f,
        color: "#93c5fd", core: "#eff6ff", type: "fish", kindTag: "skill", trail: true, spin: 1,
        data: { drain: sk.drain || 20 }
      });
      s.d.p = p;
      f.atkAnim = 0.24; f.atkDur = 0.24;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "fish") return;
      const p = s.d.p;
      if (!p || B.projs.indexOf(p) < 0) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 突击枪：600 距离 8 连发 ---- */
  IMPL.assault = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "assault"; s.t = 0; s.n = 0;
      f.facing = aimAt(f, this);
      f.atkAnim = 0.5; f.atkDur = 0.5;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "assault") return;
      s.t += dt;
      const gap = sk.gap || 0.06;
      while (s.n < (sk.n || 8) && s.t >= s.n * gap) {
        const a = Math.atan2(f.facing.y, f.facing.x);
        const jitter = (Math.random() - 0.5) * 0.05;
        const life = (sk.range || 600) / (sk.speed || 900);
        B.spawnProj({
          x: f.x + Math.cos(a) * 26, y: f.y - 26 + Math.sin(a) * 14,
          vx: Math.cos(a + jitter) * sk.speed, vy: Math.sin(a + jitter) * sk.speed,
          r: 6, dmg: sk.dmg, life: life, maxLife: life + 1, owner: f,
          color: "#fde68a", core: "#fffbeb", type: "bullet", kindTag: "skill", trail: true, data: {}
        });
        FX.burst(f.x + Math.cos(a) * 30, f.y - 26 + Math.sin(a) * 14, 4, ["#fde68a", "#fff"], { speed: 130, dir: a, spread: 0.4 });
        FX.shake(1.2);
        s.n++;
      }
      if (s.n >= (sk.n || 8) && s.t >= (sk.n || 8) * gap + 0.12) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：爆裂之火（外圈预警 → 圈内持续降火球 2 秒，中心安全区） ---- */
  IMPL.blaze = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "blazeWarn"; s.t = 0;
      s.x = f.x; s.y = f.y; s.d.n = 0; s.d.acc = 0;
      B.zones.push({ type: "blaze", x: f.x, y: f.y - 8, r: sk.outer || 150,
        life: 0, max: (sk.charge || 0.6) + 0.1, warn: sk.charge || 0.6,
        inner: sk.inner || 55, owner: f });
      FX.ring(f.x, f.y - 8, sk.outer || 150, "rgba(251,146,60,.95)", 6, 0.5);
      LD.Cine.start(f, sk.name, "", "#fb923c");
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "blazeWarn" && s.phase !== "blaze") return;
      s.t += dt;
      if (s.phase === "blazeWarn") {
        if (s.t < (sk.charge || 0.6)) return;
        s.phase = "blaze"; s.t = 0;
        FX.shake(10); FX.flash(0.15, "251,146,60");
        return;
      }
      /* 落火球：每 gap 秒一颗，七成瞄准对手当前位置（给 0.28s 预警逼他跑位） */
      s.d.acc += dt;
      const outer = sk.outer || 150, inner = sk.inner || 55;
      const dmin = inner + 33, dmax = outer - 24;      // 保证中心安全区真的打不到
      if (s.d.n < (sk.drops || 12) && s.d.acc >= (sk.gap || 0.16)) {
        s.d.acc = 0; s.d.n++;
        const foe = B.foeOf(f);
        const cx = s.x, cy = s.y - 8;
        let px, py;
        if (foe && !foe.dead && Math.random() < 0.7) { px = foe.x; py = foe.y; }
        else { const a2 = Math.random() * TAU, dd = rand(dmin, dmax);
               px = cx + Math.cos(a2) * dd; py = cy + Math.sin(a2) * dd * 0.62; }
        /* 收进圆环 */
        const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1;
        const dc = Math.max(dmin, Math.min(dmax, d));
        px = cx + dx / d * dc; py = cy + dy / d * dc;
        B.zones.push({ type: "pillar", x: px, y: py, r: sk.ballR || 46, life: 0, max: 0.45,
          dmg: sk.dmg, kb: 130, slow: sk.slow, dmgType: "ult",
          owner: f, hit: false, warn: sk.warn || 0.28 });
        FX.mark(px, py, sk.ballR || 46, "rgba(251,146,60,.95)", (sk.warn || 0.28) + 0.55, "circle");
        FX.shake(4);
      }
      if (s.d.n >= (sk.drops || 12) &&
          s.t > (sk.gap || 0.16) * (sk.drops || 12) + (sk.warn || 0.28) + 0.35) {
        B.endSlot(f, slot, sk.cd);
      }
    }
  };

  /* ---- 大招：流水碎岩拳（五连拳 + 向前推进 200，撞墙不中断、贴墙打完） ---- */
  IMPL.rockFist = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "fistCharge"; s.t = 0; s.n = 0;
      f.facing = aimAt(f, this);
      FX.ring(f.x, f.y - 26, 46, "rgba(96,165,250,.9)", 5, 0.4);
      /* 大招演出；预支蓄力时间，演出一结束立刻开拳 */
      LD.Cine.start(f, sk.name, "", "#60a5fa");
      s.t = sk.charge || 0.3;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      const charge = sk.charge || 0.3;
      if (s.phase === "fistCharge") {
        s.t += dt;
        if (s.t >= charge) { s.phase = "fist"; s.t = 0; s.n = 0; s.trv = 0; f.invuln = Math.max(f.invuln, 0.5); }
        return;
      }
      if (s.phase !== "fist") return;
      s.t += dt;
      const total = sk.punches || 5;
      const dur = 0.72;
      const per = dur / total;
      const step = (sk.move || 200) / total;
      while (s.n < total && s.t >= s.n * per) {
        const a = Math.atan2(f.facing.y, f.facing.x);
        /* 每拳向前推进；总推进距离仍然封顶在 sk.move，撞墙不中断，改为贴着墙滑行。
           位移拆成 4 个小步逐段判定，避免一拳 40 距离直接穿进墙体。 */
        const room = Math.max(0, (sk.move || 200) - (s.trv || 0));
        const st = Math.min(step, room);
        if (st > 0.01) {
          const SUB = 4, part = st / SUB;
          let budget = st;
          for (let k = 0; k < SUB && budget > 0.01; k++) {
            const dx = Math.cos(a) * part, dy = Math.sin(a) * part;
            let mv = 0;
            if (!B.hitWallAt(f, f.x + dx, f.y + dy)) { f.x += dx; f.y += dy; mv = part; }
            else {
              /* 正面被墙挡住时，保留没被挡住的那个分量，沿墙继续蹭过去 */
              const keepX = Math.abs(dx) >= Math.abs(dy);
              const tryX = () => { if (Math.abs(dx) > 0.01 && !B.hitWallAt(f, f.x + dx, f.y)) { f.x += dx; mv = Math.abs(dx); return true; } return false; };
              const tryY = () => { if (Math.abs(dy) > 0.01 && !B.hitWallAt(f, f.x, f.y + dy)) { f.y += dy; mv = Math.abs(dy); return true; } return false; };
              if (keepX) { if (!tryX()) tryY(); } else { if (!tryY()) tryX(); }
            }
            s.trv = (s.trv || 0) + mv;
            budget -= part;
            if (mv <= 0.01) break;              // 彻底顶死：这一拳不再白费力气，后面几拳照常打
          }
        }
        FX.burst(f.x + Math.cos(a) * 34, f.y - 26 + Math.sin(a) * 18, 8, ["#60a5fa", "#bfdbfe", "#fff"], { speed: 240, dir: a, spread: 0.8 });
        FX.ring(f.x + Math.cos(a) * 40, f.y - 26 + Math.sin(a) * 18, 46, "rgba(147,197,253,.85)", 4, 0.28);
        B.fighters.forEach(o => {
          if (o === f || o.dead || B.sameTeam(f, o)) return;
          const dx = o.x - f.x, dy = (o.y - 26) - (f.y - 26);
          const d = Math.hypot(dx, dy);
          if (d > (sk.reach || 86) + o.r) return;
          const da = Math.abs(((Math.atan2(dy, dx) - a + Math.PI * 3) % TAU) - Math.PI);
          if (da > 1.0) return;
          B.damage(f, o, sk.dmg, { type: "ult", stun: sk.stun || 0.16, kb: sk.kb || 95, from: f, hitDir: a });
        });
        f.atkAnim = 0.12; f.atkDur = 0.12;
        FX.shake(3);
        s.n++;
      }
      if (s.n >= total && s.t >= dur + 0.12) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：黄金弹力炮（弹射子弹，见 updateProjs 的 gold 分支） ---- */
  IMPL.goldCannon = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "goldReady"; s.t = 0;
      f.facing = aimAt(f, this);
      /* 先放大招演出；演出期间战斗暂停，出弹挪到 update 里（演出一结束立刻开炮） */
      LD.Cine.start(f, sk.name, "", "#fcd34d");
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase === "goldReady") {
        s.phase = "gold";
        const a = Math.atan2(f.facing.y, f.facing.x);
        const p = B.spawnProj({
          x: f.x + Math.cos(a) * 26, y: f.y - 26 + Math.sin(a) * 14,
          vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed,
          r: sk.r || 8, dmg: sk.dmg, life: 3.0, maxLife: 3.0, owner: f,
          color: "#fcd34d", core: "#fffbeb", type: "gold", kindTag: "ult",
          passWall: false, trail: true,
          data: { left: sk.dist || 2000, stun: sk.stun || 0.25, bounces: 0 }
        });
        s.d.p = p;
        f.atkAnim = 0.3; f.atkDur = 0.3;
        FX.flash(0.1, "252,211,77");
        FX.shake(5);
        return;
      }
      if (s.phase !== "gold") return;
      const p = s.d.p;
      if (!p || B.projs.indexOf(p) < 0) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：虚空爆裂斩 ---- */
  IMPL.voidSlash = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "ultCharge"; s.t = 0;
      f.facing = aimAt(f, this);
      LD.Cine.start(f, sk.name, "", "#fbbf24");
      /* 演出期间战斗暂停、槽位计时停走；把蓄力时间预支掉，
         保证演出（名字逐字）一结束就立刻释放，不再额外等待 */
      s.t = sk.charge;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "ultCharge") return;
      s.t += dt;
      if (s.t >= sk.charge + C.ultCinematic * 0.0) {
        const a = Math.atan2(f.facing.y, f.facing.x);
        B.spawnProj({ x: f.x + Math.cos(a) * 46, y: f.y - 26, vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
          r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, color: "#fbbf24", core: "#fffbeb",
          type: "void", pierce: true, tick: sk.tick, tickMax: sk.tickMax, kindTag: "ult", scale: 1, trail: true });
        FX.shake(16); FX.flash(0.3, "255,220,150");
        FX.burst(f.x + Math.cos(a) * 50, f.y - 26, 34, ["#fbbf24", "#fff7d6", "#fb923c"], { speed: 320, dir: a, spread: 1.2 });
        B.endSlot(f, slot, sk.cd);
      }
    }
  };

  /* ---- 大招：血怒 ---- */
  IMPL.bloodRage = {
    start(f, slot, sk) {
      f.buff.rage = sk.dur;
      LD.Cine.start(f, sk.name, "", "#f472b6");
      FX.ring(f.x, f.y - 26, 110, "rgba(244,114,182,.95)", 7, 0.6);
      FX.burst(f.x, f.y - 26, 30, ["#f472b6", "#fff"], { speed: 280 });
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：千剑杀 ---- */
  IMPL.thousandSwords = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "thousand"; s.t = 0; s.d.ac = 0;
      f.facing = aimAt(f, this);                      // 施放瞬间瞄准一次
      s.d.a = Math.atan2(f.facing.y, f.facing.x);     // 之后方向完全锁定, 箭矢直线飞行
      f.buff.thousand = sk.dur;
      LD.Cine.start(f, sk.name, "", "#a5f3fc");
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "thousand") return;
      s.t += dt; s.d.ac += dt;
      f.buff.thousand = Math.max(f.buff.thousand, 0.01);
      if (s.d.ac >= sk.interval) {
        s.d.ac -= sk.interval;
        const a = s.d.a + rand(-0.05, 0.05);          // 只保留极小的视觉散布, 不再追踪
        B.spawnProj({ x: f.x + Math.cos(a) * 26, y: f.y - 26 + Math.sin(a) * 14,
          vx: Math.cos(a) * sk.proj.speed, vy: Math.sin(a) * sk.proj.speed,
          r: sk.proj.r, dmg: sk.dmg, life: sk.proj.life, owner: f, color: "#a5f3fc", core: "#f0feff",
          type: "sword", kindTag: "ult", trail: true,
          /* v3.9 剑气穿透：命中后继续前行，可以一口气贯穿一整条线上的目标。
           * pierceOnce = 同一目标只结算一次，否则弹道贴着人飞时会每帧都扣一次血。 */
          pierce: !!sk.pierce, data: { pierceOnce: !!sk.pierce } });
        FX.burst(f.x, f.y - 26, 4, "#a5f3fc", { speed: 120, dir: a });
      }
      if (s.t >= sk.dur) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：绝望囚牢（zone 承载：0.8s 后成形，沉默 + 圆形墙，不吸附） ---- */
  IMPL.prison = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "prison"; s.t = 0;
      LD.Cine.start(f, sk.name, "", "#a78bfa");
      B.zones.push({ type: "prison", x: f.x, y: f.y, r: sk.zoneR, life: 0, max: sk.dur + (sk.formT || 0),
        owner: f, hits: {}, formT: sk.formT || 0 });
      FX.mark(f.x, f.y, sk.zoneR, "rgba(167,139,250,.9)", sk.formT || 0, "circle");
      FX.ring(f.x, f.y - 26, sk.zoneR, "rgba(167,139,250,.75)", 6, sk.formT || 0.5);
      FX.shake(10);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "prison") return;
      s.t += dt;
      if (s.t >= sk.dur + (sk.formT || 0)) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：败者食尘（回溯 3 秒血量） ---- */
  IMPL.eatDust = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "eatDust"; s.t = 0;
      LD.Cine.start(f, sk.name, "", "#fbbf24");
      const target = (B.t || 0) - sk.back;
      let best = null, bestPos = null;
      (f.hpHist || []).forEach(h => {
        if (!best || Math.abs(h.t - target) < Math.abs(best.t - target)) best = h;
      });
      (f.posHist || []).forEach(h => {
        if (!bestPos || Math.abs(h.t - target) < Math.abs(bestPos.t - target)) bestPos = h;
      });
      /* v3.1：技能 CD 一并回到 3 秒前 */
      let bestCd = null;
      (f.cdHist || []).forEach(h => {
        if (!bestCd || Math.abs(h.t - target) < Math.abs(bestCd.t - target)) bestCd = h;
      });
      if (bestCd) {
        f.cd.basic = bestCd.cd.basic; f.cd.skill1 = bestCd.cd.skill1;
        f.cd.skill2 = bestCd.cd.skill2; f.cd.ult = bestCd.cd.ult;
      }
      const old = best ? best.hp : f.hp;
      const healed = Math.round(old - f.hp);
      f.hp = Math.min(f.maxHp, Math.max(f.hp, old));
      // 连同 3 秒前的位置一起回溯
      if (bestPos) {
        FX.burst(f.x, f.y - 26, 12, ["#fbbf24", "#fff7d6"], { speed: 200 });
        f.x = bestPos.x; f.y = bestPos.y;
        FX.burst(f.x, f.y - 26, 14, ["#fde68a", "#fff"], { speed: 240 });
        FX.ring(f.x, f.y - 26, 70, "rgba(251,191,36,.9)", 5, 0.45);
      }
      FX.ring(f.x, f.y - 26, 110, "rgba(251,191,36,.95)", 7, 0.6);
      FX.burst(f.x, f.y - 26, 26, ["#fbbf24", "#fff7d6"], { speed: 260 });
      FX.float(f.x, f.y - 62, (healed > 0 ? "+" : "") + healed, "#fbbf24", 20);
      FX.float(f.x, f.y - 78, "冷却已回溯", "#fde68a", 13);
      B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：水之呼吸（三颗水球环绕；zone 承载，可同步客机） ---- */
  IMPL.waterOrbs = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "water"; s.t = 0;
      LD.Cine.start(f, sk.name, "", "#67e8f9");
      for (let i = 0; i < 3; i++) {
        B.zones.push({ type: "water", x: f.x, y: f.y - 26, r: sk.orbR, life: 0, max: sk.dur,
          owner: f, hits: {}, ang0: i * (Math.PI * 2 / 3), orbitR: sk.orbitR, spd: sk.spd,
          dmg: sk.dmg, tick: sk.tick, abs: 0, absorbMax: sk.absorbMax || 12,
          hitPad: sk.hitPad != null ? sk.hitPad : 32 });   // v2.4.2 判定放宽：球半径之外再补 hitPad
      }
      FX.ring(f.x, f.y - 26, sk.orbitR + 30, "rgba(103,232,249,.9)", 6, 0.5);
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "water") return;
      s.t += dt;
      if (s.t >= sk.dur) B.endSlot(f, slot, sk.cd);
    }
  };

  /* ---- 大招：王从天降（一段标记 → 二段飞天落地） ---- */
  IMPL.kingDrop = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "kingMark"; s.t = 0;
      s.d.mx = f.x; s.d.my = f.y;
      f.kingMark = { x: f.x, y: f.y, global: false };   // 只有自己看得见
      FX.float(f.x, f.y - 60, "已标记落点", "#fbbf24", 14);
    },
    again(f, slot, sk) {
      const s = f.slot[slot];
      if (s.phase !== "kingMark") return false;
      s.phase = "kingRise"; s.t = 0;
      f.kingMark = { x: s.d.mx, y: s.d.my, global: true };   // 全员可见
      /* v2.7：飞起蓄力期间不再无敌——可以被伤害，但伤害不会打断大招（落地结算照常）。
       * 以前这里是 invuln = rise + 0.3，等于白送一个无敌位移。 */
      f.kingVuln = true;
      LD.Cine.start(f, sk.name, "", "#fbbf24");
      FX.ring(f.x, f.y - 26, 90, "rgba(251,191,36,.9)", 6, 0.5);
      FX.burst(f.x, f.y - 26, 24, ["#fbbf24", "#fff"], { speed: 280 });
      return true;
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase !== "kingRise") return;
      s.t += dt;
      f.kingRise = Math.min(1, s.t / sk.rise);   // 供绘制层抬升人物
      if (s.t >= sk.rise) {
        const x = s.d.mx, y = s.d.my;
        f.x = x; f.y = y; f.kingRise = 0;
        FX.ring(x, y, sk.boomR, "rgba(251,191,36,.95)", 9, 0.6);
        FX.burst(x, y, 40, ["#fbbf24", "#fff", "#fb923c"], { speed: 360 });
        FX.shake(18); FX.flash(0.24, "255,220,150");
        B.fighters.forEach(o => {
          if (o === f || o.dead || o.kind !== "hero" || B.sameTeam(f, o)) return;
          if (Math.hypot(o.x - x, (o.y - 26) - y) <= sk.boomR + o.r) {
            B.damage(f, o, sk.dmg, { type: "ult", kb: 260, stun: sk.stun, from: f,
              hitDir: Math.atan2(o.y - f.y, o.x - f.x) });
          }
        });
        f.kingMark = null;
        B.endSlot(f, slot, sk.cd);
      }
    }
  };

  /* ==========================================================
   *  v2.5 BOSS 专属技能（kind:"boss"，不进商店；CD 吃难度 rateM）
   * ========================================================== */
  /* ---- 黑侠客：飞镖（远程普攻） ---- */
  IMPL.n_shuriken = {
    start(f, slot, sk) {
      f.atkAnim = 0.22; f.atkDur = 0.22;
      f.facing = aimAt(f, this);
      const a = Math.atan2(f.facing.y, f.facing.x);
      B.spawnProj({
        x: f.x + Math.cos(a) * 22, y: f.y - 26 + Math.sin(a) * 12,
        vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed,
        r: sk.r, dmg: sk.dmg, life: sk.life, owner: f,
        color: "#67e8f9", core: "#e0faff", type: "shuriken", kindTag: "basic", basic: true, trail: true
      });
      FX.shake(2);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 黑侠客：暗影分身（同血量同外形，6s 后消散；打在分身上的伤害全部白费） ---- */
  IMPL.n_clone = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "cloneCast"; s.t = 0;
      FX.burst(f.x, f.y - 26, 32, ["#a78bfa", "#334155", "#fff"], { speed: 300 });
      FX.shake(8);
      const c = B.mkHero(2, {
        x: clamp(f.x + rand(-70, 70), 60, B.world.w - 60),
        y: clamp(f.y + rand(-50, 50), B.world.pt + 16, B.world.h - 50),
        look: f.look, name: f.name
      });
      c.isClone = true;
      c.cloneT = sk.dur;
      c.maxHp = f.maxHp; c.hp = c.maxHp;          // 同血量
      c.team = f.team;                            // 与本体同阵营：互不伤害、本体索敌跳过分身
      c.loadout = { basic: f.loadout.basic, skill1: null, skill2: f.loadout.skill2, ult: null };
      LD.AI.mkBot(c, f.botLevel || "normal");     // 分身也会打人
      B.fighters.push(c);
      FX.float(f.x, f.y - 60, "暗影分身！", "#a78bfa", 16);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 黑侠客：突袭（闪现到玩家身旁，0.4s 蓄力后三连斩） ---- */
  IMPL.n_raid = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "raidWind"; s.t = 0;
      s.d.n = 0; s.d.acc = 0;
      const foe = B.foeOf(f);
      if (foe) {
        const ox = f.x, oy = f.y;
        const a = Math.atan2(f.y - foe.y, f.x - foe.x) || 0;
        f.x = clamp(foe.x + Math.cos(a) * (foe.r + f.r + 14), 40, B.world.w - 40);
        f.y = clamp(foe.y + Math.sin(a) * (foe.r + f.r + 14), B.world.pt + 10, B.world.h - 44);
        const dx = foe.x - f.x, dy = foe.y - f.y, dd = Math.hypot(dx, dy) || 1;
        f.facing = { x: dx / dd, y: dy / dd };
        FX.burst(ox, oy - 26, 18, ["#a78bfa", "#334155"], { speed: 240 });
        FX.burst(f.x, f.y - 26, 18, ["#a78bfa", "#fff"], { speed: 240 });
        FX.ring(f.x, f.y - 26, 70, "rgba(167,139,250,.9)", 4, 0.4);
        f.invuln = Math.max(f.invuln, sk.windup + 0.1);   // 突袭过程无敌，防止落地即被反杀
        // 突袭是一次「交出去」的攻击：蓄力 + 三连斩期间自身定身，否则（远程 BOSS 会本能地拉开距离）
        // 会一边后撤一边挥刀，贴脸的三连斩直接打空。
        f.root = Math.max(f.root, (sk.windup || 0.4) + (sk.hits || 3) * (sk.gap || 0.17) + 0.15);
      }
    },
    update(f, slot, sk, dt) {
      const s = f.slot[slot];
      if (s.phase === "raidWind") {
        s.t += dt;
        // 蓄力红光预警：玩家有 0.4s 反应窗口
        FX.trail(f.x + rand(-18, 18), f.y - 26 + rand(-24, 12), "#f87171", 7, 0.3);
        if (s.t >= (sk.windup || 0.4)) { s.phase = "raidSlash"; s.t = 0; s.d.acc = 0; s.d.n = 0; FX.shake(8); }
      } else if (s.phase === "raidSlash") {
        s.d.acc += dt;
        if (s.d.n < sk.hits && s.d.acc >= (sk.gap || 0.17)) {
          s.d.acc = 0; s.d.n++;
          f.atkAnim = 0.2; f.atkDur = 0.2;
          f.facing = aimAt(f, this);
          B.melee(f, { reach: sk.reach || 96, half: 1.25, dmg: sk.dmg, type: "skill", kb: 200 });
          arcFX(f, "#a78bfa", 92);
          FX.shake(6);
          if (s.d.n >= sk.hits) B.endSlot(f, slot, sk.cd * (f.rateM || 1));
        }
      }
    }
  };

  /* ---- 黑侠客：螺旋手里剑（中速巨大蓝球，中度吸引 + 持续伤害） ---- */
  IMPL.n_ult = {
    start(f, slot, sk) {
      const s = f.slot[slot]; s.on = true; s.phase = "shurikenCast"; s.t = 0;
      LD.Cine.start(f, sk.name, "", "#38bdf8");
      const foe = B.foeOf(f);
      const a = foe ? Math.atan2((foe.y - 26) - (f.y - 26), foe.x - f.x) : 0;
      B.zones.push({
        type: "shuriken", x: f.x, y: f.y - 26,
        vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed,
        r: sk.r, life: 0, max: sk.life, dmg: sk.dmg, tick: sk.tick,
        pull: sk.pull, pullR: sk.pullR, owner: f, hits: {}, color: "#38bdf8",
        /* v2.7：飞出 boomDist 距离后引爆一次中范围爆炸（或飞满 life 到点自爆） */
        dist: 0, boomDist: sk.boomDist || 520, boomR: sk.boomR || 150, boomDmg: sk.boomDmg || 25, boomed: false
      });
      FX.shake(10);
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ---- 勇者版螺旋手里剑（大招商店）：与大招 IMPL 共用实现，数值走 skills.shuriken ---- */
  IMPL.shuriken = IMPL.n_ult;

  /* v2.7 螺旋手里剑二段：飞出设定距离后的中范围爆炸（额外伤害 + 弹开） */
  B.shurikenBoom = function (z) {
    const R = z.boomR || 150, dmg = z.boomDmg || 25;
    FX.ring(z.x, z.y, R, "rgba(56,189,248,.95)", 9, 0.55);
    FX.burst(z.x, z.y, 34, ["#38bdf8", "#e0faff", "#fff"], { speed: 340 });
    FX.shake(12); FX.flash(0.16, "120,200,255");
    for (const f of this.fighters) {
      if (f.dead || f.kind !== "hero" || f === z.owner || this.sameTeam(z.owner, f)) continue;
      if (Math.hypot(f.x - z.x, (f.y - 26) - z.y) <= R + f.r) {
        this.damage(z.owner, f, dmg, { type: "ult", kb: 320, from: z.owner,
          hitDir: Math.atan2(f.y - z.y, f.x - z.x) });
      }
    }
  };


  /* ==========================================================
   *  工具
   * ========================================================== */
  function aimAt(f, impl) {
    let foe = B.aimFoe(f);   // 索敌优先：有锁定目标就朝他瞄准，否则取最近对手
    if (foe && foe.dead) foe = null;
    /* v3.7 塔防：身边没有敌人时，自动瞄最近的敌方建筑（防御塔 / 水晶） */
    if (B.rule === "tower" && B.aimStructFor) {
      const st = B.aimStructFor(f);
      if (st) {
        const ds = Math.hypot(st.x - f.x, st.y - f.y);
        const df = foe ? Math.hypot(foe.x - f.x, foe.y - f.y) : Infinity;
        if (ds < df) foe = st;
      }
    }
    if (!foe) return f.facing;
    const dx = foe.x - f.x, dy = foe.y - f.y;
    const n = Math.hypot(dx, dy) || 1;
    return { x: dx / n, y: dy / n };
  }
  function arcFX(f, color, reach) {
    const a = Math.atan2(f.facing.y, f.facing.x);
    FX.ring(f.x + Math.cos(a) * 34, f.y - 26 + Math.sin(a) * 16, reach * 0.72, color, 4, 0.2);
    FX.burst(f.x + Math.cos(a) * 40, f.y - 26 + Math.sin(a) * 18, 8, color, { speed: 200, dir: a, spread: 1.1 });
  }
  function segHit(x0, y0, x1, y1, tgt, w) {
    const dx = x1 - x0, dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1;
    let t = ((tgt.x - x0) * dx + (tgt.y - 26 - y0) * dy) / L2;
    t = clamp(t, 0, 1);
    const px = x0 + dx * t, py = y0 + dy * t;
    return Math.hypot(tgt.x - px, (tgt.y - 26) - py) <= w + tgt.r * 0.6;
  }
  B.aimAt = aimAt;
  B.arcFX = arcFX;
  B.segHit = segHit;
})(window.LD = window.LD || {});
