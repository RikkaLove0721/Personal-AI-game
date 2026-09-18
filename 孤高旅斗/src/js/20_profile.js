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
      ownedParts: [LD.FREE.head, LD.FREE.upper, LD.FREE.lower],
      ownedSkills: ["slash", "parry"],     // 默认普攻斩击 + 技能格挡
      equip: { head: LD.FREE.head, upper: LD.FREE.upper, lower: LD.FREE.lower },
      loadout: Object.assign({}, LD.DEFAULT_LOADOUT),
      progress: {},                        // "1_normal": true
      cheat: 0,
      aiLoadout: null                      // 自定义的电脑对手配装
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
      ["slash", "parry"].forEach(id => { if (this.d.ownedSkills.indexOf(id) < 0) this.d.ownedSkills.push(id); });
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
            if (LD.UI && LD.UI.updateHud) LD.UI.updateHud();
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
    get coins() { return this.d.coins; },

    addCoins(n) { this.d.coins = Math.max(0, this.d.coins + n); this.save(); return this.d.coins; },
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

    /* ---------------- 外观读取（绘制用） ---------------- */
    look() {
      const e = this.d.equip;
      const h = LD.part(e.head) || LD.part(LD.FREE.head);
      const u = LD.part(e.upper) || LD.part(LD.FREE.upper);
      const l = LD.part(e.lower) || LD.part(LD.FREE.lower);
      return {
        head: { model: h.model, c1: h.c1, c2: h.c2, c3: h.c3 },
        upper: { c1: u.c1, c2: u.c2 },
        lower: { c1: l.c1, c2: l.c2 }
      };
    }
  };

  LD.Profile = Prof;
})(window.LD = window.LD || {});
