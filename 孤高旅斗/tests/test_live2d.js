/* 孤高旅斗 v4.17 · 主菜单真·分层伪 Live2D 测试
 *
 * v4.17 的渲染管线换了骨架：不再是「一张合成图切横带」，而是
 *   背景(静止) -> 人物底 -> 头发 / 裙摆 / 左右手臂（各自独立 RGBA 位图）
 * 素材由 scripts/proc_char.py 切好、build.py 以 window.LD_CHAR 内嵌，
 * 运行时按「整帧 UV」把每层贴回画布。
 *
 * 因此断言也换了一套：
 *   1. 素材包结构（六层齐全、UV 在 0~1、眼部必须落在 body 里）
 *   2. 参数配置（四个部位、无云层、幅度/周期梯度、ramp 单调）
 *   3. 位移场（有界、平滑、根不动梢最大、相位滞后）
 *   4. 生命周期（解码前静默、解码后出静态帧、30fps 节流、菜单内外开关）
 *   5. 切带变形（宽度按位移差补偿 —— 不补偿就会撕出横缝）
 *   6. 眨眼（节奏、眼线长度、贴图）
 *   7. 点击反馈
 */
const SB = require("./_sandbox.js");
const { makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const html = SB.html;
const sb = makeSandbox("live2d");
const LD = sb.LD, L = LD.Live2D, CFG = LD.LIVE2D;
const UI = LD.UI;
const PACK = sb.LD_CHAR;

const menuHtml = html.slice(html.indexOf('id="ovMenu"'), html.indexOf("<!-- \u5355\u4eba -->"));

console.log("=== 1. 分层素材包真的进了单文件 ===");
{
  check("window.LD_CHAR 已内嵌", !!PACK && !!PACK.layers, PACK ? "ok" : "缺失");
  const layers = (PACK && PACK.layers) || {};
  check("十一层齐全（bg / body / skirt / sword / armA / armB / hair / eye / lid / lidFar / mouth）",
    ["bg", "body", "skirt", "sword", "armA", "armB", "hair", "eye", "lid", "lidFar", "mouth"].every(k => !!layers[k]),
    Object.keys(layers).join(","));
  check("整帧尺寸是 4K 母版 3840x2156",
    PACK && PACK.frame[0] === 3840 && PACK.frame[1] === 2156, PACK && PACK.frame.join("x"));
  const uriOk = n => /^data:image\/(webp|jpeg|png);base64,/.test((layers[n] || {}).src || "");
  check("每层都是内嵌 data URI（单文件不依赖外链）",
    Object.keys(layers).every(uriOk), Object.keys(layers).filter(n => !uriOk(n)).join(",") || "11/11");
  const uvOk = n => (layers[n].uv[0] >= 0 && layers[n].uv[2] <= 1.0001
    && layers[n].uv[1] >= 0 && layers[n].uv[3] <= 1.0001
    && layers[n].uv[2] > layers[n].uv[0] && layers[n].uv[3] > layers[n].uv[1]);
  check("每层 UV 都是 0~1 内的正矩形",
    Object.keys(layers).every(uvOk), Object.keys(layers).filter(n => !uvOk(n)).join(",") || "11/11");
  check("每层都有像素尺寸 px（用来算超采样比）",
    Object.keys(layers).filter(n => n !== "bg")
      .every(n => layers[n].px[0] > 16 && layers[n].px[1] > 16),
    Object.keys(layers).filter(n => n !== "bg").map(n => layers[n].px.join("x")).join(" "));

  /* 刀必须是独立一层：早先它留在人物底里、靠裙子「扣掉」让位，
   * 裙子一摆就露出静止的刀，看着像被撕成两段。 */
  check("刀是独立图层（不再靠裙子扣洞让位）", !!layers.sword);
  check("绘制顺序来自素材包：刀在裙摆之后、五官在最后", (() => {
    const o = PACK.order || [];
    return o.indexOf("sword") > o.indexOf("skirt")
      && o.indexOf("hair") > o.indexOf("armB")
      && o.indexOf("eye") > o.indexOf("hair")
      && o.indexOf("mouth") === o.length - 1;
  })(), (PACK.order || []).join(">"));
  check("人物底在最底层", (PACK.order || [])[0] === "body");

  /* 五官层必须**又小又准**：它们只能盖住眼/嘴那一块。
   * 一旦连着脸颊一起切进去，1.5px 的位移就会变成「一块皮肤在滑」。 */
  const eL = layers.eye || { uv: [0, 0, 0, 0], px: [0, 0] };
  check("眼睛层只有巴掌大（宽 < 4% 帧、高 < 3.5% 帧）",
    (eL.uv[2] - eL.uv[0]) < 0.04 && (eL.uv[3] - eL.uv[1]) < 0.035,
    (eL.uv[2] - eL.uv[0]).toFixed(3) + " x " + (eL.uv[3] - eL.uv[1]).toFixed(3));
  check("眼睛层 2 倍超采样（否则 1:1 渲染会糊）", eL.px[0] >= 100, eL.px.join("x"));
  const mh = layers.mouth || { uv: [0, 0, 0, 0] };
  check("嘴层比眼更小", (mh.uv[2] - mh.uv[0]) <= (eL.uv[2] - eL.uv[0]),
    (mh.uv[2] - mh.uv[0]).toFixed(3));

  /* 闭眼皮肤层：与 eye 完全同框，运行时两者共用一个 rect，
   * 眼皮下缘的裁切和眼线几何才能严丝合缝。 */
  const ld = layers.lid || { uv: [0, 0, 0, 0], px: [0, 0] };
  check("闭眼皮肤层与 eye 同 bbox 同像素（共用一个 rect）",
    ld.uv.every((v, i) => Math.abs(v - eL.uv[i]) < 1e-9)
    && ld.px[0] === eL.px[0] && ld.px[1] === eL.px[1],
    ld.uv.join(",") + " / " + ld.px.join("x"));
  check("眼层记了真实内容框（眨眼几何不按 padding 算）",
    !!layers.eye.content && layers.eye.content[2] > layers.eye.content[0] + 0.005
    && layers.eye.content[3] > layers.eye.content[1] + 0.005,
    (layers.eye.content || []).join(","));
  check("lid 不进 order（由眨眼单独裁切贴，否则会全天候盖住眼睛）",
    (PACK.order || []).indexOf("lid") < 0, (PACK.order || []).join(">"));
  /* 远眼（3/4 侧脸只剩鼻梁旁一条窄缝）也用同一套合成皮肤，只是贴片更小 */
  const lf = layers.lidFar || { uv: [0, 0, 0, 0], px: [0, 0], content: [0, 0, 0, 0] };
  check("远眼也有闭眼贴片（lidFar，带真实内容框）",
    !!layers.lidFar && lf.px[0] > 16 && lf.px[1] > 16
    && lf.content[2] > lf.content[0] + 0.002 && lf.content[3] > lf.content[1] + 0.002,
    lf.px.join("x") + " / " + (lf.content || []).join(","));
  check("远眼贴片明显比近眼小（侧脸只剩一条缝）",
    (lf.uv[2] - lf.uv[0]) < (eL.uv[2] - eL.uv[0]) * 0.6,
    (lf.uv[2] - lf.uv[0]).toFixed(3) + " < " + ((eL.uv[2] - eL.uv[0]) * 0.6).toFixed(3));
  check("lidFar 也不进 order", (PACK.order || []).indexOf("lidFar") < 0);

  const b = layers.body.uv;
  check("人物底覆盖画面主体（宽度 > 半帧、高度贯穿到底）",
    b[2] - b[0] > 0.5 && b[3] > 0.95, (b[2] - b[0]).toFixed(2) + " x " + b[3].toFixed(2));
  const eye = (CFG.blink.lashes || [])[0] || {};
  check("眼部落进人物底的 UV 范围内（否则眨眼取不到皮肤）",
    eye.u > b[0] && eye.u < b[2] && eye.v > b[1] && eye.v < b[3],
    "eye " + eye.u + "," + eye.v);
  const h = layers.hair.uv;
  check("头发层是一整条长发（竖向跨度 > 0.4 帧）", h[3] - h[1] > 0.4,
    (h[3] - h[1]).toFixed(2));
  check("头发层不碰脸（右边界在眼睛左边）", h[2] < (eye.u - 0.01),
    h[2].toFixed(3) + " < " + (eye.u - 0.01).toFixed(3));
  check("衣服与头发各占一块（UV 不完全重合）",
    Math.abs(layers.skirt.uv[0] - h[0]) > 0.02 || Math.abs(layers.skirt.uv[1] - h[1]) > 0.02);
  check("手臂层是细长条（宽度不到裙子的三分之一）",
    (layers.armA.uv[2] - layers.armA.uv[0]) < (layers.skirt.uv[2] - layers.skirt.uv[0]) / 3);
}

console.log("\n=== 2. 参数配置：软体四层 + 刚体两层，云不做了 ===");
{
  const P = CFG.parts || {};
  const SOFT = ["hair", "skirt", "armA", "armB"];
  const RIGID = ["eye", "mouth"];
  check("六个部位都配了（4 软 + 2 刚）",
    SOFT.concat(RIGID).every(k => !!P[k]), Object.keys(P).join(","));
  check("软体走切带变形、刚体走刚体变换（kind 分开，别混用）",
    SOFT.every(k => P[k].kind !== "rigid") && RIGID.every(k => P[k].kind === "rigid"),
    RIGID.map(k => P[k].kind).join("/"));
  check("云层已彻底移除（不残留 cloudHi / cloudSea 配置）",
    !/cloudHi|cloudSea/.test(JSON.stringify(CFG)));
  check("旧的合成图剪影 _figure 已删除", CFG._figure === undefined && CFG.layers === undefined);
  check("菜单 30 帧渲染（静态界面不空转 60 帧）", CFG.fps === 30 && CFG.on === true);
  check("渲染缓冲 1600x1000（4K 立绘才不白上采样）", CFG.w === 1600 && CFG.h === 1000,
    CFG.w + "x" + CFG.h);

  check("头发摆幅最大、手臂最克制",
    P.hair.amp > P.skirt.amp && P.skirt.amp > P.armA.amp && P.hair.amp > P.armA.amp * 3,
    [P.hair.amp, P.skirt.amp, P.armA.amp, P.armB.amp].join("/"));
  /* v4.18 整体提了幅度：头发 20.5→26、裙摆 12.5→16.5。
   * v4.19 起手臂从 6.2 收到 4.2：body 不再挖洞、改为整层压在上面之后，
   * 手臂边界会叠在 body 的同一块肤色上，4px 已经看得见风，再大就会露双影。
   * 上限放到 30 —— 真正该卡的是「实效位移」，见第 3 组。 */
  check("软体摆幅 1~30px", SOFT.every(k => P[k].amp >= 1 && P[k].amp <= 30),
    SOFT.map(k => P[k].amp).join("/"));
  check("比 v4.17 更大（头发 >24、裙摆 >15、手臂 >3.5）",
    P.hair.amp > 24 && P.skirt.amp > 15 && P.armA.amp > 3.5,
    [P.hair.amp, P.skirt.amp, P.armA.amp].join("/"));
  check("刚体位移克制（眼睛 ≤2px、嘴 ≤1px）",
    P.eye.amp <= 2 && P.mouth.amp <= 1, P.eye.amp + "/" + P.mouth.amp);
  check("节奏 4~12 秒一个来回（够慢，够孤高）",
    SOFT.every(k => P[k].per >= 4 && P[k].per <= 12), SOFT.map(k => P[k].per).join("/"));
  check("第二谐波比主周期快（波才不是纯正弦）",
    SOFT.every(k => P[k].per2 > 0 && P[k].per2 < P[k].per));
  check("pin 是从下往上的窗口（窗口内平滑放开，根部不动）",
    SOFT.every(k => {
      const r = P[k].pin;
      return r && r[0] >= 0 && r[1] <= 1 && r[1] > r[0];
    }), SOFT.map(k => P[k].pin.join("<")).join(" "));
  check("手臂两头都钉住（edge 窗口，否则手腕会从手上滑脱）",
    P.armA.edge > 0 && P.armB.edge > 0 && !P.hair.edge && !P.skirt.edge,
    P.armA.edge + "/" + P.armB.edge);
  check("链条分节 3~9 节（太少像刚体，太多每帧算不过来）",
    SOFT.every(k => P[k].seg >= 3 && P[k].seg <= 9), SOFT.map(k => P[k].seg).join("/"));
  check("每节幅度衰减 0.8~0.99（越往梢越软，但不能断成两截）",
    SOFT.every(k => P[k].gain >= 0.8 && P[k].gain < 1), SOFT.map(k => P[k].gain).join("/"));
  /* band 不是越小越好：每画一条带，上下边缘都落在亚像素位置，canvas 会铺一排
   * 抗锯齿半透明像素。band=5 时 545px 高的头发被切成 109 条，等于每 5px 盖一层
   * 半透明白纱 —— 整条马尾发灰发虚。12~28 既够平滑又干净。 */
  check("切带高度 12~28px（太碎会出抗锯齿横纹，太大则变形僵硬）",
    SOFT.every(k => P[k].band >= 12 && P[k].band <= 28), SOFT.map(k => P[k].band).join("/"));
  check("头发带相位滞后（波从发根流向发梢）", P.hair.lag > 0, P.hair.lag);
  check("阵风从头发传到裙摆有延迟（wlag 递增）",
    P.hair.wlag < P.armA.wlag && P.armA.wlag < P.skirt.wlag,
    [P.hair.wlag, P.armA.wlag, P.skirt.wlag].join("<"));
  check("风有恒定推力且朝左（和头发飘的方向一致）",
    P.hair.push < 0 && P.skirt.push < 0, P.hair.push + "/" + P.skirt.push);
  check("眼睛：锚在底边（闭眼是上眼睑往下压）", P.eye.anchor === "bottom");
  check("嘴：锚在顶边（张嘴是下唇往下走）", P.mouth.anchor === "top");
  check("嘴有呼吸开合量（0.02~0.10 之间才不夸张）",
    P.mouth.open > 0.02 && P.mouth.open < 0.1, P.mouth.open);
  /* 「全身都在动」靠两件事：各部位自己的位移 + 整个人绕脚下的重心摆动。
   * 只有前者的话，躯干是一块石头，头发裙子在上面飘 —— 一眼就是贴图。 */
  check("全身有重心摆动（横移 + 旋转，不只是呼吸缩放）",
    CFG.sway && CFG.sway.amp > 0 && CFG.sway.rot > 0,
    CFG.sway && (CFG.sway.amp + "px / " + CFG.sway.rot + "°"));
  check("摆动支点在脚下而不是画布中心（否则脚会慢慢打滑）",
    CFG.sway.pivotUV && CFG.sway.pivotUV[0] !== 0.5 && CFG.sway.pivotUV[1] > 0.9,
    CFG.sway.pivotUV && CFG.sway.pivotUV.join(","));
}

console.log("\n=== 3. 位移场：有界、平滑、根不动梢最大 ===");
{
  const SOFT = ["hair", "skirt", "armA", "armB"];
  const mk = k => ({ cfg: CFG.parts[k], pin: CFG.parts[k].pin });
  const probe = (p, yr, t) => L.sample(p, yr, t);

  let maxDx = 0, maxDy = 0;
  SOFT.forEach(k => {
    const p = mk(k);
    for (let t = 0; t <= 40; t += 0.7) {
      for (let y = 0; y <= 1.0001; y += 0.02) {
        const d = probe(p, y, t);
        maxDx = Math.max(maxDx, Math.abs(d[0]));
        maxDy = Math.max(maxDy, Math.abs(d[1]));
      }
    }
  });
  /* 上限 = amp ×（链条响应 + 风推力）。风峰值 1.85 时两项相加约 1.6 倍，
   * 再留 15% 余量。这条不是在测「好不好看」，是在防某次调参把头发甩出脑袋。 */
  check("横向位移不超过 1.75×amp（再大就是甩飞了）",
    maxDx <= CFG.parts.hair.amp * 1.75 + 1e-6, maxDx.toFixed(2) + "px");
  check("纵向位移不超过 0.6×amp（竖向只做辅助）",
    maxDy <= CFG.parts.hair.amp * 0.6 + 1e-6, maxDy.toFixed(2) + "px");
  /* 实效位移：链条的响应峰值约 0.8，再加风推力，头发尖端要真的动起来。
   * v4.17 是 10~16px，这一版要求 18~30px —— 肉眼能明显看出「风很大」。 */
  let tipMax = 0;
  for (let t = 0; t < 60; t += 0.05) tipMax = Math.max(tipMax, Math.abs(probe(mk("hair"), 1, t)[0]));
  check("头发尖端实效位移 18~30px（看得见在飘，又不散架）", tipMax >= 18 && tipMax <= 30,
    tipMax.toFixed(1) + "px");
  let tipSk = 0;
  for (let t = 0; t < 60; t += 0.05) tipSk = Math.max(tipSk, Math.abs(probe(mk("skirt"), 1, t)[0]));
  check("裙摆尖端实效位移 10~22px（比头发沉，但比 v4.17 大）", tipSk >= 10 && tipSk <= 22,
    tipSk.toFixed(1) + "px");

  check("pin[0] 以下完全不动（发根钉在头上）",
    SOFT.every(k => {
      const p = mk(k);
      for (let t = 0; t < 20; t += 1.3) {
        const d = probe(p, CFG.parts[k].pin[0], t);
        if (Math.abs(d[0]) > 1e-6 || Math.abs(d[1]) > 1e-6) return false;
      }
      return true;
    }));
  /* 手臂的底边必须也钉死：手腕以下留在 body 上不动，手臂层要是整条一起摆，
   * 肘部一动手腕就和手错开几像素，看着像手臂从手上滑脱。 */
  check("手臂底边（yr=1）位移为 0（手腕不会脱手）",
    ["armA", "armB"].every(k => {
      for (let t = 0; t < 20; t += 1.1) {
        if (Math.abs(probe(mk(k), 1, t)[0]) > 0.35) return false;
      }
      return true;
    }));
  check("梢部（yr=1）确实在动", (() => {
    const p = mk("hair");
    let m = 0;
    for (let t = 0; t < 12; t += 0.4) m = Math.max(m, Math.abs(probe(p, 1, t)[0]));
    return m > CFG.parts.hair.amp * 0.5;
  })());

  /* 平滑：0.1 秒之间的变化远小于 1px，否则是抽搐不是风吹 */
  let jump = 0;
  SOFT.forEach(k => {
    const p = mk(k);
    for (let t = 0; t <= 30; t += 0.37) {
      for (let y = 0.2; y <= 1; y += 0.1) {
        const a = probe(p, y, t), b = probe(p, y, t + 0.1);
        jump = Math.max(jump, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
  });
  /* 阈值跟着幅度走：v4.17 是 1.6px，现在头发 amp 从 20.5 提到 26、又加了阵风
   * 脉冲，0.1 秒的位移差自然更大。真正该保证的是「每帧仍是连续位移」——
   * 30fps 下 0.1 秒只有 3 帧，2.8px 换算过来约 0.9px/帧，看不出跳格。 */
  check("0.1 秒内位移变化 < 2.8px（一帧仍是连续位移，不是跳变）", jump < 2.8, jump.toFixed(3) + "px");

  /* 相位滞后：同一时刻，根与梢的位移必须不同，否则就是整块平移 */
  const wave = k => {
    const p = mk(k);
    const r = CFG.parts[k].pin;
    let m = 0;
    for (let t = 0; t < 20; t += 0.3) {
      m = Math.max(m, Math.abs(probe(p, r[0] + 0.02, t)[0] - probe(p, 1, t)[0]));
    }
    return m;
  };
  check("头发从根到梢有明显相位差（是波浪不是平移）", wave("hair") > 2.0, wave("hair").toFixed(2) + "px");
  check("裙摆同理", wave("skirt") > 1.5, wave("skirt").toFixed(2) + "px");

  /* ---- 共享风场 ---- */
  let gMin = 9, gMax = 0, gJit = 0, gPrev = null;
  for (let t = 0; t < 90; t += 0.05) {
    const g = L.wind(t);
    gMin = Math.min(gMin, g); gMax = Math.max(gMax, g);
    if (gPrev != null) gJit = Math.max(gJit, Math.abs(g - gPrev));
    gPrev = g;
  }
  check("风场有强弱起伏（不是恒定的 1.0）", gMin < 0.45 && gMax > 1.25,
    gMin.toFixed(2) + "~" + gMax.toFixed(2));
  /* 1 秒爬升的阵风，smoothstep 峰值斜率 1.5/s，叠加两个慢波约 0.3/s，
   * 上限就是 1.8/s —— 0.05 秒最多变 0.09。再大就不是风，是开关。 */
  check("风场连续（0.05 秒内变化 < 0.09）", gJit < 0.09, gJit.toFixed(4));
  check("风场有上限（不会把头发吹到屏幕外）", gMax <= 1.86, gMax.toFixed(2));
  check("没有风时也不会完全静止（恒有微风的底噪）", gMin > 0.05, gMin.toFixed(3));
  check("风场是纯函数（同一时刻取值唯一，不依赖调用顺序）", (() => {
    const a = L.wind(23.4), b = L.wind(23.4), c2 = L.wind(23.4);
    return a === b && b === c2;
  })());
  check("延迟真的改变了这一层收到的风（wlag 不是摆设）", (() => {
    const base = CFG.parts.skirt;
    const p = { cfg: base, pin: base.pin };
    const q = { cfg: Object.assign({}, base, { wlag: 0 }), pin: base.pin };
    let d = 0;
    for (let t = 0; t < 30; t += 0.11) {
      d = Math.max(d, Math.abs(L.sample(p, 1, t)[0] - L.sample(q, 1, t)[0]));
    }
    return d > 0.5;
  })());
}

console.log("\n=== 4. 生命周期 ===");
{
  check("解码前不就绪、一帧都不画", L.ready === false && L.frames === 0);
  check("没有 2D 上下文时静默返回", (() => {
    const keep = L.ready;
    const r = L.init(null, "");
    return r === L && L.ready === keep;
  })());
  check("立绘没解码完时 tick 不画也不报错", L.tick(0.1) === false && L.frames === 0);

  /* 模拟全部图层解码完成（宽高压上真实值，跟浏览器一致） */
  const SIZES = { webp: [400, 600], jpeg: [1440, 808] };
  sb.imgs.forEach(im => {
    const s = /jpeg/.test(im.src) ? SIZES.jpeg : SIZES.webp;
    im.width = s[0]; im.height = s[1];
    im.complete = true;
    try { if (im.onload) im.onload(); } catch (e) { console.log("    onload 抛错：" + e.message); }
  });
  check("解码完成后就绪", L.ready === true);
  check("六个动画部位都建好缓冲了", L.layers.length === 6,
    L.layers.map(p => p.name).join(","));
  check("每一层都有源缓冲（软体另有一块变形缓冲，刚体直接画源）",
    L.layers.every(p => p.src && p.bw > 4 && p.bh > 4)
    && L.layers.filter(p => p.kind !== "rigid").every(p => p.buf));
  check("缓冲尺寸 = 画布矩形 + 两侧留白（位移时不出白边）",
    L.layers.every(p => p.bw >= Math.round(p.rect.w) + p.pad * 2 - 1));
  check("留白不小于振幅（层动到最大也不会裁掉内容）",
    L.layers.every(p => p.pad >= Math.abs(p.cfg.amp || 0) + Math.abs(p.cfg.vy || 0)),
    L.layers.map(p => p.pad).join("/"));
  check("刚体层的锚点按配置区分（眼=底边、嘴=顶边）",
    L.parts.eye && L.parts.eye.anchor === "bottom"
    && L.parts.mouth && L.parts.mouth.anchor === "top");
  check("闭眼皮肤层解码后都建好了画布（近眼 + 远眼）",
    !!L._lid && L._lid.ok === true && !!L._lid.cv
    && !!L._lidFar && L._lidFar.ok === true && !!L._lidFar.cv,
    "lid=" + !!L._lid + " lidFar=" + !!L._lidFar);
  check("先画了一帧静态画面（菜单出现时不空白）", L.frames === 1, "frames=" + L.frames);
  check("人物底已经铺成独立画布（眨眼从这里取皮肤）", !!L.bodyCanvas());

  /* ---- 动画循环必须真的接上 ----
   * 曾经的 bug：done() 只 drawStatic() 一帧就结束，而 UI.init() 末尾的
   * show("ovMenu") 早于解码完成调用了 setActive(true)（那时 ready=false，
   * start() 被跳过）。结果主菜单是一张**死图**，要离开再回来才会动。
   * 沙箱里的 rAF 是可执行队列：走几步之后，仍在排队的循环数
   * 应该 = 游戏主循环 + live2d 循环 = 2（bug 版本只有 1）。 */
  for (let i = 0; i < 3; i++) SB.step(sb, 1);
  check("主菜单动画循环已接上（解码完成即启动，不用离开再回来）",
    sb.raf.length >= 2, sb.raf.length + " 个循环在排队");
  check("循环真的在推进时间（不是空转）", L.t > 0, L.t.toFixed(2) + "s");

  const c = L.cover;
  check("取景是 cover（按整帧比例铺满 1600x1000，不是拉伸）",
    c && Math.abs(c.w / c.h - 3840 / 2156) < 0.01 && c.w >= 1599.9 && c.h >= 999.9,
    c ? Math.round(c.w) + "x" + Math.round(c.h) : "null");
  check("取景横向偏移朝左（右边留给菜单文字）", c && c.x <= 0);
  const r1 = L.uvRect([0, 0, 1, 1]);
  check("uvRect 把整帧 UV 映射回整帧大小",
    Math.abs(r1.w - c.w) < 0.6 && Math.abs(r1.h - c.h) < 0.6,
    Math.round(r1.w) + "x" + Math.round(r1.h));
  check("头发层的画布矩形在画布左侧（人物在左，菜单在右）",
    L.parts.hair.rect.x < 1600 * 0.5, Math.round(L.parts.hair.rect.x));

  UI.show("ovHelp");
  check("离开主菜单就停（省电、不和战斗抢帧）", L.active === false);
  const f0 = L.frames;
  L.tick(0.5);
  check("非菜单页 tick 不画", L.frames === f0);

  UI.show("ovMenu");
  check("回到主菜单自动恢复", L.active === true);
  const f1 = L.frames;
  L.tick(0.001);
  check("不足 1/30 秒的那一次不画（30 帧节流）", L.frames === f1);
  L.tick(0.2);
  check("攒够一帧就画一次", L.frames === f1 + 1, "frames=" + L.frames);
  check("丢帧不追赶（长卡顿后也只补一帧）", (() => {
    const a = L.frames; L.tick(0.9); return L.frames === a + 1;
  })());
  check("每层的重切间隔都在 1/30~0.2 秒之间（不会每帧全量重画，也不会卡成幻灯片）",
    L.layers.every(p => p.step >= 1 / 30 - 1e-9 && p.step <= 0.2 + 1e-9),
    L.layers.map(p => p.step.toFixed(3)).join("/"));
}

console.log("\n=== 5. 切带变形：不许撕缝、不许把整层放大 ===");
{
  /* 每条带画成**平行四边形**（横向切变），而不是「补宽度的矩形」。
   * 矩形版本上下边缘对得上，但整条带横着平移，接缝处整头发错开 1~2px，
   * 几十条累积成台阶 —— 就是用户说的「头发有一些断裂」。 */
  const code = sb.Live2D === undefined ? html : html;
  check("横带用切变矩阵画（x' = X + (v/hh)·Δx），不是整块平移",
    /setTransform\(1,\s*0,\s*c,\s*d,\s*e,\s*f\)/.test(code));
  check("切变量 = 上下边缘位移差 / 带高", /c\s*=\s*\(\s*d1\[0\]\s*-\s*d0\[0\]\s*\)\s*\/\s*hh/.test(code));
  check("纵向拉伸量 = 带高 + 上下位移差 / 带高",
    /d\s*=\s*\(\s*hh\s*\+\s*\(\s*d1\[1\]\s*-\s*d0\[1\]\s*\)\s*\)\s*\/\s*hh/.test(code));
  check("平移量扣掉了切变在 y 处的那一项（e/f 都减 y·系数）",
    /e\s*=\s*d0\[0\]\s*-\s*y\s*\*\s*c/.test(code) && /f\s*=\s*\(\s*y\s*\+\s*d0\[1\]\s*\)\s*-\s*y\s*\*\s*d/.test(code));
  check("留了退化保护（纵向拉伸 <= 0 时不画反向四边形）", /d\s*<=\s*0\.02/.test(code));
  check("相邻带多叠 0.7px（亚像素接缝各盖一半会留浅色细线）",
    /const\s+ov\s*=\s*0\.7/.test(code) && /hh\s*\+\s*ov/.test(code));
  check("没有退回「补宽度」的旧写法", !/bw\s*\+\s*\(\s*d1\[0\]\s*-\s*d0\[0\]\s*\)/.test(code));

  /* 层缓冲比 rect 大一圈 pad，是为了给位移留出边。
   * 铺图时必须按 rect 的尺寸画、把内容放在 pad 处；直接铺满 bw×bh 等于把
   * 整层放大 (bw/rect.w) 倍 —— hair 的 pad 是 19px、rect 只有 371px，
   * 一放大就是 10%，发梢相对 body 挖出的洞错开三十多像素，看着像「严重虚影」。 */
  check("源缓冲按 rect 尺寸铺图、内容从 pad 处起画",
    /drawImage\(p\.img,\s*0,\s*0,\s*iw,\s*ih,\s*pd,\s*pd,\s*r\.w,\s*r\.h\)/.test(code));
  check("没有「把图铺满 bw×bh」的旧写法（那会把整层放大）",
    !/drawImage\(p\.img,[^)]*?0,\s*0,\s*p\.bw,\s*p\.bh\)/.test(code));
  check("切带高度基准用 rect.h 而不是 buf 高度（否则 ramp 对不上发根）",
    /\(\s*y\s*-\s*top\s*\)\s*\/\s*eh/.test(code));

  /* 切带高度不能太小：每条带的上下边缘都落在亚像素位置，canvas 会铺一排
   * 抗锯齿半透明像素。band=5 时 545px 高的头发被切成 109 条，
   * 等于每 5px 盖一层半透明白纱，整条马尾发灰发虚。 */
  check("切带别太碎（band 12~28，太小会出抗锯齿横纹）",
    ["hair", "skirt", "armA", "armB"].every(k => L.parts[k].cfg.band >= 12 && L.parts[k].cfg.band <= 28),
    ["hair", "skirt", "armA", "armB"].map(k => L.parts[k].cfg.band).join("/"));

  const p = L.parts.hair;
  const band = p.cfg.band;
  const seq = t => {
    const ys = [];
    const top = p.pad, bot = p.pad + p.rect.h, eh = p.rect.h;
    for (let y = top; y < bot; y += band) {
      const hh = Math.min(band, bot - y);
      const d0 = L.sample(p, (y - top) / eh, t), d1 = L.sample(p, (y + hh - top) / eh, t);
      ys.push({ top: y + d0[1], bot: y + hh + d1[1] });
    }
    return ys;
  };
  let seam = 0;
  [0, 1.7, 5.3, 11.2].forEach(t => {
    const ys = seq(t);
    for (let i = 1; i < ys.length; i++) seam = Math.max(seam, Math.abs(ys[i].top - ys[i - 1].bot));
  });
  check("相邻带首尾严丝合缝（误差 < 1e-6，肉眼无横缝）", seam < 1e-6, seam.toExponential(1));
  check("带的条数合理（头发 < 200 条，不至于每帧卡住）", seq(0).length < 200, seq(0).length + " 条");
  check("变形调用不抛错", (() => {
    try { p.cook(); L.layers.forEach(q => q.cook()); return true; } catch (e) { return false; }
  })());
}

console.log("\n=== 6. 眨眼 ===");
{
  const B = CFG.blink || {};
  check("眨眼功能开着，且每只眼睛都配了中心与半宽半高",
    B.on === true && (B.lashes || []).length >= 2
    && B.lashes.every(e => e.r > 0.003 && e.h > 0.003 && e.u > 0 && e.v > 0),
    (B.lashes || []).map(e => e.u + "," + e.v).join(" | "));
  check("单次眨眼 0.28~0.5 秒（刻意放慢，显得松弛）", (() => {
    const d = (B.close || 0) + (B.hold || 0) + (B.open || 0);
    return d >= 0.28 && d <= 0.5;
  })(), ((B.close + B.hold + B.open) || 0).toFixed(2) + "s");
  check("闭合、睁开两段都不短于 0.08 秒（不是机械开关）",
    (B.close || 0) >= 0.08 && (B.open || 0) >= 0.12 && (B.open || 0) > (B.close || 0));
  check("两次之间隔 3 秒以上（不频繁）", (B.gapMin || 0) >= 3 && (B.gapMax || 0) > (B.gapMin || 0),
    B.gapMin + "~" + B.gapMax + "s");
  check("眼线只画眼宽的 60%~80%（画满会变成一条横杠）",
    (B.lashes || []).every(e => (e.len || 0) > 0.55 && (e.len || 0) < 0.85),
    (B.lashes || []).map(e => e.len).join("/"));
  /* 近眼有独立图层。闭眼**不是压扁眼球**（那会把虹膜压成扁疙瘩），
   * 而是让一块**生成的闭眼皮肤**（lid 层）从上面扫下来盖住眼球；
   * 下缘以下仍然露着原本的眼球，两块共用同一条下缘曲线。
   * 不再拿 body 垫底皮肤临时顶替：那块只有低频，闭眼会糊成一块。 */
  check("近眼交给独立皮肤层闭合（lashes 里标了 lid）",
    (B.lashes || []).some(e => e.lid === "lid"));
  check("闭合不靠压扁眼球（rigidPose 里不再有 blink 缩放）",
    !CFG.parts.eye.blink && CFG.parts.eye.lidClip === true
    && /function clipBelowLid\(/.test(html),
    CFG.parts.eye.blink ? "仍在缩放" : "改用眼皮裁切");
  check("眼皮是「生成的闭眼皮肤 + 下缘裁切」，不再拿 body 垫底重贴",
    /function clipAboveLid\(/.test(html) && /clipAboveLid\(p, k\)/.test(html)
    && !/function drawLidShade\(/.test(html));
  check("闭眼皮肤层真的参与加载（不是只写进素材包）",
    /L\._lid/.test(html) && /lidInfo/.test(html));
  check("眼皮下缘随 k 从眼上缘扫到眼下缘", (() => {
    const p = L.parts.eye;
    if (!p || !L.lidEdge) return false;
    const a = L.lidEdge(p, 0, 0.5), b = L.lidEdge(p, 1, 0.5);
    return b > a + p.rect.h * 0.8;
  })());
  check("眼皮下缘是弧不是直线（中间比两端低）", (() => {
    const p = L.parts.eye;
    if (!p || !L.lidEdge) return false;
    const mid = L.lidEdge(p, 0.5, 0.5);
    const end = L.lidEdge(p, 0.5, 0);
    return mid > end + 1;
  })());
  check("眼皮下缘按真实眼型算（k=1 落在内容框底部附近，不落到颊上）", (() => {
    const p = L.parts.eye;
    if (!p || !L.lidEdge) return false;
    const c = p.contentRect || p.rect;
    const b = L.lidEdge(p, 1, 0.5);
    return b > c.y + c.h * 0.9 && b < c.y + c.h * 1.2;
  })(), (() => {
    const p = L.parts.eye;
    const c = p.contentRect || p.rect;
    return "edge=" + L.lidEdge(p, 1, 0.5).toFixed(1) + " content=" + c.y.toFixed(1) + "+" + c.h.toFixed(1);
  })());
  check("不眨眼时眼睛不变形", (() => {
    const o = L.rigidPose(L.parts.eye, 5.0);
    return o.sy > 0.9 && o.sy <= 1.001;
  })());
  check("眼球有离散的微扫视（会停、会换点，不是连续漂移）", (() => {
    const xs = [];
    for (let t = 0; t < 20; t += 0.05) xs.push(L.rigidPose(L.parts.eye, t).dx);
    let still = 0;
    for (let i = 3; i < xs.length; i++) {
      if (Math.abs(xs[i] - xs[i - 3]) < 0.03) still++;
    }
    const range = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    return still / xs.length > 0.6 && range > 0.6;
  })(), (() => {
    const xs = [];
    for (let t = 0; t < 20; t += 0.05) xs.push(L.rigidPose(L.parts.eye, t).dx);
    let still = 0;
    for (let i = 3; i < xs.length; i++) {
      if (Math.abs(xs[i] - xs[i - 3]) < 0.03) still++;
    }
    return (100 * still / xs.length).toFixed(0) + "% 时间静止, 摆幅 "
      + (Math.max.apply(null, xs) - Math.min.apply(null, xs)).toFixed(2) + "px";
  })());
  check("嘴随呼吸微微开合（sy 1.00~1.06，不是一直张着）", (() => {
    let lo = 9, hi = 0;
    for (let t = 0; t < 30; t += 0.2) {
      const o = L.rigidPose(L.parts.mouth, t);
      lo = Math.min(lo, o.sy); hi = Math.max(hi, o.sy);
    }
    return lo >= 0.999 && hi > 1.02 && hi < 1.08;
  })());

  check("远眼也有闭眼贴片（不再靠「贴皮肤 + 画弧」的旧兜底）",
    (B.lashes || []).some(e => e.lidFar === "lidFar")
    && (B.lashes || []).every(e => e.p !== 0));
  check("眼线有颜色且不是纯黑", /rgba?\(/.test(B.lashColor || ""), B.lashColor);

  const sched = L.blinkAt();
  check("已经排好后续的眨眼时刻", sched.length >= 2, sched.length + " 次");
  check("开场 1 秒内不眨眼（一进菜单就眨很假）",
    sched.every(s => s >= 1) && L.blink(0) === 0);

  let peakOk = true, tailOk = true;
  sched.slice(0, 6).forEach(s => {
    let peak = 0;
    for (let t = s - 0.02; t <= s + 0.42; t += 0.004) peak = Math.max(peak, L.blink(t));
    if (Math.abs(peak - 1) > 0.001) peakOk = false;
    if (L.blink(s + 0.65) > 0.002) tailOk = false;
  });
  check("每一下都完整闭到底（峰值 = 1）", peakOk);
  check("眨完就立刻睁开（尾巴回到 0）", tailOk);

  let closed = 0, total = 0;
  for (let t = 0; t < 60; t += 0.02) { if (L.blink(t) > 0.5) closed++; total++; }
  check("闭眼时间占比 < 10%（隔一会儿才眨一下）", closed / total < 0.10,
    (100 * closed / total).toFixed(1) + "%");

  /* 两只眼睛各有一张闭眼皮肤贴片：近眼与 eye 同框、远眼贴在鼻梁旁那条窄缝上。
   * 眼线都由运行时沿各自的下缘画，旧兜底路径只在没有贴片的第三只眼上才用得到。 */
  check("不再需要「闭眼皮肤贴图」（近眼走图层、远眼只画线）",
    (L._patches || []).length === 0,
    (L._patches || []).length + " 张");

  const iWarp = html.indexOf("warpPart(p, t)");
  const iBlink = html.indexOf("drawBlink(t)");
  check("眨眼画在所有图层之后（否则睫毛会被头发盖掉）", iWarp > 0 && iBlink > iWarp);
  check("每帧都走一遍时间线（眨眼不会卡住）",
    sched.length >= 2 && L.blink(sched[sched.length - 1] + 0.03) > 0);
  check("没有闭眼时完全不贴（0 成本）", L.blink(sched[sched.length - 1] + 2.5) < 0.002);
}

console.log("\n=== 7. 点击反馈 ===");
{
  check("主菜单里有动态立绘画布 #menuBg", /id="menuBg"/.test(menuHtml));
  check("七个入口都在", ["mSolo", "mMulti", "mSkin", "mSkill", "mLoad", "mAch", "mHelp"]
    .every(id => menuHtml.indexOf('id="' + id + '"') > 0), "7/7");
  check("每个入口只有名字（介绍文字已删除）", (menuHtml.match(/class="mLab"/g) || []).length === 7
    && menuHtml.indexOf('class="md"') < 0);

  const it = sb.els.mSolo;
  check("主菜单选项已绑定点击", !!it && typeof it.onclick === "function");
  if (it) {
    it.classList.add("mItem");
    it.onclick();
    check("点下去立刻挂上位移动画", it.classList.contains("hit"));
    check("切页延后 130ms（让人看见那一下偏移）", UI.screen === "ovMenu", UI.screen);
    UI.show("ovHelp");
    check("这期间别处已经切页 → 让路，不抢回来", UI.screen === "ovHelp", UI.screen);
    UI.show("ovMenu");
  }
  const sDrag = sb.els.sDrag;
  check("其它按钮维持立刻响应（不被延迟拖累）", !!sDrag && typeof sDrag.onclick === "function");
}

console.log("\n=== 8. v4.17 玻璃主题与按压反馈 ===");
{
  check("房间界面（人机 + 联机）都挂上了 glass 主题",
    (html.match(/class="ov hide glass"/g) || []).length === 2,
    ((html.match(/class="ov hide glass"/g) || []).length) + " 个");
  check("玻璃主题去掉了实心深底（只留一层径向薄雾）",
    /\.ov\.glass\{[\s\S]{0,400}radial-gradient/.test(html));
  check("角色卡改成透明 + 白描边", (() => {
    const i = html.indexOf(".ov.glass .pcard{");
    if (i < 0) return false;
    const seg = html.slice(i, i + 260);
    return /rgba\(6,10,20,\.\d+\)/.test(seg) && /rgba\(255,255,255,\.\d+\)/.test(seg);
  })());
  check("选中态统一为白描边 + 白光", /\.ov\.glass \.lv\.sel,[\s\S]{0,200}border-color:#fff/.test(html));
  check("主按钮是白底墨字（整屏唯一高对比）",
    /\.ov\.glass \.roomfoot \.btn,[\s\S]{0,160}color:#0a1020/.test(html));
  check("按下态 .press 会下沉并提亮", /\.ov \.press\{[\s\S]{0,160}translateY\(1\.5px\)/.test(html));

  check("UI 暴露了统一的按压接口", typeof UI.pressDown === "function" && typeof UI.pressUp === "function");
  const it = sb.els.mSolo;
  check("按下瞬间给元素挂 .press", (() => {
    if (!it || typeof UI.pressDown !== "function") return false;
    UI.pressDown({ target: { closest: () => it } });
    return it.classList.contains("press");
  })());
  check("松手不会立刻硬拔（留给 110ms 动画时间）", (() => {
    UI.pressUp();
    return it.classList.contains("press");      // 定时器还没到，仍是按下态
  })());
  check("按下别的元素会先松开上一个", (() => {
    const other = sb.els.mMulti || objectEl();
    UI.pressDown({ target: { closest: () => other } });
    const ok = other.classList.contains("press") && !it.classList.contains("press");
    UI.pressUp();
    return ok;
  })());
  function objectEl() {
    const s = new Set();
    return {
      disabled: false,
      classList: { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }
    };
  }
  check("锁定态不参与按压（.lock 的卡片按下去不该有反馈）", (() => {
    const e = objectEl();
    e.classList.add("lock");
    UI.pressDown({ target: { closest: () => e } });
    return !e.classList.contains("press");
  })());
  check("空目标 / 无 closest 时静默返回", (() => {
    try { UI.pressDown(null); UI.pressDown({ target: {} }); UI.pressUp(); return true; }
    catch (e) { return false; }
  })());
}

console.log("\n=== 9. 全屏 / 最大化：四周不能是黑框 ===");
{
  check("shell 里有环境底层 #ambient", /id="ambient"/.test(html));
  check("环境底复用同一张立绘（--menuBg 变量，不额外内嵌一份字节）",
    /#ambient\{[^}]*var\(--menuBg/.test(html));
  check("背景图之外做「过渡」，不是刷成纯白（用户明确要的收边方式）", (() => {
    if (!/#ambient\{[^}]*background-color:#fff/.test(html)) return false;
    if (!/#ambient\{[^}]*rgba\(255,255,255,0\)/.test(html)) return false;
    /* 渐变最外一圈的白色不透明度必须 < 0.9：拉满就是一块白衬纸，
     * 会把背景图彻底盖掉 —— 用户要的是「和背景图过渡」。 */
    const m = /#ambient\{[^}]*rgba\(255,255,255,\.(\d+)\)\s*100%/.exec(html);
    return !!m && parseInt(m[1], 10) < 90;
  })(), (() => {
    const m = /#ambient\{[^}]*rgba\(255,255,255,\.(\d+)\)\s*100%/.exec(html);
    return m ? "最外圈白 " + (parseInt(m[1], 10) / 100).toFixed(2) : "未找到终止色";
  })());
  check("环境底必须模糊（不糊就和卡片的取景对不齐，一眼看出两套裁切）",
    /#ambient\{[^}]*filter:blur\(/.test(html));
  check("环境底默认透明、按需点亮（小窗口不多一层合成开销）",
    /#ambient\{[^}]*opacity:0/.test(html) && /#ambient\.on\{opacity:1\}/.test(html));

  const amb = sb.document.getElementById("ambient");
  const bodyEl = sb.document.body;
  const appEl = sb.document.getElementById("app");
  /* 注意：改视口要改**沙箱全局对象**上的 innerWidth（sb.sb），
   * 改外面这层包装对象的同名属性是无效的（那只是拷贝值）。 */
  const win = sb.sb;
  const fire = () => { (sb.L.resize || []).forEach(f => f()); };

  win.innerWidth = 1010; win.innerHeight = 640; fire();
  check("小窗口不点亮环境底（舞台本来就基本贴边）",
    !bodyEl.classList.contains("wide") && !amb.classList.contains("on"), "1010x640");

  win.innerWidth = 1920; win.innerHeight = 1080; fire();
  check("全屏点亮环境底（背景铺满整个窗口，不再是黑框）",
    bodyEl.classList.contains("wide") && amb.classList.contains("on"), "1920x1080");
  check("舞台仍按 1.4 上限缩放（放大 960x600 的游戏画布只会糊，缺的边交给环境底）",
    /scale\(1\.4\)/.test(appEl.style.transform), appEl.style.transform);

  win.innerWidth = 1010; win.innerHeight = 640; fire();
  check("缩回小窗口自动关掉环境底", !amb.classList.contains("on"));
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
