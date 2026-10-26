/* ============================================================
 * 86_live2d.js —— 主菜单「伪 Live2D」（分层 + 变形器链）
 *
 * 结构照搬 psd2live / Cubism 的最小骨架：
 *
 *   1. 网格与图层：每个部位是一张独立 RGBA 位图（art mesh），
 *      **像素严格归属**，同一块像素只属于一个图层，绘制顺序决定谁盖谁
 *      （顺序写在 meta.json 的 order 里，从后往前画）。
 *   2. 变形器：位移场按高度切成 seg 段，每段有独立的相位滞后与幅度衰减，
 *      整个场是连续的 —— 相邻切带位移差不到 1px，不会撕缝。
 *   3. 物理：每段对应钟摆链上的一节。根部 pin≈1（几乎跟着身体），
 *      梢部 pin≈0（自由），所以波从根往梢跑、梢滞后回摆，形状是 S 不是平移。
 *
 * 为什么不用「整张图切横带」：那样位移会同时作用在天空和人物上，
 * 变成整张纸在晃。为什么不用「body 保留满 alpha、只把部位的颜色填掉」：
 * 部位层半透明的边缘会透出 body 上那份静止的同名像素，
 * 头发一动就出现两条错开的轮廓 —— 就是「严重虚影」。
 *
 * 坐标一律走「整帧 UV」：cover 把整帧铺满画布，每层记录自己在整帧里的
 * UV 矩形，运行时按同一套公式换算 —— 换图只改 meta.json，不用碰渲染代码。
 * ============================================================ */
