/* ============================================================
 *  90_boot.js — 启动 / 主循环 / AI 驱动 / 联机同步 / 音效挂钩
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, C = LD.CONF, FX = LD.FX, UI = LD.UI, Net = LD.Net, A = LD.Audio;

  /* ---------------- 音效挂钩 ---------------- */
  const _damage = B.damage;
  B.damage = function (src, tgt, amt, o) {
    const before = tgt && tgt.hp;
    const r = _damage.apply(this, arguments);
    if (r > 0 || (tgt && tgt.hp < before)) A.hit();
    return r;
  };
  const _parry = B.doParry;
  B.doParry = function () { A.parry(); return _parry.apply(this, arguments); };
  const _try = B.trySlot;
  B.trySlot = function (f, slot, ctrl) { const on = f.slot[slot] && f.slot[slot].on; const r = _try.apply(this, arguments); if (!on && f.slot[slot] && f.slot[slot].on) A.cast(); return r; };
  const _cine = LD.Cine.start;
  LD.Cine.start = function (who, name, sub, color) { A.ult(); if (Net.peerIn && B.authoritative && B.mode === "net") Net.toPeer({ t: "cin", name, color, side: who.side }); return _cine.apply(this, arguments); };
  // 客机大招演出
  const _fromPeer = Net.fromPeer;
  Net.fromPeer = function (d) {
    if (d.t === "cin") { const who = B.fighters.find(f => f.side === d.side); if (who) LD.Cine.start(who, d.name, "", d.color); return; }
    return _fromPeer.call(this, d);
  };

  /* ---------------- 画布自适应（双端：电脑键鼠 / 手机平板触屏） ---------------- */
  /* 手机端的逻辑视口比桌面小（720x420 而不是 960x600，与 10_data.js 的 CONF 一致）：
     视口收窄后画面被放大、同时摄像机有了足够的行程 —— 大地图 1200x1200 下
     960 宽的视口只剩 240px 横向行程，会让人觉得“视角不跟着人走、人物跑到屏幕边”
     注意：这里必须在 LD.ctx / UI.init 之前改，否则画布尺寸对不上 */
  let VIEW = { w: 976, h: 612 };
  function applyMobileView() {
    /* 触屏判定统一交给 95_touch.js 的 isTouch()（其内部以 pointer:coarse + hover:none 为准，
       避免桌面 Chrome 的 "ontouchstart" in window 恒为 true 导致电脑被误判为手机）。
       95_touch.js 排在 90_boot.js 之前加载，这里一定拿得到。 */
    const mob = !!(LD.Touch && (LD.Touch.isTouch ? LD.Touch.isTouch() : LD.Touch.on));
    if (LD.Touch) LD.Touch.on = mob;      // fit() 依赖它，提前定稿
    if (!mob) return;
    const CW = 720, CH = 420;
    LD.CONF.W = CW; LD.CONF.H = CH;
    const cv = document.getElementById("cv");
    if (cv) {
      cv.width = CW; cv.height = CH;
      cv.style.width = CW + "px"; cv.style.height = CH + "px";
    }
    const app = document.getElementById("app");
    if (app) { app.style.width = CW + "px"; app.style.height = CH + "px"; }
    VIEW = { w: CW + 16, h: CH + 12 };    // #app 的 8px/6px 内边距
  }

  function fit() {
    const app = document.getElementById("app");
    const mob = !!(LD.Touch && LD.Touch.on);
    /* 触屏端：横屏时尽量吃满高度（宽度富余，两侧留给触屏控件）
     * 电脑端：沿用原来的 990x632 留边逻辑 */
    const s = mob
      ? Math.min(window.innerWidth / VIEW.w, window.innerHeight / VIEW.h, 1.8)
      : Math.min(window.innerWidth / 990, window.innerHeight / 632, 1.4);
    app.style.transform = "scale(" + s + ")";
    app.style.transformOrigin = "center center";
    document.body.classList.toggle("mobile", mob);
    /* 平板：画面放大得多（≈1.6 倍），不需要手机那套 HUD 反向放大，用 body.pad 抵消掉 */
    document.body.classList.toggle("pad", !!(LD.Touch && LD.Touch.on && LD.Touch.isPad && LD.Touch.isPad()));
  }
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", () => setTimeout(fit, 220));   // iOS 转屏后视口尺寸有延迟

  /* ---------------- 主循环 ---------------- */
  let last = 0, hudAcc = 0, snapAcc = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const ctx = LD.ctx;
    if (B.state !== "idle" && B.fighters.length) {
      B.frame = (B.frame || 0) + 1;

      /* --- AI 驱动（只有权威端才跑） --- */
      if (B.authoritative) {
        B.fighters.forEach(f => {
          if (f.bench) return;                    // 车轮战板凳：不上场、不思考
          if (f.kind === "hero" && f.isBot) LD.AI.tickHero(f, dt);
          else if (f.kind === "dragon") LD.AI.tickDragon(f, dt);
        });
      }

      /* --- 联机同步 --- */
      if (B.mode === "net") {
        if (B.authoritative) {
          snapAcc += dt;
          if (snapAcc >= Net.snapInt) { snapAcc = 0; Net.toPeer(Net.snapshot()); }
          Net.flushEvents();
        } else {
          Net.sendInput(UI.ctrl, dt);
        }
      }

      B.update(dt);
      B.draw(ctx);

      hudAcc += dt;
      if (hudAcc >= 0.06) { hudAcc = 0; UI.updateHud(); }
    } else {
      // 待机画面
      LD.View.arena(ctx, C.W, C.H, now / 1000, {});
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const yy = C.H - ((now / 1000 * 22 + i * 90) % (C.H + 120));
        LD.View.glow(ctx, C.W * (0.3 + i * 0.2), yy, 40, i % 2 ? "rgba(34,211,238,.10)" : "rgba(244,114,182,.10)", 1);
      }
      ctx.restore();
    }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    applyMobileView();                     // 必须先于 ctx / UI.init
    const cv = document.getElementById("cv");
    LD.ctx = cv.getContext("2d");

    LD.Profile.load();
    if (LD.Profile.d.aiLoadout) UI.duel.loadout = LD.Profile.d.aiLoadout;
    LD.Profile.syncServer();               // exe 模式：与 profile.json 对账，新者胜

    FX.clear();
    UI.init();
    fit();
    requestAnimationFrame(loop);

    // 键盘锁定：避免空格滚动页面
    window.addEventListener("keydown", e => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0 && e.target === document.body) e.preventDefault();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.LD = window.LD || {});
