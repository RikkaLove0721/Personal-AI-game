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

  /* ---------------- 画布自适应 ---------------- */
  function fit() {
    const app = document.getElementById("app");
    const s = Math.min(window.innerWidth / 990, window.innerHeight / 632, 1.4);
    app.style.transform = "scale(" + s + ")";
    app.style.transformOrigin = "center center";
  }
  window.addEventListener("resize", fit);

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
