/* ============================================================
 *  40e_proj.js - 弹道推进 / 命中结算 / 爆炸 / 持续区域（火柱 · 激光等）
 *  自 40_battle.js 拆分（v4.12 工程债）。只搬代码，判定逻辑一行未改。
 * ============================================================ */
(function (LD) {
  "use strict";
  const C = LD.CONF, TAU = Math.PI * 2;
  const FX = LD.FX, V = LD.View;
  const clamp = V.clamp;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const B = LD.Battle;

  const pushTrail = (p) => { if (p.trail || p.type === "fireball" || p.type === "sword") FX.trail(p.x, p.y, p.color, p.r * 0.55, 0.26); };


  B.updateProjs = function (dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      if (!p) continue;                       // 命中结算里可能顺带删掉别的弹道，数组会缩短
      p.life += dt;
      if (p.type === "bomb") {
        // v2.5：带初速的炸弹会被"扔"出去（快枪手炸弹投掷），减速滑行到目标附近再爆
        if (p.vx || p.vy) {
          p.x += p.vx * dt; p.y += p.vy * dt;
          const bd = Math.exp(-1.6 * dt); p.vx *= bd; p.vy *= bd;
        }
        if (p.life >= p.data.fuse) { this.boom(p); this.projs.splice(i, 1); }
        continue;
      }
      // 高压炸弹：倒计时归零 → 当场爆炸（碰人不提前引爆）；被扔出时朝前方中速飞行
      if (p.type === "hbomb") {
        p.data.timer -= dt;
        if (p.data.timer <= 0) {
          this.hbombBoom(p.owner, p.x, p.y, { boomR: p.data.boomR, dmg: p.data.dmg, selfDmg: p.data.selfDmg });
          this.projs.splice(i, 1);
          continue;
        }
        if (p.vx || p.vy) {                    // 扔出状态：直线飞行 + 轻微减速，撞到场地边界就停住
          p.x += p.vx * dt; p.y += p.vy * dt;
          const damp = Math.exp(-(p.data.throwDamp || 1.05) * dt);
          p.vx *= damp; p.vy *= damp;
          const L = 26, T = 96;
          if (p.x < L || p.x > B.world.w - L) { p.x = Math.max(L, Math.min(B.world.w - L, p.x)); p.vx = 0; }
          if (p.y < T || p.y > B.world.h - 10) { p.y = Math.max(T, Math.min(B.world.h - 10, p.y)); p.vy = 0; }
          pushTrail(p);
        }
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      /* v3.1 黄金弹力炮：按光路反射，撞到的可破坏物照样吃伤害；总路程 1200 */
      if (p.type === "gold") {
        const ox0 = p.x - p.vx * dt, oy0 = p.y - p.vy * dt;
        p.data.left -= Math.hypot(p.vx, p.vy) * dt;
        let prop = null;
        p.x = ox0 + p.vx * dt; p.y = oy0;
        const hx = this.terrain ? LD.Terrain.projHit(this.terrain, p) : null;
        if (hx) { p.x = ox0; p.vx = -p.vx; prop = hx; }
        p.x = ox0; p.y = oy0 + p.vy * dt;
        const hy = this.terrain ? LD.Terrain.projHit(this.terrain, p) : null;
        if (hy) { p.y = oy0; p.vy = -p.vy; prop = prop || hy; }
        p.x = ox0 + p.vx * dt; p.y = oy0 + p.vy * dt;
        /* 场地边界也当墙 */
        if (p.x < p.r + 6) { p.x = p.r + 6; p.vx = Math.abs(p.vx); }
        if (p.x > B.world.w - p.r - 6) { p.x = B.world.w - p.r - 6; p.vx = -Math.abs(p.vx); }
        if (p.y < B.world.pt + p.r) { p.y = B.world.pt + p.r; p.vy = Math.abs(p.vy); }
        if (p.y > B.world.h - p.r) { p.y = B.world.h - p.r; p.vy = -Math.abs(p.vy); }
        if (prop) {
          LD.Terrain.hitProp(this.terrain, prop, Math.round(p.dmg * 0.8), { dir: Math.atan2(p.vy, p.vx), melee: false, src: p.owner });
          FX.burst(p.x, p.y, 7, ["#fcd34d", "#fff"], { speed: 170, dir: Math.atan2(-p.vy, -p.vx) });
          FX.shake(1.4);
          p.data.bounces = (p.data.bounces || 0) + 1;
        }
        p.tick = true; p.spin = (p.spin || 0) + dt * 9;
        pushTrail(p);
        if (p.data.left <= 0) {
          FX.burst(p.x, p.y, 12, ["#fcd34d", "#fde68a"], { speed: 200 });
          this.projs.splice(i, 1);
          continue;
        }
      } else if (this.terrain) {
        const to = LD.Terrain.projHit(this.terrain, p);
        if (to) {
          LD.Terrain.hitProp(this.terrain, to, p.dmg, { dir: Math.atan2(p.vy, p.vx), melee: false, src: p.owner });
          FX.burst(p.x, p.y, 8, [p.color || "#cbd5e1", "#fff"], { speed: 140, dir: Math.atan2(-p.vy, -p.vx) });
          FX.shake(1.5);
          this.projs.splice(i, 1);
          continue;
        }
      }
      if (p.tick) p.spin = (p.spin || 0) + dt * 9;
      pushTrail(p);

      /* v3.8 塔防建筑弹道：高速 + 追踪（p.homing 为每秒最大转向弧度） */
      if (p.homing > 0 && p.data && p.data.tgt && !p.data.tgt.dead) {
        const tg = p.data.tgt;
        const ta = Math.atan2((tg.y - 24) - p.y, tg.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        let da = ((ta - cur + Math.PI * 3) % TAU) - Math.PI;
        const na = cur + clamp(da, -p.homing * dt, p.homing * dt);
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
      }
      // 巨龙的火球轻微追踪
      if (p.side === 1 && p.type === "fireball") {
        const foe = this.foeOf(p.owner || { side: 1 });
        if (foe && !foe.dead) {
          const a = Math.atan2(foe.y - 26 - p.y, foe.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          let da = ((a - cur + Math.PI * 3) % TAU) - Math.PI;
          const na = cur + clamp(da, -0.55 * dt, 0.55 * dt);
          const sp = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
        }
      }

      // 神龙掌吸弹（上限 20 点伤害，超出则掌印提前消失）
      if (p.type === "palm") {
        for (let j = this.projs.length - 1; j >= 0; j--) {
          const q = this.projs[j];
          if (q === p || q.side === p.side || q.type === "bomb" || q.type === "palm" || q.type === "dart") continue;
          if (Math.hypot(q.x - p.x, q.y - p.y) < p.r + q.r) {
            const take = Math.max(1, Math.round(q.dmg || 8));
            FX.burst(q.x, q.y, 12, ["#fbbf24", "#fff"], { speed: 200 });
            this.projs.splice(j, 1);
            p.absorbed += take;
            if (p.absorbed > p.absorb) {           // 超过吸收上限 → 掌印被射爆，提前消失
              FX.ring(p.x, p.y, p.r * 0.9, "rgba(251,191,36,.95)", 6, 0.4);
              FX.burst(p.x, p.y, 22, ["#fbbf24", "#fde68a"], { speed: 260 });
              FX.float(p.x, p.y - 40, "掌印被破！", "#fbbf24", 15);
              this.ev.push(["h", p.x, p.y - 40, "掌印被破！", "#fbbf24"]);
              const k = this.projs.indexOf(p);
              if (k >= 0) this.projs.splice(k, 1);
              break;
            }
            p.dmg = (p.dmg || 0) + take;           // 吸收的伤害转化为掌印威力（上限 20）
            FX.float(p.x, p.y - 40, "吸收 +" + p.absorbed, "#fbbf24", 13);
          }
        }
        if (this.projs.indexOf(p) < 0) continue;
      }

      // 出界
      if (p.x < -60 || p.x > B.world.w + 60 || p.y < -80 || p.y > B.world.h + 60 || p.life > p.maxLife) {
        if (p.type !== "bomb") FX.burst(p.x, p.y, 6, p.color, { speed: 110 });
        this.projs.splice(i, 1);
        continue;
      }

      // 命中判定
      for (const f of this.fighters) {
        if (f.side === p.side || f.dead || this.sameTeam(p.owner, f)) continue;
        if (p.type === "hbomb") continue;   // 高压炸弹只按倒计时引爆
        if (Math.hypot(f.x - p.x, (f.y - 26) - p.y) > p.r + f.r) continue;

        /* v3.1 黄金弹力炮：穿透并在敌人之间弹来弹去，同一目标 0.3 秒内只吃一次 */
        if (p.type === "gold") {
          const key = "g" + f.side;
          if ((p.hits[key] || 0) > this.t) continue;
          p.hits[key] = this.t + 0.3;
          this.damage(p.owner, f, p.dmg, { type: "ult", stun: p.data.stun || 0.25, kb: 90, proj: true,
            from: p.owner, hitDir: Math.atan2(p.vy, p.vx) });
          FX.burst(p.x, p.y, 12, ["#fcd34d", "#fff"], { speed: 220 });
          FX.float(f.x, f.y - 58, "弹射命中", "#fcd34d", 13);
          continue;
        }

        /* v3.1 咸鱼：造成伤害并抽取对方大招能量 */
        if (p.type === "fish") {
          const drain = Math.min(Math.max(0, f.energy || 0), p.data.drain || 20);
          f.energy = Math.max(0, (f.energy || 0) - drain);
          if (p.owner && p.owner !== f) {
            p.owner.energy = Math.min(p.owner.maxEnergy, (p.owner.energy || 0) + drain);
          }
          this.damage(p.owner, f, p.dmg, { type: "skill", kb: 150, proj: true, from: p.owner,
            hitDir: Math.atan2(p.vy, p.vx) });
          if (drain > 0) FX.float(p.owner ? p.owner.x : f.x, (p.owner ? p.owner.y : f.y) - 62,
            "吸能 +" + Math.round(drain), "#a5b4fc", 14);
          FX.burst(p.x, p.y, 12, ["#93c5fd", "#dbeafe"], { speed: 200 });
          this.projs.splice(i, 1);
          break;
        }

        // 弹反反射
        if (f.kind === "hero" && f.parryT > 0 && p.kindTag !== "ult") {
          f.parryT = 0;
          p.side = f.side; p.owner = f; p.reflect = true;
          p.dmg = Math.round(p.dmg * 1.5) + 8;
          const a = Math.atan2(p.y - (f.y - 26), p.x - f.x);
          const sp = Math.hypot(p.vx, p.vy) * 1.25;
          p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
          p.color = "#22d3ee"; p.core = "#e0faff"; p.life = 0; p.maxLife = 3;
          const cd = p.kindTag === "basic" ? 2 : 8;
          const ps = B.parrySlot(f);
          if (ps) B.endSlot(f, ps, cd, { noShare: true });
          else f.cd.basic = cd;
          FX.hitstop(C.hitstop.parry); FX.shake(C.shake.parry); FX.flash(0.26, "150,220,255");
          FX.ring(f.x, f.y - 26, 72, "rgba(150,230,255,.95)", 5, 0.4);
          FX.float(f.x, f.y - 60, "弹反！", "#7fe6f7", 20);
          this.ev.push(["p", f.x, f.y - 56, "弹反！", "#7fe6f7"]);
          continue;
        }

        // 零伤弹道（飞雷神飞镖等）只作标记，不结算伤害
        if (p.dmg <= 0 && !p.tick) continue;

        // 钩索：命中伤害 + 眩晕 + 把对手朝释放者当前位置拖回
        if (p.type === "hook") {
          const own = p.owner;
          this.damage(own, f, p.dmg, { type: "skill", stun: p.data.stun || 0.6, kb: 0, proj: true, from: own });
          const dx = own.x - f.x, dy = own.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          const stop = own.r + f.r + 10;
          const move = Math.min(p.data.pull || 700, Math.max(0, d - stop));
          if (move > 4) {
            const ux = dx / d, uy = dy / d;
            for (let s2 = 1; s2 <= 6; s2++)
              FX.trail(f.x + ux * move * s2 / 6, (f.y - 26) + uy * move * s2 / 6, "#94a3b8", 5, 0.4);
            f.x += ux * move; f.y += uy * move;
          }
          FX.ring(f.x, f.y - 26, 52, "rgba(148,163,184,.9)", 5, 0.35);
          FX.float(f.x, f.y - 60, "被钩中！", "#cbd5e1", 14);
          this.projs.splice(i, 1);
          break;
        }

        // 回旋镖：去/回各对同一敌人只结算一次，穿透不消失
        if (p.boomerang) {
          const key = (p.data.phase === "back" ? "b" : "o") + f.side;
          if (!p.hits[key]) {
            p.hits[key] = 1;
            this.damage(p.owner, f, p.dmg, { type: "skill", kb: 140, proj: true, from: p.owner,
              hitDir: Math.atan2(p.vy, p.vx) });
            FX.burst(p.x, p.y, 10, [p.color, p.core], { speed: 170, dir: Math.atan2(-p.vy, -p.vx) });
          }
          continue;
        }

        if (p.tick) {
          // 持续伤害
          const key = "t" + f.side;
          p.hits[key] = (p.hits[key] || 0) + dt;
          p.data.tickAcc = (p.data.tickAcc || 0) + dt;
          if (p.data.tickAcc >= p.tick) {
            p.data.tickAcc = 0;
            const st = p.hits[key] < 3 ? 0.34 : 0;
            this.damage(p.owner, f, p.dmg, { type: "ult", stun: st, kb: 90, proj: true, from: p.owner, basic: false });
          }
          if (p.hits[key] > p.tickMax) continue;   // 单个目标吃满伤害上限后不再吃
          continue;
        }

        /* v3.9 千剑杀的穿透剑气：同一个目标只结算一次，弹道继续往前飞。
         * 记的是目标本身而不是 side —— 小兵 / 僵尸整队共用一个 side，
         * 按 side 记会让一把剑扫过一整波时只有第一只吃到伤害。 */
        if (p.pierce && p.data && p.data.pierceOnce) {
          const hs = p.data.pierceHits || (p.data.pierceHits = []);
          if (hs.indexOf(f) >= 0) continue;
          hs.push(f);
        }
        this.damage(p.owner, f, p.dmg, { type: p.kindTag === "ult" ? "ult" : "skill", proj: true,
          basic: !!p.basic, kb: p.pierce ? 90 : 130, from: p.owner,
          hitDir: Math.atan2(p.vy, p.vx), root: p.root, stun: p.stun, blind: p.blind, blackout: p.blackout });
        if (p.root) { f.root = Math.max(f.root, p.root); FX.float(f.x, f.y - 60, "定身 " + p.root + "s", "#6ee7b7", 14); }
        FX.burst(p.x, p.y, 10, [p.color, p.core], { speed: 170, dir: Math.atan2(-p.vy, -p.vx) });
        if (!p.pierce) { this.projs.splice(i, 1); }
        break;
      }
    }
  };

  B.boom = function (p) {
    const R = p.data.R || 80, dmg = p.data.boom || 20, stun = p.data.stun || 0;
    FX.ring(p.x, p.y, R, "rgba(167,139,250,.95)", 7, 0.5);
    FX.burst(p.x, p.y, 30, ["#a78bfa", "#fff", "#c4b5fd"], { speed: 320 });
    FX.shake(12); FX.flash(0.16, "190,160,255");
    for (const f of this.fighters) {
      if (f.side === p.side || f.dead || this.sameTeam(p.owner, f)) continue;
      if (Math.hypot(f.x - p.x, (f.y - 26) - p.y) <= R + f.r) {
        this.damage(p.owner, f, dmg, { type: "skill", kb: 300, stun: stun, proj: true, from: p, hitDir: Math.atan2(f.y - p.y, f.x - p.x) });
      }
    }
    if (this.terrain) LD.Terrain.blast(this.terrain, p.x, p.y, R, dmg * 0.9);
    this.ev.push(["x", p.x, p.y, R]);
  };

  B.updateZones = function (dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life += dt;
      if (z.type === "pillar") {
        if (z.life > z.warn && !z.hit) {
          for (const f of this.fighters) {
            if (f.dead || this.sameTeam(z.owner, f)) continue;
            if (Math.hypot(f.x - z.x, (f.y - 26) - z.y) <= z.r + f.r * 0.5) {
              this.damage(z.owner, f, z.dmg, { type: z.dmgType || "skill", kb: z.kb || 200, from: z, hitDir: Math.atan2(f.y - z.y, f.x - z.x) });
              if (z.slow) f.slowT = Math.max(f.slowT || 0, z.slow);
            }
          }
          FX.burst(z.x, z.y, 26, ["#fb923c", "#fde68a", "#fff"], { speed: 300 });
          FX.ring(z.x, z.y, z.r, "rgba(251,146,60,.95)", 6, 0.45);
          z.hit = true;
        }
        if (z.life % 0.06 < dt) FX.trail(z.x + rand(-z.r, z.r), z.y + rand(-10, 10), "#fb923c", 5, 0.3);
      }
      if (z.type === "frost") {
        if (z.life % 0.09 < dt) FX.trail(z.x + rand(-z.r * 0.7, z.r * 0.7), z.y + rand(-6, 8), "#bfdbfe", 3, 0.3);
        for (const f of this.fighters) {
          if (f.side === z.owner.side || f.dead || f.kind !== "hero" || this.sameTeam(z.owner, f)) continue;
          if (Math.hypot(f.x - z.x, f.y - z.y) > z.r + f.r) { z.hits["s" + f.side] = 0; continue; }
          const key = "t" + f.side;
          z.hits[key] = (z.hits[key] || 0) + dt;
          if (z.hits[key] >= (z.tick || 0.3)) {         // 冰痕冻伤：每 0.3 秒 6 点 + 减速（寒霜领域可自定义数值）
            z.hits[key] = 0;
            f.slowT = Math.max(f.slowT || 0, 0.5);
            this.damage(z.owner, f, z.dmg || 6, { type: "dot", kb: 0, from: z.owner });
            FX.burst(f.x, f.y - 20, 6, ["#bfdbfe", "#fff"], { speed: 110 });
          }
        }
      }
      if (z.type === "fire") {
        // 火男光环：跟随释放者，范围内敌人每 tick 掉血
        if (z.owner && !z.owner.dead) { z.x = z.owner.x; z.y = z.owner.y; }
        if (z.life % 0.07 < dt) FX.trail(z.x + rand(-z.r * 0.8, z.r * 0.8), z.y - 26 + rand(-z.r * 0.4, z.r * 0.4), "#fb923c", 5, 0.35);
        for (const f of this.fighters) {
          if (f.side === z.owner.side || f.dead || f.kind !== "hero" || this.sameTeam(z.owner, f)) continue;
          if (Math.hypot(f.x - z.x, (f.y - 26) - z.y) > z.r + f.r) continue;
          const key = "t" + f.side;
          z.hits[key] = (z.hits[key] || 0) + dt;
          if (z.hits[key] >= z.tick) {
            z.hits[key] = 0;
            this.damage(z.owner, f, z.dmg, { type: "dot", kb: 0, from: z.owner });
            FX.burst(f.x, f.y - 22, 6, ["#fb923c", "#fde68a"], { speed: 120 });
          }
        }
      }
      if (z.type === "water") {
        // 水之呼吸：水球环绕主人旋转，碰人掉血+减速；敌方飞行物可被吸收（每球上限 12 伤害）
        const o = z.owner;
        if (!o || o.dead) { z.life = z.max; }
        else {
          const ang = z.ang0 + z.life * z.spd;
          z.x = o.x + Math.cos(ang) * z.orbitR;
          z.y = (o.y - 26) + Math.sin(ang) * z.orbitR * 0.72;
          // 判定：水球圆（r=orbR）+ 身体补偿 hitPad（默认 32，v2.4.2 起放宽）
          const pad = z.hitPad != null ? z.hitPad : 32;
          for (const f of this.fighters) {
            if (f.side === o.side || f.dead || f.kind !== "hero" || this.sameTeam(o, f)) continue;
            if (Math.hypot(f.x - z.x, (f.y - 20) - z.y) > z.r + pad) continue;
            const key = "t" + f.side;
            z.hits[key] = (z.hits[key] || 0) + dt;
            if (z.hits[key] >= z.tick) {
              z.hits[key] = 0;
              f.slowT = Math.max(f.slowT || 0, 1.0);
              this.damage(o, f, z.dmg, { type: "skill", kb: 0, from: o });
              FX.burst(f.x, f.y - 24, 8, ["#67e8f9", "#fff"], { speed: 140 });
            }
          }
          // 吸收敌方飞行物（单球最多吸收 12 点，吸满即碎）
          for (let j = this.projs.length - 1; j >= 0; j--) {
            const q = this.projs[j];
            if (q.side === o.side || q.type === "hbomb" || q.type === "palm" || q.type === "hook") continue;
            if (Math.hypot(q.x - z.x, q.y - z.y) > z.r + q.r) continue;
            const take = Math.max(1, Math.round(q.dmg || 5));
            this.projs.splice(j, 1);
            z.abs += take;
            FX.burst(q.x, q.y, 8, ["#67e8f9", "#fff"], { speed: 150 });
            if (z.abs >= z.absorbMax) {           // 水球吸满 → 碎掉（提前结束）
              FX.ring(z.x, z.y, z.r * 2, "rgba(103,232,249,.9)", 5, 0.4);
              FX.float(z.x, z.y - 24, "水球碎了", "#67e8f9", 12);
              z.life = z.max;
              break;
            }
          }
        }
      }
      if (z.type === "shuriken") {
        // 螺旋手里剑：中速飞行 + 场地边缘反弹，范围内的敌人被中度吸引并持续掉血
        const ox = z.x, oy = z.y;
        z.x += z.vx * dt; z.y += z.vy * dt;
        if (z.x < 60 || z.x > B.world.w - 60) { z.vx *= -1; z.x = clamp(z.x, 60, B.world.w - 60); }
        if (z.y < B.world.pt || z.y > B.world.h - 40) { z.vy *= -1; z.y = clamp(z.y, B.world.pt, B.world.h - 40); }
        z.spin = (z.spin || 0) + dt * 9;
        z.dist = (z.dist || 0) + Math.hypot(z.x - ox, z.y - oy);   // 累计飞行距离
        if (z.life % 0.06 < dt) FX.trail(z.x + rand(-z.r, z.r) * 0.5, z.y + rand(-z.r, z.r) * 0.5, "#38bdf8", 6, 0.35);
        for (const f of this.fighters) {
          if (f.side === z.owner.side || f.dead || f.kind !== "hero" || this.sameTeam(z.owner, f)) continue;
          const dx = z.x - f.x, dy = z.y - (f.y - 26);
          const d = Math.hypot(dx, dy) || 1;
          if (d < z.pullR && d > 1) {                     // 中度吸引：越近吸得越轻，防止完全吸死
            const k = (z.pull || 120) * dt * (0.35 + 0.65 * (1 - d / z.pullR));
            f.x += dx / d * k; f.y += dy / d * k;
          }
          if (d <= z.r + f.r) {
            const key = "t" + f.side;
            z.hits[key] = (z.hits[key] || 0) + dt;
            if (z.hits[key] >= z.tick) {
              z.hits[key] = 0;
              this.damage(z.owner, f, z.dmg, { type: "ult", kb: 0, from: z.owner });
              FX.burst(f.x, f.y - 24, 8, ["#38bdf8", "#fff"], { speed: 150 });
            }
          }
        }
        /* v2.7：飞出设定距离 → 中等范围爆炸，额外 25 点伤害，然后直接消散 */
        if (!z.boomed && z.dist >= z.boomDist) {
          z.boomed = true;
          this.shurikenBoom(z);
          z.life = z.max;                                  // 提前结束
        }
      }
      if (z.type === "prison") {
        // 绝望囚牢：0.8s 成形后才生效；圈内对手被禁言（禁技能与大招，普攻不受影响）
        const formed = z.life >= (z.formT || 0);
        if (formed && z.owner && !z.owner.dead) {
          for (const f of this.fighters) {
            if (f.dead || f.kind !== "hero" || f.side === z.owner.side || this.sameTeam(z.owner, f)) continue;
            if (Math.hypot(f.x - z.x, f.y - z.y) <= z.r) f.silenceT = Math.max(f.silenceT || 0, 0.2);
          }
        }
        if (z.life % 0.12 < dt) {
          const a = z.life * 1.8;
          FX.trail(z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r, "#c4b5fd", 4, 0.4);
          FX.trail(z.x - Math.cos(a) * z.r, z.y - Math.sin(a) * z.r, "#a78bfa", 4, 0.4);
        }
      }
      if (z.type === "quake") {
        // 霜压：以施法点为中心的延迟冲击波，预警后一次性结算 + 击退
        if (z.life < z.warn) FX.trail(z.x + rand(-z.r, z.r) * 0.7, z.y + rand(-z.r, z.r) * 0.35, "#93c5fd", 4, 0.3);
        else if (!z.hit) {
          z.hit = true;
          FX.ring(z.x, z.y, z.r, "rgba(147,197,253,.95)", 8, 0.5);
          FX.shake(12);
          for (const f of this.fighters) {
            if (f.side === z.owner.side || f.dead || this.sameTeam(z.owner, f)) continue;
            if (Math.hypot(f.x - z.x, (f.y - 20) - z.y) <= z.r + f.r)
              this.damage(z.owner, f, z.dmg, { type: "skill", kb: 320, from: z, hitDir: Math.atan2(f.y - z.y, f.x - z.x) });
          }
        }
      }
      if (z.type === "zero") {
        // 绝对零度：以施法点为圆心的安全区，读条结束后圈外敌人受伤 + 冻结
        if (z.life < z.warn) {
          // 预警阶段在渲染层画圈（见 worldDraw 的 zero 分支）
        } else if (!z.hit) {
          z.hit = true;
          FX.flash(0.3, "191,219,254"); FX.shake(14);
          for (const f of this.fighters) {
            if (f.side === z.owner.side || f.dead || this.sameTeam(z.owner, f)) continue;
            const out = Math.hypot(f.x - z.x, (f.y - 20) - z.y) > z.r;
            if (out) {
              this.damage(z.owner, f, z.dmg, { type: "ult", kb: 0, from: z.owner });
              B.applyStun(f, z.stun);
              FX.float(f.x, f.y - 60, "冻结！", "#7dd3fc", 16);
            }
          }
        }
      }
      if (z.type === "roul" || z.type === "bolt") {
        // 俄罗斯轮盘 / 雷暴：预警圈 → 一次性结算
        if (z.life < z.warn) {
          if (z.life % 0.08 < dt) FX.trail(z.x + rand(-z.r * 0.5, z.r * 0.5), z.y + rand(-z.r * 0.25, z.r * 0.25),
            z.type === "roul" ? (z.big ? "#f87171" : "#34d399") : "#a78bfa", 4, 0.3);
        } else if (!z.hit) {
          z.hit = true;
          FX.ring(z.x, z.y, z.r, z.type === "roul" ? (z.big ? "rgba(248,113,113,.95)" : "rgba(52,211,153,.9)") : "rgba(167,139,250,.95)", 6, 0.4);
          FX.burst(z.x, z.y - 12, 16, z.type === "roul" ? ["#fde68a", "#fff"] : ["#c4b5fd", "#fff"], { speed: 260 });
          for (const f of this.fighters) {
            if (f.side === z.owner.side || f.dead || this.sameTeam(z.owner, f)) continue;
            if (Math.hypot(f.x - z.x, (f.y - 20) - z.y) <= z.r + f.r)
              this.damage(z.owner, f, z.dmg, { type: z.big || z.type === "bolt" ? "ult" : "skill", kb: 160, from: z.owner });
          }
        }
      }
      if (z.life >= z.max + (z.warn || 0)) this.zones.splice(i, 1);
    }
  };



})(window.LD = window.LD || {});
