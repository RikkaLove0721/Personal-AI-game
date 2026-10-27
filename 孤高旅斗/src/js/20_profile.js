/* ============================================================
 *  20_profile.js — 存档（金币 / 部件 / 技能 / 关卡进度）
 *  本机窗口模式（exe，?app=1）下存档同时写入服务器侧 profile.json，
 *  即使端口漂移导致 localStorage 换了 origin 也不会丢档。
 * ============================================================ */
(function (LD) {
  "use strict";
  const KEY = "ld_profile_v3";
  const APP_MODE = (function () {
    try { return /[?&]app=1/.test(location.search); } catch (e) { return false; }
  })();
  let pushTimer = null;

  function fresh() {
    return {
      rev: 0,                              // 存档修订号：本地与文件比新用
      coins: 0,
      name: "",                            // 玩家名字（空 = 显示「勇者」）
      ownedParts: [LD.FREE.head, LD.FREE.upper, LD.FREE.lower],
      ownedSkills: ["slash", "fireball"],  // 新档只解锁：斩击 + 火球，其余靠金币购买
      equip: { head: LD.FREE.head, upper: LD.FREE.upper, lower: LD.FREE.lower },
      loadout: Object.assign({}, LD.DEFAULT_LOADOUT),
      progress: {},                        // "1_normal": true
      cheat: 0,
      aiLoadout: null,                     // 自定义的电脑对手配装
      bgmOn: true,                         // 背景音乐开关（主菜单右上角可切换）
      /* v4.19：新手教程是否通关过。没通关时主菜单第一行显示「新手教程」，
       * 通关后恢复成「单人游戏」，教程挪进单人菜单里（可重复挑战，只给 5 金币）。 */
      tutDone: false,
      stats: { kills: 0, wins: 0, losses: 0, bossWins: 0, relayWins: 0, huntWins: 0, dailyWins: 0, coinsEarned: 0,
               warmupWins: 0, zombieKills: 0, modeWins: {} },   // v2.6 累计战绩（v2.8 增补 modeWins 各模式胜场）
      ach: {},                             // v2.6 已解锁成就 { id: true }
      title: "",                           // v2.6 当前佩戴的称号
      daily: {}                            // v2.6 每日挑战 { "2026-09-21": 最快秒数 }
    };
  }

  function merge(o) {
    const base = fresh();
    const d = Object.assign(base, o);
    d.equip = Object.assign(fresh().equip, o.equip || {});
    d.loadout = Object.assign(fresh().loadout, o.loadout || {});
    d.progress = o.progress || {};
    d.ownedParts = Array.isArray(o.ownedParts) ? o.ownedParts : base.ownedParts;
    d.ownedSkills = Array.isArray(o.ownedSkills) ? o.ownedSkills : base.ownedSkills;
    d.stats = Object.assign(fresh().stats, o.stats || {});
    /* v2.8：各模式胜场统一收进 stats.modeWins；旧档的 relayWins / huntWins / warmupWins
     * 一次性迁移过来（取两者较大值），避免老玩家的称号进度被清零。 */
    const mm = d.stats.modeWins = Object.assign({}, o.stats && o.stats.modeWins);
    [["relay", "relayWins"], ["hunt", "huntWins"], ["warmup", "warmupWins"]].forEach(pair => {
      const v = (o.stats && o.stats[pair[1]]) || 0;
      if (v > (mm[pair[0]] || 0)) mm[pair[0]] = v;
    });
    d.tutDone = !!o.tutDone;
    d.ach = o.ach || {};
    d.title = o.title || "";
    d.daily = o.daily || {};
    return d;
  }

  const Prof = {
    d: fresh(),
    appMode: APP_MODE,

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) this.d = merge(JSON.parse(raw));
      } catch (e) { this.d = fresh(); }
      // 数据自检：清掉已不存在的 id
      this.d.ownedParts = this.d.ownedParts.filter(id => LD.part(id));
      this.d.ownedSkills = this.d.ownedSkills.filter(id => LD.skill(id));
      ["head", "upper", "lower"].forEach(k => {
        if (!this.ownsPart(this.d.equip[k])) this.d.equip[k] = LD.FREE[k];
      });
      /* v2.1 起新档只送斩击 + 火球；旧档已有的一切保留，仅补齐这两件基础普攻 */
      ["slash", "fireball"].forEach(id => { if (this.d.ownedSkills.indexOf(id) < 0) this.d.ownedSkills.push(id); });
      /* v2.0 迁移：格挡从「技能」改成「普攻」，旧档放在 K/L 的格挡自动挪到 J 槽，
       * 避免玩家升级后发现技能槽莫名空掉。 */
      const lo = this.d.loadout;
      if (lo.skill1 === "parry" || lo.skill2 === "parry") {
        if (lo.skill1 === "parry") lo.skill1 = null;
        if (lo.skill2 === "parry") lo.skill2 = null;
        if (!lo.basic || lo.basic === "slash") lo.basic = "parry";
      }
      /* 数据自检：槽位与技能类型对不上的（例如版本改过分类）一律清掉 */
      ["basic", "skill1", "skill2", "ult"].forEach(k => {
        if (!lo[k]) return;
        const s = LD.skill(lo[k]);
        if (!s || s.kind !== this.slotKind(k)) lo[k] = null;
      });
      return this.d;
    },

    /* exe 模式：启动后与服务器侧 profile.json 对账，新者胜 */
    syncServer() {
      if (!APP_MODE) return;
      const self = this;
      try {
        fetch("/api/profile", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(o => {
          if (o && (o.rev || 0) > (self.d.rev || 0)) {
            self.d = merge(o);
            self.d.ownedParts = self.d.ownedParts.filter(id => LD.part(id));
            self.d.ownedSkills = self.d.ownedSkills.filter(id => LD.skill(id));
            try { localStorage.setItem(KEY, JSON.stringify(self.d)); } catch (e) {}
            /* v4.28：整档被换掉之后，屏幕上按「旧档 / 空档」画好的东西必须重刷。
             * 最典型的就是主菜单第一行：exe 换了端口 → localStorage 换了 origin →
             * 本地是空档（tutDone=false，标题画成「新手教程」），几百毫秒后服务器档案
             * 盖回来（已通关），标题却还停在旧值 —— 点进去分明是单人菜单。
             * 金币数、教程卡片也是同一个毛病，一起刷。 */
            self.refreshUI();
          } else if (o == null || (o.rev || 0) < (self.d.rev || 0)) {
            self.push();                       // 本地更新 → 回写到文件
          }
        }).catch(() => {});
      } catch (e) {}
    },

    push() {
      if (!APP_MODE) return;
      try {
        fetch("/api/profile", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.d) }).catch(() => {});
      } catch (e) {}
    },

    save() {
      this.d.rev = (this.d.rev || 0) + 1;
      try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) {}
      if (APP_MODE) {                          // 合并短时间内的连续存档请求
        clearTimeout(pushTimer);
        const self = this;
        pushTimer = setTimeout(() => self.push(), 350);
      }
    },

    /* 存档被**整档替换**之后用：把「进界面时只画一次」的读数全部重刷一遍。
     * 目前只有 syncServer 会整档替换（本地空档 → 服务器档案），
     * 但任何一个字段都可能已经变了，所以金币 / 主菜单入口 / 教程卡片一起刷。
     * 各渲染函数对空元素都有保护，界面上没那块也不会炸。 */
    refreshUI() {
      const UI = LD.UI;
      if (!UI) return;
      try { if (UI.updateHud) UI.updateHud(); } catch (e) {}
      try { if (UI.coins) UI.coins(); } catch (e) {}
      try { if (UI.renderMenuEntry) UI.renderMenuEntry(); } catch (e) {}
      try { if (UI.renderTutCard) UI.renderTutCard(); } catch (e) {}
    },
    get coins() { return this.d.coins; },
    displayName() {
      const t = this.d.title && LD.TITLES ? LD.TITLES.find(x => x.id === this.d.title) : null;
      return (t ? "「" + t.name + "」" : "") + (this.d.name || "勇者");
    },
    rename(n) {
      n = String(n || "").trim().slice(0, 8);
      if (!n) return { ok: false, why: "名字不能为空" };
      this.d.name = n; this.save();
      return { ok: true, name: n };
    },

    addCoins(n) {
      this.d.coins = Math.max(0, this.d.coins + n);
      if (n > 0) { this.stat("coinsEarned", n); this.checkAch(); }   // v2.6：成就需要累计获得金币
      this.save();
      return this.d.coins;
    },
    spend(n) { if (this.d.coins < n) return false; this.d.coins -= n; this.save(); return true; },

    /* ---------------- 部件 ---------------- */
    ownsPart(id) { return this.d.ownedParts.indexOf(id) >= 0; },
    buyPart(id) {
      const p = LD.part(id);
      if (!p || this.ownsPart(id)) return { ok: false, why: "已拥有" };
      if (this.d.coins < p.price) return { ok: false, why: "金币不足" };
      this.spend(p.price);
      this.d.ownedParts.push(id);
      this.equipPart(id);                       // 买完直接穿上
      this.save();
      return { ok: true };
    },
    equipPart(id) {
      const p = LD.part(id);
      if (!p || !this.ownsPart(id)) return false;
      this.d.equip[p.part] = id; this.save(); return true;
    },

    /* ---------------- 套装（v2.8 图片皮肤） ---------------- */
    ownsSuit(id) {
      const s = LD.suit(id);
      if (!s) return false;
      const self = this;
      return Object.keys(s.pieces).every(k => self.ownsPart(s.pieces[k]));
    },
    buySuit(id) {
      const s = LD.suit(id);
      if (!s) return { ok: false, why: "没有这个套装" };
      if (this.ownsSuit(id)) return { ok: false, why: "已拥有" };
      if (this.d.coins < s.price) return { ok: false, why: "金币不足" };
      this.spend(s.price);
      const self = this;
      Object.keys(s.pieces).forEach(k => {
        if (!self.ownsPart(s.pieces[k])) self.d.ownedParts.push(s.pieces[k]);
      });
      this.equipSuit(id);                        // 买完整套直接穿上
      this.save();
      return { ok: true };
    },
    equipSuit(id) {
      const s = LD.suit(id);
      if (!s || !this.ownsSuit(id)) return false;
      const self = this;
      Object.keys(s.pieces).forEach(k => { self.d.equip[k] = s.pieces[k]; });
      this.save(); return true;
    },

    /* ---------------- 技能 ---------------- */
    ownsSkill(id) { return this.d.ownedSkills.indexOf(id) >= 0; },
    buySkill(id) {
      const s = LD.skill(id);
      if (!s || this.ownsSkill(id)) return { ok: false, why: "已拥有" };
      if (this.d.coins < s.price) return { ok: false, why: "金币不足" };
      this.spend(s.price);
      this.d.ownedSkills.push(id);
      this.save();
      return { ok: true };
    },
    // slot: "basic" | "skill1" | "skill2" | "ult"
    slotKind(slot) { return slot === "basic" ? "basic" : slot === "ult" ? "ult" : "skill"; },
    equipSkill(slot, id) {
      const lo = this.d.loadout;
      if (!id) { lo[slot] = null; this.save(); return { ok: true }; }
      const s = LD.skill(id);
      if (!s) return { ok: false, why: "技能不存在" };
      if (!this.ownsSkill(id)) return { ok: false, why: "尚未购买" };
      if (s.kind !== this.slotKind(slot)) return { ok: false, why: "槽位不匹配" };
      // 同一技能不能占两个槽
      ["basic", "skill1", "skill2", "ult"].forEach(k => { if (k !== slot && lo[k] === id) lo[k] = null; });
      lo[slot] = id; this.save();
      return { ok: true };
    },
    findSlotOf(id) {
      const lo = this.d.loadout;
      return ["basic", "skill1", "skill2", "ult"].find(k => lo[k] === id) || null;
    },

    /* ---------------- 关卡进度 ---------------- */
    cleared(lvId, diff) { return !!this.d.progress[lvId + "_" + diff]; },
    clear(lvId, diff, reward) {
      const k = lvId + "_" + diff;
      const first = !this.d.progress[k];
      this.d.progress[k] = true;
      if (reward) this.addCoins(reward); else this.save();
      return first;
    },

    cheatCoins() { this.d.cheat++; this.addCoins(10); return this.d.coins; },

    /* ---------------- v2.6 成就 / 称号 / 每日挑战 / 累计战绩 ---------------- */
    stat(k, n) {
      if (!this.d.stats) this.d.stats = {};
      if (n != null) { this.d.stats[k] = (this.d.stats[k] || 0) + n; this.save(); }
      return this.d.stats[k] || 0;
    },
    /* 战斗结算入口：win=是否获胜，kind=dragon|duel|net；rule 供特殊模式计数 */
    battleEnd(win, kind, rule) {
      const st = this.d.stats;
      if (!st.modeWins) st.modeWins = {};
      if (win) st.wins++; else st.losses++;
      if (kind === "dragon" && win) st.bossWins++;
      /* v2.8：按模式记胜场（闯关不计模式；未知 rule 用 ruleInfo 兜底校验，防止脏数据写进表） */
      if (win && kind !== "dragon" && rule && LD.ruleInfo(rule).id === rule) {
        st.modeWins[rule] = (st.modeWins[rule] || 0) + 1;
      }
      if (rule === "relay" && win) st.relayWins++;
      if (rule === "hunt" && win) st.huntWins++;
      if (rule === "warmup" && win) st.warmupWins++;
      this.checkAch();
      this.save();
    },
    achUnlocked(id) { return !!this.d.ach[id]; },
    /* 逐条检查成就条件，返回本次新解锁的成就数组 */
    checkAch() {
      const d = this.d, st = d.stats, got = [];
      (LD.ACHIEVEMENTS || []).forEach(a => {
        if (d.ach[a.id]) return;
        if (a.cond(d, st)) { d.ach[a.id] = true; got.push(a); }
      });
      return got;
    },
    setTitle(id) {
      const t = LD.TITLES ? LD.TITLES.find(x => x.id === id) : null;
      if (t && !this.achUnlocked(t.ach)) return false;
      this.d.title = id || ""; this.save(); return true;
    },
    dailyKey() {
      const now = new Date();
      return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    },
    dailyBest() { return this.d.daily[this.dailyKey()] || null; },
    setDailyBest(sec) {
      const k = this.dailyKey(), best = this.d.daily[k];
      if (best == null || sec < best) { this.d.daily[k] = sec; this.save(); return true; }
      return false;
    },

    /* ---------------- 外观读取（绘制用） ---------------- */
    look() {
      const e = this.d.equip;
      const h = LD.part(e.head) || LD.part(LD.FREE.head);
      const u = LD.part(e.upper) || LD.part(LD.FREE.upper);
      const l = LD.part(e.lower) || LD.part(LD.FREE.lower);
      return {
        head: { model: h.model, c1: h.c1, c2: h.c2, c3: h.c3, img: h.img },
        upper: { c1: u.c1, c2: u.c2, img: u.img },
        lower: { c1: l.c1, c2: l.c2, img: l.img }
      };
    }
  };

  LD.Profile = Prof;
})(window.LD = window.LD || {});
