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

  /* -------- v3.1 僵尸专属技能（kind:"boss" 不进商店、不吃能量，靠 CD 出手） --------
   * 僵尸不再抽取勇者技能池，固定只有这两个技能。 */
  LD.SKILLS.push(
    { id: "z_lunge", kind: "boss", name: "突刺", icon: "🦴", price: 0,
      tags: ["僵尸", "突刺"], cd: 6.5, dmg: 7, dash: 130, dashT: 0.28,
      hits: 3, gap: 0.07, reach: 46, kb: 55,
      desc: "僵尸向前小突进，沿途连续撕抓三段，每段 7 点伤害。" },
    { id: "z_bite", kind: "boss", name: "撕咬", icon: "🦷", price: 0,
      tags: ["僵尸", "控制"], cd: 7.5, dmg: 8, range: 82, half: 1.0, root: 2.0, windup: 0.18,
      desc: "咬住前方敌人，造成 8 点伤害并定身 2 秒。" }
  );

  /* -------- v2.5 人形 BOSS 技能注册（kind:"boss" 不进商店、不吃能量） -------- */
  const BOSS_SKILL_IDS = {
    ninja: { basic: "n_shuriken", skill1: "n_clone", skill2: "n_raid", ult: "n_ult" },
    gun:   { basic: "g_shot",     skill1: "g_bomb",  skill2: "g_burst", ult: "g_ghost" },
    bee:     { basic: "b_needle", skill1: "b_hatch",  skill2: "b_sweep",   ult: "b_swarm" },
    frost:   { basic: "f_cone",   skill1: "f_quake",  skill2: "f_field",   ult: "f_zero" },
    twin:    { basic: "t_slash",  skill1: "t_cross",  skill2: null,        ult: "t_duo" },
    gambler: { basic: "gm_dice",  skill1: "gm_card",  skill2: "gm_cheat",  ult: "gm_roulette" },
    tesla:   { basic: "ts_zap",   skill1: "ts_polar", skill2: "ts_shield", ult: "ts_storm" }
  };
  Object.keys(BOSS_SKILL_IDS).forEach(key => {
    const cfg = LD.BOSS && LD.BOSS[key];
    if (!cfg) return;
    const ICONS = { n_shuriken: "✴️", n_clone: "👤", n_raid: "⚡", n_ult: "🌀",
                    g_shot: "🔫", g_bomb: "🧨", g_burst: "💥", g_ghost: "👤",
                    b_needle: "🐝", b_hatch: "🥚", b_sweep: "💫", b_swarm: "🐝",
                    f_cone: "❄️", f_quake: "💥", f_field: "🌨", f_zero: "🥶",
                    t_slash: "⚔️", t_cross: "⚡", t_duo: "⚔️",
                    gm_dice: "🎲", gm_card: "🃏", gm_cheat: "🔄", gm_roulette: "🎯",
                    ts_zap: "🌩️", ts_polar: "🧲", ts_shield: "🛡", ts_storm: "⛈" };
    Object.keys(BOSS_SKILL_IDS[key]).forEach(slot => {
      const id = BOSS_SKILL_IDS[key][slot];
      if (!id || !cfg[slot]) return;               // v2.6：双子/镜影没有的槽位直接跳过
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
    /* v2.6 镜影：整体 CD 为玩家配装的 1.3 倍（它的技能就是玩家的技能，太强会没法打） */
    const mcfg = LD.BOSS && LD.BOSS[f.bossKind];
    if (mcfg && mcfg.cdMul) f.rateM *= mcfg.cdMul;
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

  /* ----------------------------------------------------------
   *  v3.7 塔防：人机推塔
   *  目标是一个建筑（防御塔 / 水晶）。近战贴到边缘打，远程站 190px 外输出；
   *  残血先回自家泉水。返回 true 表示这一帧交给了推塔逻辑。
   * ---------------------------------------------------------- */
  /** v3.9 局部绕障：朝 (dx,dy) 走如果前方被别的障碍挡住，就往侧面偏一点。
   *  跳过 skip（当前要打的建筑），否则 AI 会被自己的目标斥力顶住、永远贴不上去。 */
  AI.steer = function (f, dx, dy, skip) {
    const len = Math.hypot(dx, dy) || 0;
    if (!B.terrain || len < 0.01) return { x: dx, y: dy };
    const T = LD.Terrain, props = B.terrain.props;
    const base = Math.atan2(dy, dx);
    const br = (f.r || 15) + 4;
    /* 0) 身体已经卡在障碍里（被车压住 / 被击退进去）：先顺着最短的边走出去，
     *    否则朝任何方向的探测点都还在方块内，会一直原地顶。 */
    let out = null, outPen = Infinity;
    for (let i = 0; i < props.length; i++) {
      const o = props[i];
      if (o === skip || o === f.rideCar || o.dead || !o.blockMove) continue;
      const hit = T.pushOut(o, f.x, f.y, f.r || 15);
      if (hit && hit.pen < outPen) { outPen = hit.pen; out = hit; }
    }
    if (out) return { x: out.nx * len, y: out.ny * len };
    const free = (a, d) => {
      const x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
      for (let i = 0; i < props.length; i++) {
        const o = props[i];
        if (o === skip || o === f.rideCar || o.dead || !o.blockMove) continue;
        if (Math.abs(x - o.x) < (o.w || 40) / 2 + br && Math.abs(y - o.y) < (o.h || 40) / 2 + br) return false;
      }
      return true;
    };
    const near = 40 + (f.r || 15) * 2;
    for (const off of [0, 0.55, -0.55, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, 2.8, -2.8]) {
      const a = base + off;
      if (free(a, near * 0.4) && free(a, near * 0.72) && free(a, near)) return { x: Math.cos(a) * len, y: Math.sin(a) * len };
    }
    return { x: dx, y: dy };
  };

  /* v3.9：只回血、不造成伤害的技能（冥思这类）——推塔 / 冲脸时不该按，
   * 否则人机满血也会原地打坐，还把自己定住。新增的回复技能只要有 heal 且无 dmg 就自动纳入。 */
  AI.healOnly = function (s) {
    return !!(s && (s.heal || 0) > 0 && !(s.dmg || 0) && !s.shield && !s.dash);
  };

  /* ------------------------------------------------------------
   *  v3.9 塔防：别一个人顶着塔硬冲
   *  塔的仇恨有「小兵优先」（距离 ×0.72），有兵线时它打兵，英雄能安全输出；
   *  没兵线时塔只盯着英雄，开局就冲进去等于白送 —— 这就是为什么人机开局爱往塔里钻。
   * ------------------------------------------------------------ */

  /** AI 此刻正压在哪座敌方建筑的火力圈里（不在任何塔的射程内则为 null） */
  AI.towerOn = function (f) {
    if (B.rule !== "tower" || !B.terrain) return null;
    const C = LD.TOWER || {};
    for (const o of B.terrain.props) {
      if (o.dead || o.side === f.team) continue;
      if (o.kind !== "tower" && o.kind !== "crystal") continue;
      const S = o.kind === "crystal" ? (C.crystal || {}) : (C.tower || {});
      const r = (S.range || 300) + (S.r || 46);
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < r) return { o: o, r: r, d: d };
    }
    return null;
  };

  /** 一座防御塔 / 水晶的火力圈半径（射程 + 体积，与 updateStructures 的判定一致） */
  AI.structRange = function (o) {
    const C = LD.TOWER || {};
    const S = o && o.kind === "crystal" ? (C.crystal || {}) : (C.tower || {});
    return (S.range || 300) + (S.r || 46);
  };

  /** 这座建筑的火力圈里有没有我方兵线顶着（有兵就不算孤军深入） */
  AI.laneIn = function (o, team, r) {
    return (B.fighters || []).some(m => m.kind === "laneMinion" && !m.dead &&
      m.team === team && Math.hypot(m.x - o.x, m.y - o.y) < (r || 300) + 30);
  };

  AI.pushTower = function (f, p, ctrl, dt) {
    if (!p || p.dead) return false;
    ctrl.mx = ctrl.my = 0;
    ctrl.press = {};
    /* 残血回家（塔防基地有回血圈） */
    if (f.hp < f.maxHp * 0.32 && !(f.hp < 0)) {
      const base = B.towerBase ? B.towerBase(f.team === 1 ? 1 : 0) : null;
      if (base) {
        const bx = base.x - f.x, by = base.y - f.y, bd = Math.hypot(bx, by) || 1;
        f.aimProp = null;
        if (bd > 40) {
          const st = AI.steer(f, bx / bd, by / bd, null);
          ctrl.mx = st.x; ctrl.my = st.y;
        }
        return true;
      }
    }
    /* 撤出塔圈的判定统一放在 tickHero 开头（对拼时也生效），这里只管「别主动站进去」。 */
    const pR = AI.structRange(p);
    const noLane = !AI.laneIn(p, f.team, pR);

    const basic = LD.skill(f.loadout.basic);
    const ranged = !!(basic && (basic.proj || basic.speed));
    const dx = p.x - f.x, dy = p.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    f.aimProp = p;
    const size = Math.max(p.w || 60, p.h || 60) * 0.5;
    let stop = size + (ranged ? 200 : 52);
    /* v3.9 没有兵线时不要站进塔的火力圈：停在圈外等兵线，别一个人扛塔。
     * 远程本来就停在 200 左右、多数情况够得着塔，这里只是把它拉到火力圈外一点点。 */
    if (noLane) stop = Math.max(stop, pR + 46);
    if (d > stop) {
      const st = AI.steer(f, dx / d, dy / d, p);        // 绕过挡在路上的车 / 另一座塔
      ctrl.mx = st.x; ctrl.my = st.y;
    } else if (d < stop - 26) { ctrl.mx = -dx / d * 0.6; ctrl.my = -dy / d * 0.6; }
    /* 有 CD 就放：普攻优先，技能跟上。
     * v3.9：推塔时不放纯回复类技能（冥思）——旧代码 CD 一好就按，导致人机满血也站着冥想，
     * 既推不了塔又把自己定在原地挨打。这类技能交给主流程的血量判定去决定。 */
    const atkRange = ranged ? 460 : 100;
    if (d < atkRange + size) {
      if (f.cd.basic <= 0) ctrl.press.basic = true;
      const s1 = LD.skill(f.loadout.skill1), s2 = LD.skill(f.loadout.skill2);
      const canPush = s => !!s && !AI.healOnly(s);
      if (f.loadout.skill1 && f.cd.skill1 <= 0 && d < 420 + size && canPush(s1)) ctrl.press.skill1 = true;
      else if (f.loadout.skill2 && f.cd.skill2 <= 0 && d < 420 + size && canPush(s2)) ctrl.press.skill2 = true;
    }
    return true;
  };

  AI.tickHero = function (f, dt) {
    if (!f.bot || f.dead || LD.Cine.active) { if (f.ctrl) { f.ctrl.mx = f.ctrl.my = 0; f.ctrl.press = {}; } return; }
    const b = f.bot, cf = b.conf, ctrl = f.ctrl;
    /* 索敌：霸主争霸里非霸主人机的仇恨会转向霸主；否则动态选目标 ——
     * 每隔 1~1.8 秒在「距离最近」和「血量最多」之间重新挑选，不再固定锁一个人 */
    let foe = null;
    if (B.rule === "overlord" && !f.overlord) foe = B.fighters.find(o => o.overlord && !o.dead) || null;
    /* v2.7 丧尸危机 / 「僵尸」修饰符：僵尸保命优先，仇恨转向离自己最近的玩家，
     * 而不是僵尸同类（僵尸之间本来就不互殴，这里明确让它们盯玩家，而不是乱打）。 */
    if (!foe && f.isZombie) {
      if (!b.foe || b.foe.dead || b.foe.isZombie || (b.retargetT -= dt) <= 0) {
        b.retargetT = rnd(1.0, 1.8);
        const cands = B.fighters.filter(o => o !== f && !o.dead && !o.isZombie && !o.isClone && o.kind === "hero" && B.aiCanSee(f, o));
        if (cands.length) {
          const dd = o => (o.x - f.x) * (o.x - f.x) + (o.y - f.y) * (o.y - f.y);
          let near = cands[0];
          cands.forEach(o => { if (dd(o) < dd(near)) near = o; });
          b.foe = near;
        } else b.foe = null;
      }
      foe = b.foe;
    }
    if (!foe) {
      if (!b.foe || b.foe.dead || B.sameTeam(f, b.foe) || (b.retargetT -= dt) <= 0) {
        b.retargetT = rnd(1.0, 1.8);
        const cands = B.fighters.filter(o => o !== f && !o.dead && !B.sameTeam(f, o) && B.aiCanSee(f, o));
        if (cands.length) {
          /* v3.4：被察觉的躲藏者（柜子 / 草丛）仇恨更高 —— 等效距离打折，优先去找 */
          const hate = o => (o.hideProp || o.bushHide) ? ((LD.INTERACT && LD.INTERACT.spotAggro) || 0.55) : 1;
          const dd = o => ((o.x - f.x) * (o.x - f.x) + (o.y - f.y) * (o.y - f.y)) * hate(o);
          let near = cands[0], fat = cands[0];
          cands.forEach(o => { if (dd(o) < dd(near)) near = o; if (o.hp > fat.hp) fat = o; });
          b.foe = Math.random() < 0.5 ? near : fat;
        } else b.foe = null;
      }
      foe = b.foe;
    }
    if (foe && !B.sameTeam(f, foe)) f.lock = foe.side;    // 让 AI 也用索敌（追踪类技能会朝他瞄准）
    ctrl.press = {};
    /* ==========================================================
     *  v4.12 娱乐模式批次：每个模式一套独立的人机逻辑，注册在 LD.casualAI 里。
     *  单独 return：这批模式禁用全部招式，通用战斗分支只会让人机原地发呆。
     * ========================================================== */
    if (LD.isCasual && LD.isCasual(B.rule) && LD.casualAI && LD.casualAI[B.rule]) {
      LD.casualAI[B.rule](f, dt, ctrl);
      return;
    }
    /* ==========================================================
     *  v4.11 烫手山芋：拿着的人去追人甩锅，没拿的人撒腿就跑。
     *  单独 return：本模式禁用所有招式，通用战斗分支只会原地发呆。
     * ========================================================== */
    if (B.rule === "hotpotato" && B.potato) {
      const st = B.potato;
      const carrier = st.phase === "held" ? st.holder : st.tgt;
      if (carrier && !carrier.dead && !carrier.bench && carrier !== f) {
        /* 远离芋头：朝背离方向跑，贴边就沿切线绕，别把自己逼到墙角。
         * 另外要和**同样在逃的人**散开：实测里两个落单的人会挤到同一角落，
         * 持有者只盯一个追，抱团那俩整局都拿不到芋头，轮换不起来。 */
        const pad = 92;
        let ax = f.x - carrier.x, ay = f.y - carrier.y;
        B.fighters.forEach(o => {
          if (o === f || o === carrier || o.kind !== "hero" || o.dead || o.bench) return;
          const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 1;
          if (d > 240) return;
          const k = (240 - d) / 240;
          ax += dx / d * k * 240; ay += dy / d * k * 240;
        });
        let tx = f.x + ax, ty = f.y + ay;
        const lo = pad, hi = B.world.w - pad, top = (B.world.pt || 0) + pad, bot = B.world.h - pad;
        if (tx < lo || tx > hi || ty < top || ty > bot) {
          const ca = Math.atan2(f.y - (top + bot) / 2, f.x - (lo + hi) / 2);
          const cx = (lo + hi) / 2, cy = (top + bot) / 2;
          const rr = Math.min(hi - lo, bot - top) * 0.42;
          tx = cx + Math.cos(ca + 0.9) * rr; ty = cy + Math.sin(ca + 0.9) * rr;
        }
        const s = AI.steer(f, tx - f.x, ty - f.y, null);
        ctrl.mx = s.x; ctrl.my = s.y;
        return;
      }
      /* 我是持有者：盯住一个冤大头把锅甩出去。
       * 目标必须**锁定一段时间**：其余人也在四散奔逃，「追最近的人」会每帧换目标，
       * 方向互相抵消，实测 30 秒引信里只能传出 1 次（等于谁被抽中谁独自挨炸）。
       * 锁定 1.2 秒后再重新挑，既跟得上场面变化又不会原地画圈。 */
      if (carrier === f && f === st.holder) {
        f.hotChaseT = (f.hotChaseT || 0) - dt;
        let best = f.hotChase;
        const pick = (skipPrev) => {
          let b = null, bd = Infinity;
          B.fighters.forEach(o => {
            if (o === f || o.kind !== "hero" || o.dead || o.bench) return;
            if (skipPrev && o === st.prevHolder) return;      // 别传给刚甩锅给我的那个人
            const d = Math.hypot(o.x - f.x, o.y - f.y);
            if (d < bd) { bd = d; b = o; }
          });
          return b;
        };
        if (!best || best === f || best.dead || best.bench || f.hotChaseT <= 0) {
          best = pick(true) || pick(false);                   // 只剩前任可选时再退回去
          f.hotChase = best; f.hotChaseT = 1.2;
        }
        if (best) {
          const s = AI.steer(f, best.x - f.x, best.y - f.y, null);
          ctrl.mx = s.x; ctrl.my = s.y;
        } else { ctrl.mx = 0; ctrl.my = 0; }
        return;
      }
      ctrl.mx = 0; ctrl.my = 0;
      return;
    }
    /* ==========================================================
     *  v4.8 碰碰车竞技：全程只干两件事——有车就撞最近的对手，没车就奔最近的空车。
     *  单独放在这里 return：通用「在车上」分支会因为「坐太久 / 没油 / 卡住」主动下车，
     *  本模式车就是命，下了车就只能挨撞。
     * ========================================================== */
    if (B.rule === "bump" && B.bump) {
      const A = B.bumpArena ? B.bumpArena() : null;
      const cars = ((B.terrain && B.terrain.props) || []).filter(o => o.bump && !o.dead);
      if (!f.rideCar) {
        let best = null, bd = Infinity;
        cars.forEach(o => {
          if (o.driver) return;
          const d = Math.hypot(o.x - f.x, o.y - f.y);
          if (d < bd) { bd = d; best = o; }
        });
        if (best) {
          const ax = best.x - f.x, ay = best.y - f.y, ad = Math.hypot(ax, ay) || 1;
          const s = AI.steer(f, ax / ad, ay / ad, null);
          ctrl.mx = s.x; ctrl.my = s.y;
          if (bd < 58) ctrl.press.interact = true;      // 走到车边就上
        } else { ctrl.mx = 0; ctrl.my = 0; }
        return;
      }
      /* 在车上：冲最近的对手；快贴到边缘还朝着外面 → 先掉头回中心，别自己送进水里 */
      let tgt = null, td = Infinity;
      B.fighters.forEach(o => {
        if (o === f || o.dead || o.bench || o.kind !== "hero") return;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d < td) { td = d; tgt = o; }
      });
      let tx = tgt ? tgt.x : (A ? A.x : f.x), ty = tgt ? tgt.y : (A ? A.y : f.y);
      if (A) {
        const dC = Math.hypot(f.x - A.x, f.y - A.y) || 1;
        const outX = (f.x - A.x) / dC, outY = (f.y - A.y) / dC;
        const aimX = tx - f.x, aimY = ty - f.y, aimD = Math.hypot(aimX, aimY) || 1;
        /* v4.10 圆环擂台：外圈贴边 / 内圈水边还朝着水里开 → 掉头回环带中部 */
        const ir = A.ir || 0;
        if (dC > A.r * 0.72 && (aimX / aimD) * outX + (aimY / aimD) * outY > 0.2) { tx = A.x; ty = A.y; }
        else if (ir > 0 && dC < ir + 96 && (aimX / aimD) * outX + (aimY / aimD) * outY < -0.2) {
          tx = A.x + outX * (A.r + ir) * 0.5; ty = A.y + outY * (A.r + ir) * 0.5;
        }
      }
      const ax = tx - f.x, ay = ty - f.y, ad = Math.hypot(ax, ay) || 1;
      ctrl.mx = ax / ad; ctrl.my = ay / ad;
      if (Math.random() < dt * 0.5) ctrl.press.basic = true;      // 偶尔按两下喇叭
      return;
    }
    /* ==========================================================
     *  v3.3 交互欲望（AI）：
     *    - 躲在柜子里：等 2.5~3 秒就出来（敌人贴脸则提前出来）
     *    - 在车上：朝敌人撞；坦克会开炮；没油 / 残血 / 坐太久就下车
     *    - 平时：残血且周围安全 → 找柜子；血少或敌人太远 → 找车；
     *            手里有泥土且敌人在射程内 → 扔；附近有泥土 → 捡
     * ========================================================== */
    if (f.hideProp) {
      b.hideT = (b.hideT || 0) + dt;
      ctrl.mx = ctrl.my = 0;
      const foeNear = foe && Math.hypot(foe.x - f.x, foe.y - f.y) < 210;
      if (b.hideT > (foeNear ? 1.1 : 2.8)) { ctrl.press.interact = true; b.hideT = 0; }
      return;
    }
    if (f.rideCar) {
      const car = f.rideCar;
      b.rideT = (b.rideT || 0) + dt;
      /* v3.9 车被别的车 / 墙卡住超过 1.2 秒就下车，否则 AI 会顶着障碍开一整局 */
      b.rideStuck = (b.rideStuck || 0) + dt;
      if (b.rideStuck > 1.2) {
        if (Math.hypot(car.x - (b._rideX == null ? car.x : b._rideX), car.y - (b._rideY == null ? car.y : b._rideY)) < 5) {
          ctrl.press.interact = true;
          b.rideT = 0;
        }
        b.rideStuck = 0; b._rideX = car.x; b._rideY = car.y;
      }
      if (foe && !foe.dead) {
        const cdx = foe.x - car.x, cdy = foe.y - car.y, cdd = Math.hypot(cdx, cdy) || 1;
        ctrl.mx = cdx / cdd; ctrl.my = cdy / cdd;
        if (car.vtype === "tank" && cdd < 520 && Math.random() < 0.55) ctrl.press.basic = true;
      } else {
        ctrl.mx = ctrl.my = 0;
      }
      /* 没油 / 快死了 / 坐太久 / 没有敌人 → 下车 */
      if ((car.fuel || 0) <= 0 || f.hp < f.maxHp * 0.28 || b.rideT > 14 || !foe) {
        ctrl.press.interact = true;
        b.rideT = 0;
      }
      return;
    }
    /* 金币优先级：150px 内有币就先捡，别为了远处的车 / 柜子绕路
     * （否则丧尸危机里 AI 会跑去开车，永远攒不到钱买东西） */
    /* v3.2 局内金币：AI 要主动去捡，否则永远攒不到钱、也就用不上局内商店。
     * 末日模式只在庇护所内捡（墙外红圈掉血比几枚币值钱）。
     * 放在「没有敌人就返回」之前：两波僵尸之间 AI 也会顺手把币捡了。 */
    f.coinTarget = null;
    if (!f.isZombie && (B.rule === "auction" || B.rule === "doomsday") && (B.coins || []).length) {
      const csh = B.rule === "doomsday" ? B.shelter : null;
      const fd = foe ? Math.hypot(foe.x - f.x, foe.y - f.y) : Infinity;
      let best = null, bd = 320;
      B.coins.forEach(c => {
        if (csh && Math.hypot(c.x - csh.x, c.y - csh.y) > csh.r - 30) return;
        const dd = Math.hypot(c.x - f.x, c.y - f.y);
        if (dd < bd) { bd = dd; best = c; }
      });
      if (best && fd < 210 && bd > 140) best = null;   // 脚下有敌人时不为远处的币脱离战斗
      f.coinTarget = best;
    }
    const coinNear = !!(f.coinTarget && Math.hypot(f.coinTarget.x - f.x, f.coinTarget.y - f.y) < 170);
    {
      const nearFoe = foe ? Math.hypot(foe.x - f.x, foe.y - f.y) : Infinity;
      f.useTarget = null;
      /* v3.9 塔防对战不找柜子 / 车 / 泥土：那条线是推塔，钻柜子、开车只会让 AI 脱离兵线乱跑，
       * 而且塔防图上一旦刷了车，AI 会在「上车」和「推塔」之间反复横跳。 */
      if (!f.isZombie && !coinNear && B.rule !== "tower") {
        /* 1) 残血且附近没有敌人 → 找柜子躲起来
         * v3.9 刚被从柜子里揪出来时（f.noHideT > 0）不再找柜子，否则 AI 会在柜子边上原地转 */
        if (f.hp < f.maxHp * 0.4 && nearFoe > 200 && (f.noHideT || 0) <= 0 && B.terrain) {
          let best = null, bd = 340;
          B.terrain.props.forEach(o => {
            if (o.kind !== "locker" || o.dead || o.occupant) return;
            const dd = Math.hypot(o.x - f.x, o.y - f.y);
            if (dd < bd) { bd = dd; best = o; }
          });
          if (best) f.useTarget = { type: "locker", prop: best };
        }
        /* 2) 血量不高或敌人很远 → 找一辆有油的车
         * v3.9 刚被打下车时（f.noCarT > 0）不找车，否则 AI 会在车边上原地打转 */
        if (!f.useTarget && (f.noCarT || 0) <= 0 && (f.hp < f.maxHp * 0.62 || nearFoe > 330) && B.terrain) {
          let best = null, bd = 470;
          B.terrain.props.forEach(o => {
            if (o.kind !== "car" || o.dead || o.driver || (o.fuel || 0) <= 0) return;
            const dd = Math.hypot(o.x - f.x, o.y - f.y);
            /* 坦克对 AI 更有吸引力（能开炮） */
            const score = dd - (o.vtype === "tank" ? 90 : 0);
            if (score < bd) { bd = score; best = o; }
          });
          if (best) f.useTarget = { type: "car", prop: best };
        }
        /* 3) 附近有泥土且敌人在中距离 → 去捡 */
        if (!f.useTarget && !f.carryMud && nearFoe < 560 && B.terrain) {
          let best = null, bd = 250;
          B.terrain.props.forEach(o => {
            if (o.kind !== "mud" || o.dead || o.carried || o.cargo) return;
            const dd = Math.hypot(o.x - f.x, o.y - f.y);
            if (dd < bd) { bd = dd; best = o; }
          });
          if (best) f.useTarget = { type: "mud", prop: best };
        }
        /* 已经在交互范围内 → 直接按 P */
        if (f.useTarget) {
          const it = B.interactTarget(f);
          if (it && it.prop === f.useTarget.prop) ctrl.press.interact = true;
        }
        /* 手里有泥土：敌人在射程内就朝他的方向扔 */
        if (f.carryMud && foe && nearFoe < 430) {
          const tdx = foe.x - f.x, tdy = foe.y - f.y, td = Math.hypot(tdx, tdy) || 1;
          f.facing = { x: tdx / td, y: tdy / td };
          ctrl.press.interact = true;
        }
      }
    }
    /* ----------------------------------------------------------
     *  v3.9 塔下别硬顶：踩在敌方建筑火力圈里、身边又没有自家兵线时，挨打就先退出来。
     *  放在推塔与对拼判定之前 —— 没有兵线顶着的时候，站在塔下跟人换血永远亏，
     *  旧逻辑只有残血才回家，于是人机开局就站在塔里对拼、血掉得莫名其妙。
     * ---------------------------------------------------------- */
    b.towerBackT = Math.max(0, (b.towerBackT || 0) - dt);
    const hotT = AI.towerOn(f);
    if (hotT && !AI.laneIn(hotT.o, f.team, hotT.r)) {
      if (B.t - (f.lastHurtAt || -99) < 1.5) b.towerBackT = 1.6;
      if (b.towerBackT > 0) {
        const rx = f.x - hotT.o.x, ry = f.y - hotT.o.y, rd = Math.hypot(rx, ry) || 1;
        if (rd < hotT.r + 40) {
          b.towerBackT = Math.max(b.towerBackT, 0.6);      // 没退干净就继续退，别在圈边上反复横跳
          const st = AI.steer(f, rx / rd, ry / rd, hotT.o);
          ctrl.mx = st.x; ctrl.my = st.y;
          f.aimProp = foe && !foe.dead ? foe : null;        // 边撤边盯着人，退完能立刻回头打
          return;
        }
      }
    }

    /* ==========================================================
     *  v3.7 塔防对战：优先推塔 / 拆水晶
     *  v3.9 提到「没有敌人」的早退之前 —— 旧代码放在 foe 判空之后，
     *  于是场面一空（对面英雄全在复活、兵线被清完的间隙）人机就站着不动，
     *  明明塔就在眼前也不推，看起来就是发呆。
     * ========================================================== */
    if (B.rule === "tower" && B.enemyStructure && !f.useTarget) {
      const ord = B.enemyStructure(f.team === 1 ? 1 : 0, f.x, f.y, 2000);
      if (ord) {
        const hd = foe && foe.kind === "hero" ? Math.hypot(foe.x - f.x, foe.y - f.y) : Infinity;
        const md = foe && foe.kind === "laneMinion" ? Math.hypot(foe.x - f.x, foe.y - f.y) : Infinity;
        /* v3.9 修：enemyStructure 返回的是 prop，上面没有 .d 字段（旧代码 ord.d 恒为 undefined，
         * 导致 atTower 永远是 false，「塔下优先推塔」形同虚设 —— 推掉两塔后只剩水晶时，
         * 人机贴到水晶边上反而切回去按 235 的远程距离追人，看起来就是在原地发呆）。 */
        const atTower = Math.hypot(ord.x - f.x, ord.y - f.y) < 430;
        /* v3.8 塔下优先推塔：只要没有敌方英雄贴身（150 内）就先拆塔；
         * 赶路时只要没有被英雄（300 内）或小兵（140 内）挡路，也直奔下一座塔。 */
        if ((atTower && hd > 150) || (!atTower && hd > 300 && md > 140)) {
          if (AI.pushTower(f, ord, ctrl, dt)) return;
        }
      }
    }

    if (!foe) {
      /* 场上暂时没有敌人（末日两波空档）：有交互目标 / 金币就去拿，别站着发呆 */
      if (f.useTarget) {
        const tx = f.useTarget.prop.x - f.x, ty = f.useTarget.prop.y - f.y, td = Math.hypot(tx, ty) || 1;
        ctrl.mx = tx / td; ctrl.my = ty / td;
      } else if (f.coinTarget) {
        const cx = f.coinTarget.x - f.x, cy = f.coinTarget.y - f.y, cd = Math.hypot(cx, cy) || 1;
        ctrl.mx = cx / cd; ctrl.my = cy / cd;
      } else { ctrl.mx = ctrl.my = 0; }
      return;
    }

    const dx = foe.x - f.x, dy = foe.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;

    /* v3.0 视线检测：被障碍挡住时记下挡路的那个（节流 0.18s，避免每帧扫线段） */
    b._losT = (b._losT || 0) - dt;
    if (b._losT <= 0) {
      b._losT = 0.18;
      b._los = B.terrain ? LD.Terrain.losHit(B.terrain, f.x, f.y, foe.x, foe.y, 24) : null;
    }
    /* v3.5：目标躲在柜子里时，柜子本身就挡视线——AI 已经察觉（2 秒 / 被锁定）就该照打不误，
     * 否则它会一直「绕障」而永远不动手。视线里的其他障碍仍然生效。 */
    /* v3.6：目标坐在车里时，挡在视线上的就是他那辆车——不能当成「被墙挡住」，
     * 否则人机会绕着车皮兜圈、迟迟不动手（看起来像「很久才想起要打车」）。 */
    const blocked = !!b._los && b._los !== foe.rideCar && !(foe.hideProp && B.aiCanSee(f, foe));
    /* 目标在车上：贴上去打，普攻 / 技能 CD 一好就放，尽快把人从车上打下来 */
    const foeCar = !!foe.rideCar;

    // ---- 木桩：完全不动 ----
    if (cf.aggr <= 0) { ctrl.mx = ctrl.my = 0; return; }

    // ---- 选择期望距离 ----
    // 远程判定要同时认 proj（勇者技能表写法）与扁平的 speed（v2.5 BOSS 技能表写法），
    // 否则黑侠客 / 快枪手会被当成近战，贴脸上来用飞镖与手枪。
    const basic = LD.skill(f.loadout.basic);
    const ranged = !!(basic && (basic.proj || basic.speed));
    b.desired = (ranged ? 235 : 62) * cf.range;
    /* v3.6：车上目标不再讲「远程保持距离」——远程站在 235 只会对着车皮放空枪，
     * 直接压到 110 内，普攻与中距离技能都能落到人身上。 */
    if (foeCar) b.desired = 110;
    /* v2.7 追猎时刻：生存者全程保持距离、被接近就反向逃跑；猎人是纯粹的进攻方 */
    if (f.huntRole === "runner") b.desired = 420;
    if (f.huntRole === "hunter") b.desired = 120;
    /* v3.1 僵尸是纯近身怪：贴近到撕咬距离，残血也不后撤 */
    if (f.isZombie) b.desired = 44;

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

    // ---- 天外来物 / 缩圈乱斗：挑选要捡的掉落物（每帧更新，供移动优先级使用） ----
    f.giftTarget = null;
    if (B.giftRule() && (B.gifts || []).length) {
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
    /* v2.7 血量偏低时优先去吃血包 */
    f.healTarget = null;
    if ((B.heals || []).length && f.hp < f.maxHp * 0.62) {
      let best = null, bd = Infinity;
      B.heals.forEach(h => {
        if (!h.landed) return;
        const dd = Math.hypot(h.x - f.x, h.y - f.y);
        if (dd < bd) { bd = dd; best = h; }
      });
      if (best && bd < 620) f.healTarget = best;
    }

    // ---- 移动 ----
    /* v3.9 能量石已随巨龙删除，这里统一用 crown（下面 refill 到 stone 供绕障判断复用） */
    let stone = null;
    let mx = 0, my = 0;
    /* v3.9 霸主争霸：皇冠落地后所有人冲过去抢（预警阶段先占位） */
    const crown = B.rule === "overlord" && B.crown && B.crown.phase !== "held" ? B.crown : null;
    if (crown) stone = crown;
    if (crown) {
      const sx = crown.x - f.x, sy = crown.y - f.y, sd = Math.hypot(sx, sy) || 1;
      if (sd > ((LD.CROWN || {}).range || 40) - 6) { mx += sx / sd * 1.6; my += sy / sd * 1.6; }
      /* 落地了就按交互键加冕（3 秒蓄力期间角色循环会锁住移动，AI 自然站住不动） */
      if (crown.phase === "fallen" && sd < f.r + ((LD.CROWN || {}).range || 40) - 4) ctrl.press.interact = true;
    } else if (B.giftRule() && f.giftTarget) {   // 天外来物 / 缩圈乱斗：优先去捡掉落物（圈外也敢去）
      const g = f.giftTarget;
      if (g.landed || !f.loadout.skill1 || !f.loadout.skill2 || !f.loadout.ult) {
        const gx = g.x - f.x, gy = g.y - f.y, gd = Math.hypot(gx, gy) || 1;
        if (gd > 26) { mx += gx / gd * 1.6; my += gy / gd * 1.6; }
      }
      /* v3.3：走到掉落物旁按 P 拾取（两格满了自动替换最早获得的那个） */
      if (g.landed && (g.noPick || 0) <= 0 && Math.hypot(g.x - f.x, g.y - f.y) < f.r + 44) ctrl.press.interact = true;
    } else if (f.useTarget) {                           // v3.3 交互目标（柜子 / 车 / 泥土）
      const tp = f.useTarget.prop;
      const tx = tp.x - f.x, ty = tp.y - f.y, td = Math.hypot(tx, ty) || 1;
      if (td > (tp.kind === "car" ? 56 : 30)) { mx += tx / td * 1.6; my += ty / td * 1.6; }
    } else if (f.healTarget) {                          // v2.7 残血先补：冲去血包
      const hx = f.healTarget.x - f.x, hy = f.healTarget.y - f.y, hd = Math.hypot(hx, hy) || 1;
      mx += hx / hd * 1.7; my += hy / hd * 1.7;
    } else if (f.coinTarget) {                          // v3.2 局内金币：顺路先捡
      const cx2 = f.coinTarget.x - f.x, cy2 = f.coinTarget.y - f.y, cd2 = Math.hypot(cx2, cy2) || 1;
      if (cd2 > 18) { mx += cx2 / cd2 * 1.5; my += cy2 / cd2 * 1.5; }
    } else if (d > b.desired + 34) { mx += ux; my += uy; }
    else if (d < b.desired - 46) { mx -= ux; my -= uy; }
    else {
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafeT = rnd(0.9, 2.2); b.strafe *= -1; }
      mx += -uy * b.strafe * 0.85; my += ux * b.strafe * 0.85;
    }
    // 远离边界
    const M = 80, W = B.world || { w: C.W, h: C.H, pt: 0 };
    if (f.x < M) mx += 1; if (f.x > W.w - M) mx -= 1;
    if (f.y < W.pt + 20) my += 1; if (f.y > W.h - 60) my -= 1;
    /* v2.7 缩圈 / 追猎：AI 会主动往安全区里跑，不在毒里站着挨打 */
    const zoneRing = (B.rule === "ring" && B.rings) ? B.rings.filter(c => !c.dead)
      : ((B.rule === "hunt" && B.huntRing) ? [B.huntRing] : null);
    if (zoneRing && zoneRing.length) {
      let best = null, bd = Infinity;
      zoneRing.forEach(c => { const dd = Math.hypot(c.x - f.x, c.y - f.y); if (dd < bd) { bd = dd; best = c; } });
      const safeR = Math.max(60, (best.r || 200) - 90);
      /* v2.7 缩圈：脚下有要捡的掉落物 / 血包时豁免避毒——冒着出圈的风险去捡 */
      const brave = B.rule === "ring" && (f.giftTarget || f.healTarget);
      if (!brave && bd > safeR && bd > 1) { mx += (best.x - f.x) / bd * 2.0; my += (best.y - f.y) / bd * 2.0; }
    }
    if (threat && cf.dodge > 0) { mx += dodgeX * cf.dodge * 1.6; my += dodgeY * cf.dodge * 1.6; }
    /* v3.0 地形绕行：柱子 / 箱子 / 围栏附近加一个斥力，避免 AI 顶着障碍原地打转 */
    if (B.terrain) {
      const av = LD.Terrain.avoid(B.terrain, f.x, f.y, 72, B.rule === "tower" ? f.aimProp : null);
      mx += av.x * 1.15; my += av.y * 1.15;
    }
    /* v3.5 吹风机：被风吹着的时候沿气流垂直方向脱离，别顶着风原地抖 */
    if (f.windT > 0 && B.terrain && LD.Terrain.windAt) {
      const wd = LD.Terrain.windAt(B.terrain, f.x, f.y);
      if (wd) {
        const wl = Math.hypot(wd.x, wd.y) || 1;
        const side = b.strafe || 1;
        mx += (-wd.y / wl) * side * 1.5;
        my += (wd.x / wl) * side * 1.5;
      }
    }
    /* v3.0 视线被挡：不硬顶，绕到障碍侧面再接近（没有掉落物 / 血包这类更高优先级时） */
    if (blocked && !stone && !crown && !f.giftTarget && !f.healTarget) {
      const o = b._los;
      const cross = dx * (o.y - f.y) - dy * (o.x - f.x);
      const px = cross > 0 ? uy : -uy;
      const py = cross > 0 ? -ux : ux;
      const off = Math.max(o.w, o.h) / 2 + 84;
      const tdx = o.x + px * off - f.x, tdy = o.y + py * off - f.y;
      const td = Math.hypot(tdx, tdy) || 1;
      mx = tdx / td * 1.5 + ux * 0.5;
      my = tdy / td * 1.5 + uy * 0.5;
    }
    /* v4.0 世界末日：僵尸沿独木桥摸向庇护所；英雄残血就退回岛上疗伤。
     * 放在最后：要压过「绕障 / 视线被挡」的通用转向，否则会贴着崖边来回走。 */
    if (B.rule === "doomsday" && B.shelter) {
      const sh = B.shelter;
      const dSh = Math.hypot(f.x - sh.x, f.y - sh.y);
      const aim = B.doomAim(f);
      if (f.isZombie) {
        /* v4.1 枪台/炮台优先吸引仇恨：建筑比玩家近就丢下玩家去啃墙（贴近后由 updateGuardPosts 啃咬） */
        const post = B.guardPostNear ? B.guardPostNear(f, 340) : null;
        const dPost = post ? Math.hypot(post.x - f.x, post.y - f.y) : Infinity;
        const dFoe = (foe && !foe.dead) ? Math.hypot(foe.x - f.x, foe.y - f.y) : Infinity;
        if (post && dPost < dFoe) {
          const ax = post.x - f.x, ay = post.y - f.y, ad = Math.hypot(ax, ay) || 1;
          mx = ax / ad * 1.8; my = ay / ad * 1.8;
        } else {
          /* 有人贴在 300 内就先咬人，没人附近才闷头过桥 */
          const near = foe && !foe.dead && dFoe < 300;
          if (aim && !near) {
            const ax = aim.x - f.x, ay = aim.y - f.y, ad = Math.hypot(ax, ay) || 1;
            mx = ax / ad * 1.8; my = ay / ad * 1.8;
          }
        }
      } else {
        /* v4.2 右大陆整块是危险区：英雄不再过去刷分，退回安全区一侧守桥 */
        const L = LD.Terrain && LD.Terrain.doomLand;
        const danger = B.inDoomDanger ? B.inDoomDanger(f.x, f.y) : false;
        if (danger && L) {
          /* 已经踩进右大陆：立刻沿桥往西撤，先回到安全区 */
          const b = L.bridge, cy = (b.y0 + b.y1) / 2;
          const ax = (b.x0 - 70) - f.x, ay = cy - f.y, ad = Math.hypot(ax, ay) || 1;
          mx = ax / ad * 2.0; my = ay / ad * 2.0;
        } else if (L && foe && !foe.dead && B.inDoomDanger && B.inDoomDanger(foe.x, foe.y)) {
          /* 敌人在危险区里：不追过去，退守桥西头等它过桥（守安全区，不吃毒） */
          const b = L.bridge, cy = (b.y0 + b.y1) / 2;
          const gx = b.x0 - 60, gy = cy;
          const gd = Math.hypot(gx - f.x, gy - f.y);
          if (gd > 150) { mx = (gx - f.x) / gd * 1.7; my = (gy - f.y) / gd * 1.7; }
        } else if (dSh > sh.r - 30 && f.hp < f.maxHp * 0.35) {
          /* 残血回岛疗伤 */
          const ax = sh.x - f.x, ay = sh.y - f.y, ad = Math.hypot(ax, ay) || 1;
          mx = ax / ad * 1.6; my = ay / ad * 1.6;
        }
      }
    }
    /* v3.8 塔防：卡进障碍时侧向脱困（地图中间有随机设施，贴墙原地抖很常见） */
    if (B.rule === "tower") {
      const want = Math.hypot(mx, my) > 0.1;
      b._stuckT = (b._stuckT || 0) + dt;
      if (b._stuckT > 0.8) {
        const moved = Math.hypot(f.x - (b._lastX == null ? f.x : b._lastX), f.y - (b._lastY == null ? f.y : b._lastY));
        if (want && moved < 8) {
          b._unstickT = 0.7;
          b._unstickDir = Math.random() < 0.5 ? 1 : -1;
        }
        b._stuckT = 0; b._lastX = f.x; b._lastY = f.y;
      }
      if ((b._unstickT || 0) > 0) {
        b._unstickT -= dt;
        const px = -my, py = mx;                 // 垂直方向侧移
        mx += px * b._unstickDir * 1.6;
        my += py * b._unstickDir * 1.6;
      }
    }
    /* v4.10 护送情报箱（推箱制）：推着 → 冲敌方交付点；空手 → 奔箱子按交互键开推；
     * 敌方在推 → 追推箱的人把他打断。只接管移动，攻击决策仍走下面的通用逻辑。 */
    if (B.rule === "escort" && B.escort) {
      const st = B.escort, box = st.box;
      const myT = f.team > 0 ? 1 : 0;
      if (f.pushBox) {
        const goal = B.escortGoalOf(myT === 0 ? 1 : 0);
        if (goal) {
          const ax = goal.x - f.x, ay = goal.y - f.y, ad = Math.hypot(ax, ay) || 1;
          mx = ax / ad * 1.8; my = ay / ad * 1.8;
        }
      } else if (box.alive && !box.pusher) {
        const ax = box.x - f.x, ay = box.y - f.y, ad = Math.hypot(ax, ay) || 1;
        mx = ax / ad * 1.7; my = ay / ad * 1.7;
        if (ad < f.r + ((LD.ESCORT || {}).pushRange || 96) * 0.7) ctrl.press.interact = true;  // 到箱边就开推
      } else if (box.alive && box.pusher && (box.pusher.team > 0 ? 1 : 0) !== myT) {
        const ax = box.pusher.x - f.x, ay = box.pusher.y - f.y, ad = Math.hypot(ax, ay) || 1;
        mx = ax / ad * 1.8; my = ay / ad * 1.8;
      } else if (box.alive && box.pusher) {
        /* 队友在推：跟着护驾（贴在推箱人附近打掩护） */
        const ax = box.pusher.x - f.x, ay = box.pusher.y - f.y, ad = Math.hypot(ax, ay) || 1;
        if (ad > 150) { mx = ax / ad * 1.4; my = ay / ad * 1.4; }
      }
    }
    /* v4.7 占点争夺：挑「最需要自己」的据点——非自家的点、自家被抢的点优先，
     * 队友已经站够的点自动让开；有敌方炮塔的点降权；残血没架打就回基地回血。
     * 进圈后只做小范围走位，不被敌人勾出去。 */
    if (B.rule === "capture" && B.capture) {
      const myT = f.team > 0 ? 1 : 0, foeT = myT ? 0 : 1;
      const pts = B.capture.pts || [];
      const base = B.captureBase ? B.captureBase(myT) : null;
      const foeNear = !!(foe && !foe.dead && Math.hypot(foe.x - f.x, foe.y - f.y) < 260);
      const inBase = base ? Math.hypot(f.x - base.x, f.y - base.y) <= base.r * 0.8 : false;
      if (base && !inBase && !foeNear && f.hp < f.maxHp * 0.34) {
        /* 残血撤退：基地圈内 5% 最大生命/秒，比在点上硬扛划算 */
        const ax = base.x - f.x, ay = base.y - f.y, ad = Math.hypot(ax, ay) || 1;
        mx = ax / ad * 1.8; my = ay / ad * 1.8;
      } else if (base && inBase && !foeNear && f.hp < f.maxHp * 0.92) {
        mx = my = 0;                     // 站在基地里等回血
      } else {
        let best = null, bs = -1e9;
        for (const p of pts) {
          const d = Math.hypot(p.x - f.x, p.y - f.y);
          let s = 60 - d * 0.06;
          if (p.owner !== myT) s += 110;
          if (p.owner === myT && p.by === foeT) s += 90 + p.prog * 90;
          if (p.owner !== myT && p.by === myT) s += 45 + p.prog * 60;
          /* 敌方炮塔守着点：进去就得先扛塔，降一点优先级 */
          const tur = B.captureTurretOf ? B.captureTurretOf(p) : null;
          if (tur && tur.side !== myT) s -= 60;
          const mates = B.fighters.filter(o => o !== f && o.kind === "hero" && !o.dead && !o.bench
            && (o.team > 0 ? 1 : 0) === myT && Math.hypot(o.x - p.x, o.y - p.y) < p.r * 0.85).length;
          s -= mates * 26;
          if (s > bs) { bs = s; best = p; }
        }
        if (best) {
          const d = Math.hypot(best.x - f.x, best.y - f.y);
          const inside = d < best.r * 0.70;
          let tx = best.x, ty = best.y;
          if (inside && foe && !foe.dead) {
            tx = clamp(foe.x, best.x - best.r * 0.50, best.x + best.r * 0.50);
            ty = clamp(foe.y, best.y - best.r * 0.50, best.y + best.r * 0.50);
          }
          const ax = tx - f.x, ay = ty - f.y, ad = Math.hypot(ax, ay);
          if (ad > (inside ? 40 : 24)) {
            const sp = inside ? 1.1 : 1.8;
            mx = ax / ad * sp; my = ay / ad * sp;
          } else { mx = 0; my = 0; }
        }
      }
    }
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
    /* v3.6：车上目标压缩反应间隔（普通难度 0.34s → 0.1s），有 CD 好就马上出手 */
    if (foeCar) b.think = Math.min(b.think, 0.1);

    // ---- 进攻决策 ----
    const press = (slot) => { ctrl.press[slot] = true; };

    // 天外来物 / 缩圈乱斗：站在掉落物上且槽位已满 → 按键置换（顺手也会把旧技能打出去，置换有 0.3s 延迟）
    b.giftCd = Math.max(0, (b.giftCd || 0) - (b.think || 0));
    const pend = f.giftPending;
    if (B.giftRule() && b.giftCd <= 0 && pend && (pend.skill || pend.ult) && !f.giftSwap) {
      if (pend.ult) press("ult");
      else press(Math.random() < 0.5 ? "skill1" : "skill2");
      b.giftCd = 8;
      return;
    }

    // 大招：BOSS 走 CD 制（boss 技能不耗能量）；勇者仍需能量满。
    // v3.0：视线被挡且不在近身范围时不放大招（打在柱子上白费）
    if (f.loadout.ult && f.cd.ult <= 0 && (!blocked || d < 190) && (foeCar
      ? (d < 620 && (f.isBoss || f.energy >= f.maxEnergy))
      : (f.isBoss
        ? (d < 560 && Math.random() < 0.5)
        : (f.energy >= f.maxEnergy && d < 520 && Math.random() < 0.85)))) { press("ult"); return; }

    // 普攻（快枪手：全程持续开枪，不受距离限制）
    // v3.0：远程普攻在视线被挡时不出手（省 CD，先绕障）；近战普攻不受影响
    const atkRange = f.bossKind === "gun" ? 4000 : (ranged ? 470 : 84);
    /* v3.1：僵尸没有普攻，只有突刺 / 撕咬两个技能 */
    /* v3.6：目标在车上时不再掷骰子省 CD，CD 一好就打——车体吃弹会把驾驶员震下车 */
    if (!f.isZombie && d < atkRange && (!blocked || !ranged) && f.cd.basic <= 0 &&
        (foeCar || Math.random() < 0.92)) press("basic");

    // 技能（按身份分条件）
    /* v3.0：不需要视线的技能白名单（自身增益 / 反制类照常放） */
    const LOS_FREE = { meditate: 1, rockShield: 1, n_clone: 1, b_hatch: 1, gm_card: 1,
      gm_cheat: 1, ts_shield: 1, ts_polar: 1, parry: 1, substitute: 1 };
    const useSkill = (slot) => {
      const id = f.loadout[slot];
      if (!id) return false;
      const s = LD.skill(id);
      if (!s || f.cd[slot] > 0 || f.slot[slot].on) return false;
      /* v3.0 视线被挡且距离不近：远程 / 弹道类技能先不出手，等绕过去再打 */
      if (blocked && d > 150 && !LOS_FREE[id]) return false;
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
        /* ---- v3.1 新技能 ---- */
        case "chain":      if (d < 240) { press(slot); return true; } return false;   // 钢链：中距离直线
        case "cargo":      if (d > 130 && d < 520) { press(slot); return true; } return false;
        case "fish":       if (d < 430) { press(slot); return true; } return false;   // 咸鱼：顺手吸能
        case "assault":    if (d < 580) { press(slot); return true; } return false;   // 突击枪：远距离连射
        /* ---- v3.1 僵尸专属 ---- */
        case "z_lunge":    if (d > 96 && d < 190) { press(slot); return true; } return false;  // 突刺：中距小突进
        case "z_bite":     if (d < 78) { press(slot); return true; } return false;             // 撕咬：贴脸定身
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
        /* ---- v2.6 新 BOSS 技能 ---- */
        case "b_hatch":    press(slot); return true;                                    // 孵化：CD 好就召工蜂
        case "b_sweep":    if (d < 240) { press(slot); return true; } return false;
        case "f_quake":    if (d < 170) { press(slot); return true; } return false;     // 霜压：贴身范围技
        case "f_field":    if (d < 260) { press(slot); return true; } return false;     // 寒霜领域：封锁走位
        case "f_zero":     if (d < 480) { press(slot); return true; } return false;     // 绝对零度
        case "t_cross":    if (d > 100 && d < 420) { press(slot); return true; } return false;
        case "gm_card":    press(slot); return true;                                    // 抽牌：CD 好就抽
        case "gm_cheat":   if (B.projs.some(p => p.side !== f.side && p.dmg > 0)) { press(slot); return true; } return false;
        case "gm_roulette": if (d < 520) { press(slot); return true; } return false;
        case "ts_polar":   if (B.projs.some(p => p.side !== f.side && p.dmg > 0 && Math.hypot(p.vx, p.vy) > 200)) { press(slot); return true; } return false;
        case "ts_shield":  if (f.hp < f.maxHp * 0.85) { press(slot); return true; } return false;
        case "ts_storm":   if (d < 560) { press(slot); return true; } return false;
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
    /* v3.0：火球是飞行物，被柱子挡住就喷不到人——先绕，不浪费 CD */
    const blocked = B.terrain ? !!LD.Terrain.losHit(B.terrain, f.x, f.y, foe.x, foe.y, 30) : false;

    // 大招：CD 好 且 距离适中 → 播大招演出后落下火柱（v2.1 大幅降低释放欲望）
    if (f.cd.ult <= 0 && d < 560) {
      const chance = f.rageStage >= 1 ? 0.5 : 0.22;
      if (Math.random() < dt * chance) { B.trySlot(f, "ult", f.ctrl); return; }
    }
    // 爪击：距离近，狂暴阶段更频繁
    if (f.cd.skill1 <= 0 && d < 420) {
      if (Math.random() < dt * (1.15 + f.rageStage * 0.35)) { B.trySlot(f, "skill1", f.ctrl); return; }
    }
    // 火球：远程压制（视线被挡时不出手）
    if (f.cd.basic <= 0 && d < 700 && !blocked) {
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
