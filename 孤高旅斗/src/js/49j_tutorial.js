/* ============================================================
 *  49j_tutorial.js — v4.19 新手教程
 *
 *  第一次进游戏时，主菜单第一行不是「单人游戏」，而是「新手教程」。
 *  教程是一条横向走廊：出生在最左边，七个步骤依次往右推进，
 *  每一步在屏幕上方正中央给一条提示，做完这一步才放下一步。
 *
 *  为什么单独做一个 mode，而不是塞进「娱乐模式」那批：
 *  娱乐模式（LD.isCasual）在 B.trySlot 里把普攻 / 技能 / 大招**全部禁掉**了，
 *  而教程的核心恰恰是教技能。所以这里用独立 mode，只挑需要的东西接。
 *
 *  为什么木桩用「简单人机」而不是自己写一个静止目标：
 *  简单人机（aggr = 0）在 AI 的开头就 `return` 了 —— 不动、不出手，
 *  但它是个**正常的 fighter**：技能索敌、伤害结算、血条、受击特效全都照常，
 *  不需要给「木桩」单开一条战斗逻辑。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle;
  const FX = LD.FX;
  const TILE = 40;

  const CFG = () => LD.TUT || {};
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------------- 提示条 ---------------- */

  function setTip(head, text, sub) {
    const c = CFG();
    const el = $("tutTip");
    if (!el) return;
    const n = $("tutNo"), m = $("tutText"), s2 = $("tutSub"), dg = $("tutDir");
    if (n) n.textContent = head;
    if (m) m.textContent = text || "";
    if (s2) s2.textContent = sub || "";
    /* 方向牌：整个教程从头到尾都挂「往右走」。玩家中途走神 / 往回跑过，
     * 抬头永远能看见该往哪边走 —— 只在第一步提示一次的话，后面全靠记。 */
    if (dg) dg.textContent = "→ " + (c.dir || "往右走");
    el.classList.remove("hide");
    el.classList.remove("pop");
    void el.offsetWidth;                 /* 强制重排，让弹入动画能连续重放 */
    el.classList.add("pop");
  }

  function say(i) {
    const c = CFG();
    const st = (c.steps || [])[i];
    if (!st) return;
    setTip("教程 " + (i + 1) + " / " + c.steps.length, st.tip, st.sub);
  }

  B.tutHideTip = function () {
    const el = $("tutTip");
    if (el) el.classList.add("hide");
  };

  /* ---------------- 道具工厂 ----------------
   * 字段与 T.mkProp 保持一致（渲染 / 交互 / 物理都只认这些字段）。
   * 教程不走路网的网格生成器：那套是随机的，而教学要求「这一件东西
   * 必须出现在这一步的这条路线上」。
   */
  function addProp(kind, matId, x, y, cw, ch) {
    const t2 = B.terrain;
    if (!t2 || !t2.props) return null;
    const def = (LD.TERRAIN.types && LD.TERRAIN.types[kind]) || {};
    const pw = (cw || 1) * TILE, ph = (ch || 1) * TILE;
    /* 别叠在已有的东西上。
     *
     * 这不是「整齐好看」的问题：玩家开着车走到这一步的位置，补给箱正好刷在
     * 车身里，车被 blockMove 卡死 —— 想开走时 blockedAt 每一帧都为真，
     * 速度被清成 0，于是「再上车就动不了」。实测过，确实能复现。
     * 所以刷之前先找一个不和任何 prop（以及玩家本人）重叠的空位。 */
    const hero = B.tutHero;
    const busy = (px, py) => {
      if (hero && Math.abs(hero.x - px) < (pw + 60) / 2 && Math.abs(hero.y - py) < (ph + 60) / 2) return true;
      return t2.props.some(o => !o.dead
        && Math.abs(o.x - px) < (o.w + pw) / 2 - 2
        && Math.abs(o.y - py) < (o.h + ph) / 2 - 2);
    };
    let px = x;
    for (let k = 0; k < 30 && busy(px, y); k++) px += TILE;
    const o = {
      uid: 910000 + t2.props.length,
      kind: kind, mat: matId, shape: def.shape || "square",
      cw: cw || 1, ch: ch || 1,
      w: pw, h: ph,
      x: px, y: y, ox: px, oy: y,
      elev: 26, mass: 2.4, hp: 0, maxHp: 0,
      dead: false, flash: 0, vx: 0, vy: 0, free: true,
      soft: !!def.soft, blockMove: !!def.blockMove, blockProj: !!def.blockProj,
      variant: 11
    };
    if (kind === "mud") { o.carried = false; o.cargo = false; o.landed = true; }
    if (kind === "supply") { o.hp = 20; o.maxHp = 20; }
    if (kind === "car") {
      const vc = (LD.VEHICLES && LD.VEHICLES.sedan) || { speed: [1.2, 1.7], fuel: [2000, 6000] };
      o.vtype = "sedan";
      o.fuelMax = vc.fuel[1];
      o.fuel = o.fuelMax;
      o.speedMul = vc.speed[1];
      o.ramCd = 0; o.hornCd = 0; o.cannonCd = 0;
      o.driver = null;
    }
    t2.props.push(o);
    return o;
  }

  /* ---------------- 木桩 ----------------
   * 简单人机 = 木桩：AI 的 conf.aggr 为 0，会在开头直接 return。
   * 血量给到 4000，教程里怎么打都打不死（不需要「赢」这一步）。
   */
  function mkDummy(side, x, y) {
    const c = CFG();
    const d = B.mkHero(side, {
      x: x, y: y, name: "木桩",
      loadout: { basic: "slash", skill1: null, skill2: null, ult: null }
    });
    d.maxHp = c.dummyHp || 4000;
    d.hp = d.maxHp;
    d.team = side;                       /* 和玩家不同队，技能索敌才会认它 */
    d.tutDummy = true;
    LD.AI.mkBot(d, "easy");
    return d;
  }

  /* ---------------- 开场 ---------------- */

  /* 只建两根木桩：左边一根给普攻 / 技能练手，右边一根给索敌练习。
   * 都在开局就建好（而不是打到一半往 this.fighters 里 push），
   * 因为 setup 时 score / wScore 这些数组是按人数定长的，
   * 中途加人会把这些数组挤歪。 */
  B.tutMakeDummies = function () {
    const c = CFG(), w = this.world;
    const y = (w.pt || 0) + (w.h - (w.pt || 0)) * 0.5;
    const xs = (c.steps || []).map(s => s.dummy).filter(v => v != null);
    return xs.map((x, i) => mkDummy(i + 1, x, y));
  };

  B.tutInit = function () {
    const c = CFG();
    const hero = this.fighters.find(f => f.kind === "hero" && !f.tutDummy);
    if (!hero) return;
    this.tutHero = hero;
    this.tut = {
      step: -1, t: this.t, done: false, ended: false,
      origin: { x: hero.x, y: hero.y },
      dummy: null, mud: null, car: null, box: null,
      picked: false, boarded: false,
      hit: { basic: false, skill1: false, skill2: false },
      pend: null
    };
    this.tutGo(0);
  };

  /* 走到第 i 步：更新提示 + 摆出这一步要用的东西 */
  B.tutGo = function (i) {
    const c = CFG(), st = this.tut;
    const list = c.steps || [];
    if (!st) return;
    if (i >= list.length) { this.tutFinish(); return; }
    st.step = i;
    st.t = this.t;
    st.hit = { basic: false, skill1: false, skill2: false };
    st.picked = false;
    st.boarded = false;
    st.pend = null;

    const sp = list[i] || {};
    const w = this.world;
    const y = (w.pt || 0) + (w.h - (w.pt || 0)) * 0.5;

    if (sp.dummy != null) {
      const d = this.fighters.find(f => f.tutDummy && Math.abs(f.x - sp.dummy) < 2);
      st.dummy = d || null;
    }
    if (sp.mud != null) st.mud = addProp("mud", "mud_pile", sp.mud, y, 2, 1);
    if (sp.car != null) st.car = addProp("car", "car_red", sp.car, y, 2, 1);
    if (sp.box != null) st.box = addProp("supply", "crate_supply", sp.box, y, 1, 1);

    /* 第 3 步：现场发两个技能（第 1 步之前玩家身上一个技能都没有） */
    if (sp.id === "skill") {
      const h = this.tutHero;
      if (h && h.loadout) { h.loadout.skill1 = "laserWave"; h.loadout.skill2 = "dragonPalm"; }
    }
    /* 索敌那一步：先把锁定**摆在左边那根木桩上**。
     * 这样玩家按一次 V 就切到右边 —— 教的正是「V 是切换」这件事。
     * 不摆的话，第一次按 V 锁的是离自己最近 / 座位号最小的左边那根，
     * 玩家要按两次才轮到右边的，看起来像「按了没反应」。 */
    if (sp.id === "lock") {
      const h = this.tutHero;
      if (h && !(h.lock >= 0)) {
        const other = this.fighters.find(f => f.tutDummy && f !== st.dummy);
        if (other) h.lock = other.side;
      }
    }
    /* 第 7 步：突然充满能量 + 解锁大招 */
    if (sp.id === "ult") {
      const h = this.tutHero;
      if (h) {
        h.loadout.ult = "voidSlash";
        h.energy = h.maxEnergy;
        FX.float(h.x, h.y - 72, "能量已满！", "#fcd34d", 18);
        FX.ring(h.x, h.y - 20, 70, "rgba(252,211,77,.9)", 5, 0.5);
      }
    }
    say(i);
  };

  /* ---------------- 事件钩子 ----------------
   * 施法与命中都在 40_battle.js 里留了一个 tutorial 分支调过来。
   * 为什么要记录「哪一次施法打中了」：技能的伤害回调里只带 type:"skill"，
   * 不带技能 id。教程要求「K 和 L 都要打中」，所以施法时记下当前槽位，
   * 2 秒内落到木桩上的技能伤害就归给它。
   */
  B.tutOnCast = function (f, slot) {
    const st = this.tut;
    if (!st || st.done || f !== this.tutHero) return;
    if (slot === "skill1" || slot === "skill2") st.pend = { slot: slot, t: this.t };
    const cur = (CFG().steps || [])[st.step];
    if (slot === "ult" && cur && cur.id === "ult") {
      /* 不再「放完立刻结算」：大招是整段教程的收尾演出，刀光还没散就弹结算面板
       * 等于把高潮剪掉了。改成 5 秒后再结算，这 5 秒里玩家还能自由走动。 */
      st.done = true;
      st.endAt = this.t + (CFG().endDelay == null ? 5 : CFG().endDelay);
      setTip("教程完成", "「虚空爆裂斩」释放成功", "马上回主菜单，奖励已入账");
    }
  };

  B.tutOnHit = function (src, tgt, amt, o) {
    const st = this.tut;
    if (!st || st.done) return;
    if (src !== this.tutHero || !tgt || !tgt.tutDummy) return;
    const cur = (CFG().steps || [])[st.step];
    if (!cur) return;
    if (cur.id === "attack" && (!o || o.type !== "skill")) st.hit.basic = true;
    if (cur.id === "skill" && st.pend && o && o.type === "skill" && this.t - st.pend.t < 2.0) {
      st.hit[st.pend.slot] = true;
      st.pend = null;
    }
  };

  /* ---------------- 每帧推进 ---------------- */
  B.updateTutorial = function (dt) {
    const st = this.tut, c = CFG();
    if (!st) return;
    /* 大招之后的等待期：提示条已经换成「教程完成」，还差最后几秒才结算。
     * 这个计时必须在 st.done 的早退之前判断，否则永远不会触发。 */
    if (st.endAt != null) {
      if (this.t >= st.endAt) { st.endAt = null; this.tutFinish(); }
      return;
    }
    if (st.done) return;
    const cur = (c.steps || [])[st.step];
    if (!cur) return;
    const h = this.tutHero;
    if (!h) return;

    let ok = false;
    if (cur.id === "move") {
      ok = Math.hypot(h.x - st.origin.x, h.y - st.origin.y) > (c.moveDist || 64);
    } else if (cur.id === "attack") {
      ok = st.hit.basic;
    } else if (cur.id === "skill") {
      ok = st.hit.skill1 && st.hit.skill2;
    } else if (cur.id === "lock") {
      /* 锁定必须落在右边那根木桩上。lock 存的是「座位号」（side），
       * 不是对象 —— 与 B.lockTarget / cycleLock 同一套语义。 */
      ok = !!(st.dummy && h.lock === st.dummy.side);
    } else if (cur.id === "mud") {
      /* 先捡起来（carryMud 有值），再扔出去（carryMud 又变回 null） */
      if (h.carryMud) st.picked = true;
      ok = st.picked && !h.carryMud;
    } else if (cur.id === "car") {
      if (h.rideCar) st.boarded = true;
      ok = st.boarded && !h.rideCar;
    } else if (cur.id === "box") {
      ok = !!(st.box && st.box.dead);
    }
    /* ult 由 tutOnCast 起计时，不走这里 */

    if (ok) {
      FX.float(h.x, h.y - 90, "完成", "#7ff0c4", 16);
      this.tutGo(st.step + 1);
    }
  };

  /* ---------------- 收尾 ---------------- */
  B.tutFinish = function () {
    const st = this.tut;
    if (!st || st.ended) return;
    st.ended = true;
    st.done = true;
    const h = this.tutHero;
    if (h) FX.burst(h.x, h.y - 30, 40, ["#fcd34d", "#fff", "#7dd3fc"], { speed: 320, life: 1.0 });
    if (LD.UI && LD.UI.endTutorial) LD.UI.endTutorial();
  };

  LD.Tutorial = {
    mkDummy: mkDummy,
    addProp: addProp,
    say: say
  };
})(window.LD = window.LD || {});
