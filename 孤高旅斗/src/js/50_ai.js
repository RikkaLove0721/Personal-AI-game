/* ============================================================
 *  50_ai.js — 巨龙 AI / 人机勇者 AI
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, C = LD.CONF;
  const clamp = LD.View.clamp;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* -------- 把巨龙技能注册进目录（kind:"boss" 不会出现在商店里） --------
   * 注意：必须把 LD.DRAGON 对应配置整份并入（speed/r/windup 等），
   * 只拷 cd/dmg 的话 IMPL 里 sk.speed 等全是 undefined —— 巨龙会永远打不出可见攻击。 */
  LD.SKILLS.push(
    Object.assign({ id: "d_fireball", kind: "boss", icon: "🔥", price: 0, tags: ["BOSS"],
      desc: "巨龙的基础远程攻击：短促蓄力后喷出火球。" }, LD.DRAGON.basic),
    Object.assign({ id: "d_claw", kind: "boss", icon: "🐾", price: 0, tags: ["BOSS"],
      desc: "锁定位置后直线冲刺，红圈出现就要闪。" }, LD.DRAGON.skill1),
    Object.assign({ id: "d_ult", kind: "boss", icon: "☄️", price: 0, tags: ["BOSS", "大招"],
      desc: "蓄力后在全场落下多道火柱。" }, LD.DRAGON.ult)
  );

  /* -------- v2.5 人形 BOSS 技能注册（kind:"boss" 不进商店、不吃能量） -------- */
  const BOSS_SKILL_IDS = {
    ninja: { basic: "n_shuriken", skill1: "n_clone", skill2: "n_raid", ult: "n_ult" },
    gun:   { basic: "g_shot",     skill1: "g_bomb",  skill2: "g_burst", ult: "g_ghost" }
  };
  Object.keys(BOSS_SKILL_IDS).forEach(key => {
    const cfg = LD.BOSS && LD.BOSS[key];
    if (!cfg) return;
    const ICONS = { n_shuriken: "✴️", n_clone: "👤", n_raid: "⚡", n_ult: "🌀",
                    g_shot: "🔫", g_bomb: "🧨", g_burst: "💥", g_ghost: "👤" };
    Object.keys(BOSS_SKILL_IDS[key]).forEach(slot => {
      const id = BOSS_SKILL_IDS[key][slot];
      LD.SKILLS.push(Object.assign({ id, kind: "boss", icon: ICONS[id] || "⭐", price: 0,
        tags: ["BOSS"].concat(slot === "ult" ? ["大招"] : []),
        desc: cfg[slot] ? cfg[slot].name : id }, cfg[slot]));
    });
  });

  /* -------- BOSS 实例包装：通用 bot 壳 + 难度倍率（AI 对象在下方声明） -------- */

  /* -------- 巨龙实例包装：补上配装 / 难度倍率 -------- */
  const _mkDragon = B.mkDragon;
  B.mkDragon = function (opts) {
    let diff = (opts && opts.diff) || LD.DIFF.normal;
    if (typeof diff === "string") diff = LD.DIFF[diff] || LD.DIFF.normal;
    const d = _mkDragon.call(B, opts);
    d.loadout = { basic: "d_fireball", skill1: "d_claw", skill2: null, ult: "d_ult" };
    d.slot = { basic: st(), skill1: st(), skill2: st(), ult: st() };
    d.rateM = 1 / diff.rateM;      // CD 越短 = 出手越频繁
    d.dmgM = diff.dmgM;
    d.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
    d.cd.ult = (LD.DRAGON.ult && LD.DRAGON.ult.ultFirst) || 0;   // 开场大招延迟：开局不会马上开大
    return d;
    function st() { return { on: false, phase: "", t: 0, d: {} }; }
  };

  /* -------- 伤害倍率（困难模式巨龙 / 人形 BOSS 都更疼） --------
   * 人形 BOSS 的 kind 是 "hero"，只判 kind === "dragon" 会让它们的 dmgM 形同虚设，
   * 这里补上 isBoss 判定，保证困难模式的伤害加成对三关怪物一致生效。 */
  const _damage = B.damage;
  B.damage = function (src, tgt, amt, o) {
    if (src && src.dmgM && (src.kind === "dragon" || src.isBoss)) amt = Math.round(amt * src.dmgM);
    return _damage.call(B, src, tgt, amt, o);
  };

  const AI = LD.AI = {};

  /* -------- BOSS 实例包装：通用 bot 壳 + 难度倍率 -------- */
  AI.setupBoss = function (f, diff) {
    if (typeof diff === "string") diff = LD.DIFF[diff] || LD.DIFF.normal;
    AI.mkBot(f, diff.key === "hard" ? "hard" : "normal");
    f.isBoss = true;
    f.rateM = 1 / diff.rateM;        // CD 越短 = 出手越频繁（困难 1.6 → CD ×0.625）
    f.dmgM = diff.dmgM;
    const key = f.bossKind;
    const cfg = LD.BOSS && LD.BOSS[key];
    if (cfg && cfg.ult) f.cd.ult = cfg.ult.ultFirst || 10;   // 开场不会马上开大
    return f;
  };

  /* ==========================================================
   *  AI 对象：为任意勇者生成一个 ctrl
   * ========================================================== */
  AI.mkBot = function (f, level) {
    const conf = {
      easy:   { react: 1.0,  range: 1.0, dodge: 0,    aggr: 0,    move: false },
      normal: { react: 0.34, range: 1.0, dodge: 0.62, aggr: 0.75, move: true },
      hard:   { react: 0.13, range: 1.08, dodge: 0.9, aggr: 1.0,  move: true }
    }[level] || { react: 0.34, range: 1, dodge: 0.6, aggr: 0.75, move: true };

    f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
    f.isBot = true;
    f.botLevel = level;
    f.bot = {
      conf, t: 0, think: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rnd(0.8, 2),
      desired: 0, holdParry: 0, medT: 0, actedT: 0
    };
    /* 名字可辨识：外部（房间卡 / 花名册）给过名字就用外部的，否则按难度命名 */
    if (!f.name || f.name === "电脑" || f.name === "勇者") {
      f.name = level === "easy" ? "木桩" : level === "hard" ? "凶猛勇者" : "勇者人机";
    }
    return f;
  };

  AI.tickHero = function (f, dt) {
    if (!f.bot || f.dead || LD.Cine.active) { if (f.ctrl) { f.ctrl.mx = f.ctrl.my = 0; f.ctrl.press = {}; } return; }
    const b = f.bot, cf = b.conf, ctrl = f.ctrl;
    /* 索敌：霸主争霸里非霸主人机的仇恨会转向霸主；否则动态选目标 ——
     * 每隔 1~1.8 秒在「距离最近」和「血量最多」之间重新挑选，不再固定锁一个人 */
    let foe = null;
    if (B.rule === "overlord" && !f.overlord) foe = B.fighters.find(o => o.overlord && !o.dead) || null;
    if (!foe) {
      if (!b.foe || b.foe.dead || B.sameTeam(f, b.foe) || (b.retargetT -= dt) <= 0) {
        b.retargetT = rnd(1.0, 1.8);
        const cands = B.fighters.filter(o => o !== f && !o.dead && !B.sameTeam(f, o));
        if (cands.length) {
          const dd = o => (o.x - f.x) * (o.x - f.x) + (o.y - f.y) * (o.y - f.y);
          let near = cands[0], fat = cands[0];
          cands.forEach(o => { if (dd(o) < dd(near)) near = o; if (o.hp > fat.hp) fat = o; });
          b.foe = Math.random() < 0.5 ? near : fat;
        } else b.foe = null;
      }
      foe = b.foe;
    }
    if (foe && !B.sameTeam(f, foe)) f.lock = foe.side;    // 让 AI 也用索敌（追踪类技能会朝他瞄准）
    ctrl.press = {};
    if (!foe) return;

    const dx = foe.x - f.x, dy = foe.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;

    // ---- 木桩：完全不动 ----
    if (cf.aggr <= 0) { ctrl.mx = ctrl.my = 0; return; }

    // ---- 选择期望距离 ----
    // 远程判定要同时认 proj（勇者技能表写法）与扁平的 speed（v2.5 BOSS 技能表写法），
    // 否则黑侠客 / 快枪手会被当成近战，贴脸上来用飞镖与手枪。
    const basic = LD.skill(f.loadout.basic);
    const ranged = !!(basic && (basic.proj || basic.speed));
    b.desired = (ranged ? 235 : 62) * cf.range;

    // ---- 躲避来袭弹药 ----
    let dodgeX = 0, dodgeY = 0, threat = 0;
    B.projs.forEach(p => {
      if (p.side === f.side || p.type === "bomb") return;
      const rx = f.x - p.x, ry = (f.y - 26) - p.y;
      const dd = Math.hypot(rx, ry);
      if (dd > 190) return;
      const pv = Math.hypot(p.vx, p.vy) || 1;
      const toward = (rx * p.vx + ry * p.vy) / (dd * pv);
      if (toward < 0.72) return;
      threat = 1;
      const px = -p.vy / pv, py = p.vx / pv;
      const side = (rx * px + ry * py) >= 0 ? 1 : -1;
      dodgeX += px * side * 1.4; dodgeY += py * side * 1.4;
    });

    // ---- 天外来物：挑选要捡的掉落物（每帧更新，供移动优先级使用） ----
    f.giftTarget = null;
    if (B.rule === "gifts" && (B.gifts || []).length) {
      const wantSkill = !f.loadout.skill1 || !f.loadout.skill2;
      const wantUlt = !f.loadout.ult;
      const cands = B.gifts.filter(g => {
        const sk = LD.skill(g.id);
        if (!sk || sk.noAI) return false;                    // AI 不碰高压炸弹 / 王从天降这类坑技
        return (g.kind === "ult") ? (wantUlt || b.giftCd <= 0) : (wantSkill || b.giftCd <= 0);
      });
      let best = null, bd = Infinity;
      cands.forEach(g => { const dd = Math.hypot(g.x - f.x, g.y - f.y); if (dd < bd) { bd = dd; best = g; } });
      f.giftTarget = best;
    }

    // ---- 移动 ----
    let mx = 0, my = 0;
    const stone = B.rule === "overlord" ? B.stone : null;
    if (stone) {                       // 能量石在场：优先冲过去抢
      const sx = stone.x - f.x, sy = stone.y - f.y, sd = Math.hypot(sx, sy) || 1;
      mx += sx / sd * 1.6; my += sy / sd * 1.6;
    } else if (B.rule === "gifts" && f.giftTarget) {   // 天外来物：优先去捡掉落物
      const g = f.giftTarget;
      if (g.landed || !f.loadout.skill1 || !f.loadout.skill2 || !f.loadout.ult) {
        const gx = g.x - f.x, gy = g.y - f.y, gd = Math.hypot(gx, gy) || 1;
        if (gd > 26) { mx += gx / gd * 1.6; my += gy / gd * 1.6; }
      }
    } else if (d > b.desired + 34) { mx += ux; my += uy; }
    else if (d < b.desired - 46) { mx -= ux; my -= uy; }
    else {
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafeT = rnd(0.9, 2.2); b.strafe *= -1; }
      mx += -uy * b.strafe * 0.85; my += ux * b.strafe * 0.85;
    }
    // 远离边界
    const M = 80;
    if (f.x < M) mx += 1; if (f.x > C.W - M) mx -= 1;
    if (f.y < C.H * 0.36) my += 1; if (f.y > C.H - 60) my -= 1;
    if (threat && cf.dodge > 0) { mx += dodgeX * cf.dodge * 1.6; my += dodgeY * cf.dodge * 1.6; }
    const n = Math.hypot(mx, my);
    if (n > 0.05) { mx /= n; my /= n; } else { mx = my = 0; }
    ctrl.mx = mx; ctrl.my = my;

    // ---- 思考节流 ----
    b.think -= dt;
    if (b.think > 0) {
      // 格挡按住逻辑仍需持续
      ctrl.hold.skill1 = b.holdParry > 0;
      b.holdParry = Math.max(0, b.holdParry - dt);
      return;
    }
    b.think = cf.react * rnd(0.7, 1.3);

    // ---- 进攻决策 ----
    const press = (slot) => { ctrl.press[slot] = true; };

    // 天外来物：站在掉落物上且槽位已满 → 按键置换（顺手也会把旧技能打出去，置换有 0.3s 延迟）
    b.giftCd = Math.max(0, (b.giftCd || 0) - (b.think || 0));
    const pend = f.giftPending;
    if (B.rule === "gifts" && b.giftCd <= 0 && pend && (pend.skill || pend.ult) && !f.giftSwap) {
      if (pend.ult) press("ult");
      else press(Math.random() < 0.5 ? "skill1" : "skill2");
      b.giftCd = 8;
      return;
    }

    // 大招：BOSS 走 CD 制（boss 技能不耗能量）；勇者仍需能量满
    if (f.loadout.ult && f.cd.ult <= 0 && (f.isBoss
      ? (d < 560 && Math.random() < 0.5)
      : (f.energy >= f.maxEnergy && d < 520 && Math.random() < 0.85))) { press("ult"); return; }

    // 普攻（快枪手：全程持续开枪，不受距离限制）
    const atkRange = f.bossKind === "gun" ? 4000 : (ranged ? 470 : 84);
    if (d < atkRange && f.cd.basic <= 0 && Math.random() < 0.92) press("basic");

    // 技能（按身份分条件）
    const useSkill = (slot) => {
      const id = f.loadout[slot];
      if (!id) return false;
      const s = LD.skill(id);
      if (!s || f.cd[slot] > 0 || f.slot[slot].on) return false;
      switch (id) {
        case "parry":
          const incoming = threat > 0 && d < 220;
          if (incoming || (d < 74 && foe.atkAnim > 0)) { b.holdParry = 0.3; ctrl.hold[slot] = true; press(slot); return true; }
          return false;
        case "dashSlash":  if (d < 250) { press(slot); return true; } return false;
        case "laserWave":  if (d < 520 && Math.abs(dy) < 190) { press(slot); return true; } return false;
        case "windBlade":  if (d < 440) { press(slot); return true; } return false;
        case "meditate":
          if (f.hp < f.maxHp * 0.6 && d > 250) { ctrl.hold[slot] = true; press(slot); b.medT = 1.6; f.meditHold = slot; return true; }
          return false;
        case "rockShield": if (f.hp < f.maxHp * 0.78 && d < 280) { press(slot); return true; } return false;
        case "dragonPalm": if (d < 420) { press(slot); return true; } return false;
        case "meatRush":   if (d < 330 && d > 90) { press(slot); return true; } return false;
        case "blink":      if (d > 110 && d < 500) { press(slot); return true; } return false;
        case "substitute": if (d < 150) { press(slot); return true; } return false;
        case "bloodSlash": if (f.hp > f.maxHp * 0.42 && d < 280) { press(slot); return true; } return false;
        case "n_clone":    press(slot); return true;                           // 黑侠客：CD 好就召分身
                                                                              // （必须真的按下：旧代码直接 return true 却没按键，
                                                                              //   导致分身永不出现，还挡住了技能 2 的尝试）
        case "n_raid":     if (d > 110 && d < 520) { press(slot); return true; } return false;
        case "g_bomb":     if (d > 130) { press(slot); return true; } return false;
        case "g_burst":    if (d < 620) { press(slot); return true; } return false;
        default:           if (d < 300) { press(slot); return true; } return false;
      }
    };
    if (f.loadout.skill1 && !useSkill("skill1") && f.loadout.skill2) useSkill("skill2");
    else if (!f.loadout.skill1 && f.loadout.skill2) useSkill("skill2");

    // 冥思按住
    if (f.meditHold) {
      b.medT -= b.think;
      if (b.medT <= 0 || f.hp >= f.maxHp * 0.92) { ctrl.hold[f.meditHold] = false; f.meditHold = null; }
      else ctrl.hold[f.meditHold] = true;
    }
    if (b.holdParry > 0) { ctrl.hold.skill1 = b.holdParry > 0; }
  };

  /* ==========================================================
   *  巨龙 AI
   * ========================================================== */
  AI.tickDragon = function (f, dt) {
    if (f.dead || LD.Cine.active) return;
    const D = LD.DRAGON;
    const foe = B.foeOf(f);
    if (!foe) return;

    // 狂暴阶段（一阶段 62%、二阶段 32%）
    const r = f.hp / f.maxHp;
    f.rageStage = r < 0.32 ? 2 : r < 0.62 ? 1 : 0;
    f._burst = [1, 2, 3][f.rageStage];

    const busy = f.slot.ult.on || f.slot.skill1.on;
    if (busy) return;

    const d = Math.hypot(foe.x - f.x, foe.y - f.y);

    // 大招：CD 好 且 距离适中 → 播大招演出后落下火柱（v2.1 大幅降低释放欲望）
    if (f.cd.ult <= 0 && d < 560) {
      const chance = f.rageStage >= 1 ? 0.5 : 0.22;
      if (Math.random() < dt * chance) { B.trySlot(f, "ult", f.ctrl); return; }
    }
    // 爪击：距离近，狂暴阶段更频繁
    if (f.cd.skill1 <= 0 && d < 420) {
      if (Math.random() < dt * (1.15 + f.rageStage * 0.35)) { B.trySlot(f, "skill1", f.ctrl); return; }
    }
    // 火球：远程压制
    if (f.cd.basic <= 0 && d < 700) {
      if (Math.random() < dt * (2.0 + f.rageStage * 0.6)) B.trySlot(f, "basic", f.ctrl);
    }
  };

  /* ==========================================================
   *  配装随机 / 自定义
   * ========================================================== */
  AI.randomLoadout = function () {
    const basics = LD.skillsBy("basic").map(s => s.id);
    const skills = LD.skillsBy("skill").filter(s => !s.noAI).map(s => s.id);
    const ults = LD.skillsBy("ult").filter(s => !s.noAI).map(s => s.id);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    let s1 = pick(skills), s2 = pick(skills);
    let guard = 0;
    while (s2 === s1 && guard++ < 20) s2 = pick(skills);
    return { basic: pick(basics), skill1: s1, skill2: s2, ult: pick(ults) };
  };

  AI.ALL_BASIC = () => LD.skillsBy("basic").map(s => s.id);
  AI.ALL_SKILL = () => LD.skillsBy("skill").map(s => s.id);
  AI.ALL_ULT = () => LD.skillsBy("ult").map(s => s.id);
})(window.LD = window.LD || {});
