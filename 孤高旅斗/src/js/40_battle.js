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
    this.fighters.forEach(f => {
      const SX = [0.22, 0.78, 0.22, 0.78], SY = [0.52, 0.52, 0.72, 0.72];
      f.x = C.W * (SX[f.side] != null ? SX[f.side] : 0.5);
      f.y = C.H * (SY[f.side] != null ? SY[f.side] : 0.54);
      f.hp = f.maxHp; f.dead = false; f.stun = 0; f.root = 0; f.invuln = 0;
      f.vx = 0; f.vy = 0; f.moving = false;
      f.shield = 0; f.shieldT = 0; f.hitFlash = 0; f.blind = 0;
      f.buff = { rage: 0, thousand: 0, rush: 0 };
      f.meditate = 0; f.parryT = 0; f.atkAnim = 0;
      if (f.kind === "hero") f.energy = 0;
      if (f.cd) { f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.ult = 1.5; f.cd.dodge = 0; }
      Object.keys(f.slot || {}).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
      f.lock = -1;                                        // 索敌锁定每回合重置
      if (f.kind === "dragon") { f.mode = "idle"; f.modeT = 0; f.charge = 0; f.telegraph = null; f.rageStage = 0; }
      if (this.rule === "overlord") f.overlord = false;   // 霸主标记每回合重置
    });
    this.projs = []; this.zones = [];
    this.stone = null;                                  // 能量石（霸主争霸）
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
      x: o.x, y: o.y, vx: o.vx, vy: o.vy, r: o.r || 9, dmg: o.dmg || 10,
      owner: o.owner, side: o.owner.side, life: 0, maxLife: o.life || 2,
      color: o.color || "#fb923c", core: o.core || "#fef3c7",
      type: o.type || "fireball", pierce: !!o.pierce, reflect: !!o.reflect,
      absorb: o.absorb || 0, absorbed: 0, tick: o.tick || 0, tickMax: o.tickMax || 0,
      hits: {}, data: o.data || {}, homing: o.homing || 0, scale: o.scale || 1,
      root: o.root || 0, stun: o.stun || 0, blind: o.blind || 0, trail: !!o.trail, spin: 0, kindTag: o.kindTag || "skill"
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
    // 霸主争霸：巨龙被击败 → 爆出能量石
    if (this.rule === "overlord" && f.kind === "dragon") { this.spawnStone(f.x, f.y); return; }
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
    const a = Math.random() * TAU, sp = rand(320, 520);
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
      const damp = Math.exp(-3.2 * dt); s.vx *= damp; s.vy *= damp;
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
        const hit = B.melee(f, { reach: sk.reach, half: sk.half, dmg: sk.dmg, type: "basic", kb: 260, basic: true });
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
        const tx = d.sx + d.dir.x * sk.dash * (d.back ? -1 : 1) * p;
        const ty = d.sy + d.dir.y * sk.dash * (d.back ? -1 : 1) * p;
        FX.trail(f.x, f.y, "#7fe6f7", 7, 0.3);
        f.x = tx; f.y = ty;
        const foe = B.foeOf(f);
        if (foe && !foe.dead && !d.hit[foe.side] && dist(f, foe) < 44 + foe.r) {
          d.hit[foe.side] = 1;
          B.damage(f, foe, sk.dmg, { type: "skill", kb: 150, from: f, hitDir: Math.atan2(foe.y - f.y, foe.x - f.x) });
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
      f.buff.rush = Math.max(f.buff.rush, 0.01);
      FX.trail(f.x + rand(-12, 12), f.y - rand(4, 34), "#fbbf24", 5, 0.35);
      const foe = B.foeOf(f);
      if (foe && !foe.dead && dist(f, foe) < f.r + foe.r + 6) {
        B.damage(f, foe, sk.dmg, { type: "skill", stun: sk.stun, kb: 300, from: f });
        FX.ring(foe.x, foe.y - 26, 80, "rgba(251,191,36,.9)", 5, 0.4);
        B.endSlot(f, slot, sk.cd);
        return;
      }
      if (s.t >= sk.dur) B.endSlot(f, slot, sk.cd);
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
        owner: f, hit: false, color: "#fb923c", warn: 0.28 });
      FX.mark(px, py, sk.pillarR, "rgba(251,146,60,.95)", sk.dur + 0.3, "circle");
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
    // 大招能量
    if (sk.kind === "ult") {
      if (f.energy < f.maxEnergy) { FX.float(f.x, f.y - 56, "能量不足", "#9fb3dd", 13); return; }
    }
    const cur = f.slot[slot];
    // 二段类技能（位移斩 / 飞雷神）：槽位进行中时再按一次触发第二段
    if (cur.on && IMPL[id] && IMPL[id].again && IMPL[id].again(f, slot, sk)) return;
    if (cur.on) return;
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
    if (this.rule === "overlord") this.updateStone(dt);
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
    // 越界修正
    this.fighters.forEach(f => {
      if (f.kind === "dragon") { f.x = clamp(f.x, 90, C.W - 90); f.y = clamp(f.y, C.H * 0.34, C.H - 70); return; }
      f.x = clamp(f.x, 34, C.W - 34);
      f.y = clamp(f.y, C.H * 0.32, C.H - 40);
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
      if (f.buff.rage > 0) f.buff.rage = Math.max(0, f.buff.rage - dt);
      if (f.buff.thousand > 0) f.buff.thousand = Math.max(0, f.buff.thousand - dt);
      if (f.buff.rush > 0 && f.slot.skill1.phase !== "rush" && f.slot.skill2.phase !== "rush") f.buff.rush = Math.max(0, f.buff.rush - dt);
    });
  };

  B.updateHero = function (f, dt) {
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
    if (w) FX.float(w.x, w.y - 70, "赢下这一局！", winner === 0 ? "#7fe6f7" : "#fb7185", 24);
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

      // 角色（按 y 排序）
      const order = this.fighters.slice().sort((a, b) => (a.y + (a.kind === "dragon" ? 20 : 0)) - (b.y + (b.kind === "dragon" ? 20 : 0)));
      order.forEach(f => {
        if (f.kind === "dragon") { V.dragon(ctx, f, this.t); return; }
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
        V.chibi(ctx, f.x, f.y, f.facing, f.look, {
          t: this.t, moving: f.moving, walkPhase: f.walkPhase,
          atk: f.atkAnim > 0 ? Math.min(1, 1 - f.atkAnim / Math.max(0.01, f.atkDur)) : 0,
          weapon: f.atkAnim > 0, weaponColor: "#7fe6f7",
          flash: f.hitFlash, dead: f.dead, blinkAmt: f.blinkAmt,
          shield: f.shield > 0 ? 1 : 0
        });
        if (f.stun > 0) {
          ctx.save(); ctx.font = "700 13px system-ui"; ctx.textAlign = "center";
          ctx.fillStyle = "#fcd34d"; ctx.fillText("✦", f.x, f.y - 76); ctx.restore();
        }
        if (f.root > 0) {
          ctx.save(); ctx.globalAlpha = 0.8; ctx.strokeStyle = "#6ee7b7"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, 24, 9, 0, 0, TAU); ctx.stroke(); ctx.restore();
        }
        // 名字（阵营模式在名字前加彩色圆点，霸主加皇冠）
        const TM = LD.TEAM_COLORS || ["#f87171", "#fbbf24", "#60a5fa", "#34d399"];
        ctx.save(); ctx.font = "600 11px system-ui"; ctx.textAlign = "center";
        const nm = (f.side === 0 ? "勇者" : f.name) || "勇者";
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

    // 致盲（粪击命中）：本地玩家视野被棕色糊住，行动不受限
    const meF = this.hero(this.mySide == null ? 0 : this.mySide);
    if (meF && meF.blind > 0 && !meF.dead) {
      const a = Math.min(0.86, meF.blind * 1.6);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(74,44,14,.94)";
      ctx.fillRect(0, 0, W, H);
      // 中间留一小圈勉强能看见的视野
      const g = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 190);
      g.addColorStop(0, "rgba(74,44,14,0)");
      g.addColorStop(1, "rgba(74,44,14,1)");
      ctx.globalAlpha = 0.55;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 190, 0, TAU); ctx.fill();
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
