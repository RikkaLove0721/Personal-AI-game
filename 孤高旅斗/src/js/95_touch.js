/* ============================================================
 *  95_touch.js — 手机版触屏操控（虚拟摇杆 + 技能按钮）
 * ------------------------------------------------------------
 *  设计原则：不改动任何战斗逻辑，只把手指输入写进 UI.ctrl，
 *  与键盘完全同构（ctrl.mx/my 摇杆、ctrl.hold 按住、ctrl.press 触发、
 *  ctrl.dodge 闪避），因此联机快照同步也原样可用。
 *
 *  布局：
 *    左手：浮动虚拟摇杆（触摸左半屏任意位置即在该处浮现，松手消失）
 *    右手：普攻（右下角最大）＋ 技能1/技能2/大招（等大，沿普攻左侧 90° 圆弧均分）
 *          ＋ 闪避（贴在技能1左侧，同高同径）
 * ============================================================ */
(function (LD) {
  "use strict";
  const UI = LD.UI, B = LD.Battle;

  /* ---------- 手感参数（后续要调手感就改这里） ---------- */
  const CFG = {
    stickR: 62,        // 摇杆底座半径（CSS px）
    knobR: 28,         // 摇杆头半径
    dead: 8,           // 死区：小于这个位移不算移动，避免手指微抖
    dodgeMs: 280,      // 摇杆同方向连推两次的时间窗（双击闪避）
    btnAlpha: 0.72     // 按钮常态透明度
  };

  /* 王者荣耀式布局：x/y 是按钮右/下边缘距屏幕右/下的像素，r 是半径。
     圆心的换算：圆心距右缘 = x + r，距下缘 = y + r。
     - 普攻 J：右下角最大键，r46，圆心 (72, 72)
     - 技能1/技能2/大招 K/L/O：三者等大 r30，沿普攻左上方 90° 圆弧均分，
       角度依次 180°（正左）/135°（左上）/90°（正上），圆心距普攻圆心 86px，
       即"贴着普攻"的紧密扇形（相邻圆边缘留 5~10px 缝，不会叠）
     - 闪避：贴在左下角那个技能（K）的左侧，圆心同高（距下缘 72），半径与 K 一致
     - 索敌：v2.7 新增，贴在闪避左侧、同高同径，点一下循环切换锁定目标（等同键盘 V） */
  const BTNS = [
    { id: "basic",  label: "普攻", r: 46, x: 26,  y: 26,  key: "J", big: true },
    { id: "skill1", label: "技能1", r: 30, x: 128, y: 42,  key: "K" },
    { id: "skill2", label: "技能2", r: 30, x: 103, y: 103, key: "L" },
    { id: "ult",    label: "大招", r: 30, x: 42,  y: 128, key: "O", cls: "ult" },
    { id: "dodge",  label: "闪避", r: 30, x: 196, y: 42,  key: "闪" },
    { id: "lock",   label: "索敌", r: 30, x: 264, y: 42,  key: "V", cls: "lk" },
    /* v3.3 交互键 P：放在大招键正上方（大招 bottom 128，高 60 → 上方 196 起） */
    { id: "interact", label: "交互", r: 30, x: 42, y: 196, key: "P", cls: "it" }
  ];

  /* ---------- 平板自适应 ----------
     手机横屏短边约 320~430，平板（iPad / 安卓）短边 ≥600。
     平板屏幕大、手指离屏幕更远，整套控件等比放大，握持和放手点都更舒服。
     放大倍率只作用在这里，不影响画面缩放（画面由 90_boot.js 的 applyMobileView 管）。 */
  const PAD_K = 1.32;                          // 平板放大倍率（想更夸张就调大）

  /* ---------- 是否触屏设备 ----------
     注意：不能用 `"ontouchstart" in window` 当判据 —— 桌面 Chrome（含笔记本触摸屏
     版本和部分普通机型）现在这个属性普遍为 true，会把电脑误判成手机，
     结果电脑上被换成 720x420 小视口 + 显示触屏控件。
     以媒体查询为准：pointer:coarse 且 hover:none（真正的手机/平板），
     再兜底 maxTouchPoints（避开桌面触摸屏笔记本那种 hover:hover 的设备）。 */
  function isTouch() {
    try {
      if (window.matchMedia) {
        if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) return true;
        if (window.matchMedia("(hover: hover)").matches) return false;   // 有鼠标 → 当电脑
      }
    } catch (e) { /* 忽略，走兜底 */ }
    return (navigator.maxTouchPoints || 0) > 0;
  }

  function isPad() {
    if (!isTouch()) return false;
    return Math.min(window.innerWidth, window.innerHeight) >= 600;
  }

  function applyPad() {
    if (!isPad()) return 1;
    CFG.stickR = Math.round(CFG.stickR * PAD_K);
    CFG.knobR = Math.round(CFG.knobR * PAD_K);
    CFG.dead = Math.round(CFG.dead * PAD_K);
    BTNS.forEach(b => {
      b.r = Math.round(b.r * PAD_K);
      b.x = Math.round(b.x * PAD_K);            // 坐标一起放大，间距才跟着拉开
      b.y = Math.round(b.y * PAD_K);
    });
    return PAD_K;
  }

  const T = LD.Touch = {
    on: false,           // 是否手机布局
    pad: false,          // 是否平板（控件已放大）
    isTouch: isTouch,    // 触屏判定（90_boot 的 applyMobileView / fit 也用它）
    isPad: isPad,        // 平板判定（90_boot 的 fit() 也用它切 body.pad）
    scale: 1,            // 控件放大倍率
    stickId: null,       // 摇杆占用的 pointerId
    stick: { cx: 0, cy: 0, dx: 0, dy: 0 },
    lastPush: { t: 0, x: 0, y: 0, armed: true },   // 双击闪避：必须先回中"上膛"再算第二次推
    els: {},             // 各按钮 DOM
    held: {}             // 各按钮占用的 pointerId
  };

  /* ---------- 构建 DOM ---------- */
  function build() {
    const layer = document.getElementById("touchLayer");
    if (!layer) return;
    layer.innerHTML =
      '<div id="stickZone"></div>' +
      '<div id="stickBase"><div id="stickKnob"></div></div>' +
      '<div id="btnZone"></div>' +
      '<button id="btnPause" class="tpad">⏸</button>';
    T.els = {
      layer,
      zone: layer.querySelector("#stickZone"),
      base: layer.querySelector("#stickBase"),
      knob: layer.querySelector("#stickKnob"),
      btnZone: layer.querySelector("#btnZone"),
      pause: layer.querySelector("#btnPause")
    };

    /* 底座/摇杆头尺寸由 CFG 驱动（平板放大时同步生效），不再依赖 shell.html 里的固定值 */
    const R = CFG.stickR, KR = CFG.knobR;
    T.els.base.style.width = T.els.base.style.height = (R * 2) + "px";
    T.els.base.style.margin = (-R) + "px 0 0 " + (-R) + "px";
    T.els.knob.style.width = T.els.knob.style.height = (KR * 2) + "px";
    T.els.knob.style.margin = (-KR) + "px 0 0 " + (-KR) + "px";

    /* 摇杆：底座固定在左下，触摸左侧区域任意位置即可激活（浮动式） */
    const zone = T.els.zone;
    zone.addEventListener("pointerdown", e => {
      if (T.stickId !== null) return;
      T.stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* 某些浏览器/合成事件会抛，忽略即可 */ }
      moveBase(e.clientX, e.clientY);
      T.els.base.classList.add("on");
      applyStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    zone.addEventListener("pointermove", e => {
      if (e.pointerId !== T.stickId) return;
      applyStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    const end = e => {
      if (e.pointerId !== T.stickId) return;
      T.stickId = null;
      T.els.base.classList.remove("on");
      UI.ctrl.mx = UI.ctrl.my = 0;
      e.preventDefault();
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
    zone.addEventListener("lostpointercapture", end);

    /* 技能按钮 */
    const k = T.scale || 1;
    BTNS.forEach(b => {
      const el = document.createElement("div");
      el.className = "tbtn2" + (b.big ? " big" : "") + (b.cls ? " " + b.cls : "");
      el.style.width = el.style.height = (b.r * 2) + "px";
      el.style.right = b.x + "px";
      el.style.bottom = b.y + "px";
      /* 字号跟着按钮走（平板放大时文字不缩在中间） */
      el.innerHTML = '<span class="tbk" style="font-size:' + Math.round((b.big ? 25 : 18) * k) + 'px">' + b.key +
        '</span><span class="tbn" style="font-size:' + Math.round(10 * k) + 'px">' + b.label +
        '</span><i class="tcd" style="font-size:' + Math.round(22 * k) + 'px"></i>';
      T.els.btnZone.appendChild(el);
      b.el = el;
      T.els[b.id] = el;

      el.addEventListener("pointerdown", e => {
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        T.held[b.id] = e.pointerId;
        el.classList.add("act");
        press(b.id);
        /* 长按技能键（0.45s）也弹介绍卡，方便看清技能说明 */
        if (b.id === "skill1" || b.id === "skill2" || b.id === "ult" || b.id === "basic") {
          b._holdT = setTimeout(() => {
            const me = B.hero(B.mySide == null ? 0 : B.mySide);
            if (me) showTip(b.id, LD.skill(me.loadout[b.id]));
          }, 450);
        }
        e.preventDefault();
      });
      const up = e => {
        if (T.held[b.id] !== e.pointerId) return;
        T.held[b.id] = null;
        el.classList.remove("act");
        if (b._holdT) { clearTimeout(b._holdT); b._holdT = null; }
        if (b.id !== "dodge" && b.id !== "lock" && b.id !== "interact") UI.ctrl.hold[b.id] = false;   // 闪避 / 索敌 / 交互没有 hold
        e.preventDefault();
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
    });

    T.els.pause.onclick = () => { if (UI.screen === "game") UI.openPause(); };
  }

  function press(id) {
    if (id === "dodge") {
      const d = T.stick.dx || T.stick.dy ? norm(T.stick.dx, T.stick.dy) : { x: (UI.ctrl.mx || 1), y: 0 };
      UI.ctrl.dodge = d;
      return;
    }
    /* v2.7 索敌按钮：与键盘 V 完全同构 —— 写 ctrl.lockNext，战斗循环里循环切换目标 */
    if (id === "lock") { UI.ctrl.lockNext = 1; return; }
    /* v3.3 交互键：与键盘 P 完全同构 */
    if (id === "interact") { UI.ctrl.press.interact = true; return; }
    /* v2.7 手机端：技能槽为空 / 未拥有技能时，浮出介绍卡而不是什么都不做 */
    const me = B.hero(B.mySide == null ? 0 : B.mySide);
    if (me && (id === "skill1" || id === "skill2" || id === "ult" || id === "basic")) {
      const sk = LD.skill(me.loadout[id]);
      if (!sk) { showTip(id, null); return; }
      hideTip();
    }
    UI.ctrl.press[id] = true;
    UI.ctrl.hold[id] = true;
  }

  /* ---------- 技能浮框（手机端轻点按钮即可看介绍） ---------- */
  let tipEl = null, tipT = 0;
  function tipHost() {
    if (tipEl) return tipEl;
    tipEl = document.createElement("div");
    tipEl.id = "skillTip";
    tipEl.style.cssText = "position:fixed;z-index:60;max-width:230px;padding:9px 12px;border-radius:10px;" +
      "background:rgba(12,18,32,.94);border:1px solid rgba(120,160,255,.35);color:#e8eeff;" +
      "font-size:12px;line-height:1.6;pointer-events:none;opacity:0;transition:opacity .12s;" +
      "box-shadow:0 6px 22px rgba(0,0,0,.45);display:none";
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(id, sk) {
    const el = tipHost();
    const name = sk ? (sk.icon + " " + sk.name) : "无";
    const tags = sk && sk.tags && sk.tags.length ? '<div style="color:#7fe6f7;font-size:11px;margin-bottom:3px">' + sk.tags.join(" · ") + '</div>' : "";
    const desc = sk ? (sk.desc || "") : "这个槽位暂时没有装配技能。回到「技能商店」购买并装配后即可在这里使用。";
    el.innerHTML = '<div style="font-weight:800;font-size:13px;margin-bottom:4px">' + name + '</div>' + tags +
      '<div style="color:#b9c6e6">' + desc + '</div>';
    el.style.display = "block";
    el.style.opacity = "1";
    /* 浮框贴在按钮上方，避开手指 */
    const b = T.els[id] || T.els.btnZone;
    const r = b ? b.getBoundingClientRect() : { left: 40, top: 40, width: 60, height: 60 };
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    el.style.left = left + "px"; el.style.top = top + "px";
    tipT = 3.2;                                  // 3.2 秒后自动收起
  }
  function hideTip() { if (tipEl) { tipEl.style.opacity = "0"; tipEl.style.display = "none"; } tipT = 0; }
  /* 长按按钮（>0.45s）也弹介绍，方便看清刚装上的技能 */
  function tickTip(dt) {
    if (tipT > 0) { tipT -= dt; if (tipT <= 0) hideTip(); }
  }
  T.tickTip = tickTip;

  function norm(dx, dy) {
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  function moveBase(x, y) {
    const b = T.els.base;
    b.style.left = x + "px";
    b.style.top = y + "px";
    T.stick.cx = x; T.stick.cy = y;
  }

  function applyStick(x, y) {
    let dx = x - T.stick.cx, dy = y - T.stick.cy;
    const d = Math.hypot(dx, dy);
    const max = CFG.stickR;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    T.stick.dx = dx; T.stick.dy = dy;
    T.els.knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    const len = Math.hypot(dx, dy);
    if (len < CFG.dead) {
      UI.ctrl.mx = UI.ctrl.my = 0;
      T.lastPush.armed = true;      // 回中即上膛（注意别被下面的死区提前 return 跳过——之前就栽在这）
      return;
    }
    const n = norm(dx, dy);
    UI.ctrl.mx = n.x; UI.ctrl.my = n.y;

    /* 双击闪避：必须"推到底 → 回中 → 再推到底"才算一次双击。
       修过的 bug：之前只按时间窗判定，手指推到底不动时 pointermove 仍连续触发，
       每隔一个事件就被误判成第二次推 → 每秒尝试十几次闪避，"闪避冷却中"刷屏 */
    const now = performance.now();
    if (len < max * 0.45) {
      T.lastPush.armed = true;                     // 回到近中心，允许记录下一次"推到底"
    } else if (len >= max * 0.86 && T.lastPush.armed) {
      const lp = T.lastPush;
      const same = lp.x * n.x + lp.y * n.y > 0.5;
      if (same && now - lp.t < CFG.dodgeMs) {
        UI.ctrl.dodge = { x: n.x, y: n.y };
        lp.t = 0;
      } else {
        lp.t = now; lp.x = n.x; lp.y = n.y;
      }
      T.lastPush.armed = false;                    // 不回中就不再累计
    }
  }

  /* ---------- 按钮冷却显示 ---------- */
  function refresh() {
    const me = B.hero(B.mySide == null ? 0 : B.mySide);
    if (!me) return;
    BTNS.forEach(b => {
      if (b.id === "dodge" || b.id === "lock") return;
      const el = T.els[b.id];
      /* v3.3 交互键：附近有可交互物时高亮，否则置灰（依然可以按，只是没反应） */
      if (b.id === "interact") {
        const label = (B.interactLabel ? B.interactLabel(me) : "") || "";
        el.classList.toggle("ready", !!label);
        el.classList.toggle("dis", !label);
        const nameEl = el.querySelector(".tbn");
        if (nameEl) nameEl.textContent = label ? label.slice(0, 4) : "交互";
        const cdEl2 = el.querySelector(".tcd");
        if (cdEl2) cdEl2.textContent = (B.rule === "tower" && me.activeItem && (me.activeCd || 0) > 0.05)
          ? Math.ceil(me.activeCd) : "";
        return;
      }
      const cd = me.cd ? (me.cd[b.id] || 0) : 0;
      const sk = LD.skill(me.loadout[b.id]);
      const ready = sk && cd <= 0;
      el.classList.toggle("dis", !ready);
      const cdEl = el.querySelector(".tcd");
      if (cdEl) cdEl.textContent = cd > 0.05 ? Math.ceil(cd) : "";
      const nameEl = el.querySelector(".tbn");
      /* v2.7：没装技能时显示「无」，不要再残留上一局 / 上一模式的技能名 */
      if (nameEl) nameEl.textContent = sk ? sk.name.slice(0, 4) : "无";
    });
  }

  /* ---------- 显隐：只在战斗中显示 ---------- */
  function sync() {
    const show = T.on && UI.screen === "game" && B.state !== "idle";
    T.els.layer.classList.toggle("on", !!show);
    if (show && T.stickId === null) UI.ctrl.mx = UI.ctrl.my = 0;
  }

  /* ---------- 初始化 ---------- */
  T.init = function () {
    T.on = isTouch();
    T.scale = applyPad();          // 平板：所有控件等比放大
    T.pad = T.scale > 1;
    build();
    /* iOS 无法屏蔽双指缩放（viewport 的 user-scalable 被忽略），只能拦手势 */
    document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    document.addEventListener("gesturestart", e => e.preventDefault());

    /* iOS 自动播放策略：AudioContext 必须由用户手势创建/恢复，且可能再次被挂起 */
    const unlock = () => {
      try {
        const Au = LD.Audio;
        if (Au && Au.init) { Au.init(); if (Au.ctx && Au.ctx.state === "suspended") Au.ctx.resume(); }
      } catch (e) { /* 忽略 */ }
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("touchstart", unlock, { capture: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) unlock(); });
    setInterval(() => {
      if (!T.on) return;
      sync();
      if (UI.screen === "game") refresh();
      if (tipT > 0) { tipT -= 0.1; if (tipT <= 0) hideTip(); }
      else if (UI.screen !== "game") hideTip();
    }, 100);
  };

  /* 挂到 UI.init 之后：90_boot 会调 UI.init()，这里包一层 */
  const _init = UI.init;
  UI.init = function () {
    const r = _init.apply(this, arguments);
    try { T.init(); } catch (e) { console.error("touch init", e); }
    return r;
  };
})(window.LD = window.LD || {});
