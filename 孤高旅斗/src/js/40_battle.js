/* ============================================================
 *  40_battle.js - 战斗引擎核心：实体 / 伤害与能量 / 回合与复活 / 增益掉落 / 主循环与输入
 *  v4.12 工程债已拆出：技能实现 -> 40a_skill.js + 40a_boss.js；绘制 -> 40b_draw.js；
 *                      规则子模块 -> 40c_rule.js；供给与商店 -> 40d_supply.js；
 *                      弹道推进与区域结算 -> 40e_proj.js
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
    /* v4.12 娱乐模式批次：各自的地图尺寸写在自己的配置块里（木头人是一屏小图） */
    if (LD.isCasual && LD.isCasual(this.rule)) {
      const cw = LD.casualWorld(this.rule);
      if (cw) this.world = { w: cw.w, h: cw.h, pt: cw.pt != null ? cw.pt : 120 };
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
    /* v4.12 娱乐模式批次：木头人 / 抢椅子 / 躲猫猫 / 岩浆 / 弹幕 / 滑壶 */
    if (LD.isCasual && LD.isCasual(this.rule) && this.initCasual) this.initCasual();
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
    /* v4.12 木头人：血空只是原地躺一会儿，计时复活后从**当前位置**继续跑（绝不退回起点）。
     * 其余娱乐模式（抢椅子 / 岩浆 / 弹幕 / 滑壶）血空即出局，走下面的通用判定。 */
    if (this.rule === "statue" && f.kind === "hero") {
      f.respawnT = (LD.STATUE || {}).respawn || 3.5;
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
    /* v4.12 木头人：血空只是躺一会儿，复活点由 statueSpot 决定（保留 x 进度） */
    const casualRespawn = !!(LD.isCasual && LD.isCasual(this.rule)) && this.rule === "statue";
    if (this.rule !== "warmup" && this.rule !== "capture" && this.rule !== "escort" && this.rule !== "hotpotato" && !casualRespawn) return;
    const W = this.rule === "escort" ? (LD.ESCORT || {})
            : this.rule === "hotpotato" ? (LD.HOTPOTATO || {})
            : casualRespawn ? (LD.STATUE || {})
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
              : (casualRespawn && this.statueSpot) ? this.statueSpot(f)
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

  const IMPL = LD.SKILL_IMPL;
  /* 技能实现表（IMPL.* 全部招式 / 隐匿 / 炸弹 / 手里剑 / 火柱 / 瞄准工具）已拆分到
   * 40a_skill.js；这里只保留 IMPL 引用（trySlot / updateHero 要读表）与 pushTrail。 */

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
    /* v4.12 娱乐模式批次：普攻 / 技能 / 大招**全部**禁用（碰碰车的喇叭不在此列，
     * 它是 CASUAL 之外的独立规则，上面已经单独处理过了）。
     * 交互键 P 不受影响——场景道具（补给箱 / 柜子 / 车）照常能用。 */
    if (LD.isCasual && LD.isCasual(this.rule)) {
      if (ctrl && ctrl.press && ctrl.press[slot] && (f._casNoSkillT == null || this.t - f._casNoSkillT > 1.2)) {
        f._casNoSkillT = this.t;
        FX.float(f.x, f.y - 56, "这个玩法里不能用招式", "#9fb3dd", 13);
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
    /* v4.12 娱乐模式批次：木头人 / 抢椅子 / 躲猫猫 / 岩浆 / 弹幕 / 滑壶 */
    if (LD.isCasual && LD.isCasual(this.rule) && this.updateCasual) this.updateCasual(dt);
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
    /* v4.12 娱乐模式批次：限时到点由各自的 xxxTimeUp 判胜（比进度 / 比分数 / 比血量），
     * 不走下面那条「血最多者赢」的通用倒计时。 */
    if (LD.isCasual && LD.isCasual(this.rule)) {
      this.roundT -= dt;
      if (this.roundT <= 0 && this.casualTimeUp) this.casualTimeUp();
    }
    // 决斗模式倒计时（v2.7：缩圈 / 车轮战 / 追猎 / 热身都有各自的时钟逻辑，不走通用倒计时）
    if (this.mode !== "dragon" && this.rule !== "ring" && this.rule !== "relay"
        && this.rule !== "hunt" && this.rule !== "warmup" && this.rule !== "doomsday"
        && this.rule !== "tower" && this.rule !== "escort" && this.rule !== "capture"
        && this.rule !== "bump" && this.rule !== "hotpotato"
        && !(LD.isCasual && LD.isCasual(this.rule))) {
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
    /* v4.12 冰面滑壶：阻尼从 -7.5 放宽到 -0.55，人滑出去基本刹不住 */
    const iceDamp = (this.rule === "slide" && LD.SLIDE) ? (LD.SLIDE.damp || -0.55) : -7.5;
    const damp = Math.exp((this.mod && this.mod('lowgrav') ? -4.2 : iceDamp) * dt); f.vx *= damp; f.vy *= damp;
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
    /* v4.12 冰面滑壶：方向键不再是直接位移而是「推力」——
     * 加速度写进 f.vx / f.vy，位移交给上面的 f.x += f.vx·dt（阻尼已改成冰面的）。 */
    if (this.rule === "slide") {
      const ic = LD.SLIDE || {};
      const acc = ic.accel || 640, vmax = ic.vmax || 330;
      if (canMove && n > 0.05) { f.vx += (mx / n) * acc * dt; f.vy += (my / n) * acc * dt; }
      const v = Math.hypot(f.vx, f.vy);
      if (v > vmax) { f.vx = f.vx / v * vmax; f.vy = f.vy / v * vmax; }
      if (v > 12) {
        f.moving = true; f.walkPhase += dt * 11;
        f.facing = { x: f.vx / v, y: f.vy / v };
      } else if (canMove && n > 0.05) {
        f.facing = { x: mx / n, y: my / n };
      }
    } else if (canMove && n > 0.05) {
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
})(window.LD = window.LD || {});
