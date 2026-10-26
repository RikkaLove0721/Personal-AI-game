/* ============================================================
 *  49a_casual.js — v4.12 娱乐模式公共层
 * ============================================================
 *  本批五个娱乐模式（木头人 / 抢椅子 / 躲猫猫 / 岩浆 / 弹幕）共用一套壳：
 *    - 全员 team = -1：没有友军伤害，AI 也不会产生阵营仇恨
 *    - 普攻 / 技能 / 大招全部禁用（判定在 B.trySlot），P 键交互保留给场景道具
 *    - 胜负与击杀脱钩：血空只是暂时离场（计时复活），只有「达成目标 / 只剩一人」才结算
 *    - 统一分发 initXxx / updateXxx / drawXxx / xxxTimeUp / casualAI.xxx
 *
 *  为什么伤害不走 B.damage：全员同队，`sameTeam` 会把伤害直接挡掉。
 *  所以这里用 casualHurt 手动结算，和烫手山芋一个路子。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  /* 规则 id → 模块后缀 / 配置块 */
  const MOD = { statue: "Statue", chair: "Chair", hide: "Hide", lava: "Lava", barrage: "Barrage" };
  const CFGMAP = () => ({
    statue: LD.STATUE, chair: LD.CHAIR, hide: LD.HIDE,
    lava: LD.LAVA, barrage: LD.BARRAGE
  });

  B.casualCfg = function () { return CFGMAP()[this.rule] || {}; };
  B.casualMod = function () { return MOD[this.rule] || null; };

  /* 各模式的人机逻辑注册在这里（50_ai.js 只认这一个入口）——
   * 模式文件（49b~49g）在 50_ai.js 之前加载，不能直接用 LD.AI，故另开命名空间。 */
  LD.casualAI = {};

  /* ---------------- 通用小工具 ---------------- */

  /** 场上还活着的英雄（不含板凳 / 巨龙 / 小兵） */
  B.casualAlive = function () {
    return (this.fighters || []).filter(f => f.kind === "hero" && !f.dead && !f.bench);
  };

  /**
   * 娱乐模式的人工伤害：不走 B.damage（全员同队会被挡），手动扣血 + 可选击退。
   * o = { text, color, size, dy, kb, kbx, kby }
   */
  B.casualHurt = function (f, dmg, o) {
    if (!f || f.dead || !(dmg > 0)) return 0;
    if (f.invuln > 0) { this.ev.push(["t", f.x, f.y - 40, "闪", "#9fb3dd"]); return 0; }
    o = o || {};
    f.hp = Math.max(0, f.hp - dmg);
    f.hitFlash = 0.18;
    const col = o.color || "#fb7185";
    const dy = o.dy == null ? 88 : o.dy;
    const txt = (o.text == null ? "-" : o.text) + Math.round(dmg);
    FX.float(f.x, f.y - dy, txt, col, o.size || 16);
    this.ev.push(["h", f.x, f.y - dy, txt, col]);
    if (o.kb && this.knockDist) {
      this.knockDist(f, { x: o.kbx == null ? f.x : o.kbx, y: o.kby == null ? f.y - 40 : o.kby }, o.kb, false);
    }
    if (f.hp <= 0) this.kill(f, null, { type: "env" });
    return dmg;
  };

  /** 娱乐模式的通用结算：先到目标 / 只剩一人 → 赢下这一局 */
  B.casualWin = function (f, title) {
    if (!f || this.state !== "fight") return;
    FX.float(f.x, f.y - 96, title || "获胜！", "#fcd34d", 22);
    this.endRound(f.side);
  };

  /**
   * 小地图模式（木头人）的地形是按大地图生成的，越界的障碍要先清掉，
   * 剩下的按 keep 抽稀——留一点当路障，跑起来才有抢道的感觉。
   */
  B.casualThinProps = function (keep) {
    const T = this.terrain;
    if (!T || !T.props) return;
    const w = this.world.w, h = this.world.h, pt = this.world.pt || 0;
    let list = T.props.filter(o => !o.dead && o.x > 20 && o.x < w - 20 && o.y > pt + 20 && o.y < h - 20);
    T.props.length = 0;
    if (keep >= 1) { list.forEach(o => T.props.push(o)); return; }
    list = list.filter(() => Math.random() < keep);
    list.forEach(o => T.props.push(o));
  };

  /** 直接往地形里塞一个物件（躲猫猫补柜子 / 岩浆摆安全台用），字段与 T 生成的一致 */
  B.casualAddProp = function (kind, matId, x, y, cw, ch) {
    const T = this.terrain;
    if (!T || !T.props) return null;
    const TILE = (LD.TERRAIN && LD.TERRAIN.tile) || 40;
    const def = (LD.TERRAIN && LD.TERRAIN.types && LD.TERRAIN.types[kind]) || {};
    const o = {
      uid: 900000 + T.props.length + ((Math.random() * 1000) | 0),
      kind: kind, mat: matId, shape: def.shape || "square",
      cw: cw || 1, ch: ch || 1,
      w: (cw || 1) * TILE, h: (ch || 1) * TILE,
      x: x, y: y, ox: x, oy: y,
      elev: 30, mass: 2.4, hp: 0, maxHp: 0,
      dead: false, flash: 0, vx: 0, vy: 0, free: true,
      soft: !!def.soft, blockMove: !!def.blockMove, blockProj: !!def.blockProj
    };
    if (kind === "locker") o.occupant = null;
    if (def.damageable) { o.hp = 60; o.maxHp = 60; }
    T.props.push(o);
    return o;
  };

  /** 把一批角色摆到指定坐标（越界自动收回场内） */
  B.casualPlace = function (pts, fighters) {
    const list = fighters || this.casualAlive();
    const w = this.world.w, h = this.world.h, pt = this.world.pt || 0;
    list.forEach((f, i) => {
      const p = pts[Math.min(i, pts.length - 1)] || { x: w / 2, y: h / 2 };
      f.x = clamp(p.x, 40, w - 40);
      f.y = clamp(p.y, pt + 30, h - 40);
      f.vx = 0; f.vy = 0; f.knockLeft = 0;
      if (f.ctrl) { f.ctrl.mx = 0; f.ctrl.my = 0; }
    });
  };

  /* ---------------- 分发器 ---------------- */

  B.initCasual = function () {
    const m = B.casualMod.call(this);
    if (!m) return;
    /* 全员脱队：娱乐模式里没有友军，也不该有阵营仇恨 */
    this.fighters.forEach(f => { if (f.kind === "hero") f.team = -1; });
    const fn = this["init" + m];
    if (fn) fn.call(this);
  };

  B.updateCasual = function (dt) {
    const m = B.casualMod.call(this);
    if (!m) return;
    const fn = this["update" + m];
    if (fn) fn.call(this, dt);
  };

  B.drawCasual = function (ctx) {
    const m = B.casualMod.call(this);
    if (!m) return;
    const fn = this["draw" + m];
    if (fn) fn.call(this, ctx);
  };

  /** 限时到点：各模式按自己的进度 / 分数判胜（木头人比谁跑得远，其余比血量） */
  B.casualTimeUp = function () {
    const m = B.casualMod.call(this);
    if (m && this[m.charAt(0).toLowerCase() + m.slice(1) + "TimeUp"]) {
      this[m.charAt(0).toLowerCase() + m.slice(1) + "TimeUp"]();
      return;
    }
    /* 兜底：血最多的赢 */
    const alive = this.casualAlive();
    if (!alive.length) { this.endRound(0); return; }
    let w = alive[0];
    alive.forEach(f => { if (f.hp > w.hp) w = f; });
    this.casualWin(w, "时间到·血量最高");
  };

  /* 让各模式文件也能用到这些工具 */
  LD.casualUtil = { clamp: clamp, rnd: rnd, pick: pick, TAU: TAU };
})(window.LD = window.LD || {});
