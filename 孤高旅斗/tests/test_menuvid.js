/* 孤高旅斗 v4.29 · 主菜单循环视频底 测试
 *
 * 背景：v4.14~v4.28 主菜单是一套分层伪 Live2D（86_live2d.js）。v4.29 起
 * 主菜单改成「正放 + 倒放」的 16 秒无缝循环视频（scripts/make_menu_loop.py），
 * 分层立绘原样保留，作为 fallback 与 ?bg=live2d 的手动对比入口。
 *
 * 这里守的是几条「坏了就会白屏 / 两个人」的边界：
 *   1. 骨架：<video id="menuVid"> 必须在 <canvas id="menuBg"> 前面（同 z-index，谁先谁在下）
 *   2. 自动播放三件套：muted / loop / playsinline 缺一个，iOS 就不肯播
 *   3. 互斥：视频模式下 canvas 必须藏起来，否则人物会叠成两个
 *   4. 降级：非浏览器环境（测试沙箱 / 老内核）装配失败时必须退回 live2d，不能卡在 video
 *   5. 资源：mp4 必须 faststart（moov 在 mdat 前），否则要整包下完才出画面
 */
const fs = require("fs");
const path = require("path");
const SB = require("./_sandbox.js");
const { makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const html = SB.html;
const sb = makeSandbox("menuvid");
const LD = sb.LD, MV = LD.MenuVid, L2D = LD.Live2D;

console.log("=== 1. 骨架：视频层在画布前面 ===");
{
  const iVid = html.indexOf('id="menuVid"');
  const iCv = html.indexOf('id="menuBg"');
  check("主菜单里有 <video id=\"menuVid\">", iVid > 0);
  check("视频排在 canvas 之前（同为 z-index:0，先出现的在下层）",
    iVid > 0 && iCv > iVid, "vid=" + iVid + " canvas=" + iCv);
  const tag = html.slice(html.lastIndexOf("<video", iVid), html.indexOf(">", iVid) + 1);
  check("video 标签带 muted（不带就一定被自动播放策略拦）", /\bmuted\b/.test(tag), tag.slice(0, 90));
  check("video 标签带 loop（循环靠它，不靠 JS）", /\bloop\b/.test(tag));
  check("video 标签带 playsinline（iOS 否则强制全屏）", /playsinline/.test(tag));
}

console.log("=== 2. 样式：视频模式把画布藏掉 ===");
{
  check("#ovMenu.vidOn #menuBg 被隐藏（否则人物叠成两个）",
    /#ovMenu\.vidOn\s+#menuBg\s*\{[^}]*display\s*:\s*none/.test(html));
  check("#menuVid 用 cover 铺满（任意屏幕比例都不留黑边）",
    /#menuVid\s*\{[^}]*object-fit\s*:\s*cover/.test(html));
  check("#menuVid 默认透明、.on 才淡入（避免先黑一下再跳出来）",
    /#menuVid\s*\{[^}]*opacity\s*:\s*0/.test(html) && /#menuVid\.on\s*\{[^}]*opacity\s*:\s*1/.test(html));
}

console.log("=== 3. 运行时对象 ===");
{
  check("LD.MenuVid 存在", !!MV);
  check("暴露 init / setActive / kick", !!MV && ["init", "setActive", "kick"].every(k => typeof MV[k] === "function"));
  /* 沙箱的假元素没有 setAttribute，装配必然失败 —— 正好用来验证「失败要退回 live2d」 */
  check("非浏览器环境下装配失败会退回 live2d（不会卡在 video 模式）",
    MV.mode === "live2d", "mode=" + MV.mode);
  let threw = false, ret;
  try { ret = MV.setActive(true); } catch (e) { threw = true; }
  check("live2d 模式下 setActive 不抛异常且返回 false", !threw && ret === false);
  try { MV.setActive(false); } catch (e) { threw = true; }
  check("live2d 模式下 setActive(false) 同样安全", !threw);
}

console.log("=== 4. 关闭视频时 live2d 必须还在 ===");
{
  check("Live2D.setCssBg 存在（视频模式下仍要给其它覆盖层写 --menuBg）",
    !!L2D && typeof L2D.setCssBg === "function");
  /* 沙箱的 style 是普通对象，没有 setProperty；这里临时补上,
   * 用来验证「真的把 url(...) 写进了 --menuBg」而不是只要不抛异常就算过。 */
  let wrote = null;
  const root = sb.document.documentElement;
  root.style.setProperty = function (k, v) { wrote = [k, v]; };
  L2D.setCssBg("data:image/jpeg;base64,AAAA");
  delete root.style.setProperty;
  check("setCssBg 真的写了 --menuBg",
    !!wrote && wrote[0] === "--menuBg" && String(wrote[1]).indexOf('url("data:image/jpeg') === 0,
    wrote ? wrote.join("=") .slice(0, 44) : "没写");
  check("分层立绘的 init / setActive 没被改动",
    typeof L2D.init === "function" && typeof L2D.setActive === "function");
}

console.log("=== 5. UI.show 会跟着切播放 / 暂停 ===");
{
  const old = MV.setActive;
  const calls = [];
  MV.setActive = function (on) { calls.push(!!on); return on; };
  LD.UI.show("ovMenu");
  const a = calls.slice();
  LD.UI.show("ovGame");
  const b = calls.slice();
  MV.setActive = old;
  check("进主菜单 -> setActive(true)", a.indexOf(true) >= 0, JSON.stringify(a));
  check("离开主菜单 -> setActive(false)", b.indexOf(false) >= 0, JSON.stringify(b));
}

console.log("=== 6. 资源：单文件里内嵌、且能边下边播 ===");
{
  check("window.LD_MENU_LOOP 已内嵌为 data URI",
    typeof sb.LD_MENU_LOOP === "string" && sb.LD_MENU_LOOP.indexOf("data:video/mp4;base64,") === 0,
    String(sb.LD_MENU_LOOP).slice(0, 32));
  check("window.LD_MENU_POSTER 已内嵌为 webp data URI",
    typeof sb.LD_MENU_POSTER === "string" && sb.LD_MENU_POSTER.indexOf("data:image/webp;base64,") === 0,
    String(sb.LD_MENU_POSTER).slice(0, 32));

  const mp4 = path.join(SB.ROOT, "assets", "menu-loop.mp4");
  const poster = path.join(SB.ROOT, "assets", "menu-poster.webp");
  check("assets/menu-loop.mp4 存在（构建输入，别被清掉）", fs.existsSync(mp4));
  check("assets/menu-poster.webp 存在", fs.existsSync(poster));
  if (fs.existsSync(mp4)) {
    const buf = fs.readFileSync(mp4);
    const iMoov = buf.indexOf(Buffer.from("moov"));
    const iMdat = buf.indexOf(Buffer.from("mdat"));
    check("mp4 是 faststart（moov 在 mdat 之前）", iMoov > 0 && iMdat > 0 && iMoov < iMdat,
      "moov=" + iMoov + " mdat=" + iMdat);
    check("mp4 体积控制在 700KB 以内（朋友那台服务器只有约 140KB/s）",
      buf.length < 700 * 1024, (buf.length / 1024).toFixed(0) + " KB");
  }
  if (fs.existsSync(poster)) {
    const p = fs.readFileSync(poster);
    check("poster 是 webp（RIFF....WEBP）",
      p.slice(0, 4).toString() === "RIFF" && p.slice(8, 12).toString() === "WEBP");
  }
}

console.log("\n--- 小计 ---");
console.log("  通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
