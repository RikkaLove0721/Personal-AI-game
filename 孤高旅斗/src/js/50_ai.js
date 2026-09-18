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
    return d;
    function st() { return { on: false, phase: "", t: 0, d: {} }; }
  };

  /* -------- 伤害倍率（困难模式巨龙更疼） -------- */
  const _damage = B.damage;
  B.damage = function (src, tgt, amt, o) {
    if (src && src.kind === "dragon" && src.dmgM) amt = Math.round(amt * src.dmgM);
    return _damage.call(B, src, tgt, amt, o);
  };

  const AI = LD.AI = {};

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
    f.name = level === "easy" ? "木桩" : level === "hard" ? "凶猛勇者" : "勇者";
    return f;
  };

  AI.tickHero = function (f, dt) {
    if (!f.bot || f.dead || LD.Cine.active) { if (f.ctrl) { f.ctrl.mx = f.ctrl.my = 0; f.ctrl.press = {}; } return; }
    const b = f.bot, cf = b.conf, ctrl = f.ctrl;
    /* 索敌：霸主争霸里非霸主人机的仇恨会转向霸主；否则打最近的敌人（阵营模式自动跳过友军） */
    let foe = null;
    if (B.rule === "overlord" && !f.overlord) foe = B.fighters.find(o => o.overlord && !o.dead) || null;
    if (!foe) foe = B.foeOf(f);
    if (foe && !B.sameTeam(f, foe)) f.lock = foe.side;    // 让 AI 也用索敌（追踪类技能会朝他瞄准）
    ctrl.press = {};
    if (!foe) return;

    const dx = foe.x - f.x, dy = foe.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;

    // ---- 木桩：完全不动 ----
    if (cf.aggr <= 0) { ctrl.mx = ctrl.my = 0; return; }

    // ---- 选择期望距离 ----
    const basic = LD.skill(f.loadout.basic);
    const ranged = basic && basic.proj;
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

    // ---- 移动 ----
    let mx = 0, my = 0;
    const stone = B.rule === "overlord" ? B.stone : null;
    if (stone) {                       // 能量石在场：优先冲过去抢
      const sx = stone.x - f.x, sy = stone.y - f.y, sd = Math.hypot(sx, sy) || 1;
      mx += sx / sd * 1.6; my += sy / sd * 1.6;
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

    // 大招
    if (f.loadout.ult && f.energy >= f.maxEnergy && f.cd.ult <= 0 && d < 520 && Math.random() < 0.85) { press("ult"); return; }

    // 普攻
    const atkRange = ranged ? 470 : 84;
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

    // 大招：CD 好 且 距离适中 → 播大招演出后落下火柱
    if (f.cd.ult <= 0 && d < 560) {
      const chance = f.rageStage >= 1 ? 1.15 : 0.7;
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
    const skills = LD.skillsBy("skill").map(s => s.id);
    const ults = LD.skillsBy("ult").map(s => s.id);
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
