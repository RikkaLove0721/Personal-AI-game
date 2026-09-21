/* ============================================================
 *  85_bgm.js — 背景音乐（BGM）
 *  素材来自用户提供的音乐库，构建前由 scripts/proc_music.py 压缩成
 *  dist/music/*.ogg；运行时通过服务器 /music/list 拿歌单、/music/<名> 拉流。
 *  规则：随机乱序播放（一轮播完重新洗牌）、低音量循环、首次交互后启动
 *  （浏览器自动播放策略），多端：exe（WebView2）与浏览器都可以。
 *  开关：主菜单右上角可随时开关，状态写进存档（bgmOn），下次启动保持一致。
 * ============================================================ */
(function (LD) {
  "use strict";
  const BGM = LD.BGM = {
    vol: 0.15,            // 背景音乐音量（0~1），刻意压低不抢音效
    list: [],             // 服务器返回的歌单（文件名数组）
    order: [],            // 洗牌后的播放顺序
    idx: 0,
    el: null,             // 当前 <audio>
    started: false,
    failed: 0,            // 连续播放失败次数（超限后静默放弃）
    muted: false,         // 关掉音乐（主菜单右上角开关，随存档保存）

    init() {
      if (typeof fetch === "undefined") return;      // 无头测试环境直接跳过
      this.applyProfile();                           // 先按存档恢复开关状态
      try {
        fetch("/music/list").then(r => (r.ok ? r.json() : { music: [] }))
          .then(d => { this.list = (d && d.music) || []; this._hook(); })
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
      this.order = this._shuffle(this.list.slice());
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
      const name = this.order[this.idx];
      try {
        const el = new Audio("/music/" + encodeURIComponent(name));
        el.volume = this.vol;
        el.preload = "auto";
        el.onended = () => { this.idx++; this._play(); };
        el.onerror = () => {
          this.failed++;
          if (this.failed >= 3) { this.started = false; return; }   // 素材全挂了就静默停掉
          this.idx++; this._play();
        };
        this.el = el;
        const p = el.play();
        if (p && p.catch) p.catch(() => {             // 自动播放被拦：等下一次交互
          this.started = false;
          this._hook();
        });
      } catch (e) { this.started = false; }
    }
  };

  /* boot 时初始化歌单 */
  function boot() { try { BGM.init(); } catch (e) { /* 忽略 */ } }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(window.LD = window.LD || {});
