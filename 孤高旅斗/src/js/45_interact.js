/* ============================================================
 *  45_interact.js — v3.3 交互键（P）/ 载具 / 柜子 / 泥土 / 物资刷新
 * ============================================================
 *  一个交互键统一处理：
 *    - 天外来物 / 缩圈乱斗：走到掉落物旁按 P 拾取
 *      （技能 K/L 两格满了 → 替换「最早获得」的那一格；大招替换当前大招）
 *    - 柜子：按 P 躲进去（敌人看不见）。藏超过 2 秒会被 AI 察觉，
 *      被锁定的目标躲藏无效；被打中则免疫该次伤害、被揪出柜子并眩晕 2 秒
 *    - 汽车：按 P 上车驾驶，再按 P 下车
 *    - 泥土：按 P 拾起，再按 P 朝前方扔出
 *
 *  车辆规则：
 *    - 速度 = 玩家移速 × 1.20~1.70（大巴 / 坦克更慢），有加速度与惯性
 *    - 汽油按「可行驶距离」计（2000~6000px），车顶以血条形式显示
 *    - 车上不能放技能 / 大招；普攻 → 喇叭（坦克 → 5s CD 的火炮）
 *    - 撞人：10 伤害 + 击退，2s CD
 *    - 车上受到任何伤害：免疫该次伤害 + 被打下车 + 眩晕 2s
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, T = LD.Terrain, FX = LD.FX, CFG = LD.INTERACT || {};
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---------------- 基础工具 ---------------- */
  function propGap(f, o) {
    const l = o.x - o.w / 2, r = o.x + o.w / 2, t = o.y - o.h / 2, b = o.y + o.h / 2;
    const nx = Math.max(l, Math.min(r, f.x));
    const ny = Math.max(t, Math.min(b, f.y));
    return Math.hypot(f.x - nx, f.y - ny);
  }
  function freeSpot(f, x, y) {
    if (!B.terrain) return { x: x, y: y };
    if (T.clearAt(B.terrain, x, y, f.r + 2)) return { x: x, y: y };
    const dirs = [[0, 1], [0, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i], px = x + d[0] * (f.r + 30), py = y + d[1] * (f.r + 30);
      if (T.clearAt(B.terrain, px, py, f.r + 2)) return { x: px, y: py };
    }
    return { x: x, y: y };
  }
  const rangeOf = (k) => (CFG[k] != null ? CFG[k] : (CFG.range || 26));

  /* ==========================================================
   *  交互目标扫描
   * ========================================================== */
  B.interactTarget = function (f) {
    if (!f || f.dead) return null;
    if (f.hideProp) return { type: "locker", prop: f.hideProp, label: "离开", gap: 0 };
    if (f.rideCar) return { type: "car", prop: f.rideCar, label: "下车", gap: 0 };
    if (f.carryMud) return { type: "mud", prop: f.carryMud, label: "扔出", gap: 0, carry: true };

    let best = null, bestGap = Infinity;
    const take = (t) => { if (t.gap <= t.lim && t.gap < bestGap) { bestGap = t.gap; best = t; } };

    /* 天外来物 / 缩圈乱斗掉落物 */
    if (this.giftRule && this.giftRule()) {
      const lim = rangeOf("giftRange");
      (this.gifts || []).forEach(g => {
        if (!g.landed || (g.noPick || 0) > 0) return;
        const gap = Math.hypot(f.x - g.x, f.y - g.y) - f.r;
        take({ type: "gift", prop: g, label: "拾取", gap: gap, lim: lim });
      });
    }
    /* v3.9 需要蓄力的目标：能量包（血包 / 移速包仍是接触即生效）、霸主皇冠 */
    if (this.pickups && this.pickups.length) {
      const lim = CFG.openRange != null ? CFG.openRange : 34;
      this.pickups.forEach(pk => {
        if (pk.kind !== "energy") return;
        const gap = Math.hypot(f.x - pk.x, f.y - pk.y) - f.r;
        take({ type: "chg", prop: pk, kind: "pack", label: "开包", gap: gap, lim: lim });
      });
    }
    if (this.crown && this.crown.phase === "fallen") {
      const cw = this.crown;
      const lim = (LD.CROWN || {}).range || 40;
      const gap = Math.hypot(f.x - cw.x, f.y - cw.y) - f.r;
      take({ type: "chg", prop: cw, kind: "crown", label: "加冕", gap: gap, lim: lim });
    }
    if (this.terrain && this.terrain.props) {
      for (let i = 0; i < this.terrain.props.length; i++) {
        const o = this.terrain.props[i];
        if (o.dead || o.carried) continue;
        if (o.kind === "mud") {
          const gap = propGap(f, o);
          take({ type: "mud", prop: o, label: "拾取", gap: gap, lim: rangeOf("mudRange") });
        } else if (o.kind === "locker") {
          if (o.occupant) continue;
          /* v3.9 躲藏冷却期间：柜子不进交互目标，P 框也不显示「躲藏」（与上车禁令一致） */
          if ((f.noHideT || 0) > 0) continue;
          const gap = propGap(f, o);
          take({ type: "locker", prop: o, label: "躲藏", gap: gap, lim: rangeOf("range") });
        } else if (o.kind === "car") {
          if (o.driver) continue;
          /* v3.9 上车禁令期间：车根本不出现在交互目标里，P 框也不显示「上车」 */
          if ((f.noCarT || 0) > 0) continue;
          const gap = propGap(f, o);
          const label = (o.fuel || 0) > 0 ? "驾驶" : "进入";
          take({ type: "car", prop: o, label: label, gap: gap, lim: rangeOf("range") + 12 });
        }
      }
    }
    return best;
  };

  /* ==========================================================
   *  主入口：按一次 O
   * ========================================================== */
  B.doInteract = function (f) {
    if (!f || f.dead) return false;
    if ((f.interactCd || 0) > 0) return false;
    /* v3.7 塔防：交互键优先释放主动装备（车里除外，车里 P = 下车）。
     * 没有装备、或在冷却中，则照常走拾取 / 躲藏 / 驾驶。 */
    if (this.rule === "tower" && f.activeItem && !f.rideCar && this.useTowerActive) {
      if (this.useTowerActive(f)) { f.interactCd = CFG.pickCd || 0.35; return true; }
    }
    f.interactCd = CFG.pickCd || 0.35;

    if (f.hideProp) { this.leaveLocker(f, false); return true; }
    if (f.rideCar) { this.exitCar(f, false); return true; }
    if (f.carryMud) { this.throwMud(f); return true; }

    const tgt = this.interactTarget(f);
    if (!tgt) return false;
    if (tgt.type === "gift") { this.pickGift(f, tgt.prop); return true; }
    if (tgt.type === "chg") { this.startCharge(f, tgt.kind, tgt.prop); return true; }
    if (tgt.type === "locker") { this.enterLocker(f, tgt.prop); return true; }
    if (tgt.type === "car") { this.enterCar(f, tgt.prop); return true; }
    if (tgt.type === "mud") { this.pickMud(f, tgt.prop); return true; }
    return false;
  };

  /* v3.8：P 键框 / 触屏交互键共用的一句话说明（空字符串 = 没有可交互的东西） */
  B.interactLabel = function (f) {
    if (!f || f.dead) return "";
    if (f.rideCar) return "下车";
    if (f.hideProp) return "离开";
    if (f.carryMud) return "扔泥土";
    if (this.rule === "tower" && f.activeItem) {
      const it = LD.towerItem(f.activeItem);
      if (it) return it.name;
    }
    const t = this.interactTarget(f);
    if (!t) return "";
    if (t.type === "chg") return t.kind === "crown" ? "争夺皇冠" : "开启能量包";
    if (t.type === "car") return "上车";
    if (t.type === "locker") return "躲藏";
    if (t.type === "gift") return "拾取";
    if (t.type === "mud") return "搬起";
    return t.label || "交互";
  };

  /* ==========================================================
   *  天外来物 / 缩圈：按 P 拾取，满槽替换最早获得的技能
   * ========================================================== */
  B.pickGift = function (f, g) {
    if (!g || !g.landed || this.gifts.indexOf(g) < 0) return false;
    if ((f.giftLock || 0) > 0) return false;
    const sk = LD.skill(g.id);
    if (!sk) return false;

    if (g.kind === "ult") {
      const old = f.loadout.ult;
      this.equipGift(f, "ult", g);
      if (old && old !== g.id) this.dropGift(f, old, "ult");
    } else {
      let slot = null;
      if (!f.loadout.skill1) slot = "skill1";
      else if (!f.loadout.skill2) slot = "skill2";
      else {
        /* 两格都满：替换「最早获得」的那一格（时间戳相同则按 K → L） */
        const t1 = (f.skillGot && f.skillGot.skill1) || 0;
        const t2 = (f.skillGot && f.skillGot.skill2) || 0;
        slot = t1 <= t2 ? "skill1" : "skill2";
        const old = f.loadout[slot];
        if (old) this.dropGift(f, old, "skill");
      }
      this.equipGift(f, slot, g);
    }
    f.giftLock = 0.8;
    FX.ring(f.x, f.y - 26, 58, "#7fe6f7", 4, 0.4);
    return true;
  };

  /* 被换下的技能 / 大招留在原地（短时间内不可再被同一人拾取，避免 O 连按反复替换） */
  B.dropGift = function (f, id, kind) {
    const g = this.spawnGift(kind, id, f.x, f.y + 18, true);
    if (!g) return;
    g.noPick = 1.2;
    g.born = this.t;
    const sk = LD.skill(id);
    FX.float(f.x, f.y - 46, "换下 " + (sk ? sk.name : "?"), "#9fb3dd", 12);
  };

  /* ==========================================================
   *  柜子：躲藏（隐匿）
   * ========================================================== */
  B.enterLocker = function (f, o) {
    if (!o || o.dead || o.occupant) return false;
    /* v3.9 与上车禁令同规格：刚被揪出来 / 柜子刚被打碎的一段时间内不许再躲 */
    if ((f.noHideT || 0) > 0) {
      if (f._noHideSaidT == null || this.t - f._noHideSaidT > 1.2) {
        f._noHideSaidT = this.t;
        FX.float(f.x, f.y - 62, "还差 " + Math.ceil(f.noHideT) + "s 才能躲藏", "#fca5a5", 13);
      }
      return false;
    }
    o.occupant = f;
    f.hideProp = o;
    f.x = o.x; f.y = o.y + (CFG.hideY || 8);
    f.vx = 0; f.vy = 0; f.moving = false;
    f.lock = -1;
    /* v3.4：躲藏计时 —— 超过 spotT 秒会被 AI 察觉 */
    f.hideTimer = 0;
    f.hideSpotted = false;
    /* 取消读条类技能，避免躲进去还在放 */
    if (f.slot) Object.keys(f.slot).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
    FX.ring(f.x, f.y - 20, 34, "rgba(165,180,252,.85)", 3, 0.35);
    FX.float(f.x, f.y - 62, "躲藏 · 隐匿", "#a5b4fc", 15);
    LD.Audio && LD.Audio.cast && LD.Audio.cast();
    return true;
  };

  B.leaveLocker = function (f, forced) {
    const o = f && f.hideProp;
    if (!o) return false;
    o.occupant = null;
    f.hideProp = null;
    f.hideTimer = 0;
    f.hideSpotted = false;
    const p = freeSpot(f, o.x, o.y + o.h / 2 + f.r + 8);
    f.x = p.x; f.y = p.y;
    if (forced) {
      /* 柜子被打碎 = 同样是被攻击波及：眩晕 2 秒（与挨打被揪出来一致） */
      f.stun = Math.max(f.stun || 0, CFG.ejectStun || 2);
      f.invuln = Math.max(f.invuln || 0, 0.25);
      /* v3.9 与上车禁令同规格：柜碎后同样挂上躲藏冷却，防止原地爬回下一个柜子 */
      f.noHideT = CFG.noHideT != null ? CFG.noHideT : 5;
      f._noHideSaidT = 0;
      FX.float(f.x, f.y - 60, "柜子碎了！", "#f87171", 15);
      FX.shake(5);
    } else {
      FX.float(f.x, f.y - 60, "离开柜子", "#9fb3dd", 12);
    }
    return true;
  };

  /* v3.4：躲在柜子里挨打 → 免疫这次伤害，但被揪出柜子并眩晕 2 秒（与车上被打下车同规格） */
  B.ejectLocker = function (f, src) {
    const o = f && f.hideProp;
    if (!o) return false;
    o.occupant = null;
    f.hideProp = null;
    f.hideTimer = 0;
    f.hideSpotted = false;
    const p = freeSpot(f, o.x, o.y + o.h / 2 + f.r + 8);
    f.x = p.x; f.y = p.y;
    f.stun = Math.max(f.stun || 0, CFG.ejectStun || 2);
    f.invuln = Math.max(f.invuln || 0, 0.25);
    /* v3.9 与上车禁令同规格：被揪出来后 5 秒内不能再躲进柜子，否则原地爬回去毫无代价 */
    f.noHideT = CFG.noHideT != null ? CFG.noHideT : 5;
    f._noHideSaidT = 0;
    FX.ring(o.x, o.y - 10, Math.max(o.w, o.h) * 0.7, "rgba(248,113,113,.9)", 4, 0.4);
    FX.burst(o.x, o.y - 12, 14, ["#fca5a5", "#fde68a", "#fff"], { speed: 240 });
    FX.shake(7);
    FX.float(f.x, f.y - 62, "被揪出柜子！眩晕 2s · " + Math.round(f.noHideT) + "s 内不能躲藏", "#f87171", 16);
    this.ev.push(["h", f.x, f.y - 62, "被揪出柜子！", "#f87171"]);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(150, 0.14, "square", 0.06);
    return true;
  };

  /* ==========================================================
   *  v3.4 AI 感知：柜子 / 草丛里的躲藏者
   *   - 藏超过 spotT 秒 → 被察觉（AI 能锁定与攻击）
   *   - 躲藏者一旦被 AI 锁定，躲藏无效（AI 记住了位置）
   *   - 「隐匿」技能是高级隐身：AI 永远看不见（只有第 2 秒闪形那 0.4s 会露一下）
   * ========================================================== */
  B.hiddenVisible = function (t) {
    if (!t) return true;
    if (t.stealthT > 0) return !!t._stealthFlash;          // 隐匿技能：高级隐身
    if (!t.hideProp && !t.bushHide) return true;
    const hid = t.hideProp ? (t.hideTimer || 0) : (t.bushTimer || 0);
    return hid >= (CFG.spotT || 2);
  };
  B.aiCanSee = function (ai, t) {
    if (!t || t.dead) return false;
    if (t.stealthT > 0) return !!t._stealthFlash;          // 隐匿技能：锁定也照样看不见
    if (!t.hideProp && !t.bushHide) return true;
    /* 已经锁定 / 正在追的目标：躲进去也没用，AI 知道人在哪 */
    if (ai) {
      if (ai.bot && ai.bot.foe === t) return true;
      if (ai.lock != null && ai.lock >= 0 && ai.lock === t.side) return true;
    }
    return this.hiddenVisible(t);
  };

  /* ==========================================================
   *  v3.5 吹风机：持续喷风，把气流里的角色往外吹
   *  只推角色（含僵尸），不推车、不推躲在柜子里的人；撞墙时沿墙滑
   * ========================================================== */
  B.updateWind = function (dt) {
    if (!this.terrain || !LD.Terrain.windAt) return;
    const TT = LD.Terrain;
    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (f.dead || f.bench) continue;
      if (f.kind !== "hero") continue;              // 勇者 / 僵尸都走 hero 骨架
      if (f.rideCar || f.hideProp) { f.windT = 0; continue; }
      const w = TT.windAt(this.terrain, f.x, f.y);
      if (!w) { f.windT = 0; continue; }
      f.windT = 0.12;
      const nx = f.x + w.x * dt, ny = f.y + w.y * dt;
      if (!this.hitWallAt(f, nx, ny)) { f.x = nx; f.y = ny; }
      else {
        /* 被墙挡住时保留没被挡的那个分量，沿墙继续被吹 */
        if (!this.hitWallAt(f, nx, f.y)) f.x = nx;
        if (!this.hitWallAt(f, f.x, ny)) f.y = ny;
      }
      if (Math.random() < dt * 14) FX.trail(f.x + rand(-8, 8), f.y - rand(4, 30), "#bae6fd", 3, 0.25);
    }
  };

  /* ==========================================================
   *  车辆：上下车 / 驾驶 / 撞击 / 油量
   * ========================================================== */
  /* ==========================================================
   *  v3.9 通用「长按蓄力」：能量包开包 / 霸主加冕共用
   *  - 按交互键起手，蓄力 CHARGE[kind].need 秒，期间不能移动、不能出手
   *  - 受到伤害 / 被眩晕 / 目标消失 / 离得太远 / 死亡 → 中断，进度清零重来
   * ========================================================== */
  const chgCfg = (kind) => (LD.CHARGE || {})[kind] || { need: 5, keep: 60, label: "蓄力", color: "#818cf8" };
  /* 蓄力目标的存活判定（各自保证目标还在场上） */
  function chgAlive(B, c) {
    if (c.kind === "pack") return !!B.pickups && B.pickups.indexOf(c.tgt) >= 0;
    if (c.kind === "crown") return !!B.crown && B.crown === c.tgt && B.crown.phase === "fallen";
    return false;
  }
  function chgPos(c) {
    return c.kind === "crown" ? { x: c.tgt.x, y: c.tgt.y } : { x: c.tgt.x, y: c.tgt.y };
  }

  B.startCharge = function (f, kind, tgt) {
    if (!f || f.dead || !tgt || f.chg) return false;
    if (f.rideCar || f.hideProp || f.carryMud) return false;
    if ((f.stun || 0) > 0 || (f.root || 0) > 0) return false;
    const c = { kind: kind, tgt: tgt, t: 0 };
    if (!chgAlive(this, c)) return false;
    f.chg = c;
    f.vx = 0; f.vy = 0; f.moving = false;
    FX.ring(f.x, f.y - 20, 54, chgCfg(kind).color, 4, 0.35);
    return true;
  };

  B.cancelCharge = function (f, why) {
    if (!f || !f.chg) return false;
    f.chg = null;
    if (why) {
      FX.float(f.x, f.y - 66, why, "#f87171", 14);
      this.ev.push(["t", f.x, f.y - 66, why, "#f87171"]);
    }
    return true;
  };

  B.updateCharging = function (dt) {
    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      const c = f.chg;
      if (!c) continue;
      const cfg = chgCfg(c.kind);
      if (!chgAlive(this, c)) { this.cancelCharge(f, "目标已消失"); continue; }
      if (f.dead) { this.cancelCharge(f, null); continue; }
      if ((f.stun || 0) > 0 || (f.root || 0) > 0) { this.cancelCharge(f, "被打断！"); continue; }
      if (f.rideCar || f.hideProp) { this.cancelCharge(f, "中断了"); continue; }
      const p = chgPos(c);
      if (Math.hypot(f.x - p.x, f.y - p.y) > f.r + cfg.keep) { this.cancelCharge(f, "离得太远，中断！"); continue; }
      c.t += dt;
      if (Math.random() < dt * 12) FX.trail(f.x + rand(-10, 10), f.y - rand(4, 26), cfg.color, 3, 0.3);
      if (c.t >= cfg.need) {
        f.chg = null;
        if (c.kind === "pack") this.finishPack(f, c.tgt);
        else if (c.kind === "crown") this.finishCrown(f, c.tgt);
      }
    }
  };

  B.finishPack = function (f, pk) {
    const idx = (this.pickups || []).indexOf(pk);
    if (idx >= 0) this.pickups.splice(idx, 1);
    const gain = (LD.CONF && LD.CONF.energy && LD.CONF.energy.packGain) || 60;
    f.energy = Math.min(f.maxEnergy, f.energy + gain);
    FX.ring(f.x, f.y - 26, 78, "rgba(165,180,252,.95)", 6, 0.45);
    FX.burst(f.x, f.y - 26, 20, ["#a5b4fc", "#fff", "#818cf8"], { speed: 240 });
    FX.float(f.x, f.y - 70, "大招能量 +" + gain, "#a5b4fc", 16);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(560, 0.12, "triangle", 0.05);
  };

  B.enterCar = function (f, o) {
    if (!o || o.dead || o.driver) return false;
    /* v3.9 被远程震下车后有 5 秒 CD，这段时间按 P / AI 主动上车都会被拒 */
    if ((f.noCarT || 0) > 0) {
      if (f._noCarSaidT == null || this.t - f._noCarSaidT > 1.2) {
        f._noCarSaidT = this.t;
        FX.float(f.x, f.y - 62, "还差 " + Math.ceil(f.noCarT) + "s 才能上车", "#fca5a5", 13);
      }
      return false;
    }
    o.driver = f;
    o.free = false; o.vx = 0; o.vy = 0;
    f.rideCar = o;
    f.vx = 0; f.vy = 0;
    f.x = o.x; f.y = o.y;
    f.moving = false;
    f._rideNoSkillT = 0;
    if (f.slot) Object.keys(f.slot).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
    const vc = (LD.VEHICLES || {})[o.vtype] || {};
    const fuelPct = o.fuelMax > 0 ? Math.round(o.fuel / o.fuelMax * 100) : 0;
    FX.ring(o.x, o.y - 10, 52, "rgba(125,211,252,.8)", 3, 0.35);
    FX.float(f.x, f.y - 72, "驾驶 " + (vc.name || "汽车") + " · 油 " + fuelPct + "%", "#bae6fd", 14);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(300, 0.09, "square", 0.05);
    return true;
  };

  B.exitCar = function (f, eject, src) {
    const o = f && f.rideCar;
    if (!o) return false;
    o.driver = null;
    o.vx = 0; o.vy = 0;
    f.rideCar = null;
    const p = freeSpot(f, o.x, o.y + o.h / 2 + f.r + 10);
    f.x = p.x; f.y = p.y;
    if (eject) {
      f.stun = Math.max(f.stun || 0, (LD.VEHICLE_CFG || {}).ejectStun || 2);
      f.invuln = Math.max(f.invuln || 0, 0.25);
      FX.ring(o.x, o.y - 10, 78, "rgba(248,113,113,.95)", 5, 0.45);
      FX.burst(o.x, o.y - 10, 20, ["#fca5a5", "#fff", "#fbbf24"], { speed: 280 });
      FX.shake(9);
      FX.float(f.x, f.y - 62, "被撞出车外！眩晕 2s", "#f87171", 16);
      /* v3.9 震出追加：5 秒内不得再上车，避免刚落地就爬回去（AI 也不会再抢车） */
      f.noCarT = CFG.noCarT != null ? CFG.noCarT : 5;
      this.ev.push(["h", f.x, f.y - 62, "被撞出车外！", "#f87171"]);
    } else {
      FX.float(f.x, f.y - 54, "下车", "#9fb3dd", 12);
    }
    return true;
  };

  /** 每帧推进所有被驾驶的车辆 */
  B.updateVehicles = function (dt) {
    /* 交互 / 拾取的内置 CD（updateVehicles 每帧都会跑，借它做集中计时） */
    this.fighters.forEach(f => {
      if (f.interactCd > 0) f.interactCd = Math.max(0, f.interactCd - dt);
      if (f.giftLock > 0) f.giftLock = Math.max(0, f.giftLock - dt);
      /* v3.9 被震下车的上车禁令 / 被揪出柜子的躲藏禁令 */
      if (f.noCarT > 0) {
        f.noCarT = Math.max(0, f.noCarT - dt);
        if (f.noCarT === 0) f._noCarSaidT = 0;
      }
      if (f.noHideT > 0) {
        f.noHideT = Math.max(0, f.noHideT - dt);
        if (f.noHideT === 0) f._noHideSaidT = 0;
      }
    });
    if (!this.terrain || !this.terrain.props) return;
    const VCFG = LD.VEHICLE_CFG || {};
    const baseSp = LD.CONF.hero.speed;

    for (let i = 0; i < this.terrain.props.length; i++) {
      const o = this.terrain.props[i];
      if (o.kind !== "car" || o.dead) continue;
      if (o.ramCd > 0) o.ramCd = Math.max(0, o.ramCd - dt);
      if (o.hornCd > 0) o.hornCd = Math.max(0, o.hornCd - dt);
      if (o.cannonCd > 0) o.cannonCd = Math.max(0, o.cannonCd - dt);
      const f = o.driver;
      if (!f) continue;
      if (f.dead) { this.exitCar(f, false); continue; }

      const ctrl = f.ctrl || {};
      let ix = ctrl.mx || 0, iy = ctrl.my || 0;
      const n = Math.hypot(ix, iy);
      const maxSp = baseSp * (o.speedMul || 1.4) * (this.mod && this.mod("speed") ? 1.35 : 1);
      const hasFuel = (o.fuel || 0) > 0;

      if (hasFuel && n > 0.05) {
        ix /= n; iy /= n;
        const tx = ix * maxSp, ty = iy * maxSp;
        const k = Math.min(1, (VCFG.accel || 900) * dt / Math.max(1, maxSp));
        o.vx += (tx - o.vx) * k;
        o.vy += (ty - o.vy) * k;
        f.facing = { x: ix, y: iy };
      } else {
        /* 松开油门 / 没油：滑行减速 */
        const damp = Math.exp(-(hasFuel ? 2.0 : 4.5) * dt);
        o.vx *= damp; o.vy *= damp;
        if (!hasFuel && Math.hypot(o.vx, o.vy) > 30 && !o._drySaid) {
          o._drySaid = true;
          FX.float(o.x, o.y - 70, "没油了！", "#fbbf24", 15);
        }
      }
      if (hasFuel) o._drySaid = false;

      /* 分轴位移 + 障碍碰撞（车体较大，撞墙就停这一轴，保留另一轴滑行） */
      const px = o.x, py = o.y;
      o.x += o.vx * dt;
      if (T.blockedAt(this.terrain, o, o.x, o.y)) { o.x = px; o.vx = 0; }
      o.y += o.vy * dt;
      if (T.blockedAt(this.terrain, o, o.x, o.y)) { o.y = py; o.vy = 0; }
      /* 场地边界 */
      const hw = o.w / 2, hh = o.h / 2;
      o.x = Math.max(hw + 4, Math.min(this.world.w - hw - 4, o.x));
      o.y = Math.max(this.world.pt + hh + 2, Math.min(this.world.h - hh - 4, o.y));

      /* 耗油：按实际位移扣「可行驶距离」 */
      const moved = Math.hypot(o.x - px, o.y - py);
      if (hasFuel && moved > 0) o.fuel = Math.max(0, o.fuel - moved);

      f.x = o.x; f.y = o.y;
      const sp = Math.hypot(o.vx, o.vy);

      /* 撞人：击退 + 10 伤害，同一辆车 2s CD */
      if (sp > 70 && (o.ramCd || 0) <= 0) {
        const rr = Math.max(o.w, o.h) * 0.5 + 6;
        for (let j = 0; j < this.fighters.length; j++) {
          const t = this.fighters[j];
          if (t === f || t.dead || t.bench || t.rideCar) continue;
          if (this.sameTeam(f, t)) continue;
          if (Math.hypot(t.x - o.x, t.y - o.y) > rr + t.r) continue;
          o.ramCd = VCFG.ramCd || 2;
          this.damage(f, t, VCFG.ramDmg || 10, { type: "skill", kb: VCFG.ramKb || 300, from: o });
          FX.float(t.x, t.y - 58, "被车撞飞！", "#fbbf24", 15);
          FX.shake(6);
          break;
        }
      }

      /* 普攻键：喇叭 / 坦克火炮 */
      if (ctrl.press && ctrl.press.basic) {
        ctrl.press.basic = false;
        const vc = (LD.VEHICLES || {})[o.vtype] || {};
        if (vc.cannon) {
          if ((o.cannonCd || 0) <= 0) {
            const a = Math.atan2(f.facing.y, f.facing.x);
            /* 炮口要伸到车体之外：坦克 2x2（40px 格）半径就有 40，
             * 从车体内部生成会被自己的 blockProj 立刻吃掉，炮弹根本飞不出去 */
            const muzzle = Math.max(o.w, o.h) * 0.5 + 22;
            this.spawnProj({
              x: o.x + Math.cos(a) * muzzle, y: o.y - 8 + Math.sin(a) * muzzle * 0.3,
              vx: Math.cos(a) * vc.cannon.speed, vy: Math.sin(a) * vc.cannon.speed,
              r: vc.cannon.r || 9, dmg: vc.cannon.dmg, life: 1.6, maxLife: 1.8, owner: f, side: f.side,
              color: "#fbbf24", core: "#fffbeb", type: "bullet", kindTag: "skill", trail: true, data: {}
            });
            o.cannonCd = vc.cannon.cd || 5;
            FX.burst(o.x + Math.cos(a) * 40, o.y - 8, 14, ["#fbbf24", "#fff", "#f97316"], { speed: 240, dir: a, spread: 0.5 });
            FX.shake(5);
            LD.Audio && LD.Audio.beep && LD.Audio.beep(120, 0.16, "sawtooth", 0.09);
          } else {
            FX.float(o.x, o.y - 66, "火炮冷却 " + Math.ceil(o.cannonCd) + "s", "#9fb3dd", 12);
          }
        } else if ((o.hornCd || 0) <= 0) {
          o.hornCd = VCFG.hornCd || 0.45;
          FX.ring(o.x, o.y - 8, 46, "rgba(253,230,138,.75)", 3, 0.35);
          FX.float(o.x, o.y - 66, "叭！", "#fde68a", 15);
          if (LD.Audio && LD.Audio.beep) { LD.Audio.beep(340, 0.16, "sawtooth", 0.08); LD.Audio.beep(440, 0.12, "square", 0.05); }
        }
      }
      /* 车上按技能键：只提示，不生效 */
      if (ctrl.press && (ctrl.press.skill1 || ctrl.press.skill2 || ctrl.press.ult)) {
        ctrl.press.skill1 = ctrl.press.skill2 = ctrl.press.ult = false;
        if (this.t - (f._rideNoSkillT || 0) > 1.2) {
          f._rideNoSkillT = this.t;
          FX.float(f.x, f.y - 58, "车上无法使用技能", "#9fb3dd", 12);
        }
      }
    }
  };

  /* ==========================================================
   *  泥土：拾起 / 扔出
   * ========================================================== */
  B.pickMud = function (f, o) {
    if (!o || o.dead || o.carried) return false;
    o.carried = true; o.cargo = false; o.landed = true;
    f.carryMud = o;
    FX.float(f.x, f.y - 58, "搬起泥土", "#a3855f", 13);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(260, 0.07, "triangle", 0.04);
    return true;
  };

  B.throwMud = function (f) {
    const o = f && f.carryMud;
    if (!o) return false;
    f.carryMud = null;
    const fc = f.facing && (f.facing.x || f.facing.y) ? f.facing : { x: 1, y: 0 };
    const n = Math.hypot(fc.x, fc.y) || 1;
    const ux = fc.x / n, uy = fc.y / n;
    o.carried = false;
    o.cargo = true; o.landed = false;
    o.owner = f; o.ownerSide = f.side;
    o.hitDmg = CFG.mudDmg || 22;
    o.x = f.x + ux * 36; o.y = f.y - 18 + uy * 20;
    o.vx = ux * (CFG.mudSpeed || 430);
    o.vy = uy * (CFG.mudSpeed || 430);
    FX.float(f.x, f.y - 62, "扔出泥土！", "#fbbf24", 14);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(200, 0.1, "triangle", 0.05);
    return true;
  };

  /* ==========================================================
   *  规则修饰符：每 30 秒按地图预设刷新物资
   * ========================================================== */
  B.findOpenSpot = function (rad) {
    if (!this.terrain) return null;
    for (let i = 0; i < 70; i++) {
      const x = rand(70, this.world.w - 70);
      const y = rand(this.world.pt + 70, this.world.h - 70);
      if (T.clearAt(this.terrain, x, y, rad || 24)) return { x: x, y: y };
    }
    return { x: this.world.w / 2, y: (this.world.pt + this.world.h) / 2 };
  };

  B.updateRefresh = function (dt) {
    this.refreshT = (this.refreshT == null ? (CFG.refreshEvery || 30) : this.refreshT) - dt;
    if (this.refreshT > 0) return;
    this.refreshT = CFG.refreshEvery || 30;
    this.refreshField();
  };

  /** 把地图恢复到预设状态：可破坏物复原、车辆满油回到原位、能量包重生 */
  B.refreshField = function () {
    const map = this.terrain;
    if (!map) return;
    /* 先把司机请下车（否则车回原位会把人一起传送走） */
    (map.props || []).forEach(o => {
      if (o.kind === "car" && o.driver) this.exitCar(o.driver, false);
      if (o.kind === "locker" && o.occupant) this.leaveLocker(o.occupant, false);
    });
    (map.props || []).forEach(o => {
      if (o.runtime) return;
      o.dead = false;
      if (o.maxHp > 0) o.hp = o.maxHp;
      o.flash = 0;
      o.x = o.ox; o.y = o.oy;
      o.vx = 0; o.vy = 0; o.free = false;
      o.cargo = false; o.carried = false;
      o.landed = o.kind === "mud";
      if (o.kind === "locker") o.occupant = null;
      if (o.kind === "car") {
        o.fuel = o.fuelMax;
        o.ramCd = 0; o.hornCd = 0; o.cannonCd = 0;
        o.driver = null; o._drySaid = false;
      }
    });
    /* 能量包：每次刷新两个（按地图预设的刷新点，随机落在空地上） */
    for (let i = 0; i < 2; i++) {
      const p = this.findOpenSpot(26);
      if (p) this.dropPickup(p.x, p.y, "energy");
    }
    const cx = this.world.w / 2, cy = (this.world.pt + this.world.h) / 2;
    FX.ring(cx, cy, 120, "rgba(127,230,247,.5)", 4, 0.6);
    FX.float(cx, cy - 60, "物资刷新！", "#7fe6f7", 20);
    this.ev.push(["h", cx, cy - 60, "物资刷新！", "#7fe6f7"]);
  };

  /* ==========================================================
   *  伤害拦截：柜子挨打弹出 / 车上被打下车（两者都免疫本次伤害）
   * ========================================================== */
  const _damage = B.damage;
  B.damage = function (src, tgt, amt, o) {
    o = o || {};
    if (tgt && !tgt.dead && amt > 0) {
      if (tgt.hideProp) {
        /* 环境伤害（毒圈 / 红圈）照常生效：躲柜子不能白嫖范围伤害 */
        if (o.type === "dot" || o.type === "env") return _damage.apply(this, arguments);
        if (src && this.sameTeam(src, tgt)) return 0;
        /* v3.4：受到攻击 → 免疫这次伤害，但被揪出柜子并眩晕 2 秒 */
        this.ejectLocker(tgt, src);
        return 0;
      }
      if (tgt.rideCar) {
        if (src && this.sameTeam(src, tgt)) return 0;
        /* 车上受到伤害：免疫这次伤害 → 被打出车外 → 眩晕 2 秒 */
        this.exitCar(tgt, true, src);
        return 0;
      }
    }
    return _damage.apply(this, arguments);
  };

  /* 死在柜子里 / 车里：把占用状态清掉，别让柜子永久「有人」、车永久「有人开」 */
  const _kill = B.kill;
  B.kill = function (f, by) {
    if (f && f.hideProp) { f.hideProp.occupant = null; f.hideProp = null; }
    if (f && f.rideCar) { f.rideCar.driver = null; f.rideCar.vx = 0; f.rideCar.vy = 0; f.rideCar = null; }
    return _kill.apply(this, arguments);
  };

  /* ==========================================================
   *  渲染：车辆油量条 + 交互提示浮窗
   * ========================================================== */
  const _prop = LD.View.prop;
  LD.View.prop = function (ctx, o, t) {
    if (o && o.carried) return;                       // 被扛着的泥土不画在原地
    _prop.call(this, ctx, o, t);
    if (!o || o.dead || o.kind !== "car") return;
    /* 油量：以血条形式显示在车顶上方 */
    if (o.fuelMax > 0) {
      const ratio = Math.max(0, Math.min(1, (o.fuel || 0) / o.fuelMax));
      const bw = Math.max(34, o.w * 0.72), bx = o.x - bw / 2;
      const by = o.y - o.h / 2 - (o.elev || 30) - 14;
      ctx.save();
      ctx.fillStyle = "rgba(4,8,16,.78)";
      ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = ratio > 0.45 ? "#7ff0c4" : ratio > 0.18 ? "#fbbf24" : "#f87171";
      ctx.fillRect(bx + 1, by + 1, (bw - 2) * ratio, 3);
      /* 小油滴标记 */
      ctx.fillStyle = "rgba(226,242,255,.8)";
      ctx.fillRect(bx - 6, by + 1, 3, 3);
      if (o.driver) {
        ctx.strokeStyle = "rgba(125,211,252,.85)"; ctx.lineWidth = 1.5;
        ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, 8);
      }
      ctx.restore();
    }
  };

  B.drawInteractHints = function (ctx) {
    const me = this.hero(this.mySide == null ? 0 : this.mySide);
    const KEY = (LD.INTERACT && LD.INTERACT.key) || "P";
    this.fighters.forEach(f => {
      if (f.dead || f.bench || f.kind !== "hero") return;
      if (f.rideCar && f !== me) return;              // 别人在车里不提示；自己显示「下车」
      if (f.hideProp && f !== me) return;
      if (f !== me && !(me && this.sameTeam(me, f))) return;
      const tgt = this.interactTarget(f);
      if (!tgt) return;
      const txt = KEY + "  " + tgt.label;
      ctx.save();
      ctx.font = "700 12px system-ui";
      const w = Math.max(46, ctx.measureText(txt).width + 18);
      const bh = 21;
      const bx = f.x - w / 2;
      /* 骑在车上时提示挪到车体下方：车顶的油条在头顶那一带，别挡住它 */
      const underCar = !!f.rideCar;
      const by = underCar
        ? f.rideCar.y + f.rideCar.h / 2 + 12
        : f.y - (f.hideProp ? 74 : 88);
      ctx.fillStyle = "rgba(8,14,26,.88)";
      ctx.strokeStyle = "rgba(127,230,247,.75)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const r = 6;
      ctx.moveTo(bx + r, by);
      ctx.lineTo(bx + w - r, by); ctx.quadraticCurveTo(bx + w, by, bx + w, by + r);
      ctx.lineTo(bx + w, by + bh - r); ctx.quadraticCurveTo(bx + w, by + bh, bx + w - r, by + bh);
      ctx.lineTo(bx + r, by + bh); ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
      ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      /* 小三角：默认在下方指向角色，车下则反过来指向上方的车 */
      ctx.beginPath();
      if (underCar) {
        ctx.moveTo(bx + w / 2 - 5, by); ctx.lineTo(bx + w / 2 + 5, by); ctx.lineTo(bx + w / 2, by - 6);
      } else {
        ctx.moveTo(f.x - 5, by + bh); ctx.lineTo(f.x + 5, by + bh); ctx.lineTo(f.x, by + bh + 6);
      }
      ctx.closePath(); ctx.fillStyle = "rgba(8,14,26,.88)"; ctx.fill();
      ctx.fillStyle = "#dff8ff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(txt, f.x, by + bh / 2 + 0.5);
      ctx.restore();
    });
  };
})(window.LD = window.LD || {});
