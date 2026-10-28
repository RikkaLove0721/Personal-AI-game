/* ============================================================
 *  69_grow.js — v4.32 成长任务卡
 *
 *  新手教程教的是「怎么打」，教完就结束了 —— 但一个刚通关的新人
 *  仍然站在主菜单上发愣：皮肤商店里那些套装怎么买？技能怎么装到
 *  K 和 L 上？勇者格斗那个房间是干嘛的？
 *
 *  这一批把这三件事做成主菜单左下角的三行小卡：
 *  做完一项自动打勾 + 10 金币，点那一行直接跳到对应界面。
 *
 *  为什么不做成「教程第二步」（强制教学）：
 *  刚打完九步的人最想干的是自己开一局，不是再被按着头点三个菜单。
 *  做成常驻小卡，什么时候想做都行，不打断任何流程。
 *
 *  为什么不轮询存档判断「买过没有」：
 *  轮询分不出「本来就有」和「刚刚做的」。老玩家一进游戏，三条早就
 *  该做的事全亮成未完成 —— 那不是在引导，是在骂人。所以完成状态
 *  必须由**事件**推进（买成功 / 装成功 / 开局成功），旧档另行走一遍
 *  资产反推（见 20_profile.js 的 growOf）。
 * ============================================================ */
(function (LD) {
  "use strict";

  const REWARD = 10;

  /* 三条任务的顺序就是新手最自然的动线：
   * 先花钱（皮肤）→ 再改战斗手感（技能）→ 最后进场（房间）。 */
  const DEF = [
    { key: "shop",  name: "买一套皮肤", sub: "皮肤商店 · 挑一套穿上" },
    { key: "skill", name: "装一个技能", sub: "技能商店 · J / K / L / O 四个槽" },
    { key: "room",  name: "开一局房间", sub: "勇者格斗 · 挑个模式开打" }
  ];

  const Grow = LD.Grow = {
    REWARD: REWARD,
    DEF: DEF,

    /* 存档里没有这个字段时按空档处理（正常情况 merge 已经补齐） */
    box() {
      const d = LD.Profile.d;
      if (!d.grow || typeof d.grow !== "object") d.grow = { shop: 0, skill: 0, room: 0 };
      return d.grow;
    },

    done(key) { return !!this.box()[key]; },
    count() { const self = this; return DEF.filter(x => self.done(x.key)).length; },
    allDone() { return this.count() >= DEF.length; },

    /* 卡片要不要出现在主菜单：两头都不出现。
     *
     * 教程没过之前 —— 那时主菜单第一行本来就是「新手教程」，玩家还没有
     * 「该去逛逛」的语境，三条任务一起糊上去只会让人更不知道先点哪个。
     *
     * 三条做完之后 —— 它的全部意义就是提醒新手「还有这些没试过」。活干完
     * 了还赖在主菜单上，就成了一句永久占着左下角的废话；何况那儿本来就
     * 是插画的地盘。所以做完即退休，不再回来（进度记在存档里，不会因为
     * 消失而重来）。 */
    visible() { return !!LD.Profile.d.tutDone && !this.allDone(); },

    /* 完成一项。重复调用 / 未知 key 都直接返回 false，不发钱。
     * 返回 true 表示「这一次真的完成了」。 */
    hit(key) {
      if (!DEF.some(x => x.key === key)) return false;
      const P = LD.Profile;
      const g = this.box();
      if (g[key]) return false;
      g[key] = 1;
      /* addCoins 内部会 save（含 exe 侧回写），不要在外面再存一次 */
      P.addCoins(REWARD);
      if (LD.Audio && LD.Audio.buy) LD.Audio.buy();
      const name = (DEF.find(x => x.key === key) || {}).name || key;
      if (LD.UI && LD.UI.toast) {
        LD.UI.toast("成长任务 · " + name + "　+" + REWARD + " 金币", true, 2200);
      }
      if (LD.UI) {
        try { if (LD.UI.coins) LD.UI.coins(); } catch (e) {}
        try { if (LD.UI.renderGrow) LD.UI.renderGrow(); } catch (e) {}
      }
      if (this.allDone() && LD.UI && LD.UI.toast) {
        /* 三条全绿只说一句，不弹面板 —— 玩家此刻多半在商店或房间里，
         * 拦住他去路只为报个喜，反而烦。
         * 末尾点明「卡片已收起」：不然回到主菜单发现左下角空了，
         * 第一反应是这卡坏了，而不是它功成身退。 */
        setTimeout(() => {
          try {
            LD.UI.toast("成长任务全部完成　共 " + (REWARD * DEF.length) + " 金币　卡片已收起", true, 2600);
          } catch (e) {}
        }, 900);
      }
      return true;
    },

    /* 点任务行 → 跳到对应界面。缺哪个界面就静默不动（老版本产物里没这些页）。 */
    go(key) {
      const UI = LD.UI;
      if (!UI) return false;
      if (LD.Audio && LD.Audio.ui) LD.Audio.ui();
      if (key === "shop") { UI.skinTab = "suit"; UI.show("ovSkin"); return true; }
      if (key === "skill") { UI.show("ovSkill"); return true; }
      if (key === "room") { UI.show("ovDuelSetup"); if (UI.renderRoom) UI.renderRoom(); return true; }
      return false;
    },

    /* 测试 / 调试用：把三条重置成未完成（不发不退金币）。
     * 顺手把会话内的收起状态清掉 —— 卡片已经收起来过一次的话，
     * 重置后应当直接看到完整三行，而不是一条「成长任务 0 / 3」的小条。 */
    reset() {
      const P = LD.Profile;
      P.d.grow = { shop: 0, skill: 0, room: 0 };
      P.save();
      if (LD.UI) {
        LD.UI.growFold = false;
        if (LD.UI.renderGrow) LD.UI.renderGrow();
      }
    }
  };
})(window.LD = window.LD || {});
