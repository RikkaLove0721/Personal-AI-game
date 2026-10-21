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
    /* v2.6 世界与摄像机：world 是逻辑世界尺寸（可大于画布视口），cam 是视口左上角的世界坐标。
     * v2.7：所有模式统一大地图（尺寸见 LD.WORLD，当前 1200 x 1200），人物固定在屏幕中心，
     * 只有靠近世界边界时视口才被 clamp 住，人物才会在屏幕上偏移。 */
    world: { w: (LD.WORLD && LD.WORLD.w) || 1600, h: (LD.WORLD && LD.WORLD.h) || 1600, pt: (LD.WORLD && LD.WORLD.pt) || 120 },
    cam: { x: 0, y: 0 },
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
    const lo = Object.assign({}, opts.loadout || LD.DEFAULT_LOADOUT);   // 复制：模式内改配装（如天外来物清空技能）不污染存档
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
      gateSlowT: 0,                // 世界末日门洞减速圈剩余秒数（只对僵尸生效）
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
      x: B.world.w * 0.70, y: B.world.h * 0.50, r: D.r,
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

  /* ----------------------------------------------------------
   * v2.5 通用 BOSS 工厂：巨龙走旧通道；人形 BOSS（黑侠客 / 快枪手）
   * 沿用勇者骨架（复用隐身 / 炸弹 / AI 全套机制），配装为 boss 专属技能。
   * ---------------------------------------------------------- */
  B.mkBoss = function (key, opts) {
    opts = opts || {};
    const cfg = LD.BOSS && LD.BOSS[key];
    if (!cfg) return this.mkDragon(opts);          // 未知 key 兜底回巨龙
    let diff = opts.diff || LD.DIFF.normal;
    if (typeof diff === "string") diff = LD.DIFF[diff] || LD.DIFF.normal;
    /* v2.6 镜影：开战时整套复制玩家的配装（含普攻 / 技能 / 大招），CD 一律为玩家的 1.3 倍 */
    let loadout = cfg.loadout || { basic: "n_shuriken", skill1: "n_clone", skill2: "n_raid", ult: "n_ult" };
    if (key === "mirror" && opts.copyFrom && opts.copyFrom.loadout)
      loadout = Object.assign({}, opts.copyFrom.loadout);
    const hp = Math.round(cfg.hp * diff.hpM);
    const f = this.mkHero(opts.side != null ? opts.side : 1, {
      x: opts.x != null ? opts.x : B.world.w * 0.70, y: opts.y != null ? opts.y : B.world.h * 0.50,
      look: cfg.look, loadout,
      name: cfg.name
    });
    f.bossKind = key;
    f.isBoss = true;
    f.side = opts.side != null ? opts.side : 1; f.id = f.side;
    f.r = 18;                                      // 比勇者略大一圈，有 BOSS 气场
    f.hp = hp; f.maxHp = hp;
    f.speedMul = cfg.speedMul || 1;
    f.team = 1;                                    // 与自己召唤的分身同阵营（互不伤害、索敌跳过）
    f.cd.ult = (cfg.ult && cfg.ult.ultFirst) || 10;
    f.ultCdMin = cfg.ultCdMin || 0;                // v2.7 镜影：大招 CD 下限（防疯狂开大）
    if (LD.AI && LD.AI.setupBoss) LD.AI.setupBoss(f, diff);
    return f;
  };

  /* v2.6 关卡 BOSS 工厂：普通关卡返回 [boss]，双子剑客返回两个共享血量的个体。
   * copyFrom 供镜影复制玩家配装。 */
  B.mkBossForLevel = function (key, diff, copyFrom) {
    if (key === "twin") {
      const a = this.mkBoss("twin", { diff, side: 1 });
      const b = this.mkBoss("twin", { diff, side: 2 });
      a.twinLink = b; b.twinLink = a;
      a.isTwin = true; b.isTwin = true;
      this.twinMark = 1; this.twinSwapT = 8;
      return [a, b];
    }
    return [this.mkBoss(key, { diff, copyFrom })];
  };

  /* ----------------------------------------------------------
   * v2.7 僵尸：军备竞赛 / 「僵尸」修饰符使用的杂兵玩家。
   * v3.1 起不再抽取勇者技能池：固定「突刺 + 撕咬」两个专属技能，
   * 没有普攻、大招和闪避；100 点血，移速为普通角色的 110%，不属任何阵营，
   * 对所有人敌对。side 从 10 开始编号，永不与玩家座位冲突。
   * ---------------------------------------------------------- */
  B.mkZombie = function (x, y) {
    const Z = LD.ZOMBIE || {};
    const zs = Z.skills || {};
    const hero = this.mkHero(10 + (this.zombieSeq = (this.zombieSeq || 0) + 1), {
      x: x != null ? x : rand(80, this.world.w - 80),
      y: y != null ? y : rand(this.world.pt + 40, this.world.h - 80),
      look: Z.look || null,
      loadout: { basic: null, skill1: zs.skill1 || "z_lunge", skill2: zs.skill2 || "z_bite", ult: null },
      name: "僵尸"
    });
    hero.isZombie = true;
    hero.r = 16;
    hero.hp = hero.maxHp = Z.hp || 100;
    hero.team = 8;                       // 统一的「僵尸阵营」：僵尸之间不互殴
    hero.speedMul = Z.speedMul || 1.1;
    LD.AI.mkBot(hero, "normal");
    hero.bot.conf.dodge = 0;             // v3.1：僵尸不会闪避
    hero.name = "僵尸";
    return hero;
  };
  /* 联机客机侧：只用于把房主快照里的僵尸占位出来（位置与状态由快照覆盖） */
  B.mkZombieShell = function () {
    const z = this.mkZombie(0, 0);
    z.isRemoteZombie = true;
    return z;
  };
  /** 场上真人（不含僵尸 / 分身 / 杂兵 / 板凳） */
  B.humans = function (onlyAlive) {
    return this.fighters.filter(f => f.kind === "hero" && !f.isZombie && !f.isClone && !f.bench && (!onlyAlive || !f.dead));
  };

  /* ==========================================================
   *  初始化
   * ========================================================== */
  B.setup = function (cfg) {
    this.mode = cfg.mode;
    this.rule = cfg.rule || "brawl";     // brawl 乱斗 | team 阵营 | overlord 霸主争霸 | gifts 天外来物
                                          // | ring 缩圈 | auction 军备竞赛 | relay 车轮战 | hunt 追猎时刻
    this.diff = cfg.diff || LD.DIFF.normal;
    this.level = cfg.level || null;
    this.theme = cfg.theme || {};
    this.isHost = cfg.isHost !== false;
    this.mySide = cfg.mySide || 0;
    this.fighters = cfg.fighters;
    this.fighters.forEach(f => {
      f.id = f.side; if (f.team == null) f.team = -1; f._huntBase = null;
      /* v2.7 军备商店的「本局有效」基线：血量上限 / 移速，resetRound 时还原 */
      f._baseMaxHp = f.maxHp; f._baseSpd = f.speedMul != null ? f.speedMul : 1; f.spdBuys = 0;
    });
    if (cfg.teams) cfg.teams.forEach((t, i) => { if (this.fighters[i]) this.fighters[i].team = t; });
    /* v3.2 世界末日：所有玩家同一阵容（互不伤害），一起对抗僵尸 */
    if (this.rule === "doomsday") this.fighters.forEach(f => { f.team = 0; });
    this.projs = []; this.zones = []; this.ev = []; this.stone = null;
    this.gifts = []; this.giftT = 0; this.giftUltT = 0; this.giftHealT = 0;
    this.heals = []; this.healT = 0;
    this.coins = [];
    this.pickups = [];          // v3.1 补给箱掉落的血包 / 能量包 / 移速包
    this.zombieSeq = 0; this.zombieT = 0;
    this.ring = null; this.rings = null; this.ringT = 0; this.ringKillN = 0;
    this.huntRing = null; this.hunterSide = -1;
    /* v2.7 关键修复：上一局残留的暂停必须清掉。
     * 旧版 backToRoom（暂停面板 → 返回房间）不会复位 B.paused，
     * 于是下一局 B.update 一直早退、倒计时永远停在「2」——就是「卡在读条 2」的真凶。 */
    this.paused = false;
    /* v2.7 大地图：所有模式统一尺寸（LD.WORLD，当前 1200 x 1200），各模式仍可经 cfg.world 覆盖 */
    const dw = cfg.world || {};
    const W0 = LD.WORLD || { w: 1600, h: 1600, pt: 120 };
    this.world = { w: dw.w || W0.w, h: dw.h || W0.h, pt: dw.pt != null ? dw.pt : W0.pt };
    /* v3.7 塔防对战：固定窄长地图，忽略房间的地图配置 */
    if (this.rule === "tower" && LD.TOWER && LD.TOWER.world) {
      const tw = LD.TOWER.world;
      this.world = { w: tw.w, h: tw.h, pt: tw.pt };
    }
    /* v3.9.1 停电夜战：场地放大 1.5 倍（1200 → 1800），黑灯瞎火里要够地方周旋 */
    if (this.rule === "blackout" && LD.NIGHT && LD.NIGHT.world) {
      const nw = LD.NIGHT.world;
      this.world = { w: nw.w, h: nw.h, pt: nw.pt != null ? nw.pt : 120 };
    }
    /* v4.0 世界末日：横向长图（左岛 + 独木桥 + 右大陆），尺寸由 LD.DOOMSDAY.world 决定 */
    if (this.rule === "doomsday" && LD.DOOMSDAY && LD.DOOMSDAY.world) {
      const dw = LD.DOOMSDAY.world;
      this.world = { w: dw.w, h: dw.h, pt: dw.pt != null ? dw.pt : 70 };
    }
    /* v4.7 占点争夺：地图尺寸由 LD.CAPTURE.world 决定（v4.10 缩到 1920） */
    if (this.rule === "capture" && LD.CAPTURE && LD.CAPTURE.world) {
      const cw = LD.CAPTURE.world;
      this.world = { w: cw.w, h: cw.h, pt: cw.pt != null ? cw.pt : 120 };
    }
    /* v4.10 护送情报箱：地图长度 1.3 倍（2080 x 1600） */
    if (this.rule === "escort" && LD.ESCORT && LD.ESCORT.world) {
      const ew = LD.ESCORT.world;
      this.world = { w: ew.w, h: ew.h, pt: ew.pt != null ? ew.pt : 120 };
    }
    /* v4.10 碰碰车竞技：地图扩大（1200 → 1600），圆环擂台 */
    if (this.rule === "bump" && LD.BUMP && LD.BUMP.world) {
      const bw = LD.BUMP.world;
      this.world = { w: bw.w, h: bw.h, pt: bw.pt != null ? bw.pt : 120 };
    }
    /* v4.11 烫手山芋：常规 1600 场地 */
    if (this.rule === "hotpotato" && LD.HOTPOTATO && LD.HOTPOTATO.world) {
      const hw = LD.HOTPOTATO.world;
      this.world = { w: hw.w, h: hw.h, pt: hw.pt != null ? hw.pt : 120 };
    }
    this.cam = { x: 0, y: 0 };
    /* v3.0 地形：房间带 mapCfg；闯关自动读关卡预置；都不传时保持空场地（兼容旧调用与无头测试） */
    let mapCfg = cfg.mapCfg || null;
    if (!mapCfg && cfg.level) mapCfg = LD.Terrain.bossCfg(cfg.level);
    /* v4.4 世界末日：灰烬长图，右大陆撒一批掩体 / 爆桶 / 车辆（岛内与桥面会被 buildDoomsday 清掉） */
    if (!mapCfg && this.rule === "doomsday") {
      mapCfg = LD.mapCfg({ preset: "arena", seed: 43210, ground: "ash", patches: ["stone"],
        counts: { solid: 8, breakable: 6, pushable: 3, fence: 4, bush: 7, water: 0,
                  barrel: 6, car: 2, tire: 3, supply: 3, barricade: 4, room: 0 } });
    }
    this.mapCfg = mapCfg;
    if (this.rule === "tower" && LD.Terrain.buildTowerMap) {
      /* v3.7 塔防：对称地图 + 双方水晶 / 防御塔，不走随机设施生成器 */
      this.mapCfg = LD.mapCfg({ preset: "arena", seed: 20261019, ground: "stone", patches: ["sand"] });
      this.terrain = LD.Terrain.buildTowerMap(this.world);
      mapCfg = this.mapCfg;
    } else {
      this.terrain = mapCfg ? LD.Terrain.build(mapCfg, this.world,
        (cfg.fighters || []).filter(f => f.x > 0 && f.y > 0).map(f => ({ x: f.x, y: f.y, r: 76 }))) : null;
    }
    if (mapCfg) this.terrainMapCfg = mapCfg;
    this.shelter = null;
    if (this.rule === "doomsday" && this.terrain) this.shelter = LD.Terrain.buildDoomsday(this.terrain, this.world);
    /* v2.6 / v2.7 规则修饰符（可叠加）：
     * lowgrav 低重力 / speed 高速 / heal 回复 / zombie 僵尸 / wheel 技能轮盘 */
    this.mods = (cfg.mods || []).slice();
    this.wheelT = 0;
    this.t = 0; this.score = this.fighters.map(() => 0); this.round = 1; this.matchWinner = -1; this.roundWinner = -1;
    /* 对局时间：房间统一选项；兼容旧房间消息的 warmupT 字段 */
    this.matchT = cfg.matchT || cfg.warmupT || ((LD.MATCH && LD.MATCH.def) || 120);
    this.warmupT = this.matchT;
    this.wScore = this.fighters.map(() => 0);
    this.countdown = this.mode === "dragon" ? 1.6 : 2.0;
    this.state = "countdown";
    LD.Cine.active = false;      // 先清掉可能残留的大招演出，再放猎人特写这种开场演出
    FX.clear();
    /* v2.7 修饰符数值落地：高速（移速 +35%、CD -30%）。
     * 必须排在追猎抽签之前：猎人 CD 减半要在「高速」的结果上再乘，而不是被它覆盖。 */
    if (this.mods.indexOf("speed") >= 0) this.fighters.forEach(f => { f.rateM = (f.rateM || 1) * 0.7; });
    /* v2.7 追猎时刻：随机抽一名玩家当猎人。抽签只在房主端（或单机）进行——
     * 联机客机的猎人身份等房主快照下发，避免两边各抽一个。 */
    if (this.rule === "hunt" && cfg.isHost !== false) this.initHunt();
    /* v2.6 车轮战：擂台两端之外的全部坐板凳 */
    if (this.rule === "relay") this.initRelay();
    /* v2.7 缩圈乱斗：地图上只有几个大安全圈，其余全是毒 */
    if (this.rule === "ring") this.initRing();
    /* v4.11 跨模式状态残留清理：stations / crown 只在夜战 / 霸主的 init 里重建，
     * 但 interactTarget 扫描它们时**不看当前规则**——上一局打过夜战，这局的
     * 乱斗 / 塔防 / 丧尸里就会凭空冒出「充电」；霸主同理会冒出「争夺皇冠」。
     * 必须在所有 initXxx 之前先清干净，让它们只由本局规则重新填充。 */
    this.stations = [];
    this.crown = null;
    /* v3.7 塔防：分队 / 等级 / 金币 / 禁大招 */
    if (this.rule === "tower" && this.initTower) this.initTower();
    /* v3.9 霸主争霸：天降皇冠循环从这里起步（每回合重来） */
    if (this.rule === "overlord" && this.initCrown) this.initCrown();
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
      /* v3.4：柜子 / 草丛藏过 2 秒同样会被察觉；隐匿技能照旧完全看不见 */
      if (!this.hiddenVisible(o)) return;
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
    const foes = this.fighters.filter(o => o !== f && !o.dead && this.hiddenVisible(o) && !this.sameTeam(f, o)).sort((a, b) => a.side - b.side);
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
    if (this.terrain) LD.Terrain.reset(this.terrain);
    this.pickups = [];
    /* 开局位置随机：勇者出生点在场地中下部随机抽取，彼此保持最小间距（巨龙保留原出生点） */
    for (let i = this.fighters.length - 1; i >= 0; i--)   // 上一局的分身 / 杂兵 / 僵尸不带入新一局
      if (this.fighters[i].isClone || this.fighters[i].kind === "minion" || this.fighters[i].isZombie)
        this.fighters.splice(i, 1);
    const placed = [];
    const ins = this.rule === "doomsday" ? this.shelter : null;
    this.fighters.forEach(f => {
      if (f.kind === "hero" && !f.bench) {
        let bx, by;
        if (ins) {
          /* 世界末日：全员出生在庇护所内部，围着中心散开 */
          bx = ins.x; by = ins.y;
          for (let tries = 0; tries < 60; tries++) {
            const a2 = Math.random() * TAU, rr = 70 + Math.random() * Math.max(50, ins.r - 120);
            const tx = ins.x + Math.cos(a2) * rr, ty = ins.y + Math.sin(a2) * rr;
            const free = !this.terrain || LD.Terrain.clearAt(this.terrain, tx, ty, 26);
            if (free && placed.every(p => Math.hypot(p.x - tx, p.y - ty) > 110)) { bx = tx; by = ty; break; }
          }
        } else {
          bx = B.world.w * 0.5; by = B.world.h * 0.62;
          for (let tries = 0; tries < 40; tries++) {
            const tx = B.world.w * (0.10 + Math.random() * 0.80);
            const ty = B.world.h * (0.20 + Math.random() * 0.66);
            const free = !this.terrain || LD.Terrain.clearAt(this.terrain, tx, ty, 30);
            if (free && placed.every(p => Math.hypot(p.x - tx, p.y - ty) > 170)) { bx = tx; by = ty; break; }
          }
        }
        placed.push({ x: bx, y: by });
        f.x = bx; f.y = by;
      }
      if (f.bench) return;   // 车轮战板凳：保持离场状态，等轮到再上场
      /* v2.7 军备商店加成只在当局有效：新一局还原血量上限 / 移速 */
      f.maxHp = f._baseMaxHp != null ? f._baseMaxHp : f.maxHp;
      f.speedMul = f._baseSpd != null ? f._baseSpd : (f.speedMul != null ? f.speedMul : 1);
      f.spdBuys = 0;
      f.hp = f.maxHp; f.dead = false; f.stun = 0; f.root = 0; f.invuln = 0;
      f.vx = 0; f.vy = 0; f.moving = false;
      f.shield = 0; f.shieldT = 0; f.hitFlash = 0; f.blind = 0; f.slowT = 0; f.gateSlowT = 0;
      f.stealthT = 0; f.silenceT = 0; f.knockLeft = 0; f.knockWall = false;
      f.bushHide = false; f.inBush = false; f.bushFlash = 0; f.pushT = 0; f.speedBoostT = 0;
      f.stealthKeep = false; f._ghostNoFlash = false;
      f.giftPending = { skill: null, ult: null }; f.giftSwap = null; f.giftTarget = null;
      /* v3.3 交互：车辆 / 柜子 / 泥土 / 技能获得顺序 */
      f.rideCar = null; f.hideProp = null; f.carryMud = null;
      /* v3.9 被震下车后的上车禁令 / 被揪出柜子的躲藏禁令 / 能量包蓄力状态 */
      f.noCarT = 0; f._noCarSaidT = 0; f.chg = null;
      f.noHideT = 0; f._noHideSaidT = 0;
      /* v4.10 护送情报箱：推箱状态 / 推箱禁令随回合复位 */
      f.pushBox = null; f.noBoxT = 0;
      f.escortRespawnT = (LD.ESCORT || {}).heroRespawn || 3.0;   // v4.11 复活计时复位
      f.carTarget = null; f.hideT = 0; f.interactCd = 0; f.giftLock = 0;
      f.hideTimer = 0; f.hideSpotted = false; f.bushTimer = 0; f._stealthFlash = false;
      f.skillGot = { skill1: 0, skill2: 0 };
      f.kingMark = null; f.hpHist = [{ t: this.t || 0, hp: f.hp }];
      f.buff = { rage: 0, thousand: 0, rush: 0 };
      f.meditate = 0; f.parryT = 0; f.atkAnim = 0;
      f.respawnT = 0;                                     // v2.7 乱斗热身：复活计时
      if (f.kind === "hero") f.energy = 0;
      if (f.cd) {
        f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.dodge = 0;
        /* 勇者开局大招短延迟；巨龙 / BOSS 用 ultFirst（大幅延后首次开大） */
        const bossCfg = f.isBoss && f.bossKind && LD.BOSS ? LD.BOSS[f.bossKind] : null;
        f.cd.ult = f.kind === "dragon" ? ((LD.DRAGON.ult && LD.DRAGON.ult.ultFirst) || 12)
          : bossCfg && bossCfg.ult ? (bossCfg.ult.ultFirst || 10) : 1.5;
      }
      Object.keys(f.slot || {}).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
      f.lock = -1;                                        // 索敌锁定每回合重置
      if (f.kind === "dragon") { f.mode = "idle"; f.modeT = 0; f.charge = 0; f.telegraph = null; f.rageStage = 0; }
      if (this.rule === "overlord") f.overlord = false;   // 霸主标记每回合重置
    });
    /* v3.7 塔防：所有人回自家基地，不随机撒点 */
    if (this.rule === "tower" && this.placeTowerHeroes) this.placeTowerHeroes();
    this.projs = []; this.zones = [];
    this.stone = null;                                  // 能量石（霸主争霸）    this.gifts = [];                                    // 天外来物 / 缩圈乱斗掉落物
    this.heals = [];                                    // v2.7 血包
    this.coins = [];
    this.zombieT = this.rule === "doomsday"
      ? Math.max((LD.DOOMSDAY && LD.DOOMSDAY.sprayMin) || 0.55, ((LD.DOOMSDAY && LD.DOOMSDAY.sprayBase) || 2.6) / Math.max(1, this.humans(true).length))
      : ((LD.ZOMBIE && LD.ZOMBIE.first) || 7);
    this.doomTick = 0;
    this.zombieSeq = 0;
    /* v3.3 物资刷新修饰符：30 秒一轮 */
    this.refreshT = (LD.INTERACT && LD.INTERACT.refreshEvery) || 30;
    // 天外来物 / 缩圈乱斗：开局清空技能与大招，只留普攻；重置掉落计时
    if (this.giftRule()) {
      const gc = this.giftCfg();
      this.giftT = gc.firstSkill;
      this.giftUltT = gc.firstUlt;
      this.fighters.forEach(f => {
        if (f.kind !== "hero" || f.isZombie) return;
        f.loadout = { basic: f.loadout.basic, skill1: null, skill2: null, ult: null };
        f.giftPending = { skill: null, ult: null }; f.giftSwap = null;
        ["skill1", "skill2", "ult"].forEach(k => { if (f.slot) f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
      });
    } else {
      this.giftT = 3; this.giftUltT = 8;
    }
    this.healT = (LD.HEALS && LD.HEALS.first) || 4;
    /* 缩圈乱斗：每回合重新撒安全圈并把所有人挪进圈内 */
    if (this.rule === "ring") this.initRing();
    /* v2.7 追猎时刻：每回合重新抽猎人 + 重置大毒圈（客机等房主快照，不自行抽签） */
    if (this.rule === "hunt" && this.isHost) this.initHunt();
    /* v3.9 霸主争霸：每回合重新开始皇冠循环 */
    if (this.rule === "overlord" && this.initCrown) this.initCrown();
    /* v3.9.1 停电夜战：固定配装（J 位移斩 / K 手里剑）+ 撒充电站 + 黑暗状态复位 */
    if (this.rule === "blackout" && this.initBlackout) this.initBlackout();
    /* v4.5 护送情报箱：两队归并 + 两侧交付点 + 中央投放箱子 */
    if (this.rule === "escort" && this.initEscort) this.initEscort();
    /* v4.6 占点争夺：三座据点 + 队伍归并 + 各自半场开局 */
    if (this.rule === "capture" && this.initCapture) this.initCapture();
    /* v4.8 碰碰车竞技：圆形擂台清场 + 发碰碰车 + 每人上车 */
    if (this.rule === "bump" && this.initBump) this.initBump();
    /* v4.11 烫手山芋：全员脱队（互不伤害）+ 抽第一个倒霉蛋 */
    if (this.rule === "hotpotato" && this.initHotPotato) this.initHotPotato();
    this.dragonCorpseT = 0;
    /* v2.6 / v2.7 各规则回合限时：
     * 追猎 90 秒（时间到生存者胜）；缩圈无限时（毒圈就是时钟）；
     * 丧尸危机不限时（打到只剩一人）；车轮战单场固定 60 秒；
     * 经典乱斗 / 阵营 / 追猎 / 乱斗热身统一按房间选的「对局时间」限时。 */
    this.roundT = (this.mode === "dragon" || this.rule === "overlord" || this.rule === "ring" || this.rule === "auction" || this.rule === "tower") ? 0
      : this.rule === "relay" ? 60
      : this.matchT;
    this.countdown = 2.0; this.state = "countdown"; this.roundWinner = -1;
    if (!keepScore) { this.score = this.fighters.map(() => 0); this.round = 1; this.wScore = this.fighters.map(() => 0); }
    FX.clear();
  };

  /* ==========================================================
   *  通用动作 API
   * ========================================================== */
  B.endSlot = function (f, slot, cd, opt) {
    const s = f.slot[slot];
    s.on = false; s.phase = ""; s.t = 0; s.d = {};
    if (cd != null) {
      if (slot === "ult" && f.perkUltM) cd = Math.round(cd * f.perkUltM * 100) / 100;   // v2.6 词条：大招 CD -25%
      /* v3.7 塔防：冷却怀表（cdM < 1） */
      if (f.cdM && f.cdM !== 1) cd = Math.round(cd * f.cdM * 100) / 100;
      /* v2.7 镜影：它套装的是玩家的大招（cd 字段只是占位），走 CD 制必须兜住下限，
       * 否则每次出手 CD 只有 1 秒多，会疯狂开大。 */
      if (slot === "ult" && f.ultCdMin) cd = Math.max(cd, f.ultCdMin);
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
      boomerang: !!o.boomerang,
      /* v3.1：大招弹道默认穿墙；显式传 passWall:false 的（黄金弹力炮）例外 */
      passWall: o.passWall != null ? !!o.passWall : (o.kindTag === "ult")
    };
    this.projs.push(p);
    return p;
  };

  B.melee = function (f, o) {
    /* v3.0：先把正前方的箱子 / 方块砸一遍（即使没有敌人也要生效） */
    const hitTerrain = this.terrain ? LD.Terrain.melee(this.terrain, f, o.reach, o.half, o.dmg) : 0;
    const foe = this.foeOf(f);
    if (!foe || foe.dead) return hitTerrain;
    const dx = foe.x - f.x, dy = foe.y - f.y;
    const d = Math.hypot(dx, dy);
    if (d > o.reach + foe.r + f.r) return 0;
    const ang = Math.atan2(dy, dx);
    const fa = Math.atan2(f.facing.y, f.facing.x);
    let da = Math.abs(((ang - fa + Math.PI * 3) % TAU) - Math.PI);
    if (da > (o.half || 1.0)) return 0;
    this.damage(f, foe, o.dmg, { type: o.type || "basic", kb: o.kb, stun: o.stun, from: f, basic: !!o.basic });
    return 1 + hitTerrain;
  };

  /* ==========================================================
   *  伤害 / 治疗 / 状态
   * ========================================================== */
  B.damage = function (src, tgt, amt, o) {
    o = o || {};
    if (!tgt || tgt.dead || !(amt > 0)) return 0;   // !(amt>0) 同时挡住 NaN / 负数 / 0
    if (this.sameTeam(src, tgt)) return 0;          // 阵营模式：同阵营之间不造成伤害
    // 黑侠客分身：打在分身上的伤害全部白费（无敌但有时限）
    if (tgt.isClone) {
      FX.float(tgt.x + rand(-8, 8), tgt.y - 46, "无效", "#9fb3dd", 13);
      this.ev.push(["t", tgt.x, tgt.y - 46, "无效", "#9fb3dd"]);
      return 0;
    }
    if (tgt.invuln > 0) { this.ev.push(["t", tgt.x, tgt.y - 40, "闪", "#9fb3dd"]); return 0; }
    /* v3.8 塔防：魔法斗篷 12% 完全躲避 */
    if (tgt.dodgeChance && Math.random() < tgt.dodgeChance) {
      FX.float(tgt.x, tgt.y - 56, "闪避", "#c4b5fd", 14);
      this.ev.push(["t", tgt.x, tgt.y - 56, "闪避", "#c4b5fd"]);
      return 0;
    }
    /* v2.6 词条：力量（伤害 +20%）；毒圈等无来源伤害不吃加成 */
    if (src && src.perkDmg && src.perkDmg !== 1) amt = Math.round(amt * src.perkDmg);
    /* v3.7 塔防：等级 / 力量护腕的伤害加成 */
    if (src && src.dmgBonus) amt = Math.round(amt * (1 + src.dmgBonus));
    /* v2.7 追猎时刻：猎人伤害随存活幸存者数提升（1 + 20% × 存活人数） */
    if (src && src.huntDmgM && src.huntDmgM !== 1) amt = Math.round(amt * src.huntDmgM);
    /* v4.10 隐匿状态下出手：伤害 ×1.5。口径 = 隐匿技能（stealthSlot 标记）
     * + 柜子躲藏 + 草丛埋伏；夜战的「摸黑」是视野机制不算隐匿，否则全场常驻增伤。 */
    if (src && src.kind === "hero" &&
        ((src.stealthT > 0 && src.stealthSlot != null) || src.hideProp || src.bushHide))
      amt = Math.round(amt * 1.5);
    /* v2.7 血怒：大招期间自身造成的伤害减少 25% */
    if (src && src.buff && src.buff.rage > 0) {
      const bsk = LD.skill("bloodRage");
      const m = (bsk && bsk.dmgM != null) ? bsk.dmgM : 0.75;
      if (m !== 1) amt = Math.round(amt * m);
    }
    /* v2.6 双子剑客：真身标记——打在非真身上的伤害只结算 30% */
    if (tgt.isTwin && this.twinMark != null && this.twinMark !== tgt.side) {
      amt = Math.max(1, Math.round(amt * 0.3));
      FX.float(tgt.x + rand(-8, 8), tgt.y - 46, "假身 30%", "#9fb3dd", 12);
    }

    // ---- 格挡判定（挡普攻 2 秒 CD；挡技能 / 大招 8 秒 CD） ----
    if (tgt.kind === "hero" && tgt.parryT > 0 && o.parryable !== false) {
      return this.doParry(tgt, src, o);
    }

    let dmg = amt;
    let crit = false;
    if (src && src.kind === "hero" && o.type !== "dot" && Math.random() < C.critRate) { crit = true; dmg = Math.round(dmg * C.critMul); }
    /* v3.8 塔防：钢甲——飞行物伤害 -20% */
    if (o.proj && tgt.projDR) dmg = Math.max(1, Math.round(dmg * (1 - tgt.projDR)));

    // ---- 护盾吸收 ----
    if (tgt.shield > 0) {
      const use = Math.min(tgt.shield, dmg);
      tgt.shield -= use; dmg -= use;
      FX.burst(tgt.x, tgt.y - 26, 8, "#fcd34d", { speed: 150, dir: Math.random() * TAU });
      if (tgt.shield <= 0) this.shieldBreak(tgt, src);
      if (dmg <= 0) { FX.float(tgt.x, tgt.y - 42, "格挡 " + use, "#fcd34d", 13); return 0; }
    }

    const hpBefore = tgt.hp;
    /* v3.7 塔防：荆棘护甲的减伤 */
    if (tgt.dr) dmg = Math.max(1, Math.round(dmg * (1 - tgt.dr)));
    tgt.hp = Math.max(0, tgt.hp - dmg);
    tgt.dmgTaken += dmg;
    /* v3.9.1 soft：环境类持续伤害（停电夜战的黑暗侵蚀）走的是「只掉血、不挨打」的通道——
     * 不飘伤害数字、不炸粒子、不顿帧、也不打断手上的蓄力。
     * 黑暗侵蚀是每帧都在发生的环境效果，走普通受击表现会让人以为自己一直在挨打。 */
    if (!o.soft) tgt.hitFlash = 0.16;
    /* v3.9 正在开启能量包时挨打 → 蓄力中断，需要重新按交互键再来一次 */
    if (tgt.chg && this.cancelCharge && !o.soft) this.cancelCharge(tgt, "被打断！");
    /* v4.10 护送情报箱：推箱时挨打 → 打断 + 眩晕 1 秒 + 3 秒内不能再碰箱子 */
    if (tgt.pushBox && this.escortBreakPush && !o.soft) this.escortBreakPush(tgt, src);
    /* v3.2 世界末日：对僵尸造成的实际伤害计入得分（溢出伤害不算） */
    if (this.rule === "doomsday" && src && src.kind === "hero" && !src.isZombie && tgt.isZombie) {
      const si = this.fighters.indexOf(src);
      if (si >= 0) this.wScore[si] = (this.wScore[si] || 0) + Math.round(Math.min(dmg, hpBefore) * (((LD.DOOMSDAY || {}).scoreDmg) || 1));
    }
    /* v3.9.1 乱斗热身：伤害也是分（大头在伤害，击杀是彩头）。
     * 只算对英雄造成的实际伤害，溢出不算；wScore 允许带小数，展示层统一取整。 */
    if (this.rule === "warmup" && src && src.kind === "hero" && src !== tgt &&
        tgt.kind === "hero" && !tgt.dead && !src.isZombie) {
      const si = this.fighters.indexOf(src);
      if (si >= 0) this.wScore[si] = (this.wScore[si] || 0) + Math.min(dmg, hpBefore) * ((LD.WARMUP && LD.WARMUP.scoreDmg) || 0.05);
    }
    /* v2.6 双子剑客：共享血量池——任意一方受伤，另一方同步 */
    if (tgt.isTwin && tgt.twinLink && !tgt.twinLink.dead) tgt.twinLink.hp = tgt.hp;
    /* v3.9.1 soft 伤害不闪红、不给能量、也不刷新「刚挨过打」的时间戳——
     * 那个戳会让塔防 AI 判定成「刚被打」而触发撤退，黑暗侵蚀不该引起这种误判。 */
    if (!o.soft) {
      if (tgt.kind === "hero") tgt.blinkAmt = 0.1;
      // 受击回能
      if (tgt.enGainT !== undefined && tgt.enGainT <= 0) { tgt.energy = Math.min(tgt.maxEnergy, tgt.energy + C.energy.onHurt * (tgt.energyMul || 1)); tgt.enGainT = 0.25; }
    }
    // 命中回能 / 吸血
    if (src) {
      src.dmgDealt += dmg;
      if (src.enGainT !== undefined) {
        if (src.enGainT <= 0) { src.energy = Math.min(src.maxEnergy, src.energy + C.energy.onHit * (src.energyMul || 1)); src.enGainT = 0.25; }
        if (src.buff && src.buff.rage > 0) {
          const heal = Math.round(dmg * 0.5);
          if (heal > 0) { src.hp = Math.min(src.maxHp, src.hp + heal); FX.float(src.x, src.y - 50, "+" + heal, "#f472b6", 13); }
        }
        if (o.heal) { src.hp = Math.min(src.maxHp, src.hp + o.heal); FX.float(src.x, src.y - 50, "+" + o.heal, "#34d399", 14); }
      }
    }

    // ---- 反馈 ----
    const isBig = o.type === "ult";
    /* v3.9.1 soft 伤害不给任何受击表现（黑暗侵蚀）。hp 归零仍会走下面的 kill */
    if (!o.soft) {
      FX.burst(tgt.x, tgt.y - 26, isBig ? 26 : (crit ? 16 : 11), crit ? ["#fde68a", "#fff"] : ["#ffd9de", "#ffffff", "#fca5a5"],
        { speed: isBig ? 330 : 220, dir: o.hitDir == null ? null : o.hitDir });
      FX.ring(tgt.x, tgt.y - 24, isBig ? 70 : 34, isBig ? "rgba(251,146,60,.9)" : "rgba(255,255,255,.8)", isBig ? 5 : 3, 0.32);
      FX.float(tgt.x + rand(-8, 8), tgt.y - 46, (crit ? "暴击 " : "") + Math.round(dmg), crit ? "#fbbf24" : (isBig ? "#fb923c" : "#fff"), crit ? 20 : 15);
    }
    /* v3.8 兵线混战时小兵太多：打小兵不顿帧、不震屏，避免整局抖个不停 */
    const quiet = tgt.kind === "laneMinion" || !!o.soft;
    if (!quiet) {
      FX.hitstop(isBig ? C.hitstop.ult : C.hitstop.hit);
      FX.shake(isBig ? C.shake.ult : (crit ? C.shake.parry : C.shake.hit));
    }
    if (!o.soft) this.ev.push(["h", tgt.x, tgt.y - 46, (crit ? "暴击 " : "") + Math.round(dmg), crit ? "#fbbf24" : "#fff"]);

    if (!o.soft && tgt.kind === "hero") tgt.lastHurtAt = this.t;   // v3.8 续航宝石 / 还魂曲计时
    if (o.stun && !tgt.ccImmune) this.applyStun(tgt, o.stun);
    if (o.blind && tgt.kind === "hero") {
      tgt.blind = Math.max(tgt.blind || 0, o.blind);
      FX.float(tgt.x, tgt.y - 66, "致盲 " + o.blind + "s", "#a16207", 15);
      this.ev.push(["b", tgt.x, tgt.y - 66, "致盲 " + o.blind + "s", "#a16207"]);
    }
    if (o.kb && !tgt.ccImmune) this.knock(tgt, o.from || src, o.kb);
    else if (o.kbDist && !tgt.ccImmune) this.knockDist(tgt, o.from || src, o.kbDist, o.wallHit);
    if (tgt.hp <= 0) this.kill(tgt, src);

    // 被击打断冥想（v3.9.1：环境持续伤害不算「被打」，不打断）
    if (!o.soft && tgt.kind === "hero" && tgt.meditate > 0) {
      tgt.meditate = 0; tgt.meditInterrupt = true;
      if (tgt.slot.skill1.phase === "meditate") B.endSlot(tgt, "skill1", LD.skill(tgt.loadout.skill1) ? LD.skill(tgt.loadout.skill1).cd : 4.5);
      if (tgt.slot.skill2.phase === "meditate") B.endSlot(tgt, "skill2", LD.skill(tgt.loadout.skill2) ? LD.skill(tgt.loadout.skill2).cd : 4.5);
      this.applyStun(tgt, 1.0);
      FX.float(tgt.x, tgt.y - 58, "打断！", "#a78bfa", 16);
    }
    // 被打断瞬身蓄力
    if (!o.soft && tgt.kind === "hero") {
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
    /* v2.6 磁暴坦克：电磁护盾破碎时向四周放电 */
    if (f.shieldBoom) {
      const boom = f.shieldBoom;
      f.shieldBoom = null;
      FX.ring(f.x, f.y - 26, boom.R, "rgba(196,181,253,.95)", 8, 0.55);
      FX.burst(f.x, f.y - 26, 30, ["#c4b5fd", "#fff"], { speed: 340 });
      FX.shake(11);
      this.fighters.forEach(t => {
        if (t === f || t.dead || this.sameTeam(f, t)) return;
        if (Math.hypot(t.x - f.x, (t.y - 20) - f.y) <= boom.R + t.r)
          this.damage(f, t, boom.dmg, { type: "skill", kb: 260, from: f });
      });
    }
  };

  B.applyStun = function (f, t) { if (f.kind === "dragon") return; f.stun = Math.max(f.stun, t); };
  B.knock = function (f, from, force) {
    if (!from || f.kind === "dragon") return;
    const a = Math.atan2(f.y - from.y, f.x - from.x);
    f.vx += Math.cos(a) * force * (this.mod && this.mod('lowgrav') ? 1.6 : 1); f.vy += Math.sin(a) * force * (this.mod && this.mod('lowgrav') ? 1.6 : 1);
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
    const nx = f.x + Math.cos(f.knockA) * step;
    const ny = f.y + Math.sin(f.knockA) * step;
    /* v3.1 墙体概念：地图边界与任何挡人障碍（含可破坏物）都算墙 */
    if (this.hitWallAt(f, nx, ny)) {
      /* 先结算撞墙伤害：wallHit 需要 knockLeft > 0 才生效 */
      if (f.knockWall) this.wallHit(f); else f.knockLeft = 0;
      return true;
    }
    f.x = nx; f.y = ny;
    f.knockLeft -= step;
    return false;
  };

  /* 某个圆形位置是否撞到墙（边界 / 地形障碍） */
  B.hitWallAt = function (f, x, y) {
    if (x < 34 || x > B.world.w - 34 || y < B.world.pt + 22 || y > B.world.h - 34) return true;
    if (!this.terrain) return false;
    for (let i = 0; i < this.terrain.props.length; i++) {
      const o = this.terrain.props[i];
      if (!o.blockMove || o.dead) continue;
      if (LD.Terrain.pushOut(o, x, y, f.r)) return true;
    }
    return false;
  };

  /* 击飞撞墙判定：位置已被钳到边界或囚牢圈壁时调用 */
  B.wallHit = function (f) {
    if (f.knockLeft <= 0 || !f.knockWall) return false;
    f.knockLeft = 0;
    f.knockWall = false;
    const dmg = LD.skill("he") ? (LD.skill("he").wallDmg || 15) : 15;
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

  /* v3.5 丧尸尸体上限：场上最多保留 maxCorpses 具，超出的按死亡时间从老到新消失。
   * 只做「不再绘制」（corpseGone），不从 fighters 里移除 —— 计分数组按索引对齐，
   * 中途 splice 会把所有人的分数错位。 */
  B.trimZombieCorpses = function () {
    const max = (LD.ZOMBIE && LD.ZOMBIE.maxCorpses) || 10;
    const dead = [];
    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (f.isZombie && f.dead && !f.corpseGone) dead.push({ f: f, i: i });
    }
    if (dead.length <= max) return 0;
    dead.sort((a, b) => ((a.f.deadAt || 0) - (b.f.deadAt || 0)) || (a.i - b.i));
    const n = dead.length - max;
    for (let k = 0; k < n; k++) dead[k].f.corpseGone = true;
    return n;
  };

  B.kill = function (f, by) {
    if (f.dead) return;
    f.dead = true;
    f.deadAt = this.t;
    /* v2.6 双子剑客：共享血量池，一人倒下另一人同时倒下 */
    if (f.isTwin && f.twinLink && !f.twinLink.dead) this.kill(f.twinLink, by);
    FX.burst(f.x, f.y - 26, 40, ["#fff", "#fb7185", "#fbbf24"], { speed: 360, life: 0.9 });
    FX.ring(f.x, f.y - 26, 120, "rgba(255,255,255,.9)", 6, 0.6);
    FX.shake(16);
    if (by && by.kind === "hero") by.kills++;
    if (by && !by.isZombie && f.isZombie && LD.Profile && LD.Profile.stat) LD.Profile.stat("zombieKills", 1);
    this.ev.push(["k", f.x, f.y - 26]);
    // 分身：被打散只是消失，不参与任何结算（不会触发回合胜负）
    if (f.isClone) { f.cloneT = Math.min(f.cloneT != null ? f.cloneT : 0, 0.9); return; }
    // 杂兵：只标记死亡（updateMinions 负责移除），不参与回合胜负结算
    if (f.kind === "minion") { f.dead = true; return; }
    // v2.7 僵尸：丧尸危机 / 世界末日吃局内金币；「僵尸」修饰符不掉金币
    if (f.isZombie) {
      const doom = this.rule === "doomsday";
      if (this.rule === "auction" || doom) {
        const coin = doom ? (((LD.DOOMSDAY || {}).coin) || 2) : ((LD.ZOMBIE && LD.ZOMBIE.coin) || 3);
        this.spawnCoin(f.x, f.y, coin);
      }
      /* v3.2 世界末日：击杀僵尸额外加分 */
      if (doom && by && by.kind === "hero" && !by.isZombie && !by.dead) {
        const si = this.fighters.indexOf(by);
        const pts = ((LD.DOOMSDAY || {}).scoreKill) || 10;
        if (si >= 0) {
          this.wScore[si] = (this.wScore[si] || 0) + pts;
          FX.float(by.x, by.y - 86, "击杀 +" + pts + " 分", "#fcd34d", 16);
        }
      }
      this.trimZombieCorpses();
      return;
    }
    /* v3.2 世界末日：玩家阵亡即淘汰；只剩最后一名幸存者时立即结算 */
    if (this.rule === "doomsday" && f.kind === "hero") {
      const alive = this.humans(true);
      const total = this.fighters.filter(x => x.kind === "hero" && !x.isZombie && !x.bench).length;
      if (total > 1 && alive.length <= 1) {
        const w = alive[0] || null;
        const me = this.hero(this.mySide == null ? 0 : this.mySide);
        this.matchWinner = w ? w.side : -1;
        if (w) LD.Cine.start(w, "胜者：" + (w.name || ("玩家" + (w.side + 1))), "", "#fcd34d", "最后的幸存者");
        this.finish(!!(me && w && w.side === me.side));
      }
      return;
    }
    // v2.6 丧尸危机：击杀玩家也掉局内金币
    if (this.rule === "auction" && this.coins) this.spawnCoin(f.x, f.y, 3);
    /* v4.8 碰碰车竞技：没有淘汰概念——被撞死 / 掉进水里都走 bumpDunk 的复活流程，
     * 这里直接返回，别让「只剩一人」的通用结算把比赛提前结束。 */
    if (this.rule === "bump" && f.kind === "hero") {
      /* 走和「掉进水里」同一条复活流程（撞死也算对手的战果） */
      if (this.bumpDunk) this.bumpDunk(f, by, false);
      return;
    }
    // v2.7 乱斗热身：不淘汰、不倒计时重开，随机位置复活，击杀者加分
    if (this.rule === "capture" && f.kind === "hero") {
      /* v4.7 占点争夺：不淘汰，在本方基地复活；首次 3 秒，之后每次阵亡 +3 秒 */
      const C = LD.CAPTURE || {};
      const baseT = f.capRespawnT != null ? f.capRespawnT : (C.respawn || 3.0);
      f.respawnT = baseT;
      f.capRespawnT = Math.min(C.respawnMax || 24, baseT + (C.respawnStep || 3.0));
      return;
    }
    /* v4.11 护送情报箱：同占点，阵亡只是退场一会儿（首次 3 秒，之后每次 +3，上限 24）。
     * 必须放在「只剩一人」的通用结算之前 return，否则一方团灭会直接判掉整局。 */
    if (this.rule === "escort" && f.kind === "hero") {
      const E = LD.ESCORT || {};
      const baseT = f.escortRespawnT != null ? f.escortRespawnT : (E.heroRespawn || 3.0);
      f.respawnT = baseT;
      f.escortRespawnT = Math.min(E.heroRespawnMax || 24, baseT + (E.heroRespawnStep || 3.0));
      return;
    }
    /* v4.11 烫手山芋：本模式没有攻击手段，被炸死后计时复活继续当接盘侠 */
    if (this.rule === "hotpotato" && f.kind === "hero") {
      f.respawnT = (LD.HOTPOTATO || {}).respawn || 3.0;
      if (this.potato && this.potato.holder === f) { this.potato.holder = null; this.potatoPickTarget(); }
      return;
    }
    if (this.rule === "warmup") {
      if (by && by.side != null) {
        const i = this.fighters.indexOf(by);
        if (i >= 0) { this.wScore[i] = (this.wScore[i] || 0) + ((LD.WARMUP && LD.WARMUP.scoreKill) || 5); }
        FX.float(by.x, by.y - 86, "击杀 +" + ((LD.WARMUP && LD.WARMUP.scoreKill) || 5) + "，得分 " + Math.round(this.wScore[i]), "#fcd34d", 17);
      }
      f.respawnT = (LD.WARMUP && LD.WARMUP.respawn) || 1.6;
      return;
    }
    // v2.6 车轮战：败者下台、下一位上场
    if (this.rule === "relay" && f.kind === "hero") { this.relayOnKill(f, by); return; }
    // v2.7 追猎时刻：猎人阵亡 → 生存者立即获胜；生存者全灭 → 猎人获胜
    if (this.rule === "hunt") {
      const aliveRunners = this.fighters.filter(x => x.kind === "hero" && x.huntRole === "runner" && !x.dead && !x.bench);
      const hunter = this.fighters.find(x => x.kind === "hero" && x.huntRole === "hunter");
      const hunterDead = !hunter || hunter.dead;
      /* v2.7 修复：旧版只要有人倒下就直接结算（杀 1 个生存者比赛就结束），
       * 现在必须等到「猎人死」或「生存者全灭」才分胜负。 */
      if (hunterDead || !aliveRunners.length) {
        const meF = this.hero(this.mySide == null ? 0 : this.mySide);
        const iAmRunner = meF && meF.huntRole === "runner";
        this.matchWinner = hunterDead
          ? (aliveRunners[0] ? aliveRunners[0].side : (hunter ? hunter.side : 0))
          : (hunter ? hunter.side : 0);
        this.finish(iAmRunner ? hunterDead : !hunterDead);
      }
      return;
    }
    if (this.mode === "dragon") {
      if (f.side === 0) { this.finish(false); return; }
      /* v2.6 闯关可有多 BOSS（双子剑客）：场上还有存活的 BOSS 就继续打 */
      const bossesLeft = this.fighters.filter(x => x.side !== 0 && !x.dead && !x.isClone && x.kind !== "minion" && !x.bench);
      this.finish(bossesLeft.length === 0);
      return;
    }
    // v3.9 霸主争霸已无巨龙：霸主阵亡 → 效果当场结束，并排下一顶皇冠
    if (this.rule === "overlord" && f.overlord) {
      if (this.stripOverlord) this.stripOverlord(f, true);
    }
    // 霸主争霸：场上只剩一名存活勇者（巨龙不算）时回合结束
    if (this.rule === "overlord") {
      const alive = this.humans(true);
      if (this.state === "fight" && alive.length <= 1)
        this.endRound(alive[0] ? alive[0].side : (by && !by.isZombie ? by.side : f.side));
      return;
    }
    // 阵营模式：只要本方还有人活着就继续打
    if (this.rule === "team") {
      if (this.state === "fight" && this.teamsAlive() <= 1) this.endRound(this.lastTeamSide());
      return;
    }
    if (this.humans().length <= 2) {
      this.endRound(f.side === 0 ? 1 : 0);
    } else {
      /* 混战：只剩一人存活时结束回合；同归于尽则判击杀者获胜 */
      const alive = this.humans(true);
      if (alive.length === 1) this.endRound(alive[0].side);
      else if (alive.length === 0) this.endRound(by ? by.side : f.side);
    }
  };

  /* ---------------- 阵营模式辅助 ---------------- */
  B.teamsAlive = function () {
    const set = {};
    this.fighters.forEach(f => { if (!f.dead && f.team >= 0 && !f.isZombie && !f.isClone && f.kind === "hero") set[f.team] = 1; });
    return Object.keys(set).length;
  };
  B.lastTeamSide = function () {
    const t = this.fighters.find(f => !f.dead && f.team >= 0 && !f.isZombie && f.kind === "hero");
    return t ? t.side : 0;
  };

  /* ==========================================================
   *  v3.9 霸主争霸：天降皇冠（取代原来的「打巨龙爆能量石」）
   *  预警 → 落地 → 靠近蓄力 need 秒（受击中断）→ 加冕（血量 x2 / CD -30%）
   *  → 持有 holdT 秒后剥夺（血量减半 / CD 复原）→ 重新预警，循环
   * ========================================================== */
  B.initCrown = function () {
    const C = LD.CROWN || {};
    this.crown = { phase: "warn", warnT: C.warnT || 5, x: 0, y: 0, holder: null, holdT: 0, t: 0, landT: 0 };
    /* 落点在预警时就抽好，好让预警圈画在将要落下的位置 */
    const spot = this.crownSpot();
    this.crown.x = spot.x; this.crown.y = spot.y;
  };

  /* 随机落点：地图中段，避开障碍且不贴边 */
  B.crownSpot = function () {
    const w = this.world || { w: 1600, h: 1600, pt: 80 };
    for (let i = 0; i < 40; i++) {
      const x = rand(w.pt + 120, w.w - w.pt - 120);
      const y = rand(w.pt + 120, w.h - w.pt - 120);
      if (!this.terrain || LD.Terrain.clearAt(this.terrain, x, y, 34)) return { x: x, y: y };
    }
    return { x: w.w / 2, y: w.h / 2 };
  };

  B.updateCrown = function (dt) {
    const C = LD.CROWN || {};
    const c = this.crown;
    if (!c) return;
    c.t += dt;
    if (c.phase === "warn") {
      c.warnT -= dt;
      /* 预警：直接把落点画出来（HUD 也有倒计时） */
      if (Math.random() < dt * 8) FX.trail(c.x + rand(-26, 26), c.y - rand(10, 40), "#fcd34d", 4, 0.4);
      if (c.warnT <= 0) {
        c.phase = "fallen"; c.landT = 0; c.warnT = 0;
        FX.ring(c.x, c.y, 120, "rgba(252,211,77,.95)", 8, 0.6);
        FX.burst(c.x, c.y - 10, 30, ["#fcd34d", "#fff7d6", "#fbbf24"], { speed: 320 });
        FX.shake(10);
        FX.float(c.x, c.y - 70, "皇冠降临！", "#fcd34d", 20);
        this.ev.push(["h", c.x, c.y - 70, "皇冠降临！", "#fcd34d"]);
      }
      return;
    }
    if (c.phase === "fallen") {
      c.landT += dt;
      if (Math.random() < dt * 6) FX.trail(c.x + rand(-12, 12), c.y - rand(6, 24), "#fcd34d", 4, 0.5);
      return;
    }
    if (c.phase === "held") {
      const h = c.holder;
      c.holdT -= dt;
      /* 霸主自己死了：效果直接结束并立即开始下一轮预警 */
      if (!h || h.dead) { this.stripOverlord(h, true); return; }
      if (c.holdT <= 0) this.stripOverlord(h, false);
    }
  };

  /* 加冕完成 → 成为霸主 */
  B.finishCrown = function (f, cw) {
    if (!f || f.dead) return;
    if (!this.crown || this.crown !== cw || this.crown.phase !== "fallen") return;
    const C = LD.CROWN || {};
    const mul = C.hpMul != null ? C.hpMul : 2;
    /* 幂等：先把上一次的加成还原，避免反复加冕把血量一层层叠上去 */
    this.stripOverlord(f, true);
    f.overlord = true;
    f.maxHp = Math.round(f.maxHp * mul);
    f.hp = Math.min(f.maxHp, Math.round(f.hp * mul));
    f.cdM = C.cdMul != null ? C.cdMul : 0.7;      // 技能 CD 缩短 30%
    this.crown.phase = "held";
    this.crown.holder = f;
    this.crown.holdT = C.holdT || 30;
    FX.ring(f.x, f.y - 26, 120, "rgba(252,211,77,.95)", 8, 0.6);
    FX.burst(f.x, f.y - 26, 36, ["#fcd34d", "#fff", "#fbbf24"], { speed: 340 });
    FX.flash(0.22, "252,211,77"); FX.shake(14);
    FX.float(f.x, f.y - 74, "霸主诞生！", "#fcd34d", 20);
    this.ev.push(["h", f.x, f.y - 74, "霸主诞生！", "#fcd34d"]);
  };

  /* 剥夺霸主：血量减半、CD 复原。silent=true 用于阵亡 / 重新加冕前的静默还原 */
  B.stripOverlord = function (f, silent) {
    const C = LD.CROWN || {};
    if (f) {
      if (f.overlord) {
        const mul = C.hpMul != null ? C.hpMul : 2;
        f.maxHp = Math.max(1, Math.round(f.maxHp / mul));
        f.hp = Math.max(1, Math.min(f.maxHp, Math.round(f.hp / mul)));
      }
      f.overlord = false;
      f.cdM = 1;
      if (!silent) {
        FX.ring(f.x, f.y - 26, 110, "rgba(252,211,77,.9)", 6, 0.6);
        FX.float(f.x, f.y - 72, "霸主效果结束", "#fcd34d", 17);
        this.ev.push(["h", f.x, f.y - 72, "霸主效果结束", "#fcd34d"]);
      }
    }
    /* 立刻排下一顶皇冠 */
    if (this.crown) {
      const spot = this.crownSpot();
      this.crown.phase = "warn";
      this.crown.warnT = C.nextWarnT != null ? C.nextWarnT : 5;
      this.crown.holder = null;
      this.crown.holdT = 0;
      this.crown.x = spot.x; this.crown.y = spot.y;
      this.crown.landT = 0;
    }
  };

  /* ==========================================================
   *  v2.6 通用：修饰符 / 杂兵 / 缩圈 / 军备竞赛 / 车轮战 / 技能轮盘
   * ========================================================== */
  B.mod = function (id) { return !!(this.mods && this.mods.indexOf(id) >= 0); };

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

  /* ---- 乱斗热身（v2.7）：阵亡不淘汰，计时到点随机位置复活 ---- */
  B.randomRespawnSpot = function (minGap) {
    const w = this.world, gap = minGap == null ? 240 : minGap;
    let bx = rand(80, w.w - 80), by = rand(w.pt + 60, w.h - 90);
    for (let k = 0; k < 40; k++) {
      const x = rand(60, w.w - 60), y = rand(w.pt + 40, w.h - 60);
      const near = this.humans(true).some(f => Math.hypot(f.x - x, f.y - y) < gap);
      if (!near) { bx = x; by = y; break; }
    }
    return { x: bx, y: by };
  };
  B.updateRespawn = function (dt) {
    /* v4.11 护送情报箱：阵亡后计时复活，不再一命淘汰 */
    if (this.rule !== "warmup" && this.rule !== "capture" && this.rule !== "escort" && this.rule !== "hotpotato") return;
    const W = this.rule === "escort" ? (LD.ESCORT || {})
            : this.rule === "hotpotato" ? (LD.HOTPOTATO || {})
            : this.rule === "capture" ? (LD.CAPTURE || {}) : (LD.WARMUP || {});
    for (const f of this.fighters) {
      if (!f.respawnT || f.respawnT <= 0) continue;
      f.respawnT -= dt;
      if (f.respawnT > 0) continue;
      f.respawnT = 0;
      f.dead = false;
      f.hp = f.maxHp; f.energy = 0;
      f.stun = 0; f.root = 0; f.silenceT = 0; f.blind = 0; f.slowT = 0; f.gateSlowT = 0; f.shield = 0; f.shieldT = 0;
      f.knockLeft = 0; f.knockWall = false; f.meditate = 0; f.hitFlash = 0;
      f.buff = { rage: 0, thousand: 0, rush: 0 };
      Object.keys(f.slot || {}).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
      if (f.cd) { f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.dodge = 0; f.cd.ult = 1.5; }
      /* v4.11 占点：阵亡改为**全图随机**复活（原固定回基地，容易被蹲家门口）。
       * 护送：在本方交付点一带复活（阵营分驻左右两端，不会一睁眼就在敌方人堆里）。 */
      const p = (this.rule === "escort" && this.escortSpawn) ? this.escortSpawn(f)
              : this.randomRespawnSpot();
      f.x = p.x; f.y = p.y;
      f.invuln = W.invuln || 1.6;
      FX.ring(f.x, f.y - 26, 76, "rgba(103,232,249,.95)", 5, 0.5);
      FX.burst(f.x, f.y - 26, 20, ["#7fe6f7", "#fff"], { speed: 240 });
      FX.float(f.x, f.y - 70, "复活！", "#7fe6f7", 18);
      this.ev.push(["h", f.x, f.y - 70, "复活！", "#7fe6f7"]);
    }
  };

  /* ---- 血包（「回复」修饰符 / 缩圈模式圈外补给） ---- */
  B.spawnHeal = function (x, y) {
    const H = LD.HEALS || {};
    const p = (x != null) ? { x, y } : this.healDropSpot();
    const h = { x: p.x, y: p.y, t: 0, landed: false, born: this.t, id: "heal", kind: "heal" };
    this.heals.push(h);
    const cap = H.max || 4;
    const same = this.heals.filter(o => o !== h);
    if (same.length >= cap) {
      same.sort((a, b) => a.born - b.born);
      for (const o of same.slice(0, same.length - cap + 1)) {
        const i = this.heals.indexOf(o);
        if (i >= 0) this.heals.splice(i, 1);
      }
    }
    return h;
  };
  B.healDropSpot = function () {
    if (this.rule === "ring") return this.ringDropSpot(0.62);   // 缩圈模式：血包多半落在圈外
    const w = this.world;
    return { x: rand(80, w.w - 80), y: rand(w.pt + 60, w.h - 90) };
  };
  B.updateHeals = function (dt) {
    if (!this.heals.length) return;
    const H = LD.HEALS || {};
    for (let i = this.heals.length - 1; i >= 0; i--) {
      const h = this.heals[i];
      h.t += dt;
      if (!h.landed) {
        if (h.t % 0.08 < dt) FX.trail(h.x + rand(-6, 6), h.y - 12 - (1 - h.t / (H.fallT || 1.4)) * 120, "#34d399", 4, 0.35);
        if (h.t >= (H.fallT || 1.4)) { h.landed = true; FX.ring(h.x, h.y, 36, "rgba(52,211,153,.95)", 4, 0.45); }
        continue;
      }
      if (this.t - h.born > (H.life || 40)) { this.heals.splice(i, 1); continue; }
      for (const f of this.fighters) {
        if (f.dead || f.kind !== "hero" || f.isClone || f.bench) continue;
        if (Math.hypot(f.x - h.x, f.y - h.y) > f.r + (H.pickR || 32)) continue;
        const amt = H.amount || 45;
        const before = f.hp;
        f.hp = Math.min(f.maxHp, f.hp + amt);
        FX.float(f.x, f.y - 62, "+" + Math.round(f.hp - before), "#34d399", 16);
        FX.burst(h.x, h.y - 12, 14, ["#34d399", "#fff"], { speed: 200 });
        this.heals.splice(i, 1);
        break;
      }
    }
  };
  B.healTimerStep = function (dt) {
    if (this.rule !== "ring" && !this.mod("heal")) return;   // 缩圈模式常驻血包，回复修饰符额外开启
    const H = LD.HEALS || {};
    this.healT -= dt;
    if (this.healT > 0) return;
    this.healT = H.every || 8;
    this.spawnHeal();
  };

  /* ---- 军备竞赛：击杀掉金币，拾取攒局内金币；人机自动逛商店 ---- */
  B.spawnCoin = function (x, y, v) {
    if (!this.coins) this.coins = [];
    this.coins.push({ x, y, v: v || 1, t: 0 });
    FX.ring(x, y - 20, 40, "rgba(252,211,77,.9)", 5, 0.35);
  };
  /* v3.1 炸药桶：延迟一帧的地形爆炸结算（可以连锁引爆） */
  B.terrainBoom = function (x, y, r, dmg) {
    FX.ring(x, y - 12, r, "rgba(251,146,60,.95)", 8, 0.5);
    FX.ring(x, y - 12, r * 0.6, "rgba(254,215,170,.95)", 6, 0.38);
    FX.burst(x, y - 12, 34, ["#f97316", "#fbbf24", "#fff"], { speed: 360, life: 0.8 });
    FX.shake(14); FX.flash(0.14, "251,146,60");
    this.fighters.forEach(f => {
      if (f.dead) return;
      const d = Math.hypot(f.x - x, (f.y - 26) - y);
      if (d > r + f.r) return;
      const k = 1 - Math.max(0, d - f.r) / (r + f.r);
      this.damage(null, f, Math.round(dmg * (0.55 + 0.45 * k)), { type: "skill", kb: 320, from: { x: x, y: y + 26 } });
    });
    if (this.terrain) LD.Terrain.blast(this.terrain, x, y, r * 0.9, dmg * 0.8);
    this.ev.push(["x", x, y, r]);
  };

  /* v3.1 补给箱掉落：随机血包 / 道具包（原「能量包」，v4.10 统一改名）/ 移速包 */
  /* v4.10 道具包（+60 大招能量）只在这些模式之外的局里出现：
   * 停电夜战（大招禁用）、世界末日（用户反馈「居然能充电」）、护送情报箱（交互被充电抢走）。
   * v4.11 补：碰碰车竞技（同样禁用大招，且玩家全程在车里，`interactTarget` 的
   * rideCar 短路让道具包根本点不到，掉了也是白掉）；烫手山芋（禁用普攻技能大招）。
   * 物资刷新修饰符走同一个出口，一处拦截全部生效。 */
  B.packAllowed = function () {
    return ["blackout", "doomsday", "escort", "bump", "hotpotato"].indexOf(this.rule) < 0;
  };
  B.dropPickup = function (x, y, forceKind) {
    if (forceKind === "energy" && !this.packAllowed()) {
      /* 停电夜战：大招禁用但血包 / 移速包在黑地里救命，转换品类继续掉；
       * 末日 / 护送：干脆不掉，场面上不要再冒出「按 P 充电」的交互。 */
      if (this.rule !== "blackout") return;
      forceKind = Math.random() < 0.5 ? "heal" : "speed";
    }
    /* v3.9.1 停电夜战的大招禁用兜底：随机掉落时也不再抽到道具包 */
    if (!forceKind && this.rule === "blackout") forceKind = Math.random() < 0.5 ? "heal" : "speed";
    const pool = ["heal", "energy", "speed"];
    const kind = forceKind || pool[(Math.random() * pool.length) | 0];
    if (!this.pickups) this.pickups = [];
    this.pickups.push({ id: (this._pkId = (this._pkId || 0) + 1), x: x, y: y, kind: kind, t: 0 });
    FX.ring(x, y - 10, 46, "rgba(125,211,252,.9)", 4, 0.4);
  };

  B.updatePickups = function (dt) {
    if (!this.pickups || !this.pickups.length) return;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      if (pk.t > 26) { this.pickups.splice(i, 1); continue; }
      /* v3.9 能量包不再「走过去自动吃掉」：必须靠近按交互键原地蓄力 5 秒。
       * 血包 / 移速包保持原来的接触即生效。 */
      for (const f of this.fighters) {
        if (f.dead || f.bench || f.kind !== "hero") continue;
        if (Math.hypot(f.x - pk.x, f.y - pk.y) > f.r + 24) continue;
        if (pk.kind === "energy") continue;
        const label = pk.kind === "heal" ? "生命 +35" : "移速提升 5 秒";
        if (pk.kind === "heal") this.heal(f, 35);
        else f.speedBoostT = Math.max(f.speedBoostT || 0, 5);
        FX.float(f.x, f.y - 64, label, pk.kind === "heal" ? "#7ff0c4" : pk.kind === "energy" ? "#a5b4fc" : "#fcd34d", 14);
        FX.burst(pk.x, pk.y - 10, 12, ["#7dd3fc", "#fff"], { speed: 180 });
        FX.ring(f.x, f.y - 26, 52, "rgba(125,211,252,.85)", 4, 0.35);
        this.pickups.splice(i, 1);
        break;
      }
    }
  };

  B.updateAuction = function (dt) {
    if (!this.coins) return;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;
      if (c.t > 25) { this.coins.splice(i, 1); continue; }
      for (const f of this.fighters) {
        if (f.dead || f.kind !== "hero" || f.isZombie || f.bench) continue;
        if (Math.hypot(f.x - c.x, f.y - c.y) < f.r + 22) {
          f.bcoins = (f.bcoins || 0) + c.v;
          FX.float(f.x, f.y - 60, "+" + c.v + " 局内金币", "#fcd34d", 14);
          FX.burst(c.x, c.y - 10, 8, ["#fcd34d", "#fff"], { speed: 150 });
          this.coins.splice(i, 1);
          if (f.isBot) this.botSpin(f);
          break;
        }
      }
    }
  };
  /* v2.7 军备竞赛：局内商店（打僵尸/杀人掉金币，金币买增益，只在当局有效） */
  B.armyShop = function () {
    const S = LD.ASHOP || {};
    /* v4.10 世界末日：低于 10 金币的道具价格全部 ×2（末日金币好赚，低价货白送一样） */
    const px = (p) => (this.rule === "doomsday" && p < 10 ? p * 2 : p);
    return [
      { id: "heal", name: "血包", icon: "❤️", price: px(S.healPrice || 2),
        desc: "立刻恢复 " + (S.healAmount || 45) + " 点生命（满血时买不了）" },
      { id: "hp", name: "血量加成", icon: "💪", price: px(S.hpPrice || 2),
        desc: "本局生命上限 +" + (S.hpGain || 80) + " 并回满增量，可叠加" },
      { id: "spd", name: "移速加成", icon: "👟", price: px(S.spdPrice || 2),
        desc: "本局移速 +" + Math.round((S.spdGain || 0.15) * 100) + "%（最多叠 " + (S.spdMax || 3) + " 次）" },
      { id: "energy", name: "能量球", icon: "🔮", price: px(S.energyPrice || 3),
        desc: "立刻补充 " + (S.energyGain || 60) + " 点大招能量（能量已满时买不了）" }
    ].concat(this.rule === "doomsday" ? (function () {
      /* v4.1 末日专属：防御建筑，买完立在脚下（金币靠刷僵尸攒）；同样吃 <10 金币翻倍 */
      const C = (LD.DOOMSDAY || {}).build || {};
      return [
        { id: "b_fence", name: "栅栏", icon: "🚧", price: px((C.fence || {}).price || 6),
          desc: "在脚下立一段可破坏栅栏（血量 " + ((C.fence || {}).hp || 80) + "）：挡人不挡弹，飞行物可以穿过去" },
        { id: "b_turret", name: "小型枪台", icon: "🔫", price: (C.turret || {}).price || 14,
          desc: "在脚下架起枪台（血量 " + ((C.turret || {}).hp || 120) + "）：自动射击 " + ((C.turret || {}).range || 300) + " 范围内的僵尸，并优先吸引它们仇恨" },
        { id: "b_cannon", name: "固定炮台", icon: "💥", price: (C.cannon || {}).price || 22,
          desc: "在脚下架起炮台（血量 " + ((C.cannon || {}).hp || 160) + "）：低频发射范围爆炸的炮弹（" + ((C.cannon || {}).boomR || 90) + " 范围），同样吸引仇恨" }
      ];
    })() : []);
  };
  /** 购买局内商品：成功返回 true（扣金币 + 立刻生效） */
  B.armyBuy = function (f, id) {
    const S = LD.ASHOP || {};
    const item = this.armyShop().find(i => i.id === id);
    if (!f || !item) return false;
    if ((f.bcoins || 0) < item.price) return false;
    if (id === "heal") {
      if (f.hp >= f.maxHp) return false;
      f.bcoins -= item.price;
      f.hp = Math.min(f.maxHp, f.hp + (S.healAmount || 45));
      FX.ring(f.x, f.y - 26, 62, "#4ade80", 5, 0.45);
      FX.float(f.x, f.y - 64, "+" + (S.healAmount || 45), "#4ade80", 15);
    } else if (id === "hp") {
      f.bcoins -= item.price;
      f.maxHp += (S.hpGain || 80); f.hp += (S.hpGain || 80);
      FX.ring(f.x, f.y - 26, 66, "#fb7185", 5, 0.45);
      FX.float(f.x, f.y - 64, "上限+" + (S.hpGain || 80), "#fb7185", 15);
    } else if (id === "spd") {
      if ((f.spdBuys || 0) >= (S.spdMax != null ? S.spdMax : 3)) return false;
      f.bcoins -= item.price;
      f.spdBuys = (f.spdBuys || 0) + 1;
      f.speedMul = (f.speedMul || 1) + (S.spdGain || 0.15);
      FX.ring(f.x, f.y - 26, 66, "#67e8f9", 5, 0.45);
      FX.float(f.x, f.y - 64, "移速+" + Math.round((S.spdGain || 0.15) * 100) + "%", "#67e8f9", 15);
    } else if (id === "energy") {
      /* v3.2 能量球：立刻补大招能量 */
      if (f.energy >= f.maxEnergy) return false;
      f.bcoins -= item.price;
      const gain = S.energyGain || 60;
      f.energy = Math.min(f.maxEnergy, f.energy + gain);
      FX.ring(f.x, f.y - 26, 66, "#818cf8", 5, 0.45);
      FX.burst(f.x, f.y - 26, 14, ["#a5b4fc", "#fff"], { speed: 180 });
      FX.float(f.x, f.y - 64, "能量+" + gain, "#a5b4fc", 15);
    } else if (id === "b_fence" || id === "b_turret" || id === "b_cannon") {
      /* v4.1 末日防御建筑：扣钱放在 placeStructure 里做（放不下不扣钱） */
      if (!this.placeStructure(f, id.slice(2))) return false;
    } else return false;
    if (typeof Audio2 !== "undefined" && Audio2.buy) Audio2.buy();
    return true;
  };

  /* ==========================================================
   *  v4.1 世界末日：商店防御建筑（栅栏 / 小型枪台 / 固定炮台）
   *  买完立在玩家面朝方向 52px 处；枪台自动点射、炮台范围轰炸，
   *  两者都会把附近僵尸的仇恨从玩家身上抢过来（贴身的僵尸改为啃建筑）。
   * ========================================================== */
  B.placeStructure = function (f, kind) {
    if (!f || f.dead || !this.terrain) return false;
    const D = (LD.DOOMSDAY || {}).build || {};
    const cfg = D[kind];
    if (!cfg) return false;
    if ((f.bcoins || 0) < cfg.price) return false;
    const T = LD.Terrain, TILE = LD.TERRAIN.tile || 40;
    const fx = f.facing ? f.facing.x : 1, fy = f.facing ? f.facing.y : 0;
    const fd = Math.hypot(fx, fy) || 1;
    let px = f.x + fx / fd * 52, py = f.y + fy / fd * 52;
    px = Math.max(TILE, Math.min(this.world.w - TILE, px));
    py = Math.max(this.world.pt + TILE, Math.min(this.world.h - TILE, py));
    /* 末日地图：只能立在陆地（岛 / 桥 / 大陆）上，悬崖上放不了 */
    if (T.landAt && !T.landAt(px, py)) {
      const p2 = T.landFit ? T.landFit(px, py) : null;
      if (!p2) { FX.float(f.x, f.y - 64, "那里是悬崖", "#f87171", 14); return false; }
      px = p2.x; py = p2.y;
    }
    if (!T.clearAt(this.terrain, px, py, 20)) {
      FX.float(f.x, f.y - 64, "这里放不下", "#f87171", 14); return false;
    }
    const spec = {
      fence:  { kind: "barrier", mat: "fence_wood", shape: "bar",   elev: 28, mass: 1.0 },
      turret: { kind: "turret",  mat: "metal",      shape: "round", elev: 34, mass: 3.4 },
      cannon: { kind: "cannon",  mat: "metal",      shape: "round", elev: 36, mass: 4.2 }
    }[kind];
    const name = { fence: "栅栏", turret: "小型枪台", cannon: "固定炮台" }[kind];
    this.terrain.props.push({
      uid: 950000 + ((this._structSeq = (this._structSeq || 0) + 1)),
      kind: spec.kind, mat: spec.mat, shape: spec.shape,
      cw: 1, ch: 1, w: TILE, h: TILE,
      x: px, y: py, ox: px, oy: py,
      elev: spec.elev, mass: spec.mass,
      hp: cfg.hp, maxHp: cfg.hp,
      dead: false, flash: 0, vx: 0, vy: 0, free: false, glow: null,
      boomR: 0, boomDmg: 0, variant: (this._structSeq * 137) % 997,
      soft: false, blockMove: true,
      blockProj: spec.kind !== "barrier",
      side: f.side, owner: f, shotT: 0, aimAngle: 0
    });
    f.bcoins -= cfg.price;
    FX.ring(px, py, 44, "#fbbf24", 5, 0.45);
    FX.burst(px, py - 16, 12, ["#fde68a", "#fff"], { speed: 170 });
    FX.float(px, py - 56, name + "！", "#fbbf24", 15);
    if (typeof Audio2 !== "undefined" && Audio2.buy) Audio2.buy();
    return true;
  };
  /** 离 f 最近的防御建筑（僵尸抢仇恨 / 啃咬都用它），r 内没有返回 null */
  B.guardPostNear = function (f, r) {
    if (!this.terrain) return null;
    let best = null, bd = r;
    for (const o of this.terrain.props) {
      if (o.dead || (o.kind !== "turret" && o.kind !== "cannon")) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  B.updateGuardPosts = function (dt) {
    if (this.rule !== "doomsday" || !this.terrain) return;
    const D = (LD.DOOMSDAY || {}).build || {};
    for (const o of this.terrain.props) {
      if (o.dead || (o.kind !== "turret" && o.kind !== "cannon")) continue;
      const S = D[o.kind] || {};
      o.shotT = Math.max(0, (o.shotT || 0) - dt);
      const range = S.range || 300;
      let best = null, bd = Infinity;
      for (const z of this.fighters) {
        if (z.dead || !z.isZombie) continue;
        const d = Math.hypot(z.x - o.x, z.y - o.y);
        if (d <= range && d < bd) { bd = d; best = z; }
      }
      o._target = best;
      if (!best) continue;
      const oy = o.y - (o.elev || 34) * 0.5;
      o.aimAngle = Math.atan2(best.y - 26 - oy, best.x - o.x);
      if (o.shotT > 0) continue;
      o.shotT = S.atk || 1.1;
      const owner = o.owner;   // owner 只做伤害归属（金币/分数），死了也照算
      if (o.kind === "turret") {
        /* 小型枪台：高速点射弹（不吃 blockProj？吃的，正常飞行物） */
        const a = o.aimAngle, sp = S.projSpeed || 920;
        this.spawnProj({
          x: o.x + Math.cos(a) * 18, y: oy + Math.sin(a) * 12,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          r: 7, dmg: S.dmg || 12, life: 1.8, owner: owner,
          color: "#fbbf24", core: "#fff7d6", type: "turretshot", kindTag: "skill", trail: true
        });
        FX.burst(o.x + Math.cos(a) * 20, oy, 5, ["#fbbf24", "#fff"], { speed: 130, dir: a });
      } else {
        /* 固定炮台：低频范围轰炸 —— 朝目标当前位置落一发延迟炮弹（复用高压弹通道） */
        this.bombs = this.bombs || [];
        this.bombs.push({ x: best.x, y: best.y, t: S.shellT || 0.55, max: S.shellT || 0.55,
          owner: owner, r: S.boomR || 90, dmg: S.dmg || 34, cannon: true });
        FX.ring(o.x, oy, 30, "rgba(251,191,36,.9)", 4, 0.35);
      }
    }
    /* 僵尸啃咬：被枪台/炮台吸引过来的僵尸，贴近就啃建筑（建筑是它们唯一够得着的敌人） */
    for (const z of this.fighters) {
      if (z.dead || !z.isZombie) continue;
      z.biteT = Math.max(0, (z.biteT || 0) - dt);
      if (z.biteT > 0) continue;
      const post = this.guardPostNear(z, 64);
      if (!post) continue;
      z.biteT = 0.8;
      LD.Terrain.hitProp(this.terrain, post, 12, { melee: true, src: z });
      FX.burst(post.x + rand(-10, 10), post.y - 30, 5, ["#a3e635", "#fff"], { speed: 120 });
    }
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

  /* ==========================================================
   *  天外来物：随机降落技能 / 大招掉落物（v2.5)
   *  - 每 10s 掉一个技能、每 20s 掉一个大招，降落 2s 后可拾取
   *  - 拾取：先装 skill1（K）再 skill2（L），大招装 ult（O）
   *  - 槽位满 → 碰到时挂 pending，玩家按对应键后先照常出手，0.3s 后置换，
   *    被换下的技能以掉落物形式留在原地
   *  - 场上最多 maxSkill 个技能 / maxUlt 个大招，超限最旧的消失
   * ========================================================== */
  /* v2.7：天外来物与缩圈乱斗共用同一套掉落系统，只是容量 / 节奏不同 */
  B.giftRule = function () { return this.rule === "gifts" || this.rule === "ring"; };
  B.giftCfg = function () {
    const G = LD.GIFTS || {};
    const base = {
      skillEvery: G.skillEvery != null ? G.skillEvery : 10,
      ultEvery: G.ultEvery != null ? G.ultEvery : 20,
      firstSkill: G.firstSkill != null ? G.firstSkill : 3,
      firstUlt: G.firstUlt != null ? G.firstUlt : 8,
      maxSkill: G.maxSkill != null ? G.maxSkill : 3,
      maxUlt: G.maxUlt != null ? G.maxUlt : 2,
      fallT: G.fallT != null ? G.fallT : 2, pickR: G.pickR != null ? G.pickR : 30
    };
    if (this.rule === "ring" && G.ring) Object.assign(base, G.ring);
    return base;
  };

  B.spawnGift = function (kind, id, x, y, landed) {
    const G = LD.GIFTS || {};
    /* 缩圈乱斗：掉落点有一半概率落在圈外，想捡就得冒着中毒的风险出去 */
    if (x == null && y == null && this.rule === "ring") {
      const p = this.ringDropSpot(0.55); x = p.x; y = p.y;
    }
    const g = {
      kind, id: id || this.randGiftId(kind),
      x: x != null ? x : rand(70, B.world.w - 70),
      y: y != null ? y : rand(B.world.pt + 20, B.world.h - 60),
      t: landed ? (G.fallT || 2) : 0, landed: !!landed, born: this.t
    };
    this.gifts.push(g);
    if (landed) FX.ring(g.x, g.y, 44, kind === "ult" ? "rgba(251,191,36,.9)" : "rgba(103,232,249,.9)", 4, 0.5);
    return g;
  };

  B.randGiftId = function (kind) {
    const pool = LD.skillsBy(kind === "ult" ? "ult" : "skill") || [];
    return pool.length ? pool[(Math.random() * pool.length) | 0].id : null;
  };

  B.trimGifts = function (kind, except) {
    const cfg = this.giftCfg();
    const cap = kind === "ult" ? cfg.maxUlt : cfg.maxSkill;
    const same = this.gifts.filter(g => g.kind === kind && g !== except);
    if (same.length <= cap) return;
    same.sort((a, b) => a.born - b.born);
    const overflow = same.slice(0, same.length - cap);
    for (const g of overflow) {
      const i = this.gifts.indexOf(g);
      if (i >= 0) { FX.burst(g.x, g.y - 12, 10, ["#9fb3dd", "#fff"], { speed: 130 }); this.gifts.splice(i, 1); }
    }
  };

  B.updateGifts = function (dt) {
    const G = this.giftCfg();
    // 计时刷落
    this.giftT = (this.giftT == null ? G.firstSkill : this.giftT) - dt;
    this.giftUltT = (this.giftUltT == null ? G.firstUlt : this.giftUltT) - dt;
    if (this.giftT <= 0) { this.spawnGift("skill"); this.trimGifts("skill"); this.giftT = G.skillEvery; }
    if (this.giftUltT <= 0) { this.spawnGift("ult"); this.trimGifts("ult"); this.giftUltT = G.ultEvery; }
    /* v3.3：掉落物不再「碰到即装备」——走到旁边按 P 拾取（见 45_interact.js）。
     * 这里只负责降落动画与过期提示。 */
    for (let i = this.gifts.length - 1; i >= 0; i--) {
      const g = this.gifts[i];
      if (g.noPick > 0) g.noPick = Math.max(0, g.noPick - dt);
      if (!g.landed) {
        g.t += dt;
        if (g.t % 0.08 < dt) FX.trail(g.x + rand(-6, 6), g.y - 18 - (1 - g.t / (G.fallT || 2)) * 130, g.kind === "ult" ? "#fcd34d" : "#67e8f9", 4, 0.35);
        if (g.t >= (G.fallT || 2)) { g.landed = true; FX.ring(g.x, g.y, 40, g.kind === "ult" ? "rgba(252,211,77,.95)" : "rgba(103,232,249,.95)", 4, 0.45); }
      }
    }
  };

  B.equipGift = function (f, slot, g) {
    const sk = LD.skill(g.id);
    const gi = this.gifts.indexOf(g);
    if (gi >= 0) this.gifts.splice(gi, 1);
    f.loadout[slot] = g.id;
    f.cd[slot] = 0.5;
    f.slot[slot] = { on: false, phase: "", t: 0, d: {} };
    if (f.skillGot) f.skillGot[slot] = this.t;
    FX.ring(f.x, f.y - 26, 54, "#7fe6f7", 4, 0.4);
    FX.burst(g.x, g.y - 14, 14, ["#7fe6f7", "#fff"], { speed: 180 });
    const slotLab = { skill1: "K", skill2: "L", ult: "U" }[slot];
    FX.float(f.x, f.y - 64, "获得 " + (sk ? sk.name : "?") + " → " + slotLab, "#7fe6f7", 15);
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
  B.segHit = segHit;

  /* ==========================================================
   *  输入 → 动作
   * ========================================================== */
  B.SLOTS = ["basic", "skill1", "skill2", "ult"];

  B.trySlot = function (f, slot, ctrl) {
    if (f.dead || f.stun > 0 || Cine_paused()) return;
    /* v4.10 碰碰车竞技：技能与大招全部禁用，普攻（喇叭）照常 */
    if (this.rule === "bump" && slot !== "basic") {
      if (ctrl && ctrl.press && ctrl.press[slot] && (f._bumpNoSkillT == null || this.t - f._bumpNoSkillT > 1.2)) {
        f._bumpNoSkillT = this.t;
        FX.float(f.x, f.y - 56, "碰碰车上不能用技能", "#9fb3dd", 13);
      }
      return;
    }
    /* v4.11 烫手山芋：普攻 / 技能 / 大招**全部**禁用——手上这颗芋头就是全部武器 */
    if (this.rule === "hotpotato") {
      if (ctrl && ctrl.press && ctrl.press[slot] && (f._hotNoSkillT == null || this.t - f._hotNoSkillT > 1.2)) {
        f._hotNoSkillT = this.t;
        FX.float(f.x, f.y - 56, "烫手山芋里不能用招式", "#9fb3dd", 13);
      }
      return;
    }
    /* v4.11 护送情报箱：推箱期间技能 / 大招禁用（普攻照常，用来清挡路的人）。
     * 和闪避一起构成「推箱是有代价的」——推着箱子就没法自保，只能靠队友护驾。 */
    if (this.rule === "escort" && f.pushBox && slot !== "basic") {
      if (ctrl && ctrl.press && ctrl.press[slot] && (f._pushNoSkillT == null || this.t - f._pushNoSkillT > 1.2)) {
        f._pushNoSkillT = this.t;
        FX.float(f.x, f.y - 56, "推箱时无法使用技能", "#9fb3dd", 13);
      }
      return;
    }
    /* v3.3：躲在柜子里 / 坐在驾驶位上时不能出招（车上只有喇叭与坦克火炮） */
    if (f.hideProp) return;
    if (f.rideCar) { if (f._rideNoSkillT == null || this.t - f._rideNoSkillT > 1.2) { f._rideNoSkillT = this.t; FX.float(f.x, f.y - 56, "车上无法使用技能", "#9fb3dd", 13); } return; }
    // 王从天降飞起期间：与眩晕同级的自锁，任何技能（含位移类）都无法使用
    if (f.slot && f.slot.ult.on && f.slot.ult.phase === "kingRise") return;
    const id = f.loadout[slot];
    const sk = LD.skill(id);
    if (!sk) { if (slot === "basic") flashNoSkill(f, slot); return; }
    // 绝望囚牢：圈内对手禁用技能与大招（普攻不受影响）
    if (sk.kind !== "basic" && f.silenceT > 0) {
      FX.float(f.x, f.y - 56, "被禁言了！", "#c4b5fd", 14);
      return;
    }
    // 隐匿期间使用普攻或技能 → 提前现形（隐匿进入冷却），本次攻击正常生效
    // （g_ghost：快枪手大招隐身期间攻击不破除隐身，靠 stealthKeep 旁路）
    if (f.stealthT > 0 && !f.stealthKeep && slot !== f.stealthSlot) B.breakStealth(f);
    // 二段类技能（位移斩 / 飞雷神 / 王从天降等）：槽位进行中时再按一次触发第二段
    // 注意要在大招能量检查之前——二段不需要再消耗能量（一段已扣过）
    const cur = f.slot[slot];
    if (cur.on && IMPL[id] && IMPL[id].again && IMPL[id].again(f, slot, sk)) return;
    if (cur.on) return;
    // 大招能量（v2.6：BOSS 不吃能量——镜影会整套装玩家的英雄大招，同样走 CD 制）
    if (sk.kind === "ult" && !f.isBoss) {
      if (f.energy < f.maxEnergy) { FX.float(f.x, f.y - 56, "能量不足", "#9fb3dd", 13); return; }
    }
    if (f.cd[slot] > 0) return;
    if (f.meditate > 0) return;
    // 能量消耗
    if (sk.kind === "ult" && !f.isBoss) f.energy = 0;
    /* v3.1 草丛：一出手就从草里暴露 1.4 秒 */
    if (f.bushHide) { f.bushFlash = 1.4; f.bushHide = false; FX.float(f.x, f.y - 58, "暴露！", "#fde68a", 13); }
    IMPL[id].start(f, slot, sk, ctrl);
  };

  function flashNoSkill(f, slot) {
    if (f._noSkillT > 0) return; f._noSkillT = 0.8;
    FX.float(f.x, f.y - 56, "空槽位", "#9fb3dd", 12);
  }

  /* v3.9 皇冠图标：三尖一带的金色小皇冠，alpha 用于天降时的淡入 */
  function drawCrownIcon(ctx, x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(-14, 8); ctx.lineTo(-14, -6);
    ctx.lineTo(-7, 1); ctx.lineTo(0, -9);
    ctx.lineTo(7, 1); ctx.lineTo(14, -6);
    ctx.lineTo(14, 8);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -10, 0, 10);
    g.addColorStop(0, "#fff7d6"); g.addColorStop(0.5, "#fbbf24"); g.addColorStop(1, "#b45309");
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = "#78350f"; ctx.lineWidth = 1.2; ctx.stroke();
    /* 三颗宝石 */
    [[-9, 4], [0, 4], [9, 4]].forEach(p => {
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.7, 0, TAU);
      ctx.fillStyle = p[0] === 0 ? "#f87171" : "#60a5fa"; ctx.fill();
    });
    ctx.restore();
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
    // 天外来物：拾取与替换统一走 P 交互键（v3.3），这里不再做「按键置换」
    ctrl.press.basic = ctrl.press.skill1 = ctrl.press.skill2 = ctrl.press.ult = false;
    ctrl.press.interact = false;
  };

  /* ==========================================================
   *  主循环
   * ========================================================== */
  B.update = function (rdt) {
    if (this.state === "idle" || this.state === "over") return;
    if (this.paused) { FX.update(rdt); return; }   // v2.6：本地暂停（Esc 面板 / 军备商店）冻结世界
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
      if (this.countdown <= 0) {
        this.state = "fight";
        const mh = this.hero(this.mySide == null ? 0 : this.mySide) || this.fighters[0];
        FX.float(mh ? mh.x : B.world.w / 2, mh ? mh.y - 80 : B.world.h * 0.4, "开始！", "#7fe6f7", 30);
      }
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
      if (f.dead || f.bench) return;
      if (f.kind === "laneMinion") return;        // v3.7 塔防小兵由 updateTower 推进
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

    /* v3.3 车辆驾驶 / 撞击 / 油量（在弹道之前，司机位置先落到车身上） */
    if (this.updateVehicles) this.updateVehicles(dt);
    /* v4.0 世界末日：悬崖边界 —— 位移 / 击退 / 载具统统不许把人送出陆地 */
    if (this.rule === "doomsday") this.clampDoomLand();
    /* v3.5 吹风机气流：在位移之后、弹道之前把角色往外吹 */
    if (this.updateWind) this.updateWind(dt);
    this.updateProjs(dt);
    if (this.terrain) LD.Terrain.update(this.terrain, dt, this);
    this.updatePickups(dt);
    /* v3.9.1 停电夜战：手电筒耗电、黑暗条涨落、条满掉血 */
    if (this.updateNight) this.updateNight(dt);
    /* v4.5 护送情报箱：拾取 / 交付 / 重生 / 限时结算 */
    if (this.rule === "escort" && this.updateEscort) this.updateEscort(dt);
    /* v4.6 占点争夺：占领读条 / 产分 / 限时结算 */
    if (this.rule === "capture" && this.updateCapture) this.updateCapture(dt);
    /* v4.8 碰碰车竞技：车对车撞击 / 出圈落水 / 复活 / 计分 */
    if (this.rule === "bump" && this.updateBump) this.updateBump(dt);
    /* v4.11 烫手山芋：山芋天降 / 传递 / 倒计时爆炸 */
    if (this.rule === "hotpotato" && this.updateHotPotato) this.updateHotPotato(dt);
    /* v3.9 能量包蓄力：进度推进与中断判定（锁移动 / 锁技能在角色循环里） */
    if (this.updateCharging) this.updateCharging(dt);
    this.updateZones(dt);
    if (this.giftRule()) this.updateGifts(dt);
    /* ---- v2.7 血包与掉落补给 ---- */
    this.updateHeals(dt);
    this.healTimerStep(dt);
    /* ---- v2.6 / v2.7 各规则 / 系统推进 ---- */
    this.updateMinions(dt);
    /* v3.7 塔防：兵线、建筑开火、基地回血、复活与 10 分钟倒计时 */
    if (this.rule === "tower" && this.updateTower) this.updateTower(dt);
    this.updateZombies(dt);
    this._corpseT = (this._corpseT || 0) - dt;
    if (this._corpseT <= 0) { this._corpseT = 0.5; this.trimZombieCorpses(); }
    this.updateRespawn(dt);
    this.updateBossPhase(dt);
    this.updateWheel(dt);
    if (this.rule === "ring") this.updateRing(dt);
    if (this.rule === "hunt") this.updateHunt(dt);
    if (this.rule === "auction") this.updateAuction(dt);
    if (this.rule === "doomsday") { this.updateAuction(dt); this.updateDoomsday(dt); this.updateGateSlow(dt); this.updateGuardPosts(dt); this.updateBombs(dt); }
    /* v3.3 规则修饰符：物资刷新 */
    if (this.mod && this.mod("refresh") && this.updateRefresh) this.updateRefresh(dt);
    if (this.rule === "relay") this.relayTick(dt);
    /* v2.6 磁暴坦克「极性反转」：全场飞行物被吸向场地中心 */
    if (this.magnetT > 0) {
      this.magnetT -= dt;
      const cx = B.world.w / 2, cy = (B.world.pt + B.world.h) / 2;
      this.projs.forEach(p => {
        if (p.type === "hbomb") return;
        const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
        p.vx += dx / d * 620 * dt; p.vy += dy / d * 620 * dt;
      });
    }
    // 黑侠客分身：到时消散（被击散的 0.9s 尸体期由 kill() 设置 cloneT）
    for (let i = this.fighters.length - 1; i >= 0; i--) {
      const c = this.fighters[i];
      if (!c.isClone) continue;
      c.cloneT = (c.cloneT != null ? c.cloneT : (LD.BOSS.ninja ? LD.BOSS.ninja.skill1.dur : 6)) - dt;
      if (c.cloneT <= 0) {
        FX.burst(c.x, c.y - 26, 24, ["#a78bfa", "#334155", "#fff"], { speed: 260 });
        FX.float(c.x, c.y - 56, "分身消散", "#a78bfa", 14);
        this.fighters.splice(i, 1);
      }
    }
    if (this.rule === "overlord" && this.updateCrown) this.updateCrown(dt);
    /* v2.6 双子剑客：每 8 秒换位 + 真身标记互换 */
    if (this.twinSwapT != null) {
      this.twinSwapT -= dt;
      if (this.twinSwapT <= 0) {
        this.twinSwapT = 8;
        const twins = this.fighters.filter(x => x.isTwin && !x.dead);
        if (twins.length >= 2) {
          const A = twins[0], B2 = twins[1];
          const tx = A.x, ty = A.y;
          A.x = B2.x; A.y = B2.y; B2.x = tx; B2.y = ty;
          this.twinMark = this.twinMark === A.side ? B2.side : A.side;
          FX.ring(A.x, A.y - 26, 70, "rgba(148,163,184,.9)", 5, 0.4);
          FX.ring(B2.x, B2.y - 26, 70, "rgba(148,163,184,.9)", 5, 0.4);
          FX.float((A.x + B2.x) / 2, Math.min(A.y, B2.y) - 80, "换位！真身互换", "#94a3b8", 16);
          this.ev.push(["h", (A.x + B2.x) / 2, Math.min(A.y, B2.y) - 80, "换位！真身互换", "#94a3b8"]);
        }
      }
    }
    this.regen(dt);

    /* v2.7 乱斗热身：时间到按击杀分结算，不淘汰、不进回合流程 */
    if (this.rule === "warmup") {
      this.roundT -= dt;
      if (this.roundT <= 0) {
        const hs = this.humans();
        let bestI = -1, bestS = -1;
        hs.forEach(f => { const i = this.fighters.indexOf(f); const s = this.wScore[i] || 0; if (s > bestS) { bestS = s; bestI = i; } });
        const meF = this.hero(this.mySide == null ? 0 : this.mySide);
        this.matchWinner = bestI >= 0 ? this.fighters[bestI].side : 0;
        this.finish(!!(meF && this.fighters.indexOf(meF) === bestI));
        return;
      }
    }
    /* v3.2 世界末日：限时；时间到按分数判胜（不看剩余血量），只剩一人则提前结算 */
    if (this.rule === "doomsday") {
      this.roundT -= dt;
      if (this.roundT <= 0) {
        const alive = this.humans(true);
        let best = null, bs = -1;
        alive.forEach(f => {
          const s = this.wScore[this.fighters.indexOf(f)] || 0;
          if (s > bs) { bs = s; best = f; }
        });
        const meF = this.hero(this.mySide == null ? 0 : this.mySide);
        this.matchWinner = best ? best.side : -1;
        if (best) {
          FX.float(best.x, best.y - 80, "最高分获胜！", "#fcd34d", 22);
          LD.Cine.start(best, "胜者：" + (best.name || ("玩家" + (best.side + 1))), "", "#fcd34d", bs + " 分");
        }
        this.finish(!!(meF && best && best.side === meF.side));
        return;
      }
    }
    /* v4.8 碰碰车竞技：限时；时间到按撞爆 / 撞出擂台的得分判胜 */
    if (this.rule === "bump") {
      this.roundT -= dt;
      if (this.roundT <= 0 && this.bumpTimeUp) this.bumpTimeUp();
    }
    // 决斗模式倒计时（v2.7：缩圈 / 车轮战 / 追猎 / 热身都有各自的时钟逻辑，不走通用倒计时）
    if (this.mode !== "dragon" && this.rule !== "ring" && this.rule !== "relay"
        && this.rule !== "hunt" && this.rule !== "warmup" && this.rule !== "doomsday"
        && this.rule !== "tower" && this.rule !== "escort" && this.rule !== "capture"
        && this.rule !== "bump" && this.rule !== "hotpotato") {
      this.roundT = (this.roundT || 75) - dt;
      if (this.roundT <= 0) {
        /* 超时：当前血量最高者赢下回合（平血按座位号） */
        const alive = this.humans(true);
        let w = alive[0] || this.humans()[0] || this.fighters[0];
        alive.forEach(x => { if (x.hp > w.hp) w = x; });
        this.endRound(w.side);
      }
    }
    /* v2.6 追猎时刻倒计时：时间到还有生存者活着 → 生存者获胜 */
    if (this.rule === "hunt") {
      this.roundT -= dt;
      if (this.roundT <= 0) {
        const runners = this.fighters.filter(x => x.kind === "hero" && x.huntRole === "runner" && !x.dead && !x.bench);
        const meF = this.hero(this.mySide == null ? 0 : this.mySide);
        const iAmRunner = meF && meF.huntRole === "runner";
        this.matchWinner = runners.length ? runners[0].side : 0;
        this.finish(iAmRunner ? runners.length > 0 : runners.length === 0);
        return;
      }
    }
    // 越界修正 + 墙体（场地边界与绝望囚牢圈壁都视作墙体）
    this.fighters.forEach(f => {
      if (f.kind === "dragon") { f.x = clamp(f.x, 90, B.world.w - 90); f.y = clamp(f.y, B.world.pt + 20, B.world.h - 70); return; }
      const px = f.x, py = f.y;
      f.x = clamp(f.x, 34, B.world.w - 34);
      f.y = clamp(f.y, B.world.pt, B.world.h - 40);
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
      /* 杂兵（工蜂等）没有 cd / buff / energy 字段，直接跳过，
         否则 f.cd.basic 会炸出 TypeError 卡死整个渲染循环 */
      if (f.kind === "minion" || f.kind === "laneMinion") return;
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
      if (f.gateSlowT > 0) f.gateSlowT = Math.max(0, f.gateSlowT - dt);
      if (f.silenceT > 0) f.silenceT = Math.max(0, f.silenceT - dt);
      if (f.pushT > 0) f.pushT = Math.max(0, f.pushT - dt);
      if (f.speedBoostT > 0) f.speedBoostT = Math.max(0, f.speedBoostT - dt);
      if (f.bushFlash > 0) f.bushFlash = Math.max(0, f.bushFlash - dt);
      /* v2.6 词条：回春（每 10 秒回血 3） */
      if (f.perkRegen && f.hp > 0 && f.hp < f.maxHp) {
        f.regenAcc = (f.regenAcc || 0) + dt;
        if (f.regenAcc >= 10) { f.regenAcc = 0; this.heal(f, 3); FX.float(f.x, f.y - 56, "+3", "#7ff0c4", 13); }
      }
      // 血量 / 位置历史（败者食尘：回溯约 3 秒的血量与位置）
      if (f.kind === "hero") {
        (f.hpHist = f.hpHist || []).push({ t: this.t, hp: f.hp });
        (f.posHist = f.posHist || []).push({ t: this.t, x: f.x, y: f.y });
        /* v3.1 败者食尘：技能冷却同样回溯 3 秒 */
        (f.cdHist = f.cdHist || []).push({ t: this.t,
          cd: { basic: f.cd.basic, skill1: f.cd.skill1, skill2: f.cd.skill2, ult: f.cd.ult } });
        while (f.hpHist.length && f.hpHist[0].t < this.t - 3.6) f.hpHist.shift();
        while (f.posHist.length && f.posHist[0].t < this.t - 3.6) f.posHist.shift();
        while (f.cdHist.length && f.cdHist[0].t < this.t - 3.6) f.cdHist.shift();
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
    /* v3.4：隐匿第 2 秒会闪形 0.4 秒 —— AI 只有这一小段能看见（其余时间完全隐身） */
    f._stealthFlash = !f._ghostNoFlash && f.stealthT > 1.6 && f.stealthT <= 2.0;
    if (f.parryT > 0) f.parryT = Math.max(0, f.parryT - dt);
    // 眨眼
    f.blinkT -= dt;
    if (f.blinkT <= 0) { f.blinkT = rand(2.2, 5); f.blinkAmt = 0.12; }
    f.blinkAmt = Math.min(1, f.blinkAmt + dt * 12);

    // 击退速度衰减
    f.x += f.vx * dt; f.y += f.vy * dt;
    const damp = Math.exp((this.mod && this.mod('lowgrav') ? -4.2 : -7.5) * dt); f.vx *= damp; f.vy *= damp;
    // 赫的定向击飞（固定距离推进，撞墙由越界修正区判定）
    this.knockStep(f, dt);

    const ctrl = f.ctrl || { mx: 0, my: 0, hold: {}, press: {} };
    /* v3.3 交互键 P：先于一切动作处理（躲藏 / 离开 / 上下车 / 拾取 / 扔泥土） */
    if (this.state === "fight" && ctrl.press && ctrl.press.interact) {
      ctrl.press.interact = false;
      if (this.doInteract) this.doInteract(f);
    }
    if (this.state === "fight" && !f.hideProp && !f.rideCar && !f.chg) this.ctrlFire(f, ctrl, dt);
    /* v3.9 蓄力期间（能量包 / 皇冠）：不能移动也不能出手，按键直接吞掉 */
    if (f.chg) {
      ctrl.mx = 0; ctrl.my = 0;
      if (ctrl.press) { ctrl.press.basic = false; ctrl.press.skill1 = false; ctrl.press.skill2 = false; ctrl.press.ult = false; }
    }
    /* 躲进柜子 / 坐在车上 / 开能量包：不能移动、不能闪避（相机与朝向照旧） */
    if (f.hideProp || f.rideCar || f.chg) {
      f.moving = false;
      f.atkAnim = Math.max(0, f.atkAnim - dt);
      /* v3.4 躲藏计时：超过 spotT 秒 AI 就会察觉；这里给玩家一个「被发现了」的提示 */
      if (f.hideProp) {
        f.hideTimer = (f.hideTimer || 0) + dt;
        if (!f.hideSpotted && f.hideTimer >= ((LD.INTERACT && LD.INTERACT.spotT) || 2)) {
          f.hideSpotted = true;
          /* 只有场上真有 AI 对手时才提示「被发现」，纯人对人不用吓唬人 */
          if (this.fighters.some(o => o !== f && !o.dead && o.bot && !this.sameTeam(f, o))) {
            FX.float(f.x, f.y - 66, "被发现了！", "#fbbf24", 14);
            this.ev.push(["t", f.x, f.y - 66, "被发现了！", "#fbbf24"]);
          }
        }
      }
      /* 躲在柜子里时把攻击键吃掉，别让出来之后补放一发 */
      if (f.hideProp && ctrl.press) {
        ctrl.press.basic = ctrl.press.skill1 = ctrl.press.skill2 = ctrl.press.ult = false;
      }
      return;
    }

    // 双击方向键 → 短位移闪避（无无敌帧，CD 2.5 秒）
    /* v3.1：僵尸没有闪避 */
    if (ctrl.dodge && f.isZombie) ctrl.dodge = null;
    /* v4.11 护送情报箱：推箱时双手占在箱子上，闪避禁用（按 P 松手后才能闪） */
    if (ctrl.dodge && this.rule === "escort" && f.pushBox) {
      ctrl.dodge = null;
      if (f._pushNoDodgeT == null || this.t - f._pushNoDodgeT > 1.2) {
        f._pushNoDodgeT = this.t;
        FX.float(f.x, f.y - 56, "推箱时无法闪避", "#9fb3dd", 13);
      }
    }
    if (ctrl.dodge) {
      const dv = ctrl.dodge; ctrl.dodge = null;
      // 激光蓄力中双击方向键 → 直接取消该技能（不然可以用位移把激光带到别的位置）
      const lz = f.slot.skill1.phase === "laserCharge" ? "skill1"
               : f.slot.skill2.phase === "laserCharge" ? "skill2" : null;
      const locked = ["dash", "bdash", "blinkCharge", "rush", "meditate", "chainCharge"]
        .some(ph => f.slot.skill1.phase === ph || f.slot.skill2.phase === ph);
      if (lz) {
        B.endSlot(f, lz, 2);
        FX.float(f.x, f.y - 56, "已取消蓄力", "#67e8f9", 14);
        B.ev.push(["h", f.x, f.y - 56, "已取消蓄力", "#67e8f9"]);
      } else if (f.stun <= 0 && f.root <= 0 && f.meditate <= 0 && !locked && (f.cd.dodge || 0) <= 0) {
        const n = Math.hypot(dv.x, dv.y);
        if (n > 0.05) {
          const ux = dv.x / n, uy = dv.y / n, dd = C.dodge.dist * (this.mod && this.mod('lowgrav') ? 1.5 : 1);
          for (let i = 1; i <= 4; i++) FX.trail(f.x + ux * dd * i / 4, f.y - 26 + uy * dd * i / 4, "#9be8ff", 5, 0.35);
          f.x = clamp(f.x + ux * dd, 34, B.world.w - 34);
          f.y = clamp(f.y + uy * dd, B.world.pt, B.world.h - 40);
          f.facing = { x: ux, y: uy };
          f.cd.dodge = C.dodge.cd * (f.perkDodgeM || 1);
          f.cd.basic = Math.max(f.cd.basic, C.dodge.cd);   // 普攻与闪避共享 CD：闪避会锁住普攻
          FX.burst(f.x, f.y - 26, 10, ["#9be8ff", "#e0fbff"], { speed: 150, dir: Math.atan2(-uy, -ux), spread: 0.9 });
          FX.float(f.x, f.y - 56, "闪避", "#9be8ff", 13);
        }
      } else if ((f.cd.dodge || 0) > 0) {
        FX.float(f.x, f.y - 56, "闪避冷却中", "#9fb3dd", 12);
      }
    }

    // 移动
    // 王从天降飞起期间自身定身（表现与眩晕一致：不能移动、不能出招）
    const kingRising = !!(f.slot && f.slot.ult.on && f.slot.ult.phase === "kingRise");
    let canMove = f.stun <= 0 && f.root <= 0 && f.meditate <= 0 && !kingRising;
    let sp = C.hero.speed * (f.speedMul || 1);   // BOSS 等特殊单位可带速度倍率
    if (this.mod && this.mod("speed")) sp *= 1.35;   // v2.6 高速修饰符
    if (f.parryT > 0) sp *= 0.42;
    const ls = f.slot.skill1.phase === "laserCharge" || f.slot.skill2.phase === "laserCharge";
    if (ls) canMove = false;   // 激光波蓄力期间无法移动，方向锁定为出手朝向
    /* v3.4 钢链：0.4 秒蓄力期间定身（原来可以边走边蓄，等于没有前摇代价） */
    if (f.slot.skill1.phase === "chainCharge" || f.slot.skill2.phase === "chainCharge") canMove = false;
    if (f.slot.skill1.phase === "blinkCharge" || f.slot.skill2.phase === "blinkCharge") canMove = false;
    if (f.slot.skill1.phase === "dash" || f.slot.skill2.phase === "dash" ||
        f.slot.skill1.phase === "bdash" || f.slot.skill2.phase === "bdash") canMove = false;
    if (f.buff.rush > 0) sp *= LD.skill("meatRush").mul;
    if (f.slowT > 0) sp *= 0.55;   // 被冰痕 / 苍减速
    /* v4.10 护送情报箱：推箱时移速只有正常的 20%（同样是单点乘，不落持久字段） */
    if (f.pushBox && LD.ESCORT) sp *= LD.ESCORT.pushSpeed || 0.2;
    /* v4.11 烫手山芋：刚接手的 2 秒减速（0.5×），熬过去之后提速到 1.2× */
    if (f.hotMul) sp *= f.hotMul;
    /* v3.2 世界末日：僵尸在门洞减速圈里额外变慢（给守门的人留输出窗口） */
    if (f.gateSlowT > 0 && f.isZombie) sp *= (LD.DOOMSDAY && LD.DOOMSDAY.gateSlow) || 0.5;
    /* v3.1：推着汽车 / 轮胎 / 方块走时明显变慢；水池里减速；拾取移速包短暂加速 */
    if (f.pushT > 0) sp *= 0.52;
    if (f.speedBoostT > 0) sp *= 1.35;
    /* v3.7 塔防：疾行符（主动装备） */
    if (f.speedBuffT > 0) sp *= (f.speedBuff || 1.6);
    if (this.terrain && LD.Terrain.waterAt(this.terrain, f.x, f.y)) sp *= 0.55;
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
    /* v3.0 地形碰撞：普通移动 / 闪避 / 击退统一在这里被推出障碍 */
    if (this.terrain) {
      LD.Terrain.collideFighter(this.terrain, f, dt);
      /* v3.1 草丛隐身：站在草丛里进入伪装，出手后短暂现形 */
      const bush = LD.Terrain.bushAt(this.terrain, f.x, f.y);
      f.inBush = !!bush;
      f.bushHide = !!bush && (f.bushFlash || 0) <= 0;
      /* v3.4 草丛躲藏计时：超过 spotT 秒同样会被 AI 察觉 */
      if (f.bushHide) {
        f.bushTimer = (f.bushTimer || 0) + dt;
        if (!f.bushSpotted && f.bushTimer >= ((LD.INTERACT && LD.INTERACT.spotT) || 2)) {
          f.bushSpotted = true;
          if (this.fighters.some(o => o !== f && !o.dead && o.bot && !this.sameTeam(f, o))) {
            FX.float(f.x, f.y - 66, "被发现了！", "#fbbf24", 14);
            this.ev.push(["t", f.x, f.y - 66, "被发现了！", "#fbbf24"]);
          }
        }
      } else {
        f.bushTimer = 0; f.bushSpotted = false;
      }
    } else {
      f.inBush = false; f.bushHide = false; f.bushTimer = 0; f.bushSpotted = false;
    }
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
      if (d > 240) {
        /* v3.0：撞上柱子会沿障碍滑开，而不是卡死 */
        const av = this.terrain ? LD.Terrain.avoid(this.terrain, f.x, f.y, 96) : { x: 0, y: 0 };
        f.x += ((dx / d) + av.x * 0.9) * LD.DRAGON.speed * dt;
        f.y += ((dy / d) + av.y * 0.9) * LD.DRAGON.speed * dt;
      }
      f.facing = { x: dx / d, y: dy / d };
    }
  };

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
          w.team != null && w.team >= 0 ? ((LD.teamColor && LD.teamColor(w.team)) || "#fcd34d") : "#fcd34d", "赢得了本局胜利");
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
  /* v2.6 摄像机：本地角色固定在屏幕中心；只有靠近世界边界时视口才被 clamp，人物才开始偏移 */
  B.updateCam = function () {
    const w = this.world || { w: C.W, h: C.H };
    const me = this.fighters.find(f => f.side === this.mySide && f.kind === "hero") || this.fighters[0];
    const vw = C.W, vh = C.H;
    let tx = 0, ty = 0;
    if (me) {
      tx = clamp(me.x - vw / 2, 0, Math.max(0, w.w - vw));
      ty = clamp((me.y - 30) - vh / 2, 0, Math.max(0, w.h - vh));
    }
    if (!this.cam) this.cam = { x: tx, y: ty };
    let dt = 1;
    try {
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      dt = this._camT ? Math.min(0.12, (now - this._camT) / 1000) : 1;
      this._camT = now;
    } catch (e) { dt = 1; }
    const k = Math.min(1, dt * 18);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  };

  B.draw = function (ctx) {
    const W = C.W, H = C.H;
    this.updateCam();
    ctx.save();
    FX.applyShake(ctx);
    V.arena(ctx, W, H, this.t, this.theme, this.world);

    const worldDraw = () => {
      FX.drawGround(ctx);
      /* v3.7 塔防：基地回血圈、兵线指示与敌方攻击范围 */
      if (this.rule === "tower" && V.towerField) V.towerField(ctx, this);
      /* v3.8 塔防：炸弹画在地面之上、角色之下 */
      if (this.rule === "tower" && V.bomb) (this.bombs || []).forEach(b => V.bomb(ctx, b, this.t));
      /* ---- v2.7 毒圈绘制：缩圈乱斗的多个安全圈 / 追猎时刻的大毒圈，通用同款画法 ---- */
      const poisonSets = [];
      if (this.rule === "ring" && this.rings)
        poisonSets.push({ list: this.rings.filter(c => !c.dead), ink: "rgba(120,10,30,.36)", line: "rgba(248,113,113,.95)", safe: true });
      if (this.rule === "hunt" && this.huntRing)
        poisonSets.push({ list: [this.huntRing], ink: "rgba(120,10,30,.34)", line: "rgba(248,113,113,.9)", safe: false });
      /* v4.0 世界末日：旧版「庇护所外整片红圈」已随出圈掉血一起移除 ——
       * 悬崖地形本身就是边界（深渊 + 崖壁由 V.doomChasm 绘制），再叠一层红会把整张图染成暗红色 */
      poisonSets.forEach(set => {
        if (!set.list.length) return;
        ctx.save();
        /* 先铺满整块场地，再把安全圈作为「洞」挖掉（evenodd 填充） */
        ctx.beginPath();
        ctx.rect(-40, B.world.pt - 120, B.world.w + 80, B.world.h - B.world.pt + 160);
        set.list.forEach(c => { ctx.moveTo(c.x + c.r, c.y); ctx.arc(c.x, c.y, c.r, 0, TAU, true); });
        ctx.fillStyle = set.ink;
        ctx.fill("evenodd");
        ctx.setLineDash([18, 12]); ctx.lineDashOffset = -this.t * 30;
        set.list.forEach(c => {
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU);
          ctx.strokeStyle = set.line; ctx.lineWidth = 4; ctx.stroke();
          if (set.safe) {                     // 安全圈再描一层绿色内边，区分「圈内安全」
            ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(4, c.r - 6), 0, TAU);
            ctx.strokeStyle = "rgba(52,211,153,.5)"; ctx.lineWidth = 2; ctx.stroke();
          }
        });
        ctx.setLineDash([]);
        ctx.restore();
      });
      /* v4.2 世界末日：整块右大陆是危险区（等同圈外掉血），铺一层缓慢呼吸的红雾 + 虚线边界 */
      if (this.rule === "doomsday") {
        const L = LD.Terrain && LD.Terrain.doomLand;
        if (L) {
          const m = L.main;
          ctx.save();
          ctx.globalAlpha = 0.74 + Math.sin(this.t * 1.7) * 0.12;
          ctx.fillStyle = "rgba(120,10,30,.26)";
          ctx.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
          ctx.globalAlpha = 1;
          ctx.setLineDash([20, 13]); ctx.lineDashOffset = -this.t * 26;
          ctx.strokeStyle = "rgba(248,113,113,.85)"; ctx.lineWidth = 5;
          ctx.strokeRect(m.x0 + 3, m.y0 + 3, m.x1 - m.x0 - 6, m.y1 - m.y0 - 6);
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
      if (this.rule === "doomsday" && this.shelter && this.shelter.gaps) {
        const D = LD.DOOMSDAY || {};
        const gr = D.gateR || 92;
        const pulse = 0.5 + Math.sin(this.t * 2.4) * 0.14;
        this.shelter.gaps.forEach(g => {
          ctx.save();
          ctx.globalAlpha = 0.1 + Math.sin(this.t * 2.4) * 0.03;   // 减速圈淡青色底
          ctx.fillStyle = "#67e8f9";
          ctx.beginPath(); ctx.arc(g.x, g.y, gr, 0, TAU); ctx.fill();
          ctx.globalAlpha = pulse;
          ctx.setLineDash([10, 8]); ctx.lineDashOffset = -this.t * 22;
          ctx.strokeStyle = "rgba(103,232,249,.95)"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(g.x, g.y, gr, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.5 + Math.sin(this.t * 3) * 0.16;
          ctx.strokeStyle = "rgba(52,211,153,.85)"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(g.x, g.y, 34, 46, 0, 0, TAU); ctx.stroke();
          ctx.restore();
        });
      }
      /* v4.5 护送情报箱：交付点 + 地上的箱子 + 持箱者引导线 */
      if (this.rule === "escort" && this.drawEscort) this.drawEscort(ctx);
      /* v4.6 占点争夺：据点圈 + 归属旗 + 占领读条 */
      if (this.rule === "capture" && this.drawCapture) this.drawCapture(ctx);
      /* v4.8 碰碰车竞技：场外水池 + 擂台警示带 + 车辆耐久条 */
      if (this.rule === "bump" && this.drawBump) this.drawBump(ctx);
      /* v4.11 烫手山芋：山芋本体 + 持有者高亮 + 倒计时 */
      if (this.rule === "hotpotato" && this.drawHotPotato) this.drawHotPotato(ctx);
      /* v3.9.1 停电夜战：充电站（排在掉落物之前，压在人物下层） */
      if (this.drawStations) this.drawStations(ctx);
      /* v3.1 补给掉落物：血包 / 能量包 / 移速包 */
      (this.pickups || []).forEach(pk => {
        const bob = Math.sin(this.t * 4 + pk.x * 0.05) * 3;
        const col = pk.kind === "heal" ? "#34d399" : pk.kind === "energy" ? "#818cf8" : "#fbbf24";
        const edge = pk.kind === "heal" ? "#065f46" : pk.kind === "energy" ? "#3730a3" : "#92400e";
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, pk.x, pk.y - 14 + bob, 26, col, 0.42);
        ctx.restore();
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,.3)";
        ctx.beginPath(); ctx.ellipse(pk.x, pk.y + 8, 13, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pk.x, pk.y - 30 + bob);
        ctx.lineTo(pk.x + 12, pk.y - 18 + bob);
        ctx.lineTo(pk.x + 12, pk.y - 4 + bob);
        ctx.lineTo(pk.x, pk.y + 8 + bob);
        ctx.lineTo(pk.x - 12, pk.y - 4 + bob);
        ctx.lineTo(pk.x - 12, pk.y - 18 + bob);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff";
        if (pk.kind === "heal") {
          ctx.fillRect(pk.x - 2.4, pk.y - 21 + bob, 4.8, 12);
          ctx.fillRect(pk.x - 6, pk.y - 17.4 + bob, 12, 4.8);
        } else if (pk.kind === "energy") {
          ctx.beginPath();
          ctx.moveTo(pk.x + 1, pk.y - 24 + bob); ctx.lineTo(pk.x - 5, pk.y - 12 + bob);
          ctx.lineTo(pk.x - 0.5, pk.y - 12 + bob); ctx.lineTo(pk.x - 2, pk.y - 2 + bob);
          ctx.lineTo(pk.x + 6, pk.y - 15 + bob); ctx.lineTo(pk.x + 1, pk.y - 15 + bob);
          ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(pk.x - 7, pk.y - 19 + bob); ctx.lineTo(pk.x - 1, pk.y - 19 + bob);
          ctx.lineTo(pk.x - 5, pk.y - 10 + bob); ctx.lineTo(pk.x + 1, pk.y - 10 + bob);
          ctx.lineTo(pk.x - 4, pk.y - 1 + bob); ctx.lineTo(pk.x - 2, pk.y - 12 + bob);
          ctx.lineTo(pk.x - 8, pk.y - 12 + bob);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      });
      /* v3.9 霸主争霸：皇冠预警圈（地面）与落下的皇冠 */
      if (this.rule === "overlord" && this.crown && this.crown.phase !== "held") {
        const cw = this.crown, C = LD.CROWN || {};
        ctx.save();
        const bob = Math.sin(this.t * 4) * 3;
        if (cw.phase === "warn") {
          /* 落点：收缩的金色圆环 + 倒计时 */
          const p = 1 - Math.max(0, cw.warnT) / (C.warnT || 5);
          ctx.globalAlpha = 0.5 + Math.sin(this.t * 9) * 0.2;
          ctx.strokeStyle = "#fcd34d"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(cw.x, cw.y, 46, 22, 0, 0, TAU); ctx.stroke();
          ctx.setLineDash([6, 6]);
          ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(cw.x, cw.y, 46 + (1 - p) * 40, 22 + (1 - p) * 19, 0, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          /* 天上的皇冠随倒计时下降 */
          const drop = Math.max(0, 1 - cw.warnT / (C.warnT || 5));
          const cy = cw.y - 260 * (1 - drop);
          drawCrownIcon(ctx, cw.x, cy, 1.1, 0.55 + drop * 0.45);
          ctx.fillStyle = "#fde68a"; ctx.font = "bold 13px ui-monospace,Menlo,Consolas,monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText("皇冠 " + Math.ceil(Math.max(0, cw.warnT)) + "s", cw.x, cy - 22);
        } else if (cw.phase === "fallen") {
          ctx.globalAlpha = 0.85;
          V.glow(ctx, cw.x, cw.y - 14, 44, "rgba(252,211,77,.55)", 1);
          ctx.fillStyle = "rgba(0,0,0,.28)";
          ctx.beginPath(); ctx.ellipse(cw.x, cw.y + 6, 22, 8, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          drawCrownIcon(ctx, cw.x, cw.y - 18 + bob, 1.35, 1);
        }
        ctx.restore();
      }

      /* v3.9 蓄力进度条（能量包开包 / 霸主加冕）：头顶进度 + 剩余秒数 */
      this.fighters.forEach(f => {
        if (!f.chg || f.dead) return;
        const cfg = (LD.CHARGE || {})[f.chg.kind] || { need: 5, label: "蓄力", color: "#818cf8" };
        const p = Math.max(0, Math.min(1, f.chg.t / cfg.need));
        const bw = 74, bh = 7, bx = f.x - bw / 2, by = f.y - 84;
        ctx.save();
        ctx.fillStyle = "rgba(10,12,22,.72)";
        ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.fillStyle = "rgba(148,163,184,.28)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = cfg.color;
        ctx.fillRect(bx, by, bw * p, bh);
        ctx.strokeStyle = "rgba(226,232,240,.9)"; ctx.lineWidth = 1;
        ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
        ctx.fillStyle = "#e2e8f0"; ctx.font = "11px ui-monospace,Menlo,Consolas,monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(cfg.label + " " + (cfg.need - f.chg.t).toFixed(1) + "s", f.x, by - 4);
        ctx.restore();
      });
      (this.coins || []).forEach(c => {                 // 军备竞赛：局内金币
        const bob = Math.sin(this.t * 5 + c.x) * 3;
        ctx.save();
        V.glow(ctx, c.x, c.y - 12 + bob, 22, "rgba(252,211,77,.5)", 1);
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath(); ctx.arc(c.x, c.y - 12 + bob, 8, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#b45309"; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = "#fde68a";
        ctx.beginPath(); ctx.arc(c.x - 2.4, c.y - 15 + bob, 2.6, 0, TAU); ctx.fill();
        ctx.restore();
      });
      if (this.magnetT > 0) {                           // 磁暴坦克：极性反转中心提示
        const cx = B.world.w / 2, cy = (B.world.pt + B.world.h) / 2;
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, cx, cy, 120 + Math.sin(this.t * 8) * 22, "rgba(167,139,250,.35)", 1);
        ctx.restore();
      }
      /* v2.6 新区域预警圈（霜压 / 绝对零度 / 轮盘 / 雷暴） */
      this.zones.forEach(z => {
        if ((z.type !== "quake" && z.type !== "zero" && z.type !== "roul" && z.type !== "bolt") || z.life >= z.warn) return;
        const p = Math.min(1, z.life / z.warn);
        const col = z.type === "quake" ? "147,197,253" : z.type === "zero" ? "191,219,254"
          : z.type === "roul" ? (z.big ? "248,113,113" : "52,211,153") : "167,139,250";
        ctx.save();
        ctx.globalAlpha = 0.10 + p * 0.2;
        ctx.fillStyle = "rgb(" + col + ")";
        ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.55, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = "rgb(" + col + ")"; ctx.lineWidth = 2.4;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.55, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });

      /* v3.1 爆裂之火：外圈预警 + 内圈安全区（挖空） */
      this.zones.forEach(z => {
        if (z.type !== "blaze" || z.life >= z.warn) return;
        const p = Math.min(1, z.life / z.warn);
        const outer = z.r, inner = z.inner || 40;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(z.x, z.y, outer, outer * 0.58, 0, 0, TAU);
        ctx.ellipse(z.x, z.y, inner, inner * 0.58, 0, 0, TAU);
        ctx.globalAlpha = 0.12 + p * 0.22;
        ctx.fillStyle = "#fb923c";
        ctx.fill("evenodd");
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "rgba(251,146,60,.95)"; ctx.lineWidth = 2.6;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.ellipse(z.x, z.y, outer, outer * 0.58, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(134,239,172,.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(z.x, z.y, inner, inner * 0.58, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      });

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
        } else if (z.type === "shuriken") {
          // 螺旋手里剑：巨大蓝色能量球 + 旋转叶片
          const a = Math.min(1, z.life * 5);
          ctx.globalAlpha = a;
          V.glow(ctx, z.x, z.y, z.r * 2.4, "rgba(56,189,248,.55)", 1);
          ctx.save();
          ctx.translate(z.x, z.y); ctx.rotate(z.spin || 0);
          ctx.strokeStyle = "rgba(224,242,254,.95)"; ctx.lineWidth = 4; ctx.lineCap = "round";
          for (let b = 0; b < 4; b++) {
            ctx.rotate(Math.PI / 2);
            ctx.beginPath(); ctx.moveTo(z.r * 0.25, 0); ctx.quadraticCurveTo(z.r * 0.7, -z.r * 0.34, z.r * 0.95, 0);
            ctx.quadraticCurveTo(z.r * 0.7, z.r * 0.34, z.r * 0.25, 0); ctx.stroke();
          }
          const gg = ctx.createRadialGradient(0, 0, 2, 0, 0, z.r * 0.5);
          gg.addColorStop(0, "rgba(255,255,255,.95)"); gg.addColorStop(1, "rgba(56,189,248,.85)");
          ctx.fillStyle = gg;
          ctx.beginPath(); ctx.arc(0, 0, z.r * 0.5, 0, TAU); ctx.fill();
          ctx.restore();
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

      // 天外来物：技能 / 大招掉落物（降落 2 秒后落地可拾取）
      (this.gifts || []).forEach(g => {
        const sk = LD.skill(g.id);
        if (!sk) return;
        const fall = g.landed ? 0 : 1 - g.t / ((LD.GIFTS && LD.GIFTS.fallT) || 2);
        const yy = g.y - 16 - fall * 130;
        const isUlt = g.kind === "ult";
        ctx.save();
        // 影子
        ctx.globalAlpha = 0.3; ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(g.x, g.y + 4, 16 * (1 - fall * 0.5), 6 * (1 - fall * 0.5), 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, g.x, yy, isUlt ? 40 : 28, isUlt ? "rgba(252,211,77,.8)" : "rgba(103,232,249,.8)", 1);
        ctx.globalCompositeOperation = "source-over";
        ctx.font = (isUlt ? "24px" : "19px") + " system-ui";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(sk.icon || "?", g.x, yy);
        if (!g.landed) {
          ctx.globalAlpha = 0.7; ctx.strokeStyle = isUlt ? "#fcd34d" : "#67e8f9"; ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.arc(g.x, g.y, 20, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.font = "700 11px system-ui";
          ctx.fillStyle = isUlt ? "#fcd34d" : "#7fe6f7";
          ctx.fillText(isUlt ? "大招" : "技能", g.x, yy + (isUlt ? 24 : 22));
        }
        ctx.restore();
      });

      // v2.7 血包（「回复」修饰符 / 缩圈模式圈外补给）
      (this.heals || []).forEach(h => {
        const H = LD.HEALS || {};
        const fall = h.landed ? 0 : 1 - h.t / (H.fallT || 1.4);
        const yy = h.y - 12 - fall * 120;
        ctx.save();
        ctx.globalAlpha = 0.3; ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(h.x, h.y + 4, 13 * (1 - fall * 0.5), 5 * (1 - fall * 0.5), 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
        V.glow(ctx, h.x, yy, 26, "rgba(52,211,153,.75)", 1);
        ctx.globalCompositeOperation = "source-over";
        // 白色药箱 + 绿色十字
        ctx.fillStyle = "#f8fafc"; ctx.strokeStyle = "#047857"; ctx.lineWidth = 1.6;
        V.rr(ctx, h.x - 10, yy - 8, 20, 16, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#10b981";
        ctx.fillRect(h.x - 2.2, yy - 6, 4.4, 12);
        ctx.fillRect(h.x - 6, yy - 2.2, 12, 4.4);
        if (h.landed) {
          ctx.font = "700 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = "#6ee7b7";
          ctx.fillText("血包", h.x, yy + 22);
        }
        ctx.restore();
      });

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

      // 角色 + 地形障碍统一按 y 排序，保证人站在箱子前面 / 后面时遮挡关系正确
      const drawList = this.fighters.map(f => ({ f: f, y: f.y + (f.kind === "dragon" ? 20 : 0), prop: null }));
      if (this.terrain) this.terrain.props.forEach(o => {
        if (o.dead || o.kind === "bush" || o.kind === "water") return;
        drawList.push({ f: null, y: o.y + o.h / 2, prop: o });
      });
      drawList.sort((a, b) => a.y - b.y);
      drawList.forEach(it => {
        const f = it.f;
        if (it.prop) { V.prop(ctx, it.prop, this.t); return; }
        if (f.dead && f.corpseGone) return;        // v3.5 超过 10 具的老丧尸尸体已消失
        if (f.dead && this.rule === "tower") return;   // v3.7 塔防：阵亡尸体不留在场上（等复活）
        if (f.bench) return;                       // 车轮战板凳：不渲染
        if (f.rideCar || f.hiddenNet) return;      // v3.3 坐在车里 / 客机收到躲藏状态：只画车或什么都不画
        if (f.hideProp && f !== meHero) return;    // v3.3 躲在柜子里：别人看不见
        /* v3.1 草丛隐身：对手在草丛里时本地看不见 */
        if (f.bushHide && !this.sameTeam(meHero, f)) return;
        if (f.kind === "laneMinion") {              // v3.7 塔防：机器人小兵
          if (!f.dead) V.robot(ctx, f, this.t);
          return;
        }
        if (f.kind === "minion") {                 // v2.6 杂兵（机械蜂等）
          if (!f.dead) V.minion(ctx, f, this.t);
          return;
        }
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
        /* 自己在草丛里：半透明，方便看清走位 */
        const bushAlpha = (f.inBush && f === meHero) ? 0.62 : 1;
        if (bushAlpha < 1) { ctx.save(); ctx.globalAlpha = bushAlpha; }
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
          const flash = !f._ghostNoFlash && f.stealthT > 1.6 && f.stealthT <= 2.0;
          if (f !== meHero && !flash) return;        // 别人视角：完全看不见
          /* v3.9.1 停电夜战里全员一直在隐身状态，再压到 45% 就黑得看不见自己了，
           * 这里按模式给个更实心的自视角——黑幕本来就够暗了。 */
          ctx.save(); ctx.globalAlpha = flash ? 1 : (this.rule === "blackout" ? 0.85 : 0.45);
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
        /* v3.9：走 LD.teamColor，塔防的红 / 蓝两队不再被四队配色染成黄名 */
        const meF2 = this.hero(this.mySide == null ? 0 : this.mySide);
        ctx.save(); ctx.font = "600 11px system-ui"; ctx.textAlign = "center";
        const baseNm = f.name || (f.side === 0 ? "房主" : "玩家" + (f.side + 1));
        const nm = (meF2 && meF2 === f) ? "你 · " + baseNm : baseNm;
        const dot = (f.team != null && f.team >= 0 && !f.isZombie) ? (LD.teamColor ? LD.teamColor(f.team) : (LD.TEAM_COLORS || [])[f.team]) : null;
        const label = ((f.overlord || f.huntRole === "hunter") ? "👑 " : "") + nm;
        ctx.fillStyle = f.isZombie ? "rgba(163,230,53,.95)" : (dot || (f.side === 0 ? "rgba(159,230,247,.9)" : "rgba(255,170,180,.9)"));
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
        if (bushAlpha < 1) ctx.restore();
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

      /* v3.1 草丛前景层：站在草丛里的人被草叶遮住 */
      if (this.terrain) V.bushPass(ctx, this.terrain, this.t);

      /* v3.8 塔防：墓碑压在角色之上，倒计时不会被挡住 */
      if (this.rule === "tower" && V.grave) (this.graves || []).forEach(g => V.grave(ctx, g, this.t));

      /* v3.3 交互提示浮窗（靠近柜子 / 车 / 掉落物 / 泥土时显示 O + 动作） */
      if (this.drawInteractHints) this.drawInteractHints(ctx);

      FX.draw(ctx);
    };

    /* v2.6 世界坐标 → 屏幕：世界内容随摄像机平移（大招演出期间交给 Cine 自己做特写变换） */
    const drawWorld = () => {
      const co = LD.Cine.active ? { x: 0, y: 0 } : (this.cam || { x: 0, y: 0 });
      ctx.save();
      ctx.translate(-Math.round(co.x), -Math.round(co.y));
      if (this.terrain) {
        /* v3.0：地面材质替换原来的空白网格底；边界与顶部渐变仍由 V.ground 补 */
        V.terrainGround(ctx, this.terrain, this.t, co, W, H);
        V.ground(ctx, this.world, this.t, true);
        V.terrainFlat(ctx, this.terrain, this.t);
      } else {
        V.ground(ctx, this.world, this.t);
      }
      worldDraw();
      ctx.restore();
    };

    if (LD.Cine.active) {
      LD.Cine.draw(ctx, W, H, drawWorld);
    } else {
      drawWorld();
      /* v2.6 大地图：视野外的敌人用屏幕边缘箭头提示方位 */
      const meCam = this.fighters.find(f => f.side === this.mySide && f.kind === "hero") || this.fighters[0];
      this.fighters.forEach(f => {
        if (f === meCam || f.dead || f.kind === "minion" || f.bench || f.isClone) return;
        if (this.sameTeam(meCam, f)) return;
        const sx = f.x - (this.cam ? this.cam.x : 0), sy = f.y - (this.cam ? this.cam.y : 0);
        if (sx > 14 && sx < W - 14 && sy > 14 && sy < H - 14) return;
        const cx = clamp(sx, 22, W - 22), cy = clamp(sy, 22, H - 22);
        const ang = meCam ? Math.atan2(f.y - meCam.y, f.x - meCam.x) : 0;
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.fillStyle = "rgba(251,113,133,.9)";
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
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
    /* v3.9.1 停电夜战：全屏黑幕。画在战斗内容与屏幕边缘指示箭头之上、
     * 倒计时与「被糊住了」提示之下——黑幕该盖住场上的人，但不该盖住提示文字。 */
    if (this.drawNight) this.drawNight(ctx, W, H);
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
    if (p.type === "shuriken") {
      // 黑侠客飞镖：旋转四角星
      ctx.translate(p.x, p.y); ctx.rotate(p.life * 16);
      V.glow(ctx, 0, 0, p.r * 2.2, "rgba(103,232,249,.7)", 1);
      ctx.fillStyle = "#e0faff";
      for (let b = 0; b < 4; b++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(p.r * 0.4, -p.r * 0.35); ctx.lineTo(p.r, 0); ctx.lineTo(p.r * 0.4, p.r * 0.35);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath(); ctx.arc(0, 0, p.r * 0.3, 0, TAU); ctx.fill();
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
