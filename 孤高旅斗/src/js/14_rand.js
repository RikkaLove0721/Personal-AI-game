/* ============================================================
 *  14_rand.js — 可复现随机（v4.34）
 * ============================================================
 *  联机时房主与客机各自在本地跑一遍 B.setup / B.resetRound，
 *  而这些函数里到处是 Math.random：撤离点撒哪、充电站摆哪、
 *  据点选哪、椅子刷哪、船刷哪……两端摇出来的数不一样，
 *  于是「客机看到的地图」和「房主判定的地图」是两张图。
 *  以前这些差异靠快照里的 tm 数组按索引对齐去补，位置 / 数量一旦不同
 *  就整体错位——这正是「情报箱停在地图中间」「夜战看不到手电」一类
 *  现象的底层原因之一。
 *
 *  解决办法不是把布局一个个发过去（那要几百字节 × 每秒三十次），
 *  而是**让两端跑同一串随机数**：
 *    · 房主开局抽一个 seed 随 go 消息下发
 *    · 两端在每个 initXxx 前用 LD.withSeed(seed, 标签, fn) 重设随机源
 *    · 这些 init 内部只读随机、不读时钟 / 网络 / 玩家输入，所以结果必然相同
 *  离开 init 段就恢复真随机——战斗里的暴击、AI 抖动不该被同步。
 *
 *  为什么每个 init 各设一次种子，而不是整个 setup 设一次：
 *  个别 init 有 isHost 分支（如追猎的猎人抽签只在房主跑），
 *  整段共用一条随机流的话，跳过一支就整体错位；按函数重置就互不牵连。
 * ============================================================ */
(function (LD) {
  "use strict";

  /** mulberry32：32 位状态，短、快、无依赖，够做布局随机 */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* FNV-1a：把「模式名 / 阶段名」压成一个号，
   * 相同 seed + 相同标签 → 同一个序列，彼此不互相干扰 */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const R = LD.Rand = {
    base: 0,          // 本局种子；0 = 不做确定性随机
    depth: 0,
    saved: null,      // 进入确定性模式前的 Math.random

    hash: hash,
    mulberry32: mulberry32,

    /** 设置本局种子（房主开局调用；0 / null 表示退回真随机） */
    seed(n) { this.base = (n >>> 0) || 0; },

    /**
     * 在确定性随机源下执行 fn，结束后原样恢复。
     * 支持嵌套（内层换新种子，出栈时还原外层），否则两个 init 互相包裹时会串味。
     */
    withSeed(base, tag, fn) {
      if (!base || typeof fn !== "function") return fn();
      const outerMath = Math.random;
      const outerDepth = this.depth;
      Math.random = mulberry32(((base ^ hash(String(tag))) >>> 0) || 1);
      this.depth = outerDepth + 1;
      try {
        return fn();
      } finally {
        Math.random = outerMath;
        this.depth = outerDepth;
      }
    }
  };

  /* 全局简写：B.setup / B.resetRound 里逐段调用 */
  LD.withSeed = function (base, tag, fn) { return R.withSeed(base, tag, fn); };
})(window.LD = window.LD || {});
