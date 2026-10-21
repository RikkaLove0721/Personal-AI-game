/* ============================================================
 *  46_night.js — v3.9.1 停电夜战
 * ============================================================
 *  全图断电，视野规则：
 *    - 每人自带 1 格私人视野（只画在自己屏幕上，别人看不到）
 *    - 交互键（P）= 手电筒：照亮前方十多格的锥形区域，该区域是「公共光」，
 *      别人也能看见——开灯就是把自己暴露出去
 *    - 充电站 / 能量包散发 3 格半径的公共亮光；靠近充电站按住 P 蓄力 1.6 秒充满电
 *    - 黑暗条：不受光每秒 +1，满 15 点后每秒掉 20 血；受光每秒 -3
 *
 *  配装固定：J 位移斩 / K 手里剑，禁用第二个技能与大招（L、O 留空）。
 *
 *  实现要点：
 *    - 黑幕是「离屏画布铺满黑 + 按光源 destination-out 挖洞」，最后整块贴回主画布。
 *      不能在主画布上直接 destination-out（那样会把底下的战斗画面一起擦掉）。
 *    - 黑幕画在战斗内容之上、倒计时与「被糊住了」提示之下（见 40_battle.js 的调用点）。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, V = LD.View, FX = LD.FX;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* 道具贴图：build.py 把 assets/props/*.png 内嵌成 window.LD_PROP_IMG（data URI），
   * 没有图（或还没加载完）时一律退回程序化绘制，保证任何构建都能跑。 */
  const _imgCache = {};
  function imgOf(kind) {
    if (typeof Image === "undefined") return null;
    const src = (typeof window !== "undefined" && window.LD_PROP_IMG && window.LD_PROP_IMG[kind]) || null;
    if (!src) return null;
    if (!_imgCache[kind]) { const im = new Image(); im.src = src; _imgCache[kind] = im; }
    const im = _imgCache[kind];
    return (im.complete && im.naturalWidth) ? im : null;
  }

  /* ==========================================================
   *  开局：固定配装 + 撒充电站
   * ========================================================== */
  B.initBlackout = function () {
    const N = LD.NIGHT;
    this.stations = [];
    const w = this.world.w, top = this.world.pt || 0, hh = this.world.h - top;
    for (let i = 0; i < N.stations; i++) {
      let x = w * 0.5, y = top + hh * 0.5;
      for (let k = 0; k < 90; k++) {
        const tx = rand(w * 0.12, w * 0.88), ty = rand(top + hh * 0.14, top + hh * 0.86);
        const clear = !this.terrain || LD.Terrain.clearAt(this.terrain, tx, ty, 34);
        const apart = this.stations.every(s => Math.hypot(s.x - tx, s.y - ty) > 300);
        if (clear && apart) { x = tx; y = ty; break; }
      }
      this.stations.push({ x: x, y: y, t: rand(0, 3) });
    }
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.isZombie) return;
      /* 配装：普攻保持玩家自己挑的那个，只把两个技能槽换成位移斩与手里剑，大招留空。
       * 以前是整份 loadout 覆盖，会把玩家自选的普攻（远程 / 格挡 / 狼牙棒…）一起顶掉。 */
      f.loadout = f.loadout || { basic: "slash", skill1: null, skill2: null, ult: null };
      f.loadout.skill1 = N.skill.skill1;
      f.loadout.skill2 = N.skill.skill2;
      f.loadout.ult = null;
      f.slot.skill2 = { on: false, phase: "", t: 0, d: {} };
      f.slot.ult = { on: false, phase: "", t: 0, d: {} };
      f.battery = N.batMax; f.dark = 0; f.flash = false; f.lit = false;
      f.energy = 0;
      /* 开局就在黑暗里，先按隐匿处理（进公共光会自己解除） */
      f.stealthT = 1; f.stealthKeep = true;
    });
  };

  /* ==========================================================
   *  受光判定
   * ========================================================== */
  B.nightLit = function (f) {
    const N = LD.NIGHT;
    let i;
    /* 自己举着手电筒：灯是举在手里的，脚下这一圈自然也算被照到 */
    if (f.flash) return true;
    const st = this.stations || [];
    for (i = 0; i < st.length; i++)
      if (Math.hypot(f.x - st[i].x, f.y - st[i].y) <= N.pubR) return true;
    /* 能量包已从本模式移除（禁用大招用不上），所以公共光只剩充电站 */
    /* 站在别人的光锥里也算（反过来说：被别人照到 = 你暴露了） */
    for (i = 0; i < this.fighters.length; i++) {
      const o = this.fighters[i];
      if (o === f || o.kind !== "hero" || o.dead || o.bench || !o.flash) continue;
      const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 1;
      if (d > N.coneLen) continue;
      const a = Math.atan2(o.facing.y, o.facing.x);
      const da = Math.abs(((Math.atan2(dy, dx) - a + Math.PI * 3) % TAU) - Math.PI);
      if (da <= N.coneHalf) return true;
    }
    return false;
  };

  /* 开关手电筒：没有可交互目标时的交互键行为 */
  B.toggleFlash = function (f) {
    if (!f || f.dead || this.rule !== "blackout") return false;
    const N = LD.NIGHT;
    if (!f.flash && (f.battery || 0) <= 0) {
      FX.float(f.x, f.y - 70, "没电了，去充电站", "#94a3b8", 14);
      this.ev.push(["t", f.x, f.y - 70, "没电了，去充电站", "#94a3b8"]);
      return false;
    }
    f.flash = !f.flash;
    FX.float(f.x, f.y - 70, f.flash ? "手电筒开" : "手电筒关", "#fcd34d", 14);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(f.flash ? 720 : 380, 0.07, "square", 0.04);
    return true;
  };

  /* 充电完成：按已蓄比例把电量补向满格（最低三成） */
  B.finishStation = function (f, st, elapsed) {
    const N = LD.NIGHT;
    const need = (N.charge && N.charge.need) || 1.6;
    const k = elapsed == null ? 1 : Math.max(0.3, Math.min(1, elapsed / need));
    const cur = f.battery || 0;
    f.battery = Math.min(N.batMax, cur + (N.batMax - cur) * k);
    FX.ring(f.x, f.y - 26, 78, "rgba(56,189,248,.95)", 6, 0.45);
    FX.burst(f.x, f.y - 26, 20, ["#38bdf8", "#fff", "#0ea5e9"], { speed: 240 });
    FX.float(f.x, f.y - 70, "电量 " + Math.round(f.battery) + "%", "#38bdf8", 16);
    LD.Audio && LD.Audio.beep && LD.Audio.beep(640, 0.12, "triangle", 0.05);
  };

  /* ==========================================================
   *  每帧：耗电 / 黑暗条 / 条满掉血 / 人机开关灯
   * ========================================================== */
  B.updateNight = function (dt) {
    if (this.rule !== "blackout") return;
    const N = LD.NIGHT;
    (this.stations || []).forEach(s => { s.t += dt; });
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.isZombie) return;
      if (f.battery == null) f.battery = N.batMax;
      if (f.dark == null) f.dark = 0;
      if (f.flash && (f.dead || f.battery <= 0)) f.flash = false;
      if (f.flash) {
        f.battery -= N.batDrain * dt;
        if (f.battery <= 0) {
          f.battery = 0; f.flash = false;
          FX.float(f.x, f.y - 76, "手电筒没电了", "#94a3b8", 14);
          this.ev.push(["t", f.x, f.y - 76, "手电筒没电了", "#94a3b8"]);
        }
      }
      if (f.dead) return;

      /* 人机：黑暗快攒满或附近有人就开灯，电快没了就省着点 */
      if (f.bot) {
        const low = (f.battery || 0) <= (N.batMax * 0.12);
        if (!f.flash && !low && f.dark >= 5) f.flash = true;
        else if (f.flash && (low || f.dark <= 0.5)) f.flash = false;
      }

      const lit = this.nightLit(f);
      f.lit = lit;
      if (lit) f.dark = Math.max(0, f.dark - N.darkDown * dt);
      else f.dark = Math.min(N.darkMax, f.dark + N.darkUp * dt);

      /* 摸黑自带隐匿；被任何公共光照到（充电站的圈 / 别人的手电筒光锥 / 自己开灯）就现形。
       * 这里直接改 stealthT，不走 B.breakStealth：那个函数会把「隐身技能所在的槽位」收进 CD，
       * 夜战没有隐身技能，硬调会把位移斩一并打进冷却。 */
      if (lit) {
        if (f.stealthT > 0) {
          f.stealthT = 0; f.stealthKeep = false;
          FX.float(f.x, f.y - 62, "现形！", "#a78bfa", 13);
        }
      } else if (!f.stealthT) {
        f.stealthT = 1;         // 数值本身没意义，时长由这里每帧接管
        f.stealthKeep = true;   // 隐匿期间攻击不破除隐身（否则一出手就现形，隐匿等于没有）
      }

      if (f.dark >= N.darkMax) {
        /* 攒够一节再结算：每帧 0.33 血地飘字 + 顿帧，看起来就是「一直在挨打」。
         * soft = 只掉血，不给受击反馈、不打断手上的蓄力。 */
        f._darkAcc = (f._darkAcc || 0) + N.darkDps * dt;
        const step = N.darkDps * (N.darkTick || 0.25);
        if (f._darkAcc >= step) {
          const amt = f._darkAcc;
          f._darkAcc = 0;
          this.damage(null, f, amt, { type: "dot", kb: 0, noSrc: true, soft: true });
        }
        f._darkMsg = (f._darkMsg || 0) - dt;
        if (f._darkMsg <= 0 && f.hp > 0) {
          f._darkMsg = 1;
          FX.float(f.x, f.y - 60, "黑暗侵蚀！", "#a78bfa", 13);
        }
      } else f._darkAcc = 0;
    });
  };

  /* ==========================================================
   *  渲染：充电站（世界坐标）
   * ========================================================== */
  B.drawStations = function (ctx) {
    if (this.rule !== "blackout") return;
    const N = LD.NIGHT, im = imgOf("charger");
    (this.stations || []).forEach(st => {
      ctx.save();
      /* 地面光斑：黑幕会盖住大部分，但贴着站的轮廓能透出来 */
      const g = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, N.pubR);
      g.addColorStop(0, "rgba(56,189,248,.26)");
      g.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(st.x, st.y, N.pubR, N.pubR * 0.62, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.34)";
      ctx.beginPath(); ctx.ellipse(st.x, st.y + 8, 30, 12, 0, 0, TAU); ctx.fill();
      if (im) {
        const w = 104, h = im.height * 104 / im.width;
        ctx.drawImage(im, st.x - w / 2, st.y + 10 - h, w, h);
      } else {
        /* 程序化兜底：配电箱 + 闪电标 */
        ctx.fillStyle = "#1e293b"; ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 3;
        V.rr(ctx, st.x - 26, st.y - 62, 52, 72, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#0f172a";
        V.rr(ctx, st.x - 17, st.y - 53, 34, 22, 4); ctx.fill();
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.moveTo(st.x - 1, st.y - 50); ctx.lineTo(st.x - 7, st.y - 39);
        ctx.lineTo(st.x - 1.5, st.y - 39); ctx.lineTo(st.x - 4, st.y - 33);
        ctx.lineTo(st.x + 6, st.y - 43); ctx.lineTo(st.x + 0.5, st.y - 43);
        ctx.lineTo(st.x + 6, st.y - 50); ctx.closePath(); ctx.fill();
      }
      /* 顶部呼吸指示灯 */
      const pulse = 0.5 + Math.sin(this.t * 3 + st.x * 0.02) * 0.5;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(56,189,248," + (0.35 + pulse * 0.45).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(st.x, st.y - 72, 5 + pulse * 2, 0, TAU); ctx.fill();
      ctx.restore();
    });
  };

  /* ==========================================================
   *  渲染：全屏黑幕（屏幕坐标）
   * ========================================================== */
  B.drawNight = function (ctx, W, H) {
    if (this.rule !== "blackout") return;
    /* 无头测试环境没有 document，黑幕只是视觉层，直接跳过 */
    if (typeof document === "undefined" || !document.createElement) return;
    const N = LD.NIGHT, cam = this.cam || { x: 0, y: 0 };
    const me = this.hero(this.mySide == null ? 0 : this.mySide);
    const SX = x => x - cam.x, SY = y => y - cam.y;

    let cv = this._nightCv;
    if (!cv) cv = this._nightCv = document.createElement("canvas");
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c2 = cv.getContext("2d");
    if (!c2) return;
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.globalCompositeOperation = "source-over";
    c2.clearRect(0, 0, W, H);
    c2.fillStyle = "#04060d";
    c2.fillRect(0, 0, W, H);
    c2.globalCompositeOperation = "destination-out";

    const hole = (x, y, r, soft) => {
      if (!(r > 0)) return;
      const g = c2.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(soft == null ? 0.55 : soft, "rgba(0,0,0,.94)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c2.fillStyle = g;
      c2.fillRect(x - r, y - r, r * 2, r * 2);
    };
    /* 竖向椭圆版：把画布纵向拉扁后再画圆，得到竖着的椭圆。
     * 自带视野用它——人物是站着的，圆形光斑半径 50 只照到腰，脑袋还在黑里。 */
    const holeE = (x, y, rx, ry, soft) => {
      if (!(rx > 0 && ry > 0)) return;
      c2.save();
      c2.translate(x, y);
      c2.scale(1, ry / rx);
      const g = c2.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(soft == null ? 0.55 : soft, "rgba(0,0,0,.94)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c2.fillStyle = g;
      c2.fillRect(-rx, -rx, rx * 2, rx * 2);
      c2.restore();
    };
    const cone = (x, y, a, len, half) => {
      c2.save();
      c2.beginPath();
      c2.moveTo(x, y);
      c2.arc(x, y, len, a - half, a + half);
      c2.closePath();
      c2.clip();
      const g = c2.createRadialGradient(x, y, 0, x, y, len);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.5, "rgba(0,0,0,.95)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c2.fillStyle = g;
      c2.fillRect(x - len, y - len, len * 2, len * 2);
      c2.restore();
    };

    /* 1) 自己身边（私人视野，别的玩家屏幕上没有这一圈）。
     *    竖向椭圆 + 圆心抬到胸口：横向仍是约一格半，纵向多给一格把整个人照出来。 */
    if (me && !me.dead) holeE(SX(me.x), SY(me.y) - (N.selfDY || 40), N.selfR, N.selfRy || N.selfR, 0.32);
    /* 2) 公共亮光：只剩充电站（本模式不产能量包） */
    (this.stations || []).forEach(st => hole(SX(st.x), SY(st.y), N.pubR, 0.62));
    /* 3) 手电筒光锥：所有人的都画，所以你也能看见别人照亮的地方 */
    this.fighters.forEach(f => {
      if (f.kind !== "hero" || f.dead || f.bench || !f.flash) return;
      const x = SX(f.x), y = SY(f.y), a = Math.atan2(f.facing.y, f.facing.x);
      cone(x, y, a, N.coneLen, N.coneHalf);
      hole(x, y, N.coneR, 0.5);        // 根部近身一圈，转身时不会瞬间全黑
    });

    c2.globalCompositeOperation = "source-over";
    ctx.drawImage(cv, 0, 0);

    /* 光晕：让「这里亮着」看得出来（叠在黑幕之上，不遮挡） */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    (this.stations || []).forEach(st => {
      const x = SX(st.x), y = SY(st.y);
      const g = ctx.createRadialGradient(x, y, 0, x, y, N.pubR);
      g.addColorStop(0, "rgba(56,189,248,.15)");
      g.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, N.pubR, N.pubR * 0.62, 0, 0, TAU); ctx.fill();
    });
    ctx.restore();

    /* 黑暗条满：屏幕四周紫色告警 */
    if (me && !me.dead && (me.dark || 0) >= N.darkMax - 0.001) {
      const a = 0.22 + Math.sin(this.t * 8) * 0.12;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, "rgba(139,92,246,0)");
      g.addColorStop(1, "rgba(139,92,246," + a.toFixed(3) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  };

  /* ==========================================================
   *  交互键接管：没有可交互目标时，P = 手电筒开关
   * ========================================================== */
  const _doInteract = B.doInteract;
  B.doInteract = function (f) {
    if (this.rule !== "blackout" || !f || f.dead) return _doInteract.call(this, f);
    /* 蓄力中（在充电站旁按住了 P）→ 提前完成 / 取消，交回原逻辑 */
    if (f.chg) return _doInteract.call(this, f);
    /* 有可交互目标（充电站 / 能量包 / 车 / 柜子）→ 原逻辑，手电筒不抢 */
    if (this.interactTarget(f)) return _doInteract.call(this, f);
    /* 没有目标 = 按开关灯。这里不能像以前那样「先跑一遍 _doInteract 再看返回值」：
     * 原函数发现没有目标时，已经先把 f.interactCd 设成 0.35 才返回 false，
     * 于是连按两下 P 开灯再关灯时，第二下会被这个冷却挡掉，手电筒像是失灵。
     * 手电筒是本模式最高频的操作，单独走一遍开关，不受交互冷却影响。 */
    return this.toggleFlash(f);
  };

  const _interactLabel = B.interactLabel;
  B.interactLabel = function (f) {
    const s = _interactLabel.call(this, f);
    if (s) return s;
    if (this.rule === "blackout" && f && !f.dead) return f.flash ? "关手电" : "开手电";
    return s;
  };
})(window.LD = window.LD || {});
