/* ============================================================
 *  49d_hide.js — v4.13 躲猫猫（改版）
 * ============================================================
 *  开局随机一人当鬼（血更厚、跑得快 20%），其余人躲。
 *    - 躲的人可以钻柜子 / 猫草丛（复用现成的隐匿机制）
 *    - 鬼贴到身边直接抓（目标不在隐匿状态才算抓到）
 *    - 鬼站在柜子 / 草丛旁会自动搜查 searchNeed 秒，把里面的人揪出来
 *    - 被抓的人**反过来变成鬼**，一起去抓剩下的人
 *
 *  v4.13 的变化：
 *    1. 取消「长时间躲着会被发现」——藏住了就是藏住了
 *    2. 普通障碍大幅减少，柜子与草丛大幅增多（地图就是拿来躲的）
 *    3. 开局的鬼 10 秒失明（**整体屏幕变黑**，和停电夜战一个观感）+ 10 秒定身
 *    4. 躲藏者的「隐匿」从 K 键挪到 **P 键**（CD 仍是 15 秒）
 *    5. 每 30 秒场上刷一件道具，靠近**按住 P 蓄力 2 秒**才拿得走：
 *         鬼拿到 → 随机锁定一个躲藏者 10 秒（拿到对方位置）
 *         人拿到 → 所有鬼 10 秒定身 + 失明，且搜查耗时翻倍
 *    6. 鬼的移速 120%
 *
 *  v4.13f（本次）——「只发一个招式」改版：
 *    - 人（躲藏者）：普攻 / 技能 / 大招全清空，**只剩 J = 隐匿**（hide_stealth，CD 15 秒）
 *    - 鬼（追捕者）：技能与大招全空，**只剩 J = 抓人**（hide_catch，CD 2 秒 / 100 伤害）
 *    - **抓人现在能抓躲在柜子 / 草丛里的人**：以前 hideCatch 直接把 hideProp / bushHide
 *      的目标 continue 掉，而另一条「自动搜查」又会被 `searched` 永久拉黑（搜空过一次的柜子
 *      再也不会被搜），于是「我知道他躲这儿了，怎么抓都没用」——这是本次要根治的 BUG。
 *      现在：① 抓人键给藏起来的人额外 catchPull 的够手距离，一抓就揪出来；
 *            ② searched 从「永久拉黑」改成 reSearchT 秒冷却。
 *    - 当鬼时**关掉所有索敌指引**：视野外箭头、头顶「躲」标记、别人的名字全部不画。
 *    - 躲藏物数量 ×hideMul（翻倍）。
 *
 *  v4.13g（本次）——抓人改成「真打伤害」：
 *    - **搜查不再让人当场变鬼**：搜到只把人从柜子 / 草丛里揪出来（弹出 + 眩晕 + 现形），
 *      伤害一律交给鬼自己按 J 去打 —— 用户要的是「不是一碰就抓到」。
 *    - 鬼的 J = 抓人：半径 catchR2 内 100 伤害，CD 2 秒；躲藏者 200 血 →
 *      **挨满两下（200 伤害）才变成鬼**，之后 J 从「隐匿」换成「抓人」。
 *    - 道具刷新放慢：relicEvery / relicFirst 都是 30 秒（第一次也在第 30 秒刷）。
 *
 *  v4.13d 的旧设（已废弃，仅存档）：
 *    - 人：P = 隐匿（复用 skill1 那套 CD / 状态机，只是不再由 K 触发）
 *    - 鬼：P = 抓人，半径 catchR2、100 伤害、CD 2 秒。**贴身不再自动抓**
 *    - 人被打空血 → 不当场死，而是变成鬼；P 键也随之从「隐匿」换成「抓人」
 *    - 身份是鬼但身边就是柜子时，仍可以把 P 让给「搜柜子 / 钻柜子」（见 RULE_INTERACT）
 *
 *  胜负：撑到时间结束还有人没被抓 → 躲藏者赢；躲藏者被抓光 → 鬼赢。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  const C = () => LD.HIDE || {};

  const C_SEEK = "#f87171", C_HIDE = "#7dd3fc", C_GOLD = "#fbbf24", C_RELIC = "#c084fc";

  /** 可躲藏的物件：柜子（钻进去）与草丛（猫进去） */
  B.hideSpots = function () {
    const props = (this.terrain && this.terrain.props) || [];
    return props.filter(o => !o.dead && (o.kind === "locker" || o.kind === "bush"));
  };

  /** 某个躲藏点里此刻有没有藏人（只认躲藏者：鬼自己钻进草丛不算「有人藏在里面」） */
  B.hideOccupant = function (o) {
    if (!o || o.dead) return null;
    if (o.occupant && !o.occupant.dead && o.occupant.hideRole !== "seeker") return o.occupant;
    if (o.kind === "bush") {
      for (const f of B.fighters) {
        if (f.kind !== "hero" || f.dead || f.bench) continue;
        if (!f.inBush) continue;
        /* v4.13f：鬼搜查草丛时会**站在草丛里**，以前这里会把鬼自己当成 occupant，
         * 于是「里面有人 → 不是躲藏者 → 判定为空」，同草丛里真躲着的人反而永远搜不出来。 */
        if (f.hideRole === "seeker") continue;
        if (Math.abs(f.x - o.x) < (o.w || 80) / 2 + 6 && Math.abs(f.y - o.y) < (o.h || 80) / 2 + 6) return f;
      }
    }
    return null;
  };

  /**
   * v4.13 地形重排：**普通障碍大幅减少、隐匿物大幅增加**。
   * 先按 propKeep 抽稀非隐匿物，再把柜子 / 草丛补足到 need 个。
   */
  B.hideLayout = function (need) {
    const T = this.terrain, w = this.world, c = C();
    if (!T || !T.props) return;
    const keepP = c.propKeep != null ? c.propKeep : 0.22;
    const hid = [], oth = [];
    T.props.forEach(o => {
      if (o.dead) return;
      if (o.kind === "locker" || o.kind === "bush") hid.push(o); else oth.push(o);
    });
    T.props.length = 0;
    oth.forEach(o => { if (Math.random() < keepP) T.props.push(o); });
    hid.forEach(o => T.props.push(o));
    /* 隐匿物补足（草丛占 bushRatio） */
    const bushR = c.bushRatio != null ? c.bushRatio : 0.5;
    for (let i = hid.length, guard = 0; i < need && guard < need * 12; guard++) {
      const bush = Math.random() < bushR;
      const x = rnd(110, w.w - 110), y = rnd(w.pt + 90, w.h - 90);
      if (LD.Terrain.clearAt && !LD.Terrain.clearAt(T, x, y, 40)) continue;
      let tooClose = false;
      for (let k = 0; k < T.props.length; k++) {
        const o = T.props[k];
        if (Math.abs(o.x - x) < ((o.w || 40) + 70) * 0.5 && Math.abs(o.y - y) < ((o.h || 40) + 70) * 0.5) { tooClose = true; break; }
      }
      if (tooClose) continue;
      B.casualAddProp.call(this, bush ? "bush" : "locker", bush ? "bush_leaf" : "locker_wood", x, y, bush ? 2 : 1, bush ? 2 : 1);
      i++;
    }
  };

  /* ---------------- 场上道具 ---------------- */

  B.hideSpawnRelic = function () {
    const st = this.hide, w = this.world;
    if (!st || st.relic) return null;
    for (let k = 0; k < 60; k++) {
      const x = rnd(120, w.w - 120), y = rnd(w.pt + 90, w.h - 90);
      if (this.terrain && LD.Terrain.clearAt && !LD.Terrain.clearAt(this.terrain, x, y, 30)) continue;
      st.relic = { x: x, y: y, t: 0, bob: rnd(0, TAU), taken: false };
      FX.ring(x, y, 54, "rgba(192,132,252,.9)", 5, 0.5);
      FX.float(x, y - 60, "场上出现道具！", C_RELIC, 18);
      this.ev.push(["t", x, y - 60, "场上出现道具！", C_RELIC]);
      if (LD.Audio && LD.Audio.beep) LD.Audio.beep(620, 0.16, "triangle", 0.05);
      return st.relic;
    }
    return null;
  };

  /** 拿走道具：鬼 → 随机锁一个躲藏者；人 → 所有鬼定身 + 失明 + 搜查翻倍 */
  B.finishRelic = function (f, relic) {
    const st = this.hide, c = C();
    if (!st || !relic || relic.taken) return false;
    relic.taken = true;
    st.relic = null;
    st.relicT = c.relicEvery || 30;
    const alive = this.casualAlive();
    if (f.hideRole === "seeker") {
      const hiders = alive.filter(o => o.hideRole === "hider" && !o.dead);
      if (hiders.length) {
        const t = hiders[(Math.random() * hiders.length) | 0];
        st.mark = { side: t.side, t: c.lockT || 10 };
        FX.float(f.x, f.y - 82, "锁定了一个人！", C_SEEK, 19);
        this.ev.push(["h", f.x, f.y - 82, "锁定了一个人！", C_SEEK]);
      } else {
        FX.float(f.x, f.y - 82, "没人可锁了", "#94a3b8", 15);
      }
    } else {
      const T = c.freezeT || 10;
      let n = 0;
      alive.forEach(o => {
        if (o.hideRole !== "seeker" || o.dead) return;
        o.root = Math.max(o.root || 0, T);
        o.blackout = Math.max(o.blackout || 0, T);
        FX.float(o.x, o.y - 82, "动不了了！", "#94a3b8", 16);
        n++;
      });
      st.searchMulT = T;
      FX.float(f.x, f.y - 82, "鬼全被定住了！", C_HIDE, 19);
      this.ev.push(["h", f.x, f.y - 82, "鬼全被定住了！", C_HIDE]);
      FX.shake(8);
    }
    FX.burst(relic.x, relic.y, 20, [C_RELIC, "#fff"], { speed: 260 });
    return true;
  };

  /* ---------------- 初始化 / 主循环 ---------------- */

  B.initHide = function () {
    const c = C(), w = this.world;
    const alive = this.casualAlive();

    /* v4.13f 地形：隐匿物补足到 (人数 × 2 + hideExtra) × hideMul（默认翻倍） */
    const baseNeed = alive.length * 2 + (c.hideExtra || 6);
    this.hideLayout(Math.round(baseNeed * (c.hideMul == null ? 2 : c.hideMul)));

    /* 随机一人当鬼；为了保证「有人能玩」，人数 ≥ 3 时才随机，2 人局固定第 0 位当鬼 */
    const si = alive.length >= 3 ? (Math.random() * alive.length) | 0 : 0;
    alive.forEach((f, i) => {
      f.hideRole = (i === si) ? "seeker" : "hider";
      f.maxHp = f.hideRole === "seeker" ? (c.seekerHp || 300) : (c.hiderHp || 200);
      f.hp = f.maxHp;
      f.hideT = 0; f.hideAim = null; f.hideAimT = 0;
      f.searched = {};
      /* v4.13f：这模式只发一个招式，装在 J（basic）槽上。
       * 存档里那套配装在这模式里一律不用——玩家不需要为躲猫猫另外配装。 */
      f.loadout = {
        basic: f.hideRole === "seeker" ? "hide_catch" : "hide_stealth",
        skill1: null, skill2: null, ult: null
      };
      if (f.cd) { f.cd.basic = 0; f.cd.skill1 = 0; f.cd.skill2 = 0; f.cd.ult = 0; }
      if (f.slot) Object.keys(f.slot).forEach(k => { f.slot[k] = { on: false, phase: "", t: 0, d: {} }; });
      f.stealthSlot = "basic";
    });
    /* 鬼落在左侧中部，躲的人**纵向铺开**撒在右半边。
     * v4.13f：以前所有人都挤在右边 55% 里随机落点，实测经常三个躲藏者落在同一角，
     * 鬼从左边一路搜过去要 60 秒以上才走到人堆里（一局 120 秒），运气不好整局 0 次抓获。
     * 现在按人数把纵向切成等份、每份随机落一个，保证鬼沿路就能撞上人。 */
    const sk = alive[si];
    const hs = alive.filter((f, i) => i !== si);
    const top = w.pt + 90, bot = w.h - 90;
    const pts = alive.map((f, i) => {
      if (i === si) return { x: 110, y: (w.pt + w.h) / 2 };
      const j = hs.indexOf(f);
      const band = hs.length <= 1 ? 0.5 : (j + 0.5) / hs.length;
      const y = j < 0 ? rnd(top, bot) : top + (bot - top) * (band + rnd(-0.28, 0.28) / hs.length);
      return { x: rnd(w.w * 0.38, w.w - 120), y: clamp(y, top, bot) };
    });
    this.casualPlace(pts, alive);
    if (sk) {
      /* v4.13 开局的鬼：10 秒失明（整体屏幕变黑）+ 10 秒定身 */
      sk.blackout = c.openBlind || 10;
      sk.root = Math.max(sk.root || 0, c.openRoot || 10);
      FX.ring(sk.x, sk.y - 26, 80, "rgba(248,113,113,.9)", 6, 0.5);
      FX.float(sk.x, sk.y - 96, "你就是鬼！（先黑 10 秒）", C_SEEK, 20);
      this.ev.push(["t", sk.x, sk.y - 96, "你就是鬼！（先黑 10 秒）", C_SEEK]);
    }
    this.hide = {
      hintT: c.hintEvery || 6, search: null, caught: 0, firstSeeker: sk ? sk.side : 0,
      relic: null, relicT: c.relicFirst || 30,
      mark: null, searchMulT: 0
    };
    FX.float(w.w / 2, w.pt + 40, "躲猫猫开始——快藏起来", C_GOLD, 20);
  };

  /** 把一个人变成鬼 */
  B.hideTurnSeeker = function (f) {
    const c = C();
    if (!f || f.hideRole === "seeker") return;
    f.hideRole = "seeker";
    f.maxHp = c.seekerHp || 300;
    f.hp = Math.max(f.hp, Math.round(f.maxHp * 0.6));
    f.hideT = 0;
    /* v4.13f：J 键随着身份一起换——变鬼之后 J 从「隐匿」变成「抓人」 */
    f.stealthT = 0;
    if (f.cd) { f.cd.basic = 0; f.cd.skill1 = 0; }
    if (f.loadout) f.loadout = { basic: "hide_catch", skill1: null, skill2: null, ult: null };
    if (f.slot && f.slot.basic) f.slot.basic = { on: false, phase: "", t: 0, d: {} };
    if (f.hideProp && this.ejectLocker) this.ejectLocker(f);
    FX.ring(f.x, f.y - 26, 78, "rgba(248,113,113,.95)", 6, 0.5);
    FX.float(f.x, f.y - 96, "被抓到了！你也是鬼了（J = 抓人）", C_SEEK, 19);
    this.ev.push(["h", f.x, f.y - 96, "被抓到了！你也是鬼了", C_SEEK]);
    FX.shake(8);
    if (LD.Audio && LD.Audio.beep) LD.Audio.beep(240, 0.2, "sawtooth", 0.06);
    this.hide.caught++;
  };

  /* ---------------- v4.13f J 键：隐匿（人）/ 抓人（鬼） ----------------
   * 两个专用招式挂进技能实现表：隐匿整套照搬 IMPL.stealth（持续 / 闪现 / 护盾 / CD 全复用），
   * 抓人只是一层薄壳——判定写在 hideCatchAt 里，CD 交给槽位（endSlot）。 */
  const IMPL = LD.SKILL_IMPL;
  IMPL.hide_stealth = IMPL.stealth;
  IMPL.hide_catch = {
    start(f, slot, sk) {
      if (!f || f.hideRole !== "seeker") return;
      B.hideCatchAt(f);
      if (B.endSlot) B.endSlot(f, slot, sk.cd);
    }
  };

  /** 鬼的抓人判定（不管 CD，CD 交给槽位）。返回命中人数。
   *  和旧版最大的差别：**躲在柜子 / 草丛里的人也能抓**——按柜子中心算距离，
   *  额外给 catchPull 的够手距离。以前这里直接 continue，人就永远抓不出来。 */
  B.hideCatchAt = function (f) {
    const c = C();
    if (!f || f.dead || f.hideRole !== "seeker") return 0;
    const R = c.catchR2 || 88;
    const pull = c.catchPull == null ? 26 : c.catchPull;
    let hit = 0;
    for (const h of this.casualAlive()) {
      if (h === f || h.hideRole !== "hider") continue;
      const hidden = !!(h.hideProp || h.bushHide);
      /* 藏起来的人：要站在藏身点旁边才揪得到（柜子是 blockMove，站不进去） */
      const d = Math.hypot(h.x - f.x, h.y - f.y);
      if (d > R + (hidden ? pull : 0)) continue;
      hit++;
      if (hidden) {
        if (h.hideProp && this.ejectLocker) this.ejectLocker(h);
        if (h.bushHide) { h.bushHide = false; h.bushFlash = 1.4; }
        FX.float(h.x, h.y - 92, "被揪出来了！", C_SEEK, 16);
      }
      this.hideHurt(h, c.catchDmg || 100, f);
    }
    FX.ring(f.x, f.y - 20, R, "rgba(248,113,113,.85)", 5, 0.32);
    FX.burst(f.x, f.y - 24, hit ? 14 : 6, ["#f87171", "#fecaca"], { speed: 240 });
    if (!hit) FX.float(f.x, f.y - 76, "抓了个空", "#94a3b8", 14);
    if (LD.Audio && LD.Audio.beep) LD.Audio.beep(hit ? 300 : 160, 0.1, "square", 0.05);
    return hit;
  };

  /**
   * 躲藏者挨打。血打空**不是死亡**，而是当场变成鬼（用户要求）。
   * 所以这里不走 casualHurt（那会进 kill → 复活链路），自己结算。
   */
  B.hideHurt = function (h, dmg, by) {
    const c = C();
    if (!h || h.dead || !(dmg > 0)) return 0;
    h.hp = Math.max(0, h.hp - dmg);
    h.hitFlash = 0.18;
    FX.float(h.x, h.y - 88, "-" + Math.round(dmg), "#fb7185", 17);
    this.ev.push(["h", h.x, h.y - 88, "-" + Math.round(dmg), "#fb7185"]);
    if (this.knockDist && by) this.knockDist(h, { x: by.x, y: by.y }, c.catchKb || 70, false);
    /* 挨了一下会踉跄半秒：不然击退 + 立刻起跑，鬼那 2 秒 CD 还没转完人就跑没了 */
    h.stun = Math.max(h.stun || 0, c.catchStun || 0.5);
    if (h.hp <= 0) {
      h.hp = 1;                     // 先给一点血，免得被别的逻辑当成尸体清掉
      this.hideTurnSeeker(h);
    }
    return dmg;
  };

  B.updateHide = function (dt) {
    const st = this.hide, c = C();
    if (!st) return;
    const alive = this.casualAlive();
    const seekers = alive.filter(f => f.hideRole === "seeker");
    const hiders = alive.filter(f => f.hideRole === "hider");

    /* ---- 计时器 ---- */
    if (st.searchMulT > 0) st.searchMulT = Math.max(0, st.searchMulT - dt);
    if (st.mark) {
      st.mark.t -= dt;
      const tgt = this.hero(st.mark.side);
      if (st.mark.t <= 0 || !tgt || tgt.dead || tgt.hideRole !== "hider") st.mark = null;
    }
    st.relicT -= dt;
    if (st.relicT <= 0 && !st.relic) this.hideSpawnRelic();

    /* ---- 胜负 ---- */
    if (!hiders.length && seekers.length) { this.casualWin(seekers[0], "全被抓到了！"); return; }
    if (!seekers.length && hiders.length) { this.casualWin(hiders[0], "鬼全没了！"); return; }

    /* ---- v4.13f：抓人的 CD 已经并进 J 槽（f.cd.basic），这里不再单独推进 ---- */

    /* ---- 鬼搜查柜子 / 草丛（被定住时耗时翻倍） ---- */
    const need = (c.searchNeed || 0.9) * (st.searchMulT > 0 ? (c.searchMul || 2) : 1);
    if (st.search) {
      const s = st.search, sk = s.who;
      if (!sk || sk.dead || sk.hideRole !== "seeker" || !s.prop || s.prop.dead) { st.search = null; }
      else if (Math.hypot(sk.x - s.prop.x, sk.y - s.prop.y) > (c.searchR || 64) + Math.max(s.prop.w || 40, s.prop.h || 40) / 2) {
        st.search = null;                       // 走开就中断
      } else {
        s.t += dt;
        if (s.t >= need) {
          const occ = B.hideOccupant(s.prop);
          const prop = s.prop;
          st.search = null;
          sk.searched[prop.uid] = this.t;
          if (occ && occ.hideRole === "hider") {
            /* v4.13g：**搜查只负责把人揪出来，不再当场变鬼**。
             * 用户要求「不是一碰就抓到，而是鬼用 J 打人才扣血，扣满 200 才变鬼」，
             * 所以这里只做「弹出 + 眩晕 + 现形」，伤害留给鬼自己按 J 去打。 */
            if (occ.hideProp && this.ejectLocker) this.ejectLocker(occ);
            if (occ.bushHide) { occ.bushHide = false; occ.bushFlash = 1.4; }
            FX.float(occ.x, occ.y - 92, "被搜出来了！", C_SEEK, 16);
            this.ev.push(["h", occ.x, occ.y - 92, "被搜出来了！", C_SEEK]);
            if (LD.Audio && LD.Audio.beep) LD.Audio.beep(300, 0.12, "square", 0.05);
          } else {
            FX.float(prop.x, prop.y - 60, "空的", "#94a3b8", 14);
            /* v4.13f：以前这里写死 1 = 永久拉黑，搜空过一次的柜子再也不会被搜，
             * 于是后来躲进这个柜子的人就成了「怎么抓都抓不到」。改成记时间戳 + 冷却。 */
          }
        }
      }
    }
    if (!st.search) {
      const cool = c.reSearchT == null ? 8 : c.reSearchT;
      for (const sk of seekers) {
        if (sk.dead) continue;
        let best = null, bd = Infinity, aimOk = null;
        for (const o of B.hideSpots.call(this)) {
          const at = sk.searched && sk.searched[o.uid];
          if (at != null && this.t - at < cool) continue;     // 刚搜过，先放过
          const d = Math.hypot(sk.x - o.x, sk.y - o.y);
          if (d > (c.searchR || 64) + Math.max(o.w || 40, o.h || 40) / 2) continue;
          if (o === sk.hideAim) aimOk = o;                    // 人机正赶过去的那个点优先
          if (d < bd) { bd = d; best = o; }
        }
        if (aimOk) best = aimOk;
        if (best) { st.search = { who: sk, prop: best, t: 0 }; break; }
      }
    }

    /* ---- 心跳提示：鬼靠近时给躲藏者一点方位感 ---- */
    st.hintT -= dt;
    if (st.hintT <= 0) {
      st.hintT = c.hintEvery || 6;
      for (const h of hiders) {
        let near = null, nd = Infinity;
        for (const s of seekers) {
          const d = Math.hypot(h.x - s.x, h.y - s.y);
          if (d < nd) { nd = d; near = s; }
        }
        if (!near || nd > (c.hintR || 430)) continue;
        const ang = Math.atan2(near.y - h.y, near.x - h.x);
        const k = 1 - clamp(nd / (c.hintR || 430), 0, 1);
        FX.float(h.x + Math.cos(ang) * 40, h.y - 100 + Math.sin(ang) * 20,
          k > 0.6 ? "鬼就在旁边！" : "有动静…", k > 0.6 ? C_SEEK : C_GOLD, 13 + Math.round(k * 5));
      }
    }
  };

  B.hideTimeUp = function () {
    const alive = this.casualAlive();
    const hiders = alive.filter(f => f.hideRole === "hider");
    const seekers = alive.filter(f => f.hideRole === "seeker");
    if (hiders.length) this.casualWin(hiders[0], "躲到最后了！");
    else if (seekers.length) this.casualWin(seekers[0], "全被抓到了！");
    else this.endRound(0);
  };

  /* ---------------- P 键 / 移速钩子 ---------------- */

  LD.RULE_SPD.hide = function (f) {
    const c = LD.HIDE || {};
    return f.hideRole === "seeker" ? (c.seekerMul || 1.2) : (c.hiderMul || 1);
  };
  LD.RULE_INTERACT.hide = function (f) {
    const st = this.hide, c = LD.HIDE || {};
    if (!st || !f || f.dead) return false;
    /* 唯一还挂在 P 键上的玩法专属东西：场上道具（长按蓄力）。
     * 隐匿 / 抓人都已经搬到 J 键了，P 完全交还给通用交互（钻柜子 / 开包 / 道具）。 */
    if (st.relic && !st.relic.taken && !f.chg) {
      if (Math.hypot(st.relic.x - f.x, st.relic.y - f.y) <= (c.relicR || 60) + (f.r || 16))
        return this.startCharge(f, "relic", st.relic);
    }
    return false;
  };

  LD.RULE_LABEL.hide = function (f) {
    const st = this.hide, c = LD.HIDE || {};
    if (!st || !f) return "";
    if (st.relic && !st.relic.taken
      && Math.hypot(st.relic.x - f.x, st.relic.y - f.y) <= (c.relicR || 60) + (f.r || 16)) {
      return "拾取道具（长按 " + ((LD.CHARGE && LD.CHARGE.relic && LD.CHARGE.relic.need) || 2) + " 秒）";
    }
    return "";
  };

  /* ---------------- 渲染 ---------------- */
  B.drawHide = function (ctx) {
    const st = this.hide, c = C(), w = this.world;
    if (!st) return;

    /* 搜查进度条（被定住鬼的搜查耗时翻倍，进度条自然也变慢） */
    if (st.search && st.search.who && !st.search.who.dead) {
      const s = st.search;
      const need = (c.searchNeed || 0.9) * (st.searchMulT > 0 ? (c.searchMul || 2) : 1);
      const k = clamp(s.t / need, 0, 1);
      ctx.save();
      ctx.translate(s.prop.x, s.prop.y - Math.max(s.prop.h || 40, 40) / 2 - 26);
      ctx.fillStyle = "rgba(15,23,42,.75)";
      ctx.fillRect(-30, -6, 60, 10);
      ctx.fillStyle = st.searchMulT > 0 ? "#94a3b8" : C_SEEK;
      ctx.fillRect(-28, -4, 56 * k, 6);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(st.searchMulT > 0 ? "搜得更慢了" : "搜查中", 0, -10);
      ctx.restore();
    }

    /* 场上道具 */
    if (st.relic) {
      const y = st.relic.y + Math.sin(this.t * 3 + st.relic.bob) * 4;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#1e293b";
      ctx.beginPath(); ctx.ellipse(st.relic.x, st.relic.y + 16, 20, 7, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C_RELIC;
      ctx.beginPath();
      ctx.moveTo(st.relic.x, y - 18); ctx.lineTo(st.relic.x + 15, y - 4);
      ctx.lineTo(st.relic.x + 9, y + 14); ctx.lineTo(st.relic.x - 9, y + 14);
      ctx.lineTo(st.relic.x - 15, y - 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#6b21a8"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("P", st.relic.x, y + 2);
      ctx.restore();
    }

    /* 鬼拿到道具后锁定的目标：给所有鬼画一条指向线 */
    if (st.mark) {
      const tg = this.hero(st.mark.side);
      if (tg && !tg.dead) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = C_SEEK; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
        for (const f of this.casualAlive()) {
          if (f.hideRole !== "seeker") continue;
          ctx.beginPath(); ctx.moveTo(f.x, f.y - 26); ctx.lineTo(tg.x, tg.y - 26); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = C_SEEK; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(tg.x, tg.y - 26, 34, 0, TAU); ctx.stroke();
        ctx.fillStyle = C_SEEK;
        ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText("锁定 " + st.mark.t.toFixed(1) + "s", tg.x, tg.y - 66);
        ctx.restore();
      }
    }

    /* 头顶身份标记。
     * v4.13f：**当鬼时不给任何索敌指引** —— 只在「我是躲的人 / 我是观众」时才画别人的标记。
     * 以前无条件给所有人画「躲」字样，等于把每一个藏身点直接标在地图上，
     * 玩家说的「地图在告诉我他们藏在哪」就是这个。 */
    const meH = this.hero(this.mySide == null ? 0 : this.mySide);
    const meIsSeeker = !!(meH && meH.hideRole === "seeker" && !meH.dead);
    ctx.save();
    ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const f of this.casualAlive()) {
      /* 我是鬼：只画同为鬼的同伴，躲的人一律不标（否则等于把每个藏身点标在地图上） */
      if (meIsSeeker && f !== meH && f.hideRole !== "seeker") continue;
      ctx.fillStyle = f.hideRole === "seeker" ? C_SEEK : C_HIDE;
      ctx.beginPath(); ctx.arc(f.x, f.y - 104, 4, 0, TAU); ctx.fill();
      ctx.fillText(f.hideRole === "seeker" ? "鬼" : "躲", f.x, f.y - 120);
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    const nH = this.casualAlive().filter(f => f.hideRole === "hider").length;
    ctx.fillStyle = C_GOLD;
    ctx.fillText("还有 " + nH + " 人没被抓到", w.w / 2, w.pt + 14);
    if (st.relic) {
      ctx.font = "13px system-ui,'Microsoft YaHei',sans-serif";
      ctx.fillStyle = C_RELIC;
      ctx.fillText("场上有道具！靠近按住 P 蓄力 2 秒", w.w / 2, w.pt + 34);
    } else {
      ctx.font = "13px system-ui,'Microsoft YaHei',sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("下一件道具 " + Math.max(0, st.relicT).toFixed(0) + "s", w.w / 2, w.pt + 34);
    }
    ctx.restore();
  };

  /* ---------------- 人机 ----------------
   * 躲藏者这条线 v4.13 重写过：原来「只在鬼 460 内才躲」，
   * 而且安全分支走到柜子边只会站着发呆（柜子必须按 P 才钻得进去），
   * 于是人机永远进不去柜子、全挤在草丛外面。现在：
   *   - 任何时候都保持一个藏身目标（不再有「安全就站着」的分支）
   *   - 走进藏身点**内部**才停，柜子就按 P 钻进去、草丛就站到中心
   *   - 选点时扣掉「队友已经盯上的点」，避免几个 AI 扎堆 */
  LD.casualAI.hide = function (f, dt, ctrl) {
    const c = LD.HIDE || {};
    ctrl.press = ctrl.press || {};
    const st = B.hide;
    if (!st) { ctrl.mx = 0; ctrl.my = 0; return; }
    const w = B.world;
    const alive = B.casualAlive();
    const seekers = alive.filter(o => o.hideRole === "seeker" && !o.dead);

    /* 场上有道具且离得不远 → 先去拿（按下 P 就会开始蓄力，蓄力期间自动站定）。
     * v4.13f：搜索半径从 340 收到 aiRelicR（默认 170）——以前人机会为了一个道具
     * 从大半个地图外跑过来，一局拿三四次，每次都把鬼定身 10 秒（实测鬼有 40% 的时间在罚站），
     * 于是怎么都抓不到人。现在只在顺路时捡。 */
    const relic = st.relic;
    if (relic && !relic.taken && !f.chg && !f.hideProp) {
      const dr = Math.hypot(relic.x - f.x, relic.y - f.y);
      if (dr < (c.relicR || 60)) { ctrl.press.interact = true; ctrl.mx = 0; ctrl.my = 0; return; }
      if (dr < (c.aiRelicR || 170)) {
        const s = LD.AI.steer(f, relic.x - f.x, relic.y - f.y, null);
        ctrl.mx = s.x; ctrl.my = s.y;
        return;
      }
    }

    /* ---------- 鬼 ---------- */
    if (f.hideRole === "seeker") {
      const catchR2 = c.catchR2 || 88;
      const canCatch = ((f.cd && f.cd.basic) || 0) <= 0;
      /* v4.13f：**先索敌、再决定站不站定**。
       * 以前「正在搜查 → 立刻 return」写在最前面，导致搜查那 0.9 秒里鬼完全看不见人，
       * 人机躲藏者趁机溜出去按 J 隐匿，鬼就永远处在「刚看见 → 又丢了」的循环里。 */
      let tgt = null, td = Infinity;
      for (const h of alive) {
        if (h.hideRole !== "hider" || h.dead) continue;
        if (h.hideProp || h.bushHide) continue;
        if (h.stealthT > 0) continue;
        const d = Math.hypot(h.x - f.x, h.y - f.y);
        if (d < td) { td = d; tgt = h; }
      }
      /* 「刚刚看见的人」记 2.6 秒：对方按下隐匿、屏幕上看不见了，鬼也会朝他消失的位置再扑一下。
       * 抓人判定本身不看在不在隐匿（只看距离），所以这一扑经常真的抓得到。 */
      const memT = c.aiMemT == null ? 2.6 : c.aiMemT;
      if (tgt) {
        f.hideMem = { x: tgt.x, y: tgt.y, side: tgt.side };
        f.hideMemT = memT;
      } else if (f.hideMemT > 0) {
        f.hideMemT = Math.max(0, f.hideMemT - dt);
        if (f.hideMemT <= 0) f.hideMem = null;
      }
      const mem = (!tgt && f.hideMem && f.hideMemT > 0) ? f.hideMem : null;

      /* 正在搜查这个柜子 / 草丛：站定读条。若记忆里的目标就贴在手边，直接按 J 揪出来
       * （这就是玩家说的「我明明知道他在哪，怎么抓都没用」——现在知道了就能抓）。 */
      if (st.search && st.search.who === f) {
        ctrl.mx = 0; ctrl.my = 0;
        if (canCatch && mem && Math.hypot(mem.x - f.x, mem.y - f.y) <= catchR2) ctrl.press.basic = true;
        return;
      }
      /* 被锁定了就直奔被锁住的人 */
      if (st.mark && st.mark.side != null) {
        const tg = B.hero(st.mark.side);
        if (tg && !tg.dead) {
          const s = LD.AI.steer(f, tg.x - f.x, tg.y - f.y, null);
          ctrl.mx = s.x; ctrl.my = s.y;
          if (canCatch && Math.hypot(tg.x - f.x, tg.y - f.y) <= catchR2 * 0.8) ctrl.press.basic = true;
          if (Math.hypot(tg.x - f.x, tg.y - f.y) < (c.catchR || 46)) return;
        }
      }
      /* v4.13f 看见人了 / 还记得人在哪：进入抓人距离就按 J 抓 */
      const aimed = tgt || mem;
      if (aimed) {
        const dx = aimed.x - f.x, dy = aimed.y - f.y, d = Math.hypot(dx, dy) || 1;
        const s = LD.AI.steer(f, dx / d, dy / d, null);
        ctrl.mx = s.x; ctrl.my = s.y;
        if (canCatch && d <= catchR2) { ctrl.mx = 0; ctrl.my = 0; ctrl.press.basic = true; }
        if (d < (c.catchR || 46)) return;
        return;
      }
      let tx, ty;
      {
        /* 没看见人 → 去下一个还能搜的藏身点（几个鬼分头搜，别扎堆）
         * v4.13f：searched 存的是时间戳，超过 reSearchT 的点会重新变回候选 */
        f.hideAimT = (f.hideAimT || 0) - dt;
        /* v4.13f：**走不到就要学会放弃**。以前鬼会对着被障碍挡住的藏身点左右摇摆一整局
         * （实测 120 秒 0 次抓人），现在 2.5 秒内距离没缩短 18px 就把这个点当「搜过了」放过。 */
        if (f.hideAim) {
          const dNow = Math.hypot(f.hideAim.x - f.x, f.hideAim.y - f.y);
          if (f._aimD == null || dNow < f._aimD - 18) { f._aimD = dNow; f._aimT = 0; }
          else {
            f._aimT = (f._aimT || 0) + dt;
            if (f._aimT > 2.5) {
              if (f.searched) f.searched[f.hideAim.uid] = B.t;
              f.hideAim = null; f._aimD = null; f._aimT = 0;
            }
          }
        }
        const cool = c.reSearchT == null ? 8 : c.reSearchT;
        /* v4.13g：AI 鬼的「直觉」。
         * 藏点翻倍 + 人机躲藏者专挑离鬼远的点，实测 1 个鬼 120 秒搜 70 次只揪出 2 个人
         * （几乎全是空气），整局抓不到人。这里给鬼一点点线索感：
         * 每隔 aiSniffCd 秒，允许它「闻到」aiSniffR 内最近的有人的藏点，直奔过去搜。
         * 只是给个方向，不是瞬移、也不是立刻抓到 —— 到了还得老老实实读条 + J 打两下。 */
        if (B.t - (f.hideSniffT || -99) > (c.aiSniffCd || 12)) {
          let sniff = null, sd = c.aiSniffR || 520;
          for (const o of B.hideSpots.call(B)) {
            const occ = B.hideOccupant(o);
            if (!occ || occ.hideRole !== "hider" || occ.dead) continue;
            const d = Math.hypot(o.x - f.x, o.y - f.y);
            if (d < sd) { sd = d; sniff = o; }
          }
          if (sniff) {
            f.hideSniffT = B.t;
            f.hideAim = sniff; f.hideAimT = 8;
            f._aimD = null; f._aimT = 0;
            if (f.searched) delete f.searched[sniff.uid];   // 让这个点重新变成「可搜」
          }
        }
        const spots = B.hideSpots().filter(o => {
          const at = f.searched && f.searched[o.uid];
          return at == null || B.t - at >= cool;
        });
        /* v4.13f：**先搜没搜过的点**。
         * 以前只按「最近」排序，冷却一过最近的点又变回候选，于是鬼在一个小片区里
         * 反复搜同 13 个柜子（实测 120 秒只覆盖 13/28 个藏点），人躲在别处永远碰不上。
         * 现在只要场上还有没搜过的点，就一律优先那些；全搜完了才回头重搜。 */
        const un = spots.filter(o => !(f.searched && f.searched[o.uid] != null));
        const pool = un.length ? un : spots;
        if (!f.hideAim || f.hideAim.dead || f.hideAimT <= 0 || pool.indexOf(f.hideAim) < 0) {
          const mates = seekers.filter(o => o !== f);
          let best = null, bs = -Infinity;
          pool.forEach(o => {
            const d = Math.hypot(o.x - f.x, o.y - f.y);
            let taken = 0;
            mates.forEach(m => { if (m.hideAim === o) taken = 1; });
            const score = -d - taken * 400;
            if (score > bs) { bs = score; best = o; }
          });
          f.hideAim = best || (pool.length ? pool[(Math.random() * pool.length) | 0] : null);
          f.hideAimT = 6;
          f._aimD = null; f._aimT = 0;      /* 换了目标 → 放弃计时重新开始 */
        }
        if (f.hideAim) { tx = f.hideAim.x; ty = f.hideAim.y; }
        else { tx = rnd(120, w.w - 120); ty = rnd(w.pt + 90, w.h - 90); }
      }
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
      const s = LD.AI.steer(f, dx / d, dy / d, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      return;
    }

    /* ---------- 躲藏者 ---------- */
    /* 已经在柜子里：鬼来搜的时候**掷一次骰子**决定夺门而出还是赌他搜不到。
     * v4.13f 之前这里是「搜查一开始就按 P 溜出去」，于是鬼的每一次搜查都只能搜到空气，
     * 整局 0 次抓人。现在：
     *   - aiBail 的概率下，读条过半才冲出去（玩家能看见柜子开了、人跑出来，追上去按 J 就抓）
     *   - 剩下的时候老实蹲着，读条走完就被揪出来
     * 这样「搜到人」和「人跑了」都会发生，而不是永远搜空气。 */
    const bail = (sp) => {
      const s = B.hide.search;
      if (!s || !s.who || s.who.dead || !sp || s.prop !== sp) { f._bailSearch = null; return 0; }
      if (Math.hypot(s.who.x - f.x, s.who.y - f.y) >= 240) return 0;
      if (f._bailSearch !== s) {
        f._bailSearch = s;
        f._bailRoll = Math.random() < (c.aiBail == null ? 0.55 : c.aiBail);
      }
      return (f._bailRoll && s.t > (c.searchNeed || 0.9) * 0.5) ? 1 : 0;
    };
    if (f.hideProp) {
      if (bail(f.hideProp)) ctrl.press.interact = true;   // 快被翻到了！夺门而出
      else { ctrl.mx = 0; ctrl.my = 0; }
      return;
    }
    /* 已经猫进草丛：同理，蹲到读条过半才起身换地方 */
    if (f.bushHide) {
      const s = B.hide.search;
      /* 必须是「我正在蹲的这一丛」，不能是隔壁那丛被搜就跟着跑 */
      const inThis = s && s.prop && s.prop.kind === "bush"
        && Math.abs(f.x - s.prop.x) < (s.prop.w || 80) / 2 + 8
        && Math.abs(f.y - s.prop.y) < (s.prop.h || 80) / 2 + 8;
      if (!(inThis && bail(s.prop))) { ctrl.mx = 0; ctrl.my = 0; return; }
      /* 起身换地方（下面的选点逻辑接管） */
    }

    /* v4.13f 鬼逼到脸上：按 J 用「隐匿」脱离（J 现在是躲藏者的隐匿键）。
     * 触发距离从 320 收到 150：以前隔着大半个屏幕就把隐匿交了，鬼连影子都没看见，
     * 于是「人机永远抓不到」；现在改成贴到抓人范围边上才用，是真正的临门一脚。 */
    if (((f.cd && f.cd.basic) || 0) <= 0 && !(f.stealthT > 0)) {
      let nd = Infinity;
      for (const s of seekers) nd = Math.min(nd, Math.hypot(s.x - f.x, s.y - f.y));
      if (nd < (c.aiStealthR || 150)) ctrl.press.basic = true;
    }

    /* 选一个藏身点：离鬼越远越好、离自己越近越好、别人盯上的点要让开 */
    f.hideAimT = (f.hideAimT || 0) - dt;
    /* 刚被从柜子里揪出来（noHideT > 0）时柜子钻不进去，先别锁柜子当目标 */
    const spots = B.hideSpots().filter(o => !(o.kind === "locker" && (o.occupant || (f.noHideT || 0) > 0)));
    const bad = f.hideAim == null || f.hideAim.dead || spots.indexOf(f.hideAim) < 0;
    /* 选一个藏身点：离鬼越远越好、离自己越近越好、别人盯上的点要让开。
     * v4.13f：**蹲住别乱跑**——以前每 4~9 秒就换一次点，人机整局都在路上走，
     * 鬼照着藏点挨个搜反而永远搜到空气（实测 80 次搜查 0 次落空）。
     * 现在蹲 12~20 秒，只有鬼真的贴到 aiPanicR（120）以内才挪窝。
     * 240 太敏感：鬼还在半路，人机就先跑了，鬼挨个搜藏点永远搜的是空柜子。 */
    let nearSk = null, ndSk = Infinity;
    for (const s of seekers) {
      const d = Math.hypot(f.x - s.x, f.y - s.y);
      if (d < ndSk) { ndSk = d; nearSk = s; }
    }
    f._nervT = Math.max(0, (f._nervT || 0) - dt);
    if (bad || f.hideAimT <= 0 || (ndSk < (c.aiPanicR || 120) && f._nervT <= 0)) {
      const near = nearSk;
      let best = null, bs = -Infinity;
      for (const o of spots) {
        const dSelf = Math.hypot(o.x - f.x, o.y - f.y);
        const dSeeker = near ? Math.hypot(o.x - near.x, o.y - near.y) : 900;
        let taken = 0;
        for (const m of alive) if (m !== f && m.hideRole === "hider" && m.hideAim === o) taken = 1;
        const score = dSeeker - dSelf * 0.55 - taken * 420 + rnd(0, 150);
        if (score > bs) { bs = score; best = o; }
      }
      f.hideAim = best;
      f.hideAimT = rnd(12, 20);
      if (ndSk < (c.aiPanicR || 120)) f._nervT = 4;   // 被吓到换点之后，别每帧都重新选（会原地抖）
    }

    /* 走到藏身点：
     *  - 柜子：**柜子是 blockMove 的，人永远走不进去**，只能停在交互距离上按 P。
     *    之前这里写的是「走进柜子内部才算到位」，inside 永远为 false，
     *    于是人机贴着柜子站一辈子、P 键一次都不按——就是「AI 全漏在柜子外面」那个 BUG。
     *  - 草丛：soft，直接走进中心就自动伪装。 */
    const o = f.hideAim;
    if (!o) {
      /* 一个藏身点都没有：往离鬼最远的方向跑 */
      let ax = 0, ay = 0;
      for (const s of seekers) {
        const dx = f.x - s.x, dy = f.y - s.y, d = Math.hypot(dx, dy) || 1;
        ax += dx / d / d * 400; ay += dy / d / d * 400;
      }
      if (!seekers.length) { ax = rnd(-1, 1); ay = rnd(-1, 1); }
      const s = LD.AI.steer(f, ax, ay, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      return;
    }

    if (o.kind === "locker") {
      const lim = (LD.INTERACT && LD.INTERACT.range) || 26;
      const ow = o.w || 40, oh = o.h || 40;
      const nx = Math.max(o.x - ow / 2, Math.min(o.x + ow / 2, f.x));
      const ny = Math.max(o.y - oh / 2, Math.min(o.y + oh / 2, f.y));
      const gap = Math.hypot(f.x - nx, f.y - ny);
      if (gap <= lim - 3) {
        ctrl.mx = 0; ctrl.my = 0;
        ctrl.press.interact = true;              // 到边上就按 P 钻进去
        return;
      }
      const s = LD.AI.steer(f, o.x - f.x, o.y - f.y, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      return;
    }

    /* 草丛：站进中心就算藏好 */
    const hw = (o.w || 80) * 0.5 - 10, hh = (o.h || 80) * 0.5 - 10;
    const inside = Math.abs(f.x - o.x) < Math.max(14, hw) && Math.abs(f.y - o.y) < Math.max(14, hh);
    if (!inside) {
      const s = LD.AI.steer(f, o.x - f.x, o.y - f.y, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      return;
    }
    ctrl.mx = 0; ctrl.my = 0;
  };
})(window.LD = window.LD || {});
