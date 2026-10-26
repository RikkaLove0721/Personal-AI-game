/* ============================================================
 *  85_bgm.js — 背景音乐（BGM）
 * ============================================================
 *  v4.13g：音乐从「LAN 服务器流式播放」改成**内置进单文件**。
 *  素材由 scripts/proc_music.py 压成 dist/music_built/*.m4a（AAC 单声道 32k），
 *  build.py 再读成 data URI 写进 window.LD_MUSIC —— 于是双击 HTML 也有 BGM。
 *
 *  播放规则：
 *    - 随机乱序，一轮播完重新洗牌
 *    - 低音量（0.15，不抢音效）、跟随「M 静音 / 主菜单右上角开关」
 *    - 浏览器自动播放策略：首次点击 / 按键之后再开始
 *  兼容：没有内嵌素材时（比如旧包）退回服务器 /music/list 流式播放。
 * ============================================================ */
(function (LD) {
  "use strict";
  const BGM = LD.BGM = {
    vol: 0.15,            // 背景音乐音量（0~1），刻意压低不抢音效
    list: [],             // 歌单：[{ n: 歌名, d: data URI }]
    order: [],            // 洗牌后的播放顺序（存下标）
    idx: 0,
    el: null,             // 当前 <audio>
    started: false,
    failed: 0,            // 连续播放失败次数（超限后静默放弃）
    muted: false,         // 关掉音乐（随存档保存）
    source: "",           // "embed" | "server"

    init() {
      this.applyProfile();                           // 先按存档恢复开关状态
      /* 1) 内嵌素材优先：单文件分发也能听到 BGM */
      const emb = (typeof window !== "undefined" && window.LD_MUSIC) || null;
      if (emb && emb.length) {
        this.list = emb.filter(o => o && o.d).map(o => ({ n: String(o.n || "未命名"), d: o.d }));
        this.source = "embed";
        this._hook();
        return;
      }
      /* 2) 退回服务器歌单（老分发方式，没有内嵌素材时还有救） */
      if (typeof fetch === "undefined") return;      // 无头测试环境直接跳过
      try {
        this.source = "server";
        fetch("/music/list").then(r => (r.ok ? r.json() : { music: [] }))
          .then(d => {
            const arr = (d && d.music) || [];
            this.list = arr.map(n => ({ n: String(n).replace(/\.[a-z0-9]+$/i, ""), d: "/music/" + encodeURIComponent(n) }));
            this._hook();
          })
          .catch(() => {});
      } catch (e) { /* 忽略 */ }
    },

    /* 从存档读取开关状态（字段不存在视为开启） */
    applyProfile() {
      try {
        const v = LD.Profile && LD.Profile.d ? LD.Profile.d.bgmOn : true;
        this.muted = v === false;
      } catch (e) { this.muted = false; }
      if (this.muted && this.el) { try { this.el.pause(); } catch (e) { /* 忽略 */ } }
      return !this.muted;
    },

    /* 是否开启音乐 */
    isOn() { return !this.muted; },

    /* 歌单里有几首（UI 用） */
    count() { return this.list.length; },

    /* 当前歌名（没在播就是空串） */
    now() { return (this.order.length && this.el) ? (this.order[this.idx] || "") : ""; },

    /* 按钮文案 */
    label() { return this.muted ? "🔇 音乐关" : "🎵 音乐开"; },

    /* 开关：on=true 开，false 关；persist=false 时不写存档 */
    setOn(on, persist) {
      on = !!on;
      this.muted = !on;
      if (on) {
        if (this.el) {
          try {
            this.el.muted = false;
            const p = this.el.play();
            if (p && p.catch) p.catch(() => {});
          } catch (e) { /* 忽略 */ }
        }
        if (!this.started) this.start();
      } else if (this.el) {
        try { this.el.pause(); this.el.muted = true; } catch (e) { /* 忽略 */ }
      }
      if (persist !== false) this._save();
      return on;
    },

    toggle() { return this.setOn(this.muted, true); },

    _save() {
      try {
        if (LD.Profile) { LD.Profile.d.bgmOn = !this.muted; LD.Profile.save(); }
      } catch (e) { /* 忽略 */ }
    },

    /* 浏览器/WebView 自动播放策略：首次用户交互后再开始 */
    _hook() {
      if (!this.list.length) return;
      const go = () => this.start();
      try {
        window.addEventListener("pointerdown", go, { once: true });
        window.addEventListener("keydown", go, { once: true });
      } catch (e) { /* 忽略 */ }
    },

    start() {
      if (this.started || this.muted || !this.list.length || typeof Audio === "undefined") return;
      this.started = true;
      this.order = this._shuffle(this.list.map((_, i) => i));
      this.idx = 0;
      this._play();
    },

    _shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },

    _play() {
      if (!this.order.length) return;
      if (this.idx >= this.order.length) {            // 一轮播完 → 重新洗牌再放
        this.order = this._shuffle(this.order);
        this.idx = 0;
      }
      const song = this.list[this.order[this.idx]];
      if (!song) { this.idx++; this._play(); return; }
      try {
        const el = new Audio(song.d);
        el.volume = this.vol;
        el.preload = "auto";
        el.onended = () => { this.idx++; this._play(); };
        el.onerror = () => {
          this.failed++;
          if (this.failed >= 3) { this.started = false; return; }   // 素材全挂了就静默停掉
          this.idx++; this._play();
        };
        this.el = el;
        try { el.title = song.n; } catch (e) { /* 忽略 */ }
        const p = el.play();
        if (p && p.catch) p.catch(() => {             // 自动播放被拦：等下一次交互
          this.started = false;
          this._hook();
        });
        this._announce(song.n);
      } catch (e) { this.started = false; }
    },

    /* 换歌时轻轻报一下歌名（战斗中不打扰） */
    _announce(name) {
      try {
        if (typeof this.onChange === "function") this.onChange();   // 主菜单按钮的 title 跟着刷
      } catch (e) { /* 忽略 */ }
      try {
        if (!name || !LD.UI || !LD.UI.toast) return;
        const inFight = LD.Battle && LD.Battle.state === "fight";
        if (inFight) return;
        LD.UI.toast("🎵 " + name, false, 1400);
      } catch (e) { /* 忽略 */ }
    }
  };

  /* boot 时初始化歌单 */
  function boot() { try { BGM.init(); } catch (e) { /* 忽略 */ } }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(window.LD = window.LD || {});
