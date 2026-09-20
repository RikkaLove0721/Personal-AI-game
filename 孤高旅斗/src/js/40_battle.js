/* ============================================================
 *  40_battle.js — 战斗引擎：实体 / 弹道 / 技能实现 / 伤害与能量
 * ============================================================ */
(function (LD) {
  "use strict";
  const C = LD.CONF, TAU = Math.PI * 2;
  const FX = LD.FX, V = LD.View;
  const clamp = V.clamp;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const B = LD.Battle = {
    W: C.W, H: C.H,
    mode: "dragon",       // dragon | duel | net
    diff: LD.DIFF.normal,
    level: null,
    isHost: true,         // net 模式下自己是不是权威端
    mySide: 0,
    fighters: [],
    projs: [],
    zones: [],            // 持续存在的判定区域（火柱、激光等）
    t: 0,
    state: "idle",        // idle | countdown | fight | roundEnd | over
    roundT: 0, round: 1, score: [0, 0], roundWinner: -1, matchWinner: -1,
    countdown: 0,
    onEnd: null, onRoundEnd: null,
    ev: [],               // 需要广播的特效事件
    theme: {},
    arenaShake: 0
  };

  /* ==========================================================
   *  实体
   * ========================================================== */
  B.mkHero = function (side, opts) {
    opts = opts || {};
    const lo = opts.loadout || LD.DEFAULT_LOADOUT;
    return {
      kind: "hero", side, id: side,
      x: opts.x, y: opts.y, r: 16, vx: 0, vy: 0,
      facing: { x: side === 0 ? 1 : -1, y: 0 },
      hp: C.hero.hp, maxHp: C.hero.hp,
      energy: opts.energy || 0, maxEnergy: C.energy.max,
      look: opts.look || LD.Profile.look(),
      loadout: lo,
      slot: { basic: st(), skill1: st(), skill2: st(), ult: st() },
      cd: { basic: 0, skill1: 0, skill2: 0, ult: 0, dodge: 0 },
      parryT: 0, parryHold: false,
      stun: 0, root: 0, invuln: 0, dead: false,
      shield: 0, shieldT: 0,
      blind: 0,                    // 视野被遮挡剩余秒数（粪击）
      slowT: 0,                    // 减速剩余秒数（冰痕 / 苍）
      stealthT: 0,                 // 隐匿剩余秒数（>0 = 隐身）
      silenceT: 0,                 // 被囚牢禁言剩余判定（圈内持续刷新）
      knockLeft: 0, knockA: 0, knockWall: false,   // 赫的定向击飞（剩余距离/方向/撞墙惩罚）
      hpHist: [],                  // 血量历史（败者食尘：回溯 3 秒）
      kingMark: null,              // 王从天降：红圈记号 {x, y, global}
      lock: -1,                    // 索敌：锁定的目标座位（-1 = 自动选最近）
      team: opts.team == null ? -1 : opts.team,   // 阵营模式 0-3；-1 表示无阵营
      overlord: false,             // 霸主争霸：是否持有能量石
      buff: { rage: 0, thousand: 0, rush: 0 },
      meditate: 0, meditInterrupt: false,
      atkAnim: 0, atkDur: 0.42, hitFlash: 0, walkPhase: 0, moving: false,
      blinkAmt: 1, blinkT: rand(1, 4),
      enGainT: 0, dmgDealt: 0, dmgTaken: 0, kills: 0,
      isBot: !!opts.isBot, isRemote: false, name: opts.name || (side === 0 ? "勇者" : "对手")
    };
    function st() { return { on: false, phase: "", t: 0, d: {} }; }
  };

  B.mkDragon = function (opts) {
    opts = opts || {};
    /* diff 允许传 DIFF 对象，也允许传 "normal"/"hard" 字符串键，传错也不会得到 NaN 血量 */
    let diff = opts.diff || LD.DIFF.normal;
    if (typeof diff === "string") diff = LD.DIFF[diff] || LD.DIFF.normal;
    const D = LD.DRAGON;
    return {
      kind: "dragon", side: 1, id: 1,
      x: C.W * 0.70, y: C.H * 0.54, r: D.r,
      facing: { x: -1, y: 0 },
      hp: Math.round(D.hp * diff.hpM), maxHp: Math.round(D.hp * diff.hpM),
      look: null, energy: 0, maxEnergy: 150, enGainT: 0, dmgDealt: 0, dmgTaken: 0, kills: 0,   // 与玩家一致：大招需攒满 150；enGainT 让巨龙也能命中/受击回能
      buff: { rage: 0, thousand: 0, rush: 0 },
      mode: "idle", modeT: 0, cd: { basic: 1.2, skill1: 3.0, ult: D.ult.cd * 0.55 },
      charge: 0, chargeMax: 0, chargeKind: "",
      dashVX: 0, dashVY: 0, telegraph: null,
      hitFlash: 0, stun: 0, invuln: 0, dead: false, slow: 0,
      rageStage: 0, name: "熔核巨龙"
    };
  };

  /* ==========================================================
   *  初始化
   * ========================================================== */
  B.setup = function (cfg) {
    this.mode = cfg.mode;
    this.rule = cfg.rule || "brawl";     // brawl 乱斗 | team 阵营 | overlord 霸主争霸
    this.diff = cfg.diff || LD.DIFF.normal;
    this.level = cfg.level || null;
    this.theme = cfg.theme || {};
    this.isHost = cfg.isHost !== false;
    this.mySide = cfg.mySide || 0;
    this.fighters = cfg.fighters;
    this.fighters.forEach(f => { f.id = f.side; if (f.team == null) f.team = -1; });
    if (cfg.teams) cfg.teams.forEach((t, i) => { if (this.fighters[i]) this.fighters[i].team = t; });
    this.projs = []; this.zones = []; this.ev = []; this.stone = null;
    this.t = 0; this.score = this.fighters.map(() => 0); this.round = 1; this.matchWinner = -1; this.roundWinner = -1;
    this.countdown = this.mode === "dragon" ? 1.6 : 2.0;
    this.state = "countdown";
    LD.Cine.active = false;      // 清掉可能残留的大招演出
    FX.clear();
    return this;
  };

  B.hero = function (side) { return this.fighters.find(f => f.side === side && f.kind === "hero"); };
  /* 阵营：同队视为友军（无敌伤害）；team 为 -1 时不算友军 */
  B.sameTeam = function (a, b) {
    if (!a || !b || a === b) return false;
    if (a.team == null || b.team == null) return false;
    return a.team >= 0 && a.team === b.team;
  };
  B.foeOf = function (f) {
    /* 混战下取最近的存活对手；没有存活的再退回任意对端 */
    let best = null, bd = Infinity;
    this.fighters.forEach(o => {
      if (o === f || o.dead) return;
      if (this.sameTeam(f, o)) return;
      const d = (o.x - f.x) * (o.x - f.x) + (o.y - f.y) * (o.y - f.y);
      if (d < bd) { bd = d; best = o; }
    });
    if (best) return best;
    return this.fighters.find(o => o.side !== f.side) || null;
  };
  /* 索敌：优先取手动锁定的目标（V 键切换），失效时退回最近对手 */
  B.lockTarget = function (f) {
    if (f.lock != null && f.lock >= 0) {
      const t = this.fighters.find(o => o.side === f.lock);
      if (t && !t.dead && !this.sameTeam(f, t)) return t;
    }
    return null;
  };
  B.aimFoe = function (f) { return this.lockTarget(f) || this.foeOf(f); };
  /* V 键：在存活敌人之间循环切换索敌目标 */
  B.cycleLock = function (f, dir) {
    const foes = this.fighters.filter(o => o !== f && !o.dead && !this.sameTeam(f, o)).sort((a, b) => a.side - b.side);
    if (!foes.length) { f.lock = -1; return null; }
    const d = dir < 0 ? -1 : 1;
    let i = foes.findIndex(o => o.side === f.lock);
    i = i < 0 ? (d > 0 ? 0 : foes.length - 1) : (i + d + foes.length) % foes.length;
    f.lock = foes[i].side;
    FX.ring(foes[i].x, foes[i].y - 66, 40, "rgba(252,211,77,.95)", 4, 0.35);
    return foes[i];
  };
  B.alive = function (side) { const f = this.fighters.find(o => o.side === side); return f && !f.dead; };

  B.resetRound = function (keepScore) {
    /* 开局位置随机：勇者出生点在场地中下部随机抽取，彼此保持最小间距（巨龙保留原出生点） */
    const placed = [];
    this.fighters.forEach(f => {
      if (f.kind === "hero") {
        let bx = C.W * 0.5, by = C.H * 0.6;
        for (let tries = 0; tries < 40; tries++) {
          const tx = C.W * (0.12 + Math.random() * 0.76);
          const ty = C.H * (0.42 + Math.random() * 0.46);
          if (placed.every(p => Math.hypot(p.x - tx, p.y - ty) > 170)) { bx = tx; by = ty; break; }
        }
        placed.push({ x: bx, y: by });
        f.x = bx; f.y = by;
      }
      f.hp = f.maxHp; f.dead = false; f.stun = 0; f.root = 0; f.invuln = 0;
      f.vx = 0; f.vy = 0; f.moving = false;
      f.shield = 0; f.shieldT = 0; f.hitFlash = 0; f.blind = 0; f.slowT = 0;
      f.stealthT = 0; f.silenceT = 0; f.knockLeft = 0; f.knockWall = false;
      f.kingMark = null; f.hpHist = [{ t: this.t || 0, hp: f.hp }];
      f.buff = { rage: 0, thousand: 0, rush: 0 };
      f.meditate = 0; f.parryT = 0; f.atkAnim = 0;
      if (f.kind === "hero") f.energy = 0;
      if (f.cd) {
        f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.dodge = 0;
        /* 勇者开局大招短延迟；巨龙用 ultFirst（大幅延后首次开大） */
        f.cd.ult = f.kind === "dragon" ? ((LD.DRAGON.ult && LD.DRAGON.ult.ultFirst) || 12) : 1.5;
      }
      Object.keys(f.slot || {}).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
      f.lock = -1;                                        // 索敌锁定每回合重置
      if (f.kind === "dragon") { f.mode = "idle"; f.modeT = 0; f.charge = 0; f.telegraph = null; f.rageStage = 0; }
      if (this.rule === "overlord") f.overlord = false;   // 霸主标记每回合重置
    });
    this.projs = []; this.zones = [];
    this.stone = null;                                  // 能量石（霸主争霸）
    this.dragonCorpseT = 0;
    this.roundT = (this.mode === "dragon" || this.rule === "overlord") ? 0 : 75;   // 每回合重置限时
    this.countdown = 2.0; this.state = "countdown"; this.roundWinner = -1;
    if (!keepScore) { this.score = this.fighters.map(() => 0); this.round = 1; }
    FX.clear();
  };

  /* ==========================================================
   *  通用动作 API
   * ========================================================== */
  B.endSlot = function (f, slot, cd, opt) {
    const s = f.slot[slot];
    s.on = false; s.phase = ""; s.t = 0; s.d = {};
    if (cd != null) {
      f.cd[slot] = cd;
      // 普攻与闪避共享 CD：普攻出手也会锁住闪避。
      // 格挡虽然归入普攻分类，但它的反制 CD 不该连带锁死闪避，故用 opt.noShare 跳过。
      if (slot === "basic" && !(opt && opt.noShare) && f.cd.dodge !== undefined)
        f.cd.dodge = Math.max(f.cd.dodge || 0, cd);
    }
  };

  /** 当前正在格挡的槽位（v2.0 起格挡属于普攻，J/K/L 任意槽都可能装它） */
  B.parrySlot = function (f) {
    const s = f.slot || {};
    if (s.basic && s.basic.phase === "parry") return "basic";
    if (s.skill1 && s.skill1.phase === "parry") return "skill1";
    if (s.skill2 && s.skill2.phase === "parry") return "skill2";
    return null;
  };

  B.spawnProj = function (o) {
    const p = {
      x: o.x, y: o.y, vx: o.vx, vy: o.vy, r: o.r || 9, dmg: o.dmg != null ? o.dmg : 10,
      owner: o.owner, side: o.owner.side, life: 0, maxLife: o.life || 2,
      color: o.color || "#fb923c", core: o.core || "#fef3c7",
      type: o.type || "fireball", pierce: !!o.pierce, reflect: !!o.reflect,
      absorb: o.absorb || 0, absorbed: 0, tick: o.tick || 0, tickMax: o.tickMax || 0,
      hits: {}, data: o.data || {}, homing: o.homing || 0, scale: o.scale || 1,
      root: o.root || 0, stun: o.stun || 0, blind: o.blind || 0, trail: !!o.trail, spin: 0, kindTag: o.kindTag || "skill",
      boomerang: !!o.boomerang
    };
    this.projs.push(p);
    return p;
  };

  B.melee = function (f, o) {
    const foe = this.foeOf(f);
    if (!foe || foe.dead) return 0;
    const dx = foe.x - f.x, dy = foe.y - f.y;
    const d = Math.hypot(dx, dy);
    if (d > o.reach + foe.r + f.r) return 0;
    const ang = Math.atan2(dy, dx);
    const fa = Math.atan2(f.facing.y, f.facing.x);
    let da = Math.abs(((ang - fa + Math.PI * 3) % TAU) - Math.PI);
    if (da > (o.half || 1.0)) return 0;
    this.damage(f, foe, o.dmg, { type: o.type || "basic", kb: o.kb, stun: o.stun, from: f, basic: !!o.basic });
    return 1;
  };

  /* ==========================================================
   *  伤害 / 治疗 / 状态
   * ========================================================== */
  B.damage = function (src, tgt, amt, o) {
    o = o || {};
    if (!tgt || tgt.dead || !(amt > 0)) return 0;   // !(amt>0) 同时挡住 NaN / 负数 / 0
    if (this.sameTeam(src, tgt)) return 0;          // 阵营模式：同阵营之间不造成伤害
    if (tgt.invuln > 0) { this.ev.push(["t", tgt.x, tgt.y - 40, "闪", "#9fb3dd"]); return 0; }

    // ---- 格挡判定（挡普攻 2 秒 CD；挡技能 / 大招 8 秒 CD） ----
    if (tgt.kind === "hero" && tgt.parryT > 0 && o.parryable !== false) {
      return this.doParry(tgt, src, o);
    }

    let dmg = amt;
    let crit = false;
    if (src && src.kind === "hero" && o.type !== "dot" && Math.random() < C.critRate) { crit = true; dmg = Math.round(dmg * C.critMul); }

    // ---- 护盾吸收 ----
    if (tgt.shield > 0) {
      const use = Math.min(tgt.shield, dmg);
      tgt.shield -= use; dmg -= use;
      FX.burst(tgt.x, tgt.y - 26, 8, "#fcd34d", { speed: 150, dir: Math.random() * TAU });
      if (tgt.shield <= 0) this.shieldBreak(tgt, src);
      if (dmg <= 0) { FX.float(tgt.x, tgt.y - 42, "格挡 " + use, "#fcd34d", 13); return 0; }
    }

    tgt.hp = Math.max(0, tgt.hp - dmg);
    tgt.hitFlash = 0.16;
    tgt.dmgTaken += dmg;
    if (tgt.kind === "hero") tgt.blinkAmt = 0.1;

    // 受击回能
    if (tgt.enGainT !== undefined && tgt.enGainT <= 0) { tgt.energy = Math.min(tgt.maxEnergy, tgt.energy + C.energy.onHurt); tgt.enGainT = 0.25; }
    // 命中回能 / 吸血
    if (src) {
      src.dmgDealt += dmg;
      if (src.enGainT !== undefined) {
        if (src.enGainT <= 0) { src.energy = Math.min(src.maxEnergy, src.energy + C.energy.onHit); src.enGainT = 0.25; }
        if (src.buff && src.buff.rage > 0) {
          const heal = Math.round(dmg * 0.5);
          if (heal > 0) { src.hp = Math.min(src.maxHp, src.hp + heal); FX.float(src.x, src.y - 50, "+" + heal, "#f472b6", 13); }
        }
        if (o.heal) { src.hp = Math.min(src.maxHp, src.hp + o.heal); FX.float(src.x, src.y - 50, "+" + o.heal, "#34d399", 14); }
      }
    }

    // ---- 反馈 ----
    const isBig = o.type === "ult";
    FX.burst(tgt.x, tgt.y - 26, isBig ? 26 : (crit ? 16 : 11), crit ? ["#fde68a", "#fff"] : ["#ffd9de", "#ffffff", "#fca5a5"],
      { speed: isBig ? 330 : 220, dir: o.hitDir == null ? null : o.hitDir });
    FX.ring(tgt.x, tgt.y - 24, isBig ? 70 : 34, isBig ? "rgba(251,146,60,.9)" : "rgba(255,255,255,.8)", isBig ? 5 : 3, 0.32);
    FX.float(tgt.x + rand(-8, 8), tgt.y - 46, (crit ? "暴击 " : "") + Math.round(dmg), crit ? "#fbbf24" : (isBig ? "#fb923c" : "#fff"), crit ? 20 : 15);
    FX.hitstop(isBig ? C.hitstop.ult : C.hitstop.hit);
    FX.shake(isBig ? C.shake.ult : (crit ? C.shake.parry : C.shake.hit));
    this.ev.push(["h", tgt.x, tgt.y - 46, (crit ? "暴击 " : "") + Math.round(dmg), crit ? "#fbbf24" : "#fff"]);

    if (o.stun) this.applyStun(tgt, o.stun);
    if (o.blind && tgt.kind === "hero") {
      tgt.blind = Math.max(tgt.blind || 0, o.blind);
      FX.float(tgt.x, tgt.y - 66, "致盲 " + o.blind + "s", "#a16207", 15);
      this.ev.push(["b", tgt.x, tgt.y - 66, "致盲 " + o.blind + "s", "#a16207"]);
    }
    if (o.kb) this.knock(tgt, o.from || src, o.kb);
    else if (o.kbDist) this.knockDist(tgt, o.from || src, o.kbDist, o.wallHit);
    if (tgt.hp <= 0) this.kill(tgt, src);

    // 被击打断冥想
    if (tgt.kind === "hero" && tgt.meditate > 0) {
      tgt.meditate = 0; tgt.meditInterrupt = true;
      if (tgt.slot.skill1.phase === "meditate") B.endSlot(tgt, "skill1", LD.skill(tgt.loadout.skill1) ? LD.skill(tgt.loadout.skill1).cd : 4.5);
      if (tgt.slot.skill2.phase === "meditate") B.endSlot(tgt, "skill2", LD.skill(tgt.loadout.skill2) ? LD.skill(tgt.loadout.skill2).cd : 4.5);
      this.applyStun(tgt, 1.0);
      FX.float(tgt.x, tgt.y - 58, "打断！", "#a78bfa", 16);
    }
    // 被打断瞬身蓄力
    if (tgt.kind === "hero") {
      const bk = tgt.slot.skill1.phase === "blinkCharge" ? "skill1" : tgt.slot.skill2.phase === "blinkCharge" ? "skill2" : null;
      if (bk) { B.endSlot(tgt, bk, 7.5); this.applyStun(tgt, 0.6); FX.float(tgt.x, tgt.y - 58, "蓄力被打断", "#f87171", 14); }
    }
    return dmg;
  };

  B.doParry = function (tgt, src, o) {
    tgt.parryT = 0;
    const blockedBasic = !!o.basic;
    const cd = blockedBasic ? C.parry.cdBasic : C.parry.cdSkill;   // 反制 CD：见 CONF.parry（balance.js 可调）
    const ps = this.parrySlot(tgt);
    if (ps) B.endSlot(tgt, ps, cd, { noShare: true });
    else tgt.cd.basic = cd;
    FX.hitstop(C.hitstop.parry);
    FX.shake(C.shake.parry);
    FX.flash(0.30, "150,220,255");
    FX.ring(tgt.x, tgt.y - 26, 76, "rgba(150,230,255,.95)", 5, 0.42);
    FX.burst(tgt.x, tgt.y - 26, 22, ["#a5f3fc", "#ffffff", "#7fe6f7"], { speed: 300 });
    FX.float(tgt.x, tgt.y - 62, "弹反！", "#7fe6f7", 22);
    this.ev.push(["p", tgt.x, tgt.y - 56, "弹反！", "#7fe6f7"]);
    if (src && src.kind === "hero") {
      src.stun = Math.max(src.stun, 0.45);
      this.knock(src, tgt, 260);
    }
    if (src) { src.hp = Math.max(0, src.hp - 8); FX.float(src.x, src.y - 46, "8", "#7fe6f7", 13); if (src.hp <= 0) this.kill(src, tgt); }
    return 0;
  };

  B.shieldBreak = function (f, by) {
    f.shield = 0; f.shieldT = 0;
    FX.ring(f.x, f.y - 26, 96, "rgba(252,211,77,.95)", 6, 0.45);
    FX.burst(f.x, f.y - 26, 30, ["#fcd34d", "#fbbf24", "#fff"], { speed: 320 });
    FX.shake(9); FX.hitstop(0.07);
    FX.float(f.x, f.y - 60, "护盾破碎！", "#fcd34d", 17);
    // 被敌人主动打爆 → 盾主人眩晕 0.6 秒（自然到期不触发）
    if (by && by !== f && !by.dead) {
      this.applyStun(f, 0.6);
      FX.float(f.x, f.y - 78, "眩晕 0.6s", "#fca5a5", 14);
    }
    const foe = this.foeOf(f);
    const s = LD.skill(f.loadout.skill1) && LD.skill(f.loadout.skill1).shield ? LD.skill(f.loadout.skill1) : LD.skill(f.loadout.skill2);
    const r = (s && s.breakR) || 78, dmg = (s && s.dmg) || 16;
    if (foe && !foe.dead && dist(f, foe) <= r + foe.r) this.damage(f, foe, dmg, { type: "skill", kb: 240, from: f, hitDir: Math.atan2(foe.y - f.y, foe.x - f.x) });
  };

  B.applyStun = function (f, t) { if (f.kind === "dragon") return; f.stun = Math.max(f.stun, t); };
  B.knock = function (f, from, force) {
    if (!from || f.kind === "dragon") return;
    const a = Math.atan2(f.y - from.y, f.x - from.x);
    f.vx += Math.cos(a) * force; f.vy += Math.sin(a) * force;
  };

  /* 定向击飞（赫）：按固定距离位移，撞到墙体（边界 / 绝望囚牢圈壁）会额外受伤 */
  B.knockDist = function (f, from, dist, wallHit) {
    if (!from || f.kind === "dragon") return;
    f.knockA = Math.atan2(f.y - from.y, f.x - from.x);
    f.knockLeft = dist;
    f.knockWall = !!wallHit;
  };

  /* 每帧定向击飞位移 + 撞墙判定。返回 true 表示本帧发生了撞墙 */
  B.knockStep = function (f, dt) {
    if (f.knockLeft <= 0) return false;
    const spd = 2300;
    const step = Math.min(f.knockLeft, spd * dt);
    f.x += Math.cos(f.knockA) * step;
    f.y += Math.sin(f.knockA) * step;
    f.knockLeft -= step;
    return false;   // 撞墙由位置钳制后的 wallCheck 统一判定
  };

  /* 击飞撞墙判定：位置已被钳到边界或囚牢圈壁时调用 */
  B.wallHit = function (f) {
    if (f.knockLeft <= 0 || !f.knockWall) return false;
    f.knockLeft = 0;
    f.knockWall = false;
    const dmg = LD.skill("he") ? LD.skill("he").wallDmg : 10;
    const stun = LD.skill("he") ? LD.skill("he").wallStun : 0.4;
    this.damage(null, f, dmg, { type: "dot", kb: 0 });
    f.stun = Math.max(f.stun, stun);
    FX.burst(f.x, f.y - 26, 16, ["#fca5a5", "#fff"], { speed: 240 });
    FX.float(f.x, f.y - 60, "撞墙！", "#f87171", 16);
    this.ev.push(["h", f.x, f.y - 60, "撞墙！", "#f87171"]);
    FX.shake(8);
    return true;
  };

  B.heal = function (f, amt) { f.hp = Math.min(f.maxHp, f.hp + amt); };

  B.kill = function (f, by) {
    if (f.dead) return;
    f.dead = true;
    FX.burst(f.x, f.y - 26, 40, ["#fff", "#fb7185", "#fbbf24"], { speed: 360, life: 0.9 });
    FX.ring(f.x, f.y - 26, 120, "rgba(255,255,255,.9)", 6, 0.6);
    FX.shake(16);
    if (by && by.kind === "hero") by.kills++;
    this.ev.push(["k", f.x, f.y - 26]);
    if (this.mode === "dragon") {
      if (f.side === 0) this.finish(false);
      else this.finish(true);
      return;
    }
    // 霸主争霸：巨龙被击败 → 爆出能量石（尸体 3 秒后消失）
    if (this.rule === "overlord" && f.kind === "dragon") { this.spawnStone(f.x, f.y); this.dragonCorpseT = 0; return; }
    // 霸主争霸：霸主阵亡 → 能量石掉回场上，重新争夺
    if (this.rule === "overlord" && f.overlord) { f.overlord = false; this.spawnStone(f.x, f.y); }
    // 霸主争霸：场上只剩一名存活勇者（巨龙不算）时回合结束
    if (this.rule === "overlord") {
      const alive = this.fighters.filter(x => !x.dead && x.kind === "hero");
      if (this.state === "fight" && alive.length <= 1)
        this.endRound(alive[0] ? alive[0].side : (by ? by.side : f.side));
      return;
    }
    // 阵营模式：只要本方还有人活着就继续打
    if (this.rule === "team") {
      if (this.state === "fight" && this.teamsAlive() <= 1) this.endRound(this.lastTeamSide());
      return;
    }
    if (this.fighters.length <= 2) {
      this.endRound(f.side === 0 ? 1 : 0);
    } else {
      /* 混战：只剩一人存活时结束回合；同归于尽则判击杀者获胜 */
      const alive = this.fighters.filter(x => !x.dead);
      if (alive.length === 1) this.endRound(alive[0].side);
      else if (alive.length === 0) this.endRound(by ? by.side : f.side);
    }
  };

  /* ---------------- 阵营模式辅助 ---------------- */
  B.teamsAlive = function () {
    const set = {};
    this.fighters.forEach(f => { if (!f.dead && f.team >= 0) set[f.team] = 1; });
    return Object.keys(set).length;
  };
  B.lastTeamSide = function () {
    const t = this.fighters.find(f => !f.dead && f.team >= 0);
    return t ? t.side : 0;
  };

  /* ---------------- 霸主争霸：能量石 ---------------- */
  B.spawnStone = function (x, y) {
    /* 能量石大距离随机散落：初速更快，保证飞出足够远而不是原地落下 */
    const a = Math.random() * TAU, sp = rand(560, 860);
    this.stone = { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, landed: false, holder: null };
    FX.ring(x, y - 26, 90, "rgba(252,211,77,.95)", 6, 0.5);
    FX.burst(x, y - 26, 30, ["#fcd34d", "#fff7d6", "#fbbf24"], { speed: 340 });
    FX.float(x, y - 70, "能量石！", "#fcd34d", 18);
    this.ev.push(["h", x, y - 70, "能量石！", "#fcd34d"]);
  };

  B.updateStone = function (dt) {
    const s = this.stone;
    if (!s) return;
    s.life += dt;
    if (!s.landed) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      const damp = Math.exp(-2.2 * dt); s.vx *= damp; s.vy *= damp;
      FX.trail(s.x, s.y, "#fcd34d", 6, 0.3);
      if (Math.hypot(s.vx, s.vy) < 40) { s.landed = true; s.vx = s.vy = 0; s.y = Math.max(s.y, C.H * 0.34); }
      s.x = clamp(s.x, 40, C.W - 40);
      s.y = clamp(s.y, C.H * 0.30, C.H - 46);
      return;
    }
    if (s.life % 0.1 < dt) FX.trail(s.x + rand(-10, 10), s.y - rand(6, 26), "#fcd34d", 4, 0.5);
    // 拾取判定
    for (const f of this.fighters) {
      if (f.dead || f.kind !== "hero") continue;
      if (Math.hypot(f.x - s.x, f.y - s.y) < f.r + 26) {
        this.becomeOverlord(f);
        this.stone = null;
        return;
      }
    }
  };

  B.becomeOverlord = function (f) {
    f.overlord = true;
    f.maxHp = Math.round(f.maxHp * 1.5);
    f.hp = Math.min(f.maxHp, Math.round(f.hp * 1.5));
    FX.ring(f.x, f.y - 26, 110, "rgba(252,211,77,.95)", 8, 0.6);
    FX.burst(f.x, f.y - 26, 36, ["#fcd34d", "#fff", "#fbbf24"], { speed: 340 });
    FX.flash(0.22, "252,211,77"); FX.shake(14);
    FX.float(f.x, f.y - 74, "霸主诞生！", "#fcd34d", 20);
    this.ev.push(["h", f.x, f.y - 74, "霸主诞生！", "#fcd34d"]);
  };

  /* ==========================================================
   *  技能实现
   * ========================================================== */
  const IMPL = LD.SKILL_IMPL;
  const pushTrail = (p) => { if (p.trail || p.type === "fireball" || p.type === "sword") FX.trail(p.x, p.y, p.color, p.r * 0.55, 0.26); };

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
          f.x = clamp(foe.x + Math.cos(a) * 40, 40, C.W - 40);
          f.y = clamp(foe.y + Math.sin(a) * 40, C.H * 0.30, C.H - 46);
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
      const ex = clamp(f.x + Math.cos(a) * sk.back, 40, C.W - 40);
      const ey = clamp(f.y + Math.sin(a) * sk.back, C.H * 0.30, C.H - 46);
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
      f.x = clamp(p.x, 40, C.W - 40);
      f.y = clamp(p.y + 26, C.H * 0.32, C.H - 40);
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
        o.x = clamp(f.x + Math.cos(a) * (f.r + o.r + 6), 40, C.W - 40);
        o.y = clamp(f.y + Math.sin(a) * (f.r + o.r + 6), C.H * 0.32, C.H - 40);
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
        B.damage(f, o, sk.dmg, { type: "skill", kbDist: sk.kbDist || 400, from: f,
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
          type: "sword", kindTag: "ult", trail: true });
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
          dmg: sk.dmg, tick: sk.tick, abs: 0, absorbMax: sk.absorbMax || 12 });
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
      f.invuln = Math.max(f.invuln, sk.rise + 0.3);
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
      const px = clamp(bx + rand(-90, 90), 60, C.W - 60);
      const py = clamp(by + rand(-60, 60), C.H * 0.34, C.H - 56);
      B.zones.push({ type: "pillar", x: px, y: py, r: sk.pillarR, life: 0, max: sk.dur, dmg: sk.dmg,
        owner: f, hit: false, color: "#fb923c", warn: sk.warn || 0.28 });
      FX.mark(px, py, sk.pillarR, "rgba(251,146,60,.95)", (sk.warn || 0.28) + sk.dur + 0.3, "circle");
      FX.shake(8);
    }
    if (s.d.n >= sk.pillars && s.t > sk.gap * sk.pillars + sk.dur) {
      B.endSlot(f, slot, sk.cd * (f.rateM || 1));
    }
  };

  /* ==========================================================
   *  工具
   * ========================================================== */
  function aimAt(f, impl) {
    const foe = B.aimFoe(f);   // 索敌优先：有锁定目标就朝他瞄准，否则取最近对手
    if (!foe || foe.dead) return f.facing;
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
  B.segHit = segHit;

  /* ==========================================================
   *  输入 → 动作
   * ========================================================== */
  B.SLOTS = ["basic", "skill1", "skill2", "ult"];

  B.trySlot = function (f, slot, ctrl) {
    if (f.dead || f.stun > 0 || Cine_paused()) return;
    const id = f.loadout[slot];
    const sk = LD.skill(id);
    if (!sk) { if (slot === "basic") flashNoSkill(f, slot); return; }
    // 绝望囚牢：圈内对手禁用技能与大招（普攻不受影响）
    if (sk.kind !== "basic" && f.silenceT > 0) {
      FX.float(f.x, f.y - 56, "被禁言了！", "#c4b5fd", 14);
      return;
    }
    // 隐匿期间使用普攻或技能 → 提前现形（隐匿进入冷却），本次攻击正常生效
    if (f.stealthT > 0 && slot !== f.stealthSlot) B.breakStealth(f);
    // 二段类技能（位移斩 / 飞雷神 / 王从天降等）：槽位进行中时再按一次触发第二段
    // 注意要在大招能量检查之前——二段不需要再消耗能量（一段已扣过）
    const cur = f.slot[slot];
    if (cur.on && IMPL[id] && IMPL[id].again && IMPL[id].again(f, slot, sk)) return;
    if (cur.on) return;
    // 大招能量
    if (sk.kind === "ult") {
      if (f.energy < f.maxEnergy) { FX.float(f.x, f.y - 56, "能量不足", "#9fb3dd", 13); return; }
    }
    if (f.cd[slot] > 0) return;
    if (f.meditate > 0) return;
    // 能量消耗
    if (sk.kind === "ult") f.energy = 0;
    IMPL[id].start(f, slot, sk, ctrl);
  };

  function flashNoSkill(f, slot) {
    if (f._noSkillT > 0) return; f._noSkillT = 0.8;
    FX.float(f.x, f.y - 56, "空槽位", "#9fb3dd", 12);
  }

  function Cine_paused() { return LD.Cine.active; }

  B.ctrlFire = function (f, ctrl, dt) {
    if (f.kind !== "hero") return;
    if (ctrl.lockNext) {                       // V 键：切换索敌目标
      const dir = ctrl.lockNext; ctrl.lockNext = 0;
      const t = this.cycleLock(f, dir);
      if (t) FX.float(f.x, f.y - 62, "锁定 " + (t.name || ("玩家" + (t.side + 1))), "#fcd34d", 14);
      else FX.float(f.x, f.y - 62, "无可锁定目标", "#9fb3dd", 13);
    }
    this.SLOTS.forEach(slot => {
      const sk = LD.skill(f.loadout[slot]);
      const pressing = ctrl.hold[slot];
      // 按住型技能
      if (sk && (sk.id === "parry")) f.parryHold = pressing;
      if (sk && sk.id === "meditate") {
        if (!pressing) IMPL.meditate.release(f, slot, sk);
      }
      if (ctrl.press[slot]) this.trySlot(f, slot, ctrl);
    });
    ctrl.press.basic = ctrl.press.skill1 = ctrl.press.skill2 = ctrl.press.ult = false;
  };

  /* ==========================================================
   *  主循环
   * ========================================================== */
  B.update = function (rdt) {
    if (this.state === "idle" || this.state === "over") return;
    FX.update(rdt);   // 特效（闪光/震屏/粒子）必须始终推进：大招演出会触发白屏闪光，
                      // 若在演出期间冻结 FX，闪光会卡在最高亮度，整个画面灰掉 2.6 秒
    if (LD.Cine.active) { LD.Cine.update(rdt); return; }

    let dt = rdt;
    if (FX.stop > 0) { FX.stop -= rdt; dt = 0; }
    if (dt <= 0) return;

    this.t += dt;
    this.fighters.forEach(f => { f.hitFlash = Math.max(0, f.hitFlash - dt); if (f._noSkillT) f._noSkillT = Math.max(0, f._noSkillT - dt); });

    if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.state = "fight"; FX.float(C.W / 2, C.H * 0.4, "开始！", "#7fe6f7", 30); }
      this.regen(dt);
      return;
    }
    if (this.state === "roundEnd") {
      this.roundT -= dt;
      this.updateProjs(dt); this.updateZones(dt); this.regen(dt);
      if (this.roundT <= 0) this.nextRound();
      return;
    }

    /* ---- fight ---- */
    this.fighters.forEach(f => {
      if (f.dead) return;
      f.enGainT = Math.max(0, (f.enGainT || 0) - dt);
      if (f.kind === "hero") this.updateHero(f, dt);
      else this.updateDragonBody(f, dt);
      // 技能持续更新
      this.SLOTS.forEach(slot => {
        const id = f.loadout && f.loadout[slot];
        if (!id) return;
        const sk = LD.skill(id);
        if (sk && IMPL[id] && IMPL[id].update) IMPL[id].update(f, slot, sk, dt);
      });
      if (f.kind === "dragon") {
        const sk = LD.DRAGON.ult;
        if (IMPL.d_ult.update) IMPL.d_ult.update(f, "ult", sk, dt);
        B.updateDragonPillars(f, "ult", sk, dt);
        if (LD.Cine.active) return;
      }
    });

    this.updateProjs(dt);
    this.updateZones(dt);
    if (this.rule === "overlord") {
      this.updateStone(dt);
      const dg = this.fighters.find(f => f.kind === "dragon");
      if (dg && dg.dead) this.dragonCorpseT = (this.dragonCorpseT || 0) + dt;   // 尸体 3 秒后消失
    }
    this.regen(dt);

    // 决斗模式倒计时
    if (this.mode !== "dragon") {
      this.roundT = (this.roundT || 75) - dt;
      if (this.roundT <= 0) {
        /* 超时：当前血量最高者赢下回合（平血按座位号） */
        const alive = this.fighters.filter(x => !x.dead && x.kind === "hero");
        let w = alive[0] || this.fighters[0];
        alive.forEach(x => { if (x.hp > w.hp) w = x; });
        this.endRound(w.side);
      }
    }
    // 越界修正 + 墙体（场地边界与绝望囚牢圈壁都视作墙体）
    this.fighters.forEach(f => {
      if (f.kind === "dragon") { f.x = clamp(f.x, 90, C.W - 90); f.y = clamp(f.y, C.H * 0.34, C.H - 70); return; }
      const px = f.x, py = f.y;
      f.x = clamp(f.x, 34, C.W - 34);
      f.y = clamp(f.y, C.H * 0.32, C.H - 40);
      if (f.x !== px || f.y !== py) this.wallHit(f);   // 被击飞撞到边界
      // 绝望囚牢圈壁：成形后是一堵圆形的墙——除释放者外无法进出，但不会被吸附到圈壁上
      const pz = this.zones.find(z => z.type === "prison" && z.owner !== f && !z.owner.dead && z.life >= (z.formT || 0));
      if (pz) {
        const prevX = f._px != null ? f._px : px, prevY = f._py != null ? f._py : py;
        const wasIn = Math.hypot(prevX - pz.x, prevY - pz.y) <= pz.r;
        const nowIn = Math.hypot(f.x - pz.x, f.y - pz.y) <= pz.r;
        if (wasIn !== nowIn) {   // 只在本帧试图穿越圈壁时挡回，平时不干预站位
          const a = Math.atan2(f.y - pz.y, f.x - pz.x) || 0;
          const rr = wasIn ? pz.r - f.r - 1 : pz.r + f.r + 1;
          f.x = pz.x + Math.cos(a) * rr;
          f.y = pz.y + Math.sin(a) * rr;
        }
      }
    });
  };

  B.regen = function (dt) {
    this.fighters.forEach(f => {
      if (f.dead) return;
      /* 冷却对所有角色递减（修复：原来写在 hero 分支里，巨龙 CD 永远不减 → 不攻击、不放技能） */
      f.cd.basic = Math.max(0, f.cd.basic - dt);
      f.cd.skill1 = Math.max(0, f.cd.skill1 - dt);
      f.cd.skill2 = Math.max(0, f.cd.skill2 - dt);
      f.cd.ult = Math.max(0, f.cd.ult - dt);
      if (f.cd.dodge !== undefined) f.cd.dodge = Math.max(0, f.cd.dodge - dt);
      if (f.kind !== "hero") {
        /* 巨龙没有按键回能，靠缓慢自然回复攒大招（玩家打它/被它打也会回能，见 damage()） */
        f.energy = Math.min(f.maxEnergy, f.energy + C.energy.regen * 0.55 * dt);
        return;
      }
      f.energy = Math.min(f.maxEnergy, f.energy + C.energy.regen * dt);
      if (f.shieldT > 0) { f.shieldT -= dt; if (f.shieldT <= 0 && f.shield > 0) { f.shield = 0; FX.float(f.x, f.y - 52, "护盾消失", "#9fb3dd", 12); } }
      if (f.blind > 0) f.blind = Math.max(0, f.blind - dt);
      if (f.slowT > 0) f.slowT = Math.max(0, f.slowT - dt);
      if (f.silenceT > 0) f.silenceT = Math.max(0, f.silenceT - dt);
      // 血量 / 位置历史（败者食尘：回溯约 3 秒的血量与位置）
      if (f.kind === "hero") {
        (f.hpHist = f.hpHist || []).push({ t: this.t, hp: f.hp });
        (f.posHist = f.posHist || []).push({ t: this.t, x: f.x, y: f.y });
        while (f.hpHist.length && f.hpHist[0].t < this.t - 3.6) f.hpHist.shift();
        while (f.posHist.length && f.posHist[0].t < this.t - 3.6) f.posHist.shift();
      }
      if (f.buff.rage > 0) f.buff.rage = Math.max(0, f.buff.rage - dt);
      if (f.buff.thousand > 0) f.buff.thousand = Math.max(0, f.buff.thousand - dt);
      if (f.buff.rush > 0 && f.slot.skill1.phase !== "rush" && f.slot.skill2.phase !== "rush") f.buff.rush = Math.max(0, f.buff.rush - dt);
    });
  };

  B.updateHero = function (f, dt) {
    // 记录本帧移动前的位置（绝望囚牢圈壁的穿越判定要用上一帧位置）
    f._px = f.x; f._py = f.y;
    // 眩晕 / 定身
    f.stun = Math.max(0, f.stun - dt);
    f.root = Math.max(0, f.root - dt);
    f.invuln = Math.max(0, f.invuln - dt);
    if (f.parryT > 0) f.parryT = Math.max(0, f.parryT - dt);
    // 眨眼
    f.blinkT -= dt;
    if (f.blinkT <= 0) { f.blinkT = rand(2.2, 5); f.blinkAmt = 0.12; }
    f.blinkAmt = Math.min(1, f.blinkAmt + dt * 12);

    // 击退速度衰减
    f.x += f.vx * dt; f.y += f.vy * dt;
    const damp = Math.exp(-7.5 * dt); f.vx *= damp; f.vy *= damp;
    // 赫的定向击飞（固定距离推进，撞墙由越界修正区判定）
    this.knockStep(f, dt);

    const ctrl = f.ctrl || { mx: 0, my: 0, hold: {}, press: {} };
    if (this.state === "fight") this.ctrlFire(f, ctrl, dt);

    // 双击方向键 → 短位移闪避（无无敌帧，CD 2.5 秒）
    if (ctrl.dodge) {
      const dv = ctrl.dodge; ctrl.dodge = null;
      // 激光蓄力中双击方向键 → 直接取消该技能（不然可以用位移把激光带到别的位置）
      const lz = f.slot.skill1.phase === "laserCharge" ? "skill1"
               : f.slot.skill2.phase === "laserCharge" ? "skill2" : null;
      const locked = ["dash", "bdash", "blinkCharge", "rush", "meditate"]
        .some(ph => f.slot.skill1.phase === ph || f.slot.skill2.phase === ph);
      if (lz) {
        B.endSlot(f, lz, 2);
        FX.float(f.x, f.y - 56, "已取消蓄力", "#67e8f9", 14);
        B.ev.push(["h", f.x, f.y - 56, "已取消蓄力", "#67e8f9"]);
      } else if (f.stun <= 0 && f.root <= 0 && f.meditate <= 0 && !locked && (f.cd.dodge || 0) <= 0) {
        const n = Math.hypot(dv.x, dv.y);
        if (n > 0.05) {
          const ux = dv.x / n, uy = dv.y / n, dd = C.dodge.dist;
          for (let i = 1; i <= 4; i++) FX.trail(f.x + ux * dd * i / 4, f.y - 26 + uy * dd * i / 4, "#9be8ff", 5, 0.35);
          f.x = clamp(f.x + ux * dd, 34, C.W - 34);
          f.y = clamp(f.y + uy * dd, C.H * 0.32, C.H - 40);
          f.facing = { x: ux, y: uy };
          f.cd.dodge = C.dodge.cd;
          f.cd.basic = Math.max(f.cd.basic, C.dodge.cd);   // 普攻与闪避共享 CD：闪避会锁住普攻
          FX.burst(f.x, f.y - 26, 10, ["#9be8ff", "#e0fbff"], { speed: 150, dir: Math.atan2(-uy, -ux), spread: 0.9 });
          FX.float(f.x, f.y - 56, "闪避", "#9be8ff", 13);
        }
      } else if ((f.cd.dodge || 0) > 0) {
        FX.float(f.x, f.y - 56, "闪避冷却中", "#9fb3dd", 12);
      }
    }

    // 移动
    let canMove = f.stun <= 0 && f.root <= 0 && f.meditate <= 0;
    let sp = C.hero.speed;
    if (f.parryT > 0) sp *= 0.42;
    const ls = f.slot.skill1.phase === "laserCharge" || f.slot.skill2.phase === "laserCharge";
    if (ls) canMove = false;   // 激光波蓄力期间无法移动，方向锁定为出手朝向
    if (f.slot.skill1.phase === "blinkCharge" || f.slot.skill2.phase === "blinkCharge") canMove = false;
    if (f.slot.skill1.phase === "dash" || f.slot.skill2.phase === "dash" ||
        f.slot.skill1.phase === "bdash" || f.slot.skill2.phase === "bdash") canMove = false;
    if (f.buff.rush > 0) sp *= LD.skill("meatRush").mul;
    if (f.slowT > 0) sp *= 0.55;   // 被冰痕 / 苍减速
    // 火男开启期间自身移速略微降低（可被其他减速叠加）
    const faOn = f.slot.skill1.phase === "fire" || f.slot.skill2.phase === "fire";
    if (faOn) sp *= (LD.skill("fireAura") && LD.skill("fireAura").moveMul) || 0.85;

    const mx = ctrl.mx || 0, my = ctrl.my || 0;
    const n = Math.hypot(mx, my);
    f.moving = false;
    if (canMove && n > 0.05) {
      const ux = mx / n, uy = my / n;
      f.x += ux * sp * dt; f.y += uy * sp * dt;
      f.facing = { x: ux, y: uy };
      f.walkPhase += dt * 11;
      f.moving = true;
      if (f.buff.rush > 0) FX.trail(f.x + rand(-10, 10), f.y - rand(2, 30), "#fbbf24", 4, 0.3);
    }
    f.atkAnim = Math.max(0, f.atkAnim - dt);
  };

  B.updateDragonBody = function (f, dt) {
    f.hitFlash = Math.max(0, f.hitFlash - dt);
    f.stun = 0;
    if (f.mode !== "skill1") { /* 冲刺位移在 IMPL 内处理 */ }
    // 缓慢面向玩家
    const foe = this.foeOf(f);
    if (foe && f.mode === "idle") {
      const dx = foe.x - f.x, dy = foe.y - f.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 240) { f.x += (dx / d) * LD.DRAGON.speed * dt; f.y += (dy / d) * LD.DRAGON.speed * dt; }
      f.facing = { x: dx / d, y: dy / d };
    }
  };

  B.updateProjs = function (dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.life += dt;
      if (p.type === "bomb") {
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
          const L = 26, T = C.H * 0.2 + 26;
          if (p.x < L || p.x > C.W - L) { p.x = Math.max(L, Math.min(C.W - L, p.x)); p.vx = 0; }
          if (p.y < T || p.y > C.H - 10) { p.y = Math.max(T, Math.min(C.H - 10, p.y)); p.vy = 0; }
          pushTrail(p);
        }
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.tick) p.spin = (p.spin || 0) + dt * 9;
      pushTrail(p);

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
      if (p.x < -60 || p.x > C.W + 60 || p.y < C.H * 0.2 - 80 || p.y > C.H + 60 || p.life > p.maxLife) {
        if (p.type !== "bomb") FX.burst(p.x, p.y, 6, p.color, { speed: 110 });
        this.projs.splice(i, 1);
        continue;
      }

      // 命中判定
      for (const f of this.fighters) {
        if (f.side === p.side || f.dead || this.sameTeam(p.owner, f)) continue;
        if (p.type === "hbomb") continue;   // 高压炸弹只按倒计时引爆
        if (Math.hypot(f.x - p.x, (f.y - 26) - p.y) > p.r + f.r) continue;

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
          this.damage(own, f, p.dmg, { type: "skill", stun: p.data.stun || 0.6, kb: 0, from: own });
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
            this.damage(p.owner, f, p.dmg, { type: "skill", kb: 140, from: p.owner,
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
            this.damage(p.owner, f, p.dmg, { type: "ult", stun: st, kb: 90, from: p.owner, basic: false });
          }
          if (p.hits[key] > p.tickMax) continue;   // 单个目标吃满伤害上限后不再吃
          continue;
        }

        this.damage(p.owner, f, p.dmg, { type: p.kindTag === "ult" ? "ult" : "skill",
          basic: !!p.basic, kb: p.pierce ? 90 : 130, from: p.owner,
          hitDir: Math.atan2(p.vy, p.vx), root: p.root, stun: p.stun, blind: p.blind });
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
        this.damage(p.owner, f, dmg, { type: "skill", kb: 300, stun: stun, from: p, hitDir: Math.atan2(f.y - p.y, f.x - p.x) });
      }
    }
    this.ev.push(["x", p.x, p.y, R]);
  };

  B.updateZones = function (dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life += dt;
      if (z.type === "pillar") {
        if (z.life > z.warn && !z.hit) {
          for (const f of this.fighters) {
            if (f.side === z.owner.side || f.dead) continue;
            if (Math.hypot(f.x - z.x, (f.y - 26) - z.y) <= z.r + f.r * 0.5) {
              this.damage(z.owner, f, z.dmg, { type: "skill", kb: 200, from: z, hitDir: Math.atan2(f.y - z.y, f.x - z.x) });
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
          if (z.hits[key] >= 0.3) {         // 冰痕冻伤：每 0.3 秒 6 点 + 减速
            z.hits[key] = 0;
            f.slowT = Math.max(f.slowT || 0, 0.5);
            this.damage(z.owner, f, 6, { type: "dot", kb: 0, from: z.owner });
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
          // 判定与水球模型一致：水球圆（r=17）+ 人物身体核心，不再用整段碰撞半径放大
          for (const f of this.fighters) {
            if (f.side === o.side || f.dead || f.kind !== "hero" || this.sameTeam(o, f)) continue;
            if (Math.hypot(f.x - z.x, (f.y - 20) - z.y) > z.r + 20) continue;
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
      if (z.life >= z.max + (z.warn || 0)) this.zones.splice(i, 1);
    }
  };

  /* ==========================================================
   *  回合 / 结算
   * ========================================================== */
  B.endRound = function (winner) {
    if (this.state !== "fight") return;
    this.roundWinner = winner;
    this.score[winner]++;
    this.state = "roundEnd"; this.roundT = 2.4;
    FX.shake(14);
    const w = this.fighters.find(f => f.side === winner);
    if (w) {
      FX.float(w.x, w.y - 70, "赢下这一局！", winner === 0 ? "#7fe6f7" : "#fb7185", 24);
      // 胜者特写：类似大招演出的逐字展示「胜者：xxx」
      if (w.kind === "hero")
        LD.Cine.start(w, "胜者：" + (w.name || ("玩家" + (w.side + 1))), "",
          w.team != null && w.team >= 0 ? (LD.TEAM_COLORS[w.team] || "#fcd34d") : "#fcd34d", "赢得了本局胜利");
    }
  };

  B.nextRound = function () {
    const champ = this.score.findIndex(v => v >= 2);
    if (champ >= 0) {
      this.matchWinner = champ;
      this.finish(champ === this.mySide);
      return;
    }
    this.round++;
    if (this.isHost || this.mode === "dragon") this.resetRound(true);
    this.state = "countdown"; this.countdown = 2.0;
  };

  B.finish = function (win) {
    if (this.state === "over") return;
    this.state = "over";
    if (this.onEnd) this.onEnd(win);
  };

  /* ==========================================================
   *  渲染
   * ========================================================== */
  B.draw = function (ctx) {
    const W = C.W, H = C.H;
    ctx.save();
    FX.applyShake(ctx);
    V.arena(ctx, W, H, this.t, this.theme);

    const worldDraw = () => {
      FX.drawGround(ctx);
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

      // 角色（按 y 排序）
      const order = this.fighters.slice().sort((a, b) => (a.y + (a.kind === "dragon" ? 20 : 0)) - (b.y + (b.kind === "dragon" ? 20 : 0)));
      order.forEach(f => {
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
          const flash = f.stealthT > 1.6 && f.stealthT <= 2.0;
          if (f !== meHero && !flash) return;        // 别人视角：完全看不见
          ctx.save(); ctx.globalAlpha = flash ? 1 : 0.45;
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
        const TM = LD.TEAM_COLORS || ["#f87171", "#fbbf24", "#60a5fa", "#34d399"];
        const meF2 = this.hero(this.mySide == null ? 0 : this.mySide);
        ctx.save(); ctx.font = "600 11px system-ui"; ctx.textAlign = "center";
        const baseNm = f.name || (f.side === 0 ? "房主" : "玩家" + (f.side + 1));
        const nm = (meF2 && meF2 === f) ? "你 · " + baseNm : baseNm;
        const dot = (f.team != null && f.team >= 0) ? TM[f.team] : null;
        const label = (f.overlord ? "👑 " : "") + nm;
        ctx.fillStyle = dot || (f.side === 0 ? "rgba(159,230,247,.9)" : "rgba(255,170,180,.9)");
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

      FX.draw(ctx);
    };

    if (LD.Cine.active) {
      LD.Cine.draw(ctx, W, H, worldDraw);
    } else {
      worldDraw();
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