(function (LD) {
  "use strict";
  const CFG = LD.LIVE2D || {};
  const W = CFG.w || 1600, H = CFG.h || 1000;
  const TAU = Math.PI * 2;
  const BK = CFG.blink || {};
  const DEF_ORDER = ["body", "skirt", "sword", "armA", "armB", "hair", "eye", "mouth"];

  const L = LD.Live2D = {
    ready: false,
    active: false,
    t: 0,
    frames: 0,
    fps: CFG.fps || 30,
    order: DEF_ORDER.slice(),
    layers: [],        // 会动的部位（bg / body / sword 是静态的）
    parts: {},         // name -> { img, src, buf, bx, rect, cfg, nextT }
    statics: {},       // name -> { cv, x, y }  静态图层（人物底、刀）
    cover: null,
    _patches: [],
    _bodyCv: null,     // 人物底单独一块画布，眨眼贴图从它上面取皮肤
    _bodyCx: null
  };

  let cv = null, ctx = null;
  let cover = null;                  // 整帧 -> 画布的取景（所有 UV 换算都靠它）
  let raf = 0, last = 0, acc = 0;
  let motes = [], moteSpr = null;
  let blinkAt = [], blinkNext = 1.6;

  /* ---------------- 小工具 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(a) { return a <= 0 ? 0 : (a >= 1 ? 1 : a * a * (3 - 2 * a)); }
  function mk2d(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return { c: c, x: c.getContext("2d") };
  }

  /* ---------------- 取景：整帧 cover 铺满画布 ---------------- */
  function computeCover(iw, ih) {
    const s = Math.max(W / iw, H / ih);
    const w = iw * s, h = ih * s;
    const fx = CFG.focusX == null ? 0.19 : CFG.focusX;
    const fy = CFG.focusY == null ? 0.5 : CFG.focusY;
    return { x: -(w - W) * fx, y: -(h - H) * fy, w: w, h: h, s: s };
  }

  /* UV 矩形 -> 画布矩形 */
  function uvRect(uv) {
    const c = cover;
    return {
      x: c.x + uv[0] * c.w,
      y: c.y + uv[1] * c.h,
      w: (uv[2] - uv[0]) * c.w,
      h: (uv[3] - uv[1]) * c.h
    };
  }

  /* ---------------- 变形器：钟摆链的稳态解 ----------------
   *
   * 第 j 节的响应：u_j(t) = A_j · [0.74 sin(ωt − φ_j) + 0.26 sin(2.37ωt − 1.6φ_j)]
   *   A_j = gain^j   —— 越往梢越软，幅度递减（能量的衰减）
   *   φ_j = lag·(j+1) —— 越往梢越滞后（波要跑过去）
   * 位移场 = amp × Σ(第 j 节在本高度上的覆盖比例 × u_j) / seg
   * 于是同一个时刻，根部、中段、梢部的相位和幅度都不同 —— 是一条 S 形的波浪，
   * 而不是整块平移，也不是纯正弦。
   */
  function segWave(c, j, t) {
    const w1 = c.per || 7;
    const w2 = c.per2 || w1 * 0.62;
    const ph = (c.ph || 0) + (c.lag || 0) * (j + 1);
    const a = Math.pow(c.gain == null ? 0.9 : c.gain, j);
    return a * (0.74 * Math.sin(t * TAU / w1 - ph)
              + 0.26 * Math.sin(t * TAU / w2 - ph * 1.7 + 1.2));
  }

  /* 归一化高度 yr（0=根，1=梢）处的累积位移（未乘 amp） */
  function chain(c, yr, t) {
    const n = c.seg || 6;
    const s = clamp(yr, 0, 1) * n;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const w = clamp(s - j, 0, 1);         // 这一节对本高度的覆盖比例
      if (w <= 0) break;
      sum += w * segWave(c, j, t);
    }
    return sum / n;
  }

  /* ---------------- 全局风场 ----------------
   *
   * 早先每一层各有一个独立的阵风包络（gust），结果是头发在吹、裙子不吹、
   * 过一会儿又反过来 —— 看着像几块布各自抽搐，而不是「山顶有风」。
   *
   * 真实的阵风是**同一个信号**传到不同东西上：先到头发，再到衣角，
   * 最后到裙摆（传播有延迟），而软的东西摆得大、硬的东西只跟着颤。
   * 所以这里只做一件事：产生一条共享的阵风强度曲线，谁用谁自己加延迟。
   *
   * 曲线 = 三个互不整除的慢波（4.3 / 9.4 / 16.5 秒）叠加，再加偶发的强阵风脉冲。
   * 只用慢波会「规律得像节拍器」；加上脉冲才有「一阵风突然刮过来」。
   */
  let gustAt = [], gustNext = 4.0, gustN = 0;
  function windG(t) {
    let g = 0.62
          + 0.24 * Math.sin(t * TAU / 9.4 + 0.7)
          + 0.11 * Math.sin(t * TAU / 4.3 + 2.1)
          + 0.07 * Math.sin(t * TAU / 16.5 + 4.2);
    while (gustNext < t + 12) {
      gustAt.push(gustNext);
      gustN++;
      /* 间隔用确定性哈希，不用 Math.random：
       * 同一秒数永远遇到同一阵风，截图能复现、测试能断言。
       * 真要随机感，哈希序列本身就没有可感知的周期。 */
      const r = (sacc(gustN, 7.7) + 1) * 0.5;
      gustNext += 7.0 + r * 6.0;   // 7~13 秒来一阵
    }
    if (gustAt.length > 48) gustAt = gustAt.slice(-24);
    for (let i = 0; i < gustAt.length; i++) {
      const e = t - gustAt[i];
      if (e < -1.3 || e > 3.0) continue;
      /* 起得快（1.3 秒爬升）、落得慢（0.75 秒时间常数）——
       * 对称的钟形曲线像呼吸，不像风；爬升再快就会看出「一帧跳一格」。 */
      const k = e < 0 ? smooth(1 + e / 1.3) : Math.exp(-e / 0.75);
      g += 0.62 * k;
    }
    return clamp(g, 0.10, 1.85);
  }

  /* 位移场：pin 是「钉住窗口」，pin[0] 以下一动不动，pin[1] 以上满幅。
   * 链本身已经让根部接近静止，pin 再兜一道底 —— 发根绝不能漂。 */
  function sample(p, yr, t) {
    const c = p.cfg;
    const pin = p.pin || c.pin || [0, 1];
    let a = smooth((yr - pin[0]) / Math.max(1e-6, pin[1] - pin[0]));
    /* edge 是「底边同样钉住」的窗口宽度。手臂必须用它：
     * 手腕以下留在 body 上不动，手臂层如果整条一起摆，肘部一动手腕就和手
     * 错开几像素，看着像手臂从手上滑脱。加了 edge，手臂变成「中间鼓、两头钉」
     * 的弓形，这才是被风吹的胳膊。裙摆/头发梢是自由边，不能加。 */
    if (c.edge) a *= smooth((1 - yr) / c.edge);
    if (a <= 0) return [0, 0];
    const g = windG(t - (c.wlag || 0));
    /* 风对摆动有两重作用，缺一不可：
     *   · 调制 —— 把原有的摆动放大/压低（风大时摆得更凶）
     *   · 推送 —— 一个只往风向推的恒定量，让左右摆不再对称
     * 只有调制就只是「抖得更厉害」，只有推送就只是「整块平移」，
     * 两者叠起来才像被风推着走的长发。 */
    const ch = chain(c, yr, t);
    const dx = c.amp * a * (ch * (0.55 + 0.45 * g) + (c.push == null ? 0 : c.push) * g);
    const ch2 = chain(c, yr, t * 0.87 + 1.3);
    const dy = c.amp * (c.vy || 0.1) * a
             * (ch2 * (0.55 + 0.45 * g) + (c.pushY == null ? 0 : c.pushY) * g);
    return [dx, dy];
  }

  /* ---------------- 建层 ---------------- */
  function addPart(name, pack, cfg) {
    const info = pack.layers[name];
    if (!info) return null;
    const rect = uvRect(info.uv);
    if (rect.w < 2 || rect.h < 2) return null;
    const pad = Math.ceil(Math.abs(cfg.amp || 0) * 1.15 + 6);
    const bw = Math.max(4, Math.round(rect.w) + pad * 2);
    const bh = Math.max(4, Math.round(rect.h) + pad * 2);
    const src = mk2d(bw, bh);
    const buf = mk2d(bw, bh);
    const p = {
      name: name,
      img: new Image(),
      src: src.c, sx: src.x,
      buf: buf.c, bx: buf.x,
      rect: rect,
      pad: pad,
      bw: bw, bh: bh,
      cfg: cfg,
      pin: cfg.pin || [0.0, 1.0],
      nextT: 0,
      step: cfg.step || 0.05,
      ok: false
    };
    p.cook = function () { cookPart(p); };
    L.parts[name] = p;
    L.layers.push(p);
    return p;
  }

  /* 图解码完：把图一次铺进「源缓冲」，之后切片只读它。
   * 所有图都在 init 末尾统一赋 src，免得先赋的那张在计数器还没摆好时就回调。
   *
   * 铺的时候必须按 rect 的尺寸画、并留出 pad 的透明边（和静态层一致），
   * 不能直接铺满 bw×bh —— buf 比 rect 大 pad*2，铺满等于把这一层**放大了**。
   * hair 的 pad 有 20px、rect 只有 400px 宽，一放大就是 5%，
   * 发梢离左上角最远，于是相对 body 的洞错开十几像素，看着就是「虚影」。
   */
  function cookPart(p) {
    const r = p.rect, pd = p.pad;
    const iw = p.img.width || 0, ih = p.img.height || 0;
    p.sx.setTransform(1, 0, 0, 1, 0, 0);
    p.sx.clearRect(0, 0, p.bw, p.bh);
    if (iw > 0 && ih > 0) {
      p.sx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in p.sx) p.sx.imageSmoothingQuality = "high";
      p.sx.drawImage(p.img, 0, 0, iw, ih, pd, pd, r.w, r.h);
    }
    p.ok = true;
    p.step = partStep(p);
  }

  /* 切横带变形（带横向切变）。
   *
   * 关键：每条带必须画成**平行四边形**，不能画成矩形。
   * 矩形版本虽然上下边缘对得上，但整条带是「横着平移」的 —— 第 i 条的左边落在
   * d0x、第 i+1 条落在 d1x，两者差 (d1x-d0x)。于是每一处接缝整条头发横向错开
   * 1~2px，几十条带累积下来长发就成了一级级台阶，放大看像发丝被切成一段段。
   * 换成切变矩阵后，第 i 条的下边缘和第 i+1 条的上边缘是同一条线段，严丝合缝。
   */
  function warpPart(p, t) {
    const bw = p.bw;
    p.bx.setTransform(1, 0, 0, 1, 0, 0);
    p.bx.clearRect(0, 0, bw, p.bh);
    const band = p.cfg.band || 16;
    /* 只切内容区（pad 那圈是透明边），并且按内容高度归一化 ——
     * 用 buf 高度算会让「根部不动」的那一段对不上真实发根。 */
    const top = p.pad, bot = p.pad + p.rect.h, eh = Math.max(1, p.rect.h);
    const ov = 0.7;
    for (let y = top; y < bot; y += band) {
      const hh = Math.min(band, bot - y);
      const d0 = sample(p, (y - top) / eh, t);
      const d1 = sample(p, (y + hh - top) / eh, t);
      /* 把这一带画成**平行四边形**（横向切变），而不是矩形。
       * 矩形版本上下边缘对得上，但整条是横着平移的：第 i 条左边在 d0x、
       * 第 i+1 条左边在 d1x，接缝处整头发横错 1~2px，几十条带累积成台阶，
       * 放大看就是发丝被切成一段段（用户说的「头发有一些断裂」）。 */
      const c = (d1[0] - d0[0]) / hh;                  // 横向切变
      const d = (hh + (d1[1] - d0[1])) / hh;           // 纵向拉伸
      if (d <= 0.02) continue;
      const e = d0[0] - y * c;
      const f = (y + d0[1]) - y * d;
      /* 相邻带在亚像素位置各盖一半时，source-over 合出来只有 0.75 的 alpha，
       * 会在头发上留一道浅色细线。往下多叠 0.7px 让覆盖超过 1，细线就没了。 */
      const sh = (y + hh < bot - 1e-6) ? hh + ov : hh;
      p.bx.setTransform(1, 0, c, d, e, f);
      p.bx.drawImage(p.src, 0, y, bw, sh, 0, y, bw, sh);
    }
    p.bx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* 多久重切一次：位移变化不足 0.3px 就复用上一帧的缓冲 */
  function partStep(p) {
    const c = p.cfg;
    const rate = Math.max(0.12, Math.abs(c.amp || 0) * TAU / Math.max(1, c.per || 7));
    return clamp(0.30 / rate, 1 / 30, 0.2);
  }

  /* ---------------- 刚性微动层（眼 / 嘴 / 刀） ----------------
   *
   * 这几层只有几十像素见方，用「切横带 + 变形」是杀鸡用牛刀：
   * 切带会把 40px 高的眼睛切成 2 条，接缝比位移本身还明显。
   * 它们要的是**整体刚体变换**：平移 + 缩放 + 旋转，一次 setTransform 搞定。
   *
   * 缩放锚点决定「像什么」：
   *   · 锚在底边（眼睛）—— sy<1 时上眼睑往下压 = 闭眼
   *   · 锚在顶边（嘴）  —— sy>1 时下唇往下走 = 张嘴
   * 锚点搞反的话，闭眼会变成眼球往上缩，一眼就假。
   */
  function sacc(k, s) {
    /* 确定性伪随机（同一个 k 永远同一个值）：扫视的「目标点」要稳定，
     * 否则每帧重新随机就变成无规律抖动，不是眼球在动。 */
    const x = Math.sin((k + 1) * 12.9898 + s) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

  function rigidPose(p, t) {
    const c = p.cfg;
    let dx = 0, dy = 0, sx = 1, sy = 1, rot = 0;
    const g = windG(t - (c.wlag || 0));

    if (c.gaze) {
      /* 眼球微扫视：每 1.3 秒换一个注视点，用 0.22 秒滑过去。
       * 连续的慢漂移一眼假（那是「代码在动」），
       * 离散的「看这儿、停一下、再看那儿」才像人在看东西。 */
      const q = c.gazeStep || 1.3;
      const k = Math.floor(t / q);
      const f = smooth((t - k * q) / (c.gazeGlide || 0.22));
      const a0 = sacc(k, c.ph || 0), a1 = sacc(k + 1, c.ph || 0);
      const q2 = q * 2.6;
      const k2 = Math.floor(t / q2);
      const f2 = smooth((t - k2 * q2) / 0.30);
      const b0 = sacc(k2, 3.1), b1 = sacc(k2 + 1, 3.1);
      dx += (c.amp || 0) * (a0 + (a1 - a0) * f);
      dy += (c.ampY || 0) * (b0 + (b1 - b0) * f2);
      /* 风大时眼睛稍稍眯一点：这 1% 的变化比位移更能让人感到「风打在脸上」 */
      sy *= 1 - (c.squint || 0) * clamp(g - 0.85, 0, 1);
    }

    if (c.open) {
      /* 呼吸带着嘴唇微开：相位比胸腔慢一点点，不是同一个节拍 */
      const b = 0.5 + 0.5 * Math.sin(t * TAU / (c.openPer || 13) + 0.9);
      sy *= 1 + c.open * b;
      dy += (c.openDy || 0) * b;
    }

    if (c.blink) {
      const k = blinkAmount(t);
      if (k > 0) {
        sy *= 1 - k * 0.94;                 // 压到 6% 厚度，留一点睫毛的实感
        dy += k * (c.blinkDy == null ? 0 : c.blinkDy);
      }
    }

    if (c.sway) {
      rot = c.sway * Math.PI / 180 * Math.sin(t * TAU / (c.swayPer || 9) + (c.ph || 0));
    }
    return { dx: dx, dy: dy, sx: sx, sy: sy, rot: rot };
  }

  function addRigid(name, pack, cfg) {
    const info = pack.layers[name];
    if (!info) return null;
    const rect = uvRect(info.uv);
    if (rect.w < 2 || rect.h < 2) return null;
    /* pad 要容得下最大位移 + 旋转扫过的量，否则画到缓冲边上会被切掉 */
    const pad = Math.ceil(Math.abs(cfg.amp || 0) + Math.abs(cfg.ampY || 0)
                          + Math.abs(cfg.amp || 0) * 0.6 + 4);
    const bw = Math.max(4, Math.round(rect.w) + pad * 2);
    const bh = Math.max(4, Math.round(rect.h) + pad * 2);
    const src = mk2d(bw, bh);
    const p = {
      name: name, kind: "rigid",
      img: new Image(), src: src.c, sx: src.x,
      buf: null, bx: null,
      rect: rect, pad: pad, bw: bw, bh: bh,
      cfg: cfg,
      pin: [0, 1],
      nextT: 0,
      step: 0.05,
      ok: false,
      anchor: cfg.anchor || "bottom"
    };
    p.cook = function () { cookPart(p); };
    L.parts[name] = p;
    L.layers.push(p);
    return p;
  }

  /* 眼皮盖住的部分**不画**，而不是「盖一层皮肤」。
   *
   * 早先是把 body 的皮肤重新画一遍盖上去 —— 但绘制坐标是小数（uvRect 出来的），
   * canvas 会重采样一次，画出来的皮肤和底下那层差一丝亮度，于是眨眼时
   * 眼睛位置浮出一块**有直边的补丁**。
   * 改成把眼球图层裁掉上半部分：露出来的是 body 原本就在那里的皮肤，
   * 同一份像素、同一次绘制，物理上不可能有色差和接缝。 */
  function clipBelowLid(p, k) {
    const r = p.contentRect || p.rect;
    const x0 = r.x, x1 = r.x + r.w, bot = r.y + r.h + 6;
    const N = 18;
    ctx.beginPath();
    ctx.moveTo(x0, lidEdge(p, k, 0));
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      ctx.lineTo(x0 + (x1 - x0) * u, lidEdge(p, k, u));
    }
    ctx.lineTo(x1, bot);
    ctx.lineTo(x0, bot);
    ctx.closePath();
    ctx.clip();
  }

  function drawRigid(p, t) {
    if (!p.ok) return;
    const c = p.cfg, r = p.rect, o = rigidPose(p, t);
    const ax = r.x + r.w / 2;
    const top = c.anchor === "top";
    const ay = top ? r.y : r.y + r.h;
    ctx.save();
    if (c.lidClip) {
      const k = blinkAmount(t);
      if (k > 0.002) clipBelowLid(p, k);
    }
    ctx.translate(ax + o.dx, ay + o.dy);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.sx, o.sy);
    ctx.drawImage(p.src, -r.w / 2 - p.pad, top ? -p.pad : -r.h - p.pad);
    ctx.restore();
  }

  /* ---------------- 静态层（人物底 / 刀） ---------------- */
  function buildStatic(name) {
    const info = L.pack && L.pack.layers[name];
    const img = L._imgs && L._imgs[name];
    if (!info || !img || !img.width) return;
    const r = uvRect(info.uv);
    const pad = 2;
    const bw = Math.max(4, Math.round(r.w) + pad * 2);
    const bh = Math.max(4, Math.round(r.h) + pad * 2);
    const c = mk2d(bw, bh);
    c.x.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in c.x) c.x.imageSmoothingQuality = "high";
    c.x.drawImage(img, 0, 0, img.width, img.height, pad, pad, Math.round(r.w), Math.round(r.h));
    L.statics[name] = { cv: c.c, x: r.x - pad, y: r.y - pad };
    if (name === "body") {
      L._bodyCv = c.c;
      L._bodyRect = { x: r.x - pad, y: r.y - pad, w: bw, h: bh };
    }
  }

  /* ---------------- 眨眼 ---------------- */
  function blinkAmount(t) {
    if (BK.on === false) return 0;
    if (BK.force === 1) return 1;
    while (blinkNext < t + 14) {
      blinkAt.push(blinkNext);
      const g0 = BK.gapMin == null ? 3.4 : BK.gapMin;
      const g1 = BK.gapMax == null ? 7.8 : BK.gapMax;
      blinkNext += g0 + Math.random() * (g1 - g0);
      if (Math.random() < 0.18) blinkNext += 0.30;   // 连眨：第二下很快跟上
    }
    if (blinkAt.length > 64) blinkAt = blinkAt.slice(-32);
    const cl = BK.close || 0.11, ho = BK.hold || 0.08, op = BK.open || 0.21;
    for (let i = blinkAt.length - 1; i >= 0; i--) {
      const e = t - blinkAt[i];
      if (e < 0) continue;
      if (e < cl) return e / cl;                    // 闭合
      if (e < cl + ho) return 1;                    // 闭住
      if (e < cl + ho + op) return 1 - (e - cl - ho) / op;   // 睁开
      break;
    }
    return 0;
  }

  const EYE_DEF = [{ u: 0.359, v: 0.1815, r: 0.013, h: 0.0086, len: 0.72 }];
  function eyeList() {
    const l = BK.lashes;
    return (l && l.length) ? l : EYE_DEF;
  }
  function eyeBox(e) {
    const c = cover;
    return {
      cx: c.x + e.u * c.w,
      cy: c.y + e.v * c.h,
      rx: Math.abs(e.r) * c.w,
      ry: Math.abs(e.h == null ? 0.0086 : e.h) * c.h
    };
  }

  /* 闭眼贴图：取眼睛下方那块干净皮肤，竖着拉满眼区，椭圆羽化。
   * 皮肤从 bodyCv 上取（人物底已经按 UV 铺好，坐标和画布一致）。 */
  function buildBlinkPatches() {
    const out = [];
    if (!L._bodyCv) return out;
    const list = eyeList();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      /* lid 表示这只眼由独立的 eye 图层负责（纵向压扁就是闭眼），
       * 不能再额外贴一块皮肤，否则两层叠在一起会把眼睑压得太白。
       * 睫毛线照画 —— 闭眼时真正「看得出闭了」的就是那条线。 */
      if (e.p === 0 || e.lid || e.lidFar) continue;
      const b = eyeBox(e);
      if (b.rx < 2) { out.push(null); continue; }
      const w = Math.max(3, Math.round(b.rx * 2 * 1.30));
      const hh = Math.max(3, Math.round(b.ry * 2 * 1.35));
      const x0 = Math.round(b.cx - w / 2), y0 = Math.round(b.cy - hh / 2);
      const skinH = Math.max(3, Math.round(b.ry * 1.9));
      const sy = Math.round(b.cy + b.ry * 0.95);
      const p = mk2d(w, hh);
      /* bodyCv 是「人物底自己的缓冲」，坐标要减掉它贴在画布上的偏移 */
      const br = L._bodyRect || { x: 0, y: 0 };
      try {
        p.x.drawImage(L._bodyCv, x0 - br.x, sy - br.y, w, skinH, 0, 0, w, hh);
      } catch (err) { out.push(null); continue; }
      p.x.globalCompositeOperation = "destination-in";
      p.x.save();
      p.x.translate(w / 2, hh / 2);
      p.x.scale(1, hh / w);
      const g = p.x.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.66, "rgba(0,0,0,1)");
      g.addColorStop(0.86, "rgba(0,0,0,0.55)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      p.x.fillStyle = g;
      p.x.fillRect(-w, -w, w * 2, w * 2);
      p.x.restore();
      p.x.globalCompositeOperation = "source-over";
      out.push({ c: p.c, x: x0, y: y0, w: w, h: hh });
    }
    return out;
  }

  /* 眼皮：一块**专门生成的闭眼皮肤**（lid 层）从上面扫下来盖住眼球。
   *
   * 为什么不缩放眼球：整只眼压到 6%，虹膜会压成扁疙瘩 —— 那不是眨眼。
   * 为什么不再用 body 的垫底皮肤：那是归一化卷积外推出来的，只有低频明暗，
   * 闭眼时就是一块「被抹平的肉」（用户说的眼部模糊）。现在 lid 层带真实的
   * 皮肤微纹理与上睑褶皱，1:1 下就是一块正常的眼皮。
   *
   * 下缘是弧不是直线（中间先合上），bow 跟着 k 一起长，
   * 这样刚开始眨的时候不会先盖掉一大块。
   */
  function edgeAt(r, k, u) {
    const kk = clamp(k, 0, 1);
    const drop = r.h * (0.94 * kk);
    /* 小眼睛（远眼）比例上要更弯一点，否则在 1:1 下就是一条直杠 */
    const bow = r.h * (r.h < 14 ? 0.17 : 0.14) * kk;
    return r.y + drop + bow * Math.sin(Math.PI * u);
  }

  function lidEdge(p, k, u) {
    return edgeAt(p.contentRect || p.rect, k, u);
  }

  function lashAt(r, e, k) {
    const len = clamp(e.len == null ? 0.76 : e.len, 0.3, 1);
    const xa = r.x + r.w * (1 - len) / 2;
    const xb = r.x + r.w * (1 + len) / 2;
    const wmax = Math.max(1, r.h * 0.13);
    const N = 18;
    let px = 0, py = 0;
    for (let s = 0; s <= N; s++) {
      const u = s / N;
      const mx = xa + (xb - xa) * u;
      const my = edgeAt(r, k, u);
      if (s > 0) {
        const taper = 0.30 + 0.70 * (1 - Math.pow(Math.abs(u - 0.5) * 2, 2.0));
        ctx.lineWidth = wmax * taper;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(mx, my);
        ctx.stroke();
      }
      px = mx; py = my;
    }
  }

  /* 眼皮下缘那条线 = 睫毛线。闭到哪儿，线就画到哪儿 */
  function drawLidLash(p, e, k) {
    lashAt(p.contentRect || p.rect, e, k);
  }

  /* 把闭眼皮肤裁到「眼皮下缘以上」：下缘以下的眼球还露着，以上已经被眼皮盖住。
   * 两块共用同一条下缘曲线，拼起来是严丝合缝的一次扫落，不是交叉淡入淡出。 */
  function clipAboveRect(r, k) {
    const x0 = r.x - 2, x1 = r.x + r.w + 2, top = r.y - r.h * 0.6;
    const N = 18;
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.lineTo(x1, top);
    ctx.lineTo(x1, edgeAt(r, k, 1));
    for (let i = N - 1; i >= 0; i--) {
      const u = i / N;
      ctx.lineTo(x0 + (x1 - x0) * u, edgeAt(r, k, u));
    }
    ctx.closePath();
    ctx.clip();
  }

  function clipAboveLid(p, k) {
    clipAboveRect(p.contentRect || p.rect, k);
  }

  function drawBlink(t) {
    const k = blinkAmount(t);
    if (k <= 0.004) return;
    const list = eyeList();

    ctx.save();

    /* ① 眼皮的裁切在 drawRigid 里完成（画眼球的时候就少画上半部分），
     *    这里负责把闭眼皮肤贴在下缘以上：近眼 lid、远眼 lidFar 同一套几何。 */
    const lid = L._lid, lidFar = L._lidFar;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.lid) {
        const p = L.parts.eye;
        if (!lid || !lid.ok || !p || !p.ok) continue;
        ctx.save();
        clipAboveLid(p, k);
        ctx.globalAlpha = 1;
        ctx.drawImage(lid.cv, lid.x, lid.y);
        ctx.restore();
      } else if (e.lidFar) {
        if (!lidFar || !lidFar.ok || !lidFar.content) continue;
        ctx.save();
        clipAboveRect(lidFar.content, k);
        ctx.globalAlpha = 1;
        ctx.drawImage(lidFar.cv, lidFar.x, lidFar.y);
        ctx.restore();
      }
    }

    /* ② 没有图层的眼：沿用旧的「贴皮肤 + 画弧」——它们多半被头发盖住，
     *    没有干净形状可切，多贴一块反而在头发上糊出色块。 */
    const a = clamp(k * 1.25, 0, 1);
    const pts = L._patches || [];
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!pt) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(pt.c, pt.x, pt.y);
    }

    /* ③ 睫毛线 */
    ctx.globalAlpha = clamp(k * 1.5, 0, 1);
    ctx.strokeStyle = BK.lashColor || "rgba(52,32,34,0.92)";
    ctx.lineCap = "round";
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.lid) {
        const p = L.parts.eye;
        if (p && p.ok) drawLidLash(p, e, k);
        continue;
      }
      if (e.lidFar) {
        if (lidFar && lidFar.ok && lidFar.content) lashAt(lidFar.content, e, k);
        continue;
      }
      /* 眼睑线：只画眼宽的 ~70%，中间粗两端细，否则像一条横杠 */
      const b = eyeBox(e);
      if (b.rx < 1.5) continue;
      const len = clamp(e.len == null ? 0.72 : e.len, 0.3, 1);
      const hx = b.rx * len;
      const w = Math.max(1, b.ry * 0.36);
      const N = 10;
      let px = 0, py = 0;
      for (let s = 0; s <= N; s++) {
        const u = s / N;
        const mx = (1 - u) * (1 - u) * (b.cx - hx)
                 + 2 * (1 - u) * u * b.cx
                 + u * u * (b.cx + hx);
        const my = (1 - u) * (1 - u) * (b.cy - b.ry * 0.40)
                 + 2 * (1 - u) * u * (b.cy + b.ry * 0.58)
                 + u * u * (b.cy - b.ry * 0.26);
        if (s > 0) {
          const taper = 0.35 + 0.65 * (1 - Math.pow(Math.abs(u - 0.5) * 2, 2.2));
          ctx.lineWidth = w * taper;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
        px = mx; py = my;
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------------- 光尘 ---------------- */
  function initMotes() {
    motes = [];
    const n = CFG.motes == null ? 16 : CFG.motes;
    if (!n) return;
    const s = mk2d(24, 24);
    const g = s.x.createRadialGradient(12, 12, 0, 12, 12, 12);
    g.addColorStop(0, "rgba(255,255,240,0.95)");
    g.addColorStop(0.35, "rgba(220,240,255,0.45)");
    g.addColorStop(1, "rgba(200,230,255,0)");
    s.x.fillStyle = g;
    s.x.fillRect(0, 0, 24, 24);
    moteSpr = s.c;
    for (let i = 0; i < n; i++) {
      motes.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 1.0 + Math.random() * 2.2,
        vx: 4 + Math.random() * 10, vy: -(1 + Math.random() * 3.4),
        ph: Math.random() * TAU, sp: 0.14 + Math.random() * 0.26
      });
    }
  }

  function drawMotes(t, dt) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x > W + 20) { m.x = -20; m.y = Math.random() * H; }
      if (m.y < -20) { m.y = H + 20; }
      const a = 0.30 + 0.42 * (0.5 + 0.5 * Math.sin(t * m.sp * TAU + m.ph));
      ctx.globalAlpha = a;
      const sz = m.r * 6;
      ctx.drawImage(moteSpr, m.x - sz / 2, m.y - sz / 2, sz, sz);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------------- 一帧 ---------------- */
  function frame(t, dt) {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* 1. 背景：按 cover 矩形铺（不是拉满画布）。
     *    拉满画布等于横向压扁 11%，人物和脚下的岩石就对不齐了 —— 这一条曾
     *    让人物看起来「浮」在背景上，怎么调立绘都对不上。 */
    const bg = L.parts.bg;
    if (bg && bg.ok) ctx.drawImage(bg.src, 0, 0);

    /* 2. 人物整体：呼吸缩放 + 重心摆动，锚点放在画面底部，脚才不会上下滑。
     *    光有呼吸（缩放）不够 —— 呼吸是「上下」，人站着还会左右换重心。
     *    绕脚底转 0.2~0.3 度，头顶就有 3~4px 的横移，静帧看不出，动起来
     *    整个人就「活」了。这是唯一作用到全部图层的位移。 */
    const bp = 1 + (CFG.breath || 0) * (1 + Math.sin(t * TAU / (CFG.breathPer || 13)));
    const SW = CFG.sway || {};
    let swx = 0, swr = 0;
    if (SW.on !== false && (SW.amp || SW.rot)) {
      const w = 0.62 * Math.sin(t * TAU / (SW.per || 11.5))
              + 0.38 * Math.sin(t * TAU / (SW.per2 || 4.6) + 1.2);
      swx = (SW.amp || 0) * w;
      swr = (SW.rot || 0) * Math.PI / 180 * w;
    }
    ctx.save();
    ctx.translate(W / 2 + swx, H);
    ctx.scale(bp, bp);
    ctx.translate(-W / 2, -H);
    /* 摆动的旋转支点必须是**角色的脚**，不是画布底边中点。
     * 绕画布中心转时，脚离支点还有一百多像素，脚会跟着横向平移 ——
     * 站位这么慢的滑动看不出来，但和岩石的接触点会「漂」，久了就别扭。 */
    if (swr) {
      const puv = SW.pivotUV || [0.33, 0.97];
      const pr = uvRect([puv[0], puv[1], puv[0], puv[1]]);
      ctx.translate(pr.x, pr.y);
      ctx.rotate(swr);
      ctx.translate(-pr.x, -pr.y);
    }

    /* 3. 按 order 从后往前画：静态层直接 blit，动态部位先变形再 blit。
     *    顺序来自 meta.json（素材怎么切就怎么画），代码里不再硬编码。 */
    const ord = L.order;
    for (let i = 0; i < ord.length; i++) {
      const name = ord[i];
      const p = L.parts[name];
      if (p) {
        if (!p.ok) continue;
        if (p.kind === "rigid") { drawRigid(p, t); continue; }
        if (t + 1e-9 >= p.nextT) { warpPart(p, t); p.nextT = t + p.step; }
        ctx.drawImage(p.buf, p.rect.x - p.pad, p.rect.y - p.pad);
      } else {
        const s = L.statics[name];
        if (s) ctx.drawImage(s.cv, s.x, s.y);
      }
    }

    /* 4. 眨眼压在最上面 */
    drawBlink(t);
    ctx.restore();

    if (moteSpr && motes.length) drawMotes(t, dt);
    L.frames++;
  }

  /* 立绘就绪后先画一帧静态的，避免菜单空一下 */
  function drawStatic() {
    if (!ctx) return;
    L._patches = buildBlinkPatches();
    frame(0, 0);
  }

  /* ---------------- 主循环 ---------------- */
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!L.active || !L.ready) return;
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    L.tick(dt);
  }

  L.tick = function (dt) {
    if (!L.ready || !L.active) return false;   // 不在菜单页就一点活也不干
    L.t += dt;
    acc += dt;
    const step = 1 / (L.fps || 30);
    if (acc < step) return false;
    acc = 0;                     // 卡顿过就丢掉欠账，不要连着补好几帧
    frame(L.t, dt);
    return true;
  };

  function start() {
    if (raf || !L.ready) return;
    last = 0; acc = 0;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    raf = 0; last = 0;
  }

  L.setActive = function (on) {
    on = !!on && CFG.on !== false;
    L.active = on;
    /* 不要在这里写「状态没变就直接 return」——那样会漏掉「启用时循环还没起」
     * 的情况（解码晚于 show("ovMenu")）。每次都按目标状态收敛一遍最省心。 */
    if (on) { if (L.ready && !raf) start(); }
    else stop();
    return L.active;
  };

  /* ---------------- 启动 ---------------- */
  L.init = function (canvas, legacySrc) {
    cv = canvas;
    /* 其它覆盖层（帮助 / 商店 / 关卡…）仍用合成图做 CSS 背景 */
    try {
      if (legacySrc) document.documentElement.style.setProperty("--menuBg", 'url("' + legacySrc + '")');
    } catch (e) { /* 无样式环境：忽略 */ }
    if (!cv || typeof cv.getContext !== "function") return L;
    ctx = cv.getContext("2d");
    if (!ctx || CFG.on === false) return L;

    const pack = (typeof window !== "undefined") ? window.LD_CHAR : null;
    if (!pack || !pack.layers || !pack.layers.bg) return L;   // 没有分层素材 → 退回 CSS
    L.pack = pack;

    const fr = pack.frame || [3840, 2156];
    cover = computeCover(fr[0], fr[1]);
    L.cover = cover;
    L.order = (pack.order && pack.order.length) ? pack.order.slice() : DEF_ORDER.slice();

    /* 所有图先建好、挂好回调，最后统一赋 src：这样计数器一定已经摆对了。 */
    const bgPart = {
      name: "bg", img: new Image(), src: null, sx: null, ok: false,
      cook: function () {
        const c = mk2d(W, H);
        const r = uvRect([0, 0, 1, 1]);
        const iw = bgPart.img.width || W, ih = bgPart.img.height || H;
        c.x.imageSmoothingEnabled = true;
        if ("imageSmoothingQuality" in c.x) c.x.imageSmoothingQuality = "high";
        /* 按 cover 矩形铺满画布（可能超出画布，超出的部分被裁掉 —— 正常） */
        c.x.drawImage(bgPart.img, 0, 0, iw, ih, r.x, r.y, r.w, r.h);
        bgPart.src = c.c;
        bgPart.ok = true;
      },
      rect: { x: 0, y: 0, w: W, h: H }, pad: 0, bw: W, bh: H,
      pin: [0, 1], cfg: {}
    };
    L.parts.bg = bgPart;

    /* 闭眼皮肤层（近眼 lid / 远眼 lidFar）：都不进 order，否则会被当成
     * 普通静态层整块画出来；只解码成画布，由 drawBlink 按眼皮下缘裁切着贴。
     * content 是「真实眼型」的 bbox，眼皮下缘的 k=0/1 用它算。 */
    function makeLidPart(name, info) {
      const part = {
        name: name, img: new Image(), ok: false, cv: null, x: 0, y: 0,
        content: info.content ? uvRect(info.content) : null,
        cook: function () {
          const r = uvRect(info.uv);
          const c = mk2d(r.w, r.h);
          c.x.imageSmoothingEnabled = true;
          if ("imageSmoothingQuality" in c.x) c.x.imageSmoothingQuality = "high";
          const iw = part.img.width || 0, ih = part.img.height || 0;
          if (iw > 0 && ih > 0) c.x.drawImage(part.img, 0, 0, iw, ih, 0, 0, r.w, r.h);
          part.cv = c.c; part.x = r.x; part.y = r.y; part.ok = true;
        }
      };
      return part;
    }
    const lidInfo = pack.layers.lid;
    const lidFarInfo = pack.layers.lidFar;
    L._lid = lidInfo ? makeLidPart("lid", lidInfo) : null;
    L._lidFar = lidFarInfo ? makeLidPart("lidFar", lidFarInfo) : null;
    const lidParts = [L._lid, L._lidFar].filter(Boolean);

    /* 静态层：order 里有、但不是动画部位的，各建一张独立画布 */
    L._imgs = {};
    const staticNames = L.order.filter(function (n) {
      return n !== "bg" && !(CFG.parts || {})[n] && pack.layers[n];
    });
    staticNames.forEach(function (n) { L._imgs[n] = new Image(); });

    /* 动画部位（只建对象，不赋 src）。kind 决定用哪种变形器：
     *   band  —— 切横带的软体（头发 / 裙摆 / 手臂）
     *   rigid —— 整体刚体变换的硬物（眼睛 / 嘴 / 刀）
     * 别在代码里列死部位名：加层只改 meta.json 与 10_data.js 的 parts。 */
    const PC = CFG.parts || {};
    Object.keys(PC).forEach(function (name) {
      const cfg = PC[name];
      if (!cfg || cfg.on === false || !pack.layers[name]) return;
      if (cfg.kind === "rigid") addRigid(name, pack, cfg);
      else addPart(name, pack, cfg);
    });

    /* 眼睑下缘的几何基准用「真实眼型」而不是带 6px padding 的层框，
     * 否则 k=1 时闭眼线会落到眼睛下方十几个像素的颊上。 */
    const eyePart = L.parts.eye;
    if (eyePart && pack.layers.eye && pack.layers.eye.content) {
      eyePart.contentRect = uvRect(pack.layers.eye.content);
    }

    const jobs = [bgPart].concat(lidParts, L.layers);
    L._expect = jobs.length + staticNames.length;
    L._loaded = 0;
    let fired = false;
    function done() {
      L._loaded++;
      if (L._loaded < L._expect || fired) return;
      fired = true;
      L.ready = true;
      drawStatic();
      /* 解码完必须把动画循环接上。
       *
       * 这里曾经只画一帧静态就结束 —— 而 UI.init() 末尾的 show("ovMenu")
       * 早就调过 setActive(true) 了，那时图片还没解码完、L.ready 还是 false，
       * start() 被跳过，raf 一直是 0。于是**主菜单永远是一张死图**，
       * 只有离开菜单再回来（第二次 setActive(true)）才会动。
       * 用户报的「live2d 效果没了」多半就是这个：全屏只是让他盯着静止画面看久了。 */
      if (L.active && !raf) start();
    }
    jobs.forEach(function (j) {
      j.img.onload = function () {
        try { j.cook(); } catch (e) { /* 单张失败不影响其它层 */ }
        done();
      };
      j.img.onerror = done;
    });
    staticNames.forEach(function (n) {
      L._imgs[n].onload = function () {
        try { buildStatic(n); } catch (e) { /* 单张失败不影响其它层 */ }
        done();
      };
      L._imgs[n].onerror = done;
    });

    /* 统一赋 src（放在最后） */
    bgPart.img.src = pack.layers.bg.src;
    lidParts.forEach(function (p) { p.img.src = pack.layers[p.name].src; });
    L.layers.forEach(function (p) { p.img.src = pack.layers[p.name].src; });
    staticNames.forEach(function (n) { L._imgs[n].src = pack.layers[n].src; });

    initMotes();
    return L;
  };

  /* ---------------- 对外接口（测试用） ---------------- */
  L.sample = sample;
  L.chain = chain;
  L.uvRect = uvRect;
  L.wind = windG;
  L.rigidPose = rigidPose;
  L.lidEdge = lidEdge;
  L.blink = blinkAmount;
  L.blinkAt = function () { return blinkAt.slice(); };
  L.rebuildPatches = function () { L._patches = buildBlinkPatches(); };
  L.bodyCanvas = function () { return L._bodyCv; };
})(window.LD = window.LD || {});

