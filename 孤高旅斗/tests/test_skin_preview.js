/* 孤高旅斗 v4.13e 皮肤贴图异步解码导致「我的配装显示成乱配的一套」
 *
 * 背景：v2.8 起的图片皮肤（套装）是 data URI 贴图，new Image() 之后要等 load 事件才画得出来。
 * 首帧画预览时贴图往往还没解码，drawImgPart 只能返回 false，角色被画成「部件兜底色的普通少年」——
 * 玩家看到的就是「我的配装怎么不是我那一套」。而贴图到位后的回调 V.onSkinImgLoad 只重画了皮肤商店，
 * 「我的配装」/ 房间角色卡一直停在兜底画面，直到点改名 / 随机配装触发整页重渲染才恢复。
 *
 * 本文件覆盖：
 *   1. 启动即预热当前穿戴的三张贴图（解码提前开始）
 *   2. heroPreview 自己登记补画：贴图到位后按同一份 look 重画那张画布
 *   3. 贴图已就绪时不多画、不排队
 *   4. 贴图到位不再整页重建皮肤商店 DOM
 *   5. 没有贴图 / 环境没有 Image 时静默降级
 */
const SB = require("./_sandbox.js");
const { makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

/* 计数画布：heroPreview 每次绘制都会 clearRect，用它数「这张画布被画了几次」 */
function countCanvas(w, h) {
  const st = { n: 0 };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === "clearRect") return () => { st.n++; };
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
      if (k === "createPattern") return () => ({});
      if (k === "measureText") return () => ({ width: 120 });
      if (k === "canvas") return { width: w, height: h };
      if (typeof k === "symbol") return undefined;
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return { width: w, height: h, getContext: () => ctx, st };
}

/* ---- 先造一份「穿着图片套装」的存档 ---- */
const seed = makeSandbox("seed");
const suit = seed.LD.SUITS[0];                       // 奶蛙：三件都是贴图部件
seed.LD.Profile.d.ownedParts = [suit.pieces.head, suit.pieces.upper, suit.pieces.lower,
                                seed.LD.FREE.head, seed.LD.FREE.upper, seed.LD.FREE.lower];
seed.LD.Profile.d.equip = { head: suit.pieces.head, upper: suit.pieces.upper, lower: suit.pieces.lower };
seed.LD.Profile.save();
const SAVED = seed.localStorage.getItem("ld_profile_v3");
const IMG_KEYS = [suit.pieces.head, suit.pieces.upper, suit.pieces.lower]
  .map(id => (seed.LD.part(id) || {}).img);

console.log("=== 1. 带着存档重新打开游戏 ===");
const sb = makeSandbox("首帧", { storage: { ld_profile_v3: SAVED } });
const LD = sb.LD, V = LD.View, UI = LD.UI, P = LD.Profile;
check("存档里的外观是那套图片皮肤",
  P.d.equip.head === suit.pieces.head && P.d.equip.upper === suit.pieces.upper
  && P.d.equip.lower === suit.pieces.lower, JSON.stringify(P.d.equip));
check("三件都带贴图键", IMG_KEYS.every(Boolean), IMG_KEYS.join(","));
check("启动时就把这三张贴图预热起来了（解码提前开始）",
  sb.imgs.length >= 3, "新建 Image " + sb.imgs.length + " 张");
check("预热时还没解码完（首帧确实会撞上未就绪）", IMG_KEYS.every(k => !V.skinImgReady(k)));

console.log("\n=== 2. 首帧画的是兜底，贴图到位后自己补画 ===");
const pv = countCanvas(128, 160);
sb.els.loadPv = pv;
UI.show("ovLoad");
check("第一次渲染画了 1 遍", pv.st.n === 1, pv.st.n + " 次");
const before = pv.st.n;
sb.imgs.forEach(im => { if (im.onload) im.onload(); });   // 模拟「解码完成」
check("贴图到位后这张画布被自动重画（不用点改名 / 随机配装）",
  pv.st.n === before + 1, before + " → " + pv.st.n + " 次");
check("三张图只补画一次，不会一张图重画一遍", pv.st.n === 2, pv.st.n + " 次");
check("补画之后贴图确实就绪了", IMG_KEYS.every(k => V.skinImgReady(k)));

console.log("\n=== 3. 贴图已就绪：一次渲染只画一遍，不再排队 ===");
const sb2 = makeSandbox("已缓存", { storage: { ld_profile_v3: SAVED }, imageLoads: true });
const V2 = sb2.LD.View, UI2 = sb2.LD.UI;
check("同步解码的沙箱里贴图一开始就是就绪的", IMG_KEYS.every(k => V2.skinImgReady(k)));
const pv2 = countCanvas(128, 160);
sb2.els.loadPv = pv2;
UI2.show("ovLoad");
check("只画 1 遍", pv2.st.n === 1, pv2.st.n + " 次");
sb2.imgs.forEach(im => { if (im.onload) im.onload(); });  // 再触发一次也不会多画
UI2.renderLoad();
check("重渲染一次就多画一遍，不会累积补画回调", pv2.st.n === 2, pv2.st.n + " 次");

console.log("\n=== 4. 贴图到位不再整页重建皮肤商店 ===");
{
  const pvBig = countCanvas(120, 150);
  sb.els.skinPv = pvBig;
  const shop = { innerHTML: "MARK", appendChild() {}, querySelector: () => countCanvas(120, 150), querySelectorAll: () => [] };
  sb.els.skinShop = shop;
  const ov = { classList: { contains: () => false } };
  sb.els.ovSkin = ov;
  const n0 = pvBig.st.n;
  V.onSkinImgLoad();
  check("只重画商店大预览", pvBig.st.n === n0 + 1, n0 + " → " + pvBig.st.n);
  check("没有整页重建（skinShop 内容没被清掉）", shop.innerHTML === "MARK");
}

console.log("\n=== 5. 没有贴图 / 无 Image 环境静默降级 ===");
{
  let threw = false, cbRan = false;
  try {
    V.warmSkin([undefined, null, "", "no_such_key"]);
    V.onSkinReady("no_such_key", () => { cbRan = true; });
    V.onSkinReady(null, () => {});
  } catch (e) { threw = true; }
  check("预热 / 等待不存在的贴图不会抛错", !threw);
  check("不存在的贴图不会被当成已就绪", !V.skinImgReady("no_such_key"));
  check("回调不会在没图时被误触发", !cbRan);
  const sb3 = makeSandbox("无 Image", { image: false, storage: { ld_profile_v3: SAVED } });
  const pv3 = countCanvas(128, 160);
  sb3.els.loadPv = pv3;
  let t3 = false;
  try { sb3.LD.UI.show("ovLoad"); } catch (e) { t3 = true; }
  check("环境没有 Image 也能正常渲染（程序化兜底）", !t3 && pv3.st.n === 1, pv3.st.n + " 次");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
